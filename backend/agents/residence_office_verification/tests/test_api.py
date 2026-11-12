"""API smoke test: the router in a test app, the service on a fake repository (no database, no token)."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from agents.residence_office_verification.api import get_service, router
from agents.residence_office_verification.repository import RepositoryUnavailable
from agents.residence_office_verification.service import ResidenceVerificationService

from .conftest import FakeRepository

BASE = "/api/v1/credit/residence-office-verification"


def client(repo, settings) -> TestClient:
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_service] = lambda: ResidenceVerificationService(repo, settings)
    return TestClient(app)


def test_verification_and_rule_configs(settings, sample_request):
    repo = FakeRepository(settings)
    c = client(repo, settings)

    res = c.post(f"{BASE}/residence-verification", json=sample_request)
    assert res.status_code == 200
    assert res.json()["overall_recommendation"] == "PASS" and res.json()["result_id"] == 1

    res = c.get(f"{BASE}/rule-configs", params={"verification_type": "office"})
    assert res.status_code == 200 and res.json()["verification_type"] == "OFFICE"

    res = c.put(f"{BASE}/rule-configs", json={"verification_type": "RESIDENCE",
                                              "rules": [{"rule_key": "RULE_10", "enabled": True}]})
    assert res.status_code == 200 and res.json()["updated_count"] == 1

    assert c.get(f"{BASE}/rule-configs", params={"verification_type": "SHOP"}).status_code == 422
    assert c.post(f"{BASE}/residence-verification", json={**sample_request, "extra": 1}).status_code == 422
    assert c.post(f"{BASE}/residence-verification",
                  json={**sample_request, "application_id": 5}).status_code == 404


def test_database_down_is_503_without_details(settings, sample_request):
    class Down(FakeRepository):
        def fetch_application(self, application_id):
            raise RepositoryUnavailable("OperationalError")

    res = client(Down(settings), settings).post(f"{BASE}/residence-verification", json=sample_request)
    assert res.status_code == 503
    assert "OperationalError" not in res.json()["detail"]
