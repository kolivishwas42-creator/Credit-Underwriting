# Credit underwriting (the parent agent)

Reads what the agents before it recorded (eligibility, documents, bank, dedupe, risk ...) and a bureau report, interprets them under the underwriting policy and writes an evidence-linked UNDERWRITING ASSESSMENT for the decision maker. It never approves or rejects, and never recomputes what another agent owns. Runs on the agent runtime (shared/runtime): planner, tools, limits, trajectory.

## Rules

In the database: the underwriting policy (shared/config/credit_underwriting/policy.yaml). See `python scripts/rules.py list`.

## Tables (its schema)

the LOS case store (findings)

## Endpoints

- `served by the LOS server (8010): POST /api/v1/credit/underwriting/run, GET /api/v1/credit/{case_id}`: its tools read KYC, income and financial results that live in the full LOS, so it is not served on its own here

## Layout

- code: this folder; `api.py` / `api/` is its API
- `conf/`: its rules seed and deployment settings
- `tests/`: its tests (`python -m pytest underwriting/tests`)
