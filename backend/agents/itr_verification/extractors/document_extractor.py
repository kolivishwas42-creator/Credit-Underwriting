"""
Text extraction and field parsing for ITR Input / Output documents.

PDF: the digital text layer first, OCR of a page with no text (PyMuPDF), then pdfplumber, then pdf2image + OCR.
Images: OCR (pytesseract). The heavy libraries are imported only when a document is read.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from ..config import ExtractionSettings

logger = logging.getLogger(__name__)


# ------------------------------------------------------------------------------------------------- field parsing
def clean_numeric(raw: str) -> Optional[float]:
    if not raw:
        return None
    cleaned = re.sub(r"[₹Rs\.,\s]", "", raw, flags=re.IGNORECASE)
    try:
        return float(cleaned)
    except ValueError:
        return None


def normalise_ay(raw: str) -> Optional[str]:
    """Various AY formats as 'YYYY-YY' (the text unchanged when it does not look like an AY)."""
    if not raw:
        return None
    raw = raw.replace("–", "-").replace("—", "-").strip()
    m = re.search(r"(20\d{2})\s*[-/]\s*(20)?(\d{2})", raw)
    if not m:
        return raw
    return f"{m.group(1)}-{m.group(3)}"


def normalise_pan(raw: str) -> Optional[str]:
    if not raw:
        return None
    return re.sub(r"\s+", "", raw).upper()   # returned even if the format is slightly off: the comparison catches it


def parse_fields(text: str, settings: ExtractionSettings) -> Dict[str, Any]:
    """The configured patterns applied to the text; a field not found is None."""
    result: Dict[str, Any] = {f: None for f in settings.extract_fields}
    result["gti"] = None

    for name, patterns in settings.field_patterns.items():
        for pat in patterns:
            m = re.search(pat, text, re.IGNORECASE | re.MULTILINE | re.DOTALL)
            if m:
                value: Any = m.group(1).strip() if m.lastindex else m.group(0).strip()
                if name in ("total_income", "gti"):
                    value = clean_numeric(value)
                elif name == "assessment_year" and settings.normalize_ay:
                    value = normalise_ay(value)
                elif name == "pan" and settings.normalize_pan:
                    value = normalise_pan(value)
                elif name == "applicant_name":
                    value = re.sub(r"\s+", " ", value).strip()
                result[name] = value
                break

    # the two income fields stay compatible when only one was found; distinct values are kept when both exist
    if result.get("gti") is None and result.get("total_income") is not None:
        result["gti"] = result["total_income"]
    elif result.get("total_income") is None and result.get("gti") is not None:
        result["total_income"] = result["gti"]
    return result


# ------------------------------------------------------------------------------------------------ text extraction
class DocumentExtractor:
    """Path -> (fields, raw text) for a PDF or image (the Extractor the service is given)."""

    def __init__(self, settings: ExtractionSettings):
        self.settings = settings

    def extract(self, file_path: str | Path) -> Tuple[Dict[str, Any], str]:
        raw = self.extract_raw_text(file_path)
        fields = parse_fields(raw, self.settings)
        logger.debug("Extracted %d field(s) from %s", sum(v is not None for v in fields.values()),
                     Path(file_path).name)
        return fields, raw

    def extract_raw_text(self, file_path: str | Path) -> str:
        path = Path(file_path)
        if not path.exists():
            raise FileNotFoundError(f"Document not found: {path.name}")
        suffix = path.suffix.lower()
        if suffix not in self.settings.supported_file_types:
            raise ValueError(f"Unsupported file type '{suffix}'. Allowed: {list(self.settings.supported_file_types)}")
        return self._pdf_text(path) if suffix == ".pdf" else self._image_text(path)

    def _pdf_text(self, path: Path) -> str:
        """Digital text first; OCR a page that has none."""
        parts = []
        try:
            import fitz  # PyMuPDF

            doc = fitz.open(path)
            for page in doc:
                page_text = page.get_text("text") or ""
                if page_text.strip():
                    parts.append(page_text)
                elif self.settings.ocr_enabled:
                    pix = page.get_pixmap(dpi=self.settings.ocr_dpi)
                    parts.append(self._ocr_bytes(pix.tobytes("png")))
            doc.close()
        except Exception as exc:  # noqa: BLE001 - the next extractor is tried
            logger.warning("PyMuPDF failed (%s) – trying pdfplumber / OCR", type(exc).__name__)
            parts.append(self._pdf_fallback(path))
        return "\n".join(parts)

    def _pdf_fallback(self, path: Path) -> str:
        try:
            import pdfplumber

            with pdfplumber.open(path) as pdf:
                return "\n".join(page.extract_text() or "" for page in pdf.pages)
        except Exception:  # noqa: BLE001 - last resort below
            if self.settings.ocr_enabled:
                try:
                    from pdf2image import convert_from_path

                    images = convert_from_path(str(path), dpi=self.settings.ocr_dpi, first_page=1,
                                               last_page=self.settings.ocr_fallback_max_pages)
                    return "\n".join(self._ocr_image(img) for img in images)
                except Exception as exc:  # noqa: BLE001
                    logger.error("All PDF extractors failed: %s", type(exc).__name__)
            return ""

    def _image_text(self, path: Path) -> str:
        if not self.settings.ocr_enabled:
            logger.warning("OCR disabled – cannot read image %s", path.name)
            return ""
        try:
            from PIL import Image

            return self._ocr_image(Image.open(path))
        except Exception as exc:  # noqa: BLE001
            logger.error("Image OCR failed: %s", type(exc).__name__)
            return ""

    def _ocr_image(self, img: Any) -> str:
        try:
            import pytesseract

            return pytesseract.image_to_string(img, lang=self.settings.ocr_language)
        except Exception as exc:  # noqa: BLE001
            logger.error("pytesseract error: %s", type(exc).__name__)
            return ""

    def _ocr_bytes(self, img_bytes: bytes) -> str:
        from io import BytesIO

        from PIL import Image

        return self._ocr_image(Image.open(BytesIO(img_bytes)))


__all__ = ["DocumentExtractor", "clean_numeric", "normalise_ay", "normalise_pan", "parse_fields"]
