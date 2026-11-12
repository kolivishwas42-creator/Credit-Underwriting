"""Field parsing over synthetic text, the document stores (no network), and the migrations' SQL."""

from __future__ import annotations

import pytest

from agents.itr_verification import config
from agents.itr_verification.db.schema import MIGRATIONS
from agents.itr_verification.extractors import DocumentExtractor, parse_fields
from agents.itr_verification.storage import build_resolver
from agents.itr_verification.storage.base import DocumentNotFound
from agents.itr_verification.storage.dms import DMSResolver
from agents.itr_verification.storage.local import LocalResolver
from agents.itr_verification.storage.s3 import split_s3_id

SETTINGS = config.extraction_settings()


def test_gti_is_extracted_separately_from_total_income():
    fields = parse_fields("Gross Total Income 8,50,000\nTotal Income 7,80,000\n"
                          "PAN: ABCDE1234F\nAssessment Year: 2024-25", SETTINGS)
    assert fields["gti"] == 850000.0
    assert fields["total_income"] == 780000.0


def test_parse_fields_synthetic_acknowledgement():
    text = ("INDIAN INCOME TAX RETURN ACKNOWLEDGEMENT\nAssessment Year 2024-2025\nName: TEST APPLICANT\n"
            "PAN: abcde1234f\nForm Number: ITR-1\nStatus: Individual\n"
            "e-Filing Acknowledgement Number: 123456789012345\nTotal Income 7,80,000\n"
            "electronically transmitted on 15-07-2024")
    fields = parse_fields(text, SETTINGS)
    assert fields["pan"] == "ABCDE1234F"
    assert fields["assessment_year"] == "2024-25"
    assert fields["acknowledgement_number"] == "123456789012345"
    assert fields["applicant_name"] == "TEST APPLICANT"
    assert fields["form_number"] == "ITR-1" and fields["status"] == "Individual"
    assert fields["total_income"] == fields["gti"] == 780000.0
    assert fields["filing_date"] == "15-07-2024"
    assert set(SETTINGS.extract_fields) <= set(fields)


def test_parse_fields_nothing_found():
    fields = parse_fields("", SETTINGS)
    assert all(v is None for v in fields.values())


def test_extractor_refuses_a_missing_document():
    with pytest.raises(FileNotFoundError):
        DocumentExtractor(SETTINGS).extract("Z:/no/such/dir/itr.pdf")


def test_local_store_needs_configuration_and_stays_in_its_folder(tmp_path):
    with pytest.raises(ValueError, match="ITR_VERIFICATION_LOCAL_INPUT_DIR"):
        LocalResolver("", "")
    (tmp_path / "in").mkdir()
    (tmp_path / "out").mkdir()
    store = LocalResolver(str(tmp_path / "in"), str(tmp_path / "out"))
    with pytest.raises(ValueError, match="Invalid document id"):
        store.resolve("../out/x.pdf", "input")
    with pytest.raises(DocumentNotFound):
        store.resolve("absent.pdf", "output")


def test_build_resolver_by_source(monkeypatch):
    monkeypatch.setenv("ITR_VERIFICATION_DOCUMENT_SOURCE", "ftp")
    with pytest.raises(ValueError, match="Unknown document source"):
        build_resolver(config.storage_settings())
    monkeypatch.setenv("ITR_VERIFICATION_DOCUMENT_SOURCE", "DMS")
    assert isinstance(build_resolver(config.storage_settings()), DMSResolver)


def test_s3_ids():
    assert split_s3_id("s3://bucket-a/path/x.pdf", "") == ("bucket-a", "path/x.pdf")
    assert split_s3_id("path/x.pdf", "bucket-b") == ("bucket-b", "path/x.pdf")
    with pytest.raises(ValueError):
        split_s3_id("x.pdf", "")


def test_dms_urls_and_download(tmp_path):
    class Response:
        def __init__(self, status, content=b""):
            self.status_code, self.content = status, content

        def raise_for_status(self):
            if self.status_code >= 400:
                raise RuntimeError(self.status_code)

    class Client:
        def __init__(self):
            self.calls = []

        def get(self, url, headers, timeout):
            self.calls.append((url, headers))
            return Response(404) if "missing" in url else Response(200, b"synthetic")

    client = Client()
    dms = DMSResolver("https://dms.invalid/api/", "k", temp_dir=str(tmp_path), client=client)
    assert dms.download_url("42") == "https://dms.invalid/api/documents/42/download"
    assert dms.download_url("https://other.invalid/f.png") == "https://other.invalid/f.png"
    doc = dms.resolve("42", "input")
    assert doc.temporary and doc.path.read_bytes() == b"synthetic" and doc.path.suffix == ".pdf"
    assert client.calls[0][1] == {"Authorization": "Bearer k"}
    with pytest.raises(DocumentNotFound):
        dms.resolve("missing", "output")
    with pytest.raises(ValueError):
        DMSResolver("").download_url("42")


def test_migrations_are_unqualified_and_ordered():
    versions = [v for v, _, _ in MIGRATIONS]
    assert versions == sorted(versions) and len(set(versions)) == len(versions)
    sql = "\n".join(s for _, _, s in MIGRATIONS)
    assert "ITR_Verification" not in sql and "itr_verification." not in sql.lower()
    for table in ("rule_configs", "system_settings", "verification_results", "agent_logs", "api_responses"):
        assert f"CREATE TABLE {table}" in sql or f"CREATE TABLE IF NOT EXISTS {table}" in sql
