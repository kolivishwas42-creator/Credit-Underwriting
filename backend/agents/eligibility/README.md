# Eligibility

Decides whether a case is eligible and for how much: the five rules (age, income, credit score, FOIR, DPD / write-offs), the product's LTV grid and income method, then APPROVED / CONDITIONAL / REFER / REJECTED / DATA_MISSING with the eligible amount and EMI. A local model (optional) writes the plain-words explanation; it never decides.

## Rules

In the database: eligibility_policy (conf/eligibility_config.yaml is the seed). See `python scripts/rules.py list`.

## Tables (its schema)

eligibility_cases, eligibility_inputs, eligibility_runs (rule_set_hash), audit_events, rule_sets, rule_set_active, rule_set_changes, agent_logs

## Endpoints

- `POST /api/v1/eligibility/check`: check a case (saved as a run)
- `POST /api/v1/eligibility/check-form`: the same check from a form
- `GET /api/v1/eligibility/runs/{run_id}`: one saved check
- `GET /api/v1/eligibility/{case_id}`: the decision recorded on a LOS case
- `GET/PUT /api/v1/eligibility/cases/...`: the screen's cases and the officer's entries
- `POST /api/v1/eligibility/explain, /explain/stream`: the plain-words explanation

## Layout

- code: this folder; `api.py` / `api/` is its API
- `conf/`: its rules seed and deployment settings
- `tests/`: its tests (`python -m pytest eligibility/tests`)
