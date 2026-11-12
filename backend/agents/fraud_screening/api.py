"""
Fraud screening HTTP routes (HTTP only: status codes and models; the work is in service.py).

Mounted by main.py under /api/v1 behind the LOS token, so the full paths are /api/v1/credit/fraud-screening/...

    POST  /fraud/evaluate                        evaluate the rules (+ AML / PEP) for an application_number
    GET   /fraud/results/{application_number}    the latest stored result
    GET   /rules                                 the rule configuration
    PATCH /rules/{rule_key}                      enable / disable or change a rule
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import List

from fastapi import APIRouter, Depends, HTTPException

from agents.fraud_screening.application_source import PostgresApplicationSource
from agents.fraud_screening.config import get_settings
from agents.fraud_screening.repository import PostgresFraudRepository
from agents.fraud_screening.schemas import (FraudEvaluateRequest, FraudEvaluateResponse, RuleConfigOut,
                                            RuleConfigUpdate)
from agents.fraud_screening.service import FraudScreeningService, NotFoundError, RuleNotImplementableError
from agents.fraud_screening.watchlist import VendorOrSampleWatchlist

router = APIRouter(prefix="/credit/fraud-screening", tags=["Credit Underwriting"])


@lru_cache(maxsize=1)
def get_service() -> FraudScreeningService:
    """The composition root: the PostgreSQL repository and application source, the configured watch-list source.
    Nothing connects until a request uses it (tests override this dependency)."""
    settings = get_settings()
    return FraudScreeningService(
        repository=PostgresFraudRepository(),
        applications=PostgresApplicationSource(settings.loan_schema),
        watchlist=VendorOrSampleWatchlist(settings),
        settings=settings,
    )


@router.post("/fraud/evaluate", response_model=FraudEvaluateResponse)
def evaluate_application(req: FraudEvaluateRequest, service: FraudScreeningService = Depends(get_service)):
    """Load the application by `application_number`, run every enabled fraud rule, optionally AML + PEP, and store
    the result."""
    try:
        return service.evaluate(req)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from None


@router.get("/fraud/results/{application_number}")
def get_latest_result(application_number: str, service: FraudScreeningService = Depends(get_service)):
    try:
        return service.latest_result(application_number)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from None


@router.get("/rules", response_model=List[RuleConfigOut])
def list_rules(service: FraudScreeningService = Depends(get_service)):
    return service.list_rules()


@router.patch("/rules/{rule_key}", response_model=RuleConfigOut)
def update_rule(rule_key: str, body: RuleConfigUpdate, service: FraudScreeningService = Depends(get_service)):
    try:
        return service.update_rule(rule_key, body)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from None
    except RuleNotImplementableError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
