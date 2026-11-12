"""The text of an uploaded vendor report: ODG (zip + content.xml), PDF (text layer), image (no OCR yet), plain text."""

from __future__ import annotations

import io
import zipfile
from xml.etree import ElementTree as ET

IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp")


def text_from_bytes(filename: str, data: bytes) -> str:
    name = (filename or "").lower()
    if name.endswith(".odg") or data[:2] == b"PK":
        odg = _text_from_odg(data)
        if odg.strip():
            return odg
    if name.endswith(".pdf") or data[:5] == b"%PDF-":
        return _text_from_pdf(data)
    if name.endswith(IMAGE_SUFFIXES):
        return _text_from_image(data)
    return data.decode("utf-8", errors="replace")


def _text_from_pdf(data: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def _text_from_odg(data: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            if "content.xml" not in zf.namelist():
                return ""
            root = ET.fromstring(zf.read("content.xml"))
    except Exception:  # noqa: BLE001 - not an ODG: the caller tries the next reader
        return ""
    texts = []
    for el in root.iter():
        if (el.tag.endswith("}p") or el.tag.endswith("}span")) and el.text and el.text.strip():
            texts.append(el.text.strip())
    return "\n".join(texts)


def _text_from_image(data: bytes) -> str:
    # No OCR in this agent: an image is accepted (the API contract stays stable) and yields no text, so the rules
    # report PENDING for the missing vendor fields.
    return ""
