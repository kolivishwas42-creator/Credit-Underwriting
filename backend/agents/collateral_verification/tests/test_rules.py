"""The rule engine and the name matching: pure functions over synthetic data."""

from __future__ import annotations

from dataclasses import replace

import pytest

from agents.collateral_verification.config import default_rule_config
from agents.collateral_verification.extract import extract_vendor_fields
from agents.collateral_verification.rules import any_match, evaluate, join_owner, name_score, names_match, summarize
from agents.collateral_verification.tests.fixtures.samples import REPORT_TEXT, record

CFG = default_rule_config()


def _by_id(results: list[dict]) -> dict[str, dict]:
    return {r["rule_id"]: r for r in results}


def _all_enabled():
    return replace(CFG, rules={k: {**v, "enabled": True} for k, v in CFG.rules.items()})


# ----------------------------------------------------------------------------------------------------- names
def test_name_score_covers_the_shorter_name_and_ignores_honorifics():
    assert name_score("Asha Rao", "Smt Rao Asha Devi") == 1.0
    assert name_score("Asha Rao", "Meera Shah") == 0.0
    assert name_score(None, "Asha") == 0.0
    assert names_match("Mr. Asha  RAO", "asha rao", 0.8)


def test_any_match_returns_the_best_pair_and_honours_the_threshold():
    ok, left, right = any_match(["Asha Rao", "Zed Q"], ["Asha Kumari Rao"], 0.8)
    assert (ok, left, right) == (True, "Asha Rao", "Asha Kumari Rao")
    ok, _, _ = any_match(["Asha Rao Mehta"], ["Asha Shah Iyer"], 0.8)
    assert not ok


def test_join_owner_prefers_the_name_parts():
    assert join_owner({"owner_first_name": "Asha", "owner_last_name": "Rao", "property_owner": "X"}) == "Asha Rao"
    assert join_owner({"property_owner": "Ravi Rao"}) == "Ravi Rao"


# ------------------------------------------------------------------------------------------------ the rules
def test_matching_report_passes_every_enabled_rule():
    results = _by_id(evaluate(record(), extract_vendor_fields(REPORT_TEXT), CFG))
    for rid in ("rule_1_owner_name", "rule_2_ownership", "rule_3_applicant_is_owner", "rule_pan",
                "rule_13_location", "rule_14_unit_number"):
        assert results[rid]["status"] == "PASS", rid
    assert results["rule_8_construction_status"]["status"] == "SKIPPED"
    assert results["rule_8_construction_status"]["summary"] == "Disabled in config.py"
    assert "rule_17_registered_deed" not in results
    assert "cersai_charge_review" not in results
    assert summarize(list(results.values()), "approved", CFG)["overall"] == "PASS"


def test_no_vendor_fields_is_pending():
    results = _by_id(evaluate(record(), extract_vendor_fields(""), CFG))
    assert results["rule_1_owner_name"]["status"] == "PENDING"
    assert results["rule_2_ownership"]["status"] == "PENDING"
    assert results["rule_pan"]["status"] == "PENDING"
    assert results["rule_13_location"]["summary"] == "Some vendor location fields are missing: PIN, City, State"


@pytest.mark.parametrize("ownership,count,status", [
    ("Single", 1, "PASS"), ("Sole owner", 2, "REFER"), ("Joint", 1, "WARNING"), ("Joint", 3, "PASS"),
    ("Unknown", 1, "REFER"),
])
def test_ownership_against_vendor_owner_count(ownership, count, status):
    rec = record()
    rec["properties"][0]["property_ownership"] = ownership
    assert _by_id(evaluate(rec, {"owner_count": count}, CFG))["rule_2_ownership"]["status"] == status


def test_pan_uses_the_owner_pan_first_and_refers_on_mismatch():
    rec = record()
    rec["properties"][0]["owner_pan"] = "ZZZZZ9999Z"
    result = _by_id(evaluate(rec, {"debtor_search_pan": "ABCDE1234F"}, CFG))["rule_pan"]
    assert result["status"] == "REFER"
    assert result["db_value"]["selected_source"] == "Property owner PAN (database)"
    assert result["vendor_value"] == {"cersai_debtor_search_pan": "ABCDE1234F"}


def test_location_mismatch_names_the_fields():
    vendor = {"pincode": "411002", "city": "PUNE", "state": ""}
    result = _by_id(evaluate(record(), vendor, CFG))["rule_13_location"]
    assert result["status"] == "REFER"
    assert result["summary"] == "Location mismatch found in: PIN"
    assert result["detail"] == "Vendor fields missing: State"


def test_completion_percent_tolerance_when_enabled():
    cfg = _all_enabled()
    rec = record()
    rec["properties"][0]["percentage_of_completion"] = "60%"
    assert _by_id(evaluate(rec, {"completion_percent": 68.0}, cfg))["rule_9_completion_percent"]["status"] == "PASS"
    result = _by_id(evaluate(rec, {"completion_percent": 75.0}, cfg))["rule_9_completion_percent"]
    assert result["status"] == "REFER"
    assert result["summary"] == "Difference is 15 percentage points (tolerance 10)."


@pytest.mark.parametrize("db,vendor,status", [
    ("Completed", "Completed", "PASS"), ("Under construction", "Completed", "WARNING"),
    ("Completed", "Under Construction", "REFER"), ("Completed", None, "PENDING"),
])
def test_construction_status_when_enabled(db, vendor, status):
    rec = record()
    rec["properties"][0]["collateral_status"] = db
    result = _by_id(evaluate(rec, {"construction_status": vendor}, _all_enabled()))["rule_8_construction_status"]
    assert result["status"] == status


def test_unsatisfied_cersai_charge_adds_a_review_line_only_when_flagged():
    vendor = {"security_interest": {"satisfaction_status": "Not Satisfied"}}
    assert _by_id(evaluate(record(), vendor, CFG))["cersai_charge_review"]["status"] == "REFER"
    off = replace(CFG, flag_unsatisfied_cersai_charge=False)
    assert "cersai_charge_review" not in _by_id(evaluate(record(), vendor, off))


# ------------------------------------------------------------------------------------------------ summary
def _line(status: str, label: str = "L", summary: str = "S") -> dict:
    return {"status": status, "label": label, "summary": summary}


def test_summary_overall_and_vendor_conflict():
    s = summarize([_line("PASS"), _line("REFER", "Owner", "mismatch")], " Approved ", CFG)
    assert s["overall"] == "REFER"
    assert s["vendor_status_conflict"] is True
    assert s["recommended_actions"][0] == "Vendor marked approved but rule outcome is REFER."
    assert s["recommended_actions"][1] == "Owner: send back for manual review — mismatch"
    assert s["counts"] == {"PASS": 1, "REFER": 1}
    assert s["vendor_final_status"] == "approved"

    s = summarize([_line("PASS"), _line("SKIPPED")], "rejected", CFG)
    assert (s["overall"], s["vendor_status_conflict"]) == ("PASS", True)
    assert summarize([], "", CFG)["overall"] == "PENDING"
    off = replace(CFG, flag_vendor_status_conflict=False)
    assert summarize([_line("WARNING")], "approved", off)["vendor_status_conflict"] is False
