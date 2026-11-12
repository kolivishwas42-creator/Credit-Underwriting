"""
THE PROPERTY VALUATION DATABASE.

    PropertyValuationRepository     what the service needs (a Protocol; tests use a fake)
    SqlPropertyValuationRepository  PostgreSQL through a SQLAlchemy Session of shared.db.sqla ("property_valuation"):
                                    the agent's tables unqualified (search_path), the LOS application / property
                                    tables read only from the configured LOS schema (conf/settings.yaml los.schema)
"""

from __future__ import annotations

from typing import Any, Protocol

from sqlalchemy import desc, select, text

from agents.property_valuation.db.models import (PropertyValuationAgentResult, PropertyValuationRuleConfig,
                                                 PropertyValuationVerification)

RULE_FIELDS = ("rule_key", "original_id", "name", "description", "enabled", "sequence", "severity", "fields",
               "settings")
VERIFICATION_FIELDS = ("verification_id", "application_id", "collateral_property_id", "vendor_name",
                       "verification_type", "vendor_status", "submitted_data", "vendor_response", "verified_at",
                       "created_at")
RESULT_FIELDS = ("result_id", "application_id", "collateral_property_id", "verification_id", "agent_version",
                 "vendor_status", "agent_status", "total_rules_checked", "total_rules_passed", "total_rules_triggered",
                 "critical_issues_count", "major_issues_count", "minor_issues_count", "key_insights", "risk_factors",
                 "recommended_actions", "created_at")


class PropertyValuationRepository(Protocol):
    def application_rows(self, application_number: str) -> list[dict[str, Any]]:
        """One row per collateral property of the application (applicant + property columns), each with its
        `documents`; [] when the application number is unknown or has no property."""

    def seed_missing_rules(self, defaults: dict[str, dict[str, Any]]) -> int:
        """Insert every default rule that has no row yet; existing rows are never changed. Returns rows added."""

    def rule_configs(self) -> list[dict[str, Any]]:
        """Every saved rule (RULE_FIELDS), ordered by sequence."""

    def update_rule(self, rule_key: str, updates: dict[str, Any]) -> dict[str, Any] | None:
        """Apply the updates to one rule; the saved rule, or None when there is no such rule."""

    def save_run(self, verification: dict[str, Any], result: dict[str, Any]) -> tuple[int, int]:
        """Store one vendor visit and the agent result it produced (one transaction): (verification_id, result_id)."""

    def verifications(self, application_id: int, collateral_property_id: int | None = None) -> list[dict[str, Any]]:
        """The application's vendor visits, newest first (optionally one property's)."""

    def results(self, application_id: int) -> list[dict[str, Any]]:
        """The application's agent results, newest first."""


def _row(obj: Any, fields: tuple[str, ...]) -> dict[str, Any]:
    return {name: getattr(obj, name) for name in fields}


class SqlPropertyValuationRepository:
    """The PostgreSQL implementation over one request's Session."""

    def __init__(self, session: Any, los_schema: str):
        if not los_schema.isidentifier():
            raise ValueError("the LOS schema must be an identifier")
        self._db = session
        los = los_schema
        self._application_sql = text(f"""
SELECT
    la.application_id,
    la.application_number,
    COALESCE(
        NULLIF(TRIM(CONCAT_WS(' ', iad.first_name, iad.middle_name, iad.last_name)), ''),
        NULLIF(TRIM(niad.company_name), ''),
        NULLIF(TRIM(c.full_name), '')
    ) AS applicant_name,
    COALESCE(pak.pan_number, c.pan_number) AS applicant_pan,
    cp.collateral_property_id,
    cp.property_owner,
    cp.owner_first_name,
    cp.owner_middle_name,
    cp.owner_last_name,
    cp.collateral_usage,
    cp.collateral_type,
    cp.property_categorization,
    cp.collateral_status,
    cp.property_ownership,
    cp.property_type,
    cp.house_flat_number,
    cp.address_line_1,
    cp.address_line_2,
    cp.landmark,
    cp.pincode,
    cp.city,
    cp.state
FROM {los}.loan_applications la
JOIN {los}.collateral_properties cp ON cp.application_id = la.application_id
LEFT JOIN {los}.application_participants ap
    ON ap.application_id = la.application_id AND ap.is_primary = TRUE
LEFT JOIN {los}.individual_applicant_details iad ON iad.participant_id = ap.participant_id
LEFT JOIN {los}.non_individual_applicant_details niad ON niad.participant_id = ap.participant_id
LEFT JOIN {los}.customers c ON c.customer_id = COALESCE(ap.customer_id, la.customer_id)
LEFT JOIN {los}.primary_applicant_kyc pak ON pak.application_id = la.application_id
WHERE la.application_number = :application_number
ORDER BY cp.collateral_property_id
""")
        self._documents_sql = text(f"""
SELECT document_id, document_name, file_name, content_type, uploaded_at
FROM {los}.collateral_property_documents
WHERE collateral_property_id = :collateral_property_id
ORDER BY uploaded_at DESC
""")

    # ------------------------------------------------------------------ LOS (read only)
    def application_rows(self, application_number: str) -> list[dict[str, Any]]:
        rows = self._db.execute(self._application_sql, {"application_number": application_number}).mappings().all()
        out = []
        for row in rows:
            item = dict(row)
            docs = self._db.execute(self._documents_sql,
                                    {"collateral_property_id": item["collateral_property_id"]}).mappings().all()
            item["documents"] = [dict(d) for d in docs]
            out.append(item)
        return out

    # ------------------------------------------------------------------ rule configuration
    def seed_missing_rules(self, defaults: dict[str, dict[str, Any]]) -> int:
        existing = set(self._db.execute(select(PropertyValuationRuleConfig.rule_key)).scalars().all())
        added = 0
        for key, cfg in defaults.items():
            if key in existing:
                continue
            self._db.add(PropertyValuationRuleConfig(
                rule_key=key,
                original_id=cfg.get("original_id", key),
                name=cfg.get("name", key),
                description=cfg.get("name", key),
                enabled=cfg.get("enabled", True),
                sequence=cfg.get("sequence", 999),
                severity=cfg.get("severity", "MAJOR"),
                fields=cfg.get("fields", {}),
                settings=cfg.get("settings", {}),
            ))
            added += 1
        if added:
            self._db.commit()
        return added

    def rule_configs(self) -> list[dict[str, Any]]:
        rows = self._db.execute(select(PropertyValuationRuleConfig)
                                .order_by(PropertyValuationRuleConfig.sequence)).scalars().all()
        return [_row(r, RULE_FIELDS) for r in rows]

    def update_rule(self, rule_key: str, updates: dict[str, Any]) -> dict[str, Any] | None:
        row = self._db.get(PropertyValuationRuleConfig, rule_key)
        if row is None:
            return None
        for key, value in updates.items():
            setattr(row, key, value)
        self._db.commit()
        self._db.refresh(row)
        return _row(row, RULE_FIELDS)

    # ------------------------------------------------------------------ visits and results
    def save_run(self, verification: dict[str, Any], result: dict[str, Any]) -> tuple[int, int]:
        visit = PropertyValuationVerification(**verification)
        self._db.add(visit)
        self._db.flush()
        outcome = PropertyValuationAgentResult(**result, verification_id=visit.verification_id)
        self._db.add(outcome)
        self._db.commit()
        self._db.refresh(visit)
        self._db.refresh(outcome)
        return visit.verification_id, outcome.result_id

    def verifications(self, application_id: int, collateral_property_id: int | None = None) -> list[dict[str, Any]]:
        q = select(PropertyValuationVerification).where(PropertyValuationVerification.application_id == application_id)
        if collateral_property_id is not None:
            q = q.where(PropertyValuationVerification.collateral_property_id == collateral_property_id)
        rows = self._db.execute(q.order_by(desc(PropertyValuationVerification.created_at))).scalars().all()
        return [_row(v, VERIFICATION_FIELDS) for v in rows]

    def results(self, application_id: int) -> list[dict[str, Any]]:
        rows = self._db.execute(
            select(PropertyValuationAgentResult).where(PropertyValuationAgentResult.application_id == application_id)
            .order_by(desc(PropertyValuationAgentResult.created_at))
        ).scalars().all()
        return [_row(r, RESULT_FIELDS) for r in rows]


__all__ = ["PropertyValuationRepository", "SqlPropertyValuationRepository"]
