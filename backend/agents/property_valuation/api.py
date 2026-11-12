"""
THE PROPERTY VALUATION API (HTTP only) -- /api/v1/credit/property-valuation/...

main.py mounts `router` behind the LOS JWT (agents/registry.py). The database session comes from shared.db.sqla
(agent key "property_valuation"); the service receives its repository through get_repository / get_service, which
tests override.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.encoders import jsonable_encoder

from agents.property_valuation.config import AGENT, settings
from agents.property_valuation.repository import SqlPropertyValuationRepository
from agents.property_valuation.schemas import RuleConfigUpdate, ValuationSubmission
from agents.property_valuation.service import InvalidRequestError, NotFoundError, PropertyValuationService
from shared.db import sqla

logger = logging.getLogger("agents.property_valuation")

PREFIX = "/api/v1/credit/property-valuation"
router = APIRouter(prefix=PREFIX, tags=["Property Valuation"])

_session = sqla.session_dependency(AGENT)


def get_repository(db: Any = Depends(_session)) -> SqlPropertyValuationRepository:
    return SqlPropertyValuationRepository(db, settings().los_schema)


def get_service(repository: SqlPropertyValuationRepository = Depends(get_repository)) -> PropertyValuationService:
    return PropertyValuationService(repository)


@router.get("/health", include_in_schema=False)
def property_valuation_health() -> dict[str, str]:
    """What the screen's "Connected" badge calls."""
    return {"status": "ok"}


@router.get("/applications/{application_number}")
def get_application(application_number: str, service: PropertyValuationService = Depends(get_service)):
    try:
        return jsonable_encoder(service.application(application_number))
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from None
    except Exception as exc:
        logger.exception("Application lookup failed")
        raise HTTPException(status_code=500, detail="Unable to fetch application details. Verify the LOS schema and "
                                                    "database connection.") from exc


@router.post("/applications/{application_number}/properties/{property_id}/valuation")
def submit_valuation(application_number: str, property_id: int, payload: ValuationSubmission,
                     service: PropertyValuationService = Depends(get_service)):
    try:
        return jsonable_encoder(service.submit_valuation(application_number, property_id, payload.model_dump()))
    except InvalidRequestError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from None
    except Exception as exc:
        logger.exception("Valuation submission failed")
        raise HTTPException(status_code=500, detail="Unable to save vendor response or run the valuation rules. "
                                                    "Check server logs.") from exc


@router.get("/applications/{application_number}/history")
def valuation_history(application_number: str, collateral_property_id: int | None = None,
                      service: PropertyValuationService = Depends(get_service)):
    try:
        return jsonable_encoder(service.history(application_number, collateral_property_id))
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from None
    except Exception as exc:
        logger.exception("History lookup failed")
        raise HTTPException(status_code=500, detail="Unable to fetch valuation history.") from exc


@router.get("/rules")
def get_rules(service: PropertyValuationService = Depends(get_service)):
    return jsonable_encoder(service.rules())


@router.put("/rules/{rule_key}")
def update_rule(rule_key: str, payload: RuleConfigUpdate, service: PropertyValuationService = Depends(get_service)):
    try:
        return jsonable_encoder(service.update_rule(rule_key, payload.model_dump(exclude_unset=True)))
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from None


@router.get("/results/{application_number}")
def get_agent_results(application_number: str, service: PropertyValuationService = Depends(get_service)):
    try:
        return jsonable_encoder(service.results(application_number))
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from None


__all__ = ["PREFIX", "get_repository", "get_service", "router"]
