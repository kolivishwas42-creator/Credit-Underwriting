"""API smoke test: the router in a bare FastAPI app, the service overridden with fakes (no database)."""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agents.collateral_verification.api import PREFIX, get_service, router
from agents.collateral_verification.service import CollateralVerificationService
from agents.collateral_verification.tests.fakes import FakeExtractor, FakeRepository
from agents.collateral_verification.tests.fixtures.samples import REPORT_TEXT, record


@pytest.fixture()
def client() -> TestClient:
    rec = record()
    service = CollateralVerificationService(FakeRepository({rec["application_number"]: rec}), FakeExtractor())
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_service] = lambda: service
    return TestClient(app)


def test_health_and_config(client):
    assert client.get(f"{PREFIX}/health").json()["ok"] is True
    body = client.get(f"{PREFIX}/config").json()
    assert body["vendor_final_statuses"] == ["approved", "rejected"]


def test_verify_round_trip(client):
    response = client.post(f"{PREFIX}/collateral/verify",
                           data={"final_status": "approved", "application_number": "TEST-APP-0501"},
                           files={"report": ("report.txt", REPORT_TEXT.encode(), "text/plain")})
    assert response.status_code == 200
    body = response.json()
    assert body["summary"]["overall"] == "PASS"
    assert body["run_id"] == "run-1"
    assert client.get(f"{PREFIX}/results").json()[0]["application_number"] == "TEST-APP-0501"


def test_verify_errors(client):
    assert client.post(f"{PREFIX}/collateral/verify", data={"final_status": "approved"}).status_code == 422
    missing = client.post(f"{PREFIX}/collateral/verify", data={"final_status": "approved", "application_number": "X"},
                          files={"report": ("r.txt", b"text", "text/plain")})
    assert missing.status_code == 404
    bad = client.post(f"{PREFIX}/collateral/verify", data={"final_status": "x", "application_number": "X"},
                      files={"report": ("r.txt", b"text", "text/plain")})
    assert bad.status_code == 422


def test_rules_and_settings_endpoints(client):
    row = client.put(f"{PREFIX}/rules", json={"rule_id": "rule_pan", "enabled": False}).json()
    assert row["rule_id"] == "rule_pan" and row["enabled"] is False
    assert client.put(f"{PREFIX}/rules", json={"rule_id": ""}).status_code == 400
    assert client.post(f"{PREFIX}/rules/reload").json()["status"] == "ok"
    saved = client.put(f"{PREFIX}/settings/bulk", json={"settings": [
        {"setting_key": "COMPARE_PIN", "parsed_value": True, "value_type": "boolean"}]}).json()
    assert saved[0]["setting_value"] == "true"
    assert client.get(f"{PREFIX}/settings").status_code == 200


def test_extract_only(client):
    response = client.post(f"{PREFIX}/collateral/extract-only",
                           files={"file": ("r.txt", REPORT_TEXT.encode(), "text/plain")})
    assert response.status_code == 200
    assert response.json()["pincode"] == "411001"
