# Credit document policy (Document Desk)

Which documents the credit stage still needs for a case: eleven policy rules (product requirements, co-applicants, freshness, waivers, cross-stage reuse ...) over the case's stored documents. COMPLETE only when nothing blocking is open. One policy file per product in policies/ (the seed of each version).

## Rules

In the database: docs_policy:<file> -- one rule set per policy file. See `python scripts/rules.py list`.

## Tables (its schema)

docs_policy_evaluations (rule_set_hash), docs_policy_requirement_results, audit_events, rule_sets, rule_set_active, rule_set_changes, agent_logs

## Endpoints

- `POST /api/v1/credit/document-readiness/{case_id}`: the open requirements
- `POST /api/v1/credit/document-readiness/{case_id}/rules`: every rule's PASS / WARN / FAIL

## Layout

- code: this folder; `api.py` / `api/` is its API
- `conf/`: its rules seed and deployment settings
- `tests/`: its tests (`python -m pytest docs_policy/tests`)
