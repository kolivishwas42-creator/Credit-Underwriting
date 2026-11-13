"""
The ITR verification agent's settings.

    rule / reference data  conf/rules.yaml (default rules + decision settings, seeded into the database)
                           conf/documents.yaml (file types, OCR, field patterns, storage defaults)
    environment            ITR_VERIFICATION_* (where documents are read from); the database DSN is resolved by
                           shared.db.core for the agent key "itr_verification" (LOS_AGENTIC_DSN or ITR_VERIFICATION_DSN)

Nothing here opens a connection or reads a document; values are read when asked for, never at import.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

AGENT = "itr_verification"
ENV_PREFIX = "ITR_VERIFICATION_"
CONF_DIR = Path(__file__).resolve().parent / "conf"


def env(name: str, default: str = "") -> str:
    """ITR_VERIFICATION_<name>, stripped ('' when unset)."""
    return (os.getenv(ENV_PREFIX + name) or default).strip()


@lru_cache(maxsize=None)
def _load(name: str) -> dict[str, Any]:
    data = yaml.safe_load((CONF_DIR / name).read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"conf/{name} must be a mapping")
    return data


def los_source_schema() -> str:
    """The schema of the LOS tables this agent only READS (application, participants): ITR_VERIFICATION_LOS_SCHEMA,
    default public."""
    schema = env("LOS_SCHEMA", "public")
    if not schema.isidentifier():
        raise ValueError("ITR_VERIFICATION_LOS_SCHEMA must be an identifier")
    return schema


def rules_conf() -> dict[str, Any]:
    return _load("rules.yaml")


def documents_conf() -> dict[str, Any]:
    return _load("documents.yaml")


@dataclass(frozen=True)
class ExtractionSettings:
    supported_file_types: tuple[str, ...]
    extract_fields: tuple[str, ...]
    field_patterns: dict[str, list[str]]
    ocr_enabled: bool = True
    ocr_language: str = "eng"
    ocr_dpi: int = 200
    ocr_fallback_max_pages: int = 3
    normalize_pan: bool = True
    normalize_ay: bool = True
    max_file_size_mb: float = 15


def extraction_settings() -> ExtractionSettings:
    d = documents_conf()
    ocr = d.get("ocr") or {}
    norm = d.get("normalize") or {}
    return ExtractionSettings(
        supported_file_types=tuple(str(x).lower() for x in d["supported_file_types"]),
        extract_fields=tuple(d["extract_fields"]),
        field_patterns={str(k): list(v) for k, v in d["field_patterns"].items()},
        ocr_enabled=bool(ocr.get("enabled", True)),
        ocr_language=str(ocr.get("language", "eng")),
        ocr_dpi=int(ocr.get("dpi", 200)),
        ocr_fallback_max_pages=int(ocr.get("fallback_max_pages", 3)),
        normalize_pan=bool(norm.get("pan", True)),
        normalize_ay=bool(norm.get("assessment_year", True)),
        max_file_size_mb=float(d["max_file_size_mb"]),
    )


@dataclass(frozen=True)
class StorageSettings:
    """Where a document named by id comes from. No bucket, URL or key has a default."""
    source: str
    local_input_dir: str = ""
    local_output_dir: str = ""
    s3_bucket: str = ""
    s3_region: str = ""
    dms_base_url: str = ""
    dms_api_key: str = field(default="", repr=False)
    dms_timeout_seconds: float = 60
    temp_dir: str = ""


def storage_settings() -> StorageSettings:
    d = documents_conf().get("storage") or {}
    return StorageSettings(
        source=(env("DOCUMENT_SOURCE") or str(d.get("default_source", "local"))).lower(),
        local_input_dir=env("LOCAL_INPUT_DIR"),
        local_output_dir=env("LOCAL_OUTPUT_DIR"),
        s3_bucket=env("S3_BUCKET"),
        s3_region=env("S3_REGION"),
        dms_base_url=env("DMS_BASE_URL"),
        dms_api_key=env("DMS_API_KEY"),
        dms_timeout_seconds=float(env("DMS_TIMEOUT_SECONDS") or d.get("dms_timeout_seconds", 60)),
        temp_dir=env("TEMP_DIR"),
    )


__all__ = ["AGENT", "CONF_DIR", "ENV_PREFIX", "ExtractionSettings", "StorageSettings", "documents_conf", "env",
           "extraction_settings", "los_source_schema", "rules_conf", "storage_settings"]
