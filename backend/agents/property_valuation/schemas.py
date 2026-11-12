"""The request bodies of the property valuation API."""

from __future__ import annotations

from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from agents.property_valuation.config import settings


class ValuationSubmission(BaseModel):
    """One vendor visit: what was sent to the vendor and what the vendor returned."""
    model_config = ConfigDict(extra="forbid")
    collateral_property_id: int
    vendor_name: str = Field(default_factory=lambda: settings().default_vendor_name)
    verification_type: Literal["INITIAL_VISIT", "REVISIT"] = "INITIAL_VISIT"
    submitted_data: Dict[str, Any] = Field(default_factory=dict)
    vendor_response: Dict[str, Any] = Field(default_factory=dict)
    verified_at: Optional[str] = None


class RuleConfigUpdate(BaseModel):
    """The editable parts of one rule (only the fields sent are changed)."""
    enabled: Optional[bool] = None
    sequence: Optional[int] = Field(default=None, ge=1)
    severity: Optional[Literal["CRITICAL", "MAJOR", "MINOR"]] = None
    settings: Optional[Dict[str, Any]] = None
    fields: Optional[Dict[str, Any]] = None
    description: Optional[str] = None


__all__ = ["RuleConfigUpdate", "ValuationSubmission"]
