"""Synthetic data only: invented names, PANs, places -- no real customer or document."""

from __future__ import annotations

import copy

REPORT_TEXT = """Case number: CASE-0001
Applicant names: ASHA RAO, ABCDE1234F
RAVI DEV RAO, PQRSX6789Z
Owner/Transferor Names: Asha Rao
Property Address: Plot 7 Green Lane
District/State: Pune, Maharashtra
Debtor Based Search
PAN : ABCDE1234F
Results : 1 record found
Borrower name:
Asha Rao, Ravi Dev Rao, Lotus Trading Ltd
Charge details
City/Town/Village: Pune
State/UT: Maharashtra
Pin Code: 411001
House/Flat Number/Unit No: B-12
Security Interest ID: SI-0009
Satisfaction Status: Satisfied
Borrower(s) Details
Asha Rao Yes
Lotus Trading No
Holder details
"""

_RECORD = {
    "application_id": 501,
    "application_number": "TEST-APP-0501",
    "participants": [
        {"applicant_type": "PRIMARY", "full_name": "Asha Rao", "pan_number": "ABCDE1234F"},
        {"applicant_type": "CO_APPLICANT", "full_name": "Ravi Dev Rao", "pan_number": "PQRSX6789Z"},
    ],
    "properties": [{
        "collateral_property_id": 1,
        "property_owner": "Asha Rao",
        "owner_first_name": "Asha",
        "owner_middle_name": "",
        "owner_last_name": "Rao",
        "property_ownership": "Joint",
        "collateral_status": "Completed",
        "percentage_of_completion": "100",
        "pincode": "411001",
        "city": "Pune",
        "state": "Maharashtra",
        "house_flat_number": "B 12",
        "property_type": "Registered",
    }],
    "documents": [],
}


def record() -> dict:
    return copy.deepcopy(_RECORD)
