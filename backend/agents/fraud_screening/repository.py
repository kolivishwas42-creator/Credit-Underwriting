"""
The agent's own tables (schema fraud_screening, db/schema.py): rule_config and fraud_results.

    FraudRepository             what the service needs (a Protocol; tests pass a fake)
    PostgresFraudRepository     the PostgreSQL implementation through shared.db.sqla (agent "fraud_screening"); the SQL
                                is unqualified -- search_path is the agent's schema
"""

from __future__ import annotations

import json
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Callable, ContextManager, Dict, List, Optional, Protocol

from agents.fraud_screening.config import AGENT

RULE_COLUMNS = ("rule_key, rule_id, rule_name, description, severity, enabled, is_implementable, config_json, "
                "sort_order")
UPDATABLE = ("enabled", "severity", "description", "config_json")


class FraudRepository(Protocol):
    def load_rule_config(self) -> Dict[str, dict]:
        """rule_key -> the full rule_config row."""

    def list_rules(self) -> List[dict]: ...

    def get_rule(self, rule_key: str) -> Optional[dict]: ...

    def update_rule(self, rule_key: str, changes: Dict[str, Any]) -> dict:
        """Apply `changes` (keys from UPDATABLE) and return the updated row."""

    def save_result(self, payload: Dict[str, Any]) -> int:
        """Insert one evaluation; its result_id."""

    def latest_result(self, application_number: str) -> Optional[dict]: ...


def to_json(obj: Any) -> str:
    """JSON text for a jsonb column (dates as ISO, Decimal as float)."""
    def default(o):
        if isinstance(o, (datetime, date)):
            return o.isoformat()
        if isinstance(o, Decimal):
            return float(o)
        if hasattr(o, "item"):
            return o.item()
        raise TypeError(type(o))

    return json.dumps(obj, default=default)


def _rule_row(row: Any) -> dict:
    d = dict(row)
    cfg = d.get("config_json")
    if isinstance(cfg, str):
        cfg = json.loads(cfg or "{}")
    d["config_json"] = cfg or {}
    return d


def _default_session() -> ContextManager[Any]:
    from shared.db import sqla

    return sqla.session(AGENT)


class PostgresFraudRepository:
    def __init__(self, session_factory: Callable[[], ContextManager[Any]] = _default_session):
        self.session_factory = session_factory

    def load_rule_config(self) -> Dict[str, dict]:
        from sqlalchemy import text

        with self.session_factory() as s:
            rows = s.execute(text("SELECT * FROM rule_config ORDER BY sort_order, rule_key")).mappings().all()
        return {r["rule_key"]: dict(r) for r in rows}

    def list_rules(self) -> List[dict]:
        from sqlalchemy import text

        with self.session_factory() as s:
            rows = s.execute(text(f"SELECT {RULE_COLUMNS} FROM rule_config ORDER BY sort_order, rule_key")
                             ).mappings().all()
        return [_rule_row(r) for r in rows]

    def get_rule(self, rule_key: str) -> Optional[dict]:
        from sqlalchemy import text

        with self.session_factory() as s:
            row = s.execute(text("SELECT * FROM rule_config WHERE rule_key = :k"), {"k": rule_key}).mappings().first()
        return _rule_row(row) if row else None

    def update_rule(self, rule_key: str, changes: Dict[str, Any]) -> dict:
        from sqlalchemy import text

        sets = ["updated_at = CURRENT_TIMESTAMP"]
        params: Dict[str, Any] = {"k": rule_key}
        for column in UPDATABLE:                    # fixed column names only; values are bound
            if column not in changes:
                continue
            if column == "config_json":
                sets.append("config_json = CAST(:config_json AS jsonb)")
                params["config_json"] = json.dumps(changes[column])
            else:
                sets.append(f"{column} = :{column}")
                params[column] = changes[column]
        with self.session_factory() as s:
            s.execute(text(f"UPDATE rule_config SET {', '.join(sets)} WHERE rule_key = :k"), params)
            row = s.execute(text("SELECT * FROM rule_config WHERE rule_key = :k"), {"k": rule_key}).mappings().first()
        return _rule_row(row)

    def save_result(self, payload: Dict[str, Any]) -> int:
        from sqlalchemy import text

        sql = """
            INSERT INTO fraud_results (
                application_id, application_number, risk_level, is_potential_fraud,
                hybrid_flag, fraud_warning, flagged_rules, skipped_rules, rule_results,
                distances, aml_result, pep_result, full_payload
            ) VALUES (
                :application_id, :application_number, :risk_level, :is_potential_fraud,
                :hybrid_flag, :fraud_warning, CAST(:flagged_rules AS jsonb),
                CAST(:skipped_rules AS jsonb), CAST(:rule_results AS jsonb),
                CAST(:distances AS jsonb), CAST(:aml_result AS jsonb),
                CAST(:pep_result AS jsonb), CAST(:full_payload AS jsonb)
            )
            RETURNING result_id
        """
        params = {
            "application_id": payload.get("application_id"),
            "application_number": payload["application_number"],
            "risk_level": payload["risk_level"],
            "is_potential_fraud": payload["is_potential_fraud"],
            "hybrid_flag": payload.get("hybrid_flag", False),
            "fraud_warning": payload.get("fraud_warning"),
            "flagged_rules": to_json(payload.get("flagged_rules", [])),
            "skipped_rules": to_json(payload.get("skipped_rules", [])),
            "rule_results": to_json(payload.get("rule_results", [])),
            "distances": to_json(payload.get("distances")),
            "aml_result": to_json(payload.get("aml_result")),
            "pep_result": to_json(payload.get("pep_result")),
            "full_payload": to_json(payload.get("full_payload")),
        }
        with self.session_factory() as s:
            return int(s.execute(text(sql), params).scalar_one())

    def latest_result(self, application_number: str) -> Optional[dict]:
        from sqlalchemy import text

        with self.session_factory() as s:
            row = s.execute(text("SELECT * FROM fraud_results WHERE application_number = :num "
                                 "ORDER BY created_at DESC LIMIT 1"), {"num": application_number}).mappings().first()
        return dict(row) if row else None
