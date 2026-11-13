"""Documents from two local folders (input / output), named by filename."""

from __future__ import annotations

from pathlib import Path

from .base import DocumentNotFound, ResolvedDocument


class LocalResolver:
    def __init__(self, input_dir: str, output_dir: str):
        if not input_dir or not output_dir:
            raise ValueError("Local document store is not configured: set ITR_VERIFICATION_LOCAL_INPUT_DIR and "
                             "ITR_VERIFICATION_LOCAL_OUTPUT_DIR")
        self._dirs = {"input": Path(input_dir).resolve(), "output": Path(output_dir).resolve()}

    def resolve(self, identifier: str, side: str) -> ResolvedDocument:
        base = self._dirs["input" if side == "input" else "output"]
        path = (base / identifier).resolve()
        # an id never reaches outside its folder ("../../etc")
        if base != path and base not in path.parents:
            raise ValueError(f"Invalid document id '{identifier}'")
        if not path.is_file():
            raise DocumentNotFound(f"Document '{identifier}' not found in the {side} document store")
        return ResolvedDocument(path)

    def list_documents(self, side: str, suffixes: tuple[str, ...] = ()) -> list[str]:
        """The file names in the folder of a side (sorted; only these suffixes when given): the documents that can be
        named in a verification. Used to offer sample documents for testing."""
        base = self._dirs["input" if side == "input" else "output"]
        if not base.is_dir():
            return []
        return sorted(p.name for p in base.iterdir()
                      if p.is_file() and not p.name.startswith(".") and (not suffixes or p.suffix.lower() in suffixes))


__all__ = ["LocalResolver"]
