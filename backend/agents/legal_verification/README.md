# Legal verification (collateral)

The legal check of the property: the documents (sale deed, EC, title chain ...), the agency's report, the checks (title, encumbrance, registration, names, address), a recommendation (CLEAR_FOR_REVIEW / REVIEW_REQUIRED / ESCALATE) and the officer's decision.

## Rules

In the database: legal_verification_policy (conf/legal_verification.yaml is the seed). See `python scripts/rules.py list`.

## Tables (its schema)

legal_verification_applications, _cases, _documents, _corrections, _agency_reports, _runs (rule_set_hash), _summaries, _audit, rule_sets, rule_set_active, rule_set_changes, agent_logs

## Endpoints

- `PUT /api/v1/credit/legal-verification/applications/{id}`: the LOS pushes an application
- `POST .../applications/{id}/documents, /send, /agency-report, /validate, /decision`
- `GET .../applications/{id}, /summary, /report`

## Layout

- code: this folder; `api.py` / `api/` is its API
- `conf/`: its rules seed and deployment settings
- `tests/`: its tests (`python -m pytest legal_verification/tests`)
