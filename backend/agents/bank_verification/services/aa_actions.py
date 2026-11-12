"""
The two actions of a case WITH Account Aggregator data (owner 2026-10-30: "AA success: waive and retrigger; AA fail:
run verification").

    waive       the bank verification is not needed -- the AA data came from the bank itself. A reason is required;
                the case becomes WAIVED (a final status: nothing more is done on it); who, when and why are audited.
    retrigger   the eight checks run again on the case's AA data (the details as the officer corrected them, when he
                did), with the statement on file compared too; audited as AA_RETRIGGERED.

Both refuse a case without AA data (AA_ONLY), a final case (CASE_FINALIZED) and one whose statement is being read.
"""

from __future__ import annotations

from typing import Any

from agents.bank_verification.config import section
from agents.bank_verification.repository import Repository
from agents.bank_verification.schemas import EnteredDetails, Mode, ProcessRequest
from agents.bank_verification.services import verification_service
from agents.bank_verification.services.verification_service import ServiceError

WAIVED = "WAIVED"


def _aa_case(repo: Repository, case_id: str) -> dict[str, Any]:
    """The case, open and with AA data -- or the reason it cannot take an AA action."""
    verification_service.heal(repo, case_id)
    case = repo.case(case_id)
    if case is None or case.get("historical"):
        raise ServiceError(404, "CASE_NOT_FOUND", case_id=case_id)
    if case["status"] == verification_service.READING:
        raise ServiceError(409, "STATEMENT_BEING_READ")
    if case["status"] in verification_service.FINAL:
        raise ServiceError(409, "CASE_FINALIZED", case_id=case_id, status=case["status"])
    if case.get("mode") != Mode.AA_SUCCESS.value or not repo.latest_source(case_id, "AA"):
        raise ServiceError(409, "AA_ONLY")
    return case


def waive(repo: Repository, case_id: str, reason: str, *, actor: str) -> dict[str, Any]:
    reason = " ".join(str(reason or "").split())[: int((section("waive") or {}).get("reason_max", 1000))]
    if not reason:
        raise ServiceError(422, "WAIVE_REASON_REQUIRED")
    _aa_case(repo, case_id)
    repo.update_case(case_id, status=WAIVED)
    repo.audit(case_id, actor, "BANK_VERIFICATION_WAIVED", {"reason": reason})
    return {"case_id": case_id, "status": WAIVED}


def retrigger(repo: Repository, case_id: str, *, actor: str, entered: EnteredDetails | None = None) -> dict[str, Any]:
    case = _aa_case(repo, case_id)
    on_file = bool(repo.documents(case_id, "STATEMENT"))
    request = ProcessRequest(case_id=case_id, mode=Mode.AA_SUCCESS, statement_source="ON_FILE" if on_file else "NONE",
                             entered=entered, agency_id=case.get("assigned_agency"))
    repo.audit(case_id, actor, "AA_RETRIGGERED", {"statement_on_file": on_file})
    return verification_service.submit(repo, request, upload=None, actor=actor, idempotency_key=None)


__all__ = ["WAIVED", "retrigger", "waive"]
