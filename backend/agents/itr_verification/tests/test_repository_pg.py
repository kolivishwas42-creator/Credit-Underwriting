"""The PostgreSQL repository on a THROWAWAY database of the test server (created here, dropped after): the migrations
land in schema itr_verification via LOS_AGENTIC_DSN, the defaults are seeded once, rows round-trip. Synthetic data."""

from __future__ import annotations

import uuid

import pytest

psycopg = pytest.importorskip("psycopg")

from agents.itr_verification import config  # noqa: E402
from agents.itr_verification.repository import PostgresITRRepository  # noqa: E402
from agents.itr_verification.rules.policy import (Policy, merge_rule, seed_rule_rows,  # noqa: E402
                                                  seed_setting_rows)
from agents.itr_verification.service import ITRVerificationService  # noqa: E402

from .conftest import SYNTHETIC_FIELDS, FakeExtractor, FakeResolver  # noqa: E402


@pytest.fixture()
def shared_db(monkeypatch):
    from shared.store.testing import _admin_dsn, _with_db

    admin = _admin_dsn()
    name = f"itrv_{uuid.uuid4().hex[:10]}"
    with psycopg.connect(admin, autocommit=True) as conn:
        conn.execute(f'CREATE DATABASE "{name}"')
    dsn = _with_db(admin, name)
    monkeypatch.setenv("LOS_AGENTIC_DSN", dsn)
    yield dsn
    with psycopg.connect(admin, autocommit=True) as conn:
        conn.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


def test_repository_contract_on_postgres(shared_db):
    conf = config.rules_conf()
    repo = PostgresITRRepository(seed_rule_rows(conf), seed_setting_rows(conf))
    repo.ping()

    with psycopg.connect(shared_db) as conn:
        tables = {r[0] for r in conn.execute(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'itr_verification'")}
    assert {"rule_configs", "system_settings", "verification_results", "agent_logs", "api_responses",
            "schema_migrations"} <= tables

    rules = repo.list_rules()
    assert len(rules) == 10 and {r["category"] for r in rules} == {"comparison", "application"}
    assert repo.get_setting("ACCEPT_THRESHOLD")["parsed_value"] == 90.0
    assert repo.get_setting("FINAL_STATUS_REJECTED_VALUES")["parsed_value"][-1] == "0"

    # a second repository (another process) neither re-migrates nor re-seeds
    again = PostgresITRRepository(seed_rule_rows(conf), seed_setting_rows(conf))
    assert len(again.list_rules()) == 10

    saved = repo.save_rule(merge_rule(repo.get_rule("comparison", "pan"),
                                      {"category": "comparison", "field": "pan", "weight": 30,
                                       "extra_json": {"note": "x"}}), "tester")
    assert saved["weight"] == 30.0 and saved["severity"] == "critical" and saved["extra_json"] == {"note": "x"}
    assert saved["updated_by"] == "tester" and saved["updated_at"]
    s = repo.save_setting("REVIEW_THRESHOLD", "75", "number", None, "tester")
    assert s["parsed_value"] == 75.0 and s["description"]          # description kept when not given

    svc = ITRVerificationService(repo, FakeResolver(), FakeExtractor(), Policy.from_conf(conf),
                                 config.extraction_settings())
    assert svc.policy().review_threshold == 75.0
    report = svc.verify_fields({"input_fields": SYNTHETIC_FIELDS, "output_fields": SYNTHETIC_FIELDS,
                                "pan_number": "abcde1234f"})
    row = repo.get_result(report["run_id"])
    assert row["decision"] == "ACCEPT" and row["input_fields"]["pan"] == "ABCDE1234F"
    assert isinstance(row["field_results"], list) and row["created_at"]
    assert [r["run_id"] for r in repo.list_results(10, 0, decision="accept")] == [report["run_id"]]
    assert repo.list_results(10, 0, pan_number="none") == []
    assert repo.get_result("absent") is None
