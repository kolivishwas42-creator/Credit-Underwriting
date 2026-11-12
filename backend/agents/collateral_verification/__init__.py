"""
Collateral verification: a vendor title-search / CERSAI report against the LOS collateral record (owner, ownership,
applicant, PAN, location, unit, construction), with the rule configuration and every run kept in PostgreSQL.

The router is in `agents.collateral_verification.api` (imported by main.py through agents/registry.py); the use cases
in `service`.
"""

from agents.collateral_verification.service import CollateralVerificationService, InvalidRequest, NotFound

__all__ = ["CollateralVerificationService", "InvalidRequest", "NotFound"]
