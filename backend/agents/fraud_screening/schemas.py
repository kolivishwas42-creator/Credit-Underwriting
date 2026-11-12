"""Request / response models of the fraud screening API (shared by api.py and service.py)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class RuleConfigUpdate(BaseModel):
    enabled: Optional[bool] = None
    severity: Optional[str] = None
    description: Optional[str] = None
    config_json: Optional[Dict[str, Any]] = None


class RuleConfigOut(BaseModel):
    rule_key: str
    rule_id: str
    rule_name: str
    description: Optional[str] = None
    severity: str
    enabled: bool
    is_implementable: bool
    config_json: Dict[str, Any] = Field(default_factory=dict)
    sort_order: int = 0


class FraudEvaluateRequest(BaseModel):
    application_number: str
    run_aml: bool = True
    run_pep: bool = True


class RuleResultOut(BaseModel):
    rule_key: str
    rule: Optional[str] = None
    name: Optional[str] = None
    severity: Optional[str] = None
    triggered: bool = False
    enabled: bool = True
    message: Optional[str] = None


class FraudEvaluateResponse(BaseModel):
    application_number: str
    application_id: Optional[int] = None
    result_id: Optional[int] = None
    risk_level: str
    is_potential_fraud: bool
    hybrid_flag: bool = False
    fraud_warning: str
    flagged_rules: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    skipped_rules: List[str] = Field(default_factory=list)
    rule_results: List[Dict[str, Any]] = Field(default_factory=list)
    distances: Dict[str, Any] = Field(default_factory=dict)
    aml: Optional[Dict[str, Any]] = None
    pep: Optional[Dict[str, Any]] = None
    primary_snapshot: Optional[Dict[str, Any]] = None
    coapplicant_snapshot: Optional[Dict[str, Any]] = None
