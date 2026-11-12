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
