"""
The fraud rule engine: evaluates the implementable rules against one application bundle.

Pure: the bundle, the rule configuration (table rule_config) and the historical records come in as plain data; the
result goes out as a dict. The co-applicant is treated as the former "nominee". A rule that is not implementable or
not enabled is reported as skipped / disabled.
"""

from __future__ import annotations

import json
from typing import Dict, List, Optional

from agents.fraud_screening.rules import identity as ids
from agents.fraud_screening.rules.policy import Policy


def _full_name(details: dict, kyc: Optional[dict] = None) -> str:
    if details.get("type") == "individual":
        n = " ".join(p for p in (details.get("first_name"), details.get("middle_name"), details.get("last_name")) if p)
        if n:
            return n
    if details.get("type") == "non_individual":
        return details.get("company_name") or details.get("authorized_person") or ""
    if kyc:
        return " ".join(p for p in (kyc.get("first_name"), kyc.get("middle_name"), kyc.get("last_name")) if p)
    return ""


def _joined_address(row: dict, pincode) -> str:
    return " ".join(filter(None, [row.get("address_line_1"), row.get("address_line_2"), row.get("city"),
                                  row.get("state"), pincode]))


def _surnames(row: dict, policy: Policy) -> set:
    """Rule 15: the surnames (own, father's, spouse's, mother's) of a person row, normalised."""
    found = {ids.normalize_name(row.get(k)) for k in policy.family_surname_fields}
    return {s for s in found if len(s) >= policy.family_surname_min_chars}


def _address_strings(person: dict, policy: Policy) -> List[str]:
    """Rule 16: every address of a person that is long enough to compare."""
    out = []
    for a in person.get("addresses") or []:
        s = a.get("full_address") or _joined_address(a, str(a.get("pincode") or ""))
        if s and len(ids.normalize_address(s)) >= policy.rule16_min_address_chars:
            out.append(s)
    return out


def person_view(block: Optional[dict]) -> dict:
    """Flatten a primary / co-applicant block into the fields the rules read."""
    if not block:
        return {}
    details = block.get("details") or {}
    kyc = block.get("kyc") or {}
    participant = block.get("participant") or {}
    addrs = block.get("addresses") or []
    banks = block.get("bank_accounts") or []
    participant_data = participant.get("participant_data") or {}

    dob = details.get("date_of_birth") or kyc.get("date_of_birth")
    age = details.get("age")
    if age is None and dob is not None:
        age = ids.calculate_age(dob)

    primary_addr = ""
    if addrs:
        primary_addr = addrs[0].get("full_address") or _joined_address(addrs[0], addrs[0].get("pincode"))

    return {
        "name": _full_name(details, kyc),
        "dob": dob,
        "age": age,
        "pan": kyc.get("pan_number") or details.get("business_pan_number") or participant_data.get("pan_number"),
        "aadhaar": kyc.get("aadhaar_number") or participant_data.get("aadhaar_number"),
        "mobile": details.get("mobile_number") or kyc.get("aadhaar_linked_mobile_number"),
        "address": primary_addr,
        "addresses": addrs,
        "bank_accounts": [b.get("account_number") for b in banks if b.get("account_number")],
        # (account number, IFSC) normalised: rule 6 compares the applicant's and co-applicants' accounts
        "bank_details": [(ids.norm_id(b.get("account_number")), ids.norm_id(b.get("ifsc")))
                         for b in banks if b.get("account_number")],
        "customer_id": participant.get("customer_id"),
        "participant_id": participant.get("participant_id"),
        "relation": details.get("relation_with_applicant"),
        "gender": details.get("gender"),
        "details": details,
        "kyc": kyc,
    }


class _Results:
    """Collects one row per rule (rule_results) and the skipped notes, from the rule's configuration."""

    def __init__(self, rule_config: Dict[str, dict]):
        self.rule_config = rule_config
        self.rows: List[dict] = []
        self.skipped: List[str] = []

    def cfg(self, key: str) -> dict:
        return self.rule_config.get(key) or {}

    def is_on(self, key: str) -> bool:
        c = self.cfg(key)
        return bool(c) and bool(c.get("enabled")) and bool(c.get("is_implementable", True))

    def emit(self, key: str, triggered: bool, message: str = "", extra: Optional[dict] = None) -> None:
        c = self.cfg(key)
        if not c:
            return
        base = {"rule_key": key, "rule": c.get("rule_id"), "name": c.get("rule_name"), "severity": c.get("severity")}
        if not c.get("is_implementable", True):
            self.skipped.append(f"{c.get('rule_id')} [{c.get('rule_name')}]: not implementable with current schema.")
            self.rows.append({**base, "triggered": False, "enabled": False,
                              "message": "Disabled – not implementable with current data model."})
            return
        if not c.get("enabled", True):
            self.skipped.append(f"{c.get('rule_id')} [{c.get('rule_name')}]: disabled in configuration.")
            self.rows.append({**base, "triggered": False, "enabled": False,
                              "message": "Rule disabled by configuration."})
            return
        self.rows.append({**base, "triggered": bool(triggered), "enabled": True,
                          "message": message or (c.get("description") if triggered else "OK"), **(extra or {})})


def _rule_params(r: _Results, key: str, policy: Policy) -> dict:
    conf = r.cfg(key).get("config_json") or {}
    if isinstance(conf, str):
        conf = json.loads(conf or "{}")
    return {**policy.rule_defaults.get(key, {}), **conf}


def _rule1(r: _Results, key: str, person: dict, prefix: str, ok_message: str) -> None:
    msgs = [prefix + m for m in (ids.pan_issue(person.get("pan")), ids.aadhaar_issue(person.get("aadhaar"))) if m]
    if not person.get("pan") and not person.get("aadhaar"):
        r.skipped.append(f"Rule 1 ({'co-app' if prefix else 'primary'}): PAN and Aadhaar not provided.")
        r.emit(key, False, "Insufficient data")
    else:
        r.emit(key, bool(msgs), "; ".join(msgs) if msgs else ok_message)


def _participant_duplicates(primary: dict, co: dict, people: List[dict], policy: Policy) -> List[str]:
    """Rule 12: the applicant's / co-applicant's Aadhaar, PAN or mobile already assigned to another applicant or
    co-applicant of an earlier application. The same person (same customer id, or the same name when either side has no
    customer id) is not "another"."""
    def key_of(field: str, value) -> str:
        return ids.norm_mobile(value, policy.mobile_digits) if field == "mobile" else ids.norm_id(value)

    msgs: List[str] = []
    seen = set()
    for label, person in (("Applicant", primary), ("Co-applicant", co)):
        if not person:
            continue
        for what, field in (("Aadhaar", "aadhaar"), ("PAN", "pan"), ("Mobile number", "mobile")):
            key = key_of(field, person.get(field))
            if not key or (field != "mobile" and ids.is_masked_id(key)):
                continue
            for h in people:
                if key not in {key_of(field, v) for v in (h.get(field) or [])}:
                    continue
                if person.get("customer_id") is not None and h.get("customer_id") is not None:
                    if str(person["customer_id"]) == str(h["customer_id"]):
                        continue
                elif person.get("name") and h.get("name") and ids.names_match(person["name"], h["name"],
                                                                                 policy.name_match):
                    continue
                ref = h.get("application_number") or h.get("application_id")
                mark = (label, what, ref, h.get("participant_id"))
                if mark in seen:
                    continue
                seen.add(mark)
                msgs.append(f"{label} {what} is already assigned to the {h.get('role')} "
                            f"'{h.get('name') or 'unknown'}' in application {ref}")
    return msgs


def evaluate(bundle: dict, rule_config: Dict[str, dict], historical_identity: List[dict],
             historical_banks: List[dict], historical_addresses: List[dict], policy: Policy,
             historical_coapplicants: Optional[List[dict]] = None,
             historical_participants: Optional[List[dict]] = None) -> dict:
    """historical_coapplicants: co-applicant PANs of other applications (rule 2 across applications);
    historical_participants: every applicant and co-applicant of other applications with their Aadhaar / PAN / mobile
    numbers (rule 12). None = that check is not run (rule 12 then falls back to earlier primary applicants)."""
    primary = person_view(bundle.get("primary"))
    co_apps = [person_view(c) for c in (bundle.get("co_applicants") or [])]
    co = co_apps[0] if co_apps else {}          # the first co-applicant is the "nominee" analogue
    app = bundle.get("application") or {}
    customer_id = app.get("customer_id") or primary.get("customer_id")

    identity_index = ids.build_identity_index(historical_identity)
    dob_index = ids.build_dob_index(historical_identity)
    r = _Results(rule_config)
    n = policy.max_evidence

    # ---- Rule 1: PAN / Aadhaar format (masked / partial IDs are not invalid) ----
    if r.is_on("Rule1_PAN_Aadhaar_Mismatch"):
        _rule1(r, "Rule1_PAN_Aadhaar_Mismatch", primary, "", "PAN/Aadhaar format OK (or masked/not checkable)")
    else:
        r.emit("Rule1_PAN_Aadhaar_Mismatch", False)

    if r.is_on("Rule1_CoApp_PAN_Aadhaar_Mismatch"):
        if not co:
            r.skipped.append("Rule 1 (co-app): no co-applicant.")
            r.emit("Rule1_CoApp_PAN_Aadhaar_Mismatch", False, "No co-applicant")
        else:
            _rule1(r, "Rule1_CoApp_PAN_Aadhaar_Mismatch", co, "Co-app: ",
                   "Co-app PAN/Aadhaar format OK (or masked/not checkable)")
    else:
        r.emit("Rule1_CoApp_PAN_Aadhaar_Mismatch", False)

    # ---- Rule 2: identity swap (same PAN, different name) + applicant already registered as a co-applicant ----
    if r.is_on("Rule2_CoApp_Identity_Swap"):
        primary_pan = ids.norm_id(primary.get("pan"))
        msgs: List[str] = []
        checked = False
        # (a) within this application: the co-applicant carries the primary's PAN under a different name
        if co and primary_pan and co.get("pan"):
            checked = True
            if primary_pan == ids.norm_id(co["pan"]) and not ids.names_match(primary.get("name"), co.get("name"),
                                                                              policy.name_match):
                msgs.append(f"Same PAN '{primary_pan}' used by primary name='{primary.get('name')}' "
                            f"and co-app name='{co.get('name')}'")
        # (b) across applications: the applicant's PAN is already registered as a co-applicant elsewhere
        if primary_pan and historical_coapplicants is not None:
            checked = True
            seen = set()
            for h in historical_coapplicants:
                if primary_pan not in (ids.norm_id(h.get("pan")), ids.norm_id(h.get("participant_pan"))):
                    continue
                ref = h.get("application_number") or h.get("application_id")
                if ref in seen:
                    continue
                seen.add(ref)
                msgs.append(f"Applicant PAN '{primary_pan}' is already registered as a co-applicant "
                            f"in application {ref}")
        if not checked:
            r.skipped.append("Rule 2: needs the applicant's PAN (and co-applicant PAN data).")
            r.emit("Rule2_CoApp_Identity_Swap", False, "Insufficient data")
        else:
            r.emit("Rule2_CoApp_Identity_Swap", bool(msgs), "; ".join(msgs[:n]) if msgs else "OK")
    else:
        r.emit("Rule2_CoApp_Identity_Swap", False)

    # ---- Rule 3: distant branch (not implementable: no lat/long) ----
    r.emit("Rule3_Distant_Branch", False)

    # ---- Rule 4: name tweak + age deviation ----
    if r.is_on("Rule4_Name_Age_Tweak"):
        params = _rule_params(r, "Rule4_Name_Age_Tweak", policy)
        age_thr = int(params["age_diff_years"])
        sim_thr = float(params["name_similarity"])
        hist_age_thr = int(params["history_age_diff_years"])
        msgs = []
        checked = False
        # (a) primary vs co-applicant: near-identical names but ages far apart
        if co and primary.get("name") and co.get("name"):
            checked = True
            sim = ids.name_similarity(primary["name"], co["name"])
            age_a, age_c = primary.get("age"), co.get("age")
            age_diff = abs(int(age_a) - int(age_c)) if age_a is not None and age_c is not None else None
            if sim >= sim_thr and age_diff is not None and age_diff > age_thr:
                msgs.append(f"Names nearly identical (similarity={sim:.2f}): primary='{primary.get('name')}' "
                            f"co-app='{co.get('name')}'; ages {age_a} vs {age_c} (diff={age_diff} > {age_thr})")
        # (b) applicant vs earlier applications: a slightly tweaked name with a different DOB and age
        p_dob = ids.parse_dob(primary.get("dob"))
        if primary.get("name") and p_dob is not None:
            checked = True
            p_age = ids.calculate_age(p_dob)
            hits = []
            for h in historical_identity:
                h_dob = ids.parse_dob(h.get("DOB") or h.get("date_of_birth"))
                if h_dob is None or h_dob == p_dob:
                    continue
                h_name = h.get("Name") or h.get("full_name")
                sim = ids.name_similarity(primary["name"], h_name)
                if not (sim_thr <= sim < 1.0):
                    continue
                h_age = ids.calculate_age(h_dob)
                if p_age is None or h_age is None or abs(p_age - h_age) < hist_age_thr:
                    continue
                hits.append(f"name '{primary['name']}' ~ '{h_name}' (similarity={sim:.2f}) with DOB "
                            f"{p_dob.isoformat()} (age {p_age}) vs {h_dob.isoformat()} (age {h_age}), "
                            f"application={h.get('application_number') or h.get('application_id')}")
            msgs.extend(hits[:n])
        if not checked:
            r.skipped.append("Rule 4: needs applicant name + DOB (or a co-applicant name) to compare.")
            r.emit("Rule4_Name_Age_Tweak", False, "Insufficient data")
        else:
            r.emit("Rule4_Name_Age_Tweak", bool(msgs), "; ".join(msgs[:n]) if msgs else "OK")
    else:
        r.emit("Rule4_Name_Age_Tweak", False)

    # ---- Rule 5: historical dual identity ----
    if r.is_on("Rule5_Dual_Identity_Mismatch"):
        params = _rule_params(r, "Rule5_Dual_Identity_Mismatch", policy)
        # True: an earlier application of the same customer also counts as "has a record"
        include_same_customer = bool(params.get("include_same_customer", True))
        checkable = [(label, ids.norm_id(value), identity_index.get(bucket, {}))
                     for label, value, bucket in (("Aadhaar", primary.get("aadhaar"), "aadhaar"),
                                                  ("PAN", primary.get("pan"), "pan"))
                     if value and not ids.is_masked_id(ids.norm_id(value))]
        if not checkable:
            r.skipped.append("Rule 5: needs a usable (unmasked) Aadhaar or PAN.")
            r.emit("Rule5_Dual_Identity_Mismatch", False, "Insufficient data")
        else:
            nm = ids.normalize_name(primary.get("name"))
            conflicts = []
            for label, key, bucket in checkable:
                seen = set()
                for e in bucket.get(key, []):
                    same_customer = customer_id is not None and str(e.get("customer_id")) == str(customer_id)
                    if same_customer and not include_same_customer:
                        continue
                    ref = e.get("application_number") or e.get("application_id")
                    if ref in seen:
                        continue
                    seen.add(ref)
                    hist_name = e.get("name") or ""
                    if nm and hist_name and not ids.names_match(nm, hist_name, policy.name_match):
                        conflicts.append(f"{label} already has a record in application {ref} "
                                         f"(customer_id={e.get('customer_id')}) under a different name "
                                         f"'{hist_name}' (current name='{nm}')")
                    else:
                        conflicts.append(f"{label} already has a record in application {ref} "
                                         f"(customer_id={e.get('customer_id')}, name='{hist_name}')")
            r.emit("Rule5_Dual_Identity_Mismatch", bool(conflicts), "; ".join(conflicts[:n]) if conflicts else "OK")
    else:
        r.emit("Rule5_Dual_Identity_Mismatch", False)

    # ---- Rule 6: shared bank accounts ----
    if r.is_on("Rule6_Shared_Bank_Account"):
        accts = primary.get("bank_accounts") or []
        if not accts:
            r.skipped.append("Rule 6 (primary): no bank account on file.")
            r.emit("Rule6_Shared_Bank_Account", False, "No bank account")
        else:
            hits = [h for a in accts for h in ids.shared_bank_account_hits(a, customer_id, historical_banks)]
            r.emit("Rule6_Shared_Bank_Account", bool(hits), "; ".join(hits[:n]) if hits else "OK")
    else:
        r.emit("Rule6_Shared_Bank_Account", False)

    if r.is_on("Rule6_CoApp_Shared_Bank_Account"):
        accts = co.get("bank_accounts") or []
        if not co or not accts:
            r.skipped.append("Rule 6 (co-app): no co-applicant bank account.")
            r.emit("Rule6_CoApp_Shared_Bank_Account", False, "No co-applicant bank account")
        else:
            # applicant and co-applicant(s) must not share a bank account: the same account number, and the same IFSC
            # unless one side has no IFSC on file
            primary_banks: Dict[str, set] = {}
            for acct, ifsc in primary.get("bank_details") or []:
                primary_banks.setdefault(acct, set()).add(ifsc)
            hits = []
            for other in co_apps:
                for acct, ifsc in other.get("bank_details") or []:
                    p_ifscs = primary_banks.get(acct)
                    if p_ifscs is None:
                        continue
                    if ifsc and any(p_ifscs) and ifsc not in p_ifscs:
                        continue                   # the same number at a different bank is not the same account
                    hits.append(f"co-applicant bank account ending {acct[-4:]}"
                                f"{' (IFSC ' + ifsc + ')' if ifsc else ''} is the same as the applicant's account")
            for a in accts:
                hits.extend(ids.shared_bank_account_hits(a, co.get("customer_id"), historical_banks))
            r.emit("Rule6_CoApp_Shared_Bank_Account", bool(hits), "; ".join(hits[:n]) if hits else "OK")
    else:
        r.emit("Rule6_CoApp_Shared_Bank_Account", False)

    # ---- Rules 7 and 8: not implementable ----
    r.emit("Rule7_Income_Inflation", False)
    r.emit("Rule8_Low_Credit_Score", False)

    # ---- Rule 9: age vs DOB, DOB conflict with history ----
    if r.is_on("Rule9_Age_DOB_Mismatch"):
        params = _rule_params(r, "Rule9_Age_DOB_Mismatch", policy)
        age_tol = int(params.get("age_dob_tolerance_years", policy.dob_tolerance_years))
        checkable = [(label, person) for label, person in (("Applicant", primary), ("Co-applicant", co))
                     if person and person.get("age") is not None and person.get("dob") is not None]
        if not checkable:
            r.skipped.append("Rule 9 (age/DOB): age or DOB missing.")
            r.emit("Rule9_Age_DOB_Mismatch", False, "Insufficient data")
        else:
            msgs9 = [f"{label}: stated age={person['age']} but DOB={person['dob']} "
                     f"implies age={ids.calculate_age(person['dob'])}"
                     for label, person in checkable
                     if not ids.verify_age_dob_match(person["age"], person["dob"], tolerance=age_tol)]
            r.emit("Rule9_Age_DOB_Mismatch", bool(msgs9), "; ".join(msgs9) if msgs9 else "OK")
    else:
        r.emit("Rule9_Age_DOB_Mismatch", False)

    if r.is_on("Rule9_DOB_Conflict"):
        if not primary.get("dob") or (not primary.get("aadhaar") and not primary.get("pan")):
            r.skipped.append("Rule 9 (DOB conflict): needs DOB and Aadhaar/PAN.")
            r.emit("Rule9_DOB_Conflict", False, "Insufficient data")
        else:
            conflicts = ids.dob_consistency_conflicts(primary.get("aadhaar"), primary.get("pan"), primary.get("dob"),
                                                      dob_index)
            r.emit("Rule9_DOB_Conflict", bool(conflicts), "; ".join(conflicts[:n]) if conflicts else "OK")
    else:
        r.emit("Rule9_DOB_Conflict", False)

    # ---- Rule 11: external document mismatch (not implementable without a KYC vendor) ----
    r.emit("Rule11_Doc_Mismatch", False)

    # ---- Rule 12: duplicate identity ----
    if r.is_on("Rule12_Duplicate_Identity"):
        if not any(primary.get(k) for k in ("name", "aadhaar", "pan", "mobile")):
            r.skipped.append("Rule 12: insufficient identity fields.")
            r.emit("Rule12_Duplicate_Identity", False, "Insufficient data")
        else:
            # Aadhaar / PAN / mobile of the applicant and co-applicant against every earlier applicant and co-applicant
            # (historical_participants); without that list, the Aadhaar / PAN check against earlier primary applicants
            have_people = historical_participants is not None
            msgs = ids.find_duplicate_identity(customer_id, primary.get("aadhaar"), primary.get("pan"),
                                               primary.get("name"), primary.get("dob"), identity_index,
                                               check_ids=not have_people)
            if have_people:
                msgs.extend(_participant_duplicates(primary, co, historical_participants or [], policy))
            r.emit("Rule12_Duplicate_Identity", bool(msgs), "; ".join(msgs) if msgs else "OK")
    else:
        r.emit("Rule12_Duplicate_Identity", False)

    # ---- Rule 13: synthetic identity. "First application" alone never triggers: at least two signals, one of them
    # an identity-format problem ----
    if r.is_on("Rule13_Synthetic_Identity"):
        signals = []
        ai = ids.aadhaar_issue(primary.get("aadhaar"))
        pi = ids.pan_issue(primary.get("pan"))
        signals += [s for s in (ai, pi) if s]
        age = primary.get("age")
        if age is not None:
            try:
                if int(age) < policy.minor_below_years:
                    signals.append(f"under_18 (age={age})")
            except (TypeError, ValueError):
                pass
        prior = [h for h in historical_identity
                 if customer_id is not None and str(h.get("customer_id")) == str(customer_id)]
        has_format_issue = bool(ai or pi)
        if has_format_issue and len(prior) == 0:
            signals.append("no_prior_applications_for_customer")
        triggered = len(signals) >= 2 and has_format_issue
        if triggered:
            msg = "Weak signals: " + "; ".join(signals)
        else:
            msg = "OK" if not signals else f"Only weak/incomplete signals (not enough to flag): {'; '.join(signals)}"
        r.emit("Rule13_Synthetic_Identity", triggered, msg)
    else:
        r.emit("Rule13_Synthetic_Identity", False)

    # ---- Rule 14: device (not implementable) ----
    r.emit("Rule14_Device_Fraud", False)

    # ---- Rule 15: address reuse ----
    if r.is_on("Rule15_Address_Reuse"):
        addr = primary.get("address")
        if not addr or len(ids.normalize_address(addr)) < policy.address_min_chars:
            r.skipped.append("Rule 15: primary address missing or too short to compare reliably.")
            r.emit("Rule15_Address_Reuse", False, "No usable address")
        else:
            primary_block = bundle.get("primary") or {}
            my_surnames = _surnames(primary_block.get("details") or {}, policy)
            if not my_surnames:
                kyc_last = ids.normalize_name((primary_block.get("kyc") or {}).get("last_name"))
                my_surnames = {kyc_last} if len(kyc_last) >= policy.family_surname_min_chars else set()
            hits = []
            for h in historical_addresses:
                if customer_id is not None and str(h.get("customer_id")) == str(customer_id):
                    continue
                other = h.get("full_address") or _joined_address(h, str(h.get("pincode") or ""))
                score = ids.address_match_score(addr, other)
                if score >= policy.address_reuse:
                    # the same address is fine when the other occupant is family: a shared surname (own, father's,
                    # spouse's or mother's)
                    h_names = _surnames(h, policy)
                    if my_surnames & h_names:
                        continue
                    ref = h.get("application_number") or h.get("application_id")
                    hits.append(f"• score={score:.2f} | application={ref} | customer_id={h.get('customer_id')} | "
                                f"no family link "
                                f"(surnames: applicant {sorted(my_surnames) or 'unknown'} vs "
                                f"{sorted(h_names) or 'unknown'}) | address='{other[:policy.rule15_address_chars]}'")
            r.emit("Rule15_Address_Reuse", bool(hits), "\n".join(hits[:n]) if hits else "OK")
    else:
        r.emit("Rule15_Address_Reuse", False)

    # ---- Rule 16: relationship fraud (shared address, not immediate family) ----
    if r.is_on("Rule16_Relationship_Fraud"):
        params = _rule_params(r, "Rule16_Relationship_Fraud", policy)
        threshold16 = float(params["address_match_threshold"])
        # False: applicant and co-applicant at the same address are flagged whatever their stated relation;
        # True: a stated immediate-family relation is let through
        ignore_family = bool(params["ignore_family_relation"])
        primary_addrs = _address_strings(primary, policy)
        co_with_addr = [(c, a) for c, a in ((c, _address_strings(c, policy)) for c in co_apps) if a]
        if not primary_addrs or not co_with_addr:
            r.skipped.append("Rule 16: needs primary and co-applicant addresses.")
            r.emit("Rule16_Relationship_Fraud", False, "Insufficient data")
        else:
            cut = policy.rule16_address_chars
            msgs16 = []
            for other, other_addrs in co_with_addr:
                best = (0.0, "", "")
                for pa in primary_addrs:
                    for oa in other_addrs:
                        sc = ids.address_match_score(pa, oa)
                        if sc > best[0]:
                            best = (sc, pa, oa)
                if best[0] < threshold16:
                    continue
                rel = (other.get("relation") or "").strip().lower()
                if ignore_family and any(k in rel for k in policy.family_relations):
                    continue
                msgs16.append(f"Applicant and co-applicant '{other.get('name') or 'unknown'}' share the same address "
                              f"(score={best[0]:.2f} >= {threshold16:.2f}, relation='{rel or 'blank'}'): "
                              f"'{best[1][:cut]}'")
            r.emit("Rule16_Relationship_Fraud", bool(msgs16), "; ".join(msgs16[:n]) if msgs16 else "OK")
    else:
        r.emit("Rule16_Relationship_Fraud", False)

    return _aggregate(r, primary, co, customer_id, policy)


def risk_level(flagged: List[dict], policy: Policy) -> str:
    top = max((policy.severity_rank.get(f.get("severity"), 0) for f in flagged), default=0)
    level = policy.risk_levels[top]
    if top == 1 and len(flagged) >= policy.escalate_medium_to_high_at:
        level = policy.risk_levels[2]
    return level


def _aggregate(r: _Results, primary: dict, co: dict, customer_id, policy: Policy) -> dict:
    flagged = [row for row in r.rows if row.get("triggered")]
    return {
        "flagged_rules": [row["rule_key"] for row in flagged],
        "rule_results": r.rows,
        "risk_level": risk_level(flagged, policy),
        "skipped_rules": r.skipped,
        "is_potential_fraud": len(flagged) > 0,
        "hybrid_flag": False,
        "distances": {"applicant_to_branch_km": None, "applicant_to_coapplicant_km": None},
        "primary_snapshot": {
            "name": primary.get("name"),
            "pan": primary.get("pan"),
            "aadhaar": primary.get("aadhaar"),
            "dob": str(primary.get("dob")) if primary.get("dob") else None,
            "customer_id": customer_id,
        },
        "coapplicant_snapshot": {
            "name": co.get("name"),
            "pan": co.get("pan"),
            "aadhaar": co.get("aadhaar"),
            "dob": str(co.get("dob")) if co.get("dob") else None,
        } if co else None,
    }
