"""
The rule engine: Input ITR vs Output ITR (and optionally the loan application's values and the vendor's final
status) -> per-field results, a weighted score, a decision (ACCEPT | REVIEW | REJECT) and the mismatches.

Pure functions over plain dicts and a Policy; no I/O.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from difflib import SequenceMatcher
from typing import Any, Dict, List, Optional

from .policy import Policy


@dataclass
class FieldResult:
    field: str
    input_value: Any
    output_value: Any
    matched: bool
    score: float                # 0 or 100 for exact; 0-100 for fuzzy/tolerance
    weight: float
    weighted_score: float
    severity: str
    description: str
    message: str


@dataclass
class ComparisonReport:
    overall_score: float
    decision: str               # ACCEPT | REVIEW | REJECT
    field_results: List[FieldResult] = field(default_factory=list)
    mismatches: List[Dict[str, Any]] = field(default_factory=list)
    critical_failures: List[str] = field(default_factory=list)
    summary: str = ""
    vendor_final_status: str = "NOT_PROVIDED"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "overall_score": round(self.overall_score, 2),
            "decision": self.decision,
            "summary": self.summary,
            "vendor_final_status": self.vendor_final_status,
            "critical_failures": self.critical_failures,
            "mismatches": self.mismatches,
            "field_results": [asdict(fr) for fr in self.field_results],
        }


# ------------------------------------------------------------------------------------------------- match helpers
def exact_match(a: Any, b: Any) -> bool:
    if a is None or b is None:
        return False
    return str(a).strip().upper() == str(b).strip().upper()


def numeric_match(a: Any, b: Any, tolerance_pct: float) -> tuple[bool, float]:
    """(matched, score 0-100)."""
    try:
        fa, fb = float(a), float(b)
    except (TypeError, ValueError):
        return False, 0.0
    if fa == fb:
        return True, 100.0
    if fa == 0 and fb == 0:
        return True, 100.0
    diff_pct = abs(fa - fb) / max(abs(fa), abs(fb)) * 100.0
    if diff_pct <= tolerance_pct:
        return True, 100.0
    # hard fail when zero tolerance is configured (typical for income verification)
    if tolerance_pct <= 0:
        return False, 0.0
    # soft partial credit only when an explicit tolerance band is allowed
    return False, max(0.0, 100.0 - diff_pct * 2)


def fuzzy_match(a: Any, b: Any, threshold: float) -> tuple[bool, float]:
    if a is None or b is None:
        return False, 0.0
    ratio = SequenceMatcher(None, str(a).upper(), str(b).upper()).ratio()
    return ratio >= threshold, ratio * 100.0


def normalise_assessment_year(value: Any) -> Optional[str]:
    """AY values such as 2024-25 and 2024-2025 as YYYY-YY (None when not a valid consecutive-year AY)."""
    if value is None or not str(value).strip():
        return None
    text = str(value).strip().replace("–", "-").replace("—", "-")
    match = re.fullmatch(r"(20\d{2})\s*[-/]\s*(?:(20)?(\d{2}))", text)
    if not match:
        return None
    start_year = int(match.group(1))
    end_year = (start_year // 100) * 100 + int(match.group(3))
    if end_year < start_year:
        end_year += 100
    if end_year != start_year + 1:
        return None
    return f"{start_year}-{str(end_year)[-2:]}"


def _is_missing(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def _application_document_value(fields: Dict[str, Any], document_field: str) -> Any:
    value = fields.get(document_field)
    if value is None and document_field == "gti":
        value = fields.get("total_income")
    return value


# ---------------------------------------------------------------------------------------------------- the engine
def compare_documents(
    input_fields: Dict[str, Any],
    output_fields: Dict[str, Any],
    policy: Policy,
    application_data: Optional[Dict[str, Any]] = None,
    final_status: Optional[str] = None,
) -> ComparisonReport:
    """Compare the two ITRs, optional application values, and the vendor decision."""
    results: List[FieldResult] = []
    total_weight = 0.0
    earned_weight = 0.0
    critical_failures: List[str] = []
    mismatches: List[Dict[str, Any]] = []
    application_critical_mismatch = False
    vendor_force_reject = False
    vendor_force_review = False
    vendor_status_result = "NOT_PROVIDED"

    # document-to-document rules
    for rule in policy.comparison_rules:
        if not rule.get("enabled", True):
            continue

        field_name = rule["field"]
        weight = float(rule.get("weight", 0))
        match_type = rule.get("match_type", "exact")
        tolerance = float(rule.get("tolerance_pct", 0.0))
        severity = rule.get("severity_if_mismatch", "medium")
        description = rule.get("description", "")
        input_value = input_fields.get(field_name)
        output_value = output_fields.get(field_name)

        if input_value is None and output_value is None:
            matched, score = True, 100.0
            message = "Both sides missing – treated as match"
        elif input_value is None or output_value is None:
            matched, score = False, 0.0
            message = f"Missing on {'input' if input_value is None else 'output'} side"
        elif match_type == "numeric_tolerance":
            matched, score = numeric_match(input_value, output_value, tolerance)
            message = "Match" if matched else f"Mismatch: input={input_value!r} vs output={output_value!r}"
        elif match_type == "fuzzy":
            threshold = tolerance if 0 < tolerance <= 1 else policy.fuzzy_name_threshold
            matched, score = fuzzy_match(input_value, output_value, threshold)
            message = "Match" if matched else f"Mismatch: input={input_value!r} vs output={output_value!r}"
        elif match_type == "normalized" and field_name == "assessment_year":
            in_norm = normalise_assessment_year(input_value)
            out_norm = normalise_assessment_year(output_value)
            matched = in_norm is not None and in_norm == out_norm
            score = 100.0 if matched else 0.0
            message = "Match" if matched else f"Mismatch: input={input_value!r} vs output={output_value!r}"
        else:
            matched = exact_match(input_value, output_value)
            score = 100.0 if matched else 0.0
            message = "Match" if matched else f"Mismatch: input={input_value!r} vs output={output_value!r}"

        weighted_score = (score / 100.0) * weight
        total_weight += weight
        earned_weight += weighted_score
        results.append(FieldResult(
            field=field_name, input_value=input_value, output_value=output_value, matched=matched,
            score=round(score, 2), weight=weight, weighted_score=round(weighted_score, 2),
            severity=severity if not matched else "none", description=description, message=message,
        ))
        if not matched:
            mismatches.append({"field": field_name, "input": input_value, "output": output_value,
                               "severity": severity, "message": message})
            if severity.casefold() == "critical":
                critical_failures.append(field_name)

    # Application values are checked against each document separately. Only when application_data is supplied;
    # missing keys within it become NOT VERIFIED results instead of being silently skipped.
    if application_data is not None:
        application_data = dict(application_data)
        if final_status is None:
            final_status = application_data.get("final_status")

        for app_key, rule in policy.application_rules.items():
            if not rule.get("enabled", True):
                continue
            app_value = application_data.get(app_key)
            document_field = rule["document_field"]
            severity = str(rule.get("severity", "high")).casefold()
            weight = float(rule.get("weight", 0))
            tolerance = float(rule.get("tolerance_pct", 0.0))

            for side, document_fields in (("input", input_fields), ("output", output_fields)):
                document_value = _application_document_value(document_fields, document_field)
                result_field = f"application_{app_key}_vs_{side}_document"

                if _is_missing(app_value) or _is_missing(document_value):
                    matched, score = False, 0.0
                    missing_side = ("application value" if _is_missing(app_value)
                                    else f"{side} document field '{document_field}'")
                    message = f"NOT VERIFIED: {missing_side} is missing"
                elif rule.get("match_type") == "numeric":
                    matched, score = numeric_match(app_value, document_value, tolerance)
                    message = "Match" if matched else (
                        f"Application GTI {app_value!r} differs from {side} document value {document_value!r}")
                elif rule.get("match_type") == "normalized" and app_key == "assessment_year":
                    app_normalized = normalise_assessment_year(app_value)
                    doc_normalized = normalise_assessment_year(document_value)
                    matched = app_normalized is not None and app_normalized == doc_normalized
                    score = 100.0 if matched else 0.0
                    message = "Match" if matched else (
                        f"Application assessment year {app_value!r} differs from {side} document value "
                        f"{document_value!r}")
                elif app_key == "pan_number":
                    app_normalized = str(app_value).strip().upper()
                    doc_normalized = str(document_value).strip().upper()
                    matched = bool(app_normalized) and app_normalized == doc_normalized
                    score = 100.0 if matched else 0.0
                    message = "Match" if matched else (
                        f"Application PAN {app_value!r} differs from {side} document value {document_value!r}")
                else:
                    matched = exact_match(app_value, document_value)
                    score = 100.0 if matched else 0.0
                    message = "Match" if matched else "Application value does not match document value"

                weighted_score = (score / 100.0) * weight
                total_weight += weight
                earned_weight += weighted_score
                results.append(FieldResult(
                    field=result_field, input_value=app_value, output_value=document_value, matched=matched,
                    score=round(score, 2), weight=weight, weighted_score=round(weighted_score, 2),
                    severity=severity if not matched else "none", description=rule.get("label", result_field),
                    message=message,
                ))
                if not matched:
                    mismatches.append({"field": result_field, "input": app_value, "output": document_value,
                                       "severity": severity, "message": message})
                    if severity == "critical":
                        critical_failures.append(result_field)
                        application_critical_mismatch = True

        # the vendor-selected final_status is independent of the document text
        raw_status = "" if final_status is None else str(final_status).strip()
        status_norm = raw_status.casefold()
        approved_values = {str(v).strip().casefold() for v in policy.final_status_approved_values}
        rejected_values = {str(v).strip().casefold() for v in policy.final_status_rejected_values}
        unknown_behaviour = str(policy.final_status_unknown_behaviour).strip().casefold()

        if status_norm and status_norm in approved_values:
            vendor_status_result = "APPROVED"
            status_matched = True
            status_severity = "none"
            status_message = f"Vendor final_status '{raw_status}' is approved"
        elif status_norm and status_norm in rejected_values:
            vendor_status_result = "REJECTED"
            status_matched = False
            status_severity = "critical"
            status_message = f"CRITICAL: Vendor final_status '{raw_status}' is rejected"
            vendor_force_reject = bool(policy.vendor_rejection_forces_reject)
        else:
            vendor_status_result = "UNKNOWN"
            status_matched = False
            status_message = ("Vendor final_status is missing" if not status_norm
                              else f"Vendor final_status '{raw_status}' is not recognized by configuration")
            if unknown_behaviour == "ignore":
                status_severity = "none"
                status_message += " (configured to ignore)"
            elif unknown_behaviour == "review":
                status_severity = "medium"
                vendor_force_review = True
                status_message += " (manual review required)"
            else:
                status_severity = "critical"
                vendor_force_reject = True

        results.insert(0, FieldResult(
            field="vendor_final_status", input_value=raw_status or None, output_value=vendor_status_result,
            matched=status_matched, score=100.0 if status_matched else 0.0, weight=0.0, weighted_score=0.0,
            severity=status_severity, description="Critical vendor verification decision", message=status_message,
        ))
        if not status_matched and status_severity != "none":
            mismatches.insert(0, {"field": "vendor_final_status", "input": raw_status or None,
                                  "output": vendor_status_result, "severity": status_severity,
                                  "message": status_message})
            if status_severity == "critical":
                critical_failures.insert(0, "vendor_final_status")

    # overall weighted score; the vendor status has weight zero and does not distort it
    overall = (earned_weight / total_weight * 100.0) if total_weight > 0 else 0.0
    if overall >= policy.accept_threshold:
        decision = "ACCEPT"
    elif overall >= policy.review_threshold:
        decision = "REVIEW"
    else:
        decision = "REJECT"

    if application_data is not None and application_critical_mismatch \
            and policy.critical_application_mismatch_forces_reject:
        decision = "REJECT"
    elif vendor_force_reject:
        decision = "REJECT"
    elif vendor_force_review and decision == "ACCEPT":
        decision = "REVIEW"
    elif policy.critical_blocks_accept and critical_failures and decision == "ACCEPT":
        decision = "REVIEW"

    if decision == "ACCEPT":
        summary = f"Documents match with score {overall:.1f}%. No blocking verification issues found."
    elif decision == "REVIEW":
        summary = (f"Score {overall:.1f}% – manual review required. Issues: "
                   f"{', '.join(m['field'] for m in mismatches) or 'none'}")
    else:
        summary = (f"Score {overall:.1f}% – verification rejected. Critical issues: "
                   f"{', '.join(critical_failures) or 'score below threshold'}")

    return ComparisonReport(overall_score=overall, decision=decision, field_results=results, mismatches=mismatches,
                            critical_failures=critical_failures, summary=summary,
                            vendor_final_status=vendor_status_result)


__all__ = ["ComparisonReport", "FieldResult", "compare_documents", "exact_match", "fuzzy_match",
           "normalise_assessment_year", "numeric_match"]
