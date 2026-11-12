"""
The use cases of the residence / office verification agent. No FastAPI, no SQL: the repository is injected.

    verify(request)                       pick the participant's one address, run the rules, store the run, add the
                                          AI risk summary of the triggered rules (summary.py; never fails the run)
    list_rule_configs(mode)               the rule settings of RESIDENCE or OFFICE
    update_rule_configs(mode, rules)      bulk update (enabled, criticality, weight, name, rule_id)
"""

from __future__ import annotations

from typing import Any

from agents.residence_office_verification.config import Settings
from agents.residence_office_verification.repository import RuleRepository
from agents.residence_office_verification.rules import evaluate_rules
from agents.residence_office_verification.schemas import ResidenceVerificationRequest
from agents.residence_office_verification.summary import Summariser, summarise


class VerificationError(Exception):
    """A business outcome the caller must see (status_code, detail)."""

    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def full_name(row: dict[str, Any]) -> str | None:
    pieces = [row.get("salutation"), row.get("first_name"), row.get("middle_name"), row.get("last_name")]
    name = " ".join(str(p).strip() for p in pieces if p and str(p).strip())
    return name or row.get("customer_full_name")


def choose_residence_address(addresses: list[dict[str, Any]], accepted_types: tuple[str, ...]) -> dict[str, Any]:
    accepted = {value.casefold() for value in accepted_types}
    matches = [address for address in addresses
               if str(address.get("address_type") or "").strip().casefold() in accepted]
    if len(matches) == 0:
        raise VerificationError(422, "No directly linked residence address was found for this participant. "
                                     "Check applicant_addresses.address_type and residence_address_types in "
                                     "conf/settings.yaml.")
    if len(matches) > 1:
        raise VerificationError(409, "More than one residence address is linked to this participant. "
                                     "Resolve the address selection rule before running verification.")
    return matches[0]


def declared_address(address: dict[str, Any]) -> str | None:
    full = address.get("full_address")
    if full and str(full).strip():
        return str(full).strip()
    parts = [address.get("house_flat_number"), address.get("address_line_1"), address.get("address_line_2"),
             address.get("landmark_street"), address.get("city"), address.get("state"), address.get("pincode")]
    joined = ", ".join(str(p).strip() for p in parts if p and str(p).strip())
    return joined or None


class ResidenceVerificationService:
    def __init__(self, repository: RuleRepository, settings: Settings, summariser: Summariser | None = None):
        self._repo = repository
        self._settings = settings
        self._summariser = summariser             # None: no AI summary (ai_summary_source "off")

    def verify(self, request: ResidenceVerificationRequest) -> dict[str, Any]:
        repo = self._repo
        application = repo.fetch_application(request.application_id)
        if not application:
            raise VerificationError(404, "Application ID was not found.")

        participant = repo.fetch_participant(request.application_id, request.participant_id)
        if not participant:
            raise VerificationError(404, "Participant was not found under the supplied application ID.")

        address = choose_residence_address(repo.fetch_participant_addresses(request.participant_id),
                                           self._settings.residence_address_types)
        declared = declared_address(address)

        # enabled / weights / criticality from the database; the conf/ defaults when the table is empty
        rule_configs = repo.load_rule_configs(request.verification_type) or \
            self._settings.default_rules(request.verification_type)

        evaluation = evaluate_rules(
            vendor_response=request.vendor_response,
            declared_address=declared,
            verification_type=request.verification_type,
            rule_configs=rule_configs,
            default_rules=self._settings.rules,
            scoring=self._settings.scoring,
        )

        application_snapshot = {
            "application_id": application["application_id"],
            "application_number": application["application_number"],
            "stage": application["stage"],
            "status": application["status"],
        }
        participant_snapshot = {
            "participant_id": participant["participant_id"],
            "applicant_type": participant["applicant_type"],
            "applicant_category": participant["applicant_category"],
            "is_primary": participant["is_primary"],
            "name": full_name(participant),
            "mobile_number": participant.get("applicant_mobile_number") or participant.get("customer_mobile_number"),
        }
        address_snapshot = {
            "address_id": address["address_id"],
            "address_type": address["address_type"],
            "full_address": declared,
            "landmark_street": address.get("landmark_street"),
            "pincode": address.get("pincode"),
            "city": address.get("city"),
            "state": address.get("state"),
        }

        result_id = repo.save_rule_result(
            request.verification_type,
            application_id=request.application_id,
            participant_id=request.participant_id,
            vendor_name=request.vendor_name,
            evaluation=evaluation,
            vendor_response=request.vendor_response,
            declared_address=declared,
            application_snapshot=application_snapshot,
            participant_snapshot=participant_snapshot,
            address_snapshot=address_snapshot,
        )

        return {
            "result_id": result_id,
            "application": application_snapshot,
            "participant": participant_snapshot,
            "declared_address": address_snapshot,
            "vendor": {
                "name": request.vendor_name,
                "status": request.vendor_response.get("status"),
                "final_status": request.vendor_response.get("final_status"),
                "response_received": True,
            },
            # the AI risk summary of the triggered rules (not stored: it explains the stored evaluation)
            **summarise(evaluation, request.verification_type, self._settings.ai_summary, self._summariser),
            **evaluation,
        }

    def list_rule_configs(self, verification_type: str) -> dict[str, Any]:
        mode = verification_type.upper()
        return {"verification_type": mode, "rules": self._repo.list_rule_configs(mode)}

    def update_rule_configs(self, verification_type: str, rules: list[dict[str, Any]]) -> dict[str, Any]:
        updated = self._repo.bulk_update_rule_configs(verification_type, rules)
        if not updated:
            raise VerificationError(404, "No matching rule_key found for the given verification_type.")
        return {"verification_type": verification_type, "updated_count": len(updated), "rules": updated}
