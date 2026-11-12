"""The engine's fixed policy (thresholds, reference lists) as one immutable value, built from conf/fraud_screening.yaml
by config.py. Pure: no file or environment access here."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping


@dataclass(frozen=True)
class Policy:
    name_match: float
    name_partial: float
    address_reuse: float
    address_min_chars: int
    dob_tolerance_years: int
    minor_below_years: int
    max_evidence: int
    rule15_address_chars: int
    rule16_address_chars: int
    severity_rank: Mapping[str, int]
    risk_levels: tuple[str, ...]
    escalate_medium_to_high_at: int
    family_relations: tuple[str, ...]
    place_stopwords: frozenset[str]
    pep_category_labels: Mapping[str, str]
    rule16_min_address_chars: int
    family_surname_min_chars: int
    family_surname_fields: tuple[str, ...]
    mobile_digits: int
    rule_defaults: Mapping[str, Mapping[str, Any]] = field(default_factory=dict)

    @classmethod
    def from_mapping(cls, data: Mapping[str, Any]) -> "Policy":
        """Build from the YAML mapping; a missing key raises KeyError naming it."""
        names, address, age = data["name_matching"], data["address_matching"], data["age"]
        evidence, risk = data["evidence"], data["risk"]
        return cls(
            name_match=float(names["match_threshold"]),
            name_partial=float(names["partial_threshold"]),
            address_reuse=float(address["reuse_threshold"]),
            address_min_chars=int(address["min_compare_chars"]),
            dob_tolerance_years=int(age["dob_tolerance_years"]),
            minor_below_years=int(age["minor_below_years"]),
            max_evidence=int(evidence["max_lines"]),
            rule15_address_chars=int(evidence["rule15_address_chars"]),
            rule16_address_chars=int(evidence["rule16_address_chars"]),
            severity_rank={str(k): int(v) for k, v in risk["severity_rank"].items()},
            risk_levels=tuple(str(x) for x in risk["levels"]),
            escalate_medium_to_high_at=int(risk["escalate_medium_to_high_at"]),
            family_relations=tuple(str(x).lower() for x in data["family_relations"]),
            place_stopwords=frozenset(str(x).lower() for x in data["place_stopwords"]),
            pep_category_labels={str(k): str(v) for k, v in data["pep"]["category_labels"].items()},
            rule16_min_address_chars=int(address["rule16_min_chars"]),
            family_surname_min_chars=int(address["family_surname_min_chars"]),
            family_surname_fields=tuple(str(x) for x in address["family_surname_fields"]),
            mobile_digits=int(data["identity"]["mobile_digits"]),
            rule_defaults={str(k): dict(v) for k, v in (data.get("rule_defaults") or {}).items()},
        )
