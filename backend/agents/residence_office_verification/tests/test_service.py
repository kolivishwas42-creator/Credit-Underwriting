"""The use cases over a fake repository (no database)."""

from __future__ import annotations

import pytest

from agents.residence_office_verification.schemas import ResidenceVerificationRequest
from agents.residence_office_verification.service import ResidenceVerificationService, VerificationError

from .conftest import FakeRepository


def service(repo, settings):
    return ResidenceVerificationService(repo, settings)


def test_verify_returns_snapshots_and_stores_the_run(fake_repo, settings, sample_request):
    out = service(fake_repo, settings).verify(ResidenceVerificationRequest(**sample_request))
    assert out["result_id"] == 1
    assert out["application"] == {"application_id": 1001, "application_number": "APP-TEST-1001",
                                  "stage": "SANCTION", "status": "IN_PROGRESS"}
    assert out["participant"]["name"] == "Mr Test Applicant"
    assert out["participant"]["mobile_number"] == "9999900000"
    assert out["declared_address"]["full_address"] == "12, Sample Road, Near Test Park, Testcity, Teststate, 100001"
    assert out["vendor"] == {"name": "Manual Vendor Entry", "status": "Positive", "final_status": "Approved",
                             "response_received": True}
    assert out["overall_recommendation"] == "PASS"
    mode, saved = fake_repo.saved[0]
    assert mode == "RESIDENCE" and saved["application_id"] == 1001 and saved["evaluation"]["rules_evaluated"] == 9


def test_unknown_application_and_participant_are_404(fake_repo, settings, sample_request):
    svc = service(fake_repo, settings)
    with pytest.raises(VerificationError) as err:
        svc.verify(ResidenceVerificationRequest(**{**sample_request, "application_id": 9}))
    assert err.value.status_code == 404 and err.value.detail == "Application ID was not found."
    with pytest.raises(VerificationError) as err:
        svc.verify(ResidenceVerificationRequest(**{**sample_request, "participant_id": 9}))
    assert err.value.status_code == 404
    assert fake_repo.saved == []


def test_no_matching_address_is_422_and_two_are_409(settings, sample_request):
    shop = {"address_id": 1, "participant_id": 2001, "address_type": "Shop", "full_address": "x"}
    with pytest.raises(VerificationError) as err:
        service(FakeRepository(settings, addresses=[shop]), settings).verify(
            ResidenceVerificationRequest(**sample_request))
    assert err.value.status_code == 422
    two = [{**shop, "address_type": " RESIDENCE "}, {**shop, "address_id": 2, "address_type": "permanent"}]
    with pytest.raises(VerificationError) as err:
        service(FakeRepository(settings, addresses=two), settings).verify(
            ResidenceVerificationRequest(**sample_request))
    assert err.value.status_code == 409


def test_empty_config_table_falls_back_to_conf_defaults(settings, sample_request):
    repo = FakeRepository(settings, empty_configs=True)
    out = service(repo, settings).verify(ResidenceVerificationRequest(**sample_request))
    assert out["rules_evaluated"] == 9


def test_database_rule_settings_are_used(fake_repo, settings, sample_request):
    fake_repo.configs["RESIDENCE"]["RULE_10"]["enabled"] = True
    out = service(fake_repo, settings).verify(ResidenceVerificationRequest(**sample_request))
    assert out["rules_evaluated"] == 10


def test_rule_config_list_and_update(fake_repo, settings):
    svc = service(fake_repo, settings)
    listed = svc.list_rule_configs("office")
    assert listed["verification_type"] == "OFFICE" and len(listed["rules"]) == 10
    updated = svc.update_rule_configs("OFFICE", [{"rule_key": "RULE_03", "weight": 5}])
    assert updated["updated_count"] == 1 and updated["rules"][0]["weight"] == 5
    with pytest.raises(VerificationError) as err:
        svc.update_rule_configs("OFFICE", [{"rule_key": "RULE_99", "weight": 5}])
    assert err.value.status_code == 404
