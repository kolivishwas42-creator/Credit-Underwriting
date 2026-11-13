"""
The database of the residence / office verification agent.

    RuleRepository        what the service needs (a Protocol; tests use a fake)
    PostgresRepository    plain psycopg 3 SQL over shared.db.pg (agent key "residence_office_verification"):
                          the agent's own tables (unqualified, search_path = the agent schema) and the LOS tables it
                          only READS (qualified by Settings.los_source_schema)
    migrate()             apply db/schema.py MIGRATIONS (setup scripts; never at request time)
"""

from __future__ import annotations

from typing import Any, Protocol

from agents.residence_office_verification.config import AGENT

CONFIG_TABLES = {"RESIDENCE": "residence_rule_configs", "OFFICE": "office_rule_configs"}
RESULT_TABLES = {"RESIDENCE": "residence_rule_results", "OFFICE": "office_rule_results"}


class RepositoryUnavailable(RuntimeError):
    """The database is not configured or a query failed (the message never carries the DSN)."""

    def __init__(self, message: str, *, configuration: bool = False):
        super().__init__(message)
        self.configuration = configuration


class RuleRepository(Protocol):
    def fetch_application(self, application_id: int) -> dict[str, Any] | None: ...

    def fetch_application_by_number(self, application_number: str) -> dict[str, Any] | None: ...

    def list_participants(self, application_id: int) -> list[dict[str, Any]]: ...

    def fetch_participant(self, application_id: int, participant_id: int) -> dict[str, Any] | None: ...

    def fetch_participant_addresses(self, participant_id: int) -> list[dict[str, Any]]: ...

    def load_rule_configs(self, mode: str) -> dict[str, dict[str, Any]]: ...

    def list_rule_configs(self, mode: str) -> list[dict[str, Any]]: ...

    def bulk_update_rule_configs(self, mode: str, rules: list[dict[str, Any]]) -> list[dict[str, Any]]: ...

    def save_rule_result(self, mode: str, **values: Any) -> int: ...


def _table(tables: dict[str, str], mode: str) -> str:
    table = tables.get(str(mode).upper())
    if not table:
        raise ValueError("verification_type must be RESIDENCE or OFFICE")
    return table


def _iso(row: dict[str, Any]) -> dict[str, Any]:
    item = dict(row)
    for key in ("created_at", "updated_at"):
        if item.get(key) is not None:
            item[key] = item[key].isoformat()
    return item


_CONFIG_ROW = "id, rule_key, rule_id, name, enabled, criticality, weight, created_at, updated_at"


class PostgresRepository:
    """psycopg 3 over shared.db.pg; each method is one transaction."""

    def __init__(self, los_schema: str):
        self._los_schema = los_schema

    # ------------------------------------------------------------------ plumbing
    def _run(self, work):
        from psycopg import Error as PsycopgError

        from shared.db import AgentDbError, pg

        try:
            with pg.transaction(AGENT) as conn:
                return work(conn)
        except AgentDbError as exc:
            raise RepositoryUnavailable(str(exc), configuration=True) from None
        except PsycopgError as exc:
            raise RepositoryUnavailable(type(exc).__name__) from exc

    def _los(self, table: str):
        from psycopg import sql

        return sql.Identifier(self._los_schema, table)

    # ------------------------------------------------------------------ LOS reads (read-only)
    def fetch_application(self, application_id: int) -> dict[str, Any] | None:
        from psycopg import sql

        query = sql.SQL("""
            SELECT application_id, application_number, customer_id, stage, status
            FROM {loan_applications}
            WHERE application_id = %s
        """).format(loan_applications=self._los("loan_applications"))
        return self._run(lambda conn: conn.execute(query, (application_id,)).fetchone())

    def fetch_application_by_number(self, application_number: str) -> dict[str, Any] | None:
        from psycopg import sql

        query = sql.SQL("""
            SELECT application_id, application_number, customer_id, stage, status
            FROM {loan_applications}
            WHERE application_number = %s
        """).format(loan_applications=self._los("loan_applications"))
        return self._run(lambda conn: conn.execute(query, (application_number,)).fetchone())

    def list_participants(self, application_id: int) -> list[dict[str, Any]]:
        """The people of an application (primary first), with the name parts the service puts together."""
        from psycopg import sql

        query = sql.SQL("""
            SELECT
                ap.participant_id,
                ap.applicant_type,
                ap.applicant_category,
                ap.is_primary,
                c.full_name AS customer_full_name,
                iad.salutation,
                iad.first_name,
                iad.middle_name,
                iad.last_name
            FROM {participants} AS ap
            LEFT JOIN {customers} AS c
                ON c.customer_id = ap.customer_id
            LEFT JOIN {details} AS iad
                ON iad.participant_id = ap.participant_id
            WHERE ap.application_id = %s
            ORDER BY ap.is_primary DESC NULLS LAST, ap.participant_id
        """).format(participants=self._los("application_participants"), customers=self._los("customers"),
                    details=self._los("individual_applicant_details"))
        return self._run(lambda conn: list(conn.execute(query, (application_id,)).fetchall()))

    def fetch_participant(self, application_id: int, participant_id: int) -> dict[str, Any] | None:
        from psycopg import sql

        query = sql.SQL("""
            SELECT
                ap.participant_id,
                ap.application_id,
                ap.customer_id,
                ap.applicant_type,
                ap.applicant_category,
                ap.is_primary,
                c.mobile_number AS customer_mobile_number,
                c.pan_number,
                c.full_name AS customer_full_name,
                iad.salutation,
                iad.first_name,
                iad.middle_name,
                iad.last_name,
                iad.mobile_number AS applicant_mobile_number,
                iad.date_of_birth
            FROM {participants} AS ap
            LEFT JOIN {customers} AS c
                ON c.customer_id = ap.customer_id
            LEFT JOIN {details} AS iad
                ON iad.participant_id = ap.participant_id
            WHERE ap.application_id = %s
              AND ap.participant_id = %s
        """).format(participants=self._los("application_participants"), customers=self._los("customers"),
                    details=self._los("individual_applicant_details"))
        return self._run(lambda conn: conn.execute(query, (application_id, participant_id)).fetchone())

    def fetch_participant_addresses(self, participant_id: int) -> list[dict[str, Any]]:
        from psycopg import sql

        query = sql.SQL("""
            SELECT
                address_id,
                participant_id,
                address_type,
                residence_status,
                house_flat_number,
                address_line_1,
                address_line_2,
                landmark_street,
                pincode,
                city,
                state,
                full_address,
                same_as_primary_applicant,
                same_as_co_applicant
            FROM {addresses}
            WHERE participant_id = %s
            ORDER BY address_id
        """).format(addresses=self._los("applicant_addresses"))
        return self._run(lambda conn: list(conn.execute(query, (participant_id,)).fetchall()))

    # ------------------------------------------------------------------ rule configs
    def load_rule_configs(self, mode: str) -> dict[str, dict[str, Any]]:
        """The rule settings keyed by rule_key ({} when the table is empty: the caller uses the defaults)."""
        from psycopg import sql

        query = sql.SQL("SELECT rule_key, rule_id, name, enabled, criticality, weight FROM {} ORDER BY rule_key"
                        ).format(sql.Identifier(_table(CONFIG_TABLES, mode)))
        rows = self._run(lambda conn: conn.execute(query).fetchall())
        return {row["rule_key"]: {"rule_id": row["rule_id"], "name": row["name"], "enabled": bool(row["enabled"]),
                                  "criticality": str(row["criticality"]).upper(), "weight": int(row["weight"])}
                for row in rows}

    def list_rule_configs(self, mode: str) -> list[dict[str, Any]]:
        from psycopg import sql

        query = sql.SQL("SELECT " + _CONFIG_ROW + " FROM {} ORDER BY rule_key"
                        ).format(sql.Identifier(_table(CONFIG_TABLES, mode)))
        return [_iso(row) for row in self._run(lambda conn: conn.execute(query).fetchall())]

    def bulk_update_rule_configs(self, mode: str, rules: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Patch each rule (by rule_key) in ONE transaction; the rows that exist, as updated."""
        from psycopg import sql

        table = sql.Identifier(_table(CONFIG_TABLES, mode))

        def work(conn) -> list[dict[str, Any]]:
            updated = []
            for item in rules:
                rule_key = item.get("rule_key")
                if not rule_key:
                    continue
                sets: list[Any] = []
                params: list[Any] = []
                for column, convert in (("name", str), ("enabled", bool), ("criticality", lambda v: str(v).upper()),
                                        ("weight", int), ("rule_id", str)):
                    if item.get(column) is not None:
                        sets.append(sql.SQL("{} = %s").format(sql.Identifier(column)))
                        params.append(convert(item[column]))
                if sets:
                    sets.append(sql.SQL("updated_at = NOW()"))
                    query = sql.SQL("UPDATE {} SET {} WHERE rule_key = %s RETURNING " + _CONFIG_ROW).format(
                        table, sql.SQL(", ").join(sets))
                else:
                    query = sql.SQL("SELECT " + _CONFIG_ROW + " FROM {} WHERE rule_key = %s").format(table)
                row = conn.execute(query, (*params, rule_key)).fetchone()
                if row:
                    updated.append(_iso(row))
            return updated

        return self._run(work)

    # ------------------------------------------------------------------ results
    def save_rule_result(self, mode: str, *, application_id: int, participant_id: int, vendor_name: str | None,
                         evaluation: dict[str, Any], vendor_response: dict[str, Any], declared_address: str | None,
                         application_snapshot: dict[str, Any] | None = None,
                         participant_snapshot: dict[str, Any] | None = None,
                         address_snapshot: dict[str, Any] | None = None) -> int:
        """Persist an evaluation run into the mode's results table. Returns its id."""
        from psycopg import sql
        from psycopg.types.json import Jsonb

        query = sql.SQL("""
            INSERT INTO {} (
                application_id, participant_id, vendor_name, overall_recommendation, overall_criticality,
                risk_score, summary, rules_evaluated, rules_triggered, insights, rules, vendor_response,
                declared_address, application_snapshot, participant_snapshot, address_snapshot
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        """).format(sql.Identifier(_table(RESULT_TABLES, mode)))
        params = (
            application_id,
            participant_id,
            vendor_name,
            evaluation.get("overall_recommendation"),
            evaluation.get("overall_criticality"),
            evaluation.get("risk_score"),
            evaluation.get("summary"),
            evaluation.get("rules_evaluated"),
            evaluation.get("rules_triggered"),
            Jsonb(evaluation.get("insights") or []),
            Jsonb(evaluation.get("rules") or []),
            Jsonb(vendor_response or {}),
            declared_address,
            Jsonb(application_snapshot) if application_snapshot is not None else None,
            Jsonb(participant_snapshot) if participant_snapshot is not None else None,
            Jsonb(address_snapshot) if address_snapshot is not None else None,
        )
        row = self._run(lambda conn: conn.execute(query, params).fetchone())
        return int(row["id"])


def migrate() -> list[str]:
    """Apply the agent's migrations (setup / deployment; never per request). Returns the versions applied now."""
    from shared.db import apply_migrations, pg

    from agents.residence_office_verification.db.schema import MIGRATIONS

    conn = pg.connect(AGENT)
    try:
        return apply_migrations(conn, AGENT, MIGRATIONS)
    finally:
        conn.close()


__all__ = ["CONFIG_TABLES", "PostgresRepository", "RESULT_TABLES", "RepositoryUnavailable", "RuleRepository",
           "migrate"]
