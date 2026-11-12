"""
The ITR verification agent's database: what the service needs (ITRRepository) and its PostgreSQL implementation.

The connection comes only from shared.db.pg with the agent key "itr_verification" (search_path = the agent's
schema). The schema is migrated on first use (db/schema.py), and the default rules / settings are seeded into empty
tables once (the conf/rules.yaml defaults, handed in by the caller).
"""

from __future__ import annotations

import threading
from datetime import datetime
from typing import Any, Iterable, Mapping, Optional, Protocol

from .config import AGENT
from .db.schema import MIGRATIONS
from .rules.policy import RULE_ATTRS, parse_setting


class ITRRepository(Protocol):
    def ping(self) -> None: ...

    def list_rules(self, category: Optional[str] = None) -> list[dict[str, Any]]: ...

    def get_rule(self, category: str, field: str) -> Optional[dict[str, Any]]: ...

    def save_rule(self, row: Mapping[str, Any], updated_by: str) -> dict[str, Any]: ...

    def list_settings(self) -> list[dict[str, Any]]: ...

    def get_setting(self, key: str) -> Optional[dict[str, Any]]: ...

    def save_setting(self, key: str, setting_value: Optional[str], value_type: str, description: Optional[str],
                     updated_by: str) -> dict[str, Any]: ...

    def save_result(self, row: Mapping[str, Any]) -> dict[str, Any]: ...

    def list_results(self, limit: int, offset: int, decision: Optional[str] = None,
                     pan_number: Optional[str] = None) -> list[dict[str, Any]]: ...

    def get_result(self, run_id: str) -> Optional[dict[str, Any]]: ...


# ------------------------------------------------------------------------------------------------ row -> API dict
def _iso(value: Any) -> Optional[str]:
    return value.isoformat() if isinstance(value, datetime) else value


def rule_dict(r: Mapping[str, Any]) -> dict[str, Any]:
    return {"id": r["id"], "category": r["category"], "field": r["field"], "enabled": bool(r["enabled"]),
            "weight": float(r["weight"] or 0), "match_type": r["match_type"],
            "tolerance_pct": float(r["tolerance_pct"] or 0), "severity": r["severity"],
            "description": r["description"], "document_field": r["document_field"], "label": r["label"],
            "extra_json": r["extra_json"], "updated_at": _iso(r["updated_at"]), "updated_by": r["updated_by"]}


def setting_dict(r: Mapping[str, Any]) -> dict[str, Any]:
    return {"id": r["id"], "setting_key": r["setting_key"], "setting_value": r["setting_value"],
            "parsed_value": parse_setting(r["setting_value"], r["value_type"]), "value_type": r["value_type"],
            "description": r["description"], "updated_at": _iso(r["updated_at"]), "updated_by": r["updated_by"]}


RESULT_COLUMNS = ("run_id", "input_doc_id", "output_doc_id", "pan_number", "assessment_year", "gti_income",
                  "final_status", "applicant_name", "address", "decision", "overall_score", "summary",
                  "vendor_final_status", "critical_failures", "mismatches", "field_results", "input_fields",
                  "output_fields")
_JSON_COLUMNS = {"critical_failures", "mismatches", "field_results", "input_fields", "output_fields"}


def result_dict(r: Mapping[str, Any]) -> dict[str, Any]:
    out = {"id": r["id"], **{c: r[c] for c in RESULT_COLUMNS}, "created_at": _iso(r["created_at"])}
    for c in ("critical_failures", "mismatches", "field_results"):
        out[c] = out[c] or []
    for c in ("input_fields", "output_fields"):
        out[c] = out[c] or {}
    return out


# ------------------------------------------------------------------------------------------- PostgreSQL version
class PostgresITRRepository:
    """ITRRepository on PostgreSQL (psycopg 3 through shared.db.pg)."""

    _ready_lock = threading.Lock()

    def __init__(self, seed_rules: Iterable[Mapping[str, Any]] = (), seed_settings: Iterable[Mapping[str, Any]] = (),
                 agent: str = AGENT):
        self._agent = agent
        self._seed_rules = [dict(r) for r in seed_rules]
        self._seed_settings = [dict(s) for s in seed_settings]
        self._ready = False

    # -- connection ------------------------------------------------------------------------------------------------
    def _tx(self):
        from shared.db import pg

        self._ensure_ready()
        return pg.transaction(self._agent)

    def _ensure_ready(self) -> None:
        if self._ready:
            return
        with self._ready_lock:
            if self._ready:
                return
            from shared.db import core, pg

            conn = pg.connect(self._agent)
            try:
                core.apply_migrations(conn, self._agent, MIGRATIONS)
                with conn.transaction():
                    self._seed(conn)
            finally:
                conn.close()
            self._ready = True

    def _seed(self, conn: Any) -> None:
        """The default rules / settings into EMPTY tables (an edited table is never touched)."""
        from psycopg.types.json import Jsonb

        if self._seed_rules and conn.execute("SELECT count(*) AS n FROM rule_configs").fetchone()["n"] == 0:
            for r in self._seed_rules:
                conn.execute(
                    "INSERT INTO rule_configs (category, field, enabled, weight, match_type, tolerance_pct, severity,"
                    " description, document_field, label, extra_json, updated_by)"
                    " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'system_seed')",
                    (r["category"], r["field"], r["enabled"], r["weight"], r["match_type"], r["tolerance_pct"],
                     r["severity"], r.get("description"), r.get("document_field"), r.get("label"),
                     None if r.get("extra_json") is None else Jsonb(r["extra_json"])))
        if self._seed_settings and conn.execute("SELECT count(*) AS n FROM system_settings").fetchone()["n"] == 0:
            for s in self._seed_settings:
                conn.execute(
                    "INSERT INTO system_settings (setting_key, setting_value, value_type, description, updated_by)"
                    " VALUES (%s, %s, %s, %s, 'system_seed')",
                    (s["setting_key"], s["setting_value"], s["value_type"], s.get("description")))

    def ping(self) -> None:
        with self._tx() as conn:
            conn.execute("SELECT 1")

    # -- rules -----------------------------------------------------------------------------------------------------
    def list_rules(self, category: Optional[str] = None) -> list[dict[str, Any]]:
        with self._tx() as conn:
            if category:
                rows = conn.execute("SELECT * FROM rule_configs WHERE category = %s ORDER BY category, id",
                                    (category,)).fetchall()
            else:
                rows = conn.execute("SELECT * FROM rule_configs ORDER BY category, id").fetchall()
        return [rule_dict(r) for r in rows]

    def get_rule(self, category: str, field: str) -> Optional[dict[str, Any]]:
        with self._tx() as conn:
            row = conn.execute("SELECT * FROM rule_configs WHERE category = %s AND field = %s",
                               (category, field)).fetchone()
        return rule_dict(row) if row else None

    def save_rule(self, row: Mapping[str, Any], updated_by: str) -> dict[str, Any]:
        from psycopg.types.json import Jsonb

        values = [row[a] if a != "extra_json" or row[a] is None else Jsonb(row[a]) for a in RULE_ATTRS]
        cols = ", ".join(RULE_ATTRS)
        updates = ", ".join(f"{a} = EXCLUDED.{a}" for a in RULE_ATTRS)
        with self._tx() as conn:
            saved = conn.execute(
                f"INSERT INTO rule_configs (category, field, {cols}, updated_at, updated_by)"
                f" VALUES (%s, %s, {', '.join(['%s'] * len(RULE_ATTRS))}, now(), %s)"
                f" ON CONFLICT (category, field) DO UPDATE SET {updates}, updated_at = now(),"
                f" updated_by = EXCLUDED.updated_by RETURNING *",
                (row["category"], row["field"], *values, updated_by)).fetchone()
        return rule_dict(saved)

    # -- settings --------------------------------------------------------------------------------------------------
    def list_settings(self) -> list[dict[str, Any]]:
        with self._tx() as conn:
            rows = conn.execute("SELECT * FROM system_settings ORDER BY setting_key").fetchall()
        return [setting_dict(r) for r in rows]

    def get_setting(self, key: str) -> Optional[dict[str, Any]]:
        with self._tx() as conn:
            row = conn.execute("SELECT * FROM system_settings WHERE setting_key = %s", (key,)).fetchone()
        return setting_dict(row) if row else None

    def save_setting(self, key: str, setting_value: Optional[str], value_type: str, description: Optional[str],
                     updated_by: str) -> dict[str, Any]:
        with self._tx() as conn:
            saved = conn.execute(
                "INSERT INTO system_settings (setting_key, setting_value, value_type, description, updated_at,"
                " updated_by) VALUES (%s, %s, %s, %s, now(), %s)"
                " ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value,"
                " value_type = EXCLUDED.value_type,"
                " description = COALESCE(EXCLUDED.description, system_settings.description),"
                " updated_at = now(), updated_by = EXCLUDED.updated_by RETURNING *",
                (key, setting_value, value_type, description, updated_by)).fetchone()
        return setting_dict(saved)

    # -- results ---------------------------------------------------------------------------------------------------
    def save_result(self, row: Mapping[str, Any]) -> dict[str, Any]:
        from psycopg.types.json import Jsonb

        values = [Jsonb(row.get(c)) if c in _JSON_COLUMNS else row.get(c) for c in RESULT_COLUMNS]
        # created_at given explicitly (2026-11-07): the table the former ITR app created has no default on it, so an
        # insert that left it out failed (and the result was silently not kept)
        with self._tx() as conn:
            saved = conn.execute(
                f"INSERT INTO verification_results ({', '.join(RESULT_COLUMNS)}, created_at)"
                f" VALUES ({', '.join(['%s'] * len(RESULT_COLUMNS))}, now()) RETURNING *", values).fetchone()
        return result_dict(saved)

    def list_results(self, limit: int, offset: int, decision: Optional[str] = None,
                     pan_number: Optional[str] = None) -> list[dict[str, Any]]:
        where, params = [], []
        if decision:
            where.append("decision = %s")
            params.append(decision.upper())
        if pan_number:
            where.append("pan_number = %s")
            params.append(pan_number.upper())
        clause = (" WHERE " + " AND ".join(where)) if where else ""
        with self._tx() as conn:
            rows = conn.execute(f"SELECT * FROM verification_results{clause} ORDER BY created_at DESC"
                                f" LIMIT %s OFFSET %s", (*params, limit, offset)).fetchall()
        return [result_dict(r) for r in rows]

    def get_result(self, run_id: str) -> Optional[dict[str, Any]]:
        with self._tx() as conn:
            row = conn.execute("SELECT * FROM verification_results WHERE run_id = %s", (run_id,)).fetchone()
        return result_dict(row) if row else None


__all__ = ["ITRRepository", "PostgresITRRepository", "RESULT_COLUMNS", "result_dict", "rule_dict", "setting_dict"]
