"""Rule settings API (owner 2026-11-12): on / off, numbers, locked rules, new rules from a template -- every change a
validated new version of the rule set. The rule store is replaced by an in-memory one: no database is touched."""

from __future__ import annotations

import copy
from typing import Any

import pytest
from fastapi.testclient import TestClient

from shared.db import rule_store

ELIGIBILITY = {"rules": {"checks": [{"rule": "AGE", "kind": "knockout"}, {"rule": "FOIR", "kind": "sizing"}],
                         "min_age": 21, "max_age": 65, "max_age_at_maturity": 70, "foir_limit_pct": 55}}
LEGAL = {"rules": {"R1": {"severity": "HIGH", "action": "X"}, "R10": {"severity": "HIGH", "action": "Y"}},
         "title_search": {"years": 13}}
CRIME = {"risk_levels": ["NO_RISK", "LOW_RISK", "AVERAGE_RISK", "HIGH_RISK"], "review_required_risks": ["AVERAGE_RISK", "HIGH_RISK"]}
DEDUPE = {"rules": [{"rule_id": "P05_DUPLICATE_WINDOW", "description": "Same product again soon", "inputs": ["x"],
                     "operator": "lt", "threshold": 720, "severity": "MEDIUM", "recommendation": "REVIEW"}]}


@pytest.fixture
def store(monkeypatch):
    sets = {"eligibility_policy": copy.deepcopy(ELIGIBILITY), "legal_verification_policy": copy.deepcopy(LEGAL),
            "crime_verification_policy": copy.deepcopy(CRIME), "dedupe_policy": copy.deepcopy(DEDUPE)}
    saved: list[dict[str, Any]] = []

    def import_version(name, content, *, by, note, activate=False, source=None):
        assert activate is True
        sets[name] = copy.deepcopy(content)
        saved.append({"name": name, "by": by, "note": note, "content": copy.deepcopy(content)})
        return "h" * 64

    # only the rule settings module sees the in-memory store: the agents keep their real rules (the app starts normally)
    from types import SimpleNamespace

    import shared.api.rule_settings as rs

    fake = SimpleNamespace(load=lambda name: sets[name], import_version=import_version, history=lambda name: [],
                           names=lambda: list(sets), load_family=lambda name: {}, FAMILY_SEPARATOR=rule_store.FAMILY_SEPARATOR,
                           RulesUnavailable=rule_store.RulesUnavailable, RulesInvalid=rule_store.RulesInvalid)
    monkeypatch.setattr(rs, "rule_store", fake)
    return saved


@pytest.fixture
def writer(make_token) -> TestClient:
    from main import app

    c = TestClient(app)
    c.headers["Authorization"] = f"Bearer {make_token(subject='officer.a', scopes='los.read los.rules.write')}"
    return c


@pytest.fixture
def reader(make_token) -> TestClient:
    from main import app

    c = TestClient(app)
    c.headers["Authorization"] = f"Bearer {make_token(subject='officer.b', scopes='los.read')}"
    return c


API = "/api/v1/rule-settings"


def test_reads_rules_with_their_numbers(store, reader):
    body = reader.get(f"{API}/eligibility_policy").json()
    rules = {r["id"]: r for r in body["rules"]}
    assert rules["AGE"]["enabled"] is True
    assert rules["AGE"]["params"] == {"min_age": 21, "max_age": 65, "max_age_at_maturity": 70}
    assert rules["FOIR"]["params"] == {"foir_limit_pct": 55}


def test_turning_a_rule_off_saves_a_new_version_with_who(store, writer):
    r = writer.patch(f"{API}/eligibility_policy/rules/AGE", json={"enabled": False})
    assert r.status_code == 200, r.text
    assert store[-1]["by"] == "officer.a"
    assert store[-1]["content"]["rules"]["checks"][0] == {"rule": "AGE", "kind": "knockout", "enabled": False}
    assert "AGE off" in store[-1]["note"]


def test_changing_a_number_writes_it_where_the_rule_reads_it(store, writer):
    r = writer.patch(f"{API}/eligibility_policy/rules/FOIR", json={"params": {"foir_limit_pct": 50}})
    assert r.status_code == 200, r.text
    assert store[-1]["content"]["rules"]["foir_limit_pct"] == 50


def test_a_number_the_rule_does_not_have_is_refused(store, writer):
    r = writer.patch(f"{API}/eligibility_policy/rules/AGE", json={"params": {"foir_limit_pct": 1}})
    assert r.status_code == 422
    assert not store


def test_the_overall_rule_cannot_be_switched_off(store, writer):
    r = writer.patch(f"{API}/legal_verification_policy/rules/R10", json={"enabled": False})
    assert r.status_code == 409
    assert not store


def test_crime_risk_levels_are_switches_for_review(store, writer):
    r = writer.patch(f"{API}/crime_verification_policy/rules/LOW_RISK", json={"enabled": True})
    assert r.status_code == 200, r.text
    # the universe's order is kept
    assert store[-1]["content"]["review_required_risks"] == ["LOW_RISK", "AVERAGE_RISK", "HIGH_RISK"]
    writer.patch(f"{API}/crime_verification_policy/rules/HIGH_RISK", json={"enabled": False})
    assert store[-1]["content"]["review_required_risks"] == ["LOW_RISK", "AVERAGE_RISK"]


def test_changing_rules_needs_the_write_scope(store, reader):
    assert reader.patch(f"{API}/eligibility_policy/rules/AGE", json={"enabled": False}).status_code == 403
    assert not store


def test_a_rule_is_added_from_a_template_and_checked_first(store, writer):
    bad = writer.post(f"{API}/dedupe_policy/rules", json={"template": "threshold_rule", "values": {"rule_id": "x"}})
    assert bad.status_code == 422 and not store
    good = writer.post(f"{API}/dedupe_policy/rules", json={"template": "threshold_rule", "values": {
        "rule_id": "P20_MANY_CASES", "description": "Many other cases", "signal": "applications.other_cases_same_product",
        "operator": "gt", "threshold": 3, "severity": "HIGH", "recommendation": "REVIEW"}})
    assert good.status_code == 200, good.text
    new = store[-1]["content"]["rules"][-1]
    assert new["rule_id"] == "P20_MANY_CASES" and new["inputs"] == ["applications.other_cases_same_product"]
    assert new["enabled"] is True and new["confirmation_status"] == "UNCONFIRMED"
    again = writer.post(f"{API}/dedupe_policy/rules", json={"template": "threshold_rule", "values": {
        "rule_id": "P20_MANY_CASES", "description": "d", "signal": "applications.other_cases_same_product",
        "operator": "gt", "threshold": 3, "severity": "HIGH", "recommendation": "REVIEW"}})
    assert again.status_code == 422                     # the same id twice is refused


def test_a_set_without_rule_settings_is_404(store, reader):
    assert reader.get(f"{API}/nothing_here").status_code == 404


def test_bank_rules_show_and_switch_even_before_the_version_has_switches(monkeypatch, writer):
    """The version in force was saved before rule_switches existed: R1-R7 still show (all on) and the first change
    creates the map."""
    import shared.api.rule_settings as rs
    from types import SimpleNamespace

    sets = {"bank_verification_policy": {"latest_transactions": {"count": 3}, "balance": {"tolerance": 1.0}}}
    saved = []
    fake = SimpleNamespace(load=lambda n: sets[n], history=lambda n: [], names=lambda: list(sets), load_family=lambda n: {},
                           import_version=lambda n, c, **k: (saved.append(c), sets.__setitem__(n, c), "h" * 64)[2],
                           FAMILY_SEPARATOR=":", RulesUnavailable=rule_store.RulesUnavailable, RulesInvalid=rule_store.RulesInvalid)
    monkeypatch.setattr(rs, "rule_store", fake)
    rules = {r["id"]: r for r in writer.get(f"{API}/bank_verification_policy").json()["rules"]}
    assert list(rules) == [f"R{i}" for i in range(1, 8)] and all(r["enabled"] for r in rules.values())
    assert rules["R2"]["params"] == {"count": 3} and rules["R5"]["params"] == {"tolerance": 1.0}
    assert writer.patch(f"{API}/bank_verification_policy/rules/R3", json={"enabled": False}).status_code == 200
    assert saved[-1]["rule_switches"] == {"R3": {"enabled": False}}
