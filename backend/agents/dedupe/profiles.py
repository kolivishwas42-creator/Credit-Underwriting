"""
Who is on each case, as comparable PROFILES -- PAN and mobile, from what the LOS actually stores.

  - PRIMARY APPLICANT: PAN from the party's gate-released EXTRACTION findings (encrypted at rest, opened by the
    repository on read); mobile from `applicants.mobile` (declared on the FOS form).
  - CO-APPLICANT: PAN from `co_applicants.pan` (declared, Fernet-sealed; migration 0004) and from the party's
    EXTRACTION findings. A co-applicant's mobile is not stored anywhere.

SCAN MODE (migration 0010 not applied): the most recent `limits.max_scan_cases` cases are read; more in the store is
reported as partial coverage -- never as a clean history.

Values leave this module only as keyed-HMAC tokens; a plain PAN / mobile exists in memory for one normalisation.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from agents.dedupe import identity as I

PRIMARY, CO = "PRIMARY_APPLICANT", "CO_APPLICANT"
_CHUNK = 400
_PAN_KEYS = ("pan_number", "pan")


@dataclass
class Profile:
    case_id: str
    applicant_id: str                      # the case's customer record (APP-...)
    party_id: str
    role: str
    product: str | None = None
    created_at: str | None = None
    pan: set[str] = field(default_factory=set)        # keyed-HMAC tokens, every key
    mobile: set[str] = field(default_factory=set)
    #: where each parameter came from (DECLARED / DOCUMENT_EXTRACTION) -- names only
    sources: dict[str, str] = field(default_factory=dict)

    def add(self, kind: str, value: str | None, source: str) -> None:
        norm = I.normalise(kind, value)
        if not norm:
            return
        (self.pan if kind == "PAN" else self.mobile).update(I.tokens(kind, norm))
        if self.sources.get(kind) != "DOCUMENT_EXTRACTION":     # a document-read value outranks a declared one
            self.sources[kind] = source

    @property
    def has_identity(self) -> bool:
        return bool(self.pan or self.mobile)


def _chunks(items: list[str]):
    for i in range(0, len(items), _CHUNK):
        yield items[i:i + _CHUNK]


def _marks(n: int) -> str:
    return ",".join("?" for _ in range(n))


_COLS = "case_id, applicant_id, co_applicant_id, product, loan_amount, created_at"


def case_rows(repository, *, limit: int, case_ids: list[str] | None = None,
              applicant_ids: list[str] | None = None) -> tuple[list[dict], bool]:
    """(applications rows, truncated?): the named cases / customer records, or the newest `limit`."""
    if case_ids or applicant_ids:
        column, wanted = ("case_id", case_ids) if case_ids else ("applicant_id", applicant_ids)
        rows: list[dict] = []
        for part in _chunks(list(dict.fromkeys(wanted))):
            rows += [dict(r) for r in repository._all(
                f"SELECT {_COLS} FROM applications WHERE {column} IN ({_marks(len(part))})", tuple(part))]
        return rows, False
    rows = [dict(r) for r in repository._all(
        f"SELECT {_COLS} FROM applications ORDER BY created_at DESC, case_id LIMIT ?", (limit + 1,))]
    return rows[:limit], len(rows) > limit


def build(repository, cases: list[dict]) -> list[Profile]:
    """Profiles for every party on these cases."""
    if not cases:
        return []
    case_ids = [c["case_id"] for c in cases]
    by_case = {c["case_id"]: c for c in cases}
    profiles: dict[tuple[str, str], Profile] = {}

    def party(case_id: str, party_id: str, role: str) -> Profile:
        key = (case_id, party_id)
        if key not in profiles:
            row = by_case[case_id]
            profiles[key] = Profile(case_id, row["applicant_id"], party_id, role, row.get("product"),
                                    str(row.get("created_at") or "") or None)
        return profiles[key]

    applicant_ids = list(dict.fromkeys(c["applicant_id"] for c in cases if c.get("applicant_id")))
    mobiles: dict[str, str | None] = {}
    for part in _chunks(applicant_ids):
        for r in repository._all(f"SELECT applicant_id, mobile FROM applicants WHERE applicant_id IN "
                                 f"({_marks(len(part))})", tuple(part)):
            mobiles[r["applicant_id"]] = r["mobile"]
    for c in cases:
        party(c["case_id"], c["applicant_id"], PRIMARY).add("MOBILE", mobiles.get(c["applicant_id"]), "DECLARED")
        if c.get("co_applicant_id"):
            party(c["case_id"], c["co_applicant_id"], CO)

    try:
        has_coapp = repository.table_exists("co_applicants")
    except Exception:  # noqa: BLE001 - an unreadable catalogue: no declared co-applicant PAN, the rest still reads
        has_coapp = False
    if has_coapp:
        from shared.store.crypto import open_value

        for part in _chunks(case_ids):
            for r in repository._all("SELECT co_applicant_id, case_id, pan FROM co_applicants "
                                     f"WHERE case_id IN ({_marks(len(part))})", tuple(part)):
                party(r["case_id"], r["co_applicant_id"], CO).add("PAN", open_value(r["pan"]), "DECLARED")

    for part in _chunks(case_ids):
        for case_id, findings in repository.get_current_findings_for_cases(part, kind="EXTRACTION").items():
            row = by_case[case_id]
            for f in findings:
                payload = f.payload or {}
                party_id = f.party_id or row["applicant_id"]
                p = party(case_id, party_id, PRIMARY if party_id == row["applicant_id"] else CO)
                for k in _PAN_KEYS:
                    if payload.get(k):
                        p.add("PAN", str(payload[k]), "DOCUMENT_EXTRACTION")
    return list(profiles.values())


def file_hashes(repository, case_ids: list[str], *, limit: int | None = None) -> tuple[dict[str, list[str]], int, bool]:
    """case_id -> SHA-256 of each stored file (hashed from the document store; migration 0010 would keep it on the
    row). Returns (hashes, files missing from the store, truncated?)."""
    from shared.store import documents as store_module
    from shared.store.documents import get_document_store

    store = get_document_store()
    out: dict[str, list[str]] = {}
    missing, read, truncated = 0, 0, False
    for case_id, docs in repository.list_documents_for_cases(case_ids).items():
        for doc in docs:
            if limit is not None and read >= limit:
                truncated = True
                break
            read += 1
            try:
                described = store.describe(store_module.storage_key(doc.document_id))
            except Exception:  # noqa: BLE001 - an unreadable file is counted, never fatal
                described = None
            if described is None:
                missing += 1
                continue
            out.setdefault(case_id, []).append(described.content_hash)
    return out, missing, truncated


__all__ = ["CO", "PRIMARY", "Profile", "build", "case_rows", "file_hashes"]
