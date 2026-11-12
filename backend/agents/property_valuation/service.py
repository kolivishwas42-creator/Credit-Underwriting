"""
THE PROPERTY VALUATION USE CASES -- orchestrates the repository (injected) and the pure rules. No FastAPI, no SQL.

    application(number)                 the applicant, the linked properties, each with its vendor-request prefill
    submit_valuation(number, id, body)  store the vendor visit, run the enabled rules, store the agent summary
    history(number, property_id)        vendor visits + agent results of an application
    results(number)                     the saved agent summaries
    rules() / update_rule(key, changes) the live rule configuration (seeded from conf/rules.yaml)
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from agents.property_valuation.config import Settings, settings as load_settings
from agents.property_valuation.repository import PropertyValuationRepository
from agents.property_valuation.rules import (build_agent_summary, build_rule_inputs, build_vendor_request,
                                             evaluate_property_records, normalize_vendor_status)

#: the rule-row keys the engine takes over from a saved rule
_ENGINE_RULE_KEYS = ("original_id", "name", "enabled", "sequence", "severity", "fields", "settings")
#: what GET /history lists of a vendor visit / an agent result
_HISTORY_VISIT = ("verification_id", "collateral_property_id", "vendor_name", "verification_type", "vendor_status",
                  "created_at")
_HISTORY_RESULT = ("result_id", "verification_id", "collateral_property_id", "agent_status", "vendor_status",
                   "total_rules_checked", "total_rules_triggered", "critical_issues_count", "major_issues_count",
                   "minor_issues_count", "key_insights", "risk_factors", "recommended_actions", "created_at")
#: what GET /results lists of an agent result
_RESULT = ("result_id", "collateral_property_id", "verification_id", "vendor_status", "agent_status",
           "total_rules_checked", "total_rules_passed", "total_rules_triggered", "critical_issues_count",
           "major_issues_count", "minor_issues_count", "key_insights", "risk_factors", "recommended_actions",
           "created_at")


class NotFoundError(LookupError):
    """The application, property or rule does not exist (the message is the API's detail)."""


class InvalidRequestError(ValueError):
    """The request contradicts itself (the message is the API's detail)."""


def _pick(row: dict[str, Any], fields: tuple[str, ...]) -> dict[str, Any]:
    return {name: row.get(name) for name in fields}


def _parse_verified_at(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


class PropertyValuationService:
    def __init__(self, repository: PropertyValuationRepository, settings: Settings | None = None):
        self._repo = repository
        self._settings = settings or load_settings()

    # ------------------------------------------------------------------ application
    def _context(self, application_number: str) -> dict[str, Any] | None:
        rows = self._repo.application_rows(application_number.strip())
        if not rows:
            return None
        first = rows[0]
        return {
            "application_id": first["application_id"],
            "application_number": first["application_number"],
            "applicant_name": first["applicant_name"],
            "applicant_pan": first["applicant_pan"],
            "properties": rows,
        }

    def _require_context(self, application_number: str) -> dict[str, Any]:
        context = self._context(application_number)
        if not context:
            raise NotFoundError("Application number not found.")
        return context

    def application(self, application_number: str) -> dict[str, Any]:
        context = self._context(application_number)
        if not context:
            raise NotFoundError("Application number not found or no property is linked to it.")
        for prop in context["properties"]:
            prop["vendor_request_prefill"] = build_vendor_request(prop, context.get("applicant_name"),
                                                                  context.get("applicant_pan"))
        return context

    # ------------------------------------------------------------------ valuation run
    def submit_valuation(self, application_number: str, property_id: int, submission: dict[str, Any]) -> dict[str, Any]:
        if submission.get("collateral_property_id") != property_id:
            raise InvalidRequestError("collateral_property_id in body does not match URL.")
        context = self._require_context(application_number)
        prop = next((p for p in context["properties"] if p["collateral_property_id"] == property_id), None)
        if not prop:
            raise NotFoundError("Property does not belong to this application.")
        return self._evaluate_and_save(context["application_id"], prop, context.get("applicant_name") or "",
                                       context.get("applicant_pan"), submission)

    def _evaluate_and_save(self, application_id: int, property_row: dict[str, Any], applicant_name: str,
                           applicant_pan: str | None, submission: dict[str, Any]) -> dict[str, Any]:
        vendor_response = submission.get("vendor_response") or {}
        submitted_data = submission.get("submitted_data") or {}
        status = normalize_vendor_status(vendor_response)
        property_id = property_row["collateral_property_id"]

        registration, valuation = build_rule_inputs(property_row, applicant_name, applicant_pan, submitted_data,
                                                    vendor_response)
        evaluation = evaluate_property_records(
            reference_id=f"APP-{application_id}-PROP-{property_id}",
            registration=registration,
            valuation=valuation,
            rule_configs=self._engine_rule_configs(),
            default_rules=self._settings.rules,
            default_settings=self._settings.engine,
        )
        summary = build_agent_summary(evaluation)

        verification_id, result_id = self._repo.save_run(
            verification={
                "application_id": application_id,
                "collateral_property_id": property_id,
                "vendor_name": submission.get("vendor_name") or self._settings.default_vendor_name,
                "verification_type": submission.get("verification_type") or "INITIAL_VISIT",
                "vendor_status": status,
                "submitted_data": submitted_data,
                "vendor_response": vendor_response,
                "verified_at": _parse_verified_at(submission.get("verified_at")),
            },
            result={
                "application_id": application_id,
                "collateral_property_id": property_id,
                "agent_version": self._settings.agent_version,
                "vendor_status": status,
                **{key: summary[key] for key in (
                    "agent_status", "total_rules_checked", "total_rules_passed", "total_rules_triggered",
                    "critical_issues_count", "major_issues_count", "minor_issues_count", "key_insights",
                    "risk_factors", "recommended_actions")},
            },
        )
        return {
            "verification_id": verification_id,
            "result_id": result_id,
            "vendor_status": status,
            "summary": summary,
            "evaluation": evaluation,
        }

    def _engine_rule_configs(self) -> dict[str, dict[str, Any]]:
        self._repo.seed_missing_rules(self._settings.rules)
        return {row["rule_key"]: {key: (row.get(key) or {}) if key in ("fields", "settings") else row.get(key)
                                  for key in _ENGINE_RULE_KEYS}
                for row in self._repo.rule_configs()}

    # ------------------------------------------------------------------ history
    def history(self, application_number: str, collateral_property_id: int | None = None) -> dict[str, Any]:
        context = self._require_context(application_number)
        visits = self._repo.verifications(context["application_id"], collateral_property_id or None)
        results = self._repo.results(context["application_id"])
        return {
            "verifications": [_pick(v, _HISTORY_VISIT) for v in visits],
            "agent_results": [_pick(r, _HISTORY_RESULT) for r in results],
        }

    def results(self, application_number: str) -> list[dict[str, Any]]:
        context = self._require_context(application_number)
        return [_pick(r, _RESULT) for r in self._repo.results(context["application_id"])]

    # ------------------------------------------------------------------ rule configuration
    def rules(self) -> list[dict[str, Any]]:
        self._repo.seed_missing_rules(self._settings.rules)
        return [self._rule_view(r) for r in self._repo.rule_configs()]

    def update_rule(self, rule_key: str, updates: dict[str, Any]) -> dict[str, Any]:
        self._repo.seed_missing_rules(self._settings.rules)
        row = self._repo.update_rule(rule_key, updates)
        if row is None:
            raise NotFoundError("Rule not found.")
        return self._rule_view(row)

    @staticmethod
    def _rule_view(row: dict[str, Any]) -> dict[str, Any]:
        view = {key: row.get(key) for key in ("rule_key", "original_id", "name", "description", "enabled",
                                              "sequence", "severity")}
        view["fields"] = row.get("fields") or {}
        view["settings"] = row.get("settings") or {}
        return view


__all__ = ["InvalidRequestError", "NotFoundError", "PropertyValuationService"]
