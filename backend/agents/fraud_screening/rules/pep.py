"""
PEP (politically exposed person) screening (pure: no I/O).

Same idea as aml.py: the vendor returns hits grouped by category (parliamentOfIndia, candidateAffidavit, ...). We
flatten them, split by the display threshold, and give every record a field-by-field comparison against the
applicant. The result has the same shape as the AML one, so the viewer renders both with the same code.
"""

from __future__ import annotations

import re
from typing import Any, Iterable, Mapping

from agents.fraud_screening.rules import aml as A
from agents.fraud_screening.rules.aml import MATCH, MISMATCH, PARTIAL, UNAVAILABLE, AmlError, AmlInputError
from agents.fraud_screening.rules.policy import Policy

DEFAULT_THRESHOLD_PERCENT = A.DEFAULT_THRESHOLD_PERCENT


def _category_label(key, policy: Policy):
    return policy.pep_category_labels.get(key) or re.sub(r"(?<!^)(?=[A-Z])", " ", str(key)).capitalize()


# ---------------------------------------------------------------------------
# Request / response
# ---------------------------------------------------------------------------
def build_pep_request(applicant, vendor: Mapping[str, Any]):
    """Map our applicant dict to the Karza PEP request body. `name` is mandatory. `vendor` = conf pep.vendor."""
    name = A._text(applicant.get("Name"))
    if not name:
        raise AmlInputError("Applicant Name is required for the PEP check.")

    dob = ""
    if vendor.get("send_dob", False):
        dates, _ = A._dates_and_years([applicant.get("DOB")])
        # ASSUMPTION: the vendor takes DD-MM-YYYY, the format it returns in dateOfBirth.
        dob = next(iter(dates)).strftime("%d-%m-%Y") if dates else A._text(applicant.get("DOB"))

    return {
        "id": "",
        "name": name,
        "dateOfBirth": dob,
        "fatherName": "",
        "contacts": [],
        "emails": [],
        "state": "",
        "party": "",
        "nameMatch": True,
        "nameMatchThreshold": True,
        "nameMatchThresholdValue": vendor.get("name_match_threshold"),
        "additionalInformation": vendor.get("additional_information", True),
        "combinedSearch": vendor.get("combined_search", True),
        "confidenceLevel": vendor.get("confidence_level"),
    }


def extract_pep_records(payload, no_record_codes: Iterable[int]):
    """
    Flatten {"result": {"<category>": [records]}} into [(category, record), ...].

    "No records" is accepted only when unambiguous: a statusCode listed in `no_record_codes`, a result whose
    categories are all empty lists, or an explicit null result with no error code. Anything else raises and shows
    what the vendor sent, so a bad key or outage is never shown as a clean person.
    """
    if not isinstance(payload, dict):
        raise AmlError(f"Unexpected PEP response format: {A.snippet(payload)}")
    result = payload.get("result")
    code = A.status_code(payload)

    if A.is_no_record_reply(payload, no_record_codes):
        return []
    if code is not None and code >= 400:
        raise AmlError(f"PEP vendor reported an error (statusCode={code}): {A.snippet(payload)}")
    if isinstance(result, dict) and all(isinstance(v, list) for v in result.values()):
        return [(cat, r) for cat, recs in result.items() for r in recs if isinstance(r, dict)]
    if isinstance(result, list):
        return [("other", r) for r in result if isinstance(r, dict)]
    if result is None and "result" in payload:
        return []
    raise AmlError(f"Unexpected PEP response format (statusCode={code}): {A.snippet(payload)}. "
                   "If this means 'no records found', add its statusCode to pep.no_record_status_codes "
                   "in conf/fraud_screening.yaml.")


# ---------------------------------------------------------------------------
# Comparisons (each returns the same row shape as aml.py)
# ---------------------------------------------------------------------------
def _dob_candidates(record):
    """All dates of birth on the record (own DOB, DOB as per PAN, linked PANs), shown as DD-MM-YYYY."""
    raw = A._strings(record.get("dateOfBirth")) + A._strings(record.get("dobAsPerPan_"))
    raw += [A._text(d.get("dateOfBirth")) for d in A._items(record.get("associatedPanDetails"))
            if isinstance(d, dict) and d.get("dateOfBirth")]
    out = []
    for v in raw:
        dates, _ = A._dates_and_years([v])
        shown = [d.strftime("%d-%m-%Y") for d in sorted(dates)] or [v]
        out += [x for x in shown if x and x not in out]
    return out


def _record_pans(record):
    pans = []
    for key in ("mostProbablePan", "associatedPans", "pans", "pan"):
        pans += A._strings(record.get(key))
    pans += [A._text(d.get("pan")) for d in A._items(record.get("associatedPanDetails")) if isinstance(d, dict)]
    seen, out = set(), []
    for p in pans:
        n = A._norm_id(p)
        if n and n not in seen:
            seen.add(n)
            out.append(p)
    return out


def _compare_pan(applicant, record):
    app_pan = A._text(applicant.get("PAN_Number"))
    rec_pans = _record_pans(record)
    rec_lines = [f"PAN: {p}" for p in rec_pans[:4]] + ([f"+{len(rec_pans) - 4} more"] if len(rec_pans) > 4 else [])
    if not app_pan:
        return A._row("PAN", [], rec_lines, UNAVAILABLE, "No PAN in the application.")
    if not rec_pans:
        return A._row("PAN", [f"PAN: {app_pan}"], [], UNAVAILABLE, "Record has no PAN.")
    if A._norm_id(app_pan) in {A._norm_id(p) for p in rec_pans}:
        return A._row("PAN", [f"PAN: {app_pan}"], rec_lines, MATCH, "Same PAN: a strong indicator.")
    return A._row("PAN", [f"PAN: {app_pan}"], rec_lines, MISMATCH, "PAN differs from the PAN(s) on the record.")


def _compare_name(applicant, record, percent, policy: Policy):
    pseudo = {
        "name": record.get("name"),
        "secondaryName": A._strings(record.get("nameInLocale")) + A._strings(record.get("nameAsPerPan_")),
        "aliases": [A._text(d.get("name")) for d in A._items(record.get("associatedPanDetails"))
                    if isinstance(d, dict) and d.get("name")],
    }
    row = A._compare_name(applicant, pseudo, policy)
    if percent is not None:
        row["note"] = (row["note"] + f" Vendor name score {percent:g}%.").strip()
    return row


def _compare_location(applicant, record, policy: Policy):
    addresses = []
    for key in ("permanentAddress", "presentAddress", "localAddress", "candidateAddress",
                "additionalAddress", "officeAddress", "additionalAddresses"):
        addresses += A._strings(record.get(key))
    pseudo = {
        "address": addresses,
        "placeOfBirth": record.get("placeOfBirth"),
        "region": [v for key in ("state", "district", "constituency") for v in A._strings(record.get(key))],
    }
    sources = (("Address", "address"), ("Place of birth", "placeOfBirth"), ("State / constituency", "region"))
    return A._compare_location(applicant, pseudo, policy, sources)


# ---------------------------------------------------------------------------
# The record's own facts
# ---------------------------------------------------------------------------
def _positions(record):
    out = []
    for item in A._items(record.get("legislaturePositions")):
        if isinstance(item, dict):
            label = A._text(item.get("position"))
            where = A._text(item.get("assembly"))
            out.append(label + (f" ({where})" if where and label else where))
        else:
            out.append(A._text(item))
    for key in ("positionDetails", "positionHeld", "designation", "otherPostionHeld"):
        out += A._strings(record.get(key))
    return [p for p in out if p]


def _additional_info(record):
    out = []
    for item in A._items(record.get("additionalInformation")):
        if isinstance(item, dict):
            parts = [A._text(item.get(k)) for k in ("designation", "entityName", "memberType") if item.get(k)]
            if parts:
                out.append(", ".join(parts))
        else:
            out.append(A._text(item))
    return [o for o in out if o]


def _facts(category, record, policy: Policy):
    facts = []

    def add(label, values, joiner="; ", limit=A.MAX_LINE_CHARS):
        values = [v for v in values if v]
        if values:
            facts.append({"label": label, "value": A._clip(joiner.join(values), limit)})

    is_pep = record.get("isPep")
    add("Category", [_category_label(category, policy)])
    add("PEP status", ["Yes" if is_pep else "No"] if isinstance(is_pep, bool) else [])
    add("Vendor confidence", [A._text(record.get("confidenceLevel"))])
    add("Party", [A._text(record.get("party"))])
    add("Positions", _positions(record), "; ", 500)
    add("Term / election", [A._text(record.get("term")), A._text(record.get("electionType")),
                            A._text(record.get("electionDetail")), A._text(record.get("electionPeriod"))], " · ")
    add("Member type", [A._text(record.get("memberType")), A._text(record.get("parliamentType"))], " · ")
    add("Father / spouse", [A._text(record.get("fatherName")), A._text(record.get("fatherOrSpouseName")),
                            A._text(record.get("spouseName"))], " · ")
    add("Profession", A._strings(record.get("profession")) + A._strings(record.get("professions")), ", ")
    add("Qualification", [A._text(record.get("highestQualification"))])
    add("Affidavit / status", [A._text(record.get("affidavitStatus")), A._text(record.get("currentStatus"))], " · ")
    add("Date of death", [A._text(record.get("dateOfDeath"))])
    add("Notes", [A._text(record.get("statusNote"))] + _additional_info(record), " · ", A.MAX_REMARK_CHARS)
    return facts


def _source_links(record):
    # Only public profile links. Never `affidavits3Key` / S3 URIs: those are signed links with credentials.
    links = []
    for key in ("memberProfileSourceUri", "socialMediaLinks"):
        links += re.split(r",\s*(?=https?://)", A._text(record.get(key)))
    return [x.strip() for x in links if re.match(r"https?://", x.strip(), re.I)]


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------
def _record_view(index, category, record, applicant, percent, policy: Policy):
    comparison = [
        _compare_name(applicant, record, percent, policy),
        A._compare_dob(applicant, {"dateOfBirth": _dob_candidates(record)}),
        _compare_location(applicant, record, policy),
        _compare_pan(applicant, record),
    ]
    is_pep = record.get("isPep")
    list_type = ("PEP" if is_pep is True else "Government official" if record.get("isGovernmentOfficial") is True
                 else "Not flagged as PEP" if is_pep is False else "")
    tags = []
    if A._text(record.get("confidenceLevel")):
        tags.append(f"Confidence: {A._text(record.get('confidenceLevel'))}")
    if A._text(record.get("dateOfDeath")):
        tags.append("Date of death on record")
    return {
        "index": index,
        "match_percent": percent,
        "name": A._text(record.get("name")) or "(no name)",
        "data_source": "",
        "agency": _category_label(category, policy),
        "list_type": list_type,
        "tags": tags,
        "matched_fields": [r["field"] for r in comparison if r["status"] == MATCH],
        "partial_fields": [r["field"] for r in comparison if r["status"] == PARTIAL],
        "comparison": comparison,
        "facts": _facts(category, record, policy),
        "source_links": _source_links(record),
    }


def screen_pep(payload, applicant, policy: Policy, no_record_codes: Iterable[int],
               threshold_percent=DEFAULT_THRESHOLD_PERCENT, source="vendor"):
    """Flatten the vendor hits, split by threshold, and build the comparison view for each record."""
    threshold = A.to_percent(threshold_percent)
    if threshold is None:
        threshold = DEFAULT_THRESHOLD_PERCENT

    views = [_record_view(i, category, rec, applicant or {}, A.to_percent(rec.get("nameScore")), policy)
             for i, (category, rec) in enumerate(extract_pep_records(payload, no_record_codes))]
    strong, other, summary = A.split_views(views, threshold)
    return {
        "kind": "pep",
        "request_id": payload.get("requestId") if isinstance(payload, dict) else None,
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


__all__ = ["AmlError", "AmlInputError", "MISMATCH", "build_pep_request", "extract_pep_records", "screen_pep"]
