"""
Where the AML / PEP watch-list replies come from (the service receives a WatchlistSource; tests pass a fake).

    VendorOrSampleWatchlist   the Karza-style vendor when FRAUD_SCREENING_<KIND>_API_URL is set (source "vendor"),
                              otherwise the sample reply in conf/ (source "mock") -- as the agent always did
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Iterable, Protocol

from agents.fraud_screening.config import Settings, VendorSettings
from agents.fraud_screening.rules.aml import AmlError, build_vendor_request, is_no_record_reply, parse_vendor_json, snippet
from agents.fraud_screening.rules.pep import build_pep_request


class WatchlistSource(Protocol):
    def aml(self, applicant: dict) -> tuple[Any, str]:
        """(the vendor reply, "vendor" | "mock")."""

    def pep(self, applicant: dict) -> tuple[Any, str]:
        """(the vendor reply, "vendor" | "mock")."""


def load_sample(path: Path) -> Any:
    try:
        return parse_vendor_json(Path(path).read_text(encoding="utf-8-sig"))
    except OSError as exc:
        raise AmlError(f"Could not read sample AML data: {exc}") from exc


def post_to_vendor(url: str, body: dict, timeout: float, headers: dict, no_record_codes: Iterable[int]) -> Any:
    """POST `body` as JSON and return the parsed reply. An HTTP error whose body carries a "no records" statusCode is
    returned as a normal reply; every other HTTP error raises."""
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return parse_vendor_json(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        text = exc.read().decode("utf-8", errors="replace")
        try:
            payload = parse_vendor_json(text)
        except AmlError:
            payload = None
        if payload is not None and is_no_record_reply(payload, no_record_codes):
            return payload                 # e.g. HTTP 404 + statusCode meaning "no records"
        raise AmlError(f"AML vendor returned HTTP {exc.code}: {snippet(text)}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise AmlError(f"Could not reach vendor: {exc}") from exc


class VendorOrSampleWatchlist:
    def __init__(self, settings: Settings):
        self.settings = settings

    def _fetch(self, vendor: VendorSettings, body_builder, applicant: dict) -> tuple[Any, str]:
        if vendor.api_url:
            body = body_builder(applicant, vendor.request_options)
            return post_to_vendor(vendor.api_url, body, vendor.timeout_seconds, vendor.headers,
                                  vendor.no_record_status_codes), "vendor"
        return load_sample(vendor.sample_file), "mock"

    def aml(self, applicant: dict) -> tuple[Any, str]:
        return self._fetch(self.settings.aml, build_vendor_request, applicant)

    def pep(self, applicant: dict) -> tuple[Any, str]:
        return self._fetch(self.settings.pep, build_pep_request, applicant)
