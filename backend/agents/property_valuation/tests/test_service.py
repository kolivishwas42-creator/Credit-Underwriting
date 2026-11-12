"""The use cases over a fake repository (no database)."""

from __future__ import annotations

import pytest

from agents.property_valuation.service import InvalidRequestError, NotFoundError, PropertyValuationService
from agents.property_valuation.tests import samples as s
from agents.property_valuation.tests.fakes import FakeRepository


def submission(**vendor_changes):
    return {"collateral_property_id": s.PROPERTY_ID, "vendor_name": "Synthetic Vendor",
            "verification_type": "REVISIT", "submitted_data": dict(s.SUBMITTED),
            "vendor_response": s.vendor(**vendor_changes), "verified_at": "2026-10-22T10:00:00Z"}


@pytest.fixture
def repo():
    return FakeRepository()


@pytest.fixture
def service(repo):
    return PropertyValuationService(repo)


def test_application_context_with_prefill(service):
    ctx = service.application("  " + s.APPLICATION_NUMBER + " ")
    assert ctx["application_id"] == s.APPLICATION_ID
    assert ctx["applicant_name"] == "Test Applicant One"
    assert len(ctx["properties"]) == 1
    assert ctx["properties"][0]["vendor_request_prefill"]["Flat No./House No."] == "12A"


def test_unknown_application(service):
    with pytest.raises(NotFoundError, match="no property is linked"):
        service.application("NOPE")
    with pytest.raises(NotFoundError, match="^Application number not found.$"):
        service.history("NOPE")


def test_submit_stores_visit_and_result(service, repo):
    out = service.submit_valuation(s.APPLICATION_NUMBER, s.PROPERTY_ID,
                                   submission(**{"Current Property Owner": "Someone Else"}))
    assert (out["verification_id"], out["result_id"]) == (1, 1)
    assert out["vendor_status"] == "POSITIVE"
    assert out["summary"]["agent_status"] == "HIGH_RISK"
    assert out["evaluation"]["reference_id"] == f"APP-{s.APPLICATION_ID}-PROP-{s.PROPERTY_ID}"

    visit, result = repo.visits[0], repo.outcomes[0]
    assert visit["vendor_name"] == "Synthetic Vendor" and visit["verification_type"] == "REVISIT"
    assert visit["verified_at"].isoformat() == "2026-10-22T10:00:00"
    assert result["agent_version"] == "1.0.0"
    assert result["agent_status"] == "HIGH_RISK"
    assert result["critical_issues_count"] == out["summary"]["critical_issues_count"]
    assert len(repo.rule_rows) == 22                                    # seeded from conf/rules.yaml


def test_submit_defaults_and_bad_verified_at(service, repo):
    body = submission()
    body.update(vendor_name="", verification_type=None, verified_at="yesterday")
    out = service.submit_valuation(s.APPLICATION_NUMBER, s.PROPERTY_ID, body)
    assert out["summary"]["agent_status"] == "CLEAR"
    assert repo.visits[0]["vendor_name"] == "Manual Vendor Entry"
    assert repo.visits[0]["verification_type"] == "INITIAL_VISIT"
    assert repo.visits[0]["verified_at"] is None


def test_submit_validation(service):
    with pytest.raises(InvalidRequestError):
        service.submit_valuation(s.APPLICATION_NUMBER, 999, submission())
    body = submission()
    body["collateral_property_id"] = 999
    with pytest.raises(NotFoundError, match="does not belong"):
        service.submit_valuation(s.APPLICATION_NUMBER, 999, body)


def test_saved_rule_change_applies_to_the_next_run(service):
    service.update_rule("RULE_2", {"enabled": False})
    out = service.submit_valuation(s.APPLICATION_NUMBER, s.PROPERTY_ID,
                                   submission(**{"Current Property Owner": "Someone Else"}))
    assert out["summary"]["agent_status"] == "CLEAR"
    assert out["evaluation"]["rules_checked"] == 17


def test_rules_and_update(service):
    rules = service.rules()
    assert [r["rule_key"] for r in rules][:2] == ["RULE_1", "RULE_2"]
    assert set(rules[0]) == {"rule_key", "original_id", "name", "description", "enabled", "sequence", "severity",
                             "fields", "settings"}
    updated = service.update_rule("RULE_22", {"severity": "MAJOR", "settings": {"require_remarks": True}})
    assert updated["severity"] == "MAJOR" and updated["settings"] == {"require_remarks": True}
    with pytest.raises(NotFoundError, match="Rule not found."):
        service.update_rule("RULE_99", {"enabled": True})


def test_history_and_results(service):
    service.submit_valuation(s.APPLICATION_NUMBER, s.PROPERTY_ID, submission())
    service.submit_valuation(s.APPLICATION_NUMBER, s.PROPERTY_ID, submission(**{"Valuation Date": "bad"}))
    history = service.history(s.APPLICATION_NUMBER)
    assert [v["verification_id"] for v in history["verifications"]] == [2, 1]
    assert "submitted_data" not in history["verifications"][0]
    assert "total_rules_passed" not in history["agent_results"][0]
    assert service.history(s.APPLICATION_NUMBER, 12345)["verifications"] == []
    assert service.history(s.APPLICATION_NUMBER, 0)["verifications"] != []     # 0 means "every property", as before
    results = service.results(s.APPLICATION_NUMBER)
    assert [r["agent_status"] for r in results] == ["REVIEW", "CLEAR"]
    assert results[0]["total_rules_passed"] == 17
