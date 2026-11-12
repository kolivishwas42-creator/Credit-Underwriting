"""
The use cases of the collateral verification agent: verify a vendor report against the LOS collateral record, read
a report's fields, and keep the rule configuration (rules + settings) and the stored runs.

The service receives its repository and its report extractor; it never opens a connection or reads a file itself.
The live rule configuration starts from conf/rules.yaml and is replaced by the database's (load on start, reload
after every rule / setting change). A database that cannot be read leaves the configuration as it was (a warning).
"""

from __future__ import annotations

import logging
from dataclasses import replace
from typing import Any

from agents.collateral_verification.config import RuleConfig, default_rule_config
from agents.collateral_verification.extract import ReportExtractor
from agents.collateral_verification.repository import CollateralRepository
from agents.collateral_verification.rules import evaluate, summarize

logger = logging.getLogger(__name__)

VERSION = "1.1.0"


class InvalidRequest(ValueError):
    """The request cannot be processed as given (HTTP 422)."""


class NotFound(LookupError):
    """The application has no collateral record (HTTP 404)."""


class CollateralVerificationService:
    def __init__(self, repository: CollateralRepository, extractor: ReportExtractor,
                 defaults: RuleConfig | None = None):
        self.repository = repository
        self.extractor = extractor
        self._config = defaults or default_rule_config()

    @property
    def rule_config(self) -> RuleConfig:
        return self._config

    # ------------------------------------------------------------------------------------------ configuration
    def start(self) -> None:
        """Migrate + seed the agent's tables and load the live configuration (the defaults when that fails)."""
        if not self.repository.configured():
            logger.info("collateral verification: no database configured; using the conf/ defaults")
            return
        try:
            self.repository.ensure_ready()
        except Exception as exc:  # noqa: BLE001 - the agent still runs on the defaults; never the DSN
            logger.warning("collateral verification: could not prepare the database (%s); using the conf/ defaults",
                           type(exc).__name__)
            return
        self.reload()

    def reload(self) -> None:
        """The database's rules (when there are any) and settings over the current configuration."""
        if not self.repository.configured():
            return
        try:
            rules, settings = self.repository.load_runtime()
        except Exception as exc:  # noqa: BLE001 - keep the current configuration
            logger.warning("collateral verification: could not load the configuration from the database (%s)",
                           type(exc).__name__)
            return
        cfg = self._config
        if rules:
            cfg = replace(cfg, rules=rules)
        self._config = cfg.with_settings(settings)

    def health(self) -> dict[str, Any]:
        return {"ok": True, "version": VERSION, "database_configured": self.repository.configured(),
                "rules_count": len(self._config.rules or {})}

    def config_view(self) -> dict[str, Any]:
        cfg = self._config
        return {
            "database_configured": self.repository.configured(),
            "vendor_final_statuses": cfg.vendor_final_statuses,
            "completion_tolerance_pp": cfg.completion_tolerance_pp,
            "name_match_threshold": cfg.name_match_threshold,
            "compare_pin": cfg.compare_pin,
            "flag_vendor_status_conflict": cfg.flag_vendor_status_conflict,
            "flag_unsatisfied_cersai_charge": cfg.flag_unsatisfied_cersai_charge,
            "rules": cfg.rules,
        }

    # ------------------------------------------------------------------------------------- rules and settings
    def list_rules(self) -> list[dict]:
        return self.repository.list_rules()

    def update_rule(self, payload: dict, updated_by: str) -> dict:
        row = self.repository.upsert_rule(payload, updated_by)
        self.reload()
        return row

    def update_rules(self, items: list[dict], updated_by: str) -> list[dict]:
        rows = [self.repository.upsert_rule(item, updated_by) for item in items]
        self.reload()
        return rows

    def list_settings(self) -> list[dict]:
        return self.repository.list_settings()

    def update_setting(self, key: str, value: Any, value_type: str | None, description: str | None,
                       updated_by: str) -> dict:
        row = self.repository.set_setting(key, value, value_type, description, updated_by)
        self.reload()
        return row

    def update_settings(self, items: list[dict], updated_by: str) -> list[dict]:
        rows = [self.repository.set_setting(i["setting_key"], i.get("value"), i.get("value_type"),
                                            i.get("description"), updated_by) for i in items]
        self.reload()
        return rows

    def list_results(self, limit: int, offset: int, application_number: str | None) -> list[dict]:
        return self.repository.list_results(limit, offset, application_number)

    # ---------------------------------------------------------------------------------------------- reports
    def extract_only(self, filename: str, data: bytes) -> dict:
        return self.extractor.fields(self.extractor.text(filename, data))

    def verify(self, application_id: str | None, application_number: str | None, final_status: str, filename: str,
               data: bytes) -> dict:
        cfg = self._config
        status = (final_status or "").strip().lower()
        if status not in {s.lower() for s in cfg.vendor_final_statuses}:
            raise InvalidRequest(f"final_status must be one of: {', '.join(cfg.vendor_final_statuses)}")
        if not application_id and not application_number:
            raise InvalidRequest("application_id or application_number is required")
        record = self.repository.fetch_application(application_id, application_number)
        if not record:
            raise NotFound("No collateral record for that application")
        if not record.get("properties"):
            raise InvalidRequest("Application has no collateral property")

        vendor = self.extractor.fields(self.extractor.text(filename, data))
        rules = evaluate(record, vendor, cfg)
        result = {
            "application_id": record["application_id"],
            "application_number": record["application_number"],
            "data_source": "postgres",
            "vendor_final_status": status,
            "report_file": filename,
            "comparison_results": rules,
            "source_evidence": {
                "debtor_search": vendor.get("debtor_search"),
                "security_interest": vendor.get("security_interest"),
                "asset_owner_evidence": vendor.get("asset_owner_evidence"),
                "header_owner": vendor.get("header_owner"),
                "property_address": vendor.get("property_address"),
                "raw_extracted_text": vendor.get("raw_text"),
                "borrower_asset_owner_rows": vendor.get("borrower_asset_owner_rows"),
            },
            "summary": summarize(rules, status, cfg),
        }
        try:
            saved = self.repository.save_result(result)
            if saved:
                result["run_id"] = saved.get("run_id")
        except Exception as exc:  # noqa: BLE001 - storing the run is best-effort; the result is still returned
            logger.warning("collateral verification: could not store the verification result (%s)",
                           type(exc).__name__)
        return result


__all__ = ["CollateralVerificationService", "InvalidRequest", "NotFound", "VERSION"]
