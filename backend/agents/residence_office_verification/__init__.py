"""Residence / office verification agent: rule-based checks of a vendor's field-verification response.

Exports the HTTP router (mounted by main.py under /api/v1) and the service entry point."""

from agents.residence_office_verification.api import router
from agents.residence_office_verification.service import ResidenceVerificationService

__all__ = ["ResidenceVerificationService", "router"]
