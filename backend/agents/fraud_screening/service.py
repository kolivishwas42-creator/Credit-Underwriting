"""
The fraud screening use cases: evaluate an application, read the latest stored result, list / change the rules.

The service receives everything it talks to (DIP): the agent's repository, the LOS application source and the AML /
PEP watch-list source. No FastAPI, no SQL here.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from agents.fraud_screening.application_source import ApplicationSource
from agents.fraud_screening.config import Settings
from agents.fraud_screening.repository import FraudRepository
from agents.fraud_screening.rules import aml, engine, pep
from agents.fraud_screening.schemas import (FraudEvaluateRequest, FraudEvaluateResponse, RuleConfigOut,
                                            RuleConfigUpdate)
from agents.fraud_screening.watchlist import WatchlistSource


class NotFoundError(LookupError):
    """The application, result or rule does not exist (the message is the API's detail)."""


class RuleNotImplementableError(ValueError):
    """A rule the data model cannot evaluate was asked to be enabled."""


def applicant_for_screening(bundle: dict) -> dict:
    """The dict shape the AML / PEP comparison expects (Name, DOB, ...)."""
    primary = bundle.get("primary") or {}
    details = primary.get("details") or {}
    kyc = primary.get("kyc") or {}
    parts = [
        kyc.get("first_name") or details.get("first_name"),
        kyc.get("middle_name") or details.get("middle_name"),
        kyc.get("last_name") or details.get("last_name"),
    ]
    name = " ".join(p for p in parts if p) or (bundle.get("customer") or {}).get("full_name") or ""
    return {
        "Name": name,
        "DOB": str(kyc.get("date_of_birth") or details.get("date_of_birth") or ""),
        "PAN": kyc.get("pan_number") or "",
        "Aadhaar": kyc.get("aadhaar_number") or "",
        "Address": "",
    }


def fraud_warning(application_number: str, result: dict) -> str:
    if result["is_potential_fraud"]:
        text = (f"FRAUD WARNING ({result['risk_level']} risk): {len(result['flagged_rules'])} rule check(s) triggered "
                f"for application {application_number}. Review before approving.")
    else:
        text = "No fraud rules triggered."
    if result["skipped_rules"]:
        text += (f" Note: {len(result['skipped_rules'])} check(s) could not run "
                 f"(missing data or disabled rules).")
    return text


class FraudScreeningService:
    def __init__(self, repository: FraudRepository, applications: ApplicationSource, watchlist: WatchlistSource,
                 settings: Settings):
        self.repository = repository
        self.applications = applications
        self.watchlist = watchlist
        self.settings = settings

    # -- AML / PEP: a failure is reported inside the result, never fails the evaluation --------------------------------
    def run_aml(self, applicant: dict) -> Dict[str, Any]:
        try:
            payload, source = self.watchlist.aml(applicant)
            s = self.settings.aml
            return aml.screen(payload, applicant, self.settings.policy, s.no_record_status_codes,
                              threshold_percent=s.match_threshold_percent, source=source)
        except Exception as exc:  # noqa: BLE001 - shown to the reviewer as the AML error
            return {"error": str(exc), "status": "error"}

    def run_pep(self, applicant: dict) -> Dict[str, Any]:
        try:
            payload, source = self.watchlist.pep(applicant)
            s = self.settings.pep
            return pep.screen_pep(payload, applicant, self.settings.policy, s.no_record_status_codes,
                                  threshold_percent=s.match_threshold_percent, source=source)
        except Exception as exc:  # noqa: BLE001 - shown to the reviewer as the PEP error
            return {"error": str(exc), "status": "error"}

    # -- use cases -----------------------------------------------------------------------------------------------------
    def evaluate(self, req: FraudEvaluateRequest) -> FraudEvaluateResponse:
        bundle = self.applications.application_bundle(req.application_number)
        if not bundle:
            raise NotFoundError(f"Application '{req.application_number}' not found")
        application_id = bundle["application"]["application_id"]

        result = engine.evaluate(
            bundle,
            self.repository.load_rule_config(),
            self.applications.historical_identity(application_id),
            self.applications.historical_bank_accounts(application_id),
            self.applications.historical_addresses(application_id),
            self.settings.policy,
            historical_coapplicants=self.applications.historical_coapplicant_pans(application_id),
            historical_participants=self.applications.historical_participants(application_id),
        )

        aml_result: Optional[dict] = None
        pep_result: Optional[dict] = None
        if req.run_aml or req.run_pep:
            applicant = applicant_for_screening(bundle)
            if req.run_aml:
                aml_result = self.run_aml(applicant)
            if req.run_pep:
                pep_result = self.run_pep(applicant)

        warnings = [f"{r.get('rule')} [{r.get('severity')}] {r.get('name')}: {r.get('message')}"
                    for r in result["rule_results"] if r.get("triggered")]
        warning = fraud_warning(req.application_number, result)

        result_id = self.repository.save_result({
            "application_id": application_id,
            "application_number": req.application_number,
            "risk_level": result["risk_level"],
            "is_potential_fraud": result["is_potential_fraud"],
            "hybrid_flag": result.get("hybrid_flag", False),
            "fraud_warning": warning,
            "flagged_rules": result["flagged_rules"],
            "skipped_rules": result["skipped_rules"],
            "rule_results": result["rule_results"],
            "distances": result.get("distances"),
            "aml_result": aml_result,
            "pep_result": pep_result,
            "full_payload": {"primary": result.get("primary_snapshot"),
                             "coapplicant": result.get("coapplicant_snapshot")},
        })

        return FraudEvaluateResponse(
            application_number=req.application_number,
            application_id=application_id,
            result_id=result_id,
            risk_level=result["risk_level"],
            is_potential_fraud=result["is_potential_fraud"],
            hybrid_flag=result.get("hybrid_flag", False),
            fraud_warning=warning,
            flagged_rules=result["flagged_rules"],
            warnings=warnings,
            skipped_rules=result["skipped_rules"],
            rule_results=result["rule_results"],
            distances=result.get("distances") or {},
            aml=aml_result,
            pep=pep_result,
            primary_snapshot=result.get("primary_snapshot"),
            coapplicant_snapshot=result.get("coapplicant_snapshot"),
        )

    def latest_result(self, application_number: str) -> dict:
        row = self.repository.latest_result(application_number)
        if not row:
            raise NotFoundError("No fraud result stored for this application")
        return row

    def list_rules(self) -> List[RuleConfigOut]:
        return [RuleConfigOut(**r) for r in self.repository.list_rules()]

    def update_rule(self, rule_key: str, body: RuleConfigUpdate) -> RuleConfigOut:
        existing = self.repository.get_rule(rule_key)
        if not existing:
            raise NotFoundError("Rule not found")
        if body.enabled is True and not existing["is_implementable"]:
            raise RuleNotImplementableError(
                "This rule is not implementable with the current data model and cannot be enabled.")
        changes = {k: v for k, v in body.model_dump().items() if v is not None}
        return RuleConfigOut(**self.repository.update_rule(rule_key, changes))
