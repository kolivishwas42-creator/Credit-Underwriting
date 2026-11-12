"""
The rule engine: the collateral record (LOS) against the fields read from the vendor report.

Each rule returns PASS, REFER, WARNING, PENDING, NOT_APPLICABLE, or SKIPPED (disabled). Pure functions over plain data
and a RuleConfig -- no I/O.
"""

from __future__ import annotations

import re
from typing import Any

from agents.collateral_verification.config import RuleConfig
from agents.collateral_verification.rules.names import any_match, join_owner


def _result(cfg: RuleConfig, rule_id: str, status: str, summary: str, db_value: Any, vendor_value: Any,
            detail: str = "") -> dict:
    return {
        "rule_id": rule_id,
        "label": cfg.rules[rule_id]["label"],
        "enabled": True,
        "status": status,
        "summary": summary,
        "db_value": db_value,
        "vendor_value": vendor_value,
        "detail": detail,
    }


def _skipped(cfg: RuleConfig, rule_id: str) -> dict:
    return {
        "rule_id": rule_id,
        "label": cfg.rules[rule_id]["label"],
        "enabled": False,
        "status": "SKIPPED",
        "summary": "Disabled in config.py",
        "db_value": None,
        "vendor_value": None,
        "detail": "",
    }


def _enabled(cfg: RuleConfig, rule_id: str) -> bool:
    return bool(cfg.rules[rule_id]["enabled"])


def _ownership_kind(value: str | None) -> str | None:
    if not value:
        return None
    low = value.lower()
    if any(k in low for k in ("joint", "co-owner", "co owner", "multiple")):
        return "joint"
    if any(k in low for k in ("single", "sole", "individual")):
        return "single"
    return None


def _status_kind(value: str | None) -> str | None:
    if not value:
        return None
    low = value.lower()
    if "under" in low and "construct" in low:
        return "under_construction"
    if "complete" in low or low.strip() in {"ready", "constructed", "built"}:
        return "completed"
    return None


def _parse_pct(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    m = re.search(r"(\d{1,3}(?:\.\d+)?)", str(value))
    return float(m.group(1)) if m else None


def _units_equal(a: str, b: str) -> bool:
    def norm(v: str) -> str:
        return re.sub(r"[^a-z0-9]", "", v.lower())

    return norm(a) == norm(b) and norm(a) != ""


# ------------------------------------------------------------------------------------------------------ the rules
def _rule_owner_name(cfg: RuleConfig, db_owner: str, db_owner_names: list[str], vendor_owners: list[str]) -> dict:
    rid = "rule_1_owner_name"
    if not _enabled(cfg, rid):
        return _skipped(cfg, rid)
    if not vendor_owners:
        return _result(cfg, rid, "PENDING", "Vendor owner information is missing.", db_owner, None)
    ok, left, right = any_match(db_owner_names, vendor_owners, cfg.name_match_threshold)
    if ok:
        return _result(cfg, rid, "PASS", "Application owner matches a vendor owner name.", db_owner, vendor_owners)
    return _result(cfg, rid, "REFER", "Owner name on the application does not match the vendor report.", db_owner,
                   vendor_owners, f"Closest pair: {left} vs {right}")


def _rule_ownership(cfg: RuleConfig, prop: dict, vendor: dict) -> dict:
    rid = "rule_2_ownership"
    kind = _ownership_kind(prop.get("property_ownership"))
    count = vendor.get("owner_count")
    if not _enabled(cfg, rid):
        return _skipped(cfg, rid)
    if not count:
        return _result(cfg, rid, "PENDING", "Vendor owner count is missing.", prop.get("property_ownership"), None)
    if kind == "single" and count == 1:
        return _result(cfg, rid, "PASS", "Single ownership and one vendor owner.", kind, count)
    if kind == "single" and count > 1:
        return _result(cfg, rid, "REFER", "Application says single ownership but the vendor lists multiple owners.",
                       kind, count)
    if kind == "joint" and count == 1:
        return _result(cfg, rid, "WARNING", "Application says joint ownership but the vendor lists one owner.", kind,
                       count)
    if kind == "joint" and count > 1:
        return _result(cfg, rid, "PASS", "Joint ownership agrees with multiple vendor owners.", kind, count)
    return _result(cfg, rid, "REFER", "Ownership type could not be aligned with the vendor owner count.", kind, count)


def _rule_applicant_is_owner(cfg: RuleConfig, applicant_names: list[str], vendor_owners: list[str]) -> dict:
    rid = "rule_3_applicant_is_owner"
    if not _enabled(cfg, rid):
        return _skipped(cfg, rid)
    if not vendor_owners:
        return _result(cfg, rid, "PENDING", "Vendor owner information is missing.", applicant_names, None)
    ok, left, right = any_match(applicant_names, vendor_owners, cfg.name_match_threshold)
    if ok:
        return _result(cfg, rid, "PASS", "An applicant or co-applicant matches a vendor owner.", applicant_names,
                       vendor_owners, f"Matched {left} ≈ {right}")
    return _result(cfg, rid, "REFER", "Neither the applicant nor a co-applicant matches the vendor owner names.",
                   applicant_names, vendor_owners)


def _rule_pan(cfg: RuleConfig, prop: dict, participants: list[dict], vendor: dict) -> dict:
    """An independent PAN (owner PAN on the property, else the first applicant PAN, else the applicant PAN printed in
    the report) against the PAN of the CERSAI debtor-based search."""
    rid = "rule_pan"
    owner_pan = str(prop.get("owner_pan") or "").strip().upper()
    applicant_pan = ""
    for participant in participants:
        applicant_pan = str(participant.get("pan_number") or "").strip().upper()
        if applicant_pan:
            break
    report_pan = str(vendor.get("report_applicant_pan") or "").strip().upper()
    cersai_pan = str(vendor.get("debtor_search_pan") or "").strip().upper()

    if owner_pan:
        selected_pan, selected_source = owner_pan, "Property owner PAN (database)"
    elif applicant_pan:
        selected_pan, selected_source = applicant_pan, "Applicant PAN (loan application database)"
    elif report_pan:
        selected_pan, selected_source = report_pan, "Applicant PAN (CERSAI report)"
    else:
        selected_pan, selected_source = "", "No independent PAN available"

    if not _enabled(cfg, rid):
        return _skipped(cfg, rid)
    sources = {
        "owner_pan": owner_pan or "Not available",
        "applicant_pan_db": applicant_pan or "Not available",
        "report_applicant_pan": report_pan or "Not available",
    }
    if not selected_pan or not cersai_pan:
        return _result(cfg, rid, "PENDING",
                       "PAN comparison cannot be completed because a comparison PAN or CERSAI debtor-search PAN is "
                       "unavailable.",
                       {**sources, "selected_pan": selected_pan or "Not available", "selected_source": selected_source},
                       {"cersai_debtor_search_pan": cersai_pan or "Not available"})
    db_value = {**sources, "pan_used_for_comparison": selected_pan, "selected_source": selected_source}
    if selected_pan == cersai_pan:
        return _result(cfg, rid, "PASS", f"{selected_source} matches the CERSAI debtor-search PAN.", db_value,
                       {"cersai_debtor_search_pan": cersai_pan})
    return _result(cfg, rid, "REFER", f"{selected_source} does not match the CERSAI debtor-search PAN.", db_value,
                   {"cersai_debtor_search_pan": cersai_pan})


def _rule_construction_status(cfg: RuleConfig, prop: dict, vendor: dict) -> dict:
    rid = "rule_8_construction_status"
    db_value, ven_value = prop.get("collateral_status"), vendor.get("construction_status")
    db_c, ven_c = _status_kind(db_value), _status_kind(ven_value)
    if not _enabled(cfg, rid):
        return _skipped(cfg, rid)
    if not ven_c:
        return _result(cfg, rid, "PENDING",
                       "Vendor construction status is missing. A technical valuation / site report is required.",
                       db_value, ven_value)
    if db_c == ven_c:
        return _result(cfg, rid, "PASS", "Construction status matches.", db_value, ven_value)
    if db_c == "under_construction" and ven_c == "completed":
        return _result(cfg, rid, "WARNING",
                       "Application is under construction but the vendor observed a completed building.",
                       db_value, ven_value)
    if db_c == "completed" and ven_c == "under_construction":
        return _result(cfg, rid, "REFER",
                       "Application says completed but the vendor observed construction still in progress.",
                       db_value, ven_value)
    return _result(cfg, rid, "REFER", "Construction status does not match.", db_value, ven_value)


def _rule_completion_percent(cfg: RuleConfig, prop: dict, vendor: dict) -> dict:
    rid = "rule_9_completion_percent"
    tolerance = float(cfg.rules[rid].get("tolerance_pp", cfg.completion_tolerance_pp))
    db_pct = _parse_pct(prop.get("percentage_of_completion"))
    ven_pct = vendor.get("completion_percent")
    if not _enabled(cfg, rid):
        return _skipped(cfg, rid)
    if ven_pct is None or db_pct is None:
        return _result(cfg, rid, "PENDING", "Completion percentage is missing on one side.",
                       prop.get("percentage_of_completion"), ven_pct,
                       f"Tolerance is {tolerance:g} percentage points (config.py).")
    diff = abs(db_pct - float(ven_pct))
    status = "PASS" if diff <= tolerance else "REFER"
    return _result(cfg, rid, status, f"Difference is {diff:g} percentage points (tolerance {tolerance:g}).", db_pct,
                   ven_pct)


def _rule_location(cfg: RuleConfig, prop: dict, vendor: dict) -> dict:
    """PIN, city and state compared one by one (PIN exactly, city and state case-insensitively)."""
    rid = "rule_13_location"
    db_loc = {k: str(prop.get(k) or "").strip() for k in ("pincode", "city", "state")}
    ven_loc = {k: str(vendor.get(k) or "").strip() for k in ("pincode", "city", "state")}
    if not _enabled(cfg, rid):
        return _skipped(cfg, rid)
    mismatches: list[str] = []
    missing: list[str] = []
    for key, label, exact in (("pincode", "PIN", True), ("city", "City", False), ("state", "State", False)):
        if not ven_loc[key]:
            missing.append(label)
        elif (db_loc[key] != ven_loc[key]) if exact else (db_loc[key].lower() != ven_loc[key].lower()):
            mismatches.append(label)
    if mismatches:
        return _result(cfg, rid, "REFER", "Location mismatch found in: " + ", ".join(mismatches), db_loc, ven_loc,
                       ("Vendor fields missing: " + ", ".join(missing)) if missing else "")
    if missing:
        return _result(cfg, rid, "PENDING", "Some vendor location fields are missing: " + ", ".join(missing), db_loc,
                       ven_loc)
    return _result(cfg, rid, "PASS", "PIN, city and state match.", db_loc, ven_loc)


def _rule_unit_number(cfg: RuleConfig, prop: dict, vendor: dict) -> dict:
    rid = "rule_14_unit_number"
    db_unit = (prop.get("house_flat_number") or "").strip()
    ven_unit = (vendor.get("unit_number") or "").strip()
    if not _enabled(cfg, rid):
        return _skipped(cfg, rid)
    if not ven_unit:
        return _result(cfg, rid, "PENDING", "Vendor unit number is missing.", db_unit, None)
    if _units_equal(db_unit, ven_unit):
        return _result(cfg, rid, "PASS", "Flat / house number matches.", db_unit, ven_unit)
    return _result(cfg, rid, "REFER", "Flat / house number does not match.", db_unit, ven_unit)


def _cersai_charge_review(cfg: RuleConfig, vendor: dict) -> dict | None:
    """A separate legal-review line for an existing, unsatisfied CERSAI charge."""
    charge = vendor.get("security_interest") or {}
    satisfaction = (charge.get("satisfaction_status") or "").strip().lower()
    if not (cfg.flag_unsatisfied_cersai_charge and satisfaction == "not satisfied"):
        return None
    return {
        "rule_id": "cersai_charge_review",
        "label": "Existing CERSAI security interest",
        "enabled": True,
        "status": "REFER",
        "summary": "An unsatisfied security interest is reported. Legal review is required.",
        "db_value": None,
        "vendor_value": charge,
        "detail": "CERSAI charge evidence is not proof of registered deed ownership.",
    }


def evaluate(record: dict, vendor: dict, cfg: RuleConfig) -> list[dict]:
    """Every rule over the first collateral property of the record. rule_17_registered_deed has no evaluator (it was
    switched off in code before the restructure) and produces no line."""
    prop = (record.get("properties") or [{}])[0]
    participants = record.get("participants") or []
    applicant_names = [p.get("full_name") or "" for p in participants if p.get("full_name")]
    db_owner = join_owner(prop)
    db_owner_names = [n for n in [db_owner, prop.get("property_owner")] if n]
    vendor_owners = [n for n in (vendor.get("owner_names") or []) if n]

    results = [
        _rule_owner_name(cfg, db_owner, db_owner_names, vendor_owners),
        _rule_ownership(cfg, prop, vendor),
        _rule_applicant_is_owner(cfg, applicant_names, vendor_owners),
        _rule_pan(cfg, prop, participants, vendor),
        _rule_construction_status(cfg, prop, vendor),
        _rule_completion_percent(cfg, prop, vendor),
        _rule_location(cfg, prop, vendor),
        _rule_unit_number(cfg, prop, vendor),
    ]
    charge = _cersai_charge_review(cfg, vendor)
    if charge:
        results.append(charge)
    return results


def summarize(rule_results: list[dict], vendor_final_status: str | None, cfg: RuleConfig) -> dict:
    active = [r for r in rule_results if r["status"] != "SKIPPED"]
    counts: dict[str, int] = {}
    for r in active:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    if any(r["status"] == "REFER" for r in active):
        overall = "REFER"
    elif any(r["status"] == "WARNING" for r in active):
        overall = "WARNING"
    elif any(r["status"] == "PENDING" for r in active):
        overall = "PENDING"
    elif active and all(r["status"] in {"PASS", "NOT_APPLICABLE"} for r in active):
        overall = "PASS"
    else:
        overall = "PENDING"

    vendor_norm = (vendor_final_status or "").strip().lower()
    conflict = False
    conflict_reason = ""
    if cfg.flag_vendor_status_conflict and vendor_norm in ("approved", "rejected"):
        if vendor_norm == "approved" and overall in {"REFER", "WARNING"}:
            conflict = True
            conflict_reason = f"Vendor marked approved but rule outcome is {overall}."
        if vendor_norm == "rejected" and overall == "PASS":
            conflict = True
            conflict_reason = "Vendor marked rejected but every applicable rule passed."

    actions = []
    for r in active:
        if r["status"] == "PENDING":
            actions.append(f"{r['label']}: obtain the missing vendor field before a decision.")
        elif r["status"] == "REFER":
            actions.append(f"{r['label']}: send back for manual review — {r['summary']}")
        elif r["status"] == "WARNING":
            actions.append(f"{r['label']}: review the warning — {r['summary']}")
    if conflict:
        actions.insert(0, conflict_reason)

    return {
        "overall": overall,
        "counts": counts,
        "vendor_final_status": vendor_norm or None,
        "vendor_status_conflict": conflict,
        "conflict_reason": conflict_reason or None,
        "recommended_actions": actions,
    }
