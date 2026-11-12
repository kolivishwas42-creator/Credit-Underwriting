"""Reading the vendor report: text from in-memory bytes, fields from synthetic text."""

from __future__ import annotations

import io
import zipfile

from agents.collateral_verification.extract import DocumentExtractor, extract_vendor_fields, text_from_bytes
from agents.collateral_verification.tests.fixtures.samples import REPORT_TEXT


def test_fields_from_a_synthetic_report():
    f = extract_vendor_fields(REPORT_TEXT)
    assert f["case_number"] == "CASE-0001"
    assert f["applicant_pans_named"] == [{"name": "ASHA RAO", "pan": "ABCDE1234F"},
                                         {"name": "RAVI DEV RAO", "pan": "PQRSX6789Z"}]
    assert f["owner_names"] == ["Asha Rao", "Ravi Dev Rao"]          # the firm is not an owner
    assert f["owner_count"] == 2
    assert f["debtor_search_pan"] == "ABCDE1234F"
    assert f["debtor_search_result"] == "1 record found"
    assert (f["city"], f["state"], f["pincode"], f["unit_number"]) == ("Pune", "Maharashtra", "411001", "B-12")
    assert f["security_interest"]["security_interest_id"] == "SI-0009"
    assert f["has_cersai_security_interest"] is True
    assert f["borrower_asset_owner_rows"][0] == {"source_line": "Asha Rao Yes", "borrower_text": "Asha Rao",
                                                 "asset_owner": True}
    assert f["property_address"] == "Plot 7 Green Lane"


def test_header_district_fills_city_and_state():
    f = extract_vendor_fields("District/State: Nagpur, Maharashtra\nPincode\n440001\nunder construction")
    # the generic "State" label also matches inside "District/State" (behaviour kept from the original agent)
    assert (f["city"], f["state"], f["header_state"]) == ("Nagpur", "Nagpur, Maharashtra", "Maharashtra")
    assert f["pincode"] == "440001"
    assert f["construction_status"] == "Under Construction"


def test_text_from_plain_odg_and_image_bytes():
    assert text_from_bytes("r.txt", b"hello") == "hello"
    assert text_from_bytes("photo.jpg", b"\xff\xd8\xff") == ""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("content.xml", '<doc xmlns:t="urn:t"><t:p>Owner</t:p><t:span>Asha Rao</t:span></doc>')
    assert text_from_bytes("report.odg", buf.getvalue()) == "Owner\nAsha Rao"
    extractor = DocumentExtractor()
    assert extractor.fields(extractor.text("r.txt", b"Pin Code: 411001"))["pincode"] == "411001"
