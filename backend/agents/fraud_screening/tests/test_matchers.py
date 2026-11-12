"""AML / PEP matching (pure; synthetic applicants and records, plus the shape of the conf/ sample replies)."""

from __future__ import annotations

import pytest

from agents.fraud_screening.rules import aml, pep
from agents.fraud_screening.tests.fakes import POLICY, SETTINGS
from agents.fraud_screening.watchlist import load_sample

AML_CODES = SETTINGS.aml.no_record_status_codes
PEP_CODES = SETTINGS.pep.no_record_status_codes
APPLICANT = {"Name": "Ravi Samplekar", "DOB": "1970-02-11", "Address": "4 Test Road, Pune 411001"}


def _aml_record(**extra):
    return {"name": "Ravi Samplekar", "score": 0.91, "dateOfBirth": "11-02-1970", "address": "Shivaji Nagar, Pune",
            "dataSource": "testlist", "aliases": ["R. Samplekar"], **extra}


def test_aml_screen_splits_by_threshold_and_compares_fields():
    payload = {"requestId": "req-1", "result": [_aml_record(), _aml_record(name="Unrelated Person", score=0.4, aliases=None)]}
    out = aml.screen(payload, APPLICANT, POLICY, AML_CODES, threshold_percent=70, source="vendor")
    assert (out["kind"], out["request_id"], out["source"]) == ("aml", "req-1", "vendor")
    assert (out["total_records"], out["strong_count"], out["other_count"]) == (2, 1, 1)
    assert out["has_potential_match"] is True
    assert out["summary"] == "1 of 2 record(s) scored 70% or higher. Review the side-by-side comparison below."
    strong = out["strong_matches"][0]
    assert strong["match_percent"] == 91.0
    assert strong["matched_fields"] == ["Name", "Date of birth"]
    assert strong["partial_fields"] == ["Address / location"]          # common place name "Pune"
    assert {"label": "Also known as", "value": "R. Samplekar"} in strong["facts"]
    assert out["other_matches"][0]["comparison"][0]["status"] == aml.MISMATCH


def test_aml_threshold_fraction_and_no_strong_summary():
    out = aml.screen({"result": [_aml_record(score=0.5)]}, APPLICANT, POLICY, AML_CODES, threshold_percent=0.7)
    assert out["threshold_percent"] == 70.0
    assert out["summary"].startswith("No record reached 70%. 1 lower-scoring record(s)")


def test_aml_no_record_replies_and_errors():
    assert aml.extract_records({"statusCode": 103}, AML_CODES) == []
    assert aml.extract_records({"statusCode": 102}, AML_CODES) == []
    assert aml.extract_records({"result": None}, AML_CODES) == []
    assert aml.extract_records([_aml_record(), "junk"], AML_CODES) == [_aml_record()]
    with pytest.raises(aml.AmlError, match="statusCode=401"):
        aml.extract_records({"statusCode": 401, "message": "bad key"}, AML_CODES)


def test_aml_vendor_request_needs_a_name_and_uses_conf_options():
    with pytest.raises(aml.AmlInputError):
        aml.build_vendor_request({"Name": "  "}, SETTINGS.aml.request_options)
    body = aml.build_vendor_request(APPLICANT, SETTINGS.aml.request_options)
    assert body["name"] == "Ravi Samplekar" and body["dateOfBirth"] == "" and body["nameMatchThresholdValue"] == 0.65
    body = aml.build_vendor_request(APPLICANT, {**SETTINGS.aml.request_options, "send_dob_and_age": True})
    assert body["dateOfBirth"] == "11-02-1970"


def test_parse_vendor_json_tolerates_stray_backslashes():
    assert aml.parse_vendor_json('{"a": "Father\\’s name"}') == {"a": "Father\\’s name"}


def test_pep_screen_flattens_categories():
    payload = {"requestId": "req-2", "result": {
        "parliamentOfIndia": [{"name": "Ravi Samplekar", "nameScore": 0.95, "isPep": True, "dateOfBirth": "11-02-1970",
                               "constituency": "PUNE", "mostProbablePan": "ABCDE1234F", "party": "Test Party"}],
        "civilOfficer": [{"name": "Other Official", "nameScore": 0.3, "isPep": False}],
        "legislativeAssembly": [],
    }}
    applicant = {**APPLICANT, "PAN_Number": "ABCDE1234F"}
    out = pep.screen_pep(payload, applicant, POLICY, PEP_CODES, threshold_percent=70, source="mock")
    assert (out["kind"], out["source"], out["total_records"], out["strong_count"]) == ("pep", "mock", 2, 1)
    strong = out["strong_matches"][0]
    assert strong["agency"] == "Parliament of India" and strong["list_type"] == "PEP"
    assert strong["matched_fields"] == ["Name", "Date of birth", "PAN"]
    assert strong["comparison"][0]["note"].endswith("Vendor name score 95%.")
    assert out["other_matches"][0]["agency"] == "Civil officer"
    assert out["other_matches"][0]["list_type"] == "Not flagged as PEP"


def test_pep_no_record_and_error_replies():
    assert pep.extract_pep_records({"statusCode": 103}, PEP_CODES) == []
    assert pep.extract_pep_records({"result": {"civilOfficer": []}}, PEP_CODES) == []
    with pytest.raises(pep.AmlError, match="statusCode=102"):
        pep.extract_pep_records({"statusCode": 102}, PEP_CODES)        # 102 is "no record" for AML only
    with pytest.raises(pep.AmlInputError):
        pep.build_pep_request({}, SETTINGS.pep.request_options)
    assert pep.build_pep_request(APPLICANT, SETTINGS.pep.request_options)["confidenceLevel"] == "high"


def test_conf_sample_replies_screen_without_error():
    for kind, screen in (("aml", aml.screen), ("pep", pep.screen_pep)):
        vendor = getattr(SETTINGS, kind)
        out = screen(load_sample(vendor.sample_file), {"Name": "Synthetic Applicant"}, POLICY,
                     vendor.no_record_status_codes, threshold_percent=vendor.match_threshold_percent, source="mock")
        assert out["total_records"] > 0
        assert out["strong_count"] + out["other_count"] == out["total_records"]
