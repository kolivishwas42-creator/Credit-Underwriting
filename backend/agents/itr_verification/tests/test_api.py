"""API smoke test: the router in a test FastAPI app, the service dependency overridden with fakes."""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agents.itr_verification import api
from agents.itr_verification.api import router

from .conftest import SYNTHETIC_FIELDS

BASE = "/api/v1/credit/itr-verification"


@pytest.fixture()
def client(service):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[api.get_service] = lambda: service
    with TestClient(app) as c:
        yield c


def test_info_routes(client):
    health = client.get(f"{BASE}/health").json()
    assert health["status"] == "ok" and health["accept_threshold"] == 90.0 and health["database"] == "connected"
    cfg = client.get(f"{BASE}/config").json()
    assert cfg["review_threshold"] == 70.0 and ".pdf" in cfg["supported_file_types"]
    assert client.get(f"{BASE}/").status_code == 200


def test_verify_fields(client):
    r = client.post(f"{BASE}/verify/fields", json={"input_fields": SYNTHETIC_FIELDS, "output_fields": SYNTHETIC_FIELDS})
    assert r.status_code == 200
    body = r.json()
    assert body["decision"] == "ACCEPT" and body["run_id"]
    assert client.get(f"{BASE}/results/{body['run_id']}").json()["decision"] == "ACCEPT"
    assert client.post(f"{BASE}/verify/fields", json={"input_fields": {}}).status_code == 400


def test_verify_by_ids(client):
    payload = {"input_doc_id": "in.pdf", "output_doc_id": "out.pdf", "pan_number": "ABCDE1234F",
               "assessment_year": "2024-25", "gti_income": 850000, "final_status": "REJECTED"}
    r = client.post(f"{BASE}/verify/by-ids", json=payload)
    assert r.status_code == 200 and r.json()["decision"] == "REJECT"
    assert client.post(f"{BASE}/verify/by-ids", json={**payload, "input_doc_id": "missing.pdf"}).status_code == 404
    assert client.post(f"{BASE}/verify/by-ids", json={**payload, "gti_income": -1}).status_code == 422


def test_participants_of_an_application_number(client):
    r = client.get(f"{BASE}/applications/LOS-DUMMY-0045/participants")
    assert r.status_code == 200
    assert r.json() == {"application": {"application_id": 45, "application_number": "LOS-DUMMY-0045"},
                        "participants": [
                            {"participant_id": 101, "name": "Mr Ravi Kumar", "applicant_type": "Primary Applicant",
                             "is_primary": True},
                            {"participant_id": 102, "name": "Sita Devi", "applicant_type": "Co-Applicant",
                             "is_primary": False}]}
    assert client.get(f"{BASE}/applications/NOPE/participants").status_code == 404


def test_verify_by_ids_for_an_application_and_participant(client):
    payload = {"input_doc_id": "in.pdf", "output_doc_id": "out.pdf", "pan_number": "ABCDE1234F",
               "assessment_year": "2024-25", "gti_income": 850000, "final_status": "APPROVED",
               "application_number": "LOS-DUMMY-0045", "participant_id": 102}
    r = client.post(f"{BASE}/verify/by-ids", json=payload)
    assert r.status_code == 200
    body = r.json()
    assert (body["application_number"], body["participant_id"], body["participant_name"]) == \
        ("LOS-DUMMY-0045", 102, "Sita Devi")
    stored = client.get(f"{BASE}/results/{body['run_id']}").json()
    assert (stored["application_number"], stored["participant_id"]) == ("LOS-DUMMY-0045", 102)
    # a person who is not under that application, an unknown application, and one without the other
    assert client.post(f"{BASE}/verify/by-ids", json={**payload, "participant_id": 999}).status_code == 404
    assert client.post(f"{BASE}/verify/by-ids", json={**payload, "application_number": "NOPE"}).status_code == 404
    assert client.post(f"{BASE}/verify/by-ids", json={**payload, "participant_id": None}).status_code == 400


def test_sample_documents_are_the_local_folders_files(client, tmp_path, monkeypatch):
    from agents.itr_verification.api import get_service
    from agents.itr_verification.storage.local import LocalResolver

    (tmp_path / "in").mkdir()
    (tmp_path / "out").mkdir()
    for name in ("b.pdf", "a.pdf", "notes.txt", ".hidden.pdf"):
        (tmp_path / "in" / name).write_bytes(b"x")
    (tmp_path / "out" / "v.pdf").write_bytes(b"x")
    service = client.app.dependency_overrides[get_service]()
    monkeypatch.setattr(service, "_resolver", LocalResolver(str(tmp_path / "in"), str(tmp_path / "out")))
    assert client.get(f"{BASE}/sample-documents").json() == {"input": ["a.pdf", "b.pdf"], "output": ["v.pdf"]}


def test_sample_documents_empty_without_a_local_store(client):
    assert client.get(f"{BASE}/sample-documents").json() == {"input": [], "output": []}


def test_upload_rejects_wrong_type(client):
    files = {"input_doc": ("a.txt", b"x", "text/plain"), "output_doc": ("b.pdf", b"x", "application/pdf")}
    r = client.post(f"{BASE}/verify", files=files)
    assert r.status_code == 400 and "Unsupported file type" in r.json()["detail"]


def test_rules_and_settings(client):
    rules = client.get(f"{BASE}/rules", params={"category": "application"}).json()
    assert {r["field"] for r in rules} == {"pan_number", "assessment_year", "gti_income"}
    r = client.put(f"{BASE}/rules", json={"category": "comparison", "field": "pan", "weight": 30})
    assert r.status_code == 200 and r.json()["weight"] == 30.0
    bulk = client.put(f"{BASE}/rules/bulk", json={"rules": [{"category": "comparison", "field": "status",
                                                             "enabled": False}]})
    assert bulk.status_code == 200 and bulk.json()[0]["updated_by"] == "frontend"
    s = client.put(f"{BASE}/settings", json={"setting_key": "ACCEPT_THRESHOLD", "parsed_value": 95})
    assert s.status_code == 200 and s.json()["parsed_value"] == 95.0
    assert client.get(f"{BASE}/config").json()["accept_threshold"] == 95.0
    assert client.put(f"{BASE}/settings/bulk", json={"settings": [{"setting_key": "X", "setting_value": "1"}]}
                      ).status_code == 200
    assert any(x["setting_key"] == "X" for x in client.get(f"{BASE}/settings").json())
    assert client.post(f"{BASE}/rules/reload").json()["status"] == "ok"


def test_errors_do_not_leak_details(client, repo):
    assert client.get(f"{BASE}/results/none").status_code == 404
    repo.fail = True
    r = client.get(f"{BASE}/rules")
    assert r.status_code == 500 and r.json()["detail"] == "Failed to load rules (ConnectionError)"
    assert client.post(f"{BASE}/rules/reload").status_code == 500
    assert client.get(f"{BASE}/health").json()["database"] == "error:ConnectionError"
