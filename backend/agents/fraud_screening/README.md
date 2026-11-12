# Fraud screening (AML / PEP / rules)

Rule-based fraud screening for a loan application stored in the LOS database. You pass an `application_number`; the
agent loads the application (primary applicant, co-applicants, KYC, addresses, bank accounts), evaluates every enabled
rule, optionally runs **AML** and **PEP** watch-list screening, and stores the outcome in its own schema.

The first co-applicant (`application_participants`, not primary) is treated as the former "nominee".

## Endpoints

Mounted by `main.py` under `/api/v1` behind the LOS token (`require_jwt`).

| Method | Path | What |
|---|---|---|
| POST | `/api/v1/credit/fraud-screening/fraud/evaluate` | `{"application_number", "run_aml": true, "run_pep": true}` -> `risk_level`, `flagged_rules`, `rule_results`, `warnings`, `aml`, `pep`, stored `result_id`; 404 when the application does not exist |
| GET | `/api/v1/credit/fraud-screening/fraud/results/{application_number}` | the latest stored result (404 when none) |
| GET | `/api/v1/credit/fraud-screening/rules` | the rule configuration |
| PATCH | `/api/v1/credit/fraud-screening/rules/{rule_key}` | `{"enabled", "severity", "description", "config_json"}`; enabling a non-implementable rule -> 400 |
| GET | `/api/v1/credit/fraud-screening/ui` | the result viewer (`frontend/fraud_result_viewer.html`) |

Risk level: the highest severity among triggered rules (Low/Medium/High/Critical -> LOW/MEDIUM/HIGH/CRITICAL); MEDIUM
with three or more triggered rules becomes HIGH. An AML / PEP failure never fails the evaluation: it is returned as
`{"error": ..., "status": "error"}` in `aml` / `pep`.

## Rules

| Rule | Status | Notes |
|---|---|---|
| 1 PAN/Aadhaar format (primary + co-app) | enabled | format + Aadhaar Verhoeff; masked IDs are not failed |
| 2 Co-app identity swap | enabled | same PAN, different name; or the applicant's PAN is already a co-applicant in another application |
| 3 Distant branch | not implementable | no lat/long in the LOS schema |
| 4 Name tweak + age deviation | enabled | primary vs co-app, and vs earlier applications with another DOB; `config_json`: `age_diff_years`, `name_similarity`, `history_age_diff_years` |
| 5 Historical dual identity | enabled | Aadhaar/PAN already has a record in a past application (different name said separately); `config_json`: `include_same_customer` |
| 6 Shared bank account (primary + co-app) | enabled | co-app vs applicant: same account number and IFSC (unless one IFSC is missing) |
| 7 Income inflation / 8 Low credit score | not implementable | no bank-credit totals / credit score |
| 9 Age vs DOB, DOB conflict | enabled | age vs DOB for applicant and co-applicant; `config_json`: `age_dob_tolerance_years` |
| 11 Document mismatch | not implementable | needs an external KYC vendor |
| 12 Duplicate identity | enabled | applicant / co-app Aadhaar, PAN, mobile vs every earlier applicant and co-applicant |
| 13 Synthetic identity | enabled | needs a format problem plus a second signal |
| 14 Device fraud | not implementable | no device data |
| 15 Address reuse | enabled (Low) | another customer's address with no shared surname (own / father / spouse / mother) |
| 16 Relationship fraud | enabled | applicant and co-applicant at the same address; `config_json`: `address_match_threshold`, `ignore_family_relation` |

## Layout

```
api.py                 HTTP routes (router), the composition root get_service()
service.py             use cases: evaluate, latest result, list / update rules
rules/engine.py        the rule engine (pure)
rules/identity.py      PAN / Aadhaar / Verhoeff, names, DOB / age (standard library), identity indexes, addresses
rules/aml.py, pep.py   AML / PEP request bodies and reply matching (pure)
rules/policy.py        the thresholds / lists from conf/ as one immutable value
repository.py          FraudRepository Protocol + PostgreSQL (shared.db.sqla, agent "fraud_screening")
application_source.py  ApplicationSource Protocol + PostgreSQL reader of the LOS loan application tables
watchlist.py           WatchlistSource Protocol + vendor-or-sample implementation (the HTTP call)
config.py              settings: conf/fraud_screening.yaml + FRAUD_SCREENING_* environment
conf/                  fraud_screening.yaml, AML.json / PEP.json (sample vendor replies)
db/schema.py           MIGRATIONS
frontend/              fraud_result_viewer.html
tests/                 rules, matchers, service (fakes), API smoke test
```

## Tables (schema `fraud_screening`, `db/schema.py`)

| Migration | Creates |
|---|---|
| 0001 | `rule_config` (18 seeded rules, `ON CONFLICT DO NOTHING`), `fraud_results` (+ indexes on application_number, application_id, created_at) |
| 0002 | `agent_logs` (shared) |
| 0003 | `api_responses` (shared) |
| 0004 | no new table: rule descriptions of rules 2/4/5/9/12/15/16, their new `config_json` keys (added, set values kept), rule 15 Medium -> Low |

The LOS loan application tables are **read** (never written) from the schema `FRAUD_SCREENING_LOAN_SCHEMA` (default
`public`) over the same connection: `loan_applications`, `customers`, `application_participants`,
`individual_applicant_details`, `non_individual_applicant_details`, `primary_applicant_kyc`, `applicant_addresses`,
`non_individual_addresses`, `applicant_bank_accounts`, `application_sourcing_details`, `collateral_properties`.

## Configuration

The database comes from `shared/db` (agent key `fraud_screening`): `LOS_AGENTIC_DSN` (schema `fraud_screening`) or the
agent's own `FRAUD_SCREENING_DSN`. Thresholds and reference lists are in `conf/fraud_screening.yaml`.

| Variable | Default | Meaning |
|---|---|---|
| `FRAUD_SCREENING_AML_API_URL` | empty | AML vendor (Karza-style). Empty -> `conf/AML.json` sample, results marked `source: "mock"` |
| `FRAUD_SCREENING_AML_API_KEY` | empty | sent as `x-karza-key` |
| `FRAUD_SCREENING_PEP_API_URL` | empty | PEP vendor. Empty -> `conf/PEP.json` sample (`source: "mock"`) |
| `FRAUD_SCREENING_PEP_API_KEY` | AML key | |
| `FRAUD_SCREENING_AML_MATCH_THRESHOLD_PERCENT` / `_PEP_` | 70 (conf) | strong-match threshold |
| `FRAUD_SCREENING_AML_API_TIMEOUT_SECONDS` / `_PEP_` | 15 (conf) | vendor timeout |
| `FRAUD_SCREENING_LOAN_SCHEMA` | `public` (conf) | schema of the LOS loan application tables |
| `FRAUD_SCREENING_CONFIG_PATH` | `conf/fraud_screening.yaml` | another policy file |

## Tests

```
python -m pytest agents/fraud_screening/tests -q -p no:cacheprovider
```

No database and no network: the service runs on in-memory fakes; the API test mounts `router` in a bare FastAPI app.
