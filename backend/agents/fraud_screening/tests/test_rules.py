"""The identity helpers and the rule engine (pure; synthetic data)."""

from __future__ import annotations

import copy
from datetime import date, datetime

from agents.fraud_screening.rules import engine
from agents.fraud_screening.rules import identity as ids
from agents.fraud_screening.tests.fakes import CO_AADHAAR, POLICY, PRIMARY_AADHAAR, clean_bundle, rule_config


def _row(result, key):
    return next(r for r in result["rule_results"] if r["rule_key"] == key)


def _run(bundle, rules=None, identity=None, banks=None, addresses=None):
    return engine.evaluate(bundle, rules or rule_config(), identity or [], banks or [], addresses or [], POLICY)


# ---- identity helpers ----------------------------------------------------------------------------------------------
def test_pan_and_aadhaar_issues():
    assert ids.pan_issue("ABCDE1234F") == ""
    assert ids.pan_issue("ABCD1234F") == "PAN 'ABCD1234F' does not match AAAAA9999A"
    assert ids.pan_issue("XXXXX1234X") == ""                       # masked: not checkable
    assert ids.pan_issue(None) == "" and ids.pan_issue(float("nan")) == ""
    assert ids.aadhaar_issue(PRIMARY_AADHAAR) == ""
    bad = PRIMARY_AADHAAR[:-1] + str((int(PRIMARY_AADHAAR[-1]) + 1) % 10)
    assert "fails Verhoeff checksum" in ids.aadhaar_issue(bad)
    assert ids.aadhaar_issue("12345") == "Aadhaar '12345' is not 12 digits"
    assert ids.aadhaar_issue("XXXX XXXX 1234") == ""


def test_name_similarity_is_token_order_independent():
    assert ids.name_similarity("Asha Testwala", "TESTWALA asha") == 1.0
    assert ids.name_similarity("", "Asha") == 0.0
    assert ids.names_match("Asha Testwala", "Asha Testwalla", POLICY.name_match)
    assert not ids.names_match("Asha Testwala", "Vikram Fictional", POLICY.name_match)


def test_parse_dob_standard_library():
    assert ids.parse_dob(date(1990, 5, 17)) == date(1990, 5, 17)
    assert ids.parse_dob(datetime(1990, 5, 17, 13, 5)) == date(1990, 5, 17)
    assert ids.parse_dob("1990-05-17") == date(1990, 5, 17)
    assert ids.parse_dob("1990-05-17 00:00:00") == date(1990, 5, 17)
    assert ids.parse_dob("17-09-1950") == date(1950, 9, 17)      # day first only when the month cannot be 17
    assert ids.parse_dob("05-09-1950") == date(1950, 5, 9)       # ambiguous -> month first, as pandas read it
    assert ids.parse_dob("17 Sep 1950") == date(1950, 9, 17)
    for missing in (None, "", "   ", "not a date", float("nan")):
        assert ids.parse_dob(missing) is None


def test_calculate_age_and_tolerance():
    assert ids.calculate_age(date(1990, 6, 1), ref_date=date(2020, 5, 31)) == 29
    assert ids.calculate_age(date(1990, 6, 1), ref_date="2020-06-01") == 30
    assert ids.verify_age_dob_match(31, date(1990, 6, 1), ref_date=date(2020, 6, 1), tolerance=1)
    assert not ids.verify_age_dob_match(33, date(1990, 6, 1), ref_date=date(2020, 6, 1), tolerance=1)
    assert ids.verify_age_dob_match(None, date(1990, 6, 1))


def test_identity_indexes_find_conflicts():
    history = [{"application_id": 7, "customer_id": 77, "Name": "Someone Else", "Aadhaar_Number": PRIMARY_AADHAAR,
                "PAN_Number": "ABCDE1234F", "DOB": "1979-01-01"}]
    index = ids.build_identity_index(history)
    conflicts = ids.dual_identity_conflicts(PRIMARY_AADHAAR, "ABCDE1234F", "Asha Testwala", index, POLICY.name_match,
                                            current_customer_id=9001)
    assert len(conflicts) == 2 and conflicts[0].startswith("Aadhaar matches prior application_id=7")
    assert ids.dual_identity_conflicts(PRIMARY_AADHAAR, None, "Asha", index, POLICY.name_match,
                                       current_customer_id=77) == []
    dob_index = ids.build_dob_index(history)
    assert ids.dob_consistency_conflicts(None, "ABCDE1234F", date(1988, 3, 14), dob_index) == [
        "PAN=ABCDE1234F current DOB=1988-03-14 but history has DOB(s) 1979-01-01"]


# ---- engine ----------------------------------------------------------------------------------------------------------
def test_clean_application_is_low_risk():
    result = _run(clean_bundle())
    assert result["risk_level"] == "LOW"
    assert result["is_potential_fraud"] is False
    assert result["flagged_rules"] == []
    assert len(result["rule_results"]) == 18
    assert _row(result, "Rule3_Distant_Branch")["message"] == "Disabled – not implementable with current data model."
    assert "Rule 3 [Distant Branch]: not implementable with current schema." in result["skipped_rules"]
    assert _row(result, "Rule16_Relationship_Fraud")["message"] == "OK"
    assert result["primary_snapshot"] == {"name": "Asha Testwala", "pan": "ABCDE1234F", "aadhaar": PRIMARY_AADHAAR,
                                          "dob": "1988-03-14", "customer_id": 9001}
    assert result["coapplicant_snapshot"]["aadhaar"] == CO_AADHAAR
    assert result["distances"] == {"applicant_to_branch_km": None, "applicant_to_coapplicant_km": None}


def test_identity_swap_is_high():
    bundle = clean_bundle()
    bundle["co_applicants"][0]["kyc"]["pan_number"] = "ABCDE1234F"
    result = _run(bundle)
    assert result["flagged_rules"] == ["Rule2_CoApp_Identity_Swap"]
    assert result["risk_level"] == "HIGH"
    assert _row(result, "Rule2_CoApp_Identity_Swap")["message"] == (
        "Same PAN 'ABCDE1234F' used by primary name='Asha Testwala' and co-app name='Vikram Fictional'")


def test_shared_bank_account_with_another_customer_is_critical():
    banks = [{"account_number": "123456789012", "customer_id": 4242, "application_id": 88, "participant_id": 5}]
    result = _run(clean_bundle(), banks=banks)
    assert result["flagged_rules"] == ["Rule6_Shared_Bank_Account"]
    assert result["risk_level"] == "CRITICAL"
    assert _row(result, "Rule6_Shared_Bank_Account")["message"] == (
        "account=123456789012 also on customer_id=4242 application_id=88 participant_id=5")


def test_three_medium_rules_escalate_to_high():
    bundle = clean_bundle()
    co = bundle["co_applicants"][0]
    co["details"].update(first_name="Asha", last_name="Testwalla", relation_with_applicant="friend", age=58)
    co["kyc"].update(first_name="Asha", last_name="Testwalla", date_of_birth=None)
    co["details"]["date_of_birth"] = None
    co["addresses"] = copy.deepcopy(bundle["primary"]["addresses"])
    bundle["primary"]["details"]["age"] = 36
    bundle["primary"]["details"]["date_of_birth"] = None
    bundle["primary"]["kyc"]["date_of_birth"] = None
    history = [{"full_address": "12 Sample Street, Demo Nagar, Testpur 400001", "customer_id": 3131,
                "application_id": 9, "application_number": "OLD-0009", "last_name": "Stranger"}]
    result = _run(bundle, addresses=history)       # rule 15 is Low since 0004: still three triggered rules -> HIGH
    assert sorted(result["flagged_rules"]) == ["Rule15_Address_Reuse", "Rule16_Relationship_Fraud",
                                               "Rule4_Name_Age_Tweak"]
    assert result["risk_level"] == "HIGH"
    assert _row(result, "Rule15_Address_Reuse")["message"].startswith(
        "• score=1.00 | application=OLD-0009 | customer_id=3131 | no family link")
    assert "relation='friend'" in _row(result, "Rule16_Relationship_Fraud")["message"]


# ---- the rule changes ported from the former fraud_agent (2026-11-03/04) ---------------------------------------------
def test_rule15_same_address_of_family_is_not_reuse():
    history = [{"full_address": "12 Sample Street, Demo Nagar, Testpur 400001", "customer_id": 3131,
                "application_id": 9, "last_name": "Other", "father_last_name": "Testwala"}]
    assert "Rule15_Address_Reuse" not in _run(clean_bundle(), addresses=history)["flagged_rules"]
    history[0]["father_last_name"] = "Unrelated"
    assert "Rule15_Address_Reuse" in _run(clean_bundle(), addresses=history)["flagged_rules"]


def test_rule16_flags_shared_address_whatever_the_relation_unless_configured():
    bundle = clean_bundle()
    bundle["co_applicants"][0]["addresses"] = copy.deepcopy(bundle["primary"]["addresses"])   # relation: spouse
    result = _run(bundle)
    assert "Rule16_Relationship_Fraud" in result["flagged_rules"]
    assert "share the same address (score=1.00 >= 0.95, relation='spouse')" in _row(
        result, "Rule16_Relationship_Fraud")["message"]
    rules = rule_config()
    rules["Rule16_Relationship_Fraud"]["config_json"]["ignore_family_relation"] = True
    assert "Rule16_Relationship_Fraud" not in _run(bundle, rules)["flagged_rules"]


def test_rule2_applicant_pan_already_a_co_applicant_elsewhere():
    coapps = [{"application_number": "OLD-0042", "application_id": 42, "pan": None, "participant_pan": "abcde1234f"}]
    result = engine.evaluate(clean_bundle(), rule_config(), [], [], [], POLICY, historical_coapplicants=coapps)
    assert result["flagged_rules"] == ["Rule2_CoApp_Identity_Swap"]
    assert _row(result, "Rule2_CoApp_Identity_Swap")["message"] == (
        "Applicant PAN 'ABCDE1234F' is already registered as a co-applicant in application OLD-0042")


def test_rule4_tweaked_name_with_another_dob_in_history():
    history = [{"application_id": 5, "application_number": "OLD-0005", "customer_id": 77, "Name": "Asha Testwalla",
                "DOB": "1979-01-01"}]
    result = _run(clean_bundle(), identity=history)
    assert "Rule4_Name_Age_Tweak" in result["flagged_rules"]
    assert "with DOB 1988-03-14" in _row(result, "Rule4_Name_Age_Tweak")["message"]
    history[0]["DOB"] = "1988-03-14"                                       # same DOB: not a tweak
    assert "Rule4_Name_Age_Tweak" not in _run(clean_bundle(), identity=history)["flagged_rules"]


def test_rule5_any_earlier_record_counts_and_same_customer_is_configurable():
    history = [{"application_id": 7, "application_number": "OLD-0007", "customer_id": 9001, "Name": "Asha Testwala",
                "PAN_Number": "ABCDE1234F"}]
    result = _run(clean_bundle(), identity=history)
    assert _row(result, "Rule5_Dual_Identity_Mismatch")["message"] == (
        "PAN already has a record in application OLD-0007 (customer_id=9001, name='ASHA TESTWALA')")
    rules = rule_config()
    rules["Rule5_Dual_Identity_Mismatch"]["config_json"] = {"include_same_customer": False}
    assert "Rule5_Dual_Identity_Mismatch" not in _run(clean_bundle(), rules, identity=history)["flagged_rules"]


def test_rule6_co_applicant_same_account_needs_the_same_ifsc():
    bundle = clean_bundle()
    bundle["primary"]["bank_accounts"] = [{"account_number": "998877665544", "ifsc": "TEST0001234"}]
    bundle["co_applicants"][0]["bank_accounts"] = [{"account_number": "998877665544", "ifsc": "TEST0001234"}]
    result = _run(bundle)
    assert _row(result, "Rule6_CoApp_Shared_Bank_Account")["message"] == (
        "co-applicant bank account ending 5544 (IFSC TEST0001234) is the same as the applicant's account")
    bundle["co_applicants"][0]["bank_accounts"][0]["ifsc"] = "OTHR0009999"     # another bank
    assert "Rule6_CoApp_Shared_Bank_Account" not in _run(bundle)["flagged_rules"]


def test_rule9_checks_the_co_applicant_too():
    bundle = clean_bundle()
    bundle["co_applicants"][0]["details"]["age"] = 20
    result = _run(bundle)
    assert _row(result, "Rule9_Age_DOB_Mismatch")["message"].startswith("Co-applicant: stated age=20")


def test_rule12_ids_and_mobile_of_every_earlier_participant():
    bundle = clean_bundle()
    bundle["co_applicants"][0]["details"]["mobile_number"] = "+91 98765-43210"
    people = [{"application_number": "OLD-0011", "application_id": 11, "participant_id": 31, "role": "co-applicant",
               "customer_id": 555, "name": "Someone Else", "aadhaar": [None], "pan": ["ABCDE1234F", None, None],
               "mobile": ["9876543210"]}]
    result = engine.evaluate(bundle, rule_config(), [], [], [], POLICY, historical_participants=people)
    assert _row(result, "Rule12_Duplicate_Identity")["message"] == (
        "Applicant PAN is already assigned to the co-applicant 'Someone Else' in application OLD-0011; "
        "Co-applicant Mobile number is already assigned to the co-applicant 'Someone Else' in application OLD-0011")
    people[0]["customer_id"] = 9001                                         # the applicant's own earlier record
    msg = _row(engine.evaluate(bundle, rule_config(), [], [], [], POLICY, historical_participants=people),
               "Rule12_Duplicate_Identity")["message"]
    assert msg.startswith("Co-applicant Mobile number")


def test_rule4_reads_its_config_json():
    bundle = clean_bundle()
    co = bundle["co_applicants"][0]
    age = ids.calculate_age(date(1988, 3, 14))
    co["details"].update(first_name="Asha", last_name="Testwala", age=age + 4)
    bundle["primary"]["details"]["age"] = age
    rules = rule_config()
    assert _run(bundle, rules)["flagged_rules"] == []                    # 4 years apart, threshold 5
    rules["Rule4_Name_Age_Tweak"]["config_json"] = '{"age_diff_years": 3, "name_similarity": 0.85}'
    assert _run(bundle, rules)["flagged_rules"] == ["Rule4_Name_Age_Tweak"]


def test_disabled_rule_is_reported_and_skipped():
    rules = rule_config()
    rules["Rule12_Duplicate_Identity"]["enabled"] = False
    result = _run(clean_bundle(), rules)
    assert _row(result, "Rule12_Duplicate_Identity") == {
        "rule_key": "Rule12_Duplicate_Identity", "rule": "Rule 12", "name": "Duplicate Identity",
        "severity": "Critical", "triggered": False, "enabled": False, "message": "Rule disabled by configuration."}
    assert "Rule 12 [Duplicate Identity]: disabled in configuration." in result["skipped_rules"]


def test_synthetic_identity_needs_a_format_problem_and_a_second_signal():
    bundle = clean_bundle()
    bundle["primary"]["kyc"]["pan_number"] = "BAD"
    result = _run(bundle)
    assert "Rule13_Synthetic_Identity" in result["flagged_rules"]
    assert _row(result, "Rule13_Synthetic_Identity")["message"] == (
        "Weak signals: PAN 'BAD' does not match AAAAA9999A; no_prior_applications_for_customer")
    assert _row(result, "Rule1_PAN_Aadhaar_Mismatch")["triggered"] is True
    # an existing customer with the same format problem has only one signal
    history = [{"customer_id": 9001, "application_id": 3, "Name": "Asha Testwala"}]
    assert "Rule13_Synthetic_Identity" not in _run(bundle, identity=history)["flagged_rules"]


def test_missing_co_applicant_is_skipped_not_flagged():
    bundle = clean_bundle()
    bundle["co_applicants"] = []
    result = _run(bundle)
    assert result["coapplicant_snapshot"] is None
    assert "Rule 1 (co-app): no co-applicant." in result["skipped_rules"]
    assert result["is_potential_fraud"] is False
