"""The use cases with a fake repository, resolver and extractor (no database, no network, no document files)."""

from __future__ import annotations

import pytest

from agents.itr_verification import config
from agents.itr_verification.rules.policy import Policy
from agents.itr_verification.schemas import VerifyByIdsRequest
from agents.itr_verification.service import DocumentRejected, ITRVerificationService, UploadedDocument
from agents.itr_verification.storage.base import DocumentNotFound

from .conftest import SYNTHETIC_FIELDS, FakeExtractor, FakeRepository, FakeResolver


def _request(**changes) -> VerifyByIdsRequest:
    data = {"input_doc_id": "in.pdf", "output_doc_id": "out.pdf", "pan_number": "ABCDE1234F",
            "assessment_year": "2024-25", "gti_income": 850000, "final_status": "Approved"}
    return VerifyByIdsRequest(**{**data, **changes})


def test_verify_by_ids_judges_and_keeps_the_result(service, repo, extractor):
    report = service.verify_by_ids(_request())
    assert report["decision"] == "ACCEPT" and report["vendor_final_status"] == "APPROVED"
    assert report["input_document"] == "in.pdf" and report["output_document"] == "out.pdf"
    assert extractor.calls == ["in.pdf", "out.pdf"]
    assert report["run_id"] and len(repo.results) == 1
    stored = repo.results[0]
    assert stored["run_id"] == report["run_id"]
    assert (stored["pan_number"], stored["gti_income"], stored["final_status"]) == ("ABCDE1234F", 850000, "Approved")
    assert stored["input_doc_id"] == "in.pdf" and stored["decision"] == "ACCEPT"


def test_verify_by_ids_vendor_rejected(service):
    assert service.verify_by_ids(_request(final_status="Declined"))["decision"] == "REJECT"


def test_verify_by_ids_document_not_found(service, repo):
    with pytest.raises(DocumentNotFound):
        service.verify_by_ids(_request(output_doc_id="missing.pdf"))
    assert repo.results == []


def test_temporary_documents_are_removed(repo, extractor, policy, tmp_path):
    from agents.itr_verification.storage.base import ResolvedDocument

    made = []

    class TempResolver:
        def resolve(self, identifier, side):
            path = tmp_path / f"{side}.pdf"
            path.write_bytes(b"synthetic")
            made.append(path)
            return ResolvedDocument(path, temporary=True)

    svc = ITRVerificationService(repo, TempResolver(), extractor, policy, config.extraction_settings())
    svc.verify_by_ids(_request())
    assert made and not any(p.exists() for p in made)


def test_persist_failure_never_fails_the_verification(service, repo):
    repo.fail = True
    report = service.verify_fields({"input_fields": SYNTHETIC_FIELDS, "output_fields": SYNTHETIC_FIELDS})
    assert report["decision"] == "ACCEPT" and "run_id" not in report


def test_verify_fields_requires_both_objects(service):
    with pytest.raises(ValueError):
        service.verify_fields({"input_fields": {}})


def test_verify_fields_keeps_fields_and_ignores_application(service, repo):
    out = {**SYNTHETIC_FIELDS, "total_income": 1.0}
    report = service.verify_fields({"input_fields": SYNTHETIC_FIELDS, "output_fields": out})
    assert report["decision"] == "REVIEW" and report["overall_score"] == 75.0
    assert report["output_fields"]["total_income"] == 1.0
    assert repo.results[0]["pan_number"] is None


def test_setting_change_takes_effect(service, repo):
    out = {**SYNTHETIC_FIELDS, "total_income": 1.0}
    payload = {"input_fields": SYNTHETIC_FIELDS, "output_fields": out}
    assert service.verify_fields(payload)["decision"] == "REVIEW"
    saved = service.set_setting("REVIEW_THRESHOLD", 80)
    assert saved["setting_value"] == "80" and saved["value_type"] == "number"      # type kept from the stored row
    assert service.verify_fields(payload)["decision"] == "REJECT"


def test_rule_upsert_merges_and_takes_effect(service, repo):
    saved = service.upsert_rule({"category": "comparison", "field": "total_income", "enabled": False},
                                updated_by="tester")
    assert saved["enabled"] is False and saved["weight"] == 25.0 and saved["updated_by"] == "tester"
    out = {**SYNTHETIC_FIELDS, "total_income": 1.0}
    assert service.verify_fields({"input_fields": SYNTHETIC_FIELDS, "output_fields": out})["decision"] == "ACCEPT"
    new = service.upsert_rule({"category": "comparison", "field": "filing_date", "weight": 1})
    assert new["match_type"] == "exact" and new["severity"] == "medium"
    with pytest.raises(ValueError):
        service.upsert_rule({"category": "", "field": "x"})


def test_bulk_settings(service):
    rows = service.bulk_set_settings([{"setting_key": "FINAL_STATUS_UNKNOWN_BEHAVIOUR", "parsed_value": "reject"},
                                      {"setting_key": "NEW_FLAG", "parsed_value": True, "value_type": "boolean"}])
    assert [r["parsed_value"] for r in rows] == ["reject", True]
    assert service.policy().final_status_unknown_behaviour == "reject"


def test_database_down_keeps_defaults_and_strict_reload_raises(extractor, resolver, policy):
    repo = FakeRepository()
    repo.fail = True
    svc = ITRVerificationService(repo, resolver, extractor, policy, config.extraction_settings())
    assert svc.policy() == policy
    assert svc.database_status() == "error:ConnectionError"
    with pytest.raises(ConnectionError):
        svc.reload_policy(strict=True)


def test_policy_loaded_from_the_database(extractor, resolver, policy):
    repo = FakeRepository()
    repo.save_setting("ACCEPT_THRESHOLD", "99", "number", None, "t")
    svc = ITRVerificationService(repo, resolver, extractor, policy, config.extraction_settings())
    assert svc.current_config()["accept_threshold"] == 99.0


def test_upload_validation(service):
    ok = UploadedDocument("a.pdf", b"x")
    with pytest.raises(DocumentRejected, match="Unsupported file type '.txt'"):
        service.verify_uploads(UploadedDocument("a.txt", b"x"), ok)
    with pytest.raises(DocumentRejected, match="Missing filename"):
        service.verify_uploads(ok, UploadedDocument("", b"x"))
    big = UploadedDocument("b.png", b"0" * int((config.extraction_settings().max_file_size_mb + 1) * 1024 * 1024))
    with pytest.raises(DocumentRejected, match="File too large"):
        service.verify_uploads(ok, big)


def test_upload_verification(repo, policy):
    extractor = FakeExtractor()
    svc = ITRVerificationService(repo, FakeResolver(), extractor, policy, config.extraction_settings())
    report = svc.verify_uploads(UploadedDocument("customer.PDF", b"%synthetic"),
                                UploadedDocument("vendor.png", b"synthetic"), return_raw=True)
    assert report["input_document"] == "customer.PDF" and report["output_document"] == "vendor.png"
    assert report["raw_input_text"].startswith("synthetic text of")
    assert report["decision"] == "ACCEPT" and repo.results[0]["input_doc_id"] == "customer.PDF"


def test_results(service):
    service.verify_by_ids(_request())
    service.verify_by_ids(_request(final_status="rejected"))
    assert [r["decision"] for r in service.list_results()] == ["REJECT", "ACCEPT"]
    assert len(service.list_results(decision="accept")) == 1
    assert len(service.list_results(pan_number="abcde1234f")) == 2
    run_id = service.list_results()[0]["run_id"]
    assert service.get_result(run_id)["decision"] == "REJECT"
    assert service.get_result("nope") is None
    assert isinstance(Policy.from_conf(config.rules_conf()), Policy)
