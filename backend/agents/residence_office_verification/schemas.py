"""Pydantic models of the residence / office verification API (shared by api.py and service.py)."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ResidenceVerificationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    application_id: int = Field(..., gt=0)
    participant_id: int = Field(..., gt=0)
    verification_type: Literal["RESIDENCE", "OFFICE"] = "RESIDENCE"
    vendor_name: str | None = Field(default="Manual Vendor Entry", max_length=120)
    vendor_response: dict[str, Any] = Field(
        ..., description="Manually submitted vendor response object"
    )

    @field_validator("vendor_name")
    @classmethod
    def clean_vendor_name(cls, value):
        if value is None:
            return None
        value = value.strip()
        return value or None


class RuleConfigUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rule_key: str = Field(..., min_length=1, max_length=32)
    rule_id: str | None = Field(default=None, max_length=32)
    name: str | None = Field(default=None, max_length=255)
    enabled: bool | None = None
    criticality: Literal["CRITICAL", "HIGH", "MEDIUM", "LOW"] | None = None
    weight: int | None = Field(default=None, ge=0, le=1000)


class RuleConfigBulkUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    verification_type: Literal["RESIDENCE", "OFFICE"]
    rules: list[RuleConfigUpdate] = Field(..., min_length=1)
