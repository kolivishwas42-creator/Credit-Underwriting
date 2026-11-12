"""A rule switched off in the rule settings is really not applied (owner 2026-11-12): Bank R1-R7 and Legal R1-R9 give
NOT_APPLICABLE and are not run; with no switches every rule runs as before."""

from __future__ import annotations

from types import SimpleNamespace

import agents.bank_verification.rules as bank_rules
import agents.legal_verification.rules.engine as legal


def test_bank_rule_switched_off_is_not_run_and_is_not_applicable(monkeypatch):
    ran = []

    def fake(rule_id):
        return SimpleNamespace(ID=rule_id, run=lambda ev, rid=rule_id: ran.append(rid) or bank_rules.result(
            rid, bank_rules.RuleStatus.PASS, "ok"))

    monkeypatch.setattr(bank_rules, "CHECKS", tuple(fake(f"R{i}") for i in range(1, 8)))
    monkeypatch.setattr(bank_rules, "section", lambda name: {"R3": {"enabled": False}} if name == "rule_switches" else {})
    monkeypatch.setattr(bank_rules.risk_assessment, "run", lambda results: results[0])
    results = bank_rules.run_all(evidence=None)
    assert "R3" not in ran and len(ran) == 6
    r3 = next(r for r in results if r.rule_id == "R3")
    assert r3.status == bank_rules.RuleStatus.NOT_APPLICABLE


def test_bank_with_no_switches_runs_every_rule(monkeypatch):
    monkeypatch.setattr(bank_rules, "section", lambda name: {})
    assert all(bank_rules.enabled(f"R{i}") for i in range(1, 8))


def test_legal_rule_switched_off_is_not_run_and_is_not_applicable(monkeypatch):
    calls = []
    for fn in ("owners", "deed_consistency", "address", "history", "registration", "encumbrance", "required_documents",
               "legal_checks"):
        monkeypatch.setattr(legal, fn, lambda ev, fn=fn: calls.append(fn) or {"id": fn, "status": legal.PASS})
    monkeypatch.setattr(legal, "agency_cross_check", lambda ev, first: {"id": "R9", "status": legal.PASS})
    monkeypatch.setattr(legal, "overall", lambda results, ev: ({"id": "R10", "status": legal.PASS}, {}))
    monkeypatch.setattr(legal, "section", lambda name: {"R3": {"enabled": False}} if name == "rules" else {})
    monkeypatch.setattr(legal, "_off", lambda rule: {"id": rule, "status": legal.NOT_APPLICABLE})
    results, _ = legal.run(ev=None)
    assert "address" not in calls
    assert next(r for r in results if r["id"] == "R3")["status"] == legal.NOT_APPLICABLE
    assert len(results) == 10
