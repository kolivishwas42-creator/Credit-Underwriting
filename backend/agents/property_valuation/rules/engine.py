"""
THE PROPERTY VALUATION RULE ENGINE -- the 22 retained rules (RULE_1 .. RULE_22, original ids PROP-012 .. PROP-046).

Pure: no database, no file, no network. evaluate_property_records() receives the rule catalogue and the engine
settings (conf/, read by config.py) plus the saved rule rows, and evaluates the normalized LOS ("registration") and
vendor ("valuation") dicts built by service.build_rule_inputs().

The rule functions read the module-level PROPERTY_RULES / PROPERTY_RULE_SETTINGS; evaluate_property_records() sets
them to the effective configuration for one evaluation under a lock and restores them afterwards.
"""


import re
import threading
from copy import deepcopy
from datetime import date, datetime


# the effective configuration of the evaluation in progress (set by evaluate_property_records)
PROPERTY_RULES: dict = {}
PROPERTY_RULE_SETTINGS: dict = {}


def parse_numeric_value(value):
    """Return a float for a valid numeric value; otherwise return None."""
    if is_missing(value):
        return None

    try:
        cleaned = str(value).replace(",", "").replace("₹", "").strip()
        return float(cleaned)
    except (ValueError, TypeError):
        return None


def is_valid_valuation_date(value):
    """Accept common date formats used in valuation records."""
    if is_missing(value):
        return False

    if isinstance(value, (datetime, date)):
        return True

    text = str(value).strip()

    for date_format in (
        "%Y-%m-%d",
        "%d-%m-%Y",
        "%d/%m/%Y",
        "%d-%b-%Y",
        "%d/%m/%y",
    ):
        try:
            datetime.strptime(text, date_format)
            return True
        except ValueError:
            continue

    return False



# --------------------------------------------------
# SOURCE LABELS
# --------------------------------------------------

REGISTRATION_SOURCE = "LOS Property Record"
VALUATION_SOURCE = "Vendor Valuation Report"


def get_value(record, field):
    """Read a field safely and normalize whitespace."""
    if not record or not field:
        return ""

    value = record.get(field, "")
    if value is None:
        return ""

    if PROPERTY_RULE_SETTINGS.get("trim_text_whitespace", True):
        value = str(value).strip()
    else:
        value = str(value)

    return value


def normalize(value):
    """Normalize text for comparison."""
    value = str(value or "").strip()

    if PROPERTY_RULE_SETTINGS.get("case_insensitive_text_comparison", True):
        value = value.casefold()

    return re.sub(r"\s+", " ", value)


def is_missing(value):
    return normalize(value) in {"", "na", "n/a", "null", "none"}


def make_discrepancy(
    field,
    applicant_value,
    source,
    source_field,
    source_value,
    reason,
):
    """Build a discrepancy with explicit source information."""
    return {
        "field": field,
        "applicant_value": applicant_value,
        "source": source,
        "source_field": source_field,
        "source_value": source_value,
        "reason": reason,
    }


# --------------------------------------------------
# RULE RESULT HELPER
# --------------------------------------------------

def make_rule_result(rule_key, rule_config, discrepancies, issue, action):
    triggered = bool(discrepancies)

    return {
        "rule_number": rule_config["sequence"],
        "rule_id": rule_config["original_id"],
        "rule_name": rule_config["name"],
        "severity": rule_config.get("severity", "MAJOR"),
        "status": "REVIEW" if triggered else "PASS",
        "triggered": triggered,
        "issue": issue if triggered else "No issue detected by this rule.",
        "discrepancies": discrepancies,
        "recommended_action": action if triggered else None,
    }


# --------------------------------------------------
# RULE 1 — REGISTRATION COMPLETENESS
# Original ID: PROP-012
# --------------------------------------------------

def check_rule_1(registration):
    config = PROPERTY_RULES["RULE_1"]
    discrepancies = []

    required_fields = [
        "Registered At",
        "Registration Number",
        "Registration Date",
        "Transaction Type",
    ]

    for field in required_fields:
        value = get_value(registration, field)
       
        if is_missing(value):
            discrepancies.append(
                make_discrepancy(
                    field=field,
                    applicant_value=value or "Not provided",
                    source=REGISTRATION_SOURCE,
                    source_field=field,
                    source_value=value or "Unavailable",
                    reason=f"Required registration field '{field}' is missing.",
                )
            )

    return make_rule_result(
        "RULE_1",
        config,
        discrepancies,
        "Required registration information is missing.",
        "Obtain the missing registration details and verify them against the property documents.",
    )


# --------------------------------------------------
# RULE 2 — OWNER NAME CONSISTENCY
# Original ID: PROP-013
# --------------------------------------------------

def check_rule_2(registration, valuation):
    config = PROPERTY_RULES["RULE_2"]
    discrepancies = []

    owner_parts = [
        get_value(registration, "Property Owner First Name"),
        get_value(registration, "Property Owner Middle Name"),
        get_value(registration, "Property Owner Last Name"),
    ]
    owner_name = " ".join(part for part in owner_parts if part).strip()
    current_owner = get_value(valuation, "Current property owner")

    if is_missing(owner_name):
        discrepancies.append(
            make_discrepancy(
                "Property Owner Name",
                "Unavailable",
                REGISTRATION_SOURCE,
                "Property Owner First/Middle/Last Name",
                "Unavailable",
                "The registered property owner's name is incomplete or unavailable.",
            )
        )
    elif is_missing(current_owner):
        discrepancies.append(
            make_discrepancy(
                "Current property owner",
                owner_name,
                VALUATION_SOURCE,
                "Current property owner",
                "Unavailable",
                "The vendor valuation report does not provide the current owner's name.",
            )
        )
    elif normalize(owner_name) != normalize(current_owner):
        discrepancies.append(
            make_discrepancy(
                "Property Owner Name",
                owner_name,
                VALUATION_SOURCE,
                "Current property owner",
                current_owner,
                "The registered owner name differs from the current owner name in the vendor valuation report.",
            )
        )

    return make_rule_result(
        "RULE_2",
        config,
        discrepancies,
        "Property owner name inconsistency detected.",
        "Verify the registered owner and current owner against the deed and supporting ownership documents.",
    )


# --------------------------------------------------
# RULE 3 — APPLICANT VERSUS OWNER COMPARISON
# Original ID: PROP-014
# --------------------------------------------------

def check_rule_3(registration):
    config = PROPERTY_RULES["RULE_3"]
    discrepancies = []

    applicant_name = get_value(registration, "Applicant Name")
    owner_parts = [
        get_value(registration, "Property Owner First Name"),
        get_value(registration, "Property Owner Middle Name"),
        get_value(registration, "Property Owner Last Name"),
    ]
    owner_name = " ".join(part for part in owner_parts if part).strip()

    applicant_pan = get_value(registration, "Applicant's PAN No.")
    owner_pan = get_value(registration, "Owner's PAN No.")

    if is_missing(applicant_name) or is_missing(owner_name):
        discrepancies.append(
            make_discrepancy(
                "Applicant Name / Property Owner Name",
                applicant_name or "Unavailable",
                REGISTRATION_SOURCE,
                "Property Owner First/Middle/Last Name",
                owner_name or "Unavailable",
                "Applicant or property owner name is unavailable; comparison is pending.",
            )
        )
    elif normalize(applicant_name) != normalize(owner_name):
        discrepancies.append(
            make_discrepancy(
                "Applicant Name",
                applicant_name,
                REGISTRATION_SOURCE,
                "Property Owner First/Middle/Last Name",
                owner_name,
                "Applicant name differs from the registered property owner's name. This may be legitimate and requires verification.",
            )
        )

    # Owner PAN is not present in the current LOS property schema.
    # Compare PAN only when both values are actually supplied.
    if not is_missing(applicant_pan) and not is_missing(owner_pan) and normalize(applicant_pan) != normalize(owner_pan):
        discrepancies.append(
            make_discrepancy(
                "Applicant PAN",
                applicant_pan,
                REGISTRATION_SOURCE,
                "Owner's PAN No.",
                owner_pan,
                "Applicant PAN differs from the property owner's PAN. Verify ownership and applicant relationship.",
            )
        )

    return make_rule_result(
        "RULE_3",
        config,
        discrepancies,
        "Applicant and property owner details require verification.",
        "Verify the applicant's identity and legal relationship to the property owner. A difference alone does not establish fraud.",
    )


# --------------------------------------------------
# RULE 4 — DEED AND REGISTRATION CONSISTENCY
# Original ID: PROP-015
# --------------------------------------------------

def extract_pincode(address):
    """Extract a six-digit Indian PIN code when present."""
    matches = re.findall(r"(?<!\d)\d{6}(?!\d)", str(address or ""))
    return matches[-1] if matches else ""


def check_rule_4(registration, valuation):
    config = PROPERTY_RULES["RULE_4"]
    discrepancies = []

    registration_address = get_value(
        registration, "Complete Property Address"
    )
    deed_address = get_value(valuation, "Address as per deed")

    if is_missing(registration_address) or is_missing(deed_address):
        discrepancies.append(
            make_discrepancy(
                "Property Address",
                registration_address or "Unavailable",
                VALUATION_SOURCE,
                "Address as per deed",
                deed_address or "Unavailable",
                "One or both addresses are unavailable; address verification is pending.",
            )
        )
    else:
        registration_pin = extract_pincode(registration_address)
        deed_pin = extract_pincode(deed_address)

        if registration_pin and deed_pin and registration_pin != deed_pin:
            discrepancies.append(
                make_discrepancy(
                    "Pincode",
                    registration_pin,
                    VALUATION_SOURCE,
                    "Address as per deed",
                    deed_pin,
                    "Pincode in the registered property address differs from the pincode extracted from the deed address.",
                )
            )
        elif normalize(registration_address) != normalize(deed_address):
            discrepancies.append(
                make_discrepancy(
                    "Complete Property Address",
                    registration_address,
                    VALUATION_SOURCE,
                    "Address as per deed",
                    deed_address,
                    "The complete property address differs from the address recorded in the deed. Verify the differing address components.",
                )
            )

    # Compare registration metadata only when the other record actually
    # contains a corresponding field. Do not compare a value to itself.
    comparisons = [
        ("Registration Number", "Registration Number"),
        ("Registration Date", "Registration Date"),
        ("Registered At", "Registered At"),
        ("Transaction Type", "Transaction Type"),
        ("Property Type", "Property Type"),
    ]

    for registration_field, valuation_field in comparisons:
        registration_value = get_value(registration, registration_field)
        valuation_value = get_value(valuation, valuation_field)

        if is_missing(registration_value) or is_missing(valuation_value):
            continue

        if normalize(registration_value) != normalize(valuation_value):
            discrepancies.append(
                make_discrepancy(
                    registration_field,
                    registration_value,
                    VALUATION_SOURCE,
                    valuation_field,
                    valuation_value,
                    f"{registration_field} differs between the two records.",
                )
            )

    return make_rule_result(
        "RULE_4",
        config,
        discrepancies,
        "Deed and registration information is inconsistent.",
        "Verify the conflicting address or registration detail against the original deed and LOS property record.",
    )


# --------------------------------------------------
# RULE 5 — SANCTIONED PLAN EVIDENCE
# Original ID: PROP-016
# --------------------------------------------------

def check_rule_5(valuation):
    config = PROPERTY_RULES["RULE_5"]
    discrepancies = []

    evidence_fields = [
        "Sanction plan provided",
        "Approved Map",
        "Building as per sanction plan",
    ]

    negative_values = {"no", "false", "0", "not provided", "not available"}

    for field in evidence_fields:
        value = get_value(valuation, field)

        if is_missing(value):
            discrepancies.append(
                make_discrepancy(
                    field,
                    "Not provided",
                    VALUATION_SOURCE,
                    field,
                    "Unavailable",
                    f"Evidence field '{field}' is missing; verification is pending.",
                )
            )
        elif normalize(value) in negative_values:
            discrepancies.append(
                make_discrepancy(
                    field,
                    value,
                    VALUATION_SOURCE,
                    field,
                    value,
                    f"The vendor valuation report indicates a negative or absent result for '{field}'.",
                )
            )

    return make_rule_result(
        "RULE_5",
        config,
        discrepancies,
        "Sanctioned-plan evidence requires review.",
        "Obtain or verify the sanctioned plan and confirm whether the building conforms to it.",
    )



def check_rule_6(registration, valuation):
    """PROP-020: Compare registration, deed, and inspection addresses."""

    rule_config = PROPERTY_RULES["RULE_6"]
    discrepancies = []

    addresses = [
        (
            "LOS Property Record",
            "Complete Property Address",
            get_value(registration, "Complete Property Address"),
        ),
        (
            "Vendor Valuation Report",
            "Address as per deed",
            get_value(valuation, "Address as per deed"),
        ),
        (
            "Vendor Valuation Report",
            "Inspection address",
            get_value(valuation, "Inspection address"),
        ),
    ]

    available_addresses = []

    # Missing values are reported as pending verification.
    for source, source_field, value in addresses:
        if is_missing(value):
            discrepancies.append(
                make_discrepancy(
                    field="Property Address",
                    applicant_value=None,
                    source=source,
                    source_field=source_field,
                    source_value=value,
                    reason=(
                        f"Verification pending: {source_field} "
                        f"is missing from {source}."
                    ),
                )
            )
        else:
            available_addresses.append(
                (source, source_field, value)
            )

    # Compare each available address with the first available address.
    if len(available_addresses) >= 2:
        baseline_source, baseline_field, baseline_value = (
            available_addresses[0]
        )

        for source, source_field, value in available_addresses[1:]:
            if normalize(value) != normalize(baseline_value):
                discrepancies.append(
                    make_discrepancy(
                        field="Property Address",
                        applicant_value=baseline_value,
                        source=source,
                        source_field=source_field,
                        source_value=value,
                        reason=(
                            f"Address mismatch: {baseline_source} "
                            f"({baseline_field}) differs from "
                            f"{source} ({source_field})."
                        ),
                    )
                )

    return make_rule_result(
        rule_key="RULE_6",
        rule_config=rule_config,
        discrepancies=discrepancies,
        issue="Property address inconsistency or missing address data",
        action=(
            "Verify the registration, deed, and inspection addresses "
            "against the original property documents."
        ),
    )



def check_rule_7(registration, valuation):
    """PROP-021: Compare postal and location fields across records."""

    rule_config = PROPERTY_RULES["RULE_7"]
    discrepancies = []



    field_pairs = [
    ("Pin Code", "Pincode", "PIN code"),
    ("City/Town/Village", "City", "City"),
    ("State", "State", "State"),
    ("Nearest Landmark", "Landmark", "Landmark"),
]

    for registration_field, valuation_field, display_name in field_pairs:
        registration_value = get_value(registration, registration_field)
        valuation_value = get_value(valuation, valuation_field)

        # Missing values require verification; they are not confirmed mismatches.
        if is_missing(registration_value):
            discrepancies.append(
                make_discrepancy(
                    field=display_name,
                    applicant_value=None,
                    source="LOS Property Record",
                    source_field=registration_field,
                    source_value=registration_value,
                    reason=(
                        f"Verification pending: {registration_field} "
                        "is missing from the LOS Property Record."
                    ),
                )
            )
            continue

        if is_missing(valuation_value):
            discrepancies.append(
                make_discrepancy(
                    field=display_name,
                    applicant_value=registration_value,
                    source="Vendor Valuation Report",
                    source_field=valuation_field,
                    source_value=valuation_value,
                    reason=(
                        f"Verification pending: {valuation_field} "
                        "is missing from the Vendor Valuation Report."
                    ),
                )
            )
            continue

        if normalize(registration_value) != normalize(valuation_value):
            discrepancies.append(
                make_discrepancy(
                    field=display_name,
                    applicant_value=registration_value,
                    source="Vendor Valuation Report",
                    source_field=valuation_field,
                    source_value=valuation_value,
                    reason=(
                        f"{display_name} mismatch: Property Registration "
                        f"has '{registration_value}', while Technical "
                        f"Valuation has '{valuation_value}'."
                    ),
                )
            )

    return make_rule_result(
        rule_key="RULE_7",
        rule_config=rule_config,
        discrepancies=discrepancies,
        issue="Postal or location information is inconsistent or incomplete",
        action=(
    "Verify the PIN code, city, state, and landmark against "
    "the property documents and inspection records."
),
    )


def check_rule_8(registration, valuation):
    """PROP-022: Compare unit identifiers and address lines."""

    rule_config = PROPERTY_RULES["RULE_8"]
    discrepancies = []

    # Compare unit number against both possible valuation fields.
    registration_unit = get_value(registration, "Flat No./House No.")
    valuation_unit = get_value(valuation, "Flat No./House No.")
    valuation_unit_alt = get_value(valuation, "House no / Flat no")

    available_valuation_units = [
        (field, value)
        for field, value in [
            ("Flat No./House No.", valuation_unit),
            ("House no / Flat no", valuation_unit_alt),
        ]
        if not is_missing(value)
    ]

    if is_missing(registration_unit):
        discrepancies.append(
            make_discrepancy(
                field="Unit Identification",
                applicant_value=None,
                source="LOS Property Record",
                source_field="Flat No./House No.",
                source_value=registration_unit,
                reason="Verification pending: registration unit number is missing.",
            )
        )
    elif not available_valuation_units:
        discrepancies.append(
            make_discrepancy(
                field="Unit Identification",
                applicant_value=registration_unit,
                source="Vendor Valuation Report",
                source_field="Flat No./House No.; House no / Flat no",
                source_value=None,
                reason="Verification pending: valuation unit number is missing.",
            )
        )
    else:
        for source_field, source_value in available_valuation_units:
            if normalize(registration_unit) != normalize(source_value):
                discrepancies.append(
                    make_discrepancy(
                        field="Unit Identification",
                        applicant_value=registration_unit,
                        source="Vendor Valuation Report",
                        source_field=source_field,
                        source_value=source_value,
                        reason=(
                            f"Unit number mismatch: registration value "
                            f"'{registration_unit}' differs from valuation "
                            f"value '{source_value}'."
                        ),
                    )
                )

    # Compare address lines between the two records.
    address_line_pairs = [
        ("Address Line 1", "Address Line 1"),
        ("Address Line 2", "Address Line 2"),
    ]

    for registration_field, valuation_field in address_line_pairs:
        registration_value = get_value(registration, registration_field)
        valuation_value = get_value(valuation, valuation_field)

        if is_missing(registration_value) and is_missing(valuation_value):
            # Neither record has this optional address line.
            continue

        if is_missing(registration_value):
            discrepancies.append(
                make_discrepancy(
                    field=registration_field,
                    applicant_value=None,
                    source="LOS Property Record",
                    source_field=registration_field,
                    source_value=registration_value,
                    reason=(
                        "Verification pending: address line is missing "
                        "from the LOS property record."
                    ),
                )
            )
            continue

        if is_missing(valuation_value):
            # Vendor response contains one inspection address, not split lines.
            # Address comparison is handled by RULE_6.
            continue

        if normalize(registration_value) != normalize(valuation_value):
            discrepancies.append(
                make_discrepancy(
                    field=registration_field,
                    applicant_value=registration_value,
                    source="Vendor Valuation Report",
                    source_field=valuation_field,
                    source_value=valuation_value,
                    reason=(
                        f"{registration_field} mismatch between "
                        "LOS and vendor valuation."
                    ),
                )
            )

    return make_rule_result(
        rule_key="RULE_8",
        rule_config=rule_config,
        discrepancies=discrepancies,
        issue="Unit identification or address-line information is inconsistent or incomplete",
        action=(
            "Verify the flat/house number and address lines against "
            "the registered deed and technical inspection records."
        ),
    )


def check_rule_9(registration, valuation):
    """PROP-023: Validate applicant, property, and asset record linkage."""

    rule_config = PROPERTY_RULES["RULE_9"]
    discrepancies = []

    # 1. Reference ID must be present in both records and must match.
    registration_ref = get_value(registration, "Reference ID")
    valuation_ref = get_value(valuation, "Reference ID")

    if is_missing(registration_ref):
        discrepancies.append(
            make_discrepancy(
                field="Reference ID",
                applicant_value=None,
                source="LOS Property Record",
                source_field="Reference ID",
                source_value=registration_ref,
                reason="Verification pending: registration Reference ID is missing.",
            )
        )

    if is_missing(valuation_ref):
        discrepancies.append(
            make_discrepancy(
                field="Reference ID",
                applicant_value=registration_ref,
                source="Vendor Valuation Report",
                source_field="Reference ID",
                source_value=valuation_ref,
                reason="Verification pending: valuation Reference ID is missing.",
            )
        )

    if (
        not is_missing(registration_ref)
        and not is_missing(valuation_ref)
        and normalize(registration_ref) != normalize(valuation_ref)
    ):
        discrepancies.append(
            make_discrepancy(
                field="Reference ID",
                applicant_value=registration_ref,
                source="Vendor Valuation Report",
                source_field="Reference ID",
                source_value=valuation_ref,
                reason="Reference ID mismatch between registration and valuation records.",
            )
        )

    # 2. Applicant names must match across both records.
    registration_applicant = get_value(registration, "Applicant Name")
    valuation_applicant = get_value(valuation, "Applicant Name")

    if is_missing(registration_applicant):
        discrepancies.append(
            make_discrepancy(
                field="Applicant Name",
                applicant_value=None,
                source="LOS Property Record",
                source_field="Applicant Name",
                source_value=registration_applicant,
                reason="Verification pending: applicant name is missing from the LOS property record.",
            )
        )

    if is_missing(valuation_applicant):
        discrepancies.append(
            make_discrepancy(
                field="Applicant Name",
                applicant_value=registration_applicant,
                source="Vendor Valuation Report",
                source_field="Applicant Name",
                source_value=valuation_applicant,
                reason="Verification pending: applicant name is missing from the valuation record.",
            )
        )

    if (
        not is_missing(registration_applicant)
        and not is_missing(valuation_applicant)
        and normalize(registration_applicant) != normalize(valuation_applicant)
    ):
        discrepancies.append(
            make_discrepancy(
                field="Applicant Name",
                applicant_value=registration_applicant,
                source="Vendor Valuation Report",
                source_field="Applicant Name",
                source_value=valuation_applicant,
                reason="Applicant name mismatch between registration and valuation records.",
            )
        )

    # 3. Asset ID must be available in the LOS property record.
    asset_id = get_value(registration, "Asset Id")

    if is_missing(asset_id):
        discrepancies.append(
            make_discrepancy(
                field="Asset Id",
                applicant_value=None,
                source="LOS Property Record",
                source_field="Asset Id",
                source_value=asset_id,
                reason="Verification pending: Asset Id is missing from the LOS property record.",
            )
        )

    return make_rule_result(
        rule_key="RULE_9",
        rule_config=rule_config,
        discrepancies=discrepancies,
        issue="Applicant, property, or asset record linkage is inconsistent or incomplete",
        action=(
            "Verify the Reference ID, applicant identity, and Asset Id "
            "against the property and loan application records."
        ),
    )

def check_rule_10(registration, valuation):
    """PROP-024: Compare property nature and type when vendor supplies both."""
    rule_key = "RULE_10"
    rule_config = PROPERTY_RULES[rule_key]
    discrepancies = []

    registration_type = get_value(registration, "Property Type")
    valuation_type = get_value(valuation, "Property Type")
    if not is_missing(registration_type) and not is_missing(valuation_type) and normalize(registration_type) != normalize(valuation_type):
        discrepancies.append(make_discrepancy(
            "Property Type", registration_type, VALUATION_SOURCE,
            "Property Type", valuation_type,
            "Property type differs between LOS and vendor valuation data."
        ))

    registration_nature = get_value(registration, "Property Nature")
    valuation_nature = get_value(valuation, "Property nature as per document")
    if not is_missing(registration_nature) and not is_missing(valuation_nature) and normalize(registration_nature) != normalize(valuation_nature):
        discrepancies.append(make_discrepancy(
            "Property Nature", registration_nature, VALUATION_SOURCE,
            "Property nature as per document", valuation_nature,
            "Property nature differs between LOS and vendor valuation data."
        ))

    return make_rule_result(rule_key, rule_config, discrepancies,
        "Property type or nature differs between LOS and vendor information.",
        "Review the property classification against the deed and inspection report.")

def check_rule_11(registration, valuation):
    """PROP-030: Compare LOS property usage with vendor property usage."""
    rule_key = "RULE_11"
    rule_config = PROPERTY_RULES[rule_key]
    discrepancies = []
    los_usage = get_value(registration, "Property Usage")
    vendor_usage = get_value(valuation, "Property Usage")
    if is_missing(los_usage) or is_missing(vendor_usage):
        discrepancies.append(make_discrepancy(
            "Property Usage", los_usage or "Unavailable", VALUATION_SOURCE,
            "Property Usage", vendor_usage or "Unavailable",
            "Property usage comparison is pending because one of the values is unavailable."
        ))
    elif normalize(los_usage) != normalize(vendor_usage):
        discrepancies.append(make_discrepancy(
            "Property Usage", los_usage, VALUATION_SOURCE,
            "Property Usage", vendor_usage,
            "Property usage differs between LOS and vendor inspection."
        ))
    return make_rule_result(rule_key, rule_config, discrepancies,
        "Property usage is inconsistent or incomplete.",
        "Confirm the property's actual use during inspection and against LOS records.")

def check_rule_12(registration, valuation):
    rule_key = "RULE_12"
    rule_config = PROPERTY_RULES[rule_key]
    discrepancies = []

    registration_value = get_value(registration, "Property Nature")
    valuation_value = get_value(
        valuation, "Property nature as per document"
    )

    if is_missing(registration_value) or is_missing(valuation_value):
        discrepancies.append(
            make_discrepancy(
                field="Property Nature",
                applicant_value=registration_value,
                source="Vendor Valuation Report",
                source_field="Property nature as per document",
                source_value=valuation_value,
                reason="Property nature verification pending because a value is missing.",
            )
        )
    elif normalize(registration_value) != normalize(valuation_value):
        discrepancies.append(
            make_discrepancy(
                field="Property Nature",
                applicant_value=registration_value,
                source="Vendor Valuation Report",
                source_field="Property nature as per document",
                source_value=valuation_value,
                reason="Property nature differs between registration and valuation records.",
            )
        )

    return make_rule_result(
        rule_key,
        rule_config,
        discrepancies,
        issue="Property nature is inconsistent or incomplete.",
        action="Review the registered property nature against the technical valuation document.",
    )

def check_rule_13(registration, valuation):
    """PROP-032: Validate vendor occupancy and tenant-count consistency.

    The current LOS property table stores ownership, not a dedicated
    occupancy field, so it is not compared directly with vendor occupancy.
    """
    rule_key = "RULE_13"
    rule_config = PROPERTY_RULES[rule_key]
    discrepancies = []
    occupancy = get_value(valuation, "Property Occupancy")
    tenant_count = get_value(valuation, "No of tenants")

    if is_missing(occupancy):
        discrepancies.append(make_discrepancy(
            "Property Occupancy", None, VALUATION_SOURCE,
            "Property Occupancy", occupancy,
            "Vendor property occupancy is missing."
        ))

    if is_missing(tenant_count):
        discrepancies.append(make_discrepancy(
            "Number Of Tenants", None, VALUATION_SOURCE,
            "Number Of Tenants", tenant_count,
            "Vendor tenant count is missing."
        ))
    else:
        try:
            count = int(float(str(tenant_count).replace(",", "")))
            if count < 0:
                raise ValueError
            if normalize(occupancy) == "self occupied" and count > 0:
                discrepancies.append(make_discrepancy(
                    "Property Occupancy / Number Of Tenants", occupancy,
                    VALUATION_SOURCE, "Number Of Tenants", tenant_count,
                    "A self-occupied property has a positive tenant count. Confirm the occupancy classification."
                ))
            elif normalize(occupancy) == "rented" and count == 0:
                discrepancies.append(make_discrepancy(
                    "Property Occupancy / Number Of Tenants", occupancy,
                    VALUATION_SOURCE, "Number Of Tenants", tenant_count,
                    "Property is marked rented but the tenant count is zero. Confirm the inspection details."
                ))
        except (ValueError, TypeError):
            discrepancies.append(make_discrepancy(
                "Number Of Tenants", None, VALUATION_SOURCE,
                "Number Of Tenants", tenant_count,
                "Number of tenants must be a non-negative whole number."
            ))

    return make_rule_result(rule_key, rule_config, discrepancies,
        "Occupancy or tenant information requires review.",
        "Confirm occupancy status and tenant count during the property inspection.")

def check_rule_14(valuation):
    rule_key = "RULE_14"
    rule_config = PROPERTY_RULES[rule_key]
    discrepancies = []

    fields = [
        ("Sanction plan provided", "Sanction plan provided"),
        ("Approved Map", "Approved Map"),
        ("Building as per sanction plan", "Building as per sanction plan"),
    ]

    for field, source_field in fields:
        value = get_value(valuation, source_field)

        if is_missing(value):
            discrepancies.append(
                make_discrepancy(
                    field=field,
                    applicant_value=None,
                    source="Vendor Valuation Report",
                    source_field=source_field,
                    source_value=value,
                    reason="Sanctioned-plan verification pending because the value is missing.",
                )
            )
            continue

        normalized_value = normalize(value)

        if field == "Building as per sanction plan":
            negative_values = {
                "no", "false", "not as per plan",
                "not approved", "non compliant",
            }

            if normalized_value in negative_values:
                discrepancies.append(
                    make_discrepancy(
                        field=field,
                        applicant_value=None,
                        source="Vendor Valuation Report",
                        source_field=source_field,
                        source_value=value,
                        reason="The building is recorded as not being as per the sanctioned plan.",
                    )
                )

    return make_rule_result(
        rule_key,
        rule_config,
        discrepancies,
        issue="Sanctioned-plan evidence is incomplete or indicates a potential inconsistency.",
        action="Verify the sanctioned plan, approved map, and building compliance with the supporting documents.",
    )

def check_rule_15(valuation):
    rule_key = "RULE_15"
    rule_config = PROPERTY_RULES[rule_key]
    discrepancies = []

    residual_age = get_value(valuation, "Residual Age")
    property_condition = get_value(valuation, "Condition of property")
    property_type = get_value(valuation, "Property Type (LOS request)") or get_value(valuation, "Property Type")

    if is_missing(residual_age):
        discrepancies.append(
            make_discrepancy(
                field="Residual Age",
                applicant_value=None,
                source="Vendor Valuation Report",
                source_field="Residual Age",
                source_value=residual_age,
                reason="Property age validation pending because residual age is missing.",
            )
        )
    else:
        try:
            age_value = float(str(residual_age).strip())

            if age_value < 0:
                discrepancies.append(
                    make_discrepancy(
                        field="Residual Age",
                        applicant_value=None,
                        source="Vendor Valuation Report",
                        source_field="Residual Age",
                        source_value=residual_age,
                        reason="Residual age cannot be negative.",
                    )
                )
        except (ValueError, TypeError):
            discrepancies.append(
                make_discrepancy(
                    field="Residual Age",
                    applicant_value=None,
                    source="Vendor Valuation Report",
                    source_field="Residual Age",
                    source_value=residual_age,
                    reason="Residual age is not a valid numeric value.",
                )
            )

    if is_missing(property_condition):
        discrepancies.append(
            make_discrepancy(
                field="Property condition",
                applicant_value=None,
                source="Vendor Valuation Report",
                source_field="Property condition",
                source_value=property_condition,
                reason="Property condition verification pending because the value is missing.",
            )
        )

    if is_missing(property_type):
        discrepancies.append(
            make_discrepancy(
                field="Property Type",
                applicant_value=None,
                source="Vendor Valuation Report",
                source_field="Property Type",
                source_value=property_type,
                reason="Property-type verification pending because the value is missing.",
            )
        )

    return make_rule_result(
        rule_key,
        rule_config,
        discrepancies,
        issue="Property age or condition information is incomplete or invalid.",
        action="Verify residual age, property condition, and applicable property-type eligibility against the lending policy.",
    )

def check_rule_16(valuation):
    rule_key = "RULE_16"
    rule_config = PROPERTY_RULES[rule_key]
    discrepancies = []

    area_fields = [
        "Land Area as per Deed",
        "Built up Area",
        "Carpet Area",
    ]

    for field in area_fields:
        value = get_value(valuation, field)

        if is_missing(value):
            discrepancies.append(
                make_discrepancy(
                    field=field,
                    applicant_value=None,
                    source="Vendor Valuation Report",
                    source_field=field,
                    source_value=value,
                    reason="Area verification pending because the value is missing.",
                )
            )
            continue

        try:
            numeric_value = float(str(value).replace(",", "").strip())

            if numeric_value < 0:
                reason = "Area cannot be negative."
            else:
                continue

        except (ValueError, TypeError):
            reason = "Area must contain a valid numeric value."

        discrepancies.append(
            make_discrepancy(
                field=field,
                applicant_value=None,
                source="Vendor Valuation Report",
                source_field=field,
                source_value=value,
                reason=reason,
            )
        )

    return make_rule_result(
        rule_key,
        rule_config,
        discrepancies,
        issue="One or more property-area inputs are missing or invalid.",
        action="Verify the area measurements against the property deed and valuation report.",
    )

def check_rule_17(valuation):
    rule_key = "RULE_17"
    rule_config = PROPERTY_RULES[rule_key]
    discrepancies = []

    sqft_value = get_value(valuation, "Carpet area in sq.ft")
    carpet_value = get_value(valuation, "Carpet Area")

    if is_missing(sqft_value) or is_missing(carpet_value):
        discrepancies.append(
            make_discrepancy(
                field="Carpet Area",
                applicant_value=sqft_value,
                source="Vendor Valuation Report",
                source_field="Carpet Area",
                source_value=carpet_value,
                reason="Carpet-area consistency verification pending because a value is missing.",
            )
        )
    else:
        try:
            sqft_numeric = float(str(sqft_value).replace(",", "").strip())
            carpet_numeric = float(str(carpet_value).replace(",", "").strip())

            if sqft_numeric < 0 or carpet_numeric < 0:
                reason = "Carpet area cannot be negative."
            elif abs(sqft_numeric - carpet_numeric) > 0.01:
                reason = "Carpet-area values differ between the two fields."
            else:
                reason = None

        except (ValueError, TypeError):
            reason = "Carpet-area values must be numeric."

        if reason:
            discrepancies.append(
                make_discrepancy(
                    field="Carpet Area",
                    applicant_value=sqft_value,
                    source="Vendor Valuation Report",
                    source_field="Carpet Area",
                    source_value=carpet_value,
                    reason=reason,
                )
            )

    return make_rule_result(
        rule_key,
        rule_config,
        discrepancies,
        issue="Carpet-area values are inconsistent or invalid.",
        action="Verify both carpet-area measurements and their units in the valuation report.",
    )

def check_rule_18(valuation):
    rule_key = "RULE_18"
    rule_config = PROPERTY_RULES[rule_key]
    discrepancies = []

    field = "Area Adopted For Valuation"
    value = get_value(valuation, field)

    if is_missing(value):
        reason = "Adopted-area verification pending because the value is missing."
    else:
        try:
            numeric_value = float(str(value).replace(",", "").strip())

            if numeric_value < 0:
                reason = "Area adopted for valuation cannot be negative."
            else:
                reason = None

        except (ValueError, TypeError):
            reason = "Area adopted for valuation must be numeric."

    if reason:
        discrepancies.append(
            make_discrepancy(
                field=field,
                applicant_value=None,
                source="Vendor Valuation Report",
                source_field=field,
                source_value=value,
                reason=reason,
            )
        )

    return make_rule_result(
        rule_key,
        rule_config,
        discrepancies,
        issue="Area adopted for valuation is missing or invalid.",
        action="Verify the adopted area and confirm that it follows the applicable valuation methodology.",
    )


def check_rule_19(valuation):
    """PROP-043: Validate valuation rates."""
    rule_key = "RULE_19"
    config = PROPERTY_RULES[rule_key]
    fields = config["fields"]
    settings = config.get("settings", {})
    discrepancies = []

    for field_key, field_name in fields.items():
        value = get_value(valuation, field_name)

        if is_missing(value):
            if settings.get("flag_missing_fields", True):
                discrepancies.append(
                    make_discrepancy(
                        field=field_name,
                        applicant_value=None,
                        source="Vendor Valuation Report",
                        source_field=field_name,
                        source_value=value,
                        reason=f"Verification pending: {field_name} is missing.",
                    )
                )
            continue

        number = parse_numeric_value(value)

        if number is None:
            discrepancies.append(
                make_discrepancy(
                    field=field_name,
                    applicant_value=value,
                    source="Vendor Valuation Report",
                    source_field=field_name,
                    source_value=value,
                    reason=f"{field_name} must contain a valid numeric rate.",
                )
            )
        elif settings.get("flag_negative_values", True) and number < 0:
            discrepancies.append(
                make_discrepancy(
                    field=field_name,
                    applicant_value=value,
                    source="Vendor Valuation Report",
                    source_field=field_name,
                    source_value=value,
                    reason=f"{field_name} cannot be negative.",
                )
            )
        elif number == 0 and not settings.get("allow_zero", True):
            discrepancies.append(
                make_discrepancy(
                    field=field_name,
                    applicant_value=value,
                    source="Vendor Valuation Report",
                    source_field=field_name,
                    source_value=value,
                    reason=f"{field_name} must be greater than zero.",
                )
            )

    return make_rule_result(
        rule_key,
        config,
        discrepancies,
        issue="One or more valuation rates are missing or invalid.",
        action="Verify the land rate, construction rate, and government-approved rate.",
    )



def check_rule_20(valuation):
    """PROP-044: Reconcile calculated and recorded market value."""
    rule_key = "RULE_20"
    config = PROPERTY_RULES[rule_key]
    fields = config["fields"]
    settings = config.get("settings", {})
    discrepancies = []

    # Decide which inputs are needed for this calculation.
    input_keys = []

    if settings.get("calculate_land_value", True):
        input_keys.extend(["land_area", "land_rate"])

    if settings.get("calculate_construction_value", True):
        input_keys.extend(["construction_area", "construction_rate"])

    input_keys.append("current_market_value")

    values = {}
    inputs_valid = True

    for key in input_keys:
        field_name = fields[key]
        raw_value = get_value(valuation, field_name)

        if is_missing(raw_value):
            inputs_valid = False
            if settings.get("flag_missing_fields", True):
                discrepancies.append(
                    make_discrepancy(
                        field=field_name,
                        applicant_value=None,
                        source="Vendor Valuation Report",
                        source_field=field_name,
                        source_value=raw_value,
                        reason=f"Verification pending: {field_name} is missing.",
                    )
                )
            continue

        number = parse_numeric_value(raw_value)

        if number is None:
            inputs_valid = False
            discrepancies.append(
                make_discrepancy(
                    field=field_name,
                    applicant_value=raw_value,
                    source="Vendor Valuation Report",
                    source_field=field_name,
                    source_value=raw_value,
                    reason=f"{field_name} must contain a valid numeric value.",
                )
            )
            continue

        if settings.get("flag_negative_values", True) and number < 0:
            inputs_valid = False
            discrepancies.append(
                make_discrepancy(
                    field=field_name,
                    applicant_value=raw_value,
                    source="Vendor Valuation Report",
                    source_field=field_name,
                    source_value=raw_value,
                    reason=f"{field_name} cannot be negative.",
                )
            )
            continue

        values[key] = number

    # Do not calculate using incomplete or invalid inputs.
    if inputs_valid:
        calculated_total = 0.0

        if settings.get("calculate_land_value", True):
            calculated_total += (
                values["land_area"] * values["land_rate"]
            )

        if settings.get("calculate_construction_value", True):
            calculated_total += (
                values["construction_area"] * values["construction_rate"]
            )

        recorded_value = values["current_market_value"]
        tolerance_percent = float(
            settings.get("tolerance_percent", 5.0)
        )

        difference = abs(calculated_total - recorded_value)

        if recorded_value != 0:
            difference_percent = difference / abs(recorded_value) * 100
            exceeds_tolerance = difference_percent > tolerance_percent
        else:
            difference_percent = 0.0 if calculated_total == 0 else None
            exceeds_tolerance = calculated_total != 0

        if exceeds_tolerance:
            discrepancies.append(
                make_discrepancy(
                    field="Current Market Value",
                    applicant_value=round(calculated_total, 2),
                    source="Vendor Valuation Report",
                    source_field=fields["current_market_value"],
                    source_value=recorded_value,
                    reason=(
                        f"Calculated value is {calculated_total:.2f}, "
                        f"but recorded market value is {recorded_value:.2f}. "
                        f"Difference exceeds the configured "
                        f"{tolerance_percent}% tolerance."
                    ),
                )
            )

    return make_rule_result(
        rule_key,
        config,
        discrepancies,
        issue="Market value is inconsistent with the available valuation inputs.",
        action="Verify the land area, land rate, built-up area, construction rate, and recorded market value.",
    )



def check_rule_21(valuation):
    """PROP-045: Review value to be considered against market value."""
    rule_key = "RULE_21"
    config = PROPERTY_RULES[rule_key]
    fields = config["fields"]
    settings = config.get("settings", {})
    discrepancies = []
    values = {}
    valid = True

    for key in ("current_market_value", "value_to_be_considered"):
        field_name = fields[key]
        raw_value = get_value(valuation, field_name)

        if is_missing(raw_value):
            valid = False
            if settings.get("flag_missing_fields", True):
                discrepancies.append(
                    make_discrepancy(
                        field=field_name,
                        applicant_value=None,
                        source="Vendor Valuation Report",
                        source_field=field_name,
                        source_value=raw_value,
                        reason=f"Verification pending: {field_name} is missing.",
                    )
                )
            continue

        number = parse_numeric_value(raw_value)

        if number is None:
            valid = False
            discrepancies.append(
                make_discrepancy(
                    field=field_name,
                    applicant_value=raw_value,
                    source="Vendor Valuation Report",
                    source_field=field_name,
                    source_value=raw_value,
                    reason=f"{field_name} must be numeric.",
                )
            )
        elif settings.get("flag_negative_values", True) and number < 0:
            valid = False
            discrepancies.append(
                make_discrepancy(
                    field=field_name,
                    applicant_value=raw_value,
                    source="Vendor Valuation Report",
                    source_field=field_name,
                    source_value=raw_value,
                    reason=f"{field_name} cannot be negative.",
                )
            )
        else:
            values[key] = number

    if valid:
        market_value = values["current_market_value"]
        considered_value = values["value_to_be_considered"]
        difference = abs(market_value - considered_value)
        tolerance_percent = float(
            settings.get("tolerance_percent", 5.0)
        )

        if market_value != 0:
            difference_percent = difference / abs(market_value) * 100
            exceeds_tolerance = difference_percent > tolerance_percent
        else:
            exceeds_tolerance = considered_value != 0

        if exceeds_tolerance:
            discrepancies.append(
                make_discrepancy(
                    field="value to be considered",
                    applicant_value=market_value,
                    source="Vendor Valuation Report",
                    source_field=fields["value_to_be_considered"],
                    source_value=considered_value,
                    reason=(
                        f"Value to be considered differs from Current Market "
                        f"Value by more than the configured "
                        f"{tolerance_percent}% tolerance."
                    ),
                )
            )

    return make_rule_result(
        rule_key,
        config,
        discrepancies,
        issue="Value to be considered requires verification against market value.",
        action="Review Current Market Value and value to be considered against the valuation policy.",
    )



def check_rule_22(valuation):
    """PROP-046: Validate valuation date and review fields."""
    rule_key = "RULE_22"
    config = PROPERTY_RULES[rule_key]
    fields = config["fields"]
    settings = config.get("settings", {})
    discrepancies = []

    # Validate valuation date.
    date_field = fields["valuation_date"]
    date_value = get_value(valuation, date_field)

    if is_missing(date_value):
        if settings.get("require_valuation_date", True):
            discrepancies.append(
                make_discrepancy(
                    field=date_field,
                    applicant_value=None,
                    source="Vendor Valuation Report",
                    source_field=date_field,
                    source_value=date_value,
                    reason="Valuation date is missing.",
                )
            )
    elif not is_valid_valuation_date(date_value):
        discrepancies.append(
            make_discrepancy(
                field=date_field,
                applicant_value=date_value,
                source="Vendor Valuation Report",
                source_field=date_field,
                source_value=date_value,
                reason=(
                    "Valuation date is invalid. Use a supported date "
                    "format such as YYYY-MM-DD or DD/MM/YYYY."
                ),
            )
        )

    # Validate configured required fields.
    for key, setting_name in (
        ("technical_valuation_2", "require_technical_valuation_2"),
        ("remarks", "require_remarks"),
    ):
        field_name = fields[key]
        value = get_value(valuation, field_name)

        if settings.get(setting_name, False) and is_missing(value):
            discrepancies.append(
                make_discrepancy(
                    field=field_name,
                    applicant_value=None,
                    source="Vendor Valuation Report",
                    source_field=field_name,
                    source_value=value,
                    reason=f"{field_name} is required but missing.",
                )
            )

    # Remarks length validation.
    remarks_field = fields["remarks"]
    remarks_value = get_value(valuation, remarks_field)

    if not is_missing(remarks_value):
        max_length = int(settings.get("max_remarks_length", 10000))

        if len(str(remarks_value)) > max_length:
            discrepancies.append(
                make_discrepancy(
                    field=remarks_field,
                    applicant_value=len(str(remarks_value)),
                    source="Vendor Valuation Report",
                    source_field=remarks_field,
                    source_value=remarks_value,
                    reason=(
                        f"Remarks exceed the configured maximum length "
                        f"of {max_length} characters."
                    ),
                )
            )

    return make_rule_result(
        rule_key,
        config,
        discrepancies,
        issue="Valuation date or remarks information is incomplete or invalid.",
        action="Verify the valuation date and review the valuation remarks.",
    )



# --------------------------------------------------
# RUN RULES AGAINST DATABASE + VENDOR DATA
# --------------------------------------------------

_RULE_LOCK = threading.RLock()


def evaluate_property_records(reference_id, registration, valuation,
                              rule_configs=None, rule_settings=None, *,
                              default_rules, default_settings):
    """Run the 22-rule engine against normalized LOS/vendor dicts.

    default_rules / default_settings are the catalogue from conf/ (config.py);
    rule_configs (the saved rule rows) override enabled, sequence, name,
    original_id, severity, settings and fields of the rules they name.
    """
    global PROPERTY_RULES, PROPERTY_RULE_SETTINGS

    with _RULE_LOCK:
        original_rules = PROPERTY_RULES
        original_settings = PROPERTY_RULE_SETTINGS
        effective_rules = deepcopy(default_rules)
        if rule_configs:
            for rule_key, db_config in rule_configs.items():
                if rule_key in effective_rules:
                    effective_rules[rule_key].update({
                        key: deepcopy(value)
                        for key, value in db_config.items()
                        if key in {"enabled", "sequence", "name", "original_id", "severity", "settings", "fields"}
                    })
        effective_settings = deepcopy(default_settings)
        if rule_settings:
            effective_settings.update(rule_settings)

        PROPERTY_RULES = effective_rules
        PROPERTY_RULE_SETTINGS = effective_settings
        try:
            rule_functions = {
                "RULE_1": lambda: check_rule_1(registration),
                "RULE_2": lambda: check_rule_2(registration, valuation),
                "RULE_3": lambda: check_rule_3(registration),
                "RULE_4": lambda: check_rule_4(registration, valuation),
                "RULE_5": lambda: check_rule_5(valuation),
                "RULE_6": lambda: check_rule_6(registration, valuation),
                "RULE_7": lambda: check_rule_7(registration, valuation),
                "RULE_8": lambda: check_rule_8(registration, valuation),
                "RULE_9": lambda: check_rule_9(registration, valuation),
                "RULE_10": lambda: check_rule_10(registration, valuation),
                "RULE_11": lambda: check_rule_11(registration, valuation),
                "RULE_12": lambda: check_rule_12(registration, valuation),
                "RULE_13": lambda: check_rule_13(registration, valuation),
                "RULE_14": lambda: check_rule_14(valuation),
                "RULE_15": lambda: check_rule_15(valuation),
                "RULE_16": lambda: check_rule_16(valuation),
                "RULE_17": lambda: check_rule_17(valuation),
                "RULE_18": lambda: check_rule_18(valuation),
                "RULE_19": lambda: check_rule_19(valuation),
                "RULE_20": lambda: check_rule_20(valuation),
                "RULE_21": lambda: check_rule_21(valuation),
                "RULE_22": lambda: check_rule_22(valuation),
            }

            enabled_rules = sorted(
                ((key, rule) for key, rule in PROPERTY_RULES.items()
                 if rule.get("enabled", True)),
                key=lambda item: item[1].get("sequence", 999),
            )
            results = []
            for rule_key, rule_config in enabled_rules:
                if rule_key not in rule_functions:
                    continue
                result = rule_functions[rule_key]()
                result["severity"] = rule_config.get("severity", "MAJOR")
                results.append(result)
                if PROPERTY_RULE_SETTINGS.get("stop_on_first_failure", False) and result["triggered"]:
                    break

            return {
                "reference_id": reference_id,
                "registration_source": REGISTRATION_SOURCE,
                "valuation_source": VALUATION_SOURCE,
                "rules_checked": len(results),
                "rules_triggered": sum(1 for item in results if item["triggered"]),
                "results": results,
            }
        finally:
            PROPERTY_RULES = original_rules
            PROPERTY_RULE_SETTINGS = original_settings
