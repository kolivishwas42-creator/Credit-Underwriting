"""
The agent's settings: the rule defaults and settings in conf/ (data), overridable from the environment.

    RESIDENCE_OFFICE_VERIFICATION_CONF_DIR     another folder holding rules.yaml / settings.yaml (default: conf/)
    RESIDENCE_OFFICE_VERIFICATION_LOS_SCHEMA   the schema of the LOS tables read (default: settings.yaml)
    RESIDENCE_OFFICE_VERIFICATION_AI_SUMMARY   on / off: the AI risk summary (default: settings.yaml ai_summary.enabled)

The database connection is NOT configured here: shared/db (agent key "residence_office_verification",
shared/config/agent_databases.yaml) reads LOS_AGENTIC_DSN or RESIDENCE_OFFICE_VERIFICATION_DSN.
"""

from __future__ import annotations

import os
from copy import deepcopy
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from agents.residence_office_verification.summary import AiSummarySettings

AGENT = "residence_office_verification"
ENV_PREFIX = "RESIDENCE_OFFICE_VERIFICATION_"
CONF_DIR = Path(__file__).resolve().parent / "conf"
VERIFICATION_TYPES = ("RESIDENCE", "OFFICE")


class ConfigError(RuntimeError):
    """A conf/ file is missing or malformed."""


@dataclass(frozen=True)
class Settings:
    rules: dict[str, dict[str, dict[str, Any]]]          # mode -> rule_key -> {enabled, rule_id, name, criticality, weight}
    criticality_order: dict[str, int]
    risk_score_enabled: bool
    risk_score_max: int
    residence_address_types: tuple[str, ...]
    los_source_schema: str
    ai_summary: AiSummarySettings | None = None
    scoring: dict[str, Any] = field(init=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "scoring", {"criticality_order": dict(self.criticality_order),
                                             "risk_score_enabled": self.risk_score_enabled,
                                             "risk_score_max": self.risk_score_max})

    def default_rules(self, mode: str) -> dict[str, dict[str, Any]]:
        return deepcopy(self.rules.get(mode.upper(), {}))


def _env(name: str) -> str | None:
    return (os.getenv(ENV_PREFIX + name) or "").strip() or None


def _read(folder: Path, name: str) -> dict[str, Any]:
    path = folder / name
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise ConfigError(f"{AGENT}: cannot read conf file {name} ({type(exc).__name__})") from None
    if not isinstance(data, dict):
        raise ConfigError(f"{AGENT}: conf file {name} is not a mapping")
    return data


def load_settings(conf_dir: Path | None = None) -> Settings:
    folder = Path(conf_dir or _env("CONF_DIR") or CONF_DIR)
    rules_doc = _read(folder, "rules.yaml")
    settings_doc = _read(folder, "settings.yaml")

    rules = rules_doc.get("rules")
    if not isinstance(rules, dict) or not all(m in rules for m in VERIFICATION_TYPES):
        raise ConfigError(f"{AGENT}: rules.yaml needs rules.RESIDENCE and rules.OFFICE")
    normalised: dict[str, dict[str, dict[str, Any]]] = {}
    for mode, entries in rules.items():
        normalised[str(mode).upper()] = {
            str(key): {"enabled": bool(cfg.get("enabled", True)), "rule_id": str(cfg["rule_id"]),
                       "name": str(cfg["name"]), "criticality": str(cfg.get("criticality", "MEDIUM")).upper(),
                       "weight": int(cfg.get("weight", 0))}
            for key, cfg in (entries or {}).items()
        }
    risk = rules_doc.get("risk_score") or {}
    schema = _env("LOS_SCHEMA") or str(settings_doc.get("los_source_schema") or "")
    if not schema.isidentifier():
        raise ConfigError(f"{AGENT}: los_source_schema must be an identifier")
    types = settings_doc.get("residence_address_types")
    if not isinstance(types, list) or not types:
        raise ConfigError(f"{AGENT}: settings.yaml needs residence_address_types")
    return Settings(
        rules=normalised,
        criticality_order={str(k).upper(): int(v) for k, v in (rules_doc.get("criticality_order") or {}).items()},
        risk_score_enabled=bool(risk.get("enabled", False)),
        risk_score_max=int(risk.get("max", 100)),
        residence_address_types=tuple(str(t) for t in types),
        los_source_schema=schema,
        ai_summary=_ai_summary(settings_doc.get("ai_summary")),
    )


def _ai_summary(doc: Any) -> AiSummarySettings | None:
    if not doc:
        return None
    if not isinstance(doc, dict):
        raise ConfigError(f"{AGENT}: settings.yaml ai_summary is not a mapping")
    override = (_env("AI_SUMMARY") or "").lower()
    enabled = override in ("1", "on", "true", "yes") if override else bool(doc.get("enabled", False))
    try:
        return AiSummarySettings(
            enabled=enabled, model=(str(doc["model"]) if doc.get("model") else None),
            timeout_seconds=float(doc["timeout_seconds"]), temperature=float(doc["temperature"]),
            system_prompt=str(doc["system_prompt"]), user_prompt=str(doc["user_prompt"]),
            all_clear_text=str(doc["all_clear_text"]), unavailable_text=str(doc["unavailable_text"]))
    except KeyError as exc:
        raise ConfigError(f"{AGENT}: settings.yaml ai_summary lacks {exc}") from None


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return load_settings()
