"""Fixtures of the residence / office verification tests: synthetic data only, no database, no network."""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest

from agents.residence_office_verification.config import load_settings

FIXTURES = Path(__file__).resolve().parent / "fixtures"


@pytest.fixture
def settings():
    return load_settings()


@pytest.fixture
def sample_request() -> dict[str, Any]:
    return json.loads((FIXTURES / "sample_request.json").read_text(encoding="utf-8"))


class FakeRepository:
    """In-memory RuleRepository (synthetic LOS rows)."""

    def __init__(self, settings, *, addresses: list[dict[str, Any]] | None = None, empty_configs: bool = False):
        self.applications = {1001: {"application_id": 1001, "application_number": "APP-TEST-1001",
                                    "customer_id": 1, "stage": "SANCTION", "status": "IN_PROGRESS"}}
        self.participants = {(1001, 2001): {"participant_id": 2001, "application_id": 1001, "customer_id": 1,
                                            "applicant_type": "Primary Applicant", "applicant_category": "Individual",
                                            "is_primary": True, "salutation": "Mr", "first_name": "Test",
                                            "middle_name": None, "last_name": "Applicant",
                                            "customer_full_name": "Test Applicant",
                                            "applicant_mobile_number": None, "customer_mobile_number": "9999900000"}}
        self.addresses = addresses if addresses is not None else [
            {"address_id": 3001, "participant_id": 2001, "address_type": "Current", "full_address": None,
             "house_flat_number": "12", "address_line_1": "Sample Road", "address_line_2": None,
             "landmark_street": "Near Test Park", "city": "Testcity", "state": "Teststate", "pincode": "100001"},
        ]
        self.configs = {} if empty_configs else {m: deepcopy(settings.rules[m]) for m in ("RESIDENCE", "OFFICE")}
        self.saved: list[tuple[str, dict[str, Any]]] = []

    def fetch_application(self, application_id):
        return self.applications.get(application_id)

    def fetch_application_by_number(self, application_number):
        return next((a for a in self.applications.values() if a["application_number"] == application_number), None)

    def list_participants(self, application_id):
        return [p for (app_id, _), p in self.participants.items() if app_id == application_id]

    def fetch_participant(self, application_id, participant_id):
        return self.participants.get((application_id, participant_id))

    def fetch_participant_addresses(self, participant_id):
        return [a for a in self.addresses if a["participant_id"] == participant_id]

    def load_rule_configs(self, mode):
        return deepcopy(self.configs.get(mode.upper(), {}))

    def list_rule_configs(self, mode):
        return [{"rule_key": k, **v} for k, v in sorted(self.configs.get(mode.upper(), {}).items())]

    def bulk_update_rule_configs(self, mode, rules):
        out = []
        for item in rules:
            row = self.configs.get(mode.upper(), {}).get(item.get("rule_key"))
            if row is None:
                continue
            row.update({k: v for k, v in item.items() if k != "rule_key" and v is not None})
            out.append({"rule_key": item["rule_key"], **row})
        return out

    def save_rule_result(self, mode, **values):
        self.saved.append((mode, values))
        return len(self.saved)


@pytest.fixture
def fake_repo(settings):
    return FakeRepository(settings)
