"""
The fraud screening settings: conf/fraud_screening.yaml (thresholds, reference lists, vendor request options) plus the
environment (variables prefixed FRAUD_SCREENING_; the vendor endpoints and keys, threshold overrides).

    FRAUD_SCREENING_CONFIG_PATH                 another YAML instead of conf/fraud_screening.yaml
    FRAUD_SCREENING_LOAN_SCHEMA                 schema of the LOS loan application tables (default: conf loan_schema)
    FRAUD_SCREENING_AML_API_URL / _AML_API_KEY  AML vendor; URL unset -> conf/AML.json sample (source "mock")
    FRAUD_SCREENING_PEP_API_URL / _PEP_API_KEY  PEP vendor; URL unset -> conf/PEP.json sample; key unset -> AML key
    FRAUD_SCREENING_AML_MATCH_THRESHOLD_PERCENT, FRAUD_SCREENING_PEP_MATCH_THRESHOLD_PERCENT
    FRAUD_SCREENING_AML_API_TIMEOUT_SECONDS,     FRAUD_SCREENING_PEP_API_TIMEOUT_SECONDS

The database is not configured here: shared/db (agent key "fraud_screening") owns it. Values are never logged.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Mapping

import yaml

from agents.fraud_screening.rules.policy import Policy

AGENT = "fraud_screening"
ENV_PREFIX = "FRAUD_SCREENING_"
CONF_DIR = Path(__file__).resolve().parent / "conf"
DEFAULT_CONFIG = CONF_DIR / "fraud_screening.yaml"


class ConfigError(RuntimeError):
    """The fraud screening configuration is missing, unreadable or incomplete (no values inside)."""


@dataclass(frozen=True)
class VendorSettings:
    """One watch-list vendor (AML or PEP)."""
    kind: str
    api_url: str
    api_key: str = field(repr=False)
    timeout_seconds: float
    match_threshold_percent: float
    no_record_status_codes: tuple[int, ...]
    sample_file: Path
    request_options: Mapping[str, Any]

    @property
    def headers(self) -> dict[str, str]:
        return {"Content-Type": "application/json", "x-karza-key": self.api_key or ""}


@dataclass(frozen=True)
class Settings:
    aml: VendorSettings
    pep: VendorSettings
    loan_schema: str
    policy: Policy


def _env(env: Mapping[str, str], name: str) -> str:
    return (env.get(ENV_PREFIX + name) or "").strip()


def _number(env: Mapping[str, str], name: str, default: Any) -> float:
    raw = _env(env, name)
    try:
        return float(raw) if raw else float(default)
    except (TypeError, ValueError):
        raise ConfigError(f"{ENV_PREFIX}{name} must be a number") from None


def _read_yaml(path: Path) -> dict[str, Any]:
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ConfigError(f"missing config {path.name}") from exc
    except yaml.YAMLError as exc:
        raise ConfigError(f"unreadable config {path.name}: {exc}") from exc
    if not isinstance(data, dict):
        raise ConfigError(f"config {path.name} is not a mapping")
    return data


def _vendor(kind: str, conf: Mapping[str, Any], env: Mapping[str, str], key_fallback: str = "") -> VendorSettings:
    up = kind.upper()
    sample = CONF_DIR / str(conf["sample_file"])
    return VendorSettings(
        kind=kind,
        api_url=_env(env, f"{up}_API_URL"),
        api_key=_env(env, f"{up}_API_KEY") or key_fallback,
        timeout_seconds=_number(env, f"{up}_API_TIMEOUT_SECONDS", conf["timeout_seconds"]),
        match_threshold_percent=_number(env, f"{up}_MATCH_THRESHOLD_PERCENT", conf["match_threshold_percent"]),
        no_record_status_codes=tuple(int(c) for c in conf["no_record_status_codes"]),
        sample_file=sample,
        request_options=dict(conf.get("vendor") or {}),
    )


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    env = os.environ if env is None else env
    path = Path(_env(env, "CONFIG_PATH")) if _env(env, "CONFIG_PATH") else DEFAULT_CONFIG
    data = _read_yaml(path)
    try:
        aml = _vendor("aml", data["aml"], env)
        pep = _vendor("pep", data["pep"], env, key_fallback=aml.api_key)
        policy = Policy.from_mapping(data)
        loan_schema = _env(env, "LOAN_SCHEMA") or str(data["loan_schema"])
    except KeyError as exc:
        raise ConfigError(f"config {path.name} lacks key {exc}") from None
    if not loan_schema.isidentifier():
        raise ConfigError(f"{ENV_PREFIX}LOAN_SCHEMA / loan_schema must be an identifier")
    return Settings(aml=aml, pep=pep, loan_schema=loan_schema, policy=policy)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return load_settings()
