"""Request / response models of the ITR verification API (shared by api and service)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class MismatchItem(BaseModel):
    field: str
    input: Optional[Any] = None
    output: Optional[Any] = None
    severity: str
    message: str


class FieldResultItem(BaseModel):
    field: str
    input_value: Optional[Any] = None
    output_value: Optional[Any] = None
    matched: bool
    score: float
    weight: float
    weighted_score: float
    severity: str
    description: str
    message: str


class VerifyByIdsRequest(BaseModel):
    input_doc_id: str = Field(..., description="Filename or ID of the customer Input ITR document")
    output_doc_id: str = Field(..., description="Filename or ID of the vendor Output ITR document")
    pan_number: Optional[str] = Field(None, description="PAN supplied by customer at loan application")
    assessment_year: Optional[str] = Field(None, description="Assessment year supplied by customer at loan application")
    gti_income: Optional[float] = Field(None, ge=0,
                                        description="Gross Total Income supplied by customer at loan application")
    applicant_name: Optional[str] = Field(None, description="Applicant name supplied at loan application")
    address: Optional[str] = Field(None, description="Address / city supplied at loan application")
    final_status: Optional[str] = Field(None, description="Vendor-selected final status; configured aliases "
                                                          "determine approval/rejection")


class VerificationResponse(BaseModel):
    decision: str = Field(..., description="ACCEPT | REVIEW | REJECT")
    overall_score: float = Field(..., description="0–100 weighted match score")
    summary: str
    vendor_final_status: str = "NOT_PROVIDED"
    critical_failures: List[str] = Field(default_factory=list)
    mismatches: List[MismatchItem] = Field(default_factory=list)
    field_results: List[FieldResultItem] = Field(default_factory=list)
    input_fields: Dict[str, Any] = Field(default_factory=dict)
    output_fields: Dict[str, Any] = Field(default_factory=dict)
    input_document: str = ""
    output_document: str = ""
    run_id: Optional[str] = Field(None, description="Persisted result id when DB is available")


class HealthResponse(BaseModel):
    status: str
    version: str
    accept_threshold: float
    review_threshold: float
    supported_file_types: List[str]
    database: str = "unknown"


class ConfigResponse(BaseModel):
    accept_threshold: float
    review_threshold: float
    critical_blocks_accept: bool
    comparison_rules: List[Dict[str, Any]]
    application_rules: Dict[str, Any] = Field(default_factory=dict)
    extract_fields: List[str]
    supported_file_types: List[str]


class RuleConfigItem(BaseModel):
    id: Optional[int] = None
    category: str = Field(..., description="comparison | application")
    field: str
    enabled: bool = True
    weight: float = 0.0
    match_type: str = "exact"
    tolerance_pct: float = 0.0
    severity: str = "medium"
    description: Optional[str] = None
    document_field: Optional[str] = None
    label: Optional[str] = None
    extra_json: Optional[Any] = None
    updated_at: Optional[str] = None
    updated_by: Optional[str] = None


class RuleConfigUpdateRequest(BaseModel):
    category: str
    field: str
    enabled: Optional[bool] = None
    weight: Optional[float] = None
    match_type: Optional[str] = None
    tolerance_pct: Optional[float] = None
    severity: Optional[str] = None
    description: Optional[str] = None
    document_field: Optional[str] = None
    label: Optional[str] = None
    extra_json: Optional[Any] = None
    updated_by: Optional[str] = "frontend"


class BulkRuleUpdateRequest(BaseModel):
    rules: List[RuleConfigUpdateRequest]
    updated_by: Optional[str] = "frontend"


class SystemSettingItem(BaseModel):
    id: Optional[int] = None
    setting_key: str
    setting_value: Optional[str] = None
    parsed_value: Optional[Any] = None
    value_type: str = "string"
    description: Optional[str] = None
    updated_at: Optional[str] = None
    updated_by: Optional[str] = None


class SystemSettingUpdateRequest(BaseModel):
    setting_key: str
    setting_value: Optional[Any] = None
    parsed_value: Optional[Any] = None
    value_type: Optional[str] = None
    description: Optional[str] = None
    updated_by: Optional[str] = "frontend"


class BulkSettingsUpdateRequest(BaseModel):
    settings: List[SystemSettingUpdateRequest]
    updated_by: Optional[str] = "frontend"


VERSION = "1.1.0"

__all__ = ["BulkRuleUpdateRequest", "BulkSettingsUpdateRequest", "ConfigResponse", "FieldResultItem",
           "HealthResponse", "MismatchItem", "RuleConfigItem", "RuleConfigUpdateRequest", "SystemSettingItem",
           "SystemSettingUpdateRequest", "VERSION", "VerificationResponse", "VerifyByIdsRequest"]
