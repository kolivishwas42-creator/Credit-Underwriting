"""
Residence / office verification API -- under Credit Underwriting: /api/v1/credit/residence-office-verification
(main.py mounts this router under /api/v1 with the LOS token, like every agent).

    GET  /applications/{application_number}/participants   the application and its people (e.g. LOS-DUMMY-0045)
    POST /residence-verification      evaluate the vendor response against the declared address; stores the run;
                                      adds ai_summary (the local model explains the triggered rules)
    GET  /rule-configs?verification_type=RESIDENCE|OFFICE
    PUT  /rule-configs                bulk update of the rule settings

HTTP only: the use cases are in service.py, the SQL in repository.py, the rules in rules/.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from agents.residence_office_verification.config import get_settings
from agents.residence_office_verification.repository import PostgresRepository, RepositoryUnavailable
from agents.residence_office_verification.schemas import ResidenceVerificationRequest, RuleConfigBulkUpdate
from agents.residence_office_verification.service import ResidenceVerificationService, VerificationError
from agents.residence_office_verification.summary import OllamaSummariser

router = APIRouter(prefix="/credit/residence-office-verification", tags=["Credit Underwriting"])


def get_service() -> ResidenceVerificationService:
    settings = get_settings()
    ai = settings.ai_summary
    return ResidenceVerificationService(PostgresRepository(settings.los_source_schema), settings,
                                        OllamaSummariser(ai) if ai and ai.enabled else None)


def _unavailable(exc: RepositoryUnavailable, detail: str) -> HTTPException:
    return HTTPException(status_code=503, detail=str(exc) if exc.configuration else detail)


@router.get("/applications/{application_number}/participants")
def application_participants(application_number: str,
                             service: ResidenceVerificationService = Depends(get_service)) -> dict[str, Any]:
    """Look an application up by its number; returns its id and its participants (id, name, type, primary)."""
    try:
        return service.participants_of(application_number)
    except VerificationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    except RepositoryUnavailable as exc:
        raise _unavailable(exc, "Database connection/query failed while loading the application.") from exc


@router.post("/residence-verification")
def residence_verification(request: ResidenceVerificationRequest,
                           service: ResidenceVerificationService = Depends(get_service)) -> dict[str, Any]:
    try:
        return service.verify(request)
    except VerificationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    except RepositoryUnavailable as exc:
        raise _unavailable(exc, "Database connection/query failed. Check the agent's database configuration, "
                                "schema, and database access.") from exc


@router.get("/rule-configs")
def get_rule_configs(verification_type: str = Query("RESIDENCE", pattern="^(?i)(RESIDENCE|OFFICE)$"),
                     service: ResidenceVerificationService = Depends(get_service)) -> dict[str, Any]:
    """List rule configs for RESIDENCE or OFFICE from the DB."""
    try:
        return service.list_rule_configs(verification_type)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RepositoryUnavailable as exc:
        raise _unavailable(exc, "Database connection/query failed while loading rule configs.") from exc


@router.put("/rule-configs")
def put_rule_configs(body: RuleConfigBulkUpdate,
                     service: ResidenceVerificationService = Depends(get_service)) -> dict[str, Any]:
    """Bulk-update rule configs (enabled, criticality, weight, name, rule_id); used on the next verification run."""
    try:
        return service.update_rule_configs(body.verification_type,
                                           [r.model_dump(exclude_none=True) for r in body.rules])
    except VerificationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RepositoryUnavailable as exc:
        raise _unavailable(exc, "Database connection/query failed while updating rule configs.") from exc
