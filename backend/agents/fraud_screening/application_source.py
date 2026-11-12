"""
The LOS loan application data the rules read (another system's tables: loan_applications, customers,
application_participants, KYC, addresses, bank accounts, sourcing, collateral).

    ApplicationSource              what the service needs (a Protocol; tests pass a fake)
    PostgresApplicationSource      reads those tables from the schema FRAUD_SCREENING_LOAN_SCHEMA (default public) in
                                   the agent's database connection (shared.db.sqla, agent "fraud_screening")

Maps the primary participant to "primary" and the other participants to "co_applicants" (the rules treat the first one
as the former nominee).
"""

from __future__ import annotations

from typing import Any, Callable, ContextManager, Dict, List, Optional, Protocol

from agents.fraud_screening.config import AGENT


class ApplicationSource(Protocol):
    def application_bundle(self, application_number: str) -> Optional[Dict[str, Any]]:
        """{application, customer, primary, co_applicants, sourcing, collateral}, or None when not found."""

    def historical_identity(self, exclude_application_id: Optional[int]) -> List[dict]: ...

    def historical_bank_accounts(self, exclude_application_id: Optional[int]) -> List[dict]: ...

    def historical_addresses(self, exclude_application_id: Optional[int]) -> List[dict]: ...

    def historical_participants(self, exclude_application_id: Optional[int]) -> List[dict]:
        """Every applicant and co-applicant of other applications with their Aadhaar / PAN / mobile numbers."""

    def historical_coapplicant_pans(self, exclude_application_id: Optional[int]) -> List[dict]:
        """PANs registered against a co-applicant in other applications."""


def _default_session() -> ContextManager[Any]:
    from shared.db import sqla

    return sqla.session(AGENT)


class PostgresApplicationSource:
    def __init__(self, schema: str, session_factory: Callable[[], ContextManager[Any]] = _default_session):
        if not schema.isidentifier():
            raise ValueError("loan schema must be an identifier")
        self.s = schema
        self.session_factory = session_factory

    # -- helpers -----------------------------------------------------------------------------------------------------
    @staticmethod
    def _all(session, sql: str, params: dict) -> List[dict]:
        from sqlalchemy import text

        return [dict(r) for r in session.execute(text(sql), params).mappings().all()]

    @staticmethod
    def _first(session, sql: str, params: dict) -> Optional[dict]:
        from sqlalchemy import text

        row = session.execute(text(sql), params).mappings().first()
        return dict(row) if row else None

    def _participant_detail(self, session, participant_id) -> dict:
        ind = self._first(session, f"SELECT * FROM {self.s}.individual_applicant_details WHERE participant_id = :pid",
                          {"pid": participant_id})
        if ind:
            return {"type": "individual", **ind}
        non = self._first(session,
                          f"SELECT * FROM {self.s}.non_individual_applicant_details WHERE participant_id = :pid",
                          {"pid": participant_id})
        if non:
            return {"type": "non_individual", **non}
        return {"type": "unknown"}

    def _addresses(self, session, participant_id) -> List[dict]:
        p = {"pid": participant_id}
        return (self._all(session, f"SELECT * FROM {self.s}.applicant_addresses WHERE participant_id = :pid", p)
                + self._all(session, f"SELECT * FROM {self.s}.non_individual_addresses WHERE participant_id = :pid", p))

    def _bank_accounts(self, session, participant_id) -> List[dict]:
        return self._all(session, f"SELECT * FROM {self.s}.applicant_bank_accounts WHERE participant_id = :pid",
                         {"pid": participant_id})

    def _block(self, session, participant: dict) -> dict:
        pid = participant["participant_id"]
        return {"participant": participant, "details": self._participant_detail(session, pid),
                "addresses": self._addresses(session, pid), "bank_accounts": self._bank_accounts(session, pid)}

    # -- ApplicationSource -------------------------------------------------------------------------------------------
    def application_bundle(self, application_number: str) -> Optional[Dict[str, Any]]:
        with self.session_factory() as session:
            app = self._first(session, f"SELECT * FROM {self.s}.loan_applications WHERE application_number = :num "
                                       "LIMIT 1", {"num": application_number})
            if not app:
                return None
            application_id = app["application_id"]
            aid = {"aid": application_id}
            customer = self._first(session, f"SELECT * FROM {self.s}.customers WHERE customer_id = :cid",
                                   {"cid": app["customer_id"]}) or {}
            participants = self._all(session, f"SELECT * FROM {self.s}.application_participants "
                                              "WHERE application_id = :aid ORDER BY is_primary DESC, participant_id",
                                     aid)
            primary = None
            co_apps: List[dict] = []
            for p in participants:
                block = self._block(session, p)
                if p.get("is_primary"):
                    primary = block
                else:
                    co_apps.append(block)
            # no is_primary flag: the first participant is the primary
            if primary is None and participants:
                primary = self._block(session, participants[0])
                co_apps = co_apps[1:] if co_apps else []

            kyc = self._first(session, f"SELECT * FROM {self.s}.primary_applicant_kyc WHERE application_id = :aid", aid)
            if primary is not None:
                primary["kyc"] = kyc or {}
            sourcing = self._first(session, f"SELECT * FROM {self.s}.application_sourcing_details "
                                            "WHERE application_id = :aid", aid)
            collateral = self._all(session, f"SELECT * FROM {self.s}.collateral_properties WHERE application_id = :aid",
                                   aid)
        return {"application": app, "customer": customer, "primary": primary, "co_applicants": co_apps,
                "sourcing": sourcing, "collateral": collateral}

    def historical_identity(self, exclude_application_id: Optional[int]) -> List[dict]:
        """Every other application's primary identity (dual identity / duplicate / DOB checks)."""
        sql = f"""
            SELECT la.application_id, la.application_number, la.customer_id, c.full_name AS name, c.pan_number,
                   pak.aadhaar_number, pak.pan_number AS kyc_pan, pak.date_of_birth,
                   pak.first_name, pak.middle_name, pak.last_name,
                   iad.first_name AS ind_first, iad.middle_name AS ind_middle, iad.last_name AS ind_last,
                   iad.date_of_birth AS ind_dob, iad.mobile_number
            FROM {self.s}.loan_applications la
            JOIN {self.s}.customers c ON c.customer_id = la.customer_id
            LEFT JOIN {self.s}.primary_applicant_kyc pak ON pak.application_id = la.application_id
            LEFT JOIN {self.s}.application_participants ap
                   ON ap.application_id = la.application_id AND ap.is_primary = TRUE
            LEFT JOIN {self.s}.individual_applicant_details iad ON iad.participant_id = ap.participant_id
            WHERE (CAST(:excl AS BIGINT) IS NULL OR la.application_id <> CAST(:excl AS BIGINT))
        """
        with self.session_factory() as session:
            rows = self._all(session, sql, {"excl": exclude_application_id})
        out = []
        for r in rows:
            parts = [r.get("first_name") or r.get("ind_first"), r.get("middle_name") or r.get("ind_middle"),
                     r.get("last_name") or r.get("ind_last")]
            full = " ".join(p for p in parts if p) or r.get("name") or ""
            dob = r.get("date_of_birth") or r.get("ind_dob")
            out.append({"application_id": r["application_id"], "application_number": r.get("application_number"),
                        "customer_id": r["customer_id"], "Name": full,
                        "full_name": full, "Aadhaar_Number": r.get("aadhaar_number"),
                        "PAN_Number": r.get("kyc_pan") or r.get("pan_number"), "DOB": dob, "date_of_birth": dob})
        return out

    def historical_bank_accounts(self, exclude_application_id: Optional[int]) -> List[dict]:
        sql = f"""
            SELECT aba.account_number, aba.ifsc, aba.bank_name,
                   ap.customer_id, ap.application_id, ap.participant_id, ap.is_primary
            FROM {self.s}.applicant_bank_accounts aba
            JOIN {self.s}.application_participants ap ON ap.participant_id = aba.participant_id
            WHERE (CAST(:excl AS BIGINT) IS NULL OR ap.application_id <> CAST(:excl AS BIGINT))
              AND aba.account_number IS NOT NULL
        """
        with self.session_factory() as session:
            return self._all(session, sql, {"excl": exclude_application_id})

    def historical_addresses(self, exclude_application_id: Optional[int]) -> List[dict]:
        """Addresses of other applications' participants, with the surnames rule 15 compares (family link)."""
        sql = f"""
            SELECT aa.full_address, aa.address_line_1, aa.address_line_2, aa.pincode, aa.city, aa.state,
                   CASE WHEN ap.is_primary THEN la.customer_id ELSE ap.customer_id END AS customer_id,
                   ap.application_id, la.application_number, ap.participant_id,
                   iad.first_name, iad.last_name, iad.father_last_name, iad.spouse_last_name, iad.mother_last_name
            FROM {self.s}.applicant_addresses aa
            JOIN {self.s}.application_participants ap ON ap.participant_id = aa.participant_id
            JOIN {self.s}.loan_applications la ON la.application_id = ap.application_id
            LEFT JOIN {self.s}.individual_applicant_details iad ON iad.participant_id = ap.participant_id
            WHERE (CAST(:excl AS BIGINT) IS NULL OR ap.application_id <> CAST(:excl AS BIGINT))
        """
        with self.session_factory() as session:
            return self._all(session, sql, {"excl": exclude_application_id})

    def historical_participants(self, exclude_application_id: Optional[int]) -> List[dict]:
        """Every applicant AND co-applicant of other applications, with the identifiers they were registered with
        (Aadhaar / PAN / mobile numbers), for rule 12."""
        sql = f"""
            SELECT ap.application_id, la.application_number, ap.participant_id, ap.is_primary,
                   CASE WHEN ap.is_primary THEN la.customer_id ELSE ap.customer_id END AS customer_id,
                   iad.first_name, iad.middle_name, iad.last_name, c.full_name,
                   iad.mobile_number, c.mobile_number AS customer_mobile,
                   pak.aadhaar_linked_mobile_number AS kyc_mobile, pak.aadhaar_number,
                   pak.pan_number AS kyc_pan, c.pan_number AS customer_pan,
                   ap.participant_data ->> 'pan_number' AS participant_pan
            FROM {self.s}.application_participants ap
            JOIN {self.s}.loan_applications la ON la.application_id = ap.application_id
            LEFT JOIN {self.s}.individual_applicant_details iad ON iad.participant_id = ap.participant_id
            LEFT JOIN {self.s}.customers c
                   ON c.customer_id = CASE WHEN ap.is_primary THEN la.customer_id ELSE ap.customer_id END
            LEFT JOIN {self.s}.primary_applicant_kyc pak
                   ON pak.application_id = ap.application_id AND ap.is_primary
            WHERE (CAST(:excl AS BIGINT) IS NULL OR ap.application_id <> CAST(:excl AS BIGINT))
        """
        with self.session_factory() as session:
            rows = self._all(session, sql, {"excl": exclude_application_id})
        out = []
        for r in rows:
            name = " ".join(p for p in (r.get("first_name"), r.get("middle_name"), r.get("last_name")) if p) or (
                r.get("full_name") or "")
            out.append({"application_id": r["application_id"], "application_number": r.get("application_number"),
                        "participant_id": r["participant_id"],
                        "role": "applicant" if r.get("is_primary") else "co-applicant",
                        "customer_id": r.get("customer_id"), "name": name,
                        "aadhaar": [r.get("aadhaar_number")],
                        "pan": [r.get("kyc_pan"), r.get("customer_pan"), r.get("participant_pan")],
                        "mobile": [r.get("mobile_number"), r.get("customer_mobile"), r.get("kyc_mobile")]})
        return out

    def historical_coapplicant_pans(self, exclude_application_id: Optional[int]) -> List[dict]:
        """PANs registered against a co-applicant (non-primary participant) in other applications, for rule 2. Both
        places can match: the linked customer's PAN (`pan`) and participant_data->>'pan_number' (`participant_pan`)."""
        sql = f"""
            SELECT ap.application_id, la.application_number, ap.participant_id, ap.customer_id,
                   c.pan_number AS pan, ap.participant_data ->> 'pan_number' AS participant_pan
            FROM {self.s}.application_participants ap
            JOIN {self.s}.loan_applications la ON la.application_id = ap.application_id
            LEFT JOIN {self.s}.customers c ON c.customer_id = ap.customer_id
            WHERE ap.is_primary = FALSE
              AND (CAST(:excl AS BIGINT) IS NULL OR ap.application_id <> CAST(:excl AS BIGINT))
              AND (c.pan_number IS NOT NULL OR ap.participant_data ->> 'pan_number' IS NOT NULL)
        """
        with self.session_factory() as session:
            return self._all(session, sql, {"excl": exclude_application_id})
