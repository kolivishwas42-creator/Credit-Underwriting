-- =====================================================================================================================
-- ELIGIBILITY DATA (2026-10-13): the tables of the eligibility database (ELIGIBILITY_DSN). Migration elig-0001
-- (eligibility/data/migrations.py) -- a released migration: never edit, add the next one there.
-- Idempotent (IF NOT EXISTS). The SYNTHETIC demo cases are in demo_seed.sql (development / demo only).
--
-- NULL means "not known" and is passed through as None: the engine answers DATA_MISSING for a mandatory field.
-- Age is derived from `dob` in code.
-- =====================================================================================================================

CREATE TABLE IF NOT EXISTS eligibility_cases (
    case_id             TEXT PRIMARY KEY CHECK (case_id ~ '^CASE-[0-9A-F]{12}$'),
    applicant_id        TEXT NOT NULL    CHECK (applicant_id ~ '^APP-[0-9A-F]{12}$'),
    label               TEXT,
    product             TEXT,
    dob                 DATE,
    net_monthly_income  NUMERIC(14, 2) CHECK (net_monthly_income IS NULL OR net_monthly_income >= 0),
    existing_emi        NUMERIC(14, 2) CHECK (existing_emi IS NULL OR existing_emi >= 0),
    bureau_score        INTEGER        CHECK (bureau_score IS NULL OR bureau_score BETWEEN 0 AND 900),
    property_value      NUMERIC(16, 2) CHECK (property_value IS NULL OR property_value >= 0),
    requested_amount    NUMERIC(16, 2) CHECK (requested_amount IS NULL OR requested_amount > 0),
    tenure_months       INTEGER        CHECK (tenure_months IS NULL OR tenure_months > 0),
    rate_percent        NUMERIC(6, 3)  CHECK (rate_percent IS NULL OR rate_percent >= 0),
    expected_decision   TEXT           CHECK (expected_decision IS NULL OR expected_decision IN
                                              ('APPROVED', 'CONDITIONAL', 'REFER', 'REJECTED', 'DATA_MISSING')),
    created_at          TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ    NOT NULL DEFAULT now()
);

-- RULE 6 (2026-10-14): the bureau's repayment history -- worst days-past-due in the last 12 months, and the count of
-- written-off / settled accounts. NULL = not known (DATA_MISSING), never "clean".
ALTER TABLE eligibility_cases ADD COLUMN IF NOT EXISTS max_dpd_12m INTEGER CHECK (max_dpd_12m IS NULL OR max_dpd_12m >= 0);
ALTER TABLE eligibility_cases ADD COLUMN IF NOT EXISTS write_offs  INTEGER CHECK (write_offs IS NULL OR write_offs >= 0);
ALTER TABLE eligibility_cases ADD COLUMN IF NOT EXISTS settlements INTEGER CHECK (settlements IS NULL OR settlements >= 0);

-- the officer's SAVED ENTRIES per case (eligibility screen: Save, then Trigger eligibility), replaced on every save
CREATE TABLE IF NOT EXISTS eligibility_inputs (
    case_id    TEXT PRIMARY KEY,
    inputs     JSONB NOT NULL,
    saved_by   TEXT,
    saved_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- every check run (POST /api/v1/eligibility/check): the decision and the full result, for audit and history
CREATE TABLE IF NOT EXISTS eligibility_runs (
    run_id            TEXT PRIMARY KEY,
    case_id           TEXT NOT NULL,
    decision          TEXT NOT NULL CHECK (decision IN ('APPROVED', 'CONDITIONAL', 'REFER', 'REJECTED', 'DATA_MISSING')),
    eligible_amount   NUMERIC(16, 2),
    emi               NUMERIC(14, 2),
    foir_pct          NUMERIC(7, 2),
    result            JSONB NOT NULL,
    config_version    TEXT,
    requested_by      TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS eligibility_runs_case_idx ON eligibility_runs (case_id, created_at DESC);
