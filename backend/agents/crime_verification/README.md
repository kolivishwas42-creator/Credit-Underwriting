# Crime record verification

The criminal-record check of the applicant and every co-applicant through the vendor: initiate (after the officer confirms), the vendor's result per person (risk level, cases), review when the risk requires it, finalize, report.

## Rules

In the database: crime_verification_policy (conf/crime_verification.yaml is the seed). See `python scripts/rules.py list`.

## Tables (its schema)

crime_verification_applications, _parties, _cases, _subjects, _results (rule_set_hash), _reports, _summaries, _audit, rule_sets, rule_set_active, rule_set_changes, agent_logs

## Endpoints

- `PUT /api/v1/credit/crime-verification/applications/{id}`: the LOS pushes an application
- `POST /api/v1/credit/crime-verification/initiate`: API 1
- `POST /api/v1/credit/crime-verification/{case_id}/finalize`: API 2
- `GET .../cases/{case_id}, /status, /report, /summary, /audit`

## Layout

- code: this folder; `api.py` / `api/` is its API
- `conf/`: its rules seed and deployment settings
- `tests/`: its tests (`python -m pytest crime_verification/tests`)
