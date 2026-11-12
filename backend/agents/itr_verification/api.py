"""
ITR verification -- HTTP only. Mounted by main.py under /api/v1 (with the LOS JWT dependency), so every path below is
/api/v1/credit/itr-verification/...

Upload a customer Input ITR and a vendor Output ITR (or name them by id in the configured document store, or send
already-extracted fields): the agent extracts PAN, Assessment Year, Acknowledgement Number, Total Income / GTI, Name,
... compares them with the rules in force and returns a match score, a decision (ACCEPT / REVIEW / REJECT) and
severity-tagged mismatches. Rules and thresholds are read / edited under /rules and /settings; every verification is
kept (/results).
"""

from __future__ import annotations

import logging
import threading
from typing import Any, Dict, List, NoReturn, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile

from .schemas import (VERSION, BulkRuleUpdateRequest, BulkSettingsUpdateRequest, ConfigResponse, HealthResponse,
                      RuleConfigItem, RuleConfigUpdateRequest, SystemSettingItem, SystemSettingUpdateRequest,
                      VerificationResponse, VerifyByIdsRequest)
from .service import DocumentRejected, ITRVerificationService, UploadedDocument, build_service
from .storage.base import DocumentNotFound

logger = logging.getLogger(__name__)

PREFIX = "/credit/itr-verification"
router = APIRouter(prefix=PREFIX, tags=["ITR Verification"])

_SERVICE: Optional[ITRVerificationService] = None
_SERVICE_LOCK = threading.Lock()


def get_service() -> ITRVerificationService:
    """The process-wide service (built on first use; tests override this dependency)."""
    global _SERVICE
    with _SERVICE_LOCK:
        if _SERVICE is None:
            _SERVICE = build_service()
        return _SERVICE


def _fail(what: str, exc: Exception) -> NoReturn:
    """A 500 that names the step and the error's kind -- the details go to the log, never to the response."""
    logger.exception("ITR verification: %s", what)
    raise HTTPException(status_code=500, detail=f"{what} ({type(exc).__name__})") from None


# ------------------------------------------------------------------------------------------------------------ info
@router.get("/", tags=["ITR Verification"])
def root() -> Dict[str, str]:
    return {"message": "ITR Verification Agent API", "health": "health", "config": "config", "rules": "rules",
            "settings": "settings", "results": "results"}


@router.get("/health", response_model=HealthResponse)
def health(service: ITRVerificationService = Depends(get_service)):
    config = service.current_config()
    return HealthResponse(status="ok", version=VERSION, accept_threshold=float(config["accept_threshold"]),
                          review_threshold=float(config["review_threshold"]),
                          supported_file_types=config["supported_file_types"], database=service.database_status())


@router.get("/config", response_model=ConfigResponse)
def get_config(service: ITRVerificationService = Depends(get_service)):
    """The comparison rules and thresholds in force."""
    return ConfigResponse(**service.current_config())


# ------------------------------------------------------------------------------------------------ rules / settings
@router.get("/rules", response_model=List[RuleConfigItem])
def list_rules(category: Optional[str] = Query(None, description="comparison | application"),
               service: ITRVerificationService = Depends(get_service)):
    try:
        return service.list_rules(category)
    except Exception as exc:  # noqa: BLE001
        _fail("Failed to load rules", exc)


@router.put("/rules", response_model=RuleConfigItem)
def update_rule(payload: RuleConfigUpdateRequest, service: ITRVerificationService = Depends(get_service)):
    """Create or update a single rule (matched by category + field)."""
    data = payload.model_dump(exclude_none=True)
    updated_by = data.pop("updated_by", "api")
    try:
        return service.upsert_rule(data, updated_by=updated_by or "api")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    except Exception as exc:  # noqa: BLE001
        _fail("Failed to save rule", exc)


@router.put("/rules/bulk", response_model=List[RuleConfigItem])
def update_rules_bulk(payload: BulkRuleUpdateRequest, service: ITRVerificationService = Depends(get_service)):
    """Bulk create/update rules (the Rules Config tab's Save All)."""
    try:
        items = []
        for rule in payload.rules:
            item = rule.model_dump(exclude_none=True)
            item.pop("updated_by", None)
            items.append(item)
        return service.bulk_upsert_rules(items, updated_by=payload.updated_by or "frontend")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    except Exception as exc:  # noqa: BLE001
        _fail("Bulk rule update failed", exc)


@router.post("/rules/reload")
def reload_rules(service: ITRVerificationService = Depends(get_service)):
    """Re-read rules + settings from the database into the running process."""
    try:
        service.reload_policy(strict=True)
    except Exception as exc:  # noqa: BLE001
        _fail("Rules could not be reloaded", exc)
    return {"status": "ok", "message": "Runtime config reloaded from database"}


@router.get("/settings", response_model=List[SystemSettingItem])
def list_settings(service: ITRVerificationService = Depends(get_service)):
    """Global thresholds and vendor-status policies."""
    try:
        return service.list_settings()
    except Exception as exc:  # noqa: BLE001
        _fail("Failed to load settings", exc)


@router.put("/settings", response_model=SystemSettingItem)
def update_setting(payload: SystemSettingUpdateRequest, service: ITRVerificationService = Depends(get_service)):
    value = payload.parsed_value if payload.parsed_value is not None else payload.setting_value
    try:
        return service.set_setting(key=payload.setting_key, value=value, value_type=payload.value_type,
                                   description=payload.description, updated_by=payload.updated_by or "api")
    except Exception as exc:  # noqa: BLE001
        _fail("Failed to save setting", exc)


@router.put("/settings/bulk", response_model=List[SystemSettingItem])
def update_settings_bulk(payload: BulkSettingsUpdateRequest, service: ITRVerificationService = Depends(get_service)):
    items = [{"setting_key": s.setting_key,
              "parsed_value": s.parsed_value if s.parsed_value is not None else s.setting_value,
              "value_type": s.value_type, "description": s.description} for s in payload.settings]
    try:
        return service.bulk_set_settings(items, updated_by=payload.updated_by or "frontend")
    except Exception as exc:  # noqa: BLE001
        _fail("Bulk settings update failed", exc)


# ------------------------------------------------------------------------------------------------------- results
@router.get("/results")
def list_results(limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0),
                 decision: Optional[str] = Query(None), pan_number: Optional[str] = Query(None),
                 service: ITRVerificationService = Depends(get_service)):
    """Stored verification runs, newest first."""
    try:
        return service.list_results(limit=limit, offset=offset, decision=decision, pan_number=pan_number)
    except Exception as exc:  # noqa: BLE001
        _fail("Failed to list results", exc)


@router.get("/results/{run_id}")
def get_result(run_id: str, service: ITRVerificationService = Depends(get_service)):
    try:
        row = service.get_result(run_id)
    except Exception as exc:  # noqa: BLE001
        _fail("Failed to load result", exc)
    if not row:
        raise HTTPException(status_code=404, detail="Result not found")
    return row


# -------------------------------------------------------------------------------------------------- verification
@router.post("/verify", response_model=VerificationResponse, summary="Verify Input vs Output ITR documents")
async def verify(input_doc: UploadFile = File(..., description="Customer Input ITR (PDF / image)"),
                 output_doc: UploadFile = File(..., description="Vendor Output ITR (PDF / image)"),
                 return_raw: bool = Query(False, description="Include raw OCR text in response"),
                 service: ITRVerificationService = Depends(get_service)):
    docs = [UploadedDocument(f.filename or "", await f.read()) for f in (input_doc, output_doc)]
    try:
        return service.verify_uploads(docs[0], docs[1], return_raw=return_raw)
    except (DocumentRejected, FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    except Exception as exc:  # noqa: BLE001
        _fail("Verification error", exc)


@router.post("/verify/by-ids", response_model=VerificationResponse,
             summary="Verify using document IDs / filenames (no file upload)")
def verify_by_ids(payload: VerifyByIdsRequest, service: ITRVerificationService = Depends(get_service)):
    try:
        return service.verify_by_ids(payload)
    except (DocumentNotFound, FileNotFoundError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None


@router.post("/verify/fields", response_model=VerificationResponse,
             summary="Verify using pre-extracted field JSON (no file upload)")
def verify_fields(payload: Dict[str, Any], service: ITRVerificationService = Depends(get_service)):
    try:
        return service.verify_fields(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    except Exception as exc:  # noqa: BLE001
        _fail("Field verification failed", exc)


__all__ = ["PREFIX", "get_service", "router"]
