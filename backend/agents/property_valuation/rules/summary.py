"""THE AGENT SUMMARY of one evaluation (pure): status, rule and severity counts, insights, risk factors, actions."""

from __future__ import annotations


def normalize_vendor_status(response: dict):
    """The vendor's Final Status, upper-cased (POSITIVE / NEGATIVE / REFER, any other value kept as sent)."""
    value = response.get("Final Status") or response.get("final_status") or response.get("Status") or response.get("status")
    if value is None:
        return None
    return str(value).strip().upper()


def build_agent_summary(evaluation: dict):
    triggered = [r for r in evaluation.get("results", []) if r.get("triggered")]
    severity_counts = {"CRITICAL": 0, "MAJOR": 0, "MINOR": 0}
    insights, actions = [], []
    risk_counts = {}

    for rule in triggered:
        severity = str(rule.get("severity", "MAJOR")).upper()
        discrepancies = rule.get("discrepancies") or []
        issue_count = max(1, len(discrepancies))
        severity_counts[severity] = severity_counts.get(severity, 0) + issue_count
        risk_counts[rule.get("rule_id", "OTHER")] = risk_counts.get(rule.get("rule_id", "OTHER"), 0) + issue_count
        for discrepancy in discrepancies:
            insights.append({
                "rule_id": rule.get("rule_id"),
                "rule_name": rule.get("rule_name"),
                "severity": severity,
                "field": discrepancy.get("field"),
                "issue": discrepancy.get("reason") or rule.get("issue"),
                "los_value": discrepancy.get("applicant_value"),
                "vendor_value": discrepancy.get("source_value"),
            })
        action = rule.get("recommended_action")
        if action and action not in actions:
            actions.append(action)

    if severity_counts["CRITICAL"]:
        status = "HIGH_RISK"
    elif triggered:
        status = "REVIEW"
    else:
        status = "CLEAR"

    risk_factors = [
        {"category": rule_id, "count": count}
        for rule_id, count in sorted(risk_counts.items())
    ]
    return {
        "agent_status": status,
        "total_rules_checked": evaluation.get("rules_checked", 0),
        "total_rules_passed": evaluation.get("rules_checked", 0) - len(triggered),
        "total_rules_triggered": len(triggered),
        "critical_issues_count": severity_counts["CRITICAL"],
        "major_issues_count": severity_counts["MAJOR"],
        "minor_issues_count": severity_counts["MINOR"],
        "key_insights": insights,
        "risk_factors": risk_factors,
        "recommended_actions": actions,
    }
