"""
The fraud screening tables, as ordered migrations (append only; each runs once, in one transaction). The SQL is
unqualified: the tables land in the agent's schema (search_path = fraud_screening, shared/db/core.py).

0001 is sql/init_fraud_schema.sql of the former fraud_agent without its hard-coded `fraud_detection` schema:
rule_config (with the seeded rules), fraud_results and their indexes.
"""

from __future__ import annotations

from shared.db import LOGS_MIGRATION, responses

_V1 = """
-- Rule configuration (editable from frontend)
CREATE TABLE rule_config (
    rule_key          VARCHAR(80) PRIMARY KEY,
    rule_id           VARCHAR(20)  NOT NULL,
    rule_name         VARCHAR(150) NOT NULL,
    description       TEXT,
    severity          VARCHAR(20)  NOT NULL DEFAULT 'Medium',
    enabled           BOOLEAN      NOT NULL DEFAULT TRUE,
    is_implementable  BOOLEAN      NOT NULL DEFAULT TRUE,
    config_json       JSONB        NOT NULL DEFAULT '{}'::jsonb,
    sort_order        INTEGER      NOT NULL DEFAULT 0,
    created_at        TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One row per fraud evaluation run
CREATE TABLE fraud_results (
    result_id           BIGSERIAL PRIMARY KEY,
    application_id      BIGINT,
    application_number  VARCHAR(30) NOT NULL,
    risk_level          VARCHAR(20) NOT NULL,
    is_potential_fraud  BOOLEAN     NOT NULL DEFAULT FALSE,
    hybrid_flag         BOOLEAN     NOT NULL DEFAULT FALSE,
    fraud_warning       TEXT,
    flagged_rules       JSONB       NOT NULL DEFAULT '[]'::jsonb,
    skipped_rules       JSONB       NOT NULL DEFAULT '[]'::jsonb,
    rule_results        JSONB       NOT NULL DEFAULT '[]'::jsonb,
    distances           JSONB,
    aml_result          JSONB,
    pep_result          JSONB,
    full_payload        JSONB,
    created_at          TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_fraud_results_app_number
    ON fraud_results (application_number);

CREATE INDEX idx_fraud_results_app_id
    ON fraud_results (application_id);

CREATE INDEX idx_fraud_results_created
    ON fraud_results (created_at DESC);

-- Seed default rules (nominee = co-applicant)
INSERT INTO rule_config
    (rule_key, rule_id, rule_name, description, severity, enabled, is_implementable, config_json, sort_order)
VALUES
    ('Rule1_PAN_Aadhaar_Mismatch', 'Rule 1', 'Primary PAN/Aadhaar invalid',
     'Primary applicant PAN or Aadhaar number is invalid (a PAN is 10 characters: 5 letters, 4 digits, 1 letter; an Aadhaar is 12 digits).',
     'High', TRUE, TRUE, '{}', 10),
    ('Rule1_CoApp_PAN_Aadhaar_Mismatch', 'Rule 1', 'Co-applicant PAN/Aadhaar invalid',
     'Co-applicant PAN or Aadhaar number is malformed.',
     'High', TRUE, TRUE, '{}', 11),
    ('Rule2_CoApp_Identity_Swap', 'Rule 2', 'Co-applicant identity swap',
     'Co-applicant has the same PAN as the primary applicant but a different name.',
     'High', TRUE, TRUE, '{}', 20),
    ('Rule3_Distant_Branch', 'Rule 3', 'Distant branch (geo)',
     'Branch is more than configured km from the applicant (requires lat/long; not available in current schema).',
     'Medium', FALSE, FALSE, '{"distance_km": 5}', 30),
    ('Rule4_Name_Age_Tweak', 'Rule 4', 'Name tweak + age deviation',
     'Primary and co-applicant names are near-identical but ages differ by more than 5 years.',
     'Medium', TRUE, TRUE, '{"age_diff_years": 5, "name_similarity": 0.85}', 40),
    ('Rule5_Dual_Identity_Mismatch', 'Rule 5', 'Historical dual-identity mismatch',
     'Primary Aadhaar or PAN already exists in past applications under a different name.',
     'Critical', TRUE, TRUE, '{}', 50),
    ('Rule6_Shared_Bank_Account', 'Rule 6', 'Primary shared bank account',
     'Primary bank account is already linked to a different customer (possible mule account).',
     'Critical', TRUE, TRUE, '{}', 60),
    ('Rule6_CoApp_Shared_Bank_Account', 'Rule 6', 'Co-applicant shared bank account',
     'Co-applicant bank account is shared with primary, another applicant, or another co-applicant.',
     'Critical', TRUE, TRUE, '{}', 61),
    ('Rule7_Income_Inflation', 'Rule 7', 'Income inflation (primary/co-app)',
     'Declared income far above bank credits. Requires bank credit totals not present in current schema.',
     'High', FALSE, FALSE, '{"ratio": 1.5}', 70),
    ('Rule8_Low_Credit_Score', 'Rule 8', 'Low credit score',
     'Applicant credit score is at or below threshold. Credit score not stored in current schema.',
     'Medium', FALSE, FALSE, '{"min_score": 550}', 80),
    ('Rule9_Age_DOB_Mismatch', 'Rule 9', 'Age does not match DOB',
     'Stated age does not match age calculated from date of birth.',
     'High', TRUE, TRUE, '{}', 90),
    ('Rule9_DOB_Conflict', 'Rule 9', 'DOB conflict with existing profile',
     'Same Aadhaar/PAN and name already exist in past records with a different date of birth.',
     'Critical', TRUE, TRUE, '{}', 91),
    ('Rule11_Doc_Mismatch', 'Rule 11', 'Identity-document mismatch',
     'Name/DOB on PAN or Aadhaar does not match application, or PAN not linked to Aadhaar. Requires external KYC vendor response.',
     'High', FALSE, FALSE, '{}', 110),
    ('Rule12_Duplicate_Identity', 'Rule 12', 'Duplicate identity',
     'Primary Aadhaar/PAN already used by another applicant, or same name+DOB with different Aadhaar/PAN.',
     'Critical', TRUE, TRUE, '{}', 120),
    ('Rule13_Synthetic_Identity', 'Rule 13', 'Possible synthetic identity',
     'Several weak identity signals together (checksum failure, thin history, under 18, etc.). Partial with current data.',
     'High', TRUE, TRUE, '{}', 130),
    ('Rule14_Device_Fraud', 'Rule 14', 'Device/Digital fraud',
     'Device tampering or same device used by too many users. No device data in schema.',
     'Medium', FALSE, FALSE, '{}', 140),
    ('Rule15_Address_Reuse', 'Rule 15', 'Address reuse',
     'Applicant address matches a historical record belonging to a different customer.',
     'Medium', TRUE, TRUE, '{}', 150),
    ('Rule16_Relationship_Fraud', 'Rule 16', 'Applicant–co-applicant relationship fraud',
     'Primary and co-applicant share address without immediate-family relationship.',
     'Medium', TRUE, TRUE, '{}', 160)
ON CONFLICT (rule_key) DO NOTHING
"""

# 0004: the rule changes made in the former fraud_agent after the port (2026-11-03/04): rules 2, 4, 5, 9, 12, 15 and
# 16 check more (co-applicant registrations, earlier applications, every participant, family surnames). New per-rule
# parameters are ADDED to config_json (a value already set is kept); rule 15 becomes Low only while it is still the
# seeded Medium (an edited severity is kept).
_V4 = """
UPDATE rule_config SET description =
    'Co-applicant has the same PAN as the primary applicant but a different name, or the applicant''s PAN is already registered as a co-applicant in another application.',
    updated_at = CURRENT_TIMESTAMP
 WHERE rule_key = 'Rule2_CoApp_Identity_Swap';

UPDATE rule_config SET description =
    'Names are near-identical but ages differ (primary vs co-applicant, or vs an earlier application with a different DOB).',
    config_json = '{"age_diff_years": 5, "name_similarity": 0.85, "history_age_diff_years": 1}'::jsonb || config_json,
    updated_at = CURRENT_TIMESTAMP
 WHERE rule_key = 'Rule4_Name_Age_Tweak';

UPDATE rule_config SET description =
    'Primary Aadhaar or PAN already has a record in a past application (flagged separately when it is under a different name).',
    config_json = '{"include_same_customer": true}'::jsonb || config_json,
    updated_at = CURRENT_TIMESTAMP
 WHERE rule_key = 'Rule5_Dual_Identity_Mismatch';

UPDATE rule_config SET description =
    'Stated age does not match age calculated from date of birth (applicant and co-applicant).',
    config_json = '{"age_dob_tolerance_years": 1}'::jsonb || config_json,
    updated_at = CURRENT_TIMESTAMP
 WHERE rule_key = 'Rule9_Age_DOB_Mismatch';

UPDATE rule_config SET description =
    'Applicant or co-applicant Aadhaar/PAN/mobile already assigned to another applicant or co-applicant, or same name+DOB with different Aadhaar/PAN.',
    updated_at = CURRENT_TIMESTAMP
 WHERE rule_key = 'Rule12_Duplicate_Identity';

UPDATE rule_config SET description =
    'Applicant address matches a historical record of a different customer with no family link (no shared surname).',
    severity = CASE WHEN severity = 'Medium' THEN 'Low' ELSE severity END,
    updated_at = CURRENT_TIMESTAMP
 WHERE rule_key = 'Rule15_Address_Reuse';

UPDATE rule_config SET description =
    'Applicant and co-applicant share the same address (similarity at or above the threshold).',
    config_json = '{"address_match_threshold": 0.95, "ignore_family_relation": false}'::jsonb || config_json,
    updated_at = CURRENT_TIMESTAMP
 WHERE rule_key = 'Rule16_Relationship_Fraud'
"""

MIGRATIONS: list[tuple[str, str, str]] = [
    ("0001", "fraud screening: rule_config (seeded rules), fraud_results", _V1),
    ("0002", "agent_logs: WARNING and above application logs (shared, shared/db)", LOGS_MIGRATION[2]),
    ("0003", "fraud screening: api_responses (every API response, append-only)", responses.MIGRATION[2]),
    ("0004", "fraud screening: rules 2/4/5/9/12/15/16 widened (descriptions, new config_json keys, rule 15 Low)",
     _V4),
]
