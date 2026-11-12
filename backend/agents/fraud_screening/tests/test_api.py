"""API smoke test: the router in a bare FastAPI app, the service dependency overridden with fakes."""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agents.fraud_screening.api import get_service, router
from agents.fraud_screening.db.schema import MIGRATIONS
from agents.fraud_screening.service import FraudScreeningService
from agents.fraud_screening.tests.fakes import SETTINGS, FakeApplications, FakeRepository, FakeWatchlist

BASE = "/api/v1/credit/fraud-screening"


@pytest.fixture()
def client():
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    service = FraudScreeningService(FakeRepository(), FakeApplications(), FakeWatchlist(), SETTINGS)
    app.dependency_overrides[get_service] = lambda: service
    with TestClient(app) as c:
        yield c


def test_endpoints(client):
    r = client.post(f"{BASE}/fraud/evaluate", json={"application_number": "TEST-APP-0001"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["risk_level"] == "LOW" and body["result_id"] == 1 and body["aml"]["kind"] == "aml"

    assert client.post(f"{BASE}/fraud/evaluate", json={"application_number": "NOPE"}).status_code == 404
    assert client.get(f"{BASE}/fraud/results/TEST-APP-0001").json()["risk_level"] == "LOW"
    assert client.get(f"{BASE}/fraud/results/OTHER").json()["detail"] == "No fraud result stored for this application"

    rules = client.get(f"{BASE}/rules").json()
    assert len(rules) == 18
    r = client.patch(f"{BASE}/rules/Rule3_Distant_Branch", json={"enabled": True})
    assert r.status_code == 400
    r = client.patch(f"{BASE}/rules/Rule15_Address_Reuse", json={"enabled": False})
    assert r.status_code == 200 and r.json()["enabled"] is False
    assert client.patch(f"{BASE}/rules/Nope", json={"enabled": False}).status_code == 404

    # the viewer is the React app in frontend/fraud_screening; the backend serves no page
    assert client.get(f"{BASE}/ui").status_code == 404


def test_migrations_are_unqualified_and_seed_the_rules():
    versions = [m[0] for m in MIGRATIONS]
    assert versions == sorted(versions) and len(set(versions)) == len(versions)
    v1 = MIGRATIONS[0][2]
    assert "fraud_detection" not in v1 and "CREATE SCHEMA" not in v1
    assert v1.count("'Rule ") == 18
