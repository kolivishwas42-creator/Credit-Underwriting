# Bank verification

Reads the bank statement (PDF / CSV: the text layer first, OCR for a scan), checks it with eight rules (bank details, ownership, balances, duplicates, source cross-check, integrity, transactions, risk), lets the agency finalize, and writes the report. Account numbers are masked everywhere.

## Rules

In the database: bank_verification_policy (conf/bank_verification.yaml is the seed; its storage / uploads / server sections stay in the file). See `python scripts/rules.py list`.

## Tables (its schema)

cases, sources, documents, extractions, runs (rule_set_hash), rule_results, decisions, summaries, audit_events, rule_sets, rule_set_active, rule_set_changes, agent_logs

## Endpoints

- `POST /api/v1/bank-verification/process`: API 1: read the statement and run the eight rules
- `POST /api/v1/bank-verification/{case_id}/finalize`: API 2: the agency finalizes
- `GET /api/v1/bank-verification/cases, /cases/{case_id}, /history, /report, /summary`

## Layout

- code: this folder; `api.py` / `api/` is its API
- `conf/`: its rules seed and deployment settings
- `tests/`: its tests (`python -m pytest bank_verification/tests`)
