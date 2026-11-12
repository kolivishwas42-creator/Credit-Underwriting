"""The use cases with a fake repository and a fake extractor (no database, no files, no network)."""

from __future__ import annotations

import pytest

from agents.collateral_verification.service import CollateralVerificationService, InvalidRequest, NotFound
from agents.collateral_verification.tests.fakes import FakeExtractor, FakeRepository
from agents.collateral_verification.tests.fixtures.samples import REPORT_TEXT, record


def _service(**kwargs) -> tuple[CollateralVerificationService, FakeRepository]:
    rec = record()
    repo = FakeRepository({rec["application_number"]: rec}, **kwargs)
    return CollateralVerificationService(repo, FakeExtractor()), repo


def test_verify_returns_the_full_result_and_stores_the_run():
    service, repo = _service()
    result = service.verify(None, "TEST-APP-0501", " Approved ", "report.txt", REPORT_TEXT.encode())
    assert result["application_id"] == 501
    assert result["data_source"] == "postgres"
    assert result["vendor_final_status"] == "approved"
    assert result["report_file"] == "report.txt"
    assert result["summary"]["overall"] == "PASS"
    assert result["summary"]["vendor_status_conflict"] is False
    assert set(result["source_evidence"]) == {"debtor_search", "security_interest", "asset_owner_evidence",
                                              "header_owner", "property_address", "raw_extracted_text",
                                              "borrower_asset_owner_rows"}
    assert result["run_id"] == "run-1"
    assert repo.saved[0]["application_number"] == "TEST-APP-0501"


def test_verify_by_application_id():
    service, _ = _service()
    assert service.verify("501", None, "rejected", "r.txt", REPORT_TEXT.encode())["summary"]["vendor_status_conflict"]


def test_verify_still_answers_when_storing_fails():
    service, repo = _service()
    repo.fail_save = True
    result = service.verify(None, "TEST-APP-0501", "approved", "r.txt", REPORT_TEXT.encode())
    assert "run_id" not in result
    assert result["summary"]["overall"] == "PASS"


@pytest.mark.parametrize("app_id,app_no,status,error,message", [
    (None, "TEST-APP-0501", "maybe", InvalidRequest, "final_status must be one of: approved, rejected"),
    (None, None, "approved", InvalidRequest, "application_id or application_number is required"),
    (None, "NOPE", "approved", NotFound, "No collateral record for that application"),
])
def test_verify_rejects_bad_requests(app_id, app_no, status, error, message):
    service, _ = _service()
    with pytest.raises(error, match=message):
        service.verify(app_id, app_no, status, "r.txt", b"x")


def test_verify_needs_a_collateral_property():
    service, repo = _service()
    repo.records["TEST-APP-0501"]["properties"] = []
    with pytest.raises(InvalidRequest, match="Application has no collateral property"):
        service.verify(None, "TEST-APP-0501", "approved", "r.txt", b"x")


def test_start_migrates_and_database_configuration_replaces_the_defaults():
    service, repo = _service()
    repo.rules = {"rule_1_owner_name": {"enabled": False, "label": "Owner"}}
    repo.settings = {"NAME_MATCH_THRESHOLD": {"setting_value": "0.5", "value_type": "number"},
                     "VENDOR_FINAL_STATUSES": {"setting_value": '["approved"]', "value_type": "json"},
                     "UNKNOWN_KEY": {"setting_value": "x", "value_type": "string"}}
    service.start()
    assert repo.ready_calls == 1
    cfg = service.config_view()
    assert cfg["rules"] == {"rule_1_owner_name": {"enabled": False, "label": "Owner"}}
    assert cfg["name_match_threshold"] == 0.5
    assert cfg["vendor_final_statuses"] == ["approved"]
    assert service.health() == {"ok": True, "version": "1.1.0", "database_configured": True, "rules_count": 1}


def test_without_a_database_the_conf_defaults_are_used():
    service, repo = _service(configured=False)
    service.start()
    assert repo.ready_calls == 0
    cfg = service.config_view()
    assert cfg["database_configured"] is False
    assert cfg["completion_tolerance_pp"] == 10
    assert cfg["rules"]["rule_9_completion_percent"]["tolerance_pp"] == 10
    assert len(cfg["rules"]) == 9


def test_rule_and_setting_updates_reload_the_configuration():
    service, _ = _service()
    service.update_rule({"rule_id": "rule_14_unit_number", "enabled": False, "label": "Unit"}, "tester")
    assert service.rule_config.rules == {"rule_14_unit_number": {"enabled": False, "label": "Unit"}}
    service.update_settings([{"setting_key": "FLAG_VENDOR_STATUS_CONFLICT", "value": False,
                              "value_type": "boolean"}], "tester")
    assert service.rule_config.flag_vendor_status_conflict is False
    with pytest.raises(ValueError):
        service.update_rule({}, "tester")


def test_extract_only_reads_the_fields():
    service, _ = _service()
    assert service.extract_only("r.txt", REPORT_TEXT.encode())["debtor_search_pan"] == "ABCDE1234F"
