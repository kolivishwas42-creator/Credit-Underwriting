"""Lightweight person-name comparison (token overlap, no external NLP)."""

from __future__ import annotations

import re

#: honorifics and filler tokens ignored when comparing names
STOP_TOKENS = frozenset({"mr", "mrs", "ms", "shri", "smt", "bhai", "kumar", "the", "and"})


def normalize_name(value: str | None) -> str:
    if not value:
        return ""
    text = value.lower()
    text = re.sub(r"[^a-z\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def tokens(value: str | None) -> set[str]:
    return {t for t in normalize_name(value).split() if t not in STOP_TOKENS and len(t) > 1}


def name_score(a: str | None, b: str | None) -> float:
    ta, tb = tokens(a), tokens(b)
    if not ta or not tb:
        return 0.0
    # coverage of the shorter name, so "Asha Rao" hits "Rao Asha Devi"
    return len(ta & tb) / min(len(ta), len(tb))


def names_match(a: str | None, b: str | None, threshold: float) -> bool:
    return name_score(a, b) >= threshold


def any_match(left: list[str], right: list[str], threshold: float) -> tuple[bool, str | None, str | None]:
    """(matched, best left name, best right name) over every pair."""
    best: tuple[float, str | None, str | None] = (0.0, None, None)
    for a in left:
        for b in right:
            score = name_score(a, b)
            if score > best[0]:
                best = (score, a, b)
    return best[0] >= threshold, best[1], best[2]


def join_owner(prop: dict) -> str:
    parts = [prop.get("owner_first_name") or "", prop.get("owner_middle_name") or "",
             prop.get("owner_last_name") or ""]
    joined = " ".join(p for p in parts if str(p).strip())
    return joined or (prop.get("property_owner") or "")
