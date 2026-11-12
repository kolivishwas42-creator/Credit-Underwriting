"""Identity checks: PAN / Aadhaar format, name and address similarity, DOB / age, historical identity indexes.

Pure functions (standard library only; no I/O). Thresholds are passed in by the caller (rules/policy.py).
"""

from __future__ import annotations

import math
import re
from datetime import date, datetime
from typing import Any, Dict, List, Optional

_PAN_RE = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$", re.I)
_AADHAAR_RE = re.compile(r"^\d{12}$")


def _is_nan(value: Any) -> bool:
    return isinstance(value, float) and math.isnan(value)


# ---------------------------------------------------------------------------
# PAN / Aadhaar
# ---------------------------------------------------------------------------
def is_masked_id(value) -> bool:
    """True for values like XXXX1234, ****1234, Aadhaar last-4 only, etc."""
    if value is None:
        return False
    s = re.sub(r"\s+", "", str(value).strip())
    if not s:
        return False
    mask_chars = sum(1 for c in s if c in "X*x#")
    return mask_chars >= 4 or (len(s) < 12 and s.isdigit() and len(s) <= 4)


def pan_issue(pan) -> str:
    """Human reason if PAN is bad, else empty. Missing or masked => no issue."""
    if pan is None or _is_nan(pan):
        return ""
    s = str(pan).strip().upper().replace(" ", "")
    if not s or is_masked_id(s):
        return ""
    if not _PAN_RE.match(s):
        return f"PAN '{s}' does not match AAAAA9999A"
    return ""


def aadhaar_issue(aadhaar) -> str:
    """Human reason if Aadhaar is bad, else empty. Missing or masked => no issue."""
    if aadhaar is None or _is_nan(aadhaar):
        return ""
    s = re.sub(r"[\s-]", "", str(aadhaar).strip())
    if not s or is_masked_id(s):
        return ""
    if not _AADHAAR_RE.match(s):
        return f"Aadhaar '{s}' is not 12 digits"
    if not verhoeff_validate(s):
        return f"Aadhaar '{s}' fails Verhoeff checksum"
    return ""


# Verhoeff checksum for Aadhaar
_D = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]
_P = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
]


def verhoeff_validate(number: str) -> bool:
    try:
        c = 0
        for i, ch in enumerate(reversed(number)):
            c = _D[c][_P[i % 8][int(ch)]]
        return c == 0
    except (ValueError, IndexError):
        return False


def norm_id(x) -> str:
    """Upper-case identifier without whitespace ('' for missing)."""
    if x is None or _is_nan(x):
        return ""
    return re.sub(r"\s+", "", str(x).strip().upper())


def norm_mobile(x, digits: int) -> str:
    """The last `digits` digits of a phone number ('' when it has fewer): +91 98765-43210 -> 9876543210."""
    if x is None or _is_nan(x):
        return ""
    only = "".join(ch for ch in str(x) if ch.isdigit())
    return only[-digits:] if len(only) >= digits else ""


# ---------------------------------------------------------------------------
# Names
# ---------------------------------------------------------------------------
def normalize_name(name) -> str:
    if name is None or _is_nan(name):
        return ""
    s = re.sub(r"[^A-Za-z\s]", " ", str(name).upper())
    return " ".join(s.split())


def levenshtein_distance(s1: str, s2: str) -> int:
    if len(s1) < len(s2):
        return levenshtein_distance(s2, s1)
    if not s2:
        return len(s1)
    prev = list(range(len(s2) + 1))
    for i, c1 in enumerate(s1):
        curr = [i + 1]
        for j, c2 in enumerate(s2):
            curr.append(min(prev[j + 1] + 1, curr[j] + 1, prev[j] + (c1 != c2)))
        prev = curr
    return prev[-1]


def name_similarity(a, b) -> float:
    na, nb = normalize_name(a), normalize_name(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    # token-order independent: compare sorted tokens joined, and the full string
    ta = " ".join(sorted(na.split()))
    tb = " ".join(sorted(nb.split()))
    best = 1.0 - levenshtein_distance(ta, tb) / max(len(ta), len(tb))
    best = max(best, 1.0 - levenshtein_distance(na, nb) / max(len(na), len(nb)))
    return max(0.0, min(1.0, best))


def names_match(a, b, threshold: float) -> bool:
    return name_similarity(a, b) >= threshold


# ---------------------------------------------------------------------------
# DOB / age (standard library; replaces the former pandas.to_datetime)
# ---------------------------------------------------------------------------
# tried in order after ISO 8601; month-first before day-first, as pandas / dateutil read an ambiguous date
_DATE_FORMATS = (
    "%m-%d-%Y", "%d-%m-%Y", "%m/%d/%Y", "%d/%m/%Y", "%m.%d.%Y", "%d.%m.%Y",
    "%Y/%m/%d", "%Y.%m.%d", "%Y%m%d",
    "%d %b %Y", "%d %B %Y", "%d-%b-%Y", "%d-%B-%Y", "%b %d %Y", "%B %d %Y", "%b %d, %Y", "%B %d, %Y",
)


def parse_dob(dob) -> Optional[date]:
    """A date from a date / datetime / text value; None when missing or unreadable."""
    if dob is None or _is_nan(dob) or isinstance(dob, bool):
        return None
    if isinstance(dob, datetime):
        return dob.date()
    if isinstance(dob, date):
        return dob
    if not isinstance(dob, str):
        return None
    s = dob.strip()
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).date()
    except ValueError:
        pass
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def calculate_age(dob, ref_date=None) -> Optional[int]:
    d = parse_dob(dob)
    if d is None:
        return None
    ref = parse_dob(ref_date) if ref_date else date.today()
    if ref is None:
        return None
    return int(ref.year - d.year - ((ref.month, ref.day) < (d.month, d.day)))


def verify_age_dob_match(age, dob, ref_date=None, tolerance: int = 1) -> bool:
    calc = calculate_age(dob, ref_date)
    if calc is None or age is None:
        return True  # cannot disprove
    try:
        return abs(int(age) - calc) <= tolerance
    except (TypeError, ValueError):
        return True


# ---------------------------------------------------------------------------
# Historical identity indexes
# ---------------------------------------------------------------------------
def build_identity_index(records: List[dict]) -> dict:
    """Index by normalised Aadhaar / PAN / name|dob -> list of {name, dob, customer_id, ...}."""
    idx: Dict[str, Dict[str, List[dict]]] = {"aadhaar": {}, "pan": {}, "name_dob": {}}
    for rec in records:
        aad = norm_id(rec.get("Aadhaar_Number") or rec.get("aadhaar_number"))
        pan = norm_id(rec.get("PAN_Number") or rec.get("pan_number"))
        nm = normalize_name(rec.get("Name") or rec.get("full_name") or "")
        dob = parse_dob(rec.get("DOB") or rec.get("date_of_birth"))
        entry = {
            "name": nm,
            "dob": dob,
            "customer_id": rec.get("customer_id") or rec.get("User_ID"),
            "application_id": rec.get("application_id"),
            "application_number": rec.get("application_number"),
            "aadhaar": aad,
            "pan": pan,
        }
        if aad:
            idx["aadhaar"].setdefault(aad, []).append(entry)
        if pan:
            idx["pan"].setdefault(pan, []).append(entry)
        if nm and dob is not None:
            idx["name_dob"].setdefault(f"{nm}|{dob.isoformat()}", []).append(entry)
    return idx


def build_dob_index(records: List[dict]) -> dict:
    """Aadhaar/PAN -> set of DOBs (ISO) seen historically."""
    idx: Dict[str, set] = {}
    for rec in records:
        for key in (
            norm_id(rec.get("Aadhaar_Number") or rec.get("aadhaar_number")),
            norm_id(rec.get("PAN_Number") or rec.get("pan_number")),
        ):
            if not key:
                continue
            d = parse_dob(rec.get("DOB") or rec.get("date_of_birth"))
            if d is not None:
                idx.setdefault(key, set()).add(d.isoformat())
    return idx


def dual_identity_conflicts(input_aadhaar, input_pan, input_name, identity_index: dict, name_threshold: float,
                            current_customer_id=None) -> List[str]:
    """Human-readable conflict lines (empty = consistent)."""
    nm = normalize_name(input_name)
    if not nm:
        return []
    msgs: List[str] = []
    for key, bucket, label in (
        (norm_id(input_aadhaar), identity_index.get("aadhaar", {}), "Aadhaar"),
        (norm_id(input_pan), identity_index.get("pan", {}), "PAN"),
    ):
        if not key or is_masked_id(key):
            continue
        for entry in bucket.get(key, []):
            if current_customer_id is not None and str(entry.get("customer_id")) == str(current_customer_id):
                continue
            hist_name = entry.get("name") or ""
            if hist_name and not names_match(nm, hist_name, name_threshold):
                msgs.append(
                    f"{label} matches prior application_id={entry.get('application_id')} "
                    f"customer_id={entry.get('customer_id')} name='{hist_name}' "
                    f"(current name='{nm}')"
                )
    return msgs


def find_duplicate_identity(customer_id, aadhaar, pan, name, dob, index: dict, check_ids: bool = True) -> List[str]:
    """Human-readable conflict messages with prior application context. check_ids=False skips the Aadhaar / PAN
    lookup against earlier primary applicants (the caller checks every earlier participant instead) and keeps only
    the same-name-and-DOB-with-different-ID check."""
    msgs = []
    aad, p = norm_id(aadhaar), norm_id(pan)
    nm = normalize_name(name)
    d = parse_dob(dob)
    for key, bucket, label in (
        (aad, index.get("aadhaar", {}), "Aadhaar"),
        (p, index.get("pan", {}), "PAN"),
    ):
        if not check_ids or not key or is_masked_id(key):
            continue
        for e in bucket.get(key, []):
            if customer_id is not None and str(e.get("customer_id")) == str(customer_id):
                continue
            msgs.append(
                f"{label} already used by customer_id={e.get('customer_id')} "
                f"application_id={e.get('application_id')} name='{e.get('name')}'"
            )
    if nm and d is not None:
        for e in index.get("name_dob", {}).get(f"{nm}|{d.isoformat()}", []):
            if customer_id is not None and str(e.get("customer_id")) == str(customer_id):
                continue
            if (aad and e.get("aadhaar") and e["aadhaar"] != aad) or (p and e.get("pan") and e["pan"] != p):
                msgs.append(
                    f"Same name+DOB with different ID: customer_id={e.get('customer_id')} "
                    f"application_id={e.get('application_id')} "
                    f"prior_aadhaar={e.get('aadhaar')} prior_pan={e.get('pan')}"
                )
    return msgs


def dob_consistency_conflicts(input_aadhaar, input_pan, input_dob, dob_index: dict) -> List[str]:
    d = parse_dob(input_dob)
    if d is None:
        return []
    target = d.isoformat()
    msgs = []
    for key, label in ((norm_id(input_aadhaar), "Aadhaar"), (norm_id(input_pan), "PAN")):
        if not key or is_masked_id(key):
            continue
        others = sorted((dob_index.get(key) or set()) - {target})
        if others:
            msgs.append(f"{label}={key} current DOB={target} but history has DOB(s) {', '.join(others)}")
    return msgs


def shared_bank_account_hits(input_account, current_customer_id, historical_accounts: List[dict]) -> List[str]:
    """Evidence lines for an account already linked to a different customer (empty = not shared)."""
    acc = norm_id(input_account)
    if not acc or is_masked_id(acc):
        return []
    hits = []
    for rec in historical_accounts:
        other = norm_id(rec.get("account_number") or rec.get("Bank_Account_Number"))
        if other != acc:
            continue
        cid = rec.get("customer_id") or rec.get("User_ID")
        if cid is not None and current_customer_id is not None and str(cid) == str(current_customer_id):
            continue
        hits.append(
            f"account={acc} also on customer_id={cid} application_id={rec.get('application_id')} "
            f"participant_id={rec.get('participant_id')}"
        )
    return hits


# ---------------------------------------------------------------------------
# Addresses
# ---------------------------------------------------------------------------
def normalize_address(addr) -> str:
    if not addr:
        return ""
    s = re.sub(r"[^A-Za-z0-9\s]", " ", str(addr).upper())
    return " ".join(s.split())


def address_match_score(a, b) -> float:
    na, nb = normalize_address(a), normalize_address(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    return max(0.0, 1.0 - levenshtein_distance(na, nb) / max(len(na), len(nb)))
