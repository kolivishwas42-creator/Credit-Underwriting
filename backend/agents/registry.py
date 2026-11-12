"""
EVERY AGENT THE SERVICE SERVES -- main.py mounts exactly this list (open for a new agent, closed for main.py: adding an
agent is one entry here, never an edit of the app).

    module      the package's router module (it exposes `router`, an APIRouter)
    attribute   the router's name in that module
    prefix      what main.py puts in front of the router's own paths
    title       the human name (docs, /ready)

Every router is mounted behind the LOS JWT (shared/security/auth.py require_jwt).
"""

from __future__ import annotations

import importlib
from dataclasses import dataclass

from fastapi import APIRouter


@dataclass(frozen=True)
class AgentRoute:
    key: str
    module: str
    title: str
    attribute: str = "router"
    prefix: str = ""

    def router(self) -> APIRouter:
        found = getattr(importlib.import_module(self.module), self.attribute, None)
        if not isinstance(found, APIRouter):
            raise RuntimeError(f"agent '{self.key}': {self.module}.{self.attribute} is not an APIRouter")
        return found

    def mount_prefix(self) -> str:
        """What main.py puts in front: the entry's own prefix, else /api/v1 unless the router already starts /api/."""
        if self.prefix:
            return self.prefix
        return "" if str(self.router().prefix or "").startswith("/api/") else "/api/v1"


AGENTS: tuple[AgentRoute, ...] = (
    # the six original agents: their routers carry their own paths under /api/v1
    AgentRoute("eligibility", "agents.eligibility.api", "Eligibility", prefix="/api/v1"),
    AgentRoute("dedupe", "agents.dedupe.api", "Dedupe and customer history", prefix="/api/v1"),
    AgentRoute("docs_policy", "agents.docs_policy.api.routes", "Credit document policy", prefix="/api/v1"),
    AgentRoute("bank_verification", "agents.bank_verification.api", "Bank verification", prefix="/api/v1"),
    AgentRoute("crime_verification", "agents.crime_verification.api", "Crime record verification", prefix="/api/v1"),
    AgentRoute("legal_verification", "agents.legal_verification.api", "Legal verification", prefix="/api/v1"),
    # the five added 2026-11-02 (all under /api/v1/credit/<agent>; mount_prefix() adds /api/v1 when needed)
    AgentRoute("itr_verification", "agents.itr_verification.api", "ITR verification"),
    AgentRoute("fraud_screening", "agents.fraud_screening.api", "Fraud screening (AML / PEP / rules)"),
    AgentRoute("residence_office_verification", "agents.residence_office_verification.api",
               "Residence / office verification"),
    AgentRoute("property_valuation", "agents.property_valuation.api", "Property valuation"),
    AgentRoute("collateral_verification", "agents.collateral_verification.api", "Collateral verification"),
)

__all__ = ["AGENTS", "AgentRoute"]
