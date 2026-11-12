"""
The agent's tables, as ordered migrations (append only; each runs once, in one transaction).

The SQL is unqualified: the connection's search_path is the agent's schema (collateral_check in los_agentic).
The LOS case tables the agent READS (loan_applications, collateral_properties, ...) are not created here.
"""

from __future__ import annotations

from shared.db import LOGS_MIGRATION, responses

_V1 = """
-- per-rule switch, label and optional tolerance (the live rule configuration; seeded from conf/rules.yaml)
CREATE TABLE collateral_rule_configs (
    id              SERIAL PRIMARY KEY,
    rule_id         VARCHAR(100) NOT NULL UNIQUE,
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    label           VARCHAR(200) NOT NULL,
    tolerance_pp    DOUBLE PRECISION NULL,
    extra_json      JSONB NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      VARCHAR(100) NULL
);

-- thresholds and flags (string | number | boolean | json; seeded from conf/rules.yaml)
CREATE TABLE collateral_system_settings (
    id              SERIAL PRIMARY KEY,
    setting_key     VARCHAR(100) NOT NULL UNIQUE,
    setting_value   TEXT NULL,
    value_type      VARCHAR(20) NOT NULL DEFAULT 'string',
    description     VARCHAR(500) NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      VARCHAR(100) NULL
);

-- one row per verification run (the full result, for audit)
CREATE TABLE collateral_verification_results (
    id                      SERIAL PRIMARY KEY,
    run_id                  VARCHAR(36) NOT NULL UNIQUE,
    application_id          VARCHAR(50) NULL,
    application_number      VARCHAR(100) NULL,
    data_source             VARCHAR(50) NULL,
    vendor_final_status     VARCHAR(50) NULL,
    report_file             VARCHAR(500) NULL,
    overall                 VARCHAR(50) NULL,
    summary_json            JSONB NULL,
    comparison_results      JSONB NULL,
    source_evidence         JSONB NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX collateral_verification_results_app ON collateral_verification_results (application_number);
CREATE INDEX collateral_verification_results_created ON collateral_verification_results (created_at DESC);
"""

MIGRATIONS: list[tuple[str, str, str]] = [
    ("0001", "collateral verification: rule configs, system settings, verification results", _V1),
    ("0002", "agent_logs: WARNING and above application logs (shared, shared/db)", LOGS_MIGRATION[2]),
    ("0003", "collateral verification: api_responses (every API response, append-only)", responses.MIGRATION[2]),
]
