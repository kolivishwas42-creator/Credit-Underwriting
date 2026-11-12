"""
The agent's database schema, as ordered migrations (append only; each runs once, in one transaction).

The SQL is unqualified: the connection's search_path is the agent's schema (shared/db/core.py, agent key
"residence_office_verification"), so the tables land in that schema. The LOS tables the agent only READS
(loan_applications, application_participants, ...) are not created here.

Applied by scripts/setup_agent_databases.py (or repository.migrate()) -- never at request time.
A released migration is never edited: add a new one.
"""

from __future__ import annotations

from shared.db import LOGS_MIGRATION, Migration, responses

_CONFIG_COLUMNS = """
    id              SERIAL PRIMARY KEY,
    rule_key        VARCHAR(32)  NOT NULL UNIQUE,
    rule_id         VARCHAR(32)  NOT NULL,
    name            VARCHAR(255) NOT NULL,
    enabled         BOOLEAN      NOT NULL DEFAULT TRUE,
    criticality     VARCHAR(16)  NOT NULL,
    weight          INTEGER      NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
"""

_RESULT_COLUMNS = """
    id                      SERIAL PRIMARY KEY,
    application_id          INTEGER      NOT NULL,
    participant_id          INTEGER      NOT NULL,
    vendor_name             VARCHAR(120),
    overall_recommendation  VARCHAR(32),
    overall_criticality     VARCHAR(16),
    risk_score              INTEGER,
    summary                 TEXT,
    rules_evaluated         INTEGER,
    rules_triggered         INTEGER,
    insights                JSONB,
    rules                   JSONB,
    vendor_response         JSONB,
    declared_address        TEXT,
    application_snapshot    JSONB,
    participant_snapshot    JSONB,
    address_snapshot        JSONB,
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
"""

_V1_TABLES = f"""
-- the rule settings, editable from the frontend (GET / PUT /rule-configs)
CREATE TABLE residence_rule_configs ({_CONFIG_COLUMNS});
CREATE TABLE office_rule_configs ({_CONFIG_COLUMNS});

-- every evaluation run (POST /residence-verification)
CREATE TABLE residence_rule_results ({_RESULT_COLUMNS});
CREATE TABLE office_rule_results ({_RESULT_COLUMNS});

CREATE INDEX idx_residence_results_app ON residence_rule_results (application_id, participant_id);
CREATE INDEX idx_office_results_app ON office_rule_results (application_id, participant_id);
"""

# the default rules (the same values as conf/rules.yaml; tests/test_rules.py checks they agree)
_V2_SEED = """
INSERT INTO residence_rule_configs (rule_key, rule_id, name, enabled, criticality, weight) VALUES
    ('RULE_01', 'RES-001', 'Vendor verification status', TRUE, 'HIGH', 25),
    ('RULE_02', 'RES-002', 'Neighbour confirmation', TRUE, 'MEDIUM', 10),
    ('RULE_03', 'RES-003', 'Declared address confirmation', TRUE, 'HIGH', 20),
    ('RULE_04', 'RES-004', 'Negative area flag', TRUE, 'HIGH', 20),
    ('RULE_05', 'RES-005', 'Vendor-reported political link', TRUE, 'MEDIUM', 10),
    ('RULE_06', 'RES-006', 'Name plate visibility', TRUE, 'LOW', 5),
    ('RULE_07', 'RES-007', 'Community-dominated area context', TRUE, 'LOW', 0),
    ('RULE_08', 'RES-008', 'Corrected address comparison', TRUE, 'HIGH', 20),
    ('RULE_09', 'RES-009', 'Vendor final status', TRUE, 'HIGH', 25),
    ('RULE_10', 'RES-010', 'Status and findings consistency', FALSE, 'CRITICAL', 30)
ON CONFLICT (rule_key) DO NOTHING;

INSERT INTO office_rule_configs (rule_key, rule_id, name, enabled, criticality, weight) VALUES
    ('RULE_01', 'OFF-001', 'Vendor verification status', TRUE, 'HIGH', 25),
    ('RULE_02', 'OFF-002', 'Neighbour confirmation', TRUE, 'MEDIUM', 10),
    ('RULE_03', 'OFF-003', 'Declared address confirmation', TRUE, 'HIGH', 20),
    ('RULE_04', 'OFF-004', 'Negative area flag', TRUE, 'HIGH', 20),
    ('RULE_05', 'OFF-005', 'Vendor-reported political link', TRUE, 'MEDIUM', 10),
    ('RULE_06', 'OFF-006', 'Name plate visibility', TRUE, 'LOW', 5),
    ('RULE_07', 'OFF-007', 'Community-dominated area context', TRUE, 'LOW', 0),
    ('RULE_08', 'OFF-008', 'Corrected address comparison', TRUE, 'HIGH', 20),
    ('RULE_09', 'OFF-009', 'Vendor final status', TRUE, 'HIGH', 25),
    ('RULE_10', 'OFF-010', 'Status and findings consistency', TRUE, 'CRITICAL', 30)
ON CONFLICT (rule_key) DO NOTHING;
"""

MIGRATIONS: list[Migration] = [
    ("rov-0001", "rule configs and rule results (residence / office)", _V1_TABLES),
    ("rov-0002", "seed the default rule configs", _V2_SEED),
    LOGS_MIGRATION,
    responses.MIGRATION,
]
