# ITR verification agent

Compares a **customer Input ITR** with a **vendor Output ITR** (PDF or image), optionally checks the loan
application's PAN / assessment year / GTI against both documents and reads the vendor's final status, and returns a
weighted match score, a decision (`ACCEPT` / `REVIEW` / `REJECT`) and severity-tagged mismatches. Every verification is
stored; rules and thresholds are editable from the Rules Config screen.

## Layout

| Path | What |
|---|---|
| `api.py` | HTTP only: `router` (prefix `/credit/itr-verification`; main.py mounts it under `/api/v1` with the LOS JWT) |
| `service.py` | use cases (`ITRVerificationService`); `build_service()` wires the real repository / store / extractor |
| `rules/engine.py` | the rule engine `compare_documents(input, output, policy, application_data, final_status)` -- pure |
| `rules/policy.py` | `Policy` (defaults from conf, database rows on top), rule merge, setting (de)serialisation -- pure |
| `extractors/` | PDF / image text (PyMuPDF -> pdfplumber -> pdf2image + Tesseract) and regex field parsing |
| `storage/` | where documents named by id come from: `local`, `s3`, `dms` behind one `DocumentResolver` interface |
| `repository.py` | `ITRRepository` Protocol + `PostgresITRRepository` (shared.db.pg, agent key `itr_verification`) |
| `schemas.py` | Pydantic request / response models |
| `config.py` | env settings (`ITR_VERIFICATION_*`) and the conf files |
| `conf/rules.yaml` | default comparison rules, application rules and decision settings (seeded into the DB) |
| `conf/documents.yaml` | supported file types, max upload size, OCR, extracted fields and their regex patterns, storage defaults |
| `db/schema.py` | `MIGRATIONS` (unqualified SQL; tables land in schema `itr_verification`) |
| `frontend/` | React + Vite UI (Verify and Rules Config tabs) |
| `tests/` | rules, service (fakes), extraction / storage, API smoke test, repository on a throwaway test Postgres |

## Endpoints (all under `/api/v1/credit/itr-verification`, LOS JWT required)

| Method | Path | Description |
|---|---|---|
| GET | `/` | the routes below |
| GET | `/health` | status, thresholds in force, supported types, `database` = `connected` / `error:<kind>` |
| GET | `/config` | comparison / application rules and thresholds in force |
| GET | `/applications/{application_number}/participants` | the application (found by its number, e.g. `LOS-DUMMY-0045`) and its participants (`participant_id`, `name`, `applicant_type`, `is_primary`); 404 when the number is unknown |
| POST | `/verify` | multipart `input_doc` + `output_doc` upload (`?return_raw=`) |
| POST | `/verify/by-ids` | documents named by id in the configured store + application values + `final_status` |
| POST | `/verify/fields` | `{"input_fields": {...}, "output_fields": {...}}` (no documents, no application data) |
| GET | `/rules` | rule configs (`?category=comparison|application`) |
| PUT | `/rules` | upsert one rule (by category + field; omitted attributes keep their stored value) |
| PUT | `/rules/bulk` | bulk upsert (the Rules Config tab's Save All) |
| POST | `/rules/reload` | re-read rules + settings from the database (500 when the database cannot be read) |
| GET | `/settings` | system settings (thresholds, vendor-status policies) |
| PUT | `/settings` | upsert one setting (`parsed_value` or `setting_value`; `value_type` kept from the stored row) |
| PUT | `/settings/bulk` | bulk upsert settings |
| GET | `/results` | stored runs, newest first (`limit` 1-500, `offset`, `decision`, `pan_number`) |
| GET | `/results/{run_id}` | one stored run (404 when absent) |

`/verify/by-ids` body:

```json
{"input_doc_id": "customer_itr.pdf", "output_doc_id": "vendor_itr.pdf", "pan_number": "ABCDE1234F",
 "assessment_year": "2024-25", "gti_income": 850000, "final_status": "Approved",
 "application_number": "LOS-DUMMY-0045", "participant_id": 102}
```

`application_number` and `participant_id` name the case the ITR is verified for (the UI offers the participants of the
application from `/applications/{application_number}/participants`). They go together: one without the other is 400;
an unknown application, or a participant who is not under it, is 404 (checked before any document is read). The run keeps
both (`verification_results.application_number` / `participant_id`) and the response carries them with `participant_name`.
Optional in the API (older callers), required by the UI.

The application fields are optional in the API (older callers), required by the UI. A missing application value is
reported `NOT VERIFIED`; a missing or unrecognised vendor status follows `FINAL_STATUS_UNKNOWN_BEHAVIOUR`.

## How a decision is made

* Each enabled comparison rule scores 0-100 (`exact`, `normalized` assessment year, `numeric_tolerance`, `fuzzy` with
  a 0-1 similarity threshold) and contributes `weight`; both sides missing counts as a match, one side missing as a
  mismatch.
* With application data, each application rule is checked against **both** documents (`application_<key>_vs_<side>_document`);
  GTI falls back to the document's total income.
* `overall_score` = earned weight / total weight x 100; `>= ACCEPT_THRESHOLD` (90) ACCEPT, `>= REVIEW_THRESHOLD` (70)
  REVIEW, else REJECT.
* Overrides, in order: critical application mismatch + `CRITICAL_APPLICATION_MISMATCH_FORCES_REJECT` -> REJECT; vendor
  REJECTED (with `VENDOR_REJECTION_FORCES_REJECT`) or unknown status with policy `reject` -> REJECT; unknown status with
  policy `review` -> at most REVIEW; any critical failure with `CRITICAL_BLOCKS_ACCEPT` -> at most REVIEW.
* Vendor status aliases (`FINAL_STATUS_APPROVED_VALUES` / `..._REJECTED_VALUES`) are case-insensitive.

## Tables (schema `itr_verification`)

| Table | Purpose |
|---|---|
| `rule_configs` | comparison + application rules (unique `category, field`), editable |
| `system_settings` | thresholds and vendor-status policies (`setting_key` -> text + `value_type`) |
| `verification_results` | every run: request context, decision, score, field results, mismatches, extracted fields |
| `agent_logs`, `api_responses` | the shared WARNING+ log and API response tables (shared/db) |

Migrations: `0001` the three ITR tables, `0002` agent_logs, `0003` api_responses. On first use the repository applies
pending migrations and seeds `conf/rules.yaml` into **empty** rule / setting tables; after that the database copy is in
force. If the database cannot be read when the rules are first needed, the conf defaults are used and a warning is
logged; result storage is best effort (a failed insert never fails a verification, it is logged).

## Configuration (environment)

| Variable | Meaning |
|---|---|
| `LOS_AGENTIC_DSN` | the shared database (schema `itr_verification`), resolved by shared/db/core.py |
| `ITR_VERIFICATION_LOS_SCHEMA` | the schema of the LOS tables read for the application / participants (default `public`) |
| `ITR_VERIFICATION_DSN` | optional: a database of the agent's own instead |
| `ITR_VERIFICATION_DOCUMENT_SOURCE` | `local` (default from conf) / `s3` / `dms` -- used by `/verify/by-ids` |
| `ITR_VERIFICATION_LOCAL_INPUT_DIR`, `ITR_VERIFICATION_LOCAL_OUTPUT_DIR` | local store folders (required for `local`; ids cannot leave them) |
| `ITR_VERIFICATION_S3_BUCKET`, `ITR_VERIFICATION_S3_REGION` | S3 store (credentials: the standard AWS chain / IAM role) |
| `ITR_VERIFICATION_DMS_BASE_URL`, `ITR_VERIFICATION_DMS_API_KEY`, `ITR_VERIFICATION_DMS_TIMEOUT_SECONDS` | DMS store |
| `ITR_VERIFICATION_TEMP_DIR` | where S3 / DMS downloads are written (default: system temp); they are deleted after use |

System dependencies for real documents: Tesseract OCR (images / scanned pages), Poppler (pdf2image last resort).

Frontend: `cd frontend && npm install && npm run dev`. The API base defaults to
`${VITE_LOS_API_ORIGIN}/api/v1/credit/itr-verification` (same origin when unset; set `LOS_API_PROXY_TARGET` to proxy
`/api` in dev). The LOS JWT is sent from `localStorage["los_access_token"]` when present.

## Tests

```
python -m pytest agents/itr_verification/tests -q -p no:cacheprovider
```

No test reads a real document or a configured database: the rule / service / API tests use fakes and synthetic
fields; `test_repository_pg.py` creates and drops a throwaway database on the test PostgreSQL server.
