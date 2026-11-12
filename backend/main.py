"""
THE CREDIT AGENTS AS ONE SERVICE -- the handover project's main.py (scripts/build_los_agentic.py writes this file as
the project's main.py; in this repository the full LOS server, main.py at the root, mounts the same routers).

    eligibility            /api/v1/eligibility/...
    dedupe                 /api/v1/credit/dedupe, /api/v1/credit/dedupe/all
    docs policy            /api/v1/credit/document-readiness/{case_id}
    bank verification      /api/v1/bank-verification/...
    crime verification     /api/v1/credit/crime-verification/...
    legal verification     /api/v1/credit/legal-verification/...
    ITR verification       /api/v1/credit/itr-verification/...
    fraud screening        /api/v1/credit/fraud-screening/...
    residence / office     /api/v1/credit/residence-office-verification/...
    property valuation     /api/v1/credit/property-valuation/...
    collateral             /api/v1/credit/collateral-verification/...
    (the list: agents/registry.py; the layout every agent follows: STRUCTURE.md)
    /health                the process answers
    /ready                 every agent's rules are readable (from the database in production)

    uvicorn main:app --host 0.0.0.0 --port 8010

START-UP FAILS CLOSED: rules that cannot be read, an incomplete or (in production) unconfirmed eligibility policy, a
broken or unsigned dedupe policy, or a production start without the identity key stops the service by name -- never a
first request that fails. Every request needs the LOS JWT (shared/security/auth.py).
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

# THE SETTINGS FILE (.env next to this file) BEFORE ANY AGENT IS IMPORTED: agents read their settings (and the rules
# database) at import. A variable already set in the environment wins -- a deployment's own settings are never
# overridden by a file.
load_dotenv(Path(__file__).resolve().parent / ".env", override=False)

from fastapi import Depends, FastAPI  # noqa: E402

from shared.db import responses  # noqa: E402
from shared.api import errors  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware
from shared.security.auth import require_jwt  # noqa: E402

logger = logging.getLogger("los_agentic")


def _startup_checks() -> list[str]:
    """Every check that must pass before the service answers; the lines it prints."""
    from agents.dedupe import config as dedupe_config
    from agents.dedupe import identity as dedupe_identity
    from agents.eligibility import config as eligibility_config

    lines = [f"eligibility rules : {eligibility_config.validate_for_startup()}"]
    dedupe_identity.require_in_production()
    policy = dedupe_config.get_policy()
    lines.append(f"dedupe policy     : {policy['policy_version']} (signed off: {bool(policy.get('signed_off'))})")
    return lines


@asynccontextmanager
async def lifespan(_app: FastAPI):
    for line in _startup_checks():
        print(line)
    yield
    from shared.db import writer

    writer.close_all()                                # the background audit / log rows written before the exit


app = FastAPI(title="LOS Agentic -- credit agents", version="1.0", lifespan=lifespan,
              description="Eligibility, credit document policy, dedupe, bank, crime and legal verification. Rules "
                          "and every decision are kept in PostgreSQL (los_agentic, one schema per agent).")
errors.install(app)
responses.install(app)       

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)              # every API response in its agent's schema (api_responses)


@app.get("/health", tags=["ops"])
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/ready", tags=["ops"])
def ready() -> dict[str, object]:
    """Every rule set readable where it lives (its version's hash) -- never the rules themselves."""
    from shared.db import rule_store

    sets: dict[str, str] = {}
    ok = True
    for name in rule_store.names():
        try:
            if rule_store.spec(name).get("folder"):
                sets[name] = f"{len(rule_store.load_family(name))} file(s) in force"
            else:
                sets[name] = rule_store.load_with_hash(name)[0][:12]
        except Exception as exc:  # noqa: BLE001 - its reason, plainly
            ok, sets[name] = False, f"UNAVAILABLE ({type(exc).__name__})"
    if not ok:
        from fastapi.responses import JSONResponse

        return JSONResponse({"status": "not ready", "rules": sets}, status_code=503)
    return {"status": "ready", "rules": sets}


from agents.registry import AGENTS  # noqa: E402

# EVERY AGENT FROM ONE LIST (agents/registry.py): a new agent is an entry there, never an edit here
for _agent in AGENTS:
    app.include_router(_agent.router(), prefix=_agent.mount_prefix(), dependencies=[Depends(require_jwt)])

# RULE SETTINGS (owner 2026-11-12): rule on / off, numbers and new rules for the agents whose rules live in the
# versioned rule store -- shared/api/rule_settings.py, shared/config/rule_settings.yaml
from shared.api.rule_settings import router as _rule_settings_router  # noqa: E402

app.include_router(_rule_settings_router)
