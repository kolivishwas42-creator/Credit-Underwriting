"""
CUSTOM RULES FOR EVERY AGENT (owner 2026-11-13: "add rule sab ke liye"): a rule an officer adds from the Rules
settings screen -- "when <a value the agent shows under Calculations> <comparison> <limit> -> Review / Fail" -- kept
in the shared database (schema rule_settings, approved 2026-11-12), every change recorded in rule_settings.changes.

    GET    /api/v1/rule-settings/custom/{agent}             the agent's custom rules
    POST   /api/v1/rule-settings/custom/{agent}             add one (checked first)
    PATCH  /api/v1/rule-settings/custom/{agent}/{rule_id}   on / off, its limit, outcome, severity
    DELETE /api/v1/rule-settings/custom/{agent}/{rule_id}   remove it (the history keeps it)

They are applied on the agent's result page, beside the agent's own rules (the agent's server-side decision and its
PDF are its own). Who may change them: the same scope as rule settings (los.rules.write).
"""

from __future__ import annotations

import json
import os
import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from shared.api.rule_settings import _who, _writer, settings
from shared.security.auth import require_jwt

SCHEMA_SQL = """
CREATE SCHEMA IF NOT EXISTS rule_settings;
CREATE TABLE IF NOT EXISTS rule_settings.rules (
    agent        text        NOT NULL,
    rule_id      text        NOT NULL,
    enabled      boolean     NOT NULL DEFAULT true,
    severity     text        NULL,
    params       jsonb       NOT NULL DEFAULT '{}',
    template     text        NULL,
    label        text        NULL,
    description  text        NULL,
    updated_by   text        NOT NULL,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (agent, rule_id),
    CONSTRAINT severity_known CHECK (severity IS NULL OR severity IN ('LOW','MEDIUM','HIGH','CRITICAL'))
);
CREATE TABLE IF NOT EXISTS rule_settings.changes (
    id          bigserial   PRIMARY KEY,
    agent       text        NOT NULL,
    rule_id     text        NOT NULL,
    before      jsonb       NULL,
    after       jsonb       NOT NULL,
    changed_by  text        NOT NULL,
    changed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS changes_by_rule ON rule_settings.changes (agent, rule_id, changed_at DESC);
"""

OPERATORS = ("gt", "ge", "lt", "le", "eq", "ne")
OUTCOMES = ("review", "fail")
SEVERITIES = ("LOW", "MEDIUM", "HIGH", "CRITICAL")
TEMPLATE = "calc_threshold"
_ID = re.compile(r"^C[A-Z0-9_]{2,40}$")
_ready = False


def _agents() -> set[str]:
    return set((settings().get("custom_rules") or {}).get("agents") or [])


def _connect():
    import psycopg

    dsn = (os.getenv("LOS_AGENTIC_DSN") or "").strip()
    if not dsn:
        raise HTTPException(503, detail={"code": "RULES_UNAVAILABLE", "message": "the shared database is not configured"})
    try:
        return psycopg.connect(dsn, connect_timeout=8)
    except Exception:  # noqa: BLE001 - said plainly, never the DSN
        raise HTTPException(503, detail={"code": "RULES_UNAVAILABLE", "message": "the shared database could not be reached"}) from None


def _ensure(conn) -> None:
    global _ready
    if not _ready:
        conn.execute(SCHEMA_SQL)
        _ready = True


def _row(r) -> dict[str, Any]:
    agent, rule_id, enabled, severity, params, template, label, description, by, at = r
    return {"id": rule_id, "agent": agent, "enabled": enabled, "severity": severity, "params": params or {},
            "template": template, "name": label, "description": description, "updated_by": by, "updated_at": str(at)}


_COLS = "agent, rule_id, enabled, severity, params, template, label, description, updated_by, updated_at"


def _agent(agent: str) -> str:
    if agent not in _agents():
        raise HTTPException(404, detail={"code": "AGENT_NOT_KNOWN", "message": f"{agent} has no custom rules"})
    return agent


class NewCustomRule(BaseModel):
    rule_id: str = Field(..., max_length=42)
    name: str = Field(..., min_length=3, max_length=120)
    description: str | None = Field(None, max_length=500)
    field: str = Field(..., min_length=2, max_length=120)        # a value's label under Calculations
    operator: str
    value: float
    outcome: str = "review"
    severity: str = "MEDIUM"


class CustomChange(BaseModel):
    enabled: bool | None = None
    value: float | None = None
    operator: str | None = None
    outcome: str | None = None
    severity: str | None = None


def _check(op: str | None, outcome: str | None, severity: str | None) -> list[str]:
    bad = []
    if op is not None and op not in OPERATORS:
        bad.append("operator: choose one of " + ", ".join(OPERATORS))
    if outcome is not None and outcome not in OUTCOMES:
        bad.append("outcome: Review or Fail")
    if severity is not None and severity not in SEVERITIES:
        bad.append("severity: choose one of " + ", ".join(SEVERITIES))
    return bad


router = APIRouter(prefix="/api/v1/rule-settings/custom", tags=["Rule settings"])


@router.get("/{agent}", summary="The custom rules an officer added for this agent")
def list_custom(agent: str, claims: dict[str, Any] = Depends(require_jwt)) -> dict[str, Any]:
    _agent(agent)
    with _connect() as conn:
        _ensure(conn)
        rows = conn.execute(f"SELECT {_COLS} FROM rule_settings.rules WHERE agent = %s AND template = %s ORDER BY updated_at",
                            (agent, TEMPLATE)).fetchall()
    return {"agent": agent, "rules": [_row(r) for r in rows], "operators": OPERATORS, "outcomes": OUTCOMES,
            "severities": SEVERITIES}


@router.post("/{agent}", summary="Add a custom rule (checked first; it starts on)")
def add_custom(agent: str, body: NewCustomRule, claims: dict[str, Any] = Depends(_writer)) -> dict[str, Any]:
    _agent(agent)
    rid = body.rule_id.strip().upper()
    bad = _check(body.operator, body.outcome, body.severity)
    if not _ID.match(rid):
        bad.append("rule_id: starts with C, then capital letters, digits and _ (e.g. C_HIGH_FOIR)")
    if bad:
        raise HTTPException(422, detail={"code": "INVALID_RULE", "message": "; ".join(bad)})
    params = {"field": body.field.strip(), "operator": body.operator, "value": body.value, "outcome": body.outcome}
    who = _who(claims)
    with _connect() as conn:
        _ensure(conn)
        with conn.transaction():
            if conn.execute("SELECT 1 FROM rule_settings.rules WHERE agent = %s AND rule_id = %s", (agent, rid)).fetchone():
                raise HTTPException(422, detail={"code": "INVALID_RULE", "message": f"rule_id: {rid} already exists"})
            row = conn.execute(
                f"INSERT INTO rule_settings.rules (agent, rule_id, enabled, severity, params, template, label, description, updated_by) "
                f"VALUES (%s, %s, true, %s, %s, %s, %s, %s, %s) RETURNING {_COLS}",
                (agent, rid, body.severity, json.dumps(params), TEMPLATE, body.name.strip(), body.description, who)).fetchone()
            conn.execute("INSERT INTO rule_settings.changes (agent, rule_id, before, after, changed_by) VALUES (%s, %s, NULL, %s, %s)",
                         (agent, rid, json.dumps(_row(row), default=str), who))
    return {"added": rid, "rule": _row(row)}


@router.patch("/{agent}/{rule_id}", summary="Turn a custom rule on / off, or change its limit / outcome / severity")
def change_custom(agent: str, rule_id: str, body: CustomChange, claims: dict[str, Any] = Depends(_writer)) -> dict[str, Any]:
    _agent(agent)
    bad = _check(body.operator, body.outcome, body.severity)
    if bad:
        raise HTTPException(422, detail={"code": "INVALID_RULE", "message": "; ".join(bad)})
    who = _who(claims)
    with _connect() as conn:
        _ensure(conn)
        with conn.transaction():
            old = conn.execute(f"SELECT {_COLS} FROM rule_settings.rules WHERE agent = %s AND rule_id = %s FOR UPDATE",
                               (agent, rule_id)).fetchone()
            if not old:
                raise HTTPException(404, detail={"code": "RULE_NOT_FOUND", "message": f"{rule_id} is not a custom rule of {agent}"})
            before = _row(old)
            params = dict(before["params"])
            for k in ("value", "operator", "outcome"):
                if getattr(body, k) is not None:
                    params[k] = getattr(body, k)
            enabled = before["enabled"] if body.enabled is None else body.enabled
            severity = body.severity or before["severity"]
            row = conn.execute(
                f"UPDATE rule_settings.rules SET enabled = %s, severity = %s, params = %s, updated_by = %s, updated_at = now() "
                f"WHERE agent = %s AND rule_id = %s RETURNING {_COLS}",
                (enabled, severity, json.dumps(params), who, agent, rule_id)).fetchone()
            conn.execute("INSERT INTO rule_settings.changes (agent, rule_id, before, after, changed_by) VALUES (%s, %s, %s, %s, %s)",
                         (agent, rule_id, json.dumps(before, default=str), json.dumps(_row(row), default=str), who))
    return {"changed": True, "rule": _row(row)}


@router.delete("/{agent}/{rule_id}", summary="Remove a custom rule (the change history keeps it)")
def delete_custom(agent: str, rule_id: str, claims: dict[str, Any] = Depends(_writer)) -> dict[str, Any]:
    _agent(agent)
    who = _who(claims)
    with _connect() as conn:
        _ensure(conn)
        with conn.transaction():
            old = conn.execute(f"SELECT {_COLS} FROM rule_settings.rules WHERE agent = %s AND rule_id = %s", (agent, rule_id)).fetchone()
            if not old:
                raise HTTPException(404, detail={"code": "RULE_NOT_FOUND", "message": f"{rule_id} is not a custom rule of {agent}"})
            conn.execute("DELETE FROM rule_settings.rules WHERE agent = %s AND rule_id = %s", (agent, rule_id))
            conn.execute("INSERT INTO rule_settings.changes (agent, rule_id, before, after, changed_by) VALUES (%s, %s, %s, %s, %s)",
                         (agent, rule_id, json.dumps(_row(old), default=str), json.dumps({"deleted": True}), who))
    return {"deleted": rule_id}


__all__ = ["SCHEMA_SQL", "router"]
