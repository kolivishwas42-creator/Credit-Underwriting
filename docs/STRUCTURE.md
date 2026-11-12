# credit_underwriting — project structure (the contract every agent follows)

One FastAPI service (`main.py`) mounts every agent's router. One PostgreSQL database (`los_agentic`), one schema per
agent. Common infrastructure lives in `shared/`; an agent never re-implements it.

```
credit_underwriting/
├── backend/
│   ├── main.py                the service: mounts every agent from agents/registry.py, /health, /ready
│   ├── requirements.txt       ONE dependency list for the whole service
│   ├── .env.example           every variable the service reads (no values that are secrets)
│   ├── agents/
│   │   ├── registry.py        the list of agents: package, router, title (main.py reads it)
│   │   ├── eligibility/ docs_policy/ dedupe/ bank_verification/ crime_verification/ legal_verification/
│   │   ├── itr_verification/ fraud_screening/ residence_office_verification/ property_valuation/
│   │   │   collateral_verification/
│   │   └── underwriting/      the parent credit-underwriting agent's code (served by the full LOS)
│   ├── shared/                infrastructure used by more than one agent
│   │   ├── db/                core.py (DSN + schema per agent), sqla.py, pg.py, migrations, rule_store, responses, audit
│   │   ├── api/               errors (one error envelope), dependencies
│   │   ├── security/          JWT (every route needs the LOS token)
│   │   └── config/            agent_databases.yaml and the other shared YAML
│   └── scripts/               setup_agent_databases.py, rules.py, e2e_live_check.py, baseline_existing_tables.py, …
├── frontend/                  ONE Vite + React console (no static HTML pages): tabs across the top, one per agent;
│                              src/shared (shell, Pagination, tokens) + src/agents/<agent> (screens) -- frontend/DESIGN.md
└── docs/                      this file; DESIGN.md (the Ink & Ember UI design system the frontends follow)
```

## One agent's folder (the layered layout)

```
agents/<agent>/
├── __init__.py        what the package exports (router, service entry points)
├── api.py             HTTP only: an APIRouter, request/response models, status codes. No SQL, no rules.
├── service.py         the use cases: orchestrates repository + rules + extractors. No FastAPI, no SQL text.
├── rules/             the rule engine: pure functions over plain data (no I/O) -> easy to test
├── repository.py      the database: a Protocol (what the service needs) + the PostgreSQL implementation
├── schemas.py         Pydantic models shared by api and service
├── config.py          the agent's settings: env names prefixed by the agent, rule files from conf/
├── conf/              rule / reference files (YAML / JSON) — data, never code
├── db/schema.py       MIGRATIONS = [(version, description, sql), …] — unqualified SQL (search_path = the schema)
├── DESIGN.md          (where written) the agent's design: flow, rules, tables, API -- e.g. legal_verification
├── tests/             unit tests (rules, service with a fake repository) + an API smoke test
└── README.md          endpoints, tables, configuration
```

## Rules (SOLID, applied)

* **S** — a module has one reason to change: routes, use cases, rules and SQL are separate files.
* **O** — a new rule / check is a new entry in `conf/` or a new rule function, not an edit of the engine loop.
* **L / I** — the service depends on a small repository Protocol; a fake implements it in tests.
* **D** — the service receives its repository (and storage / clients) — it never constructs a database connection.
* Configuration from the environment and `conf/` only: no DSN, password, URL or threshold hard-coded.
* No secrets, real customer documents or personal data in the repository (samples are synthetic).
* An agent reaches its database ONLY through `shared.db.sqla` / `shared.db.pg` with its own agent key.
