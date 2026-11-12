"""
The agent's database schema, as ordered migrations (append only; each runs once, in one transaction).

Unqualified SQL: the connection's search_path is the agent's schema (shared/db/core.py), so the tables land in
`property_valuation`. IF NOT EXISTS keeps a database whose tables were made by the agent's former start-up
(metadata.create_all, same schema and names) migratable: those tables are adopted, not recreated.
"""

from __future__ import annotations

from shared.db import LOGS_MIGRATION, responses

_V1 = """
CREATE TABLE IF NOT EXISTS property_valuation_verifications (
    verification_id BIGSERIAL PRIMARY KEY,
    application_id BIGINT NOT NULL,
    collateral_property_id BIGINT NOT NULL,
    vendor_name VARCHAR(150),
    verification_type VARCHAR(30) NOT NULL DEFAULT 'INITIAL_VISIT',
    vendor_status VARCHAR(30),
    submitted_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    vendor_response JSONB NOT NULL DEFAULT '{}'::jsonb,
    verified_at TIMESTAMP WITHOUT TIME ZONE,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS property_valuation_agent_results (
    result_id BIGSERIAL PRIMARY KEY,
    application_id BIGINT NOT NULL,
    collateral_property_id BIGINT NOT NULL,
    verification_id BIGINT REFERENCES property_valuation_verifications(verification_id) ON DELETE SET NULL,
    agent_version VARCHAR(50),
    vendor_status VARCHAR(30),
    agent_status VARCHAR(30) NOT NULL,
    total_rules_checked INTEGER NOT NULL DEFAULT 0,
    total_rules_passed INTEGER NOT NULL DEFAULT 0,
    total_rules_triggered INTEGER NOT NULL DEFAULT 0,
    critical_issues_count INTEGER NOT NULL DEFAULT 0,
    major_issues_count INTEGER NOT NULL DEFAULT 0,
    minor_issues_count INTEGER NOT NULL DEFAULT 0,
    key_insights JSONB NOT NULL DEFAULT '[]'::jsonb,
    risk_factors JSONB NOT NULL DEFAULT '[]'::jsonb,
    recommended_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS property_valuation_rule_configs (
    rule_key VARCHAR(30) PRIMARY KEY,
    original_id VARCHAR(30) NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    sequence INTEGER NOT NULL DEFAULT 1,
    severity VARCHAR(20) NOT NULL DEFAULT 'MAJOR',
    fields JSONB NOT NULL DEFAULT '{}'::jsonb,
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pvv_application ON property_valuation_verifications(application_id);
CREATE INDEX IF NOT EXISTS idx_pvv_property ON property_valuation_verifications(collateral_property_id);
CREATE INDEX IF NOT EXISTS idx_pvar_application ON property_valuation_agent_results(application_id);
CREATE INDEX IF NOT EXISTS idx_pvar_property ON property_valuation_agent_results(collateral_property_id);
CREATE INDEX IF NOT EXISTS idx_pvar_verification ON property_valuation_agent_results(verification_id);
CREATE INDEX IF NOT EXISTS idx_pvar_created ON property_valuation_agent_results(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pvar_status ON property_valuation_agent_results(agent_status);
"""

MIGRATIONS: list[tuple[str, str, str]] = [
    ("0001", "property valuation: verifications, agent results, rule configs", _V1),
    ("0002", "agent_logs: WARNING and above application logs (shared, shared/db)", LOGS_MIGRATION[2]),
    ("0003", "property valuation: api_responses (every API response, append-only)", responses.MIGRATION[2]),
]

__all__ = ["MIGRATIONS"]
