"""The repository contract on a THROWAWAY PostgreSQL (skipped unless LOS_TEST_PG_DSN is set; never a real database).

The agent's tables land in a fresh schema (search_path); the LOS case tables are created in another fresh schema named
by COLLATERAL_VERIFICATION_LOS_SCHEMA. Both schemas are dropped afterwards. Synthetic rows only.
"""

from __future__ import annotations

import os
import uuid

import pytest

from agents.collateral_verification.config import AGENT
from agents.collateral_verification.repository import PostgresCollateralRepository
from agents.collateral_verification.service import CollateralVerificationService
from agents.collateral_verification.tests.fakes import FakeExtractor
from agents.collateral_verification.tests.fixtures.samples import REPORT_TEXT

pytestmark = pytest.mark.live_pg

LOS_SQL = """
CREATE TABLE {s}.loan_applications (application_id INTEGER PRIMARY KEY, application_number TEXT);
CREATE TABLE {s}.collateral_properties (collateral_property_id INTEGER PRIMARY KEY, application_id INTEGER,
    property_owner TEXT, owner_first_name TEXT, owner_middle_name TEXT, owner_last_name TEXT, property_ownership TEXT,
    collateral_status TEXT, percentage_of_completion TEXT, pincode TEXT, city TEXT, state TEXT,
    house_flat_number TEXT, property_type TEXT);
CREATE TABLE {s}.collateral_property_documents (collateral_property_id INTEGER, document_name TEXT, file_name TEXT,
    file_path TEXT);
CREATE TABLE {s}.customers (customer_id INTEGER PRIMARY KEY, full_name TEXT, pan_number TEXT);
CREATE TABLE {s}.application_participants (participant_id INTEGER PRIMARY KEY, application_id INTEGER,
    customer_id INTEGER, applicant_type TEXT, is_primary BOOLEAN);
CREATE TABLE {s}.primary_applicant_kyc (application_id INTEGER, pan_number TEXT, first_name TEXT, middle_name TEXT,
    last_name TEXT);
INSERT INTO {s}.loan_applications VALUES (501, 'TEST-APP-0501');
INSERT INTO {s}.collateral_properties VALUES (1, 501, 'Asha Rao', 'Asha', '', 'Rao', 'Joint', 'Completed', '100',
    '411001', 'Pune', 'Maharashtra', 'B 12', 'Registered');
INSERT INTO {s}.collateral_property_documents VALUES (1, 'Sale deed', 'deed.pdf', 'x/deed.pdf');
INSERT INTO {s}.customers VALUES (1, 'Asha Rao', 'ABCDE1234F'), (2, 'Ravi Dev Rao', 'PQRSX6789Z');
INSERT INTO {s}.application_participants VALUES (1, 501, 1, 'PRIMARY', true), (2, 501, 2, 'CO_APPLICANT', false);
INSERT INTO {s}.primary_applicant_kyc VALUES (501, 'KLMNO4321P', 'Kiran', NULL, 'Rao');
"""


@pytest.fixture()
def repo(monkeypatch):
    dsn = os.getenv("LOS_TEST_PG_DSN")
    if not dsn:
        pytest.skip("LOS_TEST_PG_DSN is not set")
    from shared.db import core, pg

    agent_schema, los_schema = f"cv_{uuid.uuid4().hex[:8]}", f"cvlos_{uuid.uuid4().hex[:8]}"
    monkeypatch.setenv("COLLATERAL_VERIFICATION_DSN", dsn)
    with pg.transaction(AGENT) as conn:
        conn.execute(f"CREATE SCHEMA {agent_schema}")
        conn.execute(f"CREATE SCHEMA {los_schema}")
        conn.execute(LOS_SQL.format(s=los_schema))
    monkeypatch.setenv("COLLATERAL_VERIFICATION_DSN", core.with_schema(dsn, agent_schema))
    monkeypatch.setenv("COLLATERAL_VERIFICATION_LOS_SCHEMA", los_schema)
    try:
        yield PostgresCollateralRepository()
    finally:
        monkeypatch.setenv("COLLATERAL_VERIFICATION_DSN", dsn)
        with pg.transaction(AGENT) as conn:
            conn.execute(f"DROP SCHEMA {agent_schema} CASCADE")
            conn.execute(f"DROP SCHEMA {los_schema} CASCADE")


def test_migrate_seed_configure_verify_and_list(repo):
    service = CollateralVerificationService(repo, FakeExtractor())
    service.start()
    assert len(repo.list_rules()) == 9
    settings = {s["setting_key"]: s for s in repo.list_settings()}
    assert settings["COMPLETION_TOLERANCE_PP"]["setting_value"] == "10"
    assert settings["VENDOR_FINAL_STATUSES"]["parsed_value"] == ["approved", "rejected"]
    assert service.rule_config.rules["rule_9_completion_percent"]["tolerance_pp"] == 10.0

    record = repo.fetch_application("501", None)
    assert record["application_number"] == "TEST-APP-0501"
    assert [p["applicant_type"] for p in record["participants"]] == ["PRIMARY", "CO_APPLICANT", "PRIMARY_KYC"]
    assert record["documents"][0]["document_name"] == "Sale deed"
    assert repo.fetch_application(None, "NOPE") is None

    result = service.verify(None, "TEST-APP-0501", "approved", "r.txt", REPORT_TEXT.encode())
    assert result["summary"]["overall"] == "PASS"
    stored = repo.list_results(10, 0, "TEST-APP-0501")
    assert stored[0]["run_id"] == result["run_id"] and stored[0]["overall"] == "PASS"

    service.update_rule({"rule_id": "rule_pan", "enabled": False}, "tester")
    assert service.rule_config.rules["rule_pan"]["enabled"] is False
    row = service.update_setting("NAME_MATCH_THRESHOLD", 0.9, None, None, "tester")
    assert row["parsed_value"] == 0.9 and service.rule_config.name_match_threshold == 0.9
