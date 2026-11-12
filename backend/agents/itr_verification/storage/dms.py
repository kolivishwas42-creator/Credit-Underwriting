"""Documents from the DMS: an id is a full download URL or a DMS document id (<base>/documents/<id>/download)."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

from .base import DocumentNotFound, ResolvedDocument


class DMSResolver:
    def __init__(self, base_url: str, api_key: str = "", timeout_seconds: float = 60, temp_dir: str = "",
                 client=None):
        self._base = base_url.rstrip("/")
        self._api_key = api_key
        self._timeout = timeout_seconds
        self._temp_dir = temp_dir or None
        self._client = client

    def download_url(self, identifier: str) -> str:
        if identifier.startswith(("http://", "https://")):
            return identifier
        if not self._base:
            raise ValueError("DMS document store is not configured: set ITR_VERIFICATION_DMS_BASE_URL")
        return f"{self._base}/documents/{identifier}/download"

    def resolve(self, identifier: str, side: str) -> ResolvedDocument:
        url = self.download_url(identifier)
        headers = {"Authorization": f"Bearer {self._api_key}"} if self._api_key else {}
        if self._client is None:
            import httpx

            response = httpx.get(url, headers=headers, timeout=self._timeout, follow_redirects=True)
        else:
            response = self._client.get(url, headers=headers, timeout=self._timeout)
        if response.status_code == 404:
            raise DocumentNotFound(f"Document '{identifier}' not found in the {side} document store")
        response.raise_for_status()

        suffix = ".png" if ".png" in url.lower() and ".pdf" not in url.lower() else ".pdf"
        fd, name = tempfile.mkstemp(suffix=suffix, dir=self._temp_dir)
        with os.fdopen(fd, "wb") as fh:
            fh.write(response.content)
        return ResolvedDocument(Path(name), temporary=True)


__all__ = ["DMSResolver"]
