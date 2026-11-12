# Property valuation agent

Checks a vendor's property inspection / valuation report against the LOS property record with 22 configurable rules
(original ids PROP-012 .. PROP-046) and stores every vendor visit and the agent's summary.

- Looks up a loan application by `application_number` and reads the applicant and every linked collateral property
  from the LOS tables (read only).
- Prefills what is sent to the vendor; the vendor response is entered manually today (the same body can later be
  filled by a vendor API integration).
- Stores every initial visit and revisit separately, runs the enabled rules, stores a compact agent result: status,
  rule counts, severity counts, key insights, risk factors, recommended actions.
- Rule configuration (enabled, sequence, severity, field mapping, settings / thresholds) lives in PostgreSQL and is
  edited from the Rule configuration screen; later runs use it, past results stay unchanged.

The agent status `HIGH_RISK` (any CRITICAL issue), `REVIEW` (any rule triggered) or `CLEAR` is a summary of the
configured rule severities, not a credit decision.

## Layout

```
agents/property_valuation/
├── api.py            the router (/api/v1/credit/property-valuation), HTTP only
├── service.py        the use cases; receives its repository
├── rules/            engine.py (the 22 rules), inputs.py (LOS / vendor fields -> rule labels), summary.py
├── repository.py     Protocol + PostgreSQL (shared.db.sqla, agent key property_valuation)
├── db/models.py      ORM models        db/schema.py   MIGRATIONS
├── schemas.py        request bodies    config.py      settings from conf/ and the environment
├── conf/             rules.yaml (the rule catalogue), settings.yaml (engine, agent version, LOS schema)
├── frontend/static/index.html          the screen (valuation, history, rule configuration)
└── tests/
```

## Endpoints

All under `/api/v1/credit/property-valuation`, behind the LOS JWT (main.py mounts the router from agents/registry.py).

| Method | Path | Purpose |
|---|---|---|
| GET | `/applications/{application_number}` | Applicant and properties, each with `vendor_request_prefill` |
| POST | `/applications/{application_number}/properties/{property_id}/valuation` | Save a vendor visit, run the rules, save the agent result |
| GET | `/applications/{application_number}/history?collateral_property_id=` | Vendor visits and agent-result history |
| GET | `/rules` | The live rule configuration |
| PUT | `/rules/{rule_key}` | Change enabled, sequence, severity, settings, fields, description |
| GET | `/results/{application_number}` | Saved agent summaries |

Errors: 400 when the body's `collateral_property_id` differs from the URL; 404 for an unknown application, a property
of another application or an unknown rule; 500 with a fixed message when the database or the rules fail.

Example submission body (synthetic):

```json
{
  "collateral_property_id": 10,
  "vendor_name": "Manual Vendor Entry",
  "verification_type": "INITIAL_VISIT",
  "submitted_data": {"Applicant Name": "TEST APPLICANT", "Property Documents Provided": "Yes",
                     "Copy Of Latest Deed provided": true, "Approved Map": true},
  "vendor_response": {"Current Property Owner": "TEST APPLICANT", "Property Usage": "Residential",
                      "Property Nature As Per Documents": "Residential", "Property Occupancy": "Self Occupied",
                      "Condition Of Property": "Average", "Current Market Value": 2500000,
                      "Value to be Considered": 2500000, "Valuation Date": "22/10/2026", "Final Status": "Positive"}
}
```

The response carries `verification_id`, `result_id`, `vendor_status`, `summary` (the stored agent result) and
`evaluation` (every rule's result with its discrepancies).

## Tables (schema `property_valuation`, migrations in db/schema.py)

| Table | One row per | Content |
|---|---|---|
| `property_valuation_verifications` | vendor visit / revisit | `submitted_data` and full `vendor_response` (JSONB), vendor status, visit type; never overwritten |
| `property_valuation_agent_results` | agent run | vendor status, agent status, rules checked / passed / triggered, severity counts, insights, risk factors, actions; links to its verification |
| `property_valuation_rule_configs` | rule | enabled, sequence, severity, field metadata and settings (JSONB) |
| `agent_logs`, `api_responses` | | the shared log and API-response tables (shared/db) |

Migrations: `0001` the three agent tables, `0002` agent_logs, `0003` api_responses. They are applied by the shared
database setup (scripts/setup_agent_databases.py) with `agents.property_valuation.db.schema.MIGRATIONS`.

Rule rows: every rule of `conf/rules.yaml` that has no row yet is inserted on first use (rules list, rule update or a
valuation run); existing rows are never overwritten, so after that the table is the live configuration.

LOS tables read (schema `los.schema` in conf/settings.yaml, default `public`): `loan_applications`, `customers`,
`application_participants`, `individual_applicant_details`, `non_individual_applicant_details`,
`primary_applicant_kyc`, `collateral_properties`, `collateral_property_documents`. The applicant name is the
individual's name, else the company name, else the customer's full name.

## Configuration

| Variable | Meaning |
|---|---|
| `LOS_AGENTIC_DSN` | The shared database (read by shared/db/core.py); the agent's tables are in schema `property_valuation` |
| `PROPERTY_VALUATION_DSN` | Optional: an own database for this agent instead (overrides `LOS_AGENTIC_DSN`) |
| `PROPERTY_VALUATION_CONF_DIR` | Optional: a folder with `rules.yaml` / `settings.yaml` replacing `conf/` |

No DSN, password or threshold is in the code. Rule thresholds (e.g. `tolerance_percent` of RULE_20 / RULE_21) are in
`conf/rules.yaml` as seed values and in the rule rows afterwards.

## Rules

| Rule | Id | Name | Seed severity | Seed state |
|---|---|---|---|---|
| RULE_1 | PROP-012 | Registration Completeness | MINOR | disabled |
| RULE_2 | PROP-013 | Owner Name Consistency | CRITICAL | enabled |
| RULE_3 | PROP-014 | Applicant Versus Owner Comparison | MAJOR | enabled |
| RULE_4 | PROP-015 | Deed And Registration Consistency | MAJOR | enabled |
| RULE_5 | PROP-016 | Sanctioned Plan Evidence | MAJOR | enabled |
| RULE_6 | PROP-020 | Address Consistency | MAJOR | enabled |
| RULE_7 | PROP-021 | Postal-Location Consistency | MAJOR | disabled |
| RULE_8 | PROP-022 | Unit Identification | MAJOR | enabled |
| RULE_9 | PROP-023 | Owner/Property Record Linkage | MINOR | disabled |
| RULE_10 | PROP-024 | Project/Building Consistency | MINOR | enabled |
| RULE_11 | PROP-030 | Property Type And Usage Consistency | MAJOR | enabled |
| RULE_12 | PROP-031 | Property Nature Consistency | MAJOR | enabled |
| RULE_13 | PROP-032 | Occupancy Consistency | MAJOR | enabled |
| RULE_14 | PROP-036 | Sanctioned-Plan Consistency | MAJOR | enabled |
| RULE_15 | PROP-037 | Property Age Validation | MINOR | enabled |
| RULE_16 | PROP-040 | Area Input Validation | MAJOR | enabled |
| RULE_17 | PROP-041 | Carpet-Area Consistency | MAJOR | disabled |
| RULE_18 | PROP-042 | Adopted-Area Validation | MAJOR | enabled |
| RULE_19 | PROP-043 | Rate Validation | MAJOR | enabled |
| RULE_20 | PROP-044 | Market-Value Reconciliation | CRITICAL | enabled |
| RULE_21 | PROP-045 | Value-to-be-Considered Review | CRITICAL | enabled |
| RULE_22 | PROP-046 | Valuation Date and Remarks | MINOR | enabled |

Why four rules start disabled (the data they compare is not available yet; enable them from the Rule configuration
screen once it is):

- RULE_1: registration number / date / registered-at / transaction type are not in the LOS property table or the
  vendor response.
- RULE_7: the vendor response has no separate pincode, city, state and landmark for a two-source comparison.
- RULE_9: the registration Reference ID and Asset Id are not in the LOS schema.
- RULE_17: the vendor returns one carpet-area value and a unit, not two values to compare.

RULE_3 compares applicant and owner names; PAN only when both PANs exist (the LOS has no property-owner PAN).
RULE_5 and RULE_14 overlap (sanctioned plan); either can be disabled.

## Field mapping

`collateral_properties` is the baseline property record; the vendor report is the inspection / valuation source.

| Vendor request field | LOS source |
|---|---|
| Applicant Name | Primary `application_participants` -> `individual_applicant_details` / `non_individual_applicant_details`, fallback `customers.full_name` |
| Property Owner first / middle / last name | `collateral_properties.owner_first_name`, `owner_middle_name`, `owner_last_name` |
| Property Type | `property_type`, fallback `collateral_type` |
| Flat No./House No. | `house_flat_number` |
| Address Line 1 / 2 | `address_line_1`, `address_line_2` |
| Landmark / Pincode / City / State | `landmark`, `pincode`, `city`, `state` |
| Complete Property Address | unit, address lines, landmark, city, state and pincode joined |
| Property Documents Provided | one or more `collateral_property_documents` rows |
| Copy Of Latest Deed provided | a document name containing `deed` or `sale` (default only; editable on the screen) |
| Approved Map | a document name containing `map`, `sanction` or `plan` (default only; editable) |

LOS and vendor labels are mapped to the rule labels in `rules/inputs.py`. Missing LOS fields stay blank and are not
invented: registration number / date / registered-at, transaction type, owner PAN, Reference ID and Asset Id are not
in the LOS schema. `Property Usage` and `Property Nature As Per Documents` are separate vendor fields (both may be
`Residential`). The document checkboxes are inferred from document names only, not from document content.

Vendor response dropdowns on the screen: Property Usage (Rented, Vacant, Under Construction, Residential), Property
Nature (Residential, Commercial, Mixed Use, Industrial), Occupancy (Rented, Self Occupied), Condition (Poor, Average,
Good), Investment / Self used (Self used and tenants, Self used and rented), Final Status (Positive, Negative, Refer).

## Frontend

`frontend/static/index.html` is a single page (valuation, history, rule configuration). It calls
`/api/v1/credit/property-valuation/...` on the same origin and sends the LOS token from `sessionStorage`
(`pv_token`); on a 401 / 403 it asks for the token once.

## Tests

```
python -m pytest agents/property_valuation/tests -q -p no:cacheprovider
```

Rule engine, service (fake repository) and an API smoke test (the router in its own FastAPI app, dependencies
overridden). No database, no network, synthetic data only.
