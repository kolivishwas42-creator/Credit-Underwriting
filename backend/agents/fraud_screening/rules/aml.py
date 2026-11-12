"""
AML screening (pure: no I/O).

The vendor returns a flat list of watch-list records, each with a fuzzy `score` (0-1). This module turns that list
into something a reviewer can check quickly:

  * records scoring at/above the threshold  -> `strong_matches`
  * everything else                         -> `other_matches` (UI: "Show more")
  * every record carries a field-by-field comparison against the applicant (name, date of birth, location,
    PAN/Aadhaar) plus the record's own facts.

The vendor HTTP call lives in watchlist.py; this module only builds the request body and reads the reply.
"""

from __future__ import annotations

import ast
import json
import re
from datetime import date
from typing import Any, Iterable, Mapping

from agents.fraud_screening.rules import identity
from agents.fraud_screening.rules.policy import Policy

DEFAULT_THRESHOLD_PERCENT = 70.0

# Field comparison outcomes (the UI colours rows by these).
MATCH, PARTIAL, MISMATCH, UNAVAILABLE = "match", "partial", "mismatch", "unavailable"

MAX_LINE_CHARS = 220        # long vendor text is shortened for display
MAX_REMARK_CHARS = 700


class AmlError(Exception):
    """The vendor call failed or returned something we cannot read."""


class AmlInputError(AmlError):
    """The application lacks something the vendor requires (e.g. a name)."""


# ---------------------------------------------------------------------------
# Reading the vendor response
# ---------------------------------------------------------------------------
_BAD_ESCAPE = re.compile(r'(\\["\\/bfnrt]|\\u[0-9a-fA-F]{4})|\\')


def parse_vendor_json(text):
    """json.loads, tolerant of stray backslashes (the vendor text contains things like `Father\\'s name`, which strict
    JSON rejects). Valid escapes are left untouched."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    try:
        return json.loads(_BAD_ESCAPE.sub(lambda m: m.group(1) or "\\\\", text))
    except json.JSONDecodeError as exc:
        raise AmlError(f"AML response is not valid JSON: {exc}") from exc


def build_vendor_request(applicant, vendor: Mapping[str, Any]):
    """Map our applicant dict to the Karza request body. `name` is mandatory. `vendor` = conf aml.vendor."""
    name = _text(applicant.get("Name"))
    if not name:
        raise AmlInputError("Applicant Name is required for the AML check.")

    dob, age = "", ""
    if vendor.get("send_dob_and_age", False):
        dates, _ = _dates_and_years([applicant.get("DOB")])
        # ASSUMPTION: the vendor takes DD-MM-YYYY, the same format it returns in dateOfBirth.
        dob = next(iter(dates)).strftime("%d-%m-%Y") if dates else _text(applicant.get("DOB"))
        age = _text(applicant.get("Age"))

    return {
        "name": name,
        "age": age,
        "dateOfBirth": dob,
        "gender": "",
        "agency": "",
        "nationality": "",
        "nameMatch": True,
        "nameMatchThreshold": True,
        "nameMatchThresholdValue": vendor.get("name_match_threshold"),
        "oldRecords": vendor.get("old_records", False),
        "isRbiNotified": vendor.get("rbi_notified", False),
        "pdfReport": vendor.get("pdf_report", False),
    }


def status_code(payload):
    try:
        return int(payload.get("statusCode")) if isinstance(payload, dict) else None
    except (TypeError, ValueError):
        return None


def is_no_record_reply(payload, codes: Iterable[int]):
    """True when the vendor's statusCode is one the config lists as 'no records found'."""
    return status_code(payload) in {int(c) for c in codes}


def snippet(payload, limit=300):
    text = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)
    return text if len(text) <= limit else text[:limit] + "…"


def extract_records(payload, no_record_codes: Iterable[int]):
    """
    The vendor wraps the hit list as {"result": [...]}; a bare list is accepted too.

    "No records" is accepted only when it is unambiguous: a statusCode listed in `no_record_codes`, or an explicit null
    `result` with no error code. Anything else raises and shows what the vendor sent, so a bad key or an outage is
    never shown as a clean person.
    """
    if isinstance(payload, list):
        return [r for r in payload if isinstance(r, dict)]
    if not isinstance(payload, dict):
        raise AmlError(f"Unexpected AML response format: {snippet(payload)}")

    records = payload.get("result")
    if isinstance(records, list):
        return [r for r in records if isinstance(r, dict)]
    code = status_code(payload)
    if is_no_record_reply(payload, no_record_codes) or (
            records is None and "result" in payload and (code is None or code < 400)):
        return []
    raise AmlError(f"Unexpected AML response format (statusCode={code}): {snippet(payload)}. "
                   "If this means 'no records found', add its statusCode to aml.no_record_status_codes "
                   "in conf/fraud_screening.yaml.")


# ---------------------------------------------------------------------------
# Small normalisers (vendor values arrive as str, list, or a stringified list)
# ---------------------------------------------------------------------------
def _text(value):
    """Single-line display text; drops the stray backslashes the vendor leaves in."""
    return " ".join(str(value).replace("\\", "").split()) if value is not None else ""


def _items(value):
    """Flatten str / list / "['a', 'b']" into a list of non-empty items (dicts kept as-is)."""
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        out = []
        for v in value:
            out.extend(_items(v))
        return out
    if isinstance(value, dict):
        return [value]
    s = str(value).strip()
    if s[:1] in "[(" and s[-1:] in "])":
        try:
            parsed = ast.literal_eval(s)
        except (ValueError, SyntaxError):
            parsed = None
        if isinstance(parsed, (list, tuple)):
            return _items(parsed)
    return [s] if s and s.lower() not in ("none", "null", "[]") else []


def _strings(value):
    return [t for t in (_text(i) for i in _items(value) if not isinstance(i, dict)) if t]


def _clip(text, limit=MAX_LINE_CHARS):
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def to_percent(value):
    """Scores/thresholds <= 1 are fractions (0.72 -> 72); larger values are already percentages."""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return round(v * 100 if v <= 1 else v, 1)


def _mask_aadhaar(a):
    digits = re.sub(r"\D", "", a)
    return ("XXXX XXXX " + digits[-4:]) if len(digits) >= 4 else a


def _norm_id(value):
    return re.sub(r"[^A-Z0-9]", "", str(value).upper())


def _leaf_strings(obj):
    """Every string/number inside a record, one at a time (so IDs from different fields never merge)."""
    if isinstance(obj, dict):
        for v in obj.values():
            yield from _leaf_strings(v)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            yield from _leaf_strings(v)
    elif obj is not None:
        yield str(obj)


# ---------------------------------------------------------------------------
# Field comparisons: each returns {"field", "applicant", "record", "status", "note"}
# ---------------------------------------------------------------------------
def _row(field, applicant, record, status, note=""):
    return {"field": field, "applicant": applicant, "record": record, "status": status, "note": note}


def _compare_name(applicant, record, policy: Policy):
    app_names, app_lines = [], []
    for key, label in (("Name", ""), ("Name_As_Per_PAN", "PAN"), ("Name_As_Per_Aadhaar", "Aadhaar")):
        n = _text(applicant.get(key))
        if n and n.lower() not in [x.lower() for x in app_names]:
            app_names.append(n)
            app_lines.append(f"{n} (as per {label})" if label else n)

    primary = _text(record.get("name"))
    variants = [(primary, "name")] if primary else []
    variants += [(n, "secondary name") for n in _strings(record.get("secondaryName"))]
    variants += [(n, "alias") for n in _strings(record.get("aliases"))]
    rec_lines = [primary] if primary else []

    if not app_names:
        return _row("Name", [], rec_lines, UNAVAILABLE, "No name in the application.")
    if not variants:
        return _row("Name", app_lines, [], UNAVAILABLE, "No name on the record.")

    best = (0.0, "", "")
    for a in app_names:
        for v, kind in variants:
            sim = identity.name_similarity(a, v)
            if sim > best[0]:
                best = (sim, v, kind)
    sim, best_name, kind = best
    if best_name and best_name != primary:
        rec_lines.append(f"Closest {kind}: {best_name}")
    status = MATCH if sim >= policy.name_match else PARTIAL if sim >= policy.name_partial else MISMATCH
    return _row("Name", app_lines, rec_lines, status, f"Best name similarity {round(sim * 100)}%.")


def _dates_and_years(values):
    dates, years = set(), set()
    for v in values:
        s = _text(v)
        triples = [(int(y), int(m), int(d)) for y, m, d in
                   re.findall(r"(?<!\d)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)", s)]
        # Indian convention: day first (26-12-1955)
        triples += [(int(y), int(m), int(d)) for d, m, y in
                    re.findall(r"(?<!\d)(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{4})(?!\d)", s)]
        for y, m, d in triples:
            try:
                dates.add(date(y, m, d))
            except ValueError:
                pass
        years.update(int(y) for y in re.findall(r"\b(1[89]\d{2}|20\d{2})\b", s))
    return dates, years


def _compare_dob(applicant, record):
    app_raw = _text(applicant.get("DOB"))
    rec_vals = _strings(record.get("dateOfBirth"))
    rec_years_raw = _strings(record.get("yearOfBirth"))
    rec_lines = rec_vals or [f"Year only: {y}" for y in rec_years_raw]

    if not app_raw:
        return _row("Date of birth", [], rec_lines, UNAVAILABLE, "No date of birth in the application.")
    if not rec_lines:
        return _row("Date of birth", [app_raw], [], UNAVAILABLE, "Record has no date of birth.")

    app_dates, app_years = _dates_and_years([app_raw])
    rec_dates, rec_years = _dates_and_years(rec_vals + rec_years_raw)
    if app_dates & rec_dates:
        return _row("Date of birth", [app_raw], rec_lines, MATCH, "Exact date of birth match.")
    if app_years & rec_years:
        note = ("Year of birth matches but the full date differs." if rec_dates
                else "Record only gives the year of birth, and it matches.")
        return _row("Date of birth", [app_raw], rec_lines, PARTIAL, note)
    return _row("Date of birth", [app_raw], rec_lines, MISMATCH, "Date of birth differs.")


def _place_tokens(text, stopwords):
    return {t for t in re.findall(r"[a-z]{3,}", text.lower()) if t not in stopwords}


DEFAULT_LOCATION_SOURCES = (("Address", "address"), ("Place of birth", "placeOfBirth"), ("Country", "country"))


def _compare_location(applicant, record, policy: Policy, sources=DEFAULT_LOCATION_SOURCES):
    app_addr = _text(applicant.get("Address"))
    rec_lines = []
    for label, key in sources:
        vals = _strings(record.get(key))
        if vals:
            rec_lines.append(_clip(f"{label}: " + "; ".join(vals)))

    if not app_addr:
        return _row("Address / location", [], rec_lines, UNAVAILABLE, "No address in the application.")
    if not rec_lines:
        return _row("Address / location", [app_addr], [], UNAVAILABLE, "Record has no address or place of birth.")

    rec_blob = " ".join(line.split(": ", 1)[1] for line in rec_lines)
    app_pins = set(re.findall(r"\b\d{6}\b", app_addr))
    if app_pins & set(re.findall(r"\b\d{6}\b", rec_blob)):
        return _row("Address / location", [app_addr], rec_lines, MATCH, "Same pincode.")
    shared = sorted(_place_tokens(app_addr, policy.place_stopwords) & _place_tokens(rec_blob, policy.place_stopwords))
    if shared:
        return _row("Address / location", [app_addr], rec_lines, PARTIAL,
                    "Common place name(s): " + ", ".join(s.title() for s in shared) + ".")
    return _row("Address / location", [app_addr], rec_lines, MISMATCH, "No common place names.")


def _compare_ids(applicant, record):
    ids = []
    pan, aadhaar = _text(applicant.get("PAN_Number")), _text(applicant.get("Aadhaar_Number"))
    if pan:
        ids.append(("PAN", pan, pan))
    if aadhaar:
        ids.append(("Aadhaar", aadhaar, _mask_aadhaar(aadhaar)))
    if not ids:
        return _row("PAN / Aadhaar", [], [], UNAVAILABLE, "No PAN or Aadhaar in the application.")

    leaves = [_norm_id(x) for x in _leaf_strings(record)]
    found = [label for label, raw, _ in ids
             if len(_norm_id(raw)) >= 8 and any(_norm_id(raw) in leaf for leaf in leaves)]
    app_lines = [f"{label}: {shown}" for label, _, shown in ids]
    if found:
        return _row("PAN / Aadhaar", app_lines, [f"{x} number appears on this record" for x in found], MATCH,
                    "Identity number found on the record, which is a strong indicator.")
    return _row("PAN / Aadhaar", app_lines, ["Not found on this record"], UNAVAILABLE,
                "Watch-list records rarely carry Indian PAN/Aadhaar numbers, so this does not clear the person.")


# ---------------------------------------------------------------------------
# The record's own facts (shown under the comparison)
# ---------------------------------------------------------------------------
def _id_documents(record):
    out = []
    for item in _items(record.get("identificationInformation")):
        if isinstance(item, dict) and item.get("id"):
            kind = _text(item.get("id_type") or item.get("id_type_description") or "ID")
            country = _text(item.get("country"))
            out.append(f"{kind}: {_text(item['id'])}" + (f" ({country})" if country else ""))
    out += _strings(record.get("passportDetails"))
    nid = _text(record.get("nationalIdentificationNumber"))
    return out + ([f"National ID: {nid}"] if nid else [])


def _facts(record):
    facts = []

    def add(label, values, joiner="; ", limit=MAX_LINE_CHARS):
        values = [v for v in values if v]
        if values:
            facts.append({"label": label, "value": _clip(joiner.join(values), limit)})

    add("Also known as", _strings(record.get("aliases")), ", ")
    add("Nationality", _strings(record.get("nationality")) or _strings(record.get("nationalitiesStandardized_")), ", ")
    add("Gender", _strings(record.get("gender")))
    add("ID documents", _id_documents(record), "; ", 400)
    add("Sanction list / programme",
        [_text(record.get("sanctionList")), _text((record.get("details") or {}).get("program"))])
    add("Case no.", [_text(record.get("caseNo")), _text(record.get("actName"))])
    add("Detained by", [_text(record.get("detainingAuthority"))])
    add("Reference", _strings(record.get("reference")))
    add("Listed on", [_text(record.get("listedOn"))[:10]])
    add("Notes", [_text(record.get("summary")), _text(record.get("remark")), _text(record.get("additionalInformation"))],
        " · ", MAX_REMARK_CHARS)
    add("Last updated", [_text(record.get("updatedDate") or record.get("lastFetchDate"))])
    return facts


def _source_links(record):
    links = re.split(r",\s*(?=https?://)", _text(record.get("source")))
    return [x.strip() for x in links if re.match(r"https?://", x.strip(), re.I)]


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------
def _record_view(index, record, applicant, percent, policy: Policy):
    comparison = [
        _compare_name(applicant, record, policy),
        _compare_dob(applicant, record),
        _compare_location(applicant, record, policy),
        _compare_ids(applicant, record),
    ]
    return {
        "index": index,
        "match_percent": percent,
        "name": _text(record.get("name")) or "(no name)",
        "data_source": _text(record.get("dataSource")),
        "agency": _text(record.get("agency")),
        "list_type": _text(record.get("agencyList")),
        "matched_fields": [r["field"] for r in comparison if r["status"] == MATCH],
        "partial_fields": [r["field"] for r in comparison if r["status"] == PARTIAL],
        "comparison": comparison,
        "facts": _facts(record),
        "source_links": _source_links(record),
    }


def split_views(views, threshold):
    """Sort views by score, split at the threshold, and phrase the summary (shared by AML and PEP)."""
    views.sort(key=lambda v: (v["match_percent"] is not None, v["match_percent"] or 0), reverse=True)
    strong = [v for v in views if v["match_percent"] is not None and v["match_percent"] >= threshold]
    strong_ids = {v["index"] for v in strong}
    other = [v for v in views if v["index"] not in strong_ids]

    t = f"{threshold:g}%"
    if not views:
        summary = "No records matched this applicant."
    elif strong:
        summary = (f"{len(strong)} of {len(views)} record(s) scored {t} or higher. "
                   "Review the side-by-side comparison below.")
    else:
        summary = (f"No record reached {t}. {len(other)} lower-scoring record(s) are available under "
                   "'Show more' if you want to look.")
    return strong, other, summary


def screen(payload, applicant, policy: Policy, no_record_codes: Iterable[int],
           threshold_percent=DEFAULT_THRESHOLD_PERCENT, source="vendor"):
    """Split the vendor hit list by threshold and build the comparison view for every record. `applicant` has keys
    such as Name, DOB, Address, PAN_Number."""
    threshold = to_percent(threshold_percent)
    if threshold is None:
        threshold = DEFAULT_THRESHOLD_PERCENT

    views = [_record_view(i, rec, applicant or {}, to_percent(rec.get("score")), policy)
             for i, rec in enumerate(extract_records(payload, no_record_codes))]
    strong, other, summary = split_views(views, threshold)
    return {
        "request_id": payload.get("requestId") if isinstance(payload, dict) else None,
        "kind": "aml",
        "source": source,                       # "vendor" or "mock" (sample file)
        "threshold_percent": threshold,
        "total_records": len(views),
        "strong_count": len(strong),
        "other_count": len(other),
        "has_potential_match": bool(strong),
        "summary": summary,
        "strong_matches": strong,
        "other_matches": other,
    }
