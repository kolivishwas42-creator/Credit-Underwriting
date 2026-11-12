# Residence / office verification agent

Rule-based checks of a field-verification vendor's response (residence or office visit) against the address the
applicant declared in the LOS. The vendor response is entered manually (no vendor API integration). Every run is
stored; the rule settings are editable from the UI.

## Endpoints

Mounted by `main.py` under `/api/v1` with the LOS token (like every agent):
`/api/v1/credit/residence-office-verification`

| Method | Path | What |
|---|---|---|
| POST | `/residence-verification` | Evaluate the vendor response; stores the run, returns `result_id` |
| GET | `/rule-configs?verification_type=RESIDENCE\|OFFICE` | The rule settings (case-insensitive type) |
| PUT | `/rule-configs` | Bulk update of `enabled`, `criticality`, `weight`, `name`, `rule_id` by `rule_key` (one transaction) |

Errors: 404 application / participant not found (or no matching `rule_key` on PUT); 422 no address of an accepted
type; 409 more than one; 503 database not configured or not reachable (never the DSN).

### Request (POST /residence-verification)

```json
{
  "application_id": 1001,
  "participant_id": 2001,
  "verification_type": "RESIDENCE",
  "vendor_name": "Manual Vendor Entry",
  "vendor_response": {
    "status": "Positive", "final_status": "Approved", "neighbour_check": "Yes", "address_confirmed": "Yes",
    "corrected_address": null, "negative_area": "No", "political_link": "No", "name_plate_visible": "Yes",
    "community_dominated": "No"
  }
}
```

The response carries `application`, `participant`, `declared_address`, `vendor`, and the evaluation:
`verification_type`, `overall_recommendation` (PASS / PENDING / REVIEW / REFER), `overall_criticality`, `risk_score`,
`summary`, `rules_evaluated`, `rules_triggered`, `insights` (the ISSUE / PENDING rules) and `rules` (every enabled
rule, most critical first).

It also carries `ai_summary` (short markdown bullet points from the local model, Ollama, explaining the triggered rules;
the all-clear text when none triggered), `ai_summary_source` (`ai` / `rules` / `unavailable` / `off`) and
`ai_summary_model`. The summary is not stored and never fails the run (model down -> a notice).

### Vendor response fields

| Field | Expected values | Notes |
|---|---|---|
| `status` | Positive / Negative (also pass, verified, fail, unverified, ...) | Separate from `final_status` |
| `final_status` | Approved / Rejected / Waived / Pending | Waived is NOT treated as a successful verification |
| `neighbour_check` | Yes / No / Positive / Negative / true / false | |
| `address_confirmed` | Yes / No / true / false | |
| `corrected_address` | string or null | Compared with the declared address after normalisation |
| `negative_area` | Yes / No / true / false | |
| `political_link` | Yes / No / true / false | Vendor-reported flag only; never inferred |
| `name_plate_visible` | Yes / No / true / false | |
| `community_dominated` | Yes / No / true / false | Context only: never raises risk or the recommendation by itself |

Keys are matched case-insensitively; missing or unrecognised values are PENDING, never assumed false. Extra fields
are ignored.

## How the decision is made

* A participant must have exactly ONE address in `applicant_addresses` whose `address_type` is in
  `conf/settings.yaml: residence_address_types` (case-insensitive). The declared address is `full_address`, else the
  address parts joined.
* Ten rules (`rules/engine.py`); disabled rules are dropped. Any risk-contributing ISSUE of HIGH / CRITICAL ->
  REFER; any other ISSUE -> REVIEW; else any PENDING -> PENDING; else PASS.
* Optional risk score (`conf/rules.yaml: risk_score`, off by default): sum of the weights of the risk-contributing
  issues, capped at `max`.
* Address matching (`rules/address.py`) is a normalised text comparison (NFKC, case, punctuation, whitespace) -- not
  geocoding or fuzzy matching.

## Tables

Schema `residence_office_verification` in `los_agentic` (migrations in `db/schema.py`):

| Table | Purpose |
|---|---|
| `residence_rule_configs`, `office_rule_configs` | Editable rule settings (seeded with the defaults by `rov-0002`) |
| `residence_rule_results`, `office_rule_results` | Every evaluation run (snapshots of application, participant, address) |
| `agent_logs`, `api_responses` | Shared tables (WARNING+ logs, stored API responses) |

The LOS tables it only READS (schema `conf/settings.yaml: los_source_schema`): `loan_applications`,
`application_participants`, `customers`, `individual_applicant_details`, `applicant_addresses`.

Migrations are applied by the setup script (`repository.migrate()`), never at request time. When a config table is
empty the defaults in `conf/rules.yaml` are used.

## Configuration

| Variable | Meaning |
|---|---|
| `LOS_AGENTIC_DSN` | The shared database (the agent's schema is set as `search_path` by `shared/db`) |
| `RESIDENCE_OFFICE_VERIFICATION_DSN` | Optional: a database of the agent's own (overrides the shared one) |
| `RESIDENCE_OFFICE_VERIFICATION_LOS_SCHEMA` | Optional: the schema of the LOS tables read (default `public`) |
| `RESIDENCE_OFFICE_VERIFICATION_CONF_DIR` | Optional: another folder with `rules.yaml` / `settings.yaml` |
| `RESIDENCE_OFFICE_VERIFICATION_AI_SUMMARY` | Optional: `on` / `off` overrides `settings.yaml: ai_summary.enabled` |
| `OLLAMA_HOST`, `OLLAMA_MODEL` | The local model of the AI summary (`ai_summary.model: null` = `OLLAMA_MODEL`) |

`conf/rules.yaml` -- default rules per mode, criticality order, risk score; `conf/settings.yaml` -- LOS schema,
accepted address types and the AI summary (model, timeout, prompt, texts).

## Layout

`api.py` (HTTP) -> `service.py` (use cases, repository injected) -> `rules/` (pure) and `repository.py` (Protocol +
PostgreSQL via `shared.db.pg`). `schemas.py` Pydantic models, `config.py` settings,
`summary.py` the AI risk summary (the model call injected into the service).

## Frontend

`frontend/` (Vite + React): verification form, result view and the **Rule Config** tab. It calls
`/api/v1/credit/residence-office-verification` on the same origin; in development the Vite server proxies `/api` to
`ROV_API` (default the local LOS server).

```bash
cd frontend && npm install && npm run dev
```

## Tests

```bash
python -m pytest agents/residence_office_verification/tests -q -p no:cacheprovider
```

Rule engine, address utilities, the service on a fake repository and an API smoke test -- synthetic data, no
database, no network.
