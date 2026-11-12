"""Address utilities for the rule engine: conservative text normalisation and comparison (pure, no I/O)."""

import re
import unicodedata
from typing import Any


def clean_text(value: Any) -> str | None:
    """Return a trimmed string, or None for missing/blank values."""
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def normalize_address(value: Any) -> str | None:
    """
    Conservative normalization for address comparison.
    It removes case/punctuation differences but does not perform geocoding,
    translation, spelling correction, or fuzzy matching.
    """
    text = clean_text(value)
    if not text:
        return None
    text = unicodedata.normalize("NFKC", text).casefold()
    text = re.sub(r"[^\w\s]", " ", text, flags=re.UNICODE)
    text = re.sub(r"\s+", " ", text).strip()
    return text or None


def addresses_match(left: Any, right: Any) -> bool | None:
    """True/False when both addresses exist; None if either is missing."""
    a = normalize_address(left)
    b = normalize_address(right)
    if a is None or b is None:
        return None
    return a == b
