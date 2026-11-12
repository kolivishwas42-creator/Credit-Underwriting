"""
The agent's settings: the rule defaults from conf/rules.yaml, the environment (variables prefixed
COLLATERAL_VERIFICATION_), and the runtime rule configuration the service evaluates with.

    AGENT                 the agent key (shared/config/agent_databases.yaml) -- its schema in los_agentic
    RuleConfig            the live rule configuration (defaults from conf/, then overridden by the database)
    default_rule_config() conf/rules.yaml as a RuleConfig
    seed_settings()       the system-settings rows seeded into an empty database
    los_schema()          the schema of the LOS case tables (COLLATERAL_VERIFICATION_LOS_SCHEMA, else conf/)
"""

from __future__ import annotations

import copy
import json
import os
from dataclasses import dataclass, field, fields, replace
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

AGENT = "collateral_verification"
ENV_PREFIX = "COLLATERAL_VERIFICATION_"
CONF_DIR = Path(__file__).resolve().parent / "conf"
RULES_FILE = CONF_DIR / "rules.yaml"


@dataclass(frozen=True)
class RuleConfig:
    """Everything the rule engine reads. Field names are the lower-case setting keys."""

    rules: dict[str, dict[str, Any]] = field(default_factory=dict)
    vendor_final_statuses: list[str] = field(default_factory=list)
    completion_tolerance_pp: float = 0
    compare_pin: bool = False
    name_match_threshold: float = 0.0
    flag_vendor_status_conflict: bool = True
    flag_unsatisfied_cersai_charge: bool = True

    def with_settings(self, values: dict[str, Any]) -> "RuleConfig":
        """A copy with the settings whose (case-insensitive) key is a field here; other keys are ignored."""
        known = {f.name for f in fields(self)} - {"rules"}
        updates = {k.lower(): v for k, v in values.items() if k.lower() in known}
        return replace(self, **updates)


@lru_cache(maxsize=1)
def _conf() -> dict[str, Any]:
    data = yaml.safe_load(RULES_FILE.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("rules"), dict):
        raise RuntimeError(f"{RULES_FILE.name} has no 'rules' mapping")
    return data


def default_rule_config() -> RuleConfig:
    data = _conf()
    tolerance = data["completion_tolerance_pp"]
    rules: dict[str, dict[str, Any]] = {}
    for rule_id, meta in data["rules"].items():
        item = copy.deepcopy(dict(meta))
        if "tolerance_pp" in item and item["tolerance_pp"] is None:
            item["tolerance_pp"] = tolerance
        rules[str(rule_id)] = item
    return RuleConfig(
        rules=rules,
        vendor_final_statuses=[str(s) for s in data["vendor_final_statuses"]],
        completion_tolerance_pp=tolerance,
        compare_pin=bool(data["compare_pin"]),
        name_match_threshold=data["name_match_threshold"],
        flag_vendor_status_conflict=bool(data["flag_vendor_status_conflict"]),
        flag_unsatisfied_cersai_charge=bool(data["flag_unsatisfied_cersai_charge"]),
    )


def seed_settings() -> list[tuple[str, str, str, str]]:
    """The system-settings rows seeded into an empty database: (key, stored value, value type, description). The
    value is the conf/ value of the same (lower-case) key, stored as text."""
    data = _conf()
    rows = []
    for key, spec in (data.get("settings") or {}).items():
        value, vtype = data[str(key).lower()], str(spec["type"])
        if vtype == "boolean":
            stored = str(bool(value)).lower()
        elif vtype == "json":
            stored = json.dumps(value)
        else:
            stored = str(value)
        rows.append((str(key), stored, vtype, str(spec["description"])))
    return rows


def los_schema() -> str:
    value = (os.getenv(ENV_PREFIX + "LOS_SCHEMA") or "").strip() or str(_conf().get("los_schema") or "public")
    if not value.isidentifier():
        raise RuntimeError(f"{ENV_PREFIX}LOS_SCHEMA must be an identifier")
    return value


__all__ = ["AGENT", "CONF_DIR", "ENV_PREFIX", "RuleConfig", "default_rule_config", "los_schema", "seed_settings"]
