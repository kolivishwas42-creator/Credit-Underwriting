"""ITR verification agent: customer Input ITR vs vendor Output ITR (and the loan application's values)."""

from .api import router
from .service import ITRVerificationService, build_service

__all__ = ["ITRVerificationService", "build_service", "router"]
