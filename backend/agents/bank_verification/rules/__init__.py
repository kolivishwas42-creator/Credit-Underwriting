"""The eight bank verification rules. R1-R7 read the Evidence; R8 sums up their results."""

from __future__ import annotations

from agents.bank_verification.rules import (account_ownership, balance_validation, bank_details,
                                                       duplicate_detection, risk_assessment, source_crosscheck,
                                                       statement_integrity, transaction_matching)
from agents.bank_verification.config import say, section
from agents.bank_verification.rules.base import Evidence, PriorDocument, result
from agents.bank_verification.schemas import RuleResult, RuleStatus

#: R1-R7, in order
CHECKS = (bank_details, transaction_matching, statement_integrity, account_ownership, balance_validation,
          source_crosscheck, duplicate_detection)


def enabled(rule_id: str) -> bool:
    """RULE ON / OFF (owner 2026-11-12): `rule_switches.<id>.enabled` in the rules in force; on unless set false.
    R8 sums the others up and is never switched off."""
    return (section("rule_switches").get(rule_id) or {}).get("enabled", True) is not False


def run_all(evidence: Evidence) -> list[RuleResult]:
    """All eight results, R1 to R8. A rule switched off is NOT_APPLICABLE (R8 and the decision leave it out)."""
    results = [rule.run(evidence) if enabled(rule.ID) else result(rule.ID, RuleStatus.NOT_APPLICABLE, say("common.rule_disabled"))
               for rule in CHECKS]
    return results + [risk_assessment.run(results)]


__all__ = ["CHECKS", "Evidence", "PriorDocument", "enabled", "run_all"]
