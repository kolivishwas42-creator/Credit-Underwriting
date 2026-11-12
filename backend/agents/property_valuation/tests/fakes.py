"""An in-memory PropertyValuationRepository (no database)."""

from __future__ import annotations

import copy
from datetime import datetime
from typing import Any

from agents.property_valuation.tests import samples


class FakeRepository:
    def __init__(self, rows: list[dict[str, Any]] | None = None):
        self.rows = [samples.property_row()] if rows is None else rows
        self.rule_rows: dict[str, dict[str, Any]] = {}
        self.visits: list[dict[str, Any]] = []
        self.outcomes: list[dict[str, Any]] = []
        self.seed_calls = 0

    def application_rows(self, application_number: str) -> list[dict[str, Any]]:
        return [copy.deepcopy(r) for r in self.rows if r["application_number"] == application_number]

    def seed_missing_rules(self, defaults):
        self.seed_calls += 1
        added = 0
        for key, cfg in defaults.items():
            if key not in self.rule_rows:
                self.rule_rows[key] = {"rule_key": key, "original_id": cfg["original_id"], "name": cfg["name"],
                                       "description": cfg["name"], "enabled": cfg.get("enabled", True),
                                       "sequence": cfg["sequence"], "severity": cfg.get("severity", "MAJOR"),
                                       "fields": copy.deepcopy(cfg.get("fields", {})),
                                       "settings": copy.deepcopy(cfg.get("settings", {}))}
                added += 1
        return added

    def rule_configs(self):
        return [copy.deepcopy(r) for r in sorted(self.rule_rows.values(), key=lambda r: r["sequence"])]

    def update_rule(self, rule_key, updates):
        if rule_key not in self.rule_rows:
            return None
        self.rule_rows[rule_key].update(updates)
        return copy.deepcopy(self.rule_rows[rule_key])

    def save_run(self, verification, result):
        vid, rid = len(self.visits) + 1, len(self.outcomes) + 1
        now = datetime(2026, 1, 1, 12, 0, 0)
        self.visits.append({**verification, "verification_id": vid, "created_at": now})
        self.outcomes.append({**result, "result_id": rid, "verification_id": vid, "created_at": now})
        return vid, rid

    def verifications(self, application_id, collateral_property_id=None):
        return [v for v in reversed(self.visits) if v["application_id"] == application_id
                and (collateral_property_id is None or v["collateral_property_id"] == collateral_property_id)]

    def results(self, application_id):
        return [r for r in reversed(self.outcomes) if r["application_id"] == application_id]
