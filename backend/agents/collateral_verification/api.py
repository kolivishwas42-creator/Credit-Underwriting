"""
The HTTP surface of the collateral verification agent (mounted by main.py behind the LOS JWT).

    GET  /api/v1/credit/collateral-verification/health
    GET  /api/v1/credit/collateral-verification/config
    GET  /api/v1/credit/collateral-verification/rules            PUT .../rules   PUT .../rules/bulk   POST .../rules/reload
    GET  /api/v1/credit/collateral-verification/settings         PUT .../settings   PUT .../settings/bulk
    GET  /api/v1/credit/collateral-verification/results
    POST /api/v1/credit/collateral-verification/collateral/extract-only
    POST /api/v1/credit/collateral-verification/collateral/verify
"""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile

from agents.collateral_verification.extract import DocumentExtractor
from agents.collateral_verification.repository import PostgresCollateralRepository
from agents.collateral_verification.schemas import BulkRulesUpdate, BulkSettingsUpdate, RuleUpdate, SettingUpdate
from agents.collateral_verification.service import CollateralVerificationService, InvalidRequest, NotFound
from shared.db.core import AgentDbError

logger = logging.getLogger(__name__)

PREFIX = "/api/v1/credit/collateral-verification"
router = APIRouter(prefix=PREFIX, tags=["Collateral verification"])


@lru_cache(maxsize=1)
def get_service() -> CollateralVerificationService:
    """The process-wide service (its tables migrated and its configuration loaded on first use)."""
    service = CollateralVerificationService(PostgresCollateralRepository(), DocumentExtractor())
    service.start()
    return service


def _failed(what: str, exc: Exception) -> HTTPException:
    """A database / unexpected failure as an HTTP error -- the exception type in the log, never its text."""
    if isinstance(exc, AgentDbError):
        return HTTPException(status_code=503, detail="The collateral verification database is not available")
    logger.warning("collateral verification: %s failed (%s)", what, type(exc).__name__)
    return HTTPException(status_code=500, detail=what)


@router.get("/health")
def health(service: CollateralVerificationService = Depends(get_service)) -> dict[str, Any]:
    return service.health()


@router.get("/config")
def get_config(service: CollateralVerificationService = Depends(get_service)) -> dict[str, Any]:
    return service.config_view()


@router.get("/rules")
def list_rules(service: CollateralVerificationService = Depends(get_service)) -> list[dict]:
    try:
        return service.list_rules()
    except Exception as exc:  # noqa: BLE001
        raise _failed("Failed to load rules", exc) from None


@router.put("/rules")
def update_rule(payload: RuleUpdate, updated_by: str = Query("api"),
                service: CollateralVerificationService = Depends(get_service)) -> dict:
    try:
        return service.update_rule(payload.model_dump(exclude_none=True), updated_by)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    except Exception as exc:  # noqa: BLE001
        raise _failed("Failed to save rule", exc) from None


@router.put("/rules/bulk")
def update_rules_bulk(payload: BulkRulesUpdate,
                      service: CollateralVerificationService = Depends(get_service)) -> list[dict]:
    try:
        return service.update_rules([r.model_dump(exclude_none=True) for r in payload.rules],
                                    payload.updated_by or "frontend")
    except Exception as exc:  # noqa: BLE001
        raise _failed("Bulk rule update failed", exc) from None


@router.post("/rules/reload")
def reload_rules(service: CollateralVerificationService = Depends(get_service)) -> dict[str, str]:
    service.reload()
    return {"status": "ok", "message": "Runtime config reloaded from database"}


@router.get("/settings")
def list_settings(service: CollateralVerificationService = Depends(get_service)) -> list[dict]:
    try:
        return service.list_settings()
    except Exception as exc:  # noqa: BLE001
        raise _failed("Failed to load settings", exc) from None


@router.put("/settings")
def update_setting(payload: SettingUpdate, updated_by: str = Query("api"),
                   service: CollateralVerificationService = Depends(get_service)) -> dict:
    try:
        return service.update_setting(payload.setting_key, payload.value(), payload.value_type, payload.description,
                                      updated_by)
    except Exception as exc:  # noqa: BLE001
        raise _failed("Failed to save setting", exc) from None


@router.put("/settings/bulk")
def update_settings_bulk(payload: BulkSettingsUpdate,
                         service: CollateralVerificationService = Depends(get_service)) -> list[dict]:
    items = [{"setting_key": s.setting_key, "value": s.value(), "value_type": s.value_type,
              "description": s.description} for s in payload.settings]
    try:
        return service.update_settings(items, payload.updated_by or "frontend")
    except Exception as exc:  # noqa: BLE001
        raise _failed("Bulk settings update failed", exc) from None


@router.get("/results")
def list_results(limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0),
                 application_number: Optional[str] = None,
                 service: CollateralVerificationService = Depends(get_service)) -> list[dict]:
    try:
        return service.list_results(limit, offset, application_number)
    except Exception as exc:  # noqa: BLE001
        raise _failed("Failed to list results", exc) from None


@router.post("/collateral/extract-only")
async def extract_only(file: UploadFile = File(...),
                       service: CollateralVerificationService = Depends(get_service)) -> dict:
    data = await file.read()
    return service.extract_only(file.filename or "report.pdf", data)


@router.post("/collateral/verify")
async def verify(final_status: str = Form(...), application_id: Optional[str] = Form(None),
                 application_number: Optional[str] = Form(None), report: Optional[UploadFile] = File(None),
                 service: CollateralVerificationService = Depends(get_service)) -> dict:
    if report is None:
        raise HTTPException(status_code=422, detail="Attach a PDF, image, or ODG report")
    data = await report.read()
    if not data:
        raise HTTPException(status_code=422, detail="Uploaded report is empty")
    try:
        return service.verify(application_id, application_number, final_status, report.filename or "report", data)
    except InvalidRequest as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    except NotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from None
    except AgentDbError as exc:
        raise _failed("Collateral verification failed", exc) from None


__all__ = ["PREFIX", "get_service", "router"]
