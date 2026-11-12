"""The rule engine and address utilities (pure, no I/O)."""

from agents.residence_office_verification.rules.address import addresses_match, clean_text, normalize_address
from agents.residence_office_verification.rules.engine import evaluate_rules

__all__ = ["addresses_match", "clean_text", "evaluate_rules", "normalize_address"]
