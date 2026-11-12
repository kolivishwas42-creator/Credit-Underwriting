"""The vendor-report fields (title search + CERSAI report) read from the report's text."""

from __future__ import annotations

import re

PAN_RE = re.compile(r"\b([A-Z]{5}[0-9]{4}[A-Z])\b", re.I)

#: values that mean "nothing reported"
_BLANK = {"na", "n/a", "none", "-", "...", "not available"}
#: borrower-name parts that are firms, not people
_FIRM_WORDS = ("trading", "limited", "ltd", "pvt", "bank", "llp")
#: the unit / flat number labels, in priority order
_UNIT_PATTERNS = [
    r"House\s*/\s*Flat Number\s*/\s*Unit No",
    r"House\s+No",
    r"H\s+no",
    r"Flat\s+No",
    r"Flat Number",
    r"House Number",
    r"Unit Number",
    r"Quarter No",
]


def _norm_space(text: str) -> str:
    return re.sub(r"[ \t]+", " ", text.replace("\r", "\n"))


def _after_label(lines: list[str], labels: list[str], window: int = 1) -> str | None:
    lowered = [ln.lower().strip(" :") for ln in lines]
    for i, ln in enumerate(lowered):
        for label in labels:
            if ln == label or ln.startswith(label + ":") or ln.startswith(label + " "):
                rest = lines[i].split(":", 1)
                if len(rest) == 2 and rest[1].strip() and rest[1].strip().lower() not in labels:
                    return rest[1].strip()
                for j in range(1, window + 1):
                    if i + j < len(lines) and lines[i + j].strip():
                        return lines[i + j].strip()
    return None


def _blankish(value: str | None) -> bool:
    return not value or value.strip().lower() in _BLANK


def _field(text: str, patterns: list[str]) -> str | None:
    for pat in patterns:
        match = re.search(pat + r"\s*:?\s*([^\n]+)", text, re.I)
        if match:
            value = match.group(1).strip(" :")
            if value and value not in {"...", "NA", "N.A."}:
                return value
    return None


def _applicants(lines: list[str]) -> list[dict]:
    """The 'Applicant names' block: one name + PAN per line, until the owner / address / district lines."""
    applicants = []
    in_applicants = False
    for ln in lines:
        low = ln.lower()
        if low.startswith("applicant names"):
            in_applicants = True
            ln = re.sub(r"^applicant names\s*:\s*", "", ln, flags=re.I).strip()
            if not ln:
                continue
        if in_applicants and (low.startswith("owner/") or low.startswith("property address")
                              or low.startswith("district")):
            in_applicants = False
            continue
        if in_applicants:
            pan = PAN_RE.search(ln)
            name = re.sub(r",?\s*[A-Z]{5}[0-9]{4}[A-Z].*$", "", ln, flags=re.I).strip(" ,")
            if name and pan:
                applicants.append({"name": name, "pan": pan.group(1).upper()})
    return applicants


def _debtor_search(lines: list[str]) -> tuple[str | None, str | None]:
    """(PAN, result) of the CERSAI 'debtor based search' section (its first 20 lines)."""
    for i, ln in enumerate(lines):
        if "debtor based search" in ln.lower():
            section = "\n".join(lines[i:i + 20])
            pan_match = re.search(r"\bPAN\s*:\s*([A-Z]{5}[0-9]{4}[A-Z])\b", section, re.I)
            result_match = re.search(r"\bResults\s*:\s*(.+)", section, re.I)
            return (pan_match.group(1).upper() if pan_match else None,
                    result_match.group(1).strip() if result_match else None)
    return None, None


def _cersai_asset_owners(lines: list[str]) -> list[str]:
    """Prefer the 'Borrower name' summary. Fall back to asset-owner Yes flags."""
    owners: list[str] = []
    for i, ln in enumerate(lines):
        if not re.match(r"^borrower\s+name\s*:?\s*", ln, re.I):
            continue
        chunk = []
        for nxt in lines[i + 1: i + 6]:
            low = nxt.lower()
            if low.startswith("charge ") or low.startswith("asset id") or low.startswith("security "):
                break
            chunk.append(nxt)
        parts = [p.strip(" .") for p in " ".join(chunk).split(",") if len(p.strip()) > 3]
        for part in parts:
            if any(w in part.lower() for w in _FIRM_WORDS):
                continue
            if part not in owners:
                owners.append(part)
        if owners:
            return owners

    for i, ln in enumerate(lines):
        if ln.strip().lower() != "yes":
            continue
        window = lines[max(0, i - 6): i]
        if any("asset owner" in w.lower() for w in window[-2:]):
            continue
        candidate = None
        for back in window[::-1]:
            low = back.lower()
            if low in {"yes", "no", "individual", "na", "sole proprietorship"}:
                continue
            if len(back) < 4 or re.fullmatch(r"\d+", back):
                continue
            candidate = back
            break
        if candidate and candidate not in owners and "borrower" not in candidate.lower():
            owners.append(candidate)
    return owners


def _borrower_asset_rows(lines: list[str]) -> list[dict]:
    rows = []
    in_table = False
    for line in lines:
        low = line.lower()
        if "borrower(s) details" in low:
            in_table = True
            continue
        if in_table and (low.startswith("holder details") or low.startswith("transaction history")):
            break
        if not in_table:
            continue
        flag = re.search(r"\b(Yes|No)\s*$", line, re.I)
        if flag:
            name_part = line[:flag.start()].strip()
            if name_part:
                rows.append({"source_line": line, "borrower_text": name_part,
                             "asset_owner": flag.group(1).upper() == "YES"})
    return rows


def extract_vendor_fields(text: str) -> dict:
    raw = _norm_space(text or "")
    lines = [ln.strip() for ln in raw.splitlines() if ln.strip()]
    joined = "\n".join(lines)

    applicants = _applicants(lines)
    pans = [m.group(1).upper() for m in PAN_RE.finditer(joined)]
    debtor_search_pan, debtor_search_result = _debtor_search(lines)

    owners = _cersai_asset_owners(lines)
    header_owner = _after_label(lines, ["owner/transferor names", "current property owner", "current owner"])
    if header_owner and not _blankish(header_owner) and header_owner not in owners:
        owners.insert(0, header_owner)

    city = _field(joined, [r"City\s*/\s*Town\s*/\s*Village", r"\bCity\b"])
    state = _field(joined, [r"State\s*/\s*UT", r"\bState\b"])
    # the header 'District/State' line fills a city / state the CERSAI block does not give
    dist = _after_label(lines, ["district/state"])
    header_state = None
    if dist and "," in dist:
        header_city, first_state = [part.strip() for part in dist.split(",", 1)]
        city = city or header_city
        state = state or first_state
        header_state = dist.split(",")[-1].strip()

    # the CERSAI block (after "Pin Code") wins over the header district line: the last PIN in the text
    pin_matches = re.findall(r"(?:Pin\s*Code\s*/\s*Post\s*Code|Pin\s*Code|Pincode)\s*:?\s*(?:\n\s*)?(\d{6})", joined,
                             re.I)
    pin = pin_matches[-1] if pin_matches else None

    unit = None
    for pattern in _UNIT_PATTERNS:
        # words of the value on the same line ("Property 18", "Flat 101", "B 12") -- not only the first one
        match = re.search(pattern + r"\s*:?\s*([A-Za-z0-9](?:[A-Za-z0-9/-]|[ \t](?=[A-Za-z0-9]))*)", joined, re.I)
        if match:
            unit = match.group(1).strip()
            break

    # only explicit phrases: a boilerplate "completed" is not a construction status
    construction_status = None
    if re.search(r"under\s+construction", joined, re.I):
        construction_status = "Under Construction"
    elif re.search(r"(construction|building|physical).{0,40}completed|completed.{0,20}construction", joined, re.I):
        construction_status = "Completed"

    completion = None
    for label in ("actual completion percentage", "construction progress", "percentage of completion"):
        m = re.search(label + r".{0,40}?(\d{1,3}(?:\.\d+)?)\s*%", joined, re.I | re.S)
        if m:
            completion = float(m.group(1))
            break

    deed_available = None
    if re.search(r"registered deed\s*(available|verified|yes)", joined, re.I):
        deed_available = True
    elif re.search(r"registered deed\s*(not available|missing|no)\b", joined, re.I):
        deed_available = False

    case_number = None
    for ln in lines:
        match = re.search(r"\bCase\s*number\s*:\s*(.+)$", ln, re.I)
        if match:
            case_number = match.group(1).strip()
            break

    security_interest = {
        "security_interest_id": _field(joined, [r"Security Interest ID"]),
        "transaction_id": _field(joined, [r"Transaction Id"]),
        "secured_amount": _field(joined, [r"Total Secured Amount"]),
        "type": _field(joined, [r"Type Of Security Interest"]),
        "charge_details": _field(joined, [r"Details Of Charge"]),
        "registration_timestamp": _field(joined, [r"SI Registration Timestamp In CERSAI Portal",
                                                  r"SI Registration Timestamp"]),
        "satisfaction_status": _field(joined, [r"Satisfaction Status"]),
    }

    return {
        "raw_text_excerpt": joined[:4000],
        "case_number": case_number,
        "applicant_names": [a["name"] for a in applicants],
        "applicant_pans_named": applicants,
        "pans": list(dict.fromkeys(pans)),
        "borrower_asset_owner_rows": _borrower_asset_rows(lines),
        "owner_names": owners,
        "owner_count": len(owners) if owners else None,
        "header_owner": None if _blankish(header_owner) else header_owner,
        "city": city,
        "state": state or header_state,
        "header_state": header_state,
        "pincode": pin,
        "debtor_search": {"pan": debtor_search_pan, "result": debtor_search_result},
        "debtor_search_pan": debtor_search_pan,
        "debtor_search_result": debtor_search_result,
        "asset_owner_evidence": _cersai_asset_owners(lines),
        "security_interest": security_interest,
        "raw_text": joined,
        "unit_number": unit,
        "construction_status": construction_status,
        "completion_percent": completion,
        "deed_available": deed_available,
        "registration_number": _field(joined, [r"Registration Number"]),
        "registration_date": _field(joined, [r"Registration Date"]),
        "document_verification_status": _field(joined, [r"Document Verification Status"]),
        "has_cersai_security_interest": bool(re.search(r"security interest id", joined, re.I)),
        "property_address": _after_label(lines, ["property address"]),
    }
