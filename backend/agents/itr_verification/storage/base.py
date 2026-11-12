"""The document store interface: a document id (filename, key or URL) -> a local file the extractor can open."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


class DocumentNotFound(LookupError):
    """The named document is not in the store."""


@dataclass(frozen=True)
class ResolvedDocument:
    path: Path
    temporary: bool = False     # a downloaded copy the caller deletes after use


class DocumentResolver(Protocol):
    def resolve(self, identifier: str, side: str) -> ResolvedDocument:
        """side = "input" (customer ITR) or "output" (vendor ITR)."""
        ...


__all__ = ["DocumentNotFound", "DocumentResolver", "ResolvedDocument"]
