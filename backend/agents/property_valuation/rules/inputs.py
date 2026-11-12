"""
LOS + VENDOR FIELDS -> RULE INPUTS (pure). The LOS property row and the vendor request / response use their own field
names; the rule engine works on its own labels. Missing LOS fields are left blank, never invented (README "Field
mapping").
"""

from __future__ import annotations


def _complete_address(property_row: dict) -> str:
    return " ".join(str(x).strip() for x in [
        property_row.get("house_flat_number"), property_row.get("address_line_1"),
        property_row.get("address_line_2"), property_row.get("landmark"),
        property_row.get("city"), property_row.get("state"), property_row.get("pincode")
    ] if x)


def build_vendor_request(property_row: dict, applicant_name: str | None, applicant_pan: str | None = None):
    """The prefill of what is sent to the valuation vendor."""
    docs = property_row.get("documents") or []
    doc_names = [str(d.get("document_name") or "").casefold() for d in docs]
    deed_uploaded = any("deed" in name or "sale" in name for name in doc_names)
    map_uploaded = any("map" in name or "sanction" in name or "plan" in name for name in doc_names)

    return {
        "Applicant Name": applicant_name or "",
        "Verification Agency": "",
        "Contact person's name": "",
        "Contact Number": "",
        "Property Type": property_row.get("property_type") or property_row.get("collateral_type") or "",
        "Flat No./House No.": property_row.get("house_flat_number") or "",
        "Address Line 1": property_row.get("address_line_1") or "",
        "Address Line 2": property_row.get("address_line_2") or "",
        "Landmark": property_row.get("landmark") or "",
        "Pincode": property_row.get("pincode") or "",
        "City": property_row.get("city") or "",
        "State": property_row.get("state") or "",
        "Property Documents Provided": "Yes" if docs else "No",
        "Copy Of Latest Deed provided": bool(deed_uploaded),
        "Approved Map": bool(map_uploaded),
        "Property Owner first name": property_row.get("owner_first_name") or "",
        "Property Owner middle name": property_row.get("owner_middle_name") or "",
        "Property Owner last name": property_row.get("owner_last_name") or "",
        "Complete Property Address": _complete_address(property_row),
    }


def _get(data: dict, *names):
    if not isinstance(data, dict):
        return None
    normalized = {str(k).casefold().replace("_", " ").strip(): v for k, v in data.items()}
    for name in names:
        key = name.casefold().replace("_", " ").strip()
        if key in normalized:
            return normalized[key]
    return None


def build_rule_inputs(property_row: dict, applicant_name: str | None, applicant_pan: str | None,
                      submitted_data: dict, vendor_response: dict):
    """(registration, valuation): the LOS record and the vendor report under the rule engine's labels."""
    registration = {
        "Applicant Name": applicant_name or "",
        "Applicant's PAN No.": applicant_pan or "",
        "Owner's PAN No.": "",  # No property-owner PAN column in the LOS schema.
        "Property Owner": property_row.get("property_owner") or "",
        "Property Owner First Name": property_row.get("owner_first_name") or "",
        "Property Owner Middle Name": property_row.get("owner_middle_name") or "",
        "Property Owner Last Name": property_row.get("owner_last_name") or "",
        "Property Type": property_row.get("property_type") or property_row.get("collateral_type") or "",
        "Property Usage": property_row.get("collateral_usage") or "",
        "Property Nature": property_row.get("property_categorization") or "",
        "Property Occupancy": property_row.get("property_ownership") or "",
        "Flat No./House No.": property_row.get("house_flat_number") or "",
        "Address Line 1": property_row.get("address_line_1") or "",
        "Address Line 2": property_row.get("address_line_2") or "",
        "Landmark": property_row.get("landmark") or "",
        "Nearest Landmark": property_row.get("landmark") or "",
        "Pin Code": property_row.get("pincode") or "",
        "City/Town/Village": property_row.get("city") or "",
        "State": property_row.get("state") or "",
        "Complete Property Address": _complete_address(property_row),
        "Reference ID": "",
        "Asset Id": "",
        "Registration Number": "",
        "Registration Date": "",
        "Registered At": "",
        "Transaction Type": "",
        "Project Name/Colony Name/Building Name": "",
    }

    carpet_area = _get(vendor_response, "Carpet Area")
    carpet_unit = str(_get(vendor_response, "Carpet Area Unit", "Unit") or "").casefold()
    carpet_sqft = carpet_area if ("sq.ft" in carpet_unit or "sq ft" in carpet_unit or "sqft" in carpet_unit) else ""

    valuation = {
        "Applicant Name": applicant_name or "",
        "Current property owner": _get(vendor_response, "Current Property Owner") or "",
        "Address as per deed": _get(vendor_response, "Address As Per Sale Deed") or "",
        "Inspection address": _get(vendor_response, "Inspection Address") or "",
        "Flat No./House No.": _get(vendor_response, "House No/Flat", "House No / Flat", "Flat No./House No.") or "",
        "House no / Flat no": _get(vendor_response, "House No/Flat", "House No / Flat", "Flat No./House No.") or "",
        "Property Within MC/Not": _get(vendor_response, "Property Within MC/Not"),
        "Demarcation": _get(vendor_response, "Demarcation"),
        "Distance from Branch": _get(vendor_response, "Distance from Branch"),
        "Sanction plan provided": _get(vendor_response, "Sanction Plan Provided"),
        "Building as per sanction plan": _get(vendor_response, "Building As Per Sanction Plan"),
        "Property Usage": _get(vendor_response, "Property Usage") or "",
        "Property nature as per document": _get(vendor_response, "Property Nature As Per Documents") or "",
        "Property Occupancy": _get(vendor_response, "Property Occupancy") or "",
        "No of tenants": _get(vendor_response, "Number Of Tenants"),
        "Type of locality": _get(vendor_response, "Type Of Locality") or "",
        "Condition of property": _get(vendor_response, "Condition Of Property") or "",
        "Residual Age": _get(vendor_response, "Residual Age"),
        "Land Area as per Deed": _get(vendor_response, "Land Area as per Deed"),
        "Land Area Unit": _get(vendor_response, "Land Area Unit", "Unit"),
        "Land Rate": _get(vendor_response, "Land Rate"),
        "Built up Area": _get(vendor_response, "Built up Area"),
        "Built up Area Unit": _get(vendor_response, "Built up Area Unit", "Unit"),
        "Carpet Area": carpet_area,
        "Carpet area in sq.ft": carpet_sqft,
        "Carpet Area Unit": _get(vendor_response, "Carpet Area Unit", "Unit"),
        "Area Adopted For Valuation": _get(vendor_response, "Area Adopted For Valuation"),
        "Area Adopted Unit": _get(vendor_response, "Area Adopted Unit", "Unit"),
        "Avg construction rate per sq ft": _get(vendor_response, "Avg construction rate per sq ft"),
        "Govt. Approved rate(₹)": _get(vendor_response, "Govt. Approved rate(₹)", "Govt Approved Rate"),
        "Current Market Value": _get(vendor_response, "Current Market Value"),
        "value to be considered": _get(vendor_response, "Value to be Considered"),
        "Valuation date": _get(vendor_response, "Valuation Date"),
        "Investment / Self used": _get(vendor_response, "Investment/Self used", "Investment/Self Used"),
        "Technical valuation 2": _get(vendor_response, "Technical Valuation 2"),
        "Remarks": _get(vendor_response, "Remarks"),
        "Property Type": _get(vendor_response, "Property Type") or "",
        "Property Type (LOS request)": _get(submitted_data, "Property Type") or "",
        # the approved-map checkbox is part of the request sent to the vendor, not of the vendor response
        "Approved Map": _get(submitted_data, "Approved Map"),
    }
    return registration, valuation
