"""
The ITR verification use cases: extract both documents, judge them with the policy in force, keep the result; and
the rules / settings / results the Rules Config screen reads and edits.

The service receives its repository, document resolver and extractor (build_service wires the real ones); it never
opens a connection or knows SQL.
"""

from __future__ import annotations

import logging
import tempfile
import threading
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Protocol, Tuple

from .config import ExtractionSettings
from .repository import ITRRepository
from .rules.engine import compare_documents
from .rules.policy import Policy, merge_rule, serialize_setting
from .schemas import VerifyByIdsRequest
from .storage.base import DocumentResolver, ResolvedDocument

logger = logging.getLogger(__name__)


class Extractor(Protocol):
    def extract(self, file_path: str | Path) -> Tuple[Dict[str, Any], str]: ...


class CaseNotFound(LookupError):
    """The application number, or the participant under it, is not in the LOS."""


class DocumentRejected(ValueError):
    """An uploaded document that cannot be used (no name, wrong type, too large)."""


@dataclass(frozen=True)
class UploadedDocument:
    filename: str
    content: bytes


class ITRVerificationService:
    def __init__(self, repository: ITRRepository, resolver: Callable[[], DocumentResolver] | DocumentResolver,
                 extractor: Extractor, defaults: Policy, extraction: ExtractionSettings):
        self._repo = repository
        self._resolver = resolver
        self._extractor = extractor
        self._defaults = defaults
        self._extraction = extraction
        self._policy: Optional[Policy] = None
        self._lock = threading.Lock()

    # ------------------------------------------------------------------------------------------------ the policy
    def policy(self) -> Policy:
        """The policy in force: loaded from the database once, then kept until something changes it."""
        if self._policy is None:
            self.reload_policy()
        assert self._policy is not None
        return self._policy

    def reload_policy(self, *, strict: bool = False) -> Policy:
        """The database rules / settings over the conf/rules.yaml defaults. A database that cannot be read keeps the
        policy in force (the defaults before the first load) and says so in the log -- or raises when strict."""
        try:
            policy = self._defaults.with_rows(self._repo.list_rules(), self._repo.list_settings())
        except Exception as exc:
            if strict:
                raise
            logger.warning("ITR rules could not be read from the database (%s); keeping the rules in force",
                           type(exc).__name__)
            with self._lock:
                if self._policy is None:
                    self._policy = self._defaults
                return self._policy
        with self._lock:
            self._policy = policy
        return policy

    def current_config(self) -> dict[str, Any]:
        p = self.policy()
        return {"accept_threshold": p.accept_threshold, "review_threshold": p.review_threshold,
                "critical_blocks_accept": p.critical_blocks_accept, "comparison_rules": list(p.comparison_rules),
                "application_rules": dict(p.application_rules),
                "extract_fields": list(self._extraction.extract_fields),
                "supported_file_types": list(self._extraction.supported_file_types)}

    def database_status(self) -> str:
        try:
            self._repo.ping()
            return "connected"
        except Exception as exc:  # noqa: BLE001 - a status, never the DSN
            return f"error:{type(exc).__name__}"

    # ------------------------------------------------------------------------------------------ sample documents
    def sample_documents(self) -> Dict[str, List[str]]:
        """The documents in the local input / output folders, for the screen to fill the document names with (testing).
        Empty lists when documents are not read from local folders (S3 / DMS) or the folders are not configured."""
        empty: Dict[str, List[str]] = {"input": [], "output": []}
        try:
            resolver = self._resolver() if callable(self._resolver) else self._resolver
        except ValueError:                      # the local folders are not configured
            return empty
        lister = getattr(resolver, "list_documents", None)
        if lister is None:
            return empty
        types = tuple(self._extraction.supported_file_types)
        return {"input": lister("input", types), "output": lister("output", types)}

    # --------------------------------------------------------------------------------------- application / people
    def participants_of(self, application_number: str) -> Dict[str, Any]:
        """The application found by its number (e.g. LOS-DUMMY-0045) and the people under it."""
        number = (application_number or "").strip()
        application = self._repo.fetch_application_by_number(number) if number else None
        if not application:
            raise CaseNotFound("Application number was not found.")
        people = [{"participant_id": row["participant_id"], "name": _full_name(row),
                   "applicant_type": row.get("applicant_type"), "is_primary": bool(row.get("is_primary"))}
                  for row in self._repo.list_participants(application["application_id"])]
        return {"application": {"application_id": application["application_id"],
                                "application_number": application["application_number"]},
                "participants": people}

    def _case(self, application_number: Optional[str], participant_id: Optional[int]) -> Dict[str, Any]:
        """The application / participant a run is for. Both or neither; both must exist, the person under the
        application. {} when neither is given (a run made without a case)."""
        number = (application_number or "").strip()
        if not number and participant_id is None:
            return {}
        if not number or participant_id is None:
            raise ValueError("application_number and participant_id go together")
        found = self.participants_of(number)
        person = next((p for p in found["participants"] if p["participant_id"] == participant_id), None)
        if person is None:
            raise CaseNotFound("Participant was not found under the supplied application number.")
        return {"application_number": found["application"]["application_number"],
                "participant_id": participant_id, "participant_name": person["name"]}

    # ---------------------------------------------------------------------------------------------- verification
    def verify_documents(self, input_path: Path, output_path: Path, *, return_raw: bool = False,
                         application_data: Optional[Dict[str, Any]] = None,
                         final_status: Optional[str] = None) -> Dict[str, Any]:
        input_fields, input_text = self._extractor.extract(input_path)
        output_fields, output_text = self._extractor.extract(output_path)
        report = compare_documents(input_fields, output_fields, self.policy(),
                                   application_data=application_data, final_status=final_status)
        result = report.to_dict()
        result["input_fields"] = input_fields
        result["output_fields"] = output_fields
        result["input_document"] = str(input_path)
        result["output_document"] = str(output_path)
        if return_raw:
            result["raw_input_text"] = input_text
            result["raw_output_text"] = output_text
        return result

    def validate_upload(self, doc: UploadedDocument) -> str:
        if not doc.filename:
            raise DocumentRejected("Missing filename")
        suffix = Path(doc.filename).suffix.lower()
        allowed = set(self._extraction.supported_file_types)
        if suffix not in allowed:
            raise DocumentRejected(f"Unsupported file type '{suffix}'. Allowed: {sorted(allowed)}")
        size_mb = len(doc.content) / (1024 * 1024)
        if size_mb > self._extraction.max_file_size_mb:
            raise DocumentRejected(f"File too large ({size_mb:.1f} MB). Max {self._extraction.max_file_size_mb:g} MB.")
        return suffix

    def verify_uploads(self, input_doc: UploadedDocument, output_doc: UploadedDocument, *,
                       return_raw: bool = False) -> Dict[str, Any]:
        """Two uploaded files: checked, written to a private temporary folder (removed after), verified, kept."""
        in_suffix = self.validate_upload(input_doc)
        out_suffix = self.validate_upload(output_doc)
        with tempfile.TemporaryDirectory(prefix="itr_") as tmp:
            in_path = Path(tmp) / f"{uuid.uuid4().hex}{in_suffix}"
            out_path = Path(tmp) / f"{uuid.uuid4().hex}{out_suffix}"
            in_path.write_bytes(input_doc.content)
            out_path.write_bytes(output_doc.content)
            report = self.verify_documents(in_path, out_path, return_raw=return_raw)
        report["input_document"] = input_doc.filename
        report["output_document"] = output_doc.filename
        return self.persist(report)

    def verify_by_ids(self, request: VerifyByIdsRequest) -> Dict[str, Any]:
        """Two documents named by id in the configured store, with the application's values and vendor status."""
        case = self._case(request.application_number, request.participant_id)      # checked before any document is read
        resolver = self._resolver() if callable(self._resolver) else self._resolver
        resolved: List[ResolvedDocument] = []
        try:
            resolved.append(resolver.resolve(request.input_doc_id, side="input"))
            resolved.append(resolver.resolve(request.output_doc_id, side="output"))
            app_data = {"pan_number": request.pan_number, "assessment_year": request.assessment_year,
                        "gti_income": request.gti_income, "applicant_name": request.applicant_name,
                        "address": request.address}
            report = self.verify_documents(resolved[0].path, resolved[1].path, application_data=app_data,
                                           final_status=request.final_status)
        finally:
            for doc in resolved:
                if doc.temporary:
                    doc.path.unlink(missing_ok=True)
        report["input_document"] = request.input_doc_id
        report["output_document"] = request.output_doc_id
        report.update(case)
        return self.persist(report, {**request.model_dump(), **case})

    def verify_fields(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Already-extracted field dictionaries (no documents, no application data)."""
        input_fields, output_fields = payload.get("input_fields"), payload.get("output_fields")
        if not isinstance(input_fields, dict) or not isinstance(output_fields, dict):
            raise ValueError("Body must contain 'input_fields' and 'output_fields' objects")
        result = compare_documents(input_fields, output_fields, self.policy()).to_dict()
        result["input_fields"] = input_fields
        result["output_fields"] = output_fields
        return self.persist(result, payload)

    def persist(self, report: Dict[str, Any], request_payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Keep the result (best effort: a database failure never fails the verification; it is logged)."""
        payload = request_payload or {}
        row = {
            "run_id": str(uuid.uuid4()),
            "application_number": payload.get("application_number"),
            "participant_id": payload.get("participant_id"),
            "input_doc_id": report.get("input_document") or payload.get("input_doc_id"),
            "output_doc_id": report.get("output_document") or payload.get("output_doc_id"),
            "pan_number": payload.get("pan_number"),
            "assessment_year": payload.get("assessment_year"),
            "gti_income": payload.get("gti_income"),
            "final_status": payload.get("final_status"),
            "applicant_name": payload.get("applicant_name"),
            "address": payload.get("address"),
            "decision": report.get("decision", "UNKNOWN"),
            "overall_score": float(report.get("overall_score") or 0),
            "summary": report.get("summary"),
            "vendor_final_status": report.get("vendor_final_status"),
            "critical_failures": report.get("critical_failures") or [],
            "mismatches": report.get("mismatches") or [],
            "field_results": report.get("field_results") or [],
            "input_fields": report.get("input_fields") or {},
            "output_fields": report.get("output_fields") or {},
        }
        try:
            saved = self._repo.save_result(row)
            if saved:
                report["run_id"] = saved.get("run_id")
        except Exception as exc:  # noqa: BLE001 - best effort by design
            logger.warning("Could not persist ITR verification result (%s)", type(exc).__name__)
        return report

    # -------------------------------------------------------------------------------------------- rules / settings
    def list_rules(self, category: Optional[str] = None) -> List[dict]:
        return self._repo.list_rules(category)

    def upsert_rule(self, payload: Dict[str, Any], updated_by: str = "api") -> dict:
        """Create or update one rule (by category + field); the policy in force follows."""
        existing = None
        if payload.get("category") and payload.get("field"):
            existing = self._repo.get_rule(payload["category"], payload["field"])
        saved = self._repo.save_rule(merge_rule(existing, payload), updated_by=updated_by)
        self.reload_policy()
        return saved

    def bulk_upsert_rules(self, items: List[Dict[str, Any]], updated_by: str = "api") -> List[dict]:
        return [self.upsert_rule(item, updated_by=updated_by) for item in items]

    def list_settings(self) -> List[dict]:
        return self._repo.list_settings()

    def set_setting(self, key: str, value: Any, value_type: Optional[str] = None, description: Optional[str] = None,
                    updated_by: str = "api") -> dict:
        if value_type is None:
            existing = self._repo.get_setting(key)
            value_type = (existing or {}).get("value_type") or "string"
        saved = self._repo.save_setting(key, serialize_setting(value, value_type), value_type, description,
                                        updated_by)
        self.reload_policy()
        return saved

    def bulk_set_settings(self, items: List[Dict[str, Any]], updated_by: str = "api") -> List[dict]:
        return [self.set_setting(key=i["setting_key"], value=i.get("parsed_value", i.get("setting_value")),
                                 value_type=i.get("value_type"), description=i.get("description"),
                                 updated_by=updated_by) for i in items]

    # ------------------------------------------------------------------------------------------------ the results
    def list_results(self, limit: int = 50, offset: int = 0, decision: Optional[str] = None,
                     pan_number: Optional[str] = None) -> List[dict]:
        return self._repo.list_results(limit, offset, decision=decision, pan_number=pan_number)

    def get_result(self, run_id: str) -> Optional[dict]:
        return self._repo.get_result(run_id)


def _full_name(row: Dict[str, Any]) -> Optional[str]:
    pieces = [row.get("salutation"), row.get("first_name"), row.get("middle_name"), row.get("last_name")]
    name = " ".join(str(p).strip() for p in pieces if p and str(p).strip())
    return name or row.get("customer_full_name")


def build_service() -> ITRVerificationService:
    """The service wired to the real database, document store and extractor (nothing is opened here)."""
    from . import config
    from .extractors import DocumentExtractor
    from .repository import PostgresITRRepository
    from .rules.policy import seed_rule_rows, seed_setting_rows
    from .storage import build_resolver

    conf = config.rules_conf()
    extraction = config.extraction_settings()
    repository = PostgresITRRepository(seed_rule_rows(conf), seed_setting_rows(conf))
    return ITRVerificationService(repository, lambda: build_resolver(config.storage_settings()),
                                  DocumentExtractor(extraction), Policy.from_conf(conf), extraction)


__all__ = ["CaseNotFound", "DocumentRejected", "Extractor", "ITRVerificationService", "UploadedDocument", "build_service"]
