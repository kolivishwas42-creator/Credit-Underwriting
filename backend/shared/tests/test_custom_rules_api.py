"""Custom rules for every agent (owner 2026-11-13): add, list, switch off, change the limit, delete -- every change
recorded. Runs against the TEST PostgreSQL of the session (shared.store.testing.session_dsn), never a real database."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

API = "/api/v1/rule-settings/custom"


@pytest.fixture
def db(monkeypatch):
    import psycopg

    import shared.api.custom_rules as cr
    from shared.store.testing import session_dsn

    dsn = session_dsn()
    monkeypatch.setenv("LOS_AGENTIC_DSN", dsn)
    monkeypatch.setattr(cr, "_ready", False)
    with psycopg.connect(dsn) as conn:
        conn.execute(cr.SCHEMA_SQL)
        conn.execute("DELETE FROM rule_settings.rules WHERE agent = 'eligibility'")
        conn.execute("DELETE FROM rule_settings.changes WHERE agent = 'eligibility'")
    return dsn


@pytest.fixture
def writer(make_token) -> TestClient:
    from main import app

    c = TestClient(app)
    c.headers["Authorization"] = f"Bearer {make_token(subject='officer.a', scopes='los.read los.rules.write')}"
    return c


@pytest.fixture
def reader(make_token) -> TestClient:
    from main import app

    c = TestClient(app)
    c.headers["Authorization"] = f"Bearer {make_token(subject='officer.b', scopes='los.read')}"
    return c


NEW = {"rule_id": "C_HIGH_FOIR", "name": "FOIR above 55%", "field": "FOIR", "operator": "gt", "value": 55,
       "outcome": "review", "severity": "HIGH"}


def changes(dsn):
    import psycopg

    with psycopg.connect(dsn) as conn:
        return conn.execute("SELECT rule_id, changed_by, after FROM rule_settings.changes WHERE agent = 'eligibility' "
                            "ORDER BY id").fetchall()


def test_add_list_change_delete_with_history(db, writer):
    r = writer.post(f"{API}/eligibility", json=NEW)
    assert r.status_code == 200, r.text
    rules = writer.get(f"{API}/eligibility").json()["rules"]
    assert [(x["id"], x["enabled"], x["params"]["field"], x["params"]["value"]) for x in rules] == [("C_HIGH_FOIR", True, "FOIR", 55)]
    assert writer.patch(f"{API}/eligibility/C_HIGH_FOIR", json={"enabled": False, "value": 60}).status_code == 200
    rule = writer.get(f"{API}/eligibility").json()["rules"][0]
    assert rule["enabled"] is False and rule["params"]["value"] == 60 and rule["updated_by"] == "officer.a"
    assert writer.delete(f"{API}/eligibility/C_HIGH_FOIR").status_code == 200
    assert writer.get(f"{API}/eligibility").json()["rules"] == []
    hist = changes(db)
    assert [h[0] for h in hist] == ["C_HIGH_FOIR"] * 3 and all(h[1] == "officer.a" for h in hist)
    assert hist[-1][2] == {"deleted": True}


def test_a_wrong_rule_is_refused_and_nothing_is_saved(db, writer):
    bad = writer.post(f"{API}/eligibility", json={**NEW, "rule_id": "high foir", "operator": "between"})
    assert bad.status_code == 422
    assert "rule_id" in bad.json()["detail"]["message"] and "operator" in bad.json()["detail"]["message"]
    assert writer.get(f"{API}/eligibility").json()["rules"] == []
    assert writer.post(f"{API}/eligibility", json=NEW).status_code == 200
    assert writer.post(f"{API}/eligibility", json=NEW).status_code == 422          # the same id twice


def test_changing_needs_the_write_scope_and_a_known_agent(db, reader, writer):
    assert reader.post(f"{API}/eligibility", json=NEW).status_code == 403
    assert writer.post(f"{API}/no_such_agent", json=NEW).status_code == 404
    assert reader.get(f"{API}/eligibility").status_code == 200                     # reading needs a login only


def test_the_custom_routes_are_not_read_as_a_rule_set(reader):
    # /custom/... is its own API, not the rule set "custom"
    assert reader.get(f"{API}/no_such_agent").status_code == 404
    assert reader.get(f"{API}/no_such_agent").json()["detail"]["code"] == "AGENT_NOT_KNOWN"
