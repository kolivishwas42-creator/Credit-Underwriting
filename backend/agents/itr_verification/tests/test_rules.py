"""The rule engine and the policy (pure: no database, no files). Includes the original backend/tests cases."""

from __future__ import annotations

from dataclasses import replace

import pytest

from agents.itr_verification import config
from agents.itr_verification.rules import compare_documents, normalise_assessment_year
from agents.itr_verification.rules.engine import numeric_match
from agents.itr_verification.rules.policy import (Policy, merge_rule, parse_setting, seed_rule_rows,
                                                  seed_setting_rows, serialize_setting)

from .conftest import SYNTHETIC_FIELDS

APPLICATION = {"pan_number": " abcde1234f ", "assessment_year": "2024-2025", "gti_income": 850000}


def _fields(**changes):
    return {**SYNTHETIC_FIELDS, **changes}


# ------------------------------------------------------------------------------- the original backend/tests cases
def test_application_values_match_both_documents(policy):
    report = compare_documents(_fields(), _fields(), policy, application_data=APPLICATION, final_status="aPpRoVeD")
    by_field = {item.field: item for item in report.field_results}
    for name in ("application_pan_number_vs_input_document", "application_pan_number_vs_output_document",
                 "application_assessment_year_vs_input_document", "application_assessment_year_vs_output_document",
                 "application_gti_income_vs_input_document", "application_gti_income_vs_output_document"):
        assert by_field[name].matched, name
    assert report.vendor_final_status == "APPROVED"
    assert report.decision == "ACCEPT"
    assert report.overall_score == 100.0


def test_vendor_rejection_forces_reject(policy):
    report = compare_documents(_fields(), _fields(), policy, application_data=APPLICATION, final_status="REJECTED")
    assert report.decision == "REJECT"
    assert report.vendor_final_status == "REJECTED"
    assert report.critical_failures[0] == "vendor_final_status"
    assert report.field_results[0].field == "vendor_final_status"


def test_missing_application_values_are_not_verified(policy):
    report = compare_documents(_fields(), _fields(), policy,
                               application_data={"pan_number": None, "assessment_year": "", "gti_income": None},
                               final_status="Approved")
    checks = [x for x in report.field_results if x.field.startswith("application_")]
    assert len(checks) == 6
    assert all(not x.matched and "NOT VERIFIED" in x.message for x in checks)


def test_unknown_status_review_policy(policy):
    report = compare_documents(_fields(), _fields(), replace(policy, final_status_unknown_behaviour="review"),
                               application_data=APPLICATION, final_status="vendor-value-not-configured")
    assert report.vendor_final_status == "UNKNOWN"
    assert report.decision == "REVIEW"


# --------------------------------------------------------------------------------------------------- more rules
def test_perfect_match_without_application_data(policy):
    report = compare_documents(_fields(), _fields(), policy)
    assert (report.decision, report.overall_score, report.vendor_final_status) == ("ACCEPT", 100.0, "NOT_PROVIDED")
    assert report.mismatches == [] and report.critical_failures == []
    assert report.summary.startswith("Documents match with score 100.0%")


def test_critical_pan_mismatch_blocks_accept(policy):
    report = compare_documents(_fields(), _fields(pan="ZZZZZ9999Z"), policy)
    # 75 of 100 weight earned -> REVIEW by score; PAN is critical
    assert report.overall_score == 75.0
    assert report.decision == "REVIEW"
    assert report.critical_failures == ["pan"]


def test_critical_blocks_accept_above_threshold(policy):
    lenient = replace(policy, accept_threshold=70.0)
    report = compare_documents(_fields(), _fields(pan="ZZZZZ9999Z"), lenient)
    assert report.decision == "REVIEW"
    assert compare_documents(_fields(), _fields(pan="ZZZZZ9999Z"),
                             replace(lenient, critical_blocks_accept=False)).decision == "ACCEPT"


def test_score_below_review_threshold_rejects(policy):
    report = compare_documents(_fields(), _fields(pan="ZZZZZ9999Z", total_income=1.0), policy)
    assert report.overall_score == 50.0
    assert report.decision == "REJECT"
    assert "Critical issues: pan" in report.summary


def test_missing_on_one_side_and_both_sides(policy):
    report = compare_documents(_fields(form_number=None), _fields(), policy)
    by = {r.field: r for r in report.field_results}
    assert by["form_number"].message == "Missing on input side" and not by["form_number"].matched
    assert "filing_date" not in by                                                # not a configured rule
    both = compare_documents(_fields(status=None), _fields(status=None), policy)
    assert {r.field: r for r in both.field_results}["status"].matched


def test_fuzzy_name_tolerates_ocr_noise(policy):
    report = compare_documents(_fields(applicant_name="TEST APPLICANT"), _fields(applicant_name="TEST APPLICANTT"),
                               policy)
    assert {r.field: r for r in report.field_results}["applicant_name"].matched


def test_unknown_status_reject_and_ignore(policy):
    rejected = compare_documents(_fields(), _fields(), replace(policy, final_status_unknown_behaviour="reject"),
                                 application_data=APPLICATION, final_status=None)
    assert rejected.decision == "REJECT" and rejected.critical_failures[0] == "vendor_final_status"
    ignored = compare_documents(_fields(), _fields(), replace(policy, final_status_unknown_behaviour="ignore"),
                                application_data=APPLICATION, final_status="???")
    assert ignored.decision == "ACCEPT"
    assert "(configured to ignore)" in ignored.field_results[0].message


def test_final_status_taken_from_application_data(policy):
    report = compare_documents(_fields(), _fields(), policy, application_data={**APPLICATION, "final_status": "no"})
    assert report.vendor_final_status == "REJECTED"


def test_critical_application_mismatch_policy(policy):
    data = {**APPLICATION, "pan_number": "QQQQQ0000Q"}
    assert compare_documents(_fields(), _fields(), policy, application_data=data,
                             final_status="ok").decision == "REVIEW"
    forced = replace(policy, critical_application_mismatch_forces_reject=True)
    assert compare_documents(_fields(), _fields(), forced, application_data=data,
                             final_status="ok").decision == "REJECT"


def test_application_gti_falls_back_to_total_income(policy):
    fields = _fields(gti=None, total_income=850000.0)
    report = compare_documents(fields, fields, policy, application_data=APPLICATION, final_status="pass")
    assert {r.field: r for r in report.field_results}["application_gti_income_vs_input_document"].matched


@pytest.mark.parametrize("value, expected", [("2024-25", "2024-25"), ("2024-2025", "2024-25"), ("2024 – 25", "2024-25"),
                                             ("2099-00", "2099-00"), ("2024-26", None), ("", None), (None, None),
                                             ("abc", None)])
def test_assessment_year_normalisation(value, expected):
    assert normalise_assessment_year(value) == expected


def test_numeric_match_tolerance():
    assert numeric_match(100, 100, 0) == (True, 100.0)
    assert numeric_match(100, 101, 0) == (False, 0.0)
    assert numeric_match(100, 101, 1.0) == (True, 100.0)
    matched, score = numeric_match(100, 110, 1.0)
    assert not matched and score == pytest.approx(100 - (10 / 110 * 100) * 2)
    assert numeric_match("x", 1, 0) == (False, 0.0)


# ------------------------------------------------------------------------------------------------------- policy
def test_policy_defaults_match_conf():
    p = Policy.from_conf(config.rules_conf())
    assert (p.accept_threshold, p.review_threshold, p.fuzzy_name_threshold) == (90.0, 70.0, 0.85)
    assert p.critical_blocks_accept and p.vendor_rejection_forces_reject
    assert not p.critical_application_mismatch_forces_reject
    assert p.final_status_unknown_behaviour == "review"
    assert all(isinstance(v, str) for v in p.final_status_approved_values + p.final_status_rejected_values)
    assert [r["field"] for r in p.comparison_rules] == ["pan", "assessment_year", "total_income",
                                                         "acknowledgement_number", "applicant_name", "form_number",
                                                         "status"]


def test_policy_overlay_from_rows(policy):
    rows = [{"category": "comparison", "field": "pan", "enabled": True, "weight": 10.0, "match_type": "exact",
             "tolerance_pct": 0.0, "severity": "critical", "description": "only pan"}]
    settings = [{"setting_key": "ACCEPT_THRESHOLD", "parsed_value": 95.0},
                {"setting_key": "UNRELATED", "parsed_value": "x"}]
    p = policy.with_rows(rows, settings)
    assert [r["field"] for r in p.comparison_rules] == ["pan"]
    assert p.application_rules == policy.application_rules        # none stored -> defaults kept
    assert p.accept_threshold == 95.0


def test_seed_rows_round_trip_to_the_same_policy(policy):
    conf = config.rules_conf()
    rule_rows = seed_rule_rows(conf)
    setting_rows = [{**s, "parsed_value": parse_setting(s["setting_value"], s["value_type"])}
                    for s in seed_setting_rows(conf)]
    loaded = policy.with_rows(rule_rows, setting_rows)
    # a stored application rule always carries tolerance_pct (0.0 when the default omits it)
    expected = {k: {"tolerance_pct": 0.0, **v} for k, v in policy.application_rules.items()}
    assert loaded == replace(policy, application_rules=expected)


def test_setting_codec():
    assert serialize_setting(90.0, "number") == "90.0"
    assert serialize_setting(True, "boolean") == "true" and serialize_setting("no", "boolean") == "false"
    assert serialize_setting(["a", "b"], "json") == '["a", "b"]'
    assert parse_setting("90.5", "number") == 90.5 and parse_setting("abc", "number") == "abc"
    assert parse_setting("Y", "boolean") is True and parse_setting("0", "boolean") is False
    assert parse_setting('["x"]', "json") == ["x"] and parse_setting(None, "json") is None


def test_merge_rule():
    with pytest.raises(ValueError):
        merge_rule(None, {"category": "", "field": "pan"})
    new = merge_rule(None, {"category": "comparison", "field": "x", "weight": 3})
    assert new["weight"] == 3 and new["match_type"] == "exact" and new["enabled"] is True
    existing = {**new, "severity": "high"}
    merged = merge_rule(existing, {"category": "comparison", "field": "x", "enabled": False})
    assert merged["severity"] == "high" and merged["enabled"] is False and merged["weight"] == 3
