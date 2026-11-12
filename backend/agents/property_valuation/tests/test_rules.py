"""The rule engine, the field mapping and the summary: pure functions, synthetic data."""

from __future__ import annotations

import pytest

from agents.property_valuation.config import settings
from agents.property_valuation.rules import (build_agent_summary, build_rule_inputs, build_vendor_request,
                                             evaluate_property_records, normalize_vendor_status)
from agents.property_valuation.rules import engine
from agents.property_valuation.tests import samples as s


def run(vendor_response, rule_configs=None):
    st = settings()
    registration, valuation = build_rule_inputs(s.property_row(), "Test Applicant One", "AAAAA0000A", s.SUBMITTED,
                                                vendor_response)
    return evaluate_property_records("REF", registration, valuation, rule_configs=rule_configs,
                                     default_rules=st.rules, default_settings=st.engine)


def triggered(evaluation):
    return [r["rule_id"] for r in evaluation["results"] if r["triggered"]]


def test_catalogue_has_22_rules_with_four_disabled():
    rules = settings().rules
    assert len(rules) == 22
    assert sorted(k for k, r in rules.items() if not r["enabled"]) == ["RULE_1", "RULE_17", "RULE_7", "RULE_9"]
    assert rules["RULE_20"]["settings"]["tolerance_percent"] == 5.0


def test_consistent_report_passes_every_enabled_rule():
    evaluation = run(s.vendor())
    assert evaluation["rules_checked"] == 18
    assert evaluation["rules_triggered"] == 0
    assert evaluation["registration_source"] == "LOS Property Record"
    assert evaluation["valuation_source"] == "Vendor Valuation Report"
    assert [r["rule_number"] for r in evaluation["results"]] == sorted(r["rule_number"] for r in evaluation["results"])
    assert build_agent_summary(evaluation)["agent_status"] == "CLEAR"


def test_owner_mismatch_is_critical():
    evaluation = run(s.vendor(**{"Current Property Owner": "Someone Else"}))
    assert triggered(evaluation) == ["PROP-013"]
    summary = build_agent_summary(evaluation)
    assert summary["agent_status"] == "HIGH_RISK"
    assert summary["critical_issues_count"] >= 1


def test_market_value_within_tolerance_passes_and_outside_triggers():
    # land 1000 x 1500 + built-up 800 x 1200 = 2,460,000; tolerance 5 %
    assert "PROP-044" not in triggered(run(s.vendor(**{"Current Market Value": 2_560_000,
                                                       "Value to be Considered": 2_560_000})))
    assert "PROP-044" in triggered(run(s.vendor(**{"Current Market Value": 2_600_000,
                                                   "Value to be Considered": 2_600_000})))


def test_saved_rule_settings_override_the_catalogue():
    vendor = s.vendor(**{"Current Market Value": 2_600_000, "Value to be Considered": 2_600_000})
    loose = {"RULE_20": {"settings": {"tolerance_percent": 10.0, "flag_missing_fields": True,
                                      "flag_negative_values": True, "calculate_land_value": True,
                                      "calculate_construction_value": True}}}
    assert "PROP-044" not in triggered(run(vendor, loose))


def test_disabled_rule_and_severity_override():
    vendor = s.vendor(**{"Valuation Date": "not a date"})
    assert triggered(run(vendor)) == ["PROP-046"]
    assert build_agent_summary(run(vendor))["agent_status"] == "REVIEW"
    assert triggered(run(vendor, {"RULE_22": {"enabled": False}})) == []
    raised = run(vendor, {"RULE_22": {"severity": "CRITICAL"}})
    assert raised["results"][-1]["severity"] == "CRITICAL"
    assert build_agent_summary(raised)["agent_status"] == "HIGH_RISK"


def test_evaluation_restores_the_module_configuration():
    run(s.vendor())
    assert engine.PROPERTY_RULES == {} and engine.PROPERTY_RULE_SETTINGS == {}


def test_summary_counts_and_actions():
    evaluation = run(s.vendor(**{"Current Market Value": 1_000_000}))
    summary = build_agent_summary(evaluation)
    assert summary["total_rules_checked"] == 18
    assert summary["total_rules_triggered"] == 2
    assert summary["total_rules_passed"] == 16
    assert {f["category"] for f in summary["risk_factors"]} == {"PROP-044", "PROP-045"}
    assert len(summary["recommended_actions"]) == 2
    assert all(i["severity"] == "CRITICAL" for i in summary["key_insights"])


@pytest.mark.parametrize("response, expected", [
    ({"Final Status": "Positive"}, "POSITIVE"), ({"status": " refer "}, "REFER"), ({}, None), ({"Status": "odd"}, "ODD"),
])
def test_vendor_status(response, expected):
    assert normalize_vendor_status(response) == expected


def test_vendor_request_prefill():
    prefill = build_vendor_request(s.property_row(), "Test Applicant One")
    assert prefill["Complete Property Address"] == s.ADDRESS
    assert prefill["Property Documents Provided"] == "Yes"
    assert prefill["Copy Of Latest Deed provided"] is True
    assert prefill["Approved Map"] is False


def test_rule_inputs_carpet_area_and_key_variants():
    _reg, val = build_rule_inputs(s.property_row(), "A", None, {}, {"carpet_area": 700, "Carpet Area Unit": "Sq Ft",
                                                                    "house no / flat": "9"})
    assert val["Carpet area in sq.ft"] == 700
    assert val["House no / Flat no"] == "9"
    _reg, val = build_rule_inputs(s.property_row(), "A", None, {}, {"Carpet Area": 70, "Carpet Area Unit": "sq m"})
    assert val["Carpet area in sq.ft"] == ""
