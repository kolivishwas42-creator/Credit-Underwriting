"""Synthetic LOS property rows and vendor reports (no real person, address or document)."""

from __future__ import annotations

import copy

APPLICATION_ID = 9001
APPLICATION_NUMBER = "TEST-APP-0001"
PROPERTY_ID = 501

PROPERTY_ROW = {
    "application_id": APPLICATION_ID,
    "application_number": APPLICATION_NUMBER,
    "applicant_name": "Test Applicant One",
    "applicant_pan": "AAAAA0000A",
    "collateral_property_id": PROPERTY_ID,
    "property_owner": "Test Applicant One",
    "owner_first_name": "Test",
    "owner_middle_name": "Applicant",
    "owner_last_name": "One",
    "collateral_usage": "Residential",
    "collateral_type": "Flat",
    "property_categorization": "Residential",
    "collateral_status": "ACTIVE",
    "property_ownership": "Self Occupied",
    "property_type": "Flat",
    "house_flat_number": "12A",
    "address_line_1": "Sample Street",
    "address_line_2": "Sector 1",
    "landmark": "Near Sample Park",
    "pincode": "000001",
    "city": "Sampletown",
    "state": "Samplestate",
    "documents": [{"document_id": 1, "document_name": "Sale Deed", "file_name": "deed.pdf",
                   "content_type": "application/pdf", "uploaded_at": None}],
}

ADDRESS = "12A Sample Street Sector 1 Near Sample Park Sampletown Samplestate 000001"

CLEAN_VENDOR = {
    "Current Property Owner": "Test Applicant One",
    "Address As Per Sale Deed": ADDRESS,
    "Inspection Address": ADDRESS,
    "House No/Flat": "12A",
    "Sanction Plan Provided": "Yes",
    "Building As Per Sanction Plan": "Yes",
    "Property Usage": "Residential",
    "Property Nature As Per Documents": "Residential",
    "Property Occupancy": "Self Occupied",
    "Number Of Tenants": 0,
    "Condition Of Property": "Good",
    "Residual Age": 40,
    "Land Area as per Deed": 1000,
    "Built up Area": 800,
    "Carpet Area": 700,
    "Carpet Area Unit": "sq.ft",
    "Area Adopted For Valuation": 800,
    "Land Rate": 1500,
    "Avg construction rate per sq ft": 1200,
    "Govt. Approved rate(₹)": 1000,
    "Current Market Value": 2460000,
    "Value to be Considered": 2460000,
    "Valuation Date": "22/10/2026",
    "Investment/Self used": "Self used and tenants",
    "Remarks": "Synthetic report",
    "Property Type": "Flat",
    "Final Status": "Positive",
}

SUBMITTED = {"Property Type": "Flat", "Approved Map": True}


def property_row() -> dict:
    return copy.deepcopy(PROPERTY_ROW)


def vendor(**changes) -> dict:
    data = copy.deepcopy(CLEAN_VENDOR)
    data.update(changes)
    return data
