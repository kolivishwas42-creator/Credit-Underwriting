"""Synthetic test data and in-memory fakes (no database, no network). Every name and number is invented."""

from __future__ import annotations

import copy
from datetime import date
from typing import Any, Dict, List, Optional

from agents.fraud_screening.config import load_settings
from agents.fraud_screening.rules.identity import _D, _P

SETTINGS = load_settings({})          # conf/fraud_screening.yaml, no environment overrides
POLICY = SETTINGS.policy

_INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9]


def aadhaar(body11: str) -> str:
    """A 12-digit number with a valid Verhoeff check digit."""
    c = 0
    for i, ch in enumerate(reversed(body11)):
        c = _D[c][_P[(i + 1) % 8][int(ch)]]
    return body11 + str(_INV[c])


# (rule_id, severity, enabled, is_implementable, config_json) -- the seed of db/schema.py after migration 0004
_SEED = {
    "Rule1_PAN_Aadhaar_Mismatch": ("Rule 1", "High", True, True, {}),
    "Rule1_CoApp_PAN_Aadhaar_Mismatch": ("Rule 1", "High", True, True, {}),
    "Rule2_CoApp_Identity_Swap": ("Rule 2", "High", True, True, {}),
    "Rule3_Distant_Branch": ("Rule 3", "Medium", False, False, {"distance_km": 5}),
    "Rule4_Name_Age_Tweak": ("Rule 4", "Medium", True, True, {"age_diff_years": 5, "name_similarity": 0.85,
                                                               "history_age_diff_years": 1}),
    "Rule5_Dual_Identity_Mismatch": ("Rule 5", "Critical", True, True, {"include_same_customer": True}),
    "Rule6_Shared_Bank_Account": ("Rule 6", "Critical", True, True, {}),
    "Rule6_CoApp_Shared_Bank_Account": ("Rule 6", "Critical", True, True, {}),
    "Rule7_Income_Inflation": ("Rule 7", "High", False, False, {"ratio": 1.5}),
    "Rule8_Low_Credit_Score": ("Rule 8", "Medium", False, False, {"min_score": 550}),
    "Rule9_Age_DOB_Mismatch": ("Rule 9", "High", True, True, {"age_dob_tolerance_years": 1}),
    "Rule9_DOB_Conflict": ("Rule 9", "Critical", True, True, {}),
    "Rule11_Doc_Mismatch": ("Rule 11", "High", False, False, {}),
    "Rule12_Duplicate_Identity": ("Rule 12", "Critical", True, True, {}),
    "Rule13_Synthetic_Identity": ("Rule 13", "High", True, True, {}),
    "Rule14_Device_Fraud": ("Rule 14", "Medium", False, False, {}),
    "Rule15_Address_Reuse": ("Rule 15", "Low", True, True, {}),
    "Rule16_Relationship_Fraud": ("Rule 16", "Medium", True, True, {"address_match_threshold": 0.95,
                                                                        "ignore_family_relation": False}),
}


def rule_config() -> Dict[str, dict]:
    return {key: {"rule_key": key, "rule_id": rid, "rule_name": key.split("_", 1)[1].replace("_", " "),
                  "description": f"{key} description", "severity": sev, "enabled": en, "is_implementable": impl,
                  "config_json": dict(cfg), "sort_order": i}
            for i, (key, (rid, sev, en, impl, cfg)) in enumerate(_SEED.items())}


PRIMARY_AADHAAR = aadhaar("23456789012")
CO_AADHAAR = aadhaar("34567890123")


def person(pid: int, customer_id: int, first: str, last: str, dob: date, *, pan: str, aadhaar_no: str,
           address: str, account: Optional[str], relation: Optional[str] = None, age: Optional[int] = None) -> dict:
    return {
        "participant": {"participant_id": pid, "customer_id": customer_id, "is_primary": relation is None},
        "details": {"type": "individual", "first_name": first, "middle_name": None, "last_name": last,
                    "date_of_birth": dob, "age": age, "relation_with_applicant": relation},
        "kyc": {"pan_number": pan, "aadhaar_number": aadhaar_no, "first_name": first, "last_name": last,
                "date_of_birth": dob},
        "addresses": [{"full_address": address}],
        "bank_accounts": [{"account_number": account}] if account else [],
    }


def clean_bundle() -> dict:
    """An application whose primary and co-applicant pass every rule."""
    return {
        "application": {"application_id": 501, "application_number": "TEST-APP-0001", "customer_id": 9001},
        "customer": {"customer_id": 9001, "full_name": "Asha Testwala"},
        "primary": person(1, 9001, "Asha", "Testwala", date(1988, 3, 14), pan="ABCDE1234F",
                          aadhaar_no=PRIMARY_AADHAAR, address="12 Sample Street, Demo Nagar, Testpur 400001",
                          account="123456789012"),
        "co_applicants": [person(2, 9002, "Vikram", "Fictional", date(1985, 7, 2), pan="PQRST6789K",
                                 aadhaar_no=CO_AADHAAR, address="77 Other Lane, Mock Colony, Fakeville 560002",
                                 account="998877665544", relation="spouse")],
        "sourcing": None,
        "collateral": [],
    }


class FakeRepository:
    def __init__(self, rules: Optional[Dict[str, dict]] = None):
        self.rules = rules if rules is not None else rule_config()
        self.results: List[dict] = []

    def load_rule_config(self) -> Dict[str, dict]:
        return copy.deepcopy(self.rules)

    def list_rules(self) -> List[dict]:
        return [copy.deepcopy(r) for r in sorted(self.rules.values(), key=lambda r: (r["sort_order"], r["rule_key"]))]

    def get_rule(self, rule_key: str) -> Optional[dict]:
        return copy.deepcopy(self.rules.get(rule_key))

    def update_rule(self, rule_key: str, changes: Dict[str, Any]) -> dict:
        self.rules[rule_key].update(changes)
        return copy.deepcopy(self.rules[rule_key])

    def save_result(self, payload: Dict[str, Any]) -> int:
        self.results.append(payload)
        return len(self.results)

    def latest_result(self, application_number: str) -> Optional[dict]:
        found = [r for r in self.results if r["application_number"] == application_number]
        return found[-1] if found else None


class FakeApplications:
    def __init__(self, bundle: Optional[dict] = None, identity=None, banks=None, addresses=None, participants=None,
                 coapplicant_pans=None):
        self.bundle = bundle if bundle is not None else clean_bundle()
        self.identity, self.banks, self.addresses = identity or [], banks or [], addresses or []
        self.participants, self.coapplicant_pans = participants or [], coapplicant_pans or []

    def application_bundle(self, application_number: str) -> Optional[dict]:
        app = (self.bundle or {}).get("application") or {}
        return self.bundle if app.get("application_number") == application_number else None

    def historical_identity(self, exclude_application_id):
        return self.identity

    def historical_bank_accounts(self, exclude_application_id):
        return self.banks

    def historical_addresses(self, exclude_application_id):
        return self.addresses

    def historical_participants(self, exclude_application_id):
        return self.participants

    def historical_coapplicant_pans(self, exclude_application_id):
        return self.coapplicant_pans


class FakeWatchlist:
    """Returns fixed replies; `fail` makes the call raise like an unreachable vendor."""

    def __init__(self, aml_reply: Any = None, pep_reply: Any = None, fail: bool = False):
        self.aml_reply = aml_reply if aml_reply is not None else {"requestId": "r-aml", "result": []}
        self.pep_reply = pep_reply if pep_reply is not None else {"requestId": "r-pep", "result": {"civilOfficer": []}}
        self.fail = fail
        self.calls: List[str] = []

    def aml(self, applicant):
        self.calls.append("aml")
        if self.fail:
            raise RuntimeError("vendor unreachable")
        return self.aml_reply, "vendor"

    def pep(self, applicant):
        self.calls.append("pep")
        if self.fail:
            raise RuntimeError("vendor unreachable")
        return self.pep_reply, "vendor"
