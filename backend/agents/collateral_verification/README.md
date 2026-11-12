# Collateral verification

Compares a vendor title-search / CERSAI report with the collateral record of a loan application in the LOS case
tables: property owner, single vs joint ownership, applicant vs owner, PAN (CERSAI debtor search), PIN / city / state,
flat / house number, construction status and completion %. The rules and thresholds are configurable (database,
seeded from `conf/rules.yaml`) and every verification run is stored for audit.

Mounted by `main.py` (through `agents/registry.py`) behind the LOS JWT.

## Layout

| Path | What |
|------|------|
| `api.py` | the `APIRouter` (`router`), HTTP only |
| `service.py` | the use cases; receives its repository and report extractor |
| `rules/engine.py`, `rules/names.py` | the rule engine and the name matching (pure, no I/O) |
| `extract/` | `ReportExtractor` interface; `text.py` (ODG / PDF text layer / plain text), `fields.py` (vendor fields) |
| `repository.py` | `CollateralRepository` (Protocol) + `PostgresCollateralRepository` (psycopg 3 via `shared.db.pg`) |
| `schemas.py` | the request bodies (Pydantic) |
| `config.py`, `conf/rules.yaml` | settings: rule defaults, settings seed, LOS schema |
| `db/schema.py` | `MIGRATIONS` |
| `frontend/` | the Vite + React desk (Verify, Rules Config) |

## Endpoints (prefix `/api/v1/credit/collateral-verification`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | ok, version, `database_configured`, rule count |
| GET | `/config` | the live rule configuration (statuses, tolerance, threshold, flags, rules) |
| GET | `/rules` | rule configs |
| PUT | `/rules?updated_by=` | upsert one rule (`rule_id`, `enabled`, `label`, `tolerance_pp`, `extra_json`); 400 without `rule_id` |
| PUT | `/rules/bulk` | upsert several (`rules`, `updated_by`) |
| POST | `/rules/reload` | reload the live configuration from the database |
| GET | `/settings` | thresholds and flags (`parsed_value` typed) |
| PUT | `/settings?updated_by=` | upsert one setting (`setting_key`, `parsed_value` or `setting_value`, `value_type`, `description`) |
| PUT | `/settings/bulk` | upsert several (`settings`, `updated_by`) |
| GET | `/results?limit=&offset=&application_number=` | stored runs, newest first |
| POST | `/collateral/extract-only` | multipart `file`: the vendor fields read from the report |
| POST | `/collateral/verify` | multipart `final_status` (approved / rejected), `application_id` or `application_number`, `report` file |

`/collateral/verify` returns `application_id`, `application_number`, `data_source`, `vendor_final_status`,
`report_file`, `comparison_results` (one line per rule: `rule_id`, `label`, `enabled`, `status`, `summary`,
`db_value`, `vendor_value`, `detail`), `source_evidence`, `summary` (`overall`, `counts`, `vendor_status_conflict`,
`conflict_reason`, `recommended_actions`) and `run_id` when the run was stored. Errors: 422 (no / empty report, bad
`final_status`, no identifier, no collateral property), 404 (no application), 503 (database not configured).

## Rules

| Rule | Default | Outcome |
|------|---------|---------|
| `rule_1_owner_name` | on | application owner vs vendor owners (token overlap >= `NAME_MATCH_THRESHOLD`) |
| `rule_2_ownership` | on | single / joint vs vendor owner count (joint + one owner = WARNING) |
| `rule_3_applicant_is_owner` | on | an applicant / co-applicant among the vendor owners |
| `rule_pan` | on | owner PAN, else applicant PAN, else report applicant PAN vs CERSAI debtor-search PAN |
| `rule_8_construction_status` | off | application vs vendor construction status |
| `rule_9_completion_percent` | off | completion % within `tolerance_pp` (default `COMPLETION_TOLERANCE_PP`) |
| `rule_13_location` | on | PIN (exact), city, state (case-insensitive) |
| `rule_14_unit_number` | on | flat / house number (alphanumerics only) |
| `rule_17_registered_deed` | on | configured, but has no evaluator (switched off in code): produces no line |
| `cersai_charge_review` | `FLAG_UNSATISFIED_CERSAI_CHARGE` | REFER when a CERSAI charge is "Not Satisfied" |

Overall: REFER > WARNING > PENDING > PASS. `FLAG_VENDOR_STATUS_CONFLICT` flags vendor "approved" with REFER /
WARNING, or "rejected" with PASS. Images are accepted but not OCR'd (no text: the rules report PENDING).

## Tables (schema `collateral_check` in `los_agentic`)

| Table | Purpose |
|-------|---------|
| `collateral_rule_configs` | per-rule `enabled`, `label`, `tolerance_pp`, `extra_json` |
| `collateral_system_settings` | `COMPLETION_TOLERANCE_PP`, `NAME_MATCH_THRESHOLD`, `COMPARE_PIN`, `FLAG_VENDOR_STATUS_CONFLICT`, `FLAG_UNSATISFIED_CERSAI_CHARGE`, `VENDOR_FINAL_STATUSES` |
| `collateral_verification_results` | one row per run (`run_id`, application, overall, summary, comparison results, evidence) |
| `agent_logs`, `api_responses` | the shared log and response tables |

Migrations (`db/schema.py`): `0001` the three tables, `0002` agent_logs, `0003` api_responses. They run, and the rule /
setting tables are seeded from `conf/rules.yaml` when empty, on the first request of the process. Read-only, from the
LOS case schema (`COLLATERAL_VERIFICATION_LOS_SCHEMA`, default `public`): `loan_applications`,
`collateral_properties`, `collateral_property_documents`, `application_participants`, `customers`,
`primary_applicant_kyc`.

## Configuration

| Variable | Meaning |
|----------|---------|
| `LOS_AGENTIC_DSN` | the shared database (the agent uses schema `collateral_check`) |
| `COLLATERAL_VERIFICATION_DSN` | optional: a database of the agent's own (overrides the shared one) |
| `COLLATERAL_VERIFICATION_LOS_SCHEMA` | optional: schema of the LOS case tables (default `los_schema` in `conf/rules.yaml`) |

Frontend: `VITE_API_BASE` (default `/api/v1/credit/collateral-verification`), `VITE_API_PROXY` (dev proxy target).
The service requires the LOS bearer token on every route.

## Tests

```
python -m pytest agents/collateral_verification/tests -q -p no:cacheprovider
```

Rules, extraction, service (fake repository + extractor) and an API smoke test need no database.
`test_repository_pg.py` (marker `live_pg`) runs the repository on a throwaway PostgreSQL only when `LOS_TEST_PG_DSN`
is set.
