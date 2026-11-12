"""
Reading a vendor report behind one small interface.

    ReportExtractor      what the service needs: the report's text, and the vendor fields read from a text
    DocumentExtractor    the implementation: ODG / PDF text layer / plain text (images yield no text: no OCR)
"""

from __future__ import annotations

from typing import Protocol

from agents.collateral_verification.extract.fields import extract_vendor_fields
from agents.collateral_verification.extract.text import text_from_bytes


class ReportExtractor(Protocol):
    def text(self, filename: str, data: bytes) -> str: ...

    def fields(self, text: str) -> dict: ...


class DocumentExtractor:
    def text(self, filename: str, data: bytes) -> str:
        return text_from_bytes(filename, data)

    def fields(self, text: str) -> dict:
        return extract_vendor_fields(text)


__all__ = ["DocumentExtractor", "ReportExtractor", "extract_vendor_fields", "text_from_bytes"]
