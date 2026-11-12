"""
The residence / office verification rule engine: ten rules over the vendor's response and the declared address.
Pure functions over plain data (no I/O, no configuration reads): the rule settings and the scoring settings are
passed in (Settings from conf/rules.yaml, or the database's rule-config rows).
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from agents.residence_office_verification.rules.address import addresses_match, clean_text


def _key_value(payload: dict[str, Any], key: str):
    """Case-insensitive key lookup while preserving vendor payload flexibility."""
    if not isinstance(payload, dict):
        return None
    for actual_key, value in payload.items():
        if str(actual_key).strip().casefold() == key.casefold():
            return value
    return None


def _truth(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if value is None:
        return None
    text = str(value).strip().casefold()
    if text in {"yes", "y", "true", "1", "positive", "confirmed", "visible", "found"}:
        return True
    if text in {"no", "n", "false", "0", "negative", "not confirmed", "not visible", "not found"}:
        return False
    return None


def _status(value: Any) -> str | None:
    text = clean_text(value)
    return text.casefold() if text else None


def _result(rule_key, cfg, status, summary, finding=None, details=None,
            risk_contribution=True):
    return {
        "rule_key": rule_key,
        "rule_id": cfg["rule_id"],
        "rule_name": cfg["name"],
        "enabled": True,
        "status": status,
        "criticality": cfg["criticality"].upper(),
        "triggered": status == "ISSUE",
        "summary": summary,
        "finding": finding,
        "details": details or {},
        "recommended_action": (
            "Review the finding and supporting evidence."
            if status == "ISSUE"
            else "No action required based on this rule."
            if status == "PASS"
            else "Obtain or confirm the missing information."
            if status == "PENDING"
            else "No evaluation required for this rule."
        ),
        "risk_contribution": risk_contribution,
        "weight": int(cfg.get("weight", 0)),
    }


def _make_rules(mode: str, rule_configs: dict[str, dict[str, Any]] | None,
                default_rules: dict[str, dict[str, dict[str, Any]]]):
    """Prefer DB-supplied configs; fall back to the defaults (conf/rules.yaml)."""
    if rule_configs is not None:
        return deepcopy(rule_configs)
    return deepcopy(default_rules[mode])


def evaluate_rules(
    vendor_response: dict[str, Any],
    declared_address: str | None,
    verification_type: str = "RESIDENCE",
    rule_configs: dict[str, dict[str, Any]] | None = None,
    *,
    default_rules: dict[str, dict[str, dict[str, Any]]],
    scoring: dict[str, Any],
) -> dict[str, Any]:
    """
    Execute the enabled rules for RESIDENCE or OFFICE mode.
    When rule_configs is provided (loaded from DB), those settings are used;
    otherwise the defaults (default_rules[mode], conf/rules.yaml) are used.
    scoring: {"criticality_order": {...}, "risk_score_enabled": bool, "risk_score_max": int}.
    """
    mode = (verification_type or "RESIDENCE").upper()
    if mode not in ("RESIDENCE", "OFFICE") and mode not in default_rules:
        raise ValueError("verification_type must be RESIDENCE or OFFICE")

    cfgs = _make_rules(mode, rule_configs, default_rules)
    v = vendor_response if isinstance(vendor_response, dict) else {}
    results = []

    # Rule 1: vendor status is independent of final_status.
    key, cfg = "RULE_01", cfgs["RULE_01"]
    raw = _key_value(v, "status")
    s = _status(raw)
    if s in {"positive", "pass", "passed", "verified"}:
        results.append(_result(key, cfg, "PASS", "A real check confirmed that their business address is real and active.",
                               details={"vendor_status": raw}))
    elif s in {"negative", "fail", "failed", "unverified", "not verified"}:
        results.append(_result(key, cfg, "ISSUE", "Vendor reported a negative verification status.",
                               finding="Vendor status is negative.", details={"vendor_status": raw}))
    else:
        results.append(_result(key, cfg, "PENDING", "Vendor verification status is missing or unrecognized.",
                               details={"vendor_status": raw}))

    # Rule 2: neighbour confirmation.
    key, cfg = "RULE_02", cfgs["RULE_02"]
    raw = _key_value(v, "neighbour_check")
    truth = _truth(raw)
    if truth is True:
        results.append(_result(key, cfg, "PASS", "Neighbour gave a positive review about the apllicant.",
                               details={"neighbour_check": raw}))
    elif truth is False:
        results.append(_result(key, cfg, "ISSUE", "Neighbour did not confirm the apllicant resides at the same address.",
                               finding="Neighbour confirmation is negative.", details={"neighbour_check": raw}))
    else:
        results.append(_result(key, cfg, "PENDING", "Neighbour confirmation is missing or unclear.",
                               details={"neighbour_check": raw}))

    # Rule 3: whether the declared address was confirmed.
    key, cfg = "RULE_03", cfgs["RULE_03"]
    raw = _key_value(v, "address_confirmed")
    truth = _truth(raw)
    if truth is True:
        results.append(_result(key, cfg, "PASS", "Vendor confirmed the declared address matches the address from the documents.",
                               details={"address_confirmed": raw}))
    elif truth is False:
        results.append(_result(key, cfg, "ISSUE", "Vendor did not confirm the declared address matches the address from the documents.",
                               finding="Declared address was not confirmed.", details={"address_confirmed": raw}))
    else:
        results.append(_result(key, cfg, "PENDING", "Address confirmation is missing or unclear.",
                               details={"address_confirmed": raw}))

    # Rule 4: vendor-reported negative area flag.
    key, cfg = "RULE_04", cfgs["RULE_04"]
    raw = _key_value(v, "negative_area")
    truth = _truth(raw)
    if truth is True:
        results.append(_result(key, cfg, "ISSUE", "Vendor flagged the area as negative area.",
                               finding="Negative area check was triggered.", details={"negative_area": raw}))
    elif truth is False:
        results.append(_result(key, cfg, "PASS", "Vendor flagged the area as not negative.",
                               details={"negative_area": raw}))
    else:
        results.append(_result(key, cfg, "PENDING", "Negative-area information is missing or unclear.",
                               details={"negative_area": raw}))

    # Rule 5: only use the vendor's explicit flag. Never infer from identity.
    key, cfg = "RULE_05", cfgs["RULE_05"]
    raw = _key_value(v, "political_link")
    truth = _truth(raw)
    if truth is True:
        results.append(_result(key, cfg, "ISSUE", "Vendor explicitly reported a political link; review evidence.",
                               finding="Vendor-reported political link requires compliance review.",
                               details={"political_link": raw}))
    elif truth is False:
        results.append(_result(key, cfg, "PASS", "Vendor did not report a political link of the applicant.",
                               details={"political_link": raw}))
    else:
        results.append(_result(key, cfg, "PENDING", "Political-link information is missing or unclear.",
                               details={"political_link": raw}))

    # Rule 6: name plate visibility.
    key, cfg = "RULE_06", cfgs["RULE_06"]
    raw = _key_value(v, "name_plate_visible")
    truth = _truth(raw)
    if truth is True:
        results.append(_result(key, cfg, "PASS", "Name plate was available/visible at the site visit.",
                               details={"name_plate_visible": raw}))
    elif truth is False:
        results.append(_result(key, cfg, "ISSUE", "Name plate was not available/visible during verification visit.",
                               finding="Name plate was not visible.", details={"name_plate_visible": raw}))
    else:
        results.append(_result(key, cfg, "PENDING", "Name-plate visibility is missing or unclear.",
                               details={"name_plate_visible": raw}))

    # Rule 7: context only; cannot independently affect the overall recommendation or score.
    key, cfg = "RULE_07", cfgs["RULE_07"]
    raw = _key_value(v, "community_dominated")
    truth = _truth(raw)
    if truth is True:
        results.append(_result(
            key, cfg, "ISSUE",
            "Vendor reported a community-dominated area. This is contextual information only.",
            finding="Context recorded for compliance review; not a standalone risk or rejection reason.",
            details={"community_dominated": raw},
            risk_contribution=False,
        ))
        results[-1]["recommended_action"] = (
            "Record as context only. Do not increase risk or reject an application based on this field alone."
        )
    elif truth is False:
        results.append(_result(key, cfg, "PASS", "Vendor did not report a community-dominated area.",
                               details={"community_dominated": raw}, risk_contribution=False))
    else:
        results.append(_result(key, cfg, "PENDING", "Community-context information is missing or unclear.",
                               details={"community_dominated": raw}, risk_contribution=False))

    # Rule 8: independent comparison of corrected address vs declared database address.
    key, cfg = "RULE_08", cfgs["RULE_08"]
    corrected = _key_value(v, "corrected_address")
    match = addresses_match(declared_address, corrected)
    if clean_text(corrected) is None:
        results.append(_result(
            key, cfg, "NOT_APPLICABLE",
            "No corrected address was supplied; corrected-address comparison was not applicable.",
            details={"declared_address": declared_address, "corrected_address": corrected},
        ))
    elif match is True:
        results.append(_result(
            key, cfg, "PASS", "Corrected address matches the declared database address after normalization.",
            details={"declared_address": declared_address, "corrected_address": corrected},
        ))
    elif match is False:
        results.append(_result(
            key, cfg, "ISSUE", "Corrected address differs from the declared database address.",
            finding="Corrected address mismatch.",
            details={"declared_address": declared_address, "corrected_address": corrected},
        ))
    else:
        results.append(_result(
            key, cfg, "PENDING", "Address comparison cannot be completed because an address is missing.",
            details={"declared_address": declared_address, "corrected_address": corrected},
        ))

    # Rule 9: final status. Waived is explicitly not treated as PASS.
    key, cfg = "RULE_09", cfgs["RULE_09"]
    raw = _key_value(v, "final_status")
    s = _status(raw)
    if s == "approved":
        results.append(_result(key, cfg, "PASS", "Vendor final status is Approved.",
                               details={"final_status": raw}))
    elif s == "rejected":
        results.append(_result(key, cfg, "ISSUE", "Vendor final status is Rejected.",
                               finding="Vendor final status is Rejected.", details={"final_status": raw}))
    elif s == "waived":
        results.append(_result(
            key, cfg, "PENDING", "Vendor final status is Waived; waiver is not treated as successful verification.",
            finding="Waiver requires review or confirmation under the lender's policy.",
            details={"final_status": raw},
        ))
    elif s == "pending":
        results.append(_result(key, cfg, "PENDING", "Vendor final status is Pending.",
                               details={"final_status": raw}))
    else:
        results.append(_result(key, cfg, "PENDING", "Vendor final status is missing or unrecognized.",
                               details={"final_status": raw}))

    # Rule 10: cross-check independent vendor status, final status, and findings.
    key, cfg = "RULE_10", cfgs["RULE_10"]
    vendor_status = _status(_key_value(v, "status"))
    final_status = _status(_key_value(v, "final_status"))
    issues = [r for r in results if r["status"] == "ISSUE" and r["rule_key"] != "RULE_07"]
    contradictions = []
    if vendor_status in {"positive", "pass", "passed", "verified"} and final_status == "rejected":
        contradictions.append("status is positive while final_status is Rejected")
    if vendor_status in {"negative", "fail", "failed", "unverified", "not verified"} and final_status == "approved":
        contradictions.append("status is negative while final_status is Approved")
    if final_status == "approved" and issues:
        contradictions.append("final_status is Approved while one or more verification rules have findings")
    if contradictions:
        results.append(_result(
            key, cfg, "ISSUE", "Vendor status, final status, and rule findings are inconsistent.",
            finding="; ".join(contradictions),
            details={"contradictions": contradictions, "issue_rule_ids": [r["rule_id"] for r in issues]},
        ))
    elif vendor_status is None or final_status is None:
        results.append(_result(key, cfg, "PENDING", "Consistency cannot be fully assessed until both statuses are supplied.",
                               details={"vendor_status": _key_value(v, "status"),
                                        "final_status": _key_value(v, "final_status")}))
    else:
        results.append(_result(key, cfg, "PASS", "No direct contradiction was detected between statuses and rule findings.",
                               details={"vendor_status": _key_value(v, "status"),
                                        "final_status": _key_value(v, "final_status")}))

    # Drop disabled rules, then apply configured IDs/names/criticality.
    enabled_results = []
    for result in results:
        rule_cfg = cfgs[result["rule_key"]]
        if not rule_cfg.get("enabled", True):
            continue
        result["enabled"] = True
        result["criticality"] = str(rule_cfg.get("criticality", result["criticality"])).upper()
        result["weight"] = int(rule_cfg.get("weight", result["weight"]))
        enabled_results.append(result)

    enabled_results.sort(key=lambda r: (
        scoring["criticality_order"].get(r["criticality"], 99),
        0 if r["status"] == "ISSUE" else 1 if r["status"] == "PENDING" else 2,
        r["rule_id"],
    ))

    relevant_issues = [
        r for r in enabled_results
        if r["status"] == "ISSUE" and r.get("risk_contribution", True)
    ]
    pending = [r for r in enabled_results if r["status"] == "PENDING"]
    if any(r["criticality"] in {"CRITICAL", "HIGH"} for r in relevant_issues):
        recommendation = "REFER"
    elif relevant_issues:
        recommendation = "REVIEW"
    elif pending:
        recommendation = "PENDING"
    else:
        recommendation = "PASS"

    score = None
    if scoring["risk_score_enabled"]:
        raw_score = sum(
            r.get("weight", 0)
            for r in enabled_results
            if r["status"] == "ISSUE" and r.get("risk_contribution", True)
        )
        score = min(scoring["risk_score_max"], max(0, raw_score))

    triggered = [r for r in enabled_results if r["status"] == "ISSUE"]
    summary = (
        f"{len(enabled_results)} enabled rule(s) evaluated; "
        f"{len(triggered)} issue(s), {len(pending)} pending rule(s). "
        f"Overall recommendation: {recommendation}."
    )

    return {
        "verification_type": mode,
        "overall_recommendation": recommendation,
        "overall_criticality": (
            "CRITICAL" if any(r["criticality"] == "CRITICAL" for r in relevant_issues)
            else "HIGH" if any(r["criticality"] == "HIGH" for r in relevant_issues)
            else "MEDIUM" if any(r["criticality"] == "MEDIUM" for r in relevant_issues)
            else "LOW" if relevant_issues
            else "PENDING" if pending
            else "NONE"
        ),
        "risk_score": score,
        "summary": summary,
        "rules_evaluated": len(enabled_results),
        "rules_triggered": len(triggered),
        "insights": [
            {
                "rule_id": r["rule_id"],
                "rule_name": r["rule_name"],
                "status": r["status"],
                "criticality": r["criticality"],
                "finding": r["finding"],
                "summary": r["summary"],
            }
            for r in enabled_results
            if r["status"] in {"ISSUE", "PENDING"}
        ],
        "rules": enabled_results,
    }
