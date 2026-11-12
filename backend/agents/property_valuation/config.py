"""
THE PROPERTY VALUATION AGENT'S SETTINGS -- the rule catalogue and engine settings from conf/, nothing hard-coded.

    conf/rules.yaml       the 22 rules (seed / defaults of property_valuation_rule_configs)
    conf/settings.yaml    engine comparison settings, agent version, default vendor name, the LOS schema

Environment (prefix PROPERTY_VALUATION_):
    PROPERTY_VALUATION_CONF_DIR   another folder holding rules.yaml / settings.yaml (default: this package's conf/)
    PROPERTY_VALUATION_DSN        read by shared/db/core.py only (an own database instead of LOS_AGENTIC_DSN)
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

AGENT = "property_valuation"
ENV_PREFIX = "PROPERTY_VALUATION_"
DEFAULT_CONF_DIR = Path(__file__).resolve().parent / "conf"
_REQUIRED_RULE_KEYS = ("original_id", "name", "sequence")


class ConfigError(RuntimeError):
    """The agent's configuration files are missing or malformed."""


@dataclass(frozen=True)
class Settings:
    rules: dict[str, dict[str, Any]]
    engine: dict[str, Any]
    agent_version: str
    default_vendor_name: str
    los_schema: str


def conf_dir() -> Path:
    value = (os.getenv(ENV_PREFIX + "CONF_DIR") or "").strip()
    return Path(value) if value else DEFAULT_CONF_DIR


def _load(path: Path) -> dict[str, Any]:
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ConfigError(f"property valuation: {path.name} not found in the conf folder") from None
    if not isinstance(data, dict):
        raise ConfigError(f"property valuation: {path.name} is not a mapping")
    return data


@lru_cache(maxsize=1)
def settings() -> Settings:
    folder = conf_dir()
    rules = _load(folder / "rules.yaml").get("rules")
    if not isinstance(rules, dict) or not rules:
        raise ConfigError("property valuation: rules.yaml has no 'rules' mapping")
    for key, rule in rules.items():
        missing = [k for k in _REQUIRED_RULE_KEYS if not isinstance(rule, dict) or k not in rule]
        if missing:
            raise ConfigError(f"property valuation: rule {key} lacks {', '.join(missing)}")

    data = _load(folder / "settings.yaml")
    engine = data.get("engine")
    agent = data.get("agent") or {}
    los = data.get("los") or {}
    if not isinstance(engine, dict):
        raise ConfigError("property valuation: settings.yaml has no 'engine' mapping")
    for key in ("agent_version", "default_vendor_name"):
        if not agent.get(key):
            raise ConfigError(f"property valuation: settings.yaml agent.{key} is not set")
    los_schema = str(los.get("schema") or "")
    if not los_schema.isidentifier():
        raise ConfigError("property valuation: settings.yaml los.schema must be an identifier")
    return Settings(rules=rules, engine=engine, agent_version=str(agent["agent_version"]),
                    default_vendor_name=str(agent["default_vendor_name"]), los_schema=los_schema)


def reload() -> Settings:
    settings.cache_clear()
    return settings()


__all__ = ["AGENT", "ConfigError", "Settings", "conf_dir", "reload", "settings"]
