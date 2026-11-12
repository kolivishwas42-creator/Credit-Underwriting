# Credit Underwriting — agents

The credit underwriting agents of the LOS as **one backend service** and **one React app per agent**.

```
credit_underwriting/
├── backend/                     Python (FastAPI) — one service, every agent mounted by main.py
│   ├── main.py                  the app: agents from agents/registry.py, /health, /ready, start-up checks
│   ├── requirements.txt         one dependency list
│   ├── .env.example             every setting the service reads (copy to .env; never commit .env)
│   ├── conftest.py pytest.ini   tests (each agent keeps its own in agents/<agent>/tests)
│   ├── agents/
│   │   ├── registry.py          the list of agents served
│   │   ├── eligibility/ docs_policy/ dedupe/ bank_verification/ crime_verification/ legal_verification/
│   │   ├── itr_verification/ fraud_screening/ residence_office_verification/ property_valuation/
│   │   ├── collateral_verification/
│   │   └── underwriting/        the parent agent's code (assessment, bureau, policy) used by the others
│   ├── shared/                  database (one schema per agent), rules store, auth (JWT), errors, LLM, audit
│   └── scripts/                 setup_agent_databases.py, rules.py (rule versions), preflight, e2e_live_check.py
├── frontend/                    ONE Vite + React console: tabs across the top, one per agent, src/shared + src/agents/<agent>
│   └── bank_verification/ collateral_verification/ crime_verification/ dedupe/ docs_policy/ eligibility/
│       fraud_screening/ itr_verification/ legal_verification/ property_valuation/ residence_office_verification/
└── docs/                        STRUCTURE.md (the layout every agent follows), DESIGN.md
```

Each agent's own `README.md` lists its endpoints and tables; `backend/agents/legal_verification/DESIGN.md` is the
legal verification design.

## Run

**Everything at once** (Windows, local development) — backend and console each in their own window, then the browser:

```powershell
.\start.ps1                                   # backend :8010 + console http://localhost:5190
.\start.ps1 -FosApi http://127.0.0.1:8011     # dedupe "New application" served by the full LOS on another port
```

(Sets `AUTH_ENABLED=false` and the local scopes; honoured only with `ENVIRONMENT=development` in `backend/.env`. If
PowerShell blocks scripts: `powershell -ExecutionPolicy Bypass -File .\start.ps1`.)

**Database**: PostgreSQL with the `agentic_LOS` database; each agent has its own schema
(`backend/shared/config/agent_databases.yaml`). Rules live in the database (`python scripts/rules.py list`).

**Backend**

```bash
cd backend
python -m venv .venv && .venv\Scripts\activate          # Linux: source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env                                   # then set LOS_AGENTIC_DSN, JWT_*, ENVIRONMENT
python scripts/setup_agent_databases.py                  # schemas + migrations (first time / after an upgrade)
uvicorn main:app --host 0.0.0.0 --port 8010
```

`GET /health` answers when the process is up; `GET /ready` when every agent's rules are readable. API docs: `/docs`.
Every route needs the LOS JWT (`AUTH_ENABLED=false` is honoured only in a development environment).

**Frontend** (one console app for every agent — `frontend/DESIGN.md`)

```bash
cd frontend
npm install
npm run dev        # http://localhost:5190 — tabs across the top, one per agent; /api proxied to http://127.0.0.1:8010 (LOS_API)
npm run build      # production build in dist/ — serve it behind the same origin as the API
npm test           # every agent's screen tests + the shell
```

## Check

```bash
cd backend
python -m pytest -q                                              # unit + API tests (never touch a real database)
python scripts/e2e_live_check.py --base-url http://127.0.0.1:8010 # live end-to-end: every agent's flow, rules, DB rows
```
