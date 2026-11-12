"""In-memory stand-ins for the repository and the extractor (no database, no files, no network)."""

from __future__ import annotations

from typing import Any

from agents.collateral_verification.extract import extract_vendor_fields
from agents.collateral_verification.repository import parse_setting


class FakeRepository:
    def __init__(self, records: dict[str, dict] | None = None, *, configured: bool = True):
        self.records = records or {}
        self._configured = configured
        self.rules: dict[str, dict] = {}
        self.settings: dict[str, dict] = {}
        self.saved: list[dict] = []
        self.ready_calls = 0
        self.fail_save = False

    def configured(self) -> bool:
        return self._configured

    def ensure_ready(self) -> None:
        self.ready_calls += 1

    def load_runtime(self) -> tuple[dict | None, dict[str, Any]]:
        rules = {k: {"enabled": v["enabled"], "label": v["label"]} for k, v in self.rules.items()} or None
        return rules, {k: parse_setting(v["setting_value"], v["value_type"], empty_json_is_none=False)
                       for k, v in self.settings.items()}

    def fetch_application(self, application_id: str | None, application_number: str | None) -> dict | None:
        return self.records.get(application_number or "") or next(
            (r for r in self.records.values() if str(r["application_id"]) == str(application_id)), None)

    def list_rules(self) -> list[dict]:
        return [{"rule_id": k, **v} for k, v in self.rules.items()]

    def upsert_rule(self, payload: dict, updated_by: str) -> dict:
        if not payload.get("rule_id"):
            raise ValueError("rule_id is required")
        row = self.rules.setdefault(payload["rule_id"], {"enabled": True, "label": payload["rule_id"]})
        row.update({k: v for k, v in payload.items() if k in ("enabled", "label")}, updated_by=updated_by)
        return {"rule_id": payload["rule_id"], **row}

    def list_settings(self) -> list[dict]:
        return list(self.settings.values())

    def set_setting(self, key: str, value: Any, value_type: str | None, description: str | None,
                    updated_by: str) -> dict:
        row = {"setting_key": key, "setting_value": str(value).lower() if isinstance(value, bool) else str(value),
               "value_type": value_type or "string", "description": description, "updated_by": updated_by}
        self.settings[key] = row
        return row

    def save_result(self, payload: dict) -> dict:
        if self.fail_save:
            raise RuntimeError("database down")
        self.saved.append(payload)
        return {"id": len(self.saved), "run_id": f"run-{len(self.saved)}", "created_at": None}

    def list_results(self, limit: int, offset: int, application_number: str | None) -> list[dict]:
        rows = [r for r in self.saved if not application_number or r["application_number"] == application_number]
        return rows[offset:offset + limit]


class FakeExtractor:
    """The report bytes are its text (UTF-8); fields come from the real field reader."""

    def __init__(self):
        self.seen: list[str] = []

    def text(self, filename: str, data: bytes) -> str:
        self.seen.append(filename)
        return data.decode("utf-8")

    def fields(self, text: str) -> dict:
        return extract_vendor_fields(text)
