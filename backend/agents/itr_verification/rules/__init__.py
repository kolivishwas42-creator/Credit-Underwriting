"""The ITR rule engine: pure functions over plain data (no I/O)."""

from .engine import ComparisonReport, FieldResult, compare_documents, normalise_assessment_year
from .policy import Policy

__all__ = ["ComparisonReport", "FieldResult", "Policy", "compare_documents", "normalise_assessment_year"]
