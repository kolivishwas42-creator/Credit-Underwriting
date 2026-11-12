"""
The policy the rule engine judges with -- built from plain data (conf/rules.yaml defaults, then the database rows on
top). Pure: no I/O.

Database rows overlay the defaults exactly as the original agent did: when the database holds comparison rules they
replace the default list; when it holds application rules they replace the default mapping; each stored system
setting replaces the default of the same key.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, replace
from typing import Any, Iterable, Mapping

#: system_settings key -> Policy attribute
SETTING_FIELDS: dict[str, str] = {
    "ACCEPT_THRESHOLD": "accept_threshold",
    "REVIEW_THRESHOLD": "review_threshold",
    "CRITICAL_BLOCKS_ACCEPT": "critical_blocks_accept",
    "VENDOR_REJECTION_FORCES_REJECT": "vendor_rejection_forces_reject",
    "CRITICAL_APPLICATION_MISMATCH_FORCES_REJECT": "critical_application_mismatch_forces_reject",
    "FINAL_STATUS_UNKNOWN_BEHAVIOUR": "final_status_unknown_behaviour",
    "FINAL_STATUS_APPROVED_VALUES": "final_status_approved_values",
    "FINAL_STATUS_REJECTED_VALUES": "final_status_rejected_values",
    "FUZZY_NAME_THRESHOLD": "fuzzy_name_threshold",
}


@dataclass(frozen=True)
class Policy:
    comparison_rules: list[dict[str, Any]] = field(default_factory=list)
    application_rules: dict[str, dict[str, Any]] = field(default_factory=dict)
    accept_threshold: float = 90.0
    review_threshold: float = 70.0
    critical_blocks_accept: bool = True
    vendor_rejection_forces_reject: bool = True
    critical_application_mismatch_forces_reject: bool = False
    final_status_unknown_behaviour: str = "review"
    final_status_approved_values: list[str] = field(default_factory=list)
    final_status_rejected_values: list[str] = field(default_factory=list)
    fuzzy_name_threshold: float = 0.85

    @classmethod
    def from_conf(cls, conf: Mapping[str, Any]) -> "Policy":
        """The defaults of conf/rules.yaml."""
        policy = cls(comparison_rules=[dict(r) for r in conf.get("comparison_rules") or []],
                     application_rules={str(k): dict(v) for k, v in (conf.get("application_rules") or {}).items()})
        return policy.with_settings({s["key"]: s["value"] for s in conf.get("settings") or []})

    def with_settings(self, values: Mapping[str, Any]) -> "Policy":
        changes: dict[str, Any] = {}
        for key, value in values.items():
            attr = SETTING_FIELDS.get(key)
            if attr is None or value is None:
                continue
            if attr in ("accept_threshold", "review_threshold", "fuzzy_name_threshold"):
                value = float(value)
            elif attr in ("final_status_approved_values", "final_status_rejected_values"):
                value = list(value) if isinstance(value, (list, tuple)) else []
            elif attr == "final_status_unknown_behaviour":
                value = str(value)
            else:
                value = bool(value)
            changes[attr] = value
        return replace(self, **changes)

    def with_rows(self, rule_rows: Iterable[Mapping[str, Any]],
                  setting_rows: Iterable[Mapping[str, Any]]) -> "Policy":
        """The stored rules / settings (API-shaped rows, see repository) over this policy."""
        rules = list(rule_rows)
        comparison = [comparison_rule(r) for r in rules if r.get("category") == "comparison"]
        application = {str(r["field"]): application_rule(r) for r in rules if r.get("category") == "application"}
        policy = self
        if comparison:
            policy = replace(policy, comparison_rules=comparison)
        if application:
            policy = replace(policy, application_rules=application)
        return policy.with_settings({str(s["setting_key"]): s.get("parsed_value") for s in setting_rows})


def comparison_rule(row: Mapping[str, Any]) -> dict[str, Any]:
    """A stored rule row in the shape the engine reads for document-to-document rules."""
    return {
        "field": row["field"],
        "enabled": bool(row.get("enabled")),
        "weight": float(row.get("weight") or 0),
        "match_type": row.get("match_type") or "exact",
        "tolerance_pct": float(row.get("tolerance_pct") or 0),
        "severity_if_mismatch": row.get("severity") or "medium",
        "description": row.get("description") or "",
    }


def application_rule(row: Mapping[str, Any]) -> dict[str, Any]:
    """A stored rule row in the shape the engine reads for application-data rules."""
    return {
        "enabled": bool(row.get("enabled")),
        "document_field": row.get("document_field") or row["field"],
        "label": row.get("label") or row["field"],
        "weight": float(row.get("weight") or 0),
        "severity": row.get("severity") or "medium",
        "match_type": row.get("match_type") or "exact",
        "tolerance_pct": float(row.get("tolerance_pct") or 0),
    }


# ----------------------------------------------------------------------------------------- rule / setting rows
RULE_DEFAULTS: dict[str, Any] = {
    "enabled": True, "weight": 0.0, "match_type": "exact", "tolerance_pct": 0.0, "severity": "medium",
    "description": None, "document_field": None, "label": None, "extra_json": None,
}
RULE_ATTRS = tuple(RULE_DEFAULTS)


def merge_rule(existing: Mapping[str, Any] | None, payload: Mapping[str, Any]) -> dict[str, Any]:
    """The row to store for an upsert: the existing row (or the column defaults) with every non-null payload value."""
    category, name = payload.get("category"), payload.get("field")
    if not category or not name:
        raise ValueError("category and field are required")
    row = {"category": category, "field": name, **RULE_DEFAULTS}
    if existing:
        row.update({k: existing.get(k) for k in RULE_ATTRS})
    row.update({k: payload[k] for k in RULE_ATTRS if payload.get(k) is not None})
    return row


def seed_rule_rows(conf: Mapping[str, Any]) -> list[dict[str, Any]]:
    """The default rules as rule_configs rows (comparison first, then application)."""
    rows = []
    for r in conf.get("comparison_rules") or []:
        rows.append({"category": "comparison", "field": r["field"], "enabled": bool(r.get("enabled", True)),
                     "weight": float(r.get("weight", 0)), "match_type": r.get("match_type", "exact"),
                     "tolerance_pct": float(r.get("tolerance_pct", 0.0)),
                     "severity": r.get("severity_if_mismatch", "medium"), "description": r.get("description", ""),
                     "document_field": None, "label": None, "extra_json": None})
    for key, r in (conf.get("application_rules") or {}).items():
        rows.append({"category": "application", "field": key, "enabled": bool(r.get("enabled", True)),
                     "weight": float(r.get("weight", 0)), "match_type": r.get("match_type", "exact"),
                     "tolerance_pct": float(r.get("tolerance_pct", 0.0)), "severity": r.get("severity", "medium"),
                     "description": r.get("label", ""), "document_field": r.get("document_field"),
                     "label": r.get("label"), "extra_json": None})
    return rows


def seed_setting_rows(conf: Mapping[str, Any]) -> list[dict[str, Any]]:
    """The default settings as system_settings rows (values serialised as stored)."""
    return [{"setting_key": s["key"], "setting_value": serialize_setting(s["value"], s["value_type"]),
             "value_type": s["value_type"], "description": s.get("description")}
            for s in conf.get("settings") or []]


def serialize_setting(value: Any, value_type: str) -> str:
    """How a setting value is stored (text)."""
    if value_type == "json":
        return json.dumps(value) if not isinstance(value, str) else value
    if value_type == "boolean":
        return "true" if value in (True, "true", "1", 1, "yes") else "false"
    return str(value)


def parse_setting(text: str | None, value_type: str | None) -> Any:
    """A stored setting text as its typed value (unparseable text is returned as is)."""
    if text is None:
        return None
    kind = (value_type or "string").lower()
    if kind == "number":
        try:
            return float(text)
        except ValueError:
            return text
    if kind == "boolean":
        return str(text).strip().lower() in ("1", "true", "yes", "y")
    if kind == "json":
        try:
            return json.loads(text)
        except (TypeError, ValueError):
            return text
    return text


__all__ = ["Policy", "RULE_ATTRS", "RULE_DEFAULTS", "SETTING_FIELDS", "application_rule", "comparison_rule",
           "merge_rule", "parse_setting", "seed_rule_rows", "seed_setting_rows", "serialize_setting"]
