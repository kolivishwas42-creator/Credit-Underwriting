"""The request bodies of the agent's API (Pydantic), shared by api and service."""

from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel


class RuleUpdate(BaseModel):
    rule_id: str
    enabled: Optional[bool] = None
    label: Optional[str] = None
    tolerance_pp: Optional[float] = None
    extra_json: Optional[Any] = None


class BulkRulesUpdate(BaseModel):
    rules: list[RuleUpdate]
    updated_by: str = "frontend"


class SettingUpdate(BaseModel):
    setting_key: str
    setting_value: Optional[Any] = None
    parsed_value: Optional[Any] = None
    value_type: Optional[str] = None
    description: Optional[str] = None

    def value(self) -> Any:
        """parsed_value when given, else setting_value."""
        return self.parsed_value if self.parsed_value is not None else self.setting_value


class BulkSettingsUpdate(BaseModel):
    settings: list[SettingUpdate]
    updated_by: str = "frontend"


__all__ = ["BulkRulesUpdate", "BulkSettingsUpdate", "RuleUpdate", "SettingUpdate"]
