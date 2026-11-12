-- =====================================================================================================================
-- THE SYNTHETIC ELIGIBILITY DEMO CASES (development / demo only; never in production). 36 cases, one or more per rule
-- and decision (IDs in the LOS format: CASE-/APP- + 12 hex, family CASE-E11D...); every value is invented.
-- Marked is_demo = true: scripts/setup_agent_databases.py --purge-demo removes exactly these.
-- Idempotent (upsert). Needs the migrations first (migrations.seed_demo applies them).
-- =====================================================================================================================

BEGIN;

INSERT INTO eligibility_cases (case_id, applicant_id, label, product, dob, net_monthly_income, existing_emi, bureau_score,
                               property_value, requested_amount, tenure_months, rate_percent, expected_decision)
VALUES
    ('CASE-E11D00000001', 'APP-E11D00000001', 'salaried, strong profile', 'PERSONAL_LOAN', '1993-03-15', 90000, 5000, 790, NULL, 500000, 48, 14.0, 'APPROVED'),
    ('CASE-E11D00000002', 'APP-E11D00000002', 'home loan well inside FOIR and LTV', 'HOME_LOAN', '1988-06-20', 180000, 15000, 810, 9000000, 5000000, 240, 9.0, 'APPROVED'),
    ('CASE-E11D00000003', 'APP-E11D00000003', 'loan against property inside LTV', 'LOAN_AGAINST_PROPERTY', '1979-08-05', 250000, 20000, 770, 10000000, 4000000, 120, 11.0, 'APPROVED'),
    ('CASE-E11D00000004', 'APP-E11D00000004', 'income exactly at the minimum', 'PERSONAL_LOAN', '1992-02-11', 25000, 0, 760, NULL, 100000, 36, 14.0, 'APPROVED'),
    ('CASE-E11D00000005', 'APP-E11D00000005', 'age exactly at the minimum (21)', 'PERSONAL_LOAN', '2005-01-01', 40000, 0, 750, NULL, 150000, 24, 14.0, 'APPROVED'),
    ('CASE-E11D00000006', 'APP-E11D00000006', 'no existing EMIs, small loan', 'PERSONAL_LOAN', '1998-11-30', 60000, 0, 800, NULL, 200000, 24, 14.0, 'APPROVED'),
    ('CASE-E11D00000007', 'APP-E11D00000007', 'home loan, long tenure, young borrower', 'HOME_LOAN', '1996-04-18', 150000, 0, 780, 8000000, 6000000, 300, 9.0, 'APPROVED'),
    ('CASE-E11D00000008', 'APP-E11D00000008', 'requested above the PL maximum', 'PERSONAL_LOAN', '1990-07-01', 150000, 0, 780, NULL, 1500000, 60, 14.0, 'CONDITIONAL'),
    ('CASE-E11D00000009', 'APP-E11D00000009', 'FOIR binds a personal loan', 'PERSONAL_LOAN', '1985-11-02', 50000, 15000, 760, NULL, 800000, 48, 14.0, 'CONDITIONAL'),
    ('CASE-E11D00000010', 'APP-E11D00000010', 'FOIR binds a home loan', 'HOME_LOAN', '1986-09-09', 80000, 20000, 790, 12000000, 8000000, 240, 9.0, 'CONDITIONAL'),
    ('CASE-E11D00000011', 'APP-E11D00000011', 'LTV binds a home loan', 'HOME_LOAN', '1987-05-10', 200000, 10000, 800, 4000000, 3800000, 240, 9.0, 'CONDITIONAL'),
    ('CASE-E11D00000012', 'APP-E11D00000012', 'LTV binds a loan against property', 'LOAN_AGAINST_PROPERTY', '1982-03-03', 300000, 0, 790, 5000000, 4000000, 120, 11.0, 'CONDITIONAL'),
    ('CASE-E11D00000013', 'APP-E11D00000013', 'requested above the LAP maximum', 'LOAN_AGAINST_PROPERTY', '1975-12-12', 900000, 0, 820, 60000000, 25000000, 180, 11.0, 'CONDITIONAL'),
    ('CASE-E11D00000014', 'APP-E11D00000014', 'short tenure makes the EMI too high', 'PERSONAL_LOAN', '1994-10-10', 45000, 5000, 770, NULL, 600000, 12, 14.0, 'CONDITIONAL'),
    ('CASE-E11D00000015', 'APP-E11D00000015', 'score exactly at the cut-off', 'PERSONAL_LOAN', '1991-01-25', 70000, 0, 700, NULL, 200000, 36, 14.0, 'REFER'),
    ('CASE-E11D00000016', 'APP-E11D00000016', 'score 15 points above the cut-off', 'HOME_LOAN', '1989-07-07', 160000, 10000, 715, 9000000, 4000000, 240, 9.0, 'REFER'),
    ('CASE-E11D00000017', 'APP-E11D00000017', 'score just inside the refer margin', 'PERSONAL_LOAN', '1996-09-09', 80000, 0, 719, NULL, 300000, 36, 14.0, 'REFER'),
    ('CASE-E11D00000018', 'APP-E11D00000018', 'very low bureau score', 'PERSONAL_LOAN', '1995-01-20', 60000, 0, 610, NULL, 300000, 36, 14.0, 'REJECTED'),
    ('CASE-E11D00000019', 'APP-E11D00000019', 'score one point below the cut-off', 'HOME_LOAN', '1984-04-04', 200000, 0, 699, 9000000, 4000000, 240, 9.0, 'REJECTED'),
    ('CASE-E11D00000020', 'APP-E11D00000020', 'income below the minimum', 'PERSONAL_LOAN', '1993-05-05', 24000, 0, 780, NULL, 80000, 24, 14.0, 'REJECTED'),
    ('CASE-E11D00000021', 'APP-E11D00000021', 'under 21 (a minor)', 'PERSONAL_LOAN', '2009-01-01', 30000, 0, 750, NULL, 100000, 24, 14.0, 'REJECTED'),
    ('CASE-E11D00000022', 'APP-E11D00000022', 'over 60 today', 'PERSONAL_LOAN', '1964-02-02', 120000, 0, 790, NULL, 300000, 24, 14.0, 'REJECTED'),
    ('CASE-E11D00000023', 'APP-E11D00000023', 'too old at the end of the loan', 'HOME_LOAN', '1970-02-14', 120000, 0, 790, 6000000, 2500000, 240, 9.0, 'REJECTED'),
    ('CASE-E11D00000024', 'APP-E11D00000024', 'existing EMIs already at the FOIR limit', 'PERSONAL_LOAN', '1988-08-08', 40000, 20000, 760, NULL, 200000, 36, 14.0, 'REJECTED'),
    ('CASE-E11D00000025', 'APP-E11D00000025', 'bureau score missing', 'LOAN_AGAINST_PROPERTY', '1980-12-25', 100000, 8000, NULL, 8000000, 3000000, 120, 11.0, 'DATA_MISSING'),
    ('CASE-E11D00000026', 'APP-E11D00000026', 'income missing', 'PERSONAL_LOAN', '1990-10-10', NULL, 0, 780, NULL, 300000, 36, 14.0, 'DATA_MISSING'),
    ('CASE-E11D00000027', 'APP-E11D00000027', 'date of birth missing', 'PERSONAL_LOAN', NULL, 70000, 0, 780, NULL, 300000, 36, 14.0, 'DATA_MISSING'),
    ('CASE-E11D00000028', 'APP-E11D00000028', 'tenure missing', 'HOME_LOAN', '1987-02-02', 150000, 0, 780, 9000000, 4000000, NULL, 9.0, 'DATA_MISSING'),
    ('CASE-E11D00000029', 'APP-E11D00000029', 'LAP without a property value', 'LOAN_AGAINST_PROPERTY', '1981-06-06', 200000, 0, 790, NULL, 3000000, 120, 11.0, 'DATA_MISSING'),
    ('CASE-E11D00000030', 'APP-E11D00000030', 'product not configured', 'CAR_LOAN', '1990-03-03', 80000, 0, 780, NULL, 500000, 60, 12.0, 'DATA_MISSING')
ON CONFLICT (case_id) DO UPDATE SET
    applicant_id = EXCLUDED.applicant_id, label = EXCLUDED.label, product = EXCLUDED.product, dob = EXCLUDED.dob,
    net_monthly_income = EXCLUDED.net_monthly_income, existing_emi = EXCLUDED.existing_emi,
    bureau_score = EXCLUDED.bureau_score, property_value = EXCLUDED.property_value,
    requested_amount = EXCLUDED.requested_amount, tenure_months = EXCLUDED.tenure_months,
    rate_percent = EXCLUDED.rate_percent, expected_decision = EXCLUDED.expected_decision, updated_at = now();

-- the first thirty demo cases have a CLEAN repayment history (so their expected decisions stand)
UPDATE eligibility_cases SET max_dpd_12m = 0, write_offs = 0, settlements = 0
 WHERE case_id BETWEEN 'CASE-E11D00000001' AND 'CASE-E11D00000030' AND max_dpd_12m IS NULL;

-- RULE 6 demo cases: one per repayment-history outcome
INSERT INTO eligibility_cases (case_id, applicant_id, label, product, dob, net_monthly_income, existing_emi, bureau_score,
                               property_value, requested_amount, tenure_months, rate_percent, max_dpd_12m, write_offs,
                               settlements, expected_decision)
VALUES
    ('CASE-E11D00000031', 'APP-E11D00000031', 'DPD 15 days, within the limit', 'PERSONAL_LOAN', '1990-04-04', 90000, 5000, 780, NULL, 400000, 36, 14.0, 15, 0, 0, 'APPROVED'),
    ('CASE-E11D00000032', 'APP-E11D00000032', 'DPD 45 days: refer', 'PERSONAL_LOAN', '1989-05-05', 90000, 5000, 780, NULL, 400000, 36, 14.0, 45, 0, 0, 'REFER'),
    ('CASE-E11D00000033', 'APP-E11D00000033', 'DPD 90 days: reject', 'HOME_LOAN', '1985-06-06', 200000, 10000, 790, 9000000, 4000000, 240, 9.0, 90, 0, 0, 'REJECTED'),
    ('CASE-E11D00000034', 'APP-E11D00000034', 'a written-off account', 'PERSONAL_LOAN', '1991-07-07', 90000, 0, 760, NULL, 300000, 36, 14.0, 0, 1, 0, 'REJECTED'),
    ('CASE-E11D00000035', 'APP-E11D00000035', 'a settled account', 'LOAN_AGAINST_PROPERTY', '1980-08-08', 250000, 0, 770, 10000000, 3000000, 120, 11.0, 0, 0, 1, 'REJECTED'),
    ('CASE-E11D00000036', 'APP-E11D00000036', 'repayment history missing', 'PERSONAL_LOAN', '1992-09-09', 90000, 0, 780, NULL, 300000, 36, 14.0, NULL, NULL, NULL, 'DATA_MISSING')
ON CONFLICT (case_id) DO UPDATE SET
    applicant_id = EXCLUDED.applicant_id, label = EXCLUDED.label, product = EXCLUDED.product, dob = EXCLUDED.dob,
    net_monthly_income = EXCLUDED.net_monthly_income, existing_emi = EXCLUDED.existing_emi,
    bureau_score = EXCLUDED.bureau_score, property_value = EXCLUDED.property_value,
    requested_amount = EXCLUDED.requested_amount, tenure_months = EXCLUDED.tenure_months,
    rate_percent = EXCLUDED.rate_percent, max_dpd_12m = EXCLUDED.max_dpd_12m, write_offs = EXCLUDED.write_offs,
    settlements = EXCLUDED.settlements, expected_decision = EXCLUDED.expected_decision, updated_at = now();

-- every row above is a demo row
UPDATE eligibility_cases SET is_demo = true WHERE case_id LIKE 'CASE-E11D%' AND NOT is_demo;

COMMIT;
