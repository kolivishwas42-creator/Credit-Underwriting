"""The use cases with fake repository / application source / watch list (no database, no network)."""

from __future__ import annotations

import pytest

from agents.fraud_screening.config import load_settings
from agents.fraud_screening.schemas import FraudEvaluateRequest, RuleConfigUpdate
from agents.fraud_screening.service import FraudScreeningService, NotFoundError, RuleNotImplementableError
from agents.fraud_screening.tests.fakes import (SETTINGS, FakeApplications, FakeRepository, FakeWatchlist,
                                                clean_bundle)
from agents.fraud_screening.watchlist import VendorOrSampleWatchlist


def _service(repo=None, apps=None, watch=None):
    return FraudScreeningService(repo or FakeRepository(), apps or FakeApplications(), watch or FakeWatchlist(),
                                 SETTINGS)


def test_evaluate_clean_application_stores_and_returns_the_result():
    repo, watch = FakeRepository(), FakeWatchlist()
    out = _service(repo, watch=watch).evaluate(FraudEvaluateRequest(application_number="TEST-APP-0001"))
    assert out.result_id == 1 and out.application_id == 501
    assert out.risk_level == "LOW" and out.is_potential_fraud is False
    assert out.fraud_warning == ("No fraud rules triggered. Note: 5 check(s) could not run "
                                 "(missing data or disabled rules).")
    assert out.warnings == []
    assert out.aml["kind"] == "aml" and out.aml["total_records"] == 0
    assert out.pep["kind"] == "pep" and out.pep["summary"] == "No records matched this applicant."
    assert watch.calls == ["aml", "pep"]
    stored = repo.results[0]
    assert stored["application_number"] == "TEST-APP-0001" and stored["fraud_warning"] == out.fraud_warning
    assert stored["full_payload"]["primary"]["name"] == "Asha Testwala"


def test_evaluate_flagged_application_warns():
    bundle = clean_bundle()
    bundle["co_applicants"][0]["kyc"]["pan_number"] = "ABCDE1234F"
    out = _service(apps=FakeApplications(bundle)).evaluate(
        FraudEvaluateRequest(application_number="TEST-APP-0001", run_aml=False, run_pep=False))
    assert out.flagged_rules == ["Rule2_CoApp_Identity_Swap"]
    assert out.fraud_warning.startswith("FRAUD WARNING (HIGH risk): 1 rule check(s) triggered for application "
                                        "TEST-APP-0001. Review before approving.")
    assert out.warnings == ["Rule 2 [High] CoApp Identity Swap: Same PAN 'ABCDE1234F' used by primary "
                            "name='Asha Testwala' and co-app name='Vikram Fictional'"]
    assert out.aml is None and out.pep is None


def test_unknown_application_is_not_found():
    with pytest.raises(NotFoundError, match="Application 'NOPE' not found"):
        _service().evaluate(FraudEvaluateRequest(application_number="NOPE"))


def test_watchlist_failure_is_reported_inside_the_result():
    out = _service(watch=FakeWatchlist(fail=True)).evaluate(FraudEvaluateRequest(application_number="TEST-APP-0001"))
    assert out.aml == {"error": "vendor unreachable", "status": "error"}
    assert out.pep == {"error": "vendor unreachable", "status": "error"}


def test_sample_watchlist_without_vendor_url_is_marked_mock():
    settings = load_settings({})
    assert settings.aml.api_url == "" and settings.pep.api_url == ""
    service = FraudScreeningService(FakeRepository(), FakeApplications(), VendorOrSampleWatchlist(settings), settings)
    out = service.evaluate(FraudEvaluateRequest(application_number="TEST-APP-0001"))
    assert out.aml["source"] == "mock" and out.pep["source"] == "mock"


def test_latest_result_and_rules():
    service = _service()
    with pytest.raises(NotFoundError, match="No fraud result stored"):
        service.latest_result("TEST-APP-0001")
    service.evaluate(FraudEvaluateRequest(application_number="TEST-APP-0001", run_aml=False, run_pep=False))
    assert service.latest_result("TEST-APP-0001")["risk_level"] == "LOW"
    rules = service.list_rules()
    assert len(rules) == 18 and rules[0].rule_key == "Rule1_PAN_Aadhaar_Mismatch"


def test_update_rule():
    repo = FakeRepository()
    service = _service(repo)
    with pytest.raises(NotFoundError, match="Rule not found"):
        service.update_rule("NoSuchRule", RuleConfigUpdate(enabled=False))
    with pytest.raises(RuleNotImplementableError):
        service.update_rule("Rule3_Distant_Branch", RuleConfigUpdate(enabled=True))
    out = service.update_rule("Rule15_Address_Reuse", RuleConfigUpdate(enabled=False, severity="High"))
    assert out.enabled is False and out.severity == "High"
    assert repo.rules["Rule15_Address_Reuse"]["description"] == "Rule15_Address_Reuse description"   # untouched


def test_settings_from_environment():
    env = {"FRAUD_SCREENING_AML_API_URL": "https://vendor.invalid/aml", "FRAUD_SCREENING_AML_API_KEY": "k-test",
           "FRAUD_SCREENING_PEP_MATCH_THRESHOLD_PERCENT": "80", "FRAUD_SCREENING_LOAN_SCHEMA": "los_cases"}
    s = load_settings(env)
    assert s.aml.api_url == "https://vendor.invalid/aml"
    assert s.pep.headers["x-karza-key"] == "k-test"                 # PEP falls back to the AML key
    assert s.pep.match_threshold_percent == 80.0 and s.aml.match_threshold_percent == 70.0
    assert s.loan_schema == "los_cases"
    assert "k-test" not in repr(s)                                   # keys never in a repr / log line
