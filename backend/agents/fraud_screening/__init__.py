"""Fraud screening agent (rules + AML / PEP) -- /api/v1/credit/fraud-screening. See README.md."""

from agents.fraud_screening.api import router
from agents.fraud_screening.service import FraudScreeningService

__all__ = ["FraudScreeningService", "router"]
