"""The rule engine and address utilities (pure; synthetic vendor responses)."""

from __future__ import annotations

import re

import pytest

from agents.residence_office_verification.db.schema import MIGRATIONS
from agents.residence_office_verification.rules import addresses_match, clean_text, evaluate_rules, normalize_address

ALL_GOOD = {"status": "Positive", "final_status": "Approved", "neighbour_check": "Yes", "address_confirmed": "Yes",
            "corrected_address": None, "negative_area": "No", "political_link": "No", "name_plate_visible": "Yes",
            "community_dominated": "No"}


def run(settings, vendor, mode="RESIDENCE", declared="12 Sample Road, Testcity", rule_configs=None, scoring=None):
    return evaluate_rules(vendor, declared, mode, rule_configs, default_rules=settings.rules,
                          scoring=scoring or settings.scoring)


def by_key(result):
    return {r["rule_key"]: r for r in result["rules"]}


# ------------------------------------------------------------------------------------------- address utilities
def test_clean_text():
    assert clean_text(None) is None
    assert clean_text("   ") is None
    assert clean_text("  a b ") == "a b"


def test_normalize_address_case_punctuation_space():
    assert normalize_address("12, Sample-Road;  TESTCITY.") == "12 sample road testcity"
    assert normalize_address("") is None


def test_addresses_match():
    assert addresses_match("12 Sample Road", "12, sample road") is True
    assert addresses_match("12 Sample Road", "14 Sample Road") is False
    assert addresses_match(None, "x") is None


# ------------------------------------------------------------------------------------------- rule engine
def test_all_good_residence_passes_and_rule_10_is_disabled(settings):
    result = run(settings, ALL_GOOD)
    assert result["overall_recommendation"] == "PASS"
    assert result["overall_criticality"] == "NONE"
    assert result["rules_evaluated"] == 9 and result["rules_triggered"] == 0
    assert "RULE_10" not in by_key(result)
    assert result["risk_score"] is None
    assert result["insights"] == []
    assert result["summary"] == ("9 enabled rule(s) evaluated; 0 issue(s), 0 pending rule(s). "
                                 "Overall recommendation: PASS.")
    assert by_key(result)["RULE_08"]["status"] == "NOT_APPLICABLE"


def test_office_runs_all_ten_rules(settings):
    result = run(settings, ALL_GOOD, mode="OFFICE")
    assert result["rules_evaluated"] == 10
    assert result["rules"][0]["rule_id"] == "OFF-010"       # CRITICAL first


def test_negative_status_refers(settings):
    result = run(settings, {**ALL_GOOD, "status": "Negative"}, mode="OFFICE")
    rules = by_key(result)
    assert rules["RULE_01"]["status"] == "ISSUE"
    assert rules["RULE_10"]["status"] == "ISSUE"
    assert "status is negative while final_status is Approved" in rules["RULE_10"]["finding"]
    assert result["overall_recommendation"] == "REFER"
    assert result["overall_criticality"] == "CRITICAL"


def test_medium_issue_reviews(settings):
    result = run(settings, {**ALL_GOOD, "neighbour_check": "No"})
    assert result["overall_recommendation"] == "REVIEW"
    assert result["overall_criticality"] == "MEDIUM"


def test_community_context_never_drives_the_outcome(settings):
    result = run(settings, {**ALL_GOOD, "community_dominated": "Yes"})
    rule = by_key(result)["RULE_07"]
    assert rule["status"] == "ISSUE" and rule["risk_contribution"] is False
    assert rule["recommended_action"].startswith("Record as context only.")
    assert result["overall_recommendation"] == "PASS"
    assert result["rules_triggered"] == 1


def test_waived_is_pending_not_pass(settings):
    result = run(settings, {**ALL_GOOD, "final_status": "Waived"})
    assert by_key(result)["RULE_09"]["status"] == "PENDING"
    assert result["overall_recommendation"] == "PENDING"
    assert result["overall_criticality"] == "PENDING"


def test_missing_values_are_pending(settings):
    result = run(settings, {})
    assert {r["status"] for r in result["rules"]} <= {"PENDING", "NOT_APPLICABLE"}
    assert result["overall_recommendation"] == "PENDING"


def test_corrected_address_compared_after_normalisation(settings):
    same = run(settings, {**ALL_GOOD, "corrected_address": "12, SAMPLE ROAD, Testcity"})
    assert by_key(same)["RULE_08"]["status"] == "PASS"
    other = run(settings, {**ALL_GOOD, "corrected_address": "99 Other Lane"})
    assert by_key(other)["RULE_08"]["status"] == "ISSUE"
    assert other["overall_recommendation"] == "REFER"
    missing = run(settings, {**ALL_GOOD, "corrected_address": "99 Other Lane"}, declared=None)
    assert by_key(missing)["RULE_08"]["status"] == "PENDING"


def test_vendor_keys_are_case_insensitive(settings):
    result = run(settings, {"STATUS": "verified", "Final_Status": "approved"})
    assert by_key(result)["RULE_01"]["status"] == "PASS"
    assert by_key(result)["RULE_09"]["status"] == "PASS"


def test_rule_configs_override_defaults(settings):
    configs = settings.default_rules("RESIDENCE")
    configs["RULE_02"].update(enabled=False)
    configs["RULE_06"].update(criticality="high", weight=7)
    result = run(settings, {**ALL_GOOD, "name_plate_visible": "No"}, rule_configs=configs)
    rules = by_key(result)
    assert "RULE_02" not in rules
    assert rules["RULE_06"]["criticality"] == "HIGH" and rules["RULE_06"]["weight"] == 7
    assert result["overall_recommendation"] == "REFER"


def test_risk_score_when_enabled(settings):
    scoring = {**settings.scoring, "risk_score_enabled": True, "risk_score_max": 25}
    result = run(settings, {**ALL_GOOD, "negative_area": "Yes", "political_link": "Yes"}, scoring=scoring)
    assert result["risk_score"] == 25                        # 20 + 10, capped at 25


def test_unknown_mode_is_rejected(settings):
    with pytest.raises(ValueError):
        run(settings, ALL_GOOD, mode="SHOP")


# ------------------------------------------------------------------------------------------- seed == conf
def test_seed_migration_matches_conf_defaults(settings):
    seed = dict((v, sql) for v, _d, sql in MIGRATIONS)["rov-0002"]
    for table, mode in (("residence_rule_configs", "RESIDENCE"), ("office_rule_configs", "OFFICE")):
        block = seed.split(f"INSERT INTO {table}")[1].split("ON CONFLICT")[0]
        rows = re.findall(r"\('(\w+)', '([\w-]+)', '([^']+)', (TRUE|FALSE), '(\w+)', (\d+)\)", block)
        seeded = {k: {"rule_id": rid, "name": n, "enabled": e == "TRUE", "criticality": c, "weight": int(w)}
                  for k, rid, n, e, c, w in rows}
        assert seeded == settings.rules[mode]


def test_migrations_are_unqualified():
    for _version, _description, sql in MIGRATIONS:
        assert "verification_agent" not in sql
        assert "CREATE SCHEMA" not in sql
