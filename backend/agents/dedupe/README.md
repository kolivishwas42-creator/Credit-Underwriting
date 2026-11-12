# Dedupe (and customer history)

Finds the applicant elsewhere: the LOS's own cases, MiFin and the LMS, on PAN, mobile, customer id, loan account ...; then the policy's outcome (PROCEED / HOLD_FOR_REVIEW / BLOCK / UNABLE_TO_DECIDE) with reason codes. Matched values of other customers are never returned in full.

## Rules

In the database: dedupe_policy, customer_history_policy (conf/*.yaml are the seeds). See `python scripts/rules.py list`.

## Tables (its schema)

in the audit schema: audit_dedupe_decisions (rule_set_hash), audit_customer_history, rule_sets, rule_set_active, rule_set_changes, agent_logs

## Endpoints

- `POST /api/v1/credit/dedupe`: one parameter
- `POST /api/v1/credit/dedupe/all`: every parameter at once
- `GET /api/v1/credit/dedupe/{request_id}/reason`: the 3-point reason of one check

## Layout

- code: this folder; `api.py` / `api/` is its API
- `conf/`: its rules seed and deployment settings
- `tests/`: its tests (`python -m pytest dedupe/tests`)
