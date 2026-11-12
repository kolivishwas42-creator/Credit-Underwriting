"""Fakes for the ITR verification tests: an in-memory repository, a resolver and an extractor that read no file, no
database and no network. All values are synthetic."""

from __future__ import annotations

import copy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

import pytest

from agents.itr_verification import config
from agents.itr_verification.repository import RESULT_COLUMNS, rule_dict, setting_dict
from agents.itr_verification.rules.policy import Policy, RULE_ATTRS, seed_rule_rows, seed_setting_rows
from agents.itr_verification.service import ITRVerificationService
from agents.itr_verification.storage.base import DocumentNotFound, ResolvedDocument

SYNTHETIC_FIELDS: Dict[str, Any] = {
    "applicant_name": "TEST APPLICANT",
    "pan": "ABCDE1234F",
    "assessment_year": "2024-25",
    "acknowledgement_number": "123456789012345",
    "total_income": 780000.0,
    "gti": 850000.0,
    "form_number": "ITR-1",
    "filing_date": None,
    "status": "Individual",
}


class FakeRepository:
    """ITRRepository in memory (seeded from conf/rules.yaml like the PostgreSQL one)."""

    def __init__(self, seed: bool = True):
        self.rules: list[dict] = []
        self.settings: dict[str, dict] = {}
        self.results: list[dict] = []
        self.fail = False
        self._id = 0
        if seed:
            conf = config.rules_conf()
            for row in seed_rule_rows(conf):
                self.save_rule(row, "system_seed")
            for s in seed_setting_rows(conf):
                self.save_setting(s["setting_key"], s["setting_value"], s["value_type"], s["description"],
                                  "system_seed")

    def _next(self) -> int:
        self._id += 1
        return self._id

    def _check(self) -> None:
        if self.fail:
            raise ConnectionError("database down (fake)")

    def ping(self) -> None:
        self._check()

    def list_rules(self, category: Optional[str] = None) -> list[dict]:
        self._check()
        rows = [r for r in self.rules if not category or r["category"] == category]
        return [rule_dict(r) for r in sorted(rows, key=lambda r: (r["category"], r["id"]))]

    def get_rule(self, category: str, field: str) -> Optional[dict]:
        self._check()
        for r in self.rules:
            if r["category"] == category and r["field"] == field:
                return rule_dict(r)
        return None

    def save_rule(self, row, updated_by: str) -> dict:
        self._check()
        now = datetime.now(timezone.utc)
        for r in self.rules:
            if r["category"] == row["category"] and r["field"] == row["field"]:
                r.update({a: row[a] for a in RULE_ATTRS}, updated_at=now, updated_by=updated_by)
                return rule_dict(r)
        new = {"id": self._next(), "category": row["category"], "field": row["field"],
               **{a: row.get(a) for a in RULE_ATTRS}, "updated_at": now, "updated_by": updated_by}
        self.rules.append(new)
        return rule_dict(new)

    def list_settings(self) -> list[dict]:
        self._check()
        return [setting_dict(s) for _, s in sorted(self.settings.items())]

    def get_setting(self, key: str) -> Optional[dict]:
        self._check()
        return setting_dict(self.settings[key]) if key in self.settings else None

    def save_setting(self, key, setting_value, value_type, description, updated_by) -> dict:
        self._check()
        row = self.settings.get(key) or {"id": self._next(), "setting_key": key, "description": None}
        row.update(setting_value=setting_value, value_type=value_type, updated_at=datetime.now(timezone.utc),
                   updated_by=updated_by)
        if description is not None:
            row["description"] = description
        self.settings[key] = row
        return setting_dict(row)

    def save_result(self, row) -> dict:
        self._check()
        stored = {"id": self._next(), **{c: copy.deepcopy(row.get(c)) for c in RESULT_COLUMNS},
                  "created_at": datetime.now(timezone.utc)}
        self.results.append(stored)
        return dict(stored)

    def list_results(self, limit, offset, decision=None, pan_number=None) -> list[dict]:
        self._check()
        rows = [r for r in reversed(self.results)
                if (not decision or r["decision"] == decision.upper())
                and (not pan_number or r["pan_number"] == pan_number.upper())]
        return rows[offset:offset + limit]

    def get_result(self, run_id: str) -> Optional[dict]:
        self._check()
        return next((r for r in self.results if r["run_id"] == run_id), None)


class FakeResolver:
    """Ids map to made-up paths (never opened); 'missing' ids are not in the store."""

    def __init__(self):
        self.resolved: list[ResolvedDocument] = []

    def resolve(self, identifier: str, side: str) -> ResolvedDocument:
        if identifier.startswith("missing"):
            raise DocumentNotFound(f"Document '{identifier}' not found in the {side} document store")
        doc = ResolvedDocument(Path(f"/nonexistent/{side}/{identifier}"), temporary=False)
        self.resolved.append(doc)
        return doc


class FakeExtractor:
    """Returns the synthetic fields registered for a file name (by default the same for every document)."""

    def __init__(self, by_name: Optional[Dict[str, Dict[str, Any]]] = None):
        self.by_name = by_name or {}
        self.calls: list[str] = []

    def extract(self, file_path):
        name = Path(file_path).name
        self.calls.append(name)
        fields = dict(self.by_name.get(name, SYNTHETIC_FIELDS))
        return fields, f"synthetic text of {name}"


@pytest.fixture(autouse=True)
def no_real_database(monkeypatch):
    """No test of this agent may reach a configured database: both variables the agent's DSN can come from are blank
    (a test that needs PostgreSQL creates a throwaway database and sets one itself)."""
    monkeypatch.setenv("ITR_VERIFICATION_DSN", "")
    monkeypatch.setenv("LOS_AGENTIC_DSN", "")


@pytest.fixture()
def policy() -> Policy:
    return Policy.from_conf(config.rules_conf())


@pytest.fixture()
def repo() -> FakeRepository:
    return FakeRepository()


@pytest.fixture()
def extractor() -> FakeExtractor:
    return FakeExtractor()


@pytest.fixture()
def resolver() -> FakeResolver:
    return FakeResolver()


@pytest.fixture()
def service(repo, resolver, extractor, policy) -> ITRVerificationService:
    return ITRVerificationService(repo, resolver, extractor, policy, config.extraction_settings())
