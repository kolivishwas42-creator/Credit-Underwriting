"""
The ITR verification agent's tables, as ordered migrations (append only; each runs once, in one transaction).

The SQL is unqualified: the connection's search_path is the agent's schema (shared/db/core.py), so the tables land in
schema `itr_verification` of the shared database (or `public` of a database of the agent's own).
Converted from the old backend/sql/ITR_Verification_schema.sql (SQL Server / Postgres dual DDL, schema
"ITR_Verification", tables RuleConfigs / SystemSettings / VerificationResults).
"""

from __future__ import annotations

from shared.db import LOGS_MIGRATION, responses

_V1 = """
-- editable comparison (document vs document) and application (application value vs document) rules
CREATE TABLE rule_configs (
    id              BIGSERIAL        PRIMARY KEY,
    category        TEXT             NOT NULL CHECK (category <> ''),       -- comparison | application
    field           TEXT             NOT NULL CHECK (field <> ''),
    enabled         BOOLEAN          NOT NULL DEFAULT true,
    weight          DOUBLE PRECISION NOT NULL DEFAULT 0,
    match_type      TEXT             NOT NULL DEFAULT 'exact',  -- exact|fuzzy|numeric_tolerance|normalized|numeric
    tolerance_pct   DOUBLE PRECISION NOT NULL DEFAULT 0,        -- numeric: % allowed; fuzzy: similarity 0-1
    severity        TEXT             NOT NULL DEFAULT 'medium', -- critical|high|medium|low
    description     TEXT,
    document_field  TEXT,                                       -- application rules only
    label           TEXT,
    extra_json      JSONB,
    updated_at      TIMESTAMPTZ      NOT NULL DEFAULT now(),
    updated_by      TEXT,
    CONSTRAINT rule_configs_category_field UNIQUE (category, field)
);

-- global thresholds and vendor-status policies (key -> text value + its type)
CREATE TABLE system_settings (
    id              BIGSERIAL   PRIMARY KEY,
    setting_key     TEXT        NOT NULL UNIQUE,
    setting_value   TEXT,
    value_type      TEXT        NOT NULL DEFAULT 'string' CHECK (value_type IN ('string', 'number', 'boolean', 'json')),
    description     TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      TEXT
);

-- every verification run (decision, score, field results, mismatches, request context)
CREATE TABLE verification_results (
    id                  BIGSERIAL        PRIMARY KEY,
    run_id              TEXT             NOT NULL UNIQUE,
    input_doc_id        TEXT,
    output_doc_id       TEXT,
    pan_number          TEXT,
    assessment_year     TEXT,
    gti_income          DOUBLE PRECISION,
    final_status        TEXT,
    applicant_name      TEXT,
    address             TEXT,
    decision            TEXT             NOT NULL,
    overall_score       DOUBLE PRECISION NOT NULL DEFAULT 0,
    summary             TEXT,
    vendor_final_status TEXT,
    critical_failures   JSONB            NOT NULL DEFAULT '[]'::jsonb,
    mismatches          JSONB            NOT NULL DEFAULT '[]'::jsonb,
    field_results       JSONB            NOT NULL DEFAULT '[]'::jsonb,
    input_fields        JSONB            NOT NULL DEFAULT '{}'::jsonb,
    output_fields       JSONB            NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ      NOT NULL DEFAULT now()
);
CREATE INDEX verification_results_decision ON verification_results (decision);
CREATE INDEX verification_results_pan ON verification_results (pan_number);
CREATE INDEX verification_results_created ON verification_results (created_at DESC);
"""

# which application and which participant a run was for (nullable: runs made before, and by-fields runs, have none)
_V4 = """
ALTER TABLE verification_results ADD COLUMN IF NOT EXISTS application_number TEXT;
ALTER TABLE verification_results ADD COLUMN IF NOT EXISTS participant_id BIGINT;
CREATE INDEX IF NOT EXISTS verification_results_application ON verification_results (application_number);
"""

MIGRATIONS: list[tuple[str, str, str]] = [
    ("0001", "itr verification: rule_configs, system_settings, verification_results", _V1),
    ("0002", "agent_logs: WARNING and above application logs (shared, shared/db)", LOGS_MIGRATION[2]),
    ("0003", "api_responses: every API response of this agent (shared, shared/db/responses.py)",
     responses.MIGRATION[2]),
    ("0004", "verification_results: application_number and participant_id of the run", _V4),
]

__all__ = ["MIGRATIONS"]
