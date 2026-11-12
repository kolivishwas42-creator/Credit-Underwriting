"""API smoke test: the router in its own FastAPI app, the service on a fake repository (no database)."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from agents.property_valuation.api import PREFIX, get_service, router
from agents.property_valuation.service import PropertyValuationService
from agents.property_valuation.tests import samples as s
from agents.property_valuation.tests.fakes import FakeRepository


def client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    repo = FakeRepository()
    app.dependency_overrides[get_service] = lambda: PropertyValuationService(repo)
    return TestClient(app)


def test_prefix():
    assert PREFIX == "/api/v1/credit/property-valuation"


def test_valuation_round_trip():
    c = client()
    r = c.get(f"{PREFIX}/applications/{s.APPLICATION_NUMBER}")
    assert r.status_code == 200
    assert r.json()["properties"][0]["vendor_request_prefill"]["Applicant Name"] == "Test Applicant One"

    body = {"collateral_property_id": s.PROPERTY_ID, "submitted_data": s.SUBMITTED, "vendor_response": s.vendor()}
    r = c.post(f"{PREFIX}/applications/{s.APPLICATION_NUMBER}/properties/{s.PROPERTY_ID}/valuation", json=body)
    assert r.status_code == 200, r.text
    out = r.json()
    assert set(out) == {"verification_id", "result_id", "vendor_status", "summary", "evaluation"}
    assert out["summary"]["agent_status"] == "CLEAR"

    r = c.get(f"{PREFIX}/applications/{s.APPLICATION_NUMBER}/history")
    assert r.status_code == 200 and len(r.json()["verifications"]) == 1
    assert c.get(f"{PREFIX}/results/{s.APPLICATION_NUMBER}").json()[0]["result_id"] == 1


def test_errors():
    c = client()
    assert c.get(f"{PREFIX}/applications/NOPE").status_code == 404
    body = {"collateral_property_id": 1}
    r = c.post(f"{PREFIX}/applications/{s.APPLICATION_NUMBER}/properties/2/valuation", json=body)
    assert r.status_code == 400
    r = c.post(f"{PREFIX}/applications/{s.APPLICATION_NUMBER}/properties/1/valuation",
               json={**body, "unexpected": 1})
    assert r.status_code == 422
    assert c.put(f"{PREFIX}/rules/RULE_99", json={"enabled": True}).status_code == 404


def test_rules_endpoints():
    c = client()
    rules = c.get(f"{PREFIX}/rules").json()
    assert len(rules) == 22
    r = c.put(f"{PREFIX}/rules/RULE_7", json={"enabled": True, "severity": "MINOR"})
    assert r.status_code == 200 and r.json()["enabled"] is True and r.json()["severity"] == "MINOR"
    assert c.put(f"{PREFIX}/rules/RULE_7", json={"severity": "LOW"}).status_code == 422
