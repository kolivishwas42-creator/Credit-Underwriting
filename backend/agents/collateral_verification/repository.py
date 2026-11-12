"""
The agent's database: what the service needs (CollateralRepository, a Protocol) and its PostgreSQL implementation.

Connections come only from shared.db.pg with the agent key "collateral_verification" (search_path = the agent's
schema, so the agent's own SQL is unqualified). The LOS case tables the agent reads (loan application, collateral
property, participants, KYC) are qualified with config.los_schema().
"""

from __future__ import annotations

import json
import logging
import threading
import uuid
from typing import Any, Protocol

from agents.collateral_verification import config
from agents.collateral_verification.db.schema import MIGRATIONS
from shared.db import core, pg

logger = logging.getLogger(__name__)

_RULE_COLUMNS = "id, rule_id, enabled, label, tolerance_pp, extra_json, updated_at, updated_by"
_SETTING_COLUMNS = "id, setting_key, setting_value, value_type, description, updated_at, updated_by"
_RESULT_COLUMNS = ("id, run_id, application_id, application_number, data_source, vendor_final_status, report_file, "
                   "overall, summary_json, comparison_results, created_at")


class CollateralRepository(Protocol):
    """Everything the service reads or writes."""

    def configured(self) -> bool: ...

    def ensure_ready(self) -> None: ...

    def load_runtime(self) -> tuple[dict[str, dict] | None, dict[str, Any]]: ...

    def fetch_application(self, application_id: str | None, application_number: str | None) -> dict | None: ...

    def list_rules(self) -> list[dict]: ...

    def upsert_rule(self, payload: dict, updated_by: str) -> dict: ...

    def list_settings(self) -> list[dict]: ...

    def set_setting(self, key: str, value: Any, value_type: str | None, description: str | None,
                    updated_by: str) -> dict: ...

    def save_result(self, payload: dict) -> dict: ...

    def list_results(self, limit: int, offset: int, application_number: str | None) -> list[dict]: ...


# ------------------------------------------------------------------------------------------------- value helpers
def parse_setting(raw: Any, value_type: str | None, *, empty_json_is_none: bool) -> Any:
    """A stored setting as its typed value (number -> float, boolean, json); unparseable values stay as stored."""
    vtype = (value_type or "string").lower()
    if vtype == "number":
        try:
            return float(raw)
        except (TypeError, ValueError):
            return raw
    if vtype == "boolean":
        return str(raw).strip().lower() in ("1", "true", "yes", "y")
    if vtype == "json":
        try:
            if empty_json_is_none:
                return json.loads(raw) if raw else None
            return json.loads(raw) if raw is not None else None
        except Exception:  # noqa: BLE001 - kept as stored
            return raw
    return raw


def rule_meta(row: dict) -> dict:
    """A rule row as the engine's {enabled, label, tolerance_pp?, **extra_json}."""
    meta: dict[str, Any] = {"enabled": bool(row["enabled"]), "label": row["label"] or row["rule_id"]}
    if row["tolerance_pp"] is not None:
        meta["tolerance_pp"] = float(row["tolerance_pp"])
    extra = row["extra_json"]
    if extra:
        if isinstance(extra, str):
            try:
                extra = json.loads(extra)
            except Exception:  # noqa: BLE001 - an unreadable extra is ignored
                extra = {}
        if isinstance(extra, dict):
            meta.update(extra)
    return meta


def _iso(row: dict, key: str) -> dict:
    if row.get(key):
        row[key] = row[key].isoformat()
    return row


def _setting_out(row: dict) -> dict:
    item = dict(row)
    item["parsed_value"] = parse_setting(item.get("setting_value"), item.get("value_type"), empty_json_is_none=True)
    return _iso(item, "updated_at")


class PostgresCollateralRepository:
    """The PostgreSQL implementation (psycopg 3 via shared.db.pg)."""

    def __init__(self, agent: str = config.AGENT):
        self.agent = agent
        self._ready = False
        self._lock = threading.Lock()

    def configured(self) -> bool:
        return bool(core.dsn(self.agent))

    # -------------------------------------------------------------------------------------------- schema + seed
    def ensure_ready(self) -> None:
        """Apply the migrations and seed the rule / setting tables from conf/ when they are empty (once a process)."""
        with self._lock:
            if self._ready:
                return
            conn = pg.connect(self.agent)
            try:
                core.apply_migrations(conn, self.agent, MIGRATIONS)
            finally:
                conn.close()
            self._seed()
            self._ready = True

    def _seed(self) -> None:
        defaults = config.default_rule_config()
        with pg.transaction(self.agent) as conn:
            if conn.execute("SELECT COUNT(*) AS n FROM collateral_rule_configs").fetchone()["n"] == 0:
                for rule_id, meta in defaults.rules.items():
                    conn.execute(
                        "INSERT INTO collateral_rule_configs (rule_id, enabled, label, tolerance_pp, updated_by) "
                        "VALUES (%s, %s, %s, %s, %s) ON CONFLICT (rule_id) DO NOTHING",
                        (rule_id, bool(meta.get("enabled", True)), meta.get("label") or rule_id,
                         meta.get("tolerance_pp"), "system_seed"))
                logger.info("collateral verification: rule configs seeded from conf/")
            if conn.execute("SELECT COUNT(*) AS n FROM collateral_system_settings").fetchone()["n"] == 0:
                for key, value, vtype, description in config.seed_settings():
                    conn.execute(
                        "INSERT INTO collateral_system_settings (setting_key, setting_value, value_type, description,"
                        " updated_by) VALUES (%s, %s, %s, %s, %s) ON CONFLICT (setting_key) DO NOTHING",
                        (key, value, vtype, description, "system_seed"))
                logger.info("collateral verification: system settings seeded from conf/")

    def load_runtime(self) -> tuple[dict[str, dict] | None, dict[str, Any]]:
        """(rules by id -- None when the table is empty, settings by key as typed values)."""
        with pg.transaction(self.agent) as conn:
            rows = conn.execute("SELECT rule_id, enabled, label, tolerance_pp, extra_json FROM collateral_rule_configs"
                                " ORDER BY id").fetchall()
            settings = conn.execute("SELECT setting_key, setting_value, value_type FROM collateral_system_settings"
                                    ).fetchall()
        rules = {r["rule_id"]: rule_meta(r) for r in rows} or None
        values = {s["setting_key"]: parse_setting(s["setting_value"], s["value_type"], empty_json_is_none=False)
                  for s in settings}
        return rules, values

    # ------------------------------------------------------------------------------------------ the LOS record
    def fetch_application(self, application_id: str | None, application_number: str | None) -> dict | None:
        """The application, its collateral properties (+ documents) and participants from the LOS case tables."""
        from psycopg import sql

        los = sql.Identifier(config.los_schema())

        def q(text: str) -> sql.Composed:
            return sql.SQL(text).format(los=los)

        with pg.transaction(self.agent) as conn:
            if application_id and str(application_id).isdigit():
                app = conn.execute(q("SELECT application_id, application_number FROM {los}.loan_applications "
                                     "WHERE application_id = %s"), (int(application_id),)).fetchone()
            elif application_number:
                app = conn.execute(q("SELECT application_id, application_number FROM {los}.loan_applications "
                                     "WHERE application_number = %s"), (application_number.strip(),)).fetchone()
            else:
                return None
            if not app:
                return None
            properties = [dict(r) for r in conn.execute(q(
                "SELECT cp.collateral_property_id, cp.property_owner, cp.owner_first_name, cp.owner_middle_name, "
                "cp.owner_last_name, cp.property_ownership, cp.collateral_status, cp.percentage_of_completion, "
                "cp.pincode, cp.city, cp.state, cp.house_flat_number, cp.property_type "
                "FROM {los}.collateral_properties cp WHERE cp.application_id = %s ORDER BY cp.collateral_property_id"),
                (app["application_id"],)).fetchall()]
            documents: list[dict] = []
            if properties:
                documents = [dict(r) for r in conn.execute(q(
                    "SELECT collateral_property_id, document_name, file_name, file_path "
                    "FROM {los}.collateral_property_documents WHERE collateral_property_id = ANY(%s) "
                    "ORDER BY collateral_property_id"),
                    ([p["collateral_property_id"] for p in properties],)).fetchall()]
            participants = [
                {"applicant_type": r["applicant_type"], "full_name": r["full_name"], "pan_number": r["pan_number"]}
                for r in conn.execute(q(
                    "SELECT ap.applicant_type, c.full_name, c.pan_number FROM {los}.application_participants ap "
                    "LEFT JOIN {los}.customers c ON c.customer_id = ap.customer_id WHERE ap.application_id = %s "
                    "ORDER BY ap.is_primary DESC, ap.participant_id"), (app["application_id"],)).fetchall()]
            # the PAN on primary_applicant_kyc when no participant carries it
            kyc = conn.execute(q("SELECT k.pan_number, k.first_name, k.middle_name, k.last_name "
                                 "FROM {los}.primary_applicant_kyc k WHERE k.application_id = %s"),
                               (app["application_id"],)).fetchone()
        if kyc and kyc["pan_number"]:
            if not any((p.get("pan_number") or "").upper() == kyc["pan_number"].upper() for p in participants):
                name = " ".join(x for x in [kyc["first_name"], kyc["middle_name"], kyc["last_name"]] if x)
                participants.append({"applicant_type": "PRIMARY_KYC", "full_name": name,
                                     "pan_number": kyc["pan_number"]})
        return {"application_id": app["application_id"], "application_number": app["application_number"],
                "participants": participants, "properties": properties, "documents": documents}

    # ------------------------------------------------------------------------------------------------- rules
    def list_rules(self) -> list[dict]:
        with pg.transaction(self.agent) as conn:
            rows = conn.execute(f"SELECT {_RULE_COLUMNS} FROM collateral_rule_configs ORDER BY id").fetchall()
        return [_iso(dict(r), "updated_at") for r in rows]

    def upsert_rule(self, payload: dict, updated_by: str) -> dict:
        rule_id = payload.get("rule_id")
        if not rule_id:
            raise ValueError("rule_id is required")
        enabled, label = payload.get("enabled"), payload.get("label")
        extra_json = payload.get("extra_json")
        with pg.transaction(self.agent) as conn:
            existing = conn.execute("SELECT id FROM collateral_rule_configs WHERE rule_id = %s", (rule_id,)).fetchone()
            if existing:
                sets = ["updated_at = now()", "updated_by = %s"]
                args: list[Any] = [updated_by]
                if enabled is not None:
                    sets.append("enabled = %s")
                    args.append(bool(enabled))
                if label is not None:
                    sets.append("label = %s")
                    args.append(label)
                if "tolerance_pp" in payload:
                    sets.append("tolerance_pp = %s")
                    args.append(payload.get("tolerance_pp"))
                if "extra_json" in payload:
                    sets.append("extra_json = %s")
                    args.append(json.dumps(extra_json) if extra_json is not None else None)
                args.append(rule_id)
                conn.execute(f"UPDATE collateral_rule_configs SET {', '.join(sets)} WHERE rule_id = %s", args)
            else:
                conn.execute(
                    "INSERT INTO collateral_rule_configs (rule_id, enabled, label, tolerance_pp, extra_json, updated_by)"
                    " VALUES (%s, %s, %s, %s, %s, %s)",
                    (rule_id, bool(enabled if enabled is not None else True), label or rule_id,
                     payload.get("tolerance_pp"), json.dumps(extra_json) if extra_json is not None else None,
                     updated_by))
            row = conn.execute(f"SELECT {_RULE_COLUMNS} FROM collateral_rule_configs WHERE rule_id = %s",
                               (rule_id,)).fetchone()
        return _iso(dict(row), "updated_at")

    # ---------------------------------------------------------------------------------------------- settings
    def list_settings(self) -> list[dict]:
        with pg.transaction(self.agent) as conn:
            rows = conn.execute(f"SELECT {_SETTING_COLUMNS} FROM collateral_system_settings ORDER BY setting_key"
                                ).fetchall()
        return [_setting_out(r) for r in rows]

    def set_setting(self, key: str, value: Any, value_type: str | None, description: str | None,
                    updated_by: str) -> dict:
        with pg.transaction(self.agent) as conn:
            existing = conn.execute("SELECT id, value_type FROM collateral_system_settings WHERE setting_key = %s",
                                    (key,)).fetchone()
            vtype = value_type or (existing["value_type"] if existing else "string")
            if vtype == "json":
                stored = json.dumps(value) if not isinstance(value, str) else value
            elif vtype == "boolean":
                stored = "true" if value in (True, "true", "1", 1, "yes") else "false"
            else:
                stored = str(value) if value is not None else None
            if existing:
                conn.execute(
                    "UPDATE collateral_system_settings SET setting_value = %s, value_type = %s, "
                    "description = COALESCE(%s, description), updated_at = now(), updated_by = %s "
                    "WHERE setting_key = %s", (stored, vtype, description, updated_by, key))
            else:
                conn.execute(
                    "INSERT INTO collateral_system_settings (setting_key, setting_value, value_type, description, "
                    "updated_by) VALUES (%s, %s, %s, %s, %s)", (key, stored, vtype, description, updated_by))
            row = conn.execute(f"SELECT {_SETTING_COLUMNS} FROM collateral_system_settings WHERE setting_key = %s",
                               (key,)).fetchone()
        return _setting_out(row)

    # ----------------------------------------------------------------------------------------------- results
    def save_result(self, payload: dict) -> dict:
        summary = payload.get("summary") or {}
        with pg.transaction(self.agent) as conn:
            row = conn.execute(
                "INSERT INTO collateral_verification_results (run_id, application_id, application_number, data_source,"
                " vendor_final_status, report_file, overall, summary_json, comparison_results, source_evidence) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb) RETURNING id, run_id, created_at",
                (str(uuid.uuid4()), str(payload.get("application_id") or "") or None,
                 payload.get("application_number"), payload.get("data_source"), payload.get("vendor_final_status"),
                 payload.get("report_file"), summary.get("overall") if isinstance(summary, dict) else None,
                 json.dumps(summary, default=str), json.dumps(payload.get("comparison_results") or [], default=str),
                 json.dumps(payload.get("source_evidence") or {}, default=str))).fetchone()
        return {"id": row["id"], "run_id": row["run_id"],
                "created_at": row["created_at"].isoformat() if row["created_at"] else None}

    def list_results(self, limit: int, offset: int, application_number: str | None) -> list[dict]:
        with pg.transaction(self.agent) as conn:
            if application_number:
                rows = conn.execute(f"SELECT {_RESULT_COLUMNS} FROM collateral_verification_results "
                                    "WHERE application_number = %s ORDER BY created_at DESC LIMIT %s OFFSET %s",
                                    (application_number, limit, offset)).fetchall()
            else:
                rows = conn.execute(f"SELECT {_RESULT_COLUMNS} FROM collateral_verification_results "
                                    "ORDER BY created_at DESC LIMIT %s OFFSET %s", (limit, offset)).fetchall()
        return [_iso(dict(r), "created_at") for r in rows]


__all__ = ["CollateralRepository", "PostgresCollateralRepository", "parse_setting", "rule_meta"]
