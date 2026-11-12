"""
LIVE END-TO-END CHECK of the credit-underwriting service: every agent's main flow over HTTP against a running server.

    python scripts/e2e_live_check.py --base-url http://127.0.0.1:8031 [--only eligibility,legal_verification,...]
                                     [--no-cleanup] [--timeout 120]

For each agent it proves three things:
  (a) the API works      -- HTTP status and response shape of every step of the agent's main flow;
  (b) the rules trigger  -- a passing and a failing / flagged input (where the agent supports both), with the rule ids,
                            their statuses and the recommendation present AND changing with the input;
  (c) the database works -- read-only SQL on the agent's own schema: the rows the flow wrote exist, carry what the API
                            returned (and rule_set_hash where the table has it); row counts before / after.

SAFETY
  * synthetic data only; every id this script makes starts with E2E- (agents that only accept their own demo / LOS seed
    records are called with those -- never modified beyond what the flow itself writes).
  * never calls a demo/reset endpoint; never changes rules or settings.
  * the DSN comes from backend/.env (LOS_AGENTIC_DSN) via python-dotenv and is never printed.
  * cleanup at the end deletes ONLY rows this run created (by the ids it recorded / its E2E- ids), child tables first,
    only in the agents' own schemas. Append-only tables (a BEFORE DELETE trigger refuses) are left and reported, as are
    rows a cascade into an append-only table would need. Nothing is ever dropped or truncated.

Output: one line per step (PASS / FAIL / INFO + reason), then a JSON summary
{agent: {passed, failed, rules_seen, db_rows_written, ...}}. Exit code 1 when any step failed.

Dependencies: standard library + httpx + psycopg + python-dotenv.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
import traceback
import uuid
from pathlib import Path
from typing import Any, Callable

import httpx
import psycopg
from dotenv import load_dotenv

BACKEND = Path(__file__).resolve().parents[1]

#: each agent's own schema(s) in the shared database -- DEFAULTS; the live values are read from
#: shared/config/agent_databases.yaml `databases.<agent>.schema` at start (dedupe keeps its trail under the `audit`
#: agent). The row diff and the cleanup are limited to these.
AGENT_SCHEMAS: dict[str, list[str]] = {
    "eligibility": ["eligibility"],
    "dedupe": ["audit"],
    "docs_policy": ["docs_policy"],
    "bank_verification": ["bank_verification"],
    "crime_verification": ["crime_verification"],
    "legal_verification": ["legal_verification"],
    "itr_verification": ["itr_verification"],
    "fraud_screening": ["fraud_screening"],
    "residence_office_verification": ["office_residence_verification"],
    "property_valuation": ["property_valuation"],
    "collateral_verification": ["collateral_check"],
}
AGENTS = list(AGENT_SCHEMAS)
#: the config key of each agent in agent_databases.yaml
CONFIG_KEY = {a: a for a in AGENTS} | {"dedupe": "audit"}
#: schemas written by triggers / shared writers (reported, never cleaned)
SHARED_SCHEMAS = ["common_audit"]


def load_schemas() -> dict[str, str]:
    """`databases.<key>.schema` from shared/config/agent_databases.yaml, read with a tiny line parser (standard
    library only: two-space keys under `databases:`, four-space `schema:` lines)."""
    path = BACKEND / "shared" / "config" / "agent_databases.yaml"
    found: dict[str, str] = {}
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return found
    inside, key = False, None
    for ln in lines:
        if ln.startswith("databases:"):
            inside = True
            continue
        if inside and ln and not ln.startswith(" ") and not ln.startswith("#"):
            break
        if not inside:
            continue
        stripped = ln.split("#", 1)[0].rstrip()
        if stripped.startswith("  ") and not stripped.startswith("   ") and stripped.endswith(":"):
            key = stripped.strip()[:-1]
        elif key and stripped.strip().startswith("schema:"):
            found[key] = stripped.split(":", 1)[1].strip().strip("'\"")
    return found


def find_dicts(obj: Any, key: str) -> list[dict]:
    """Every dict (at any depth) that has `key`."""
    out: list[dict] = []
    if isinstance(obj, dict):
        if key in obj:
            out.append(obj)
        for v in obj.values():
            out += find_dicts(v, key)
    elif isinstance(obj, list):
        for v in obj:
            out += find_dicts(v, key)
    return out

ELIG = "/api/v1/eligibility"
DEDUPE = "/api/v1/credit/dedupe"
DOCS = "/api/v1/credit/document-readiness"
BANK = "/api/v1/bank-verification"
CRIME = "/api/v1/credit/crime-verification"
LEGAL = "/api/v1/credit/legal-verification"
ITR = "/api/v1/credit/itr-verification"
FRAUD = "/api/v1/credit/fraud-screening"
ROV = "/api/v1/credit/residence-office-verification"
PV = "/api/v1/credit/property-valuation"
COLL = "/api/v1/credit/collateral-verification"


# ===================================================================================================== small helpers
def make_pdf(lines: list[str]) -> bytes:
    """A minimal one-page PDF with a real text layer (Helvetica), standard library only."""
    def esc(s: str) -> str:
        return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    body = "BT /F1 11 Tf 50 790 Td 15 TL " + " ".join(f"({esc(ln)}) Tj T*" for ln in lines) + " ET"
    stream = body.encode("latin-1", "replace")
    objs = [b"<< /Type /Catalog /Pages 2 0 R >>",
            b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> "
            b"/Contents 5 0 R >>",
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
            b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream"]
    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + o + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def short(value: Any, n: int = 220) -> str:
    text = value if isinstance(value, str) else json.dumps(value, default=str)
    text = " ".join(text.split())
    return text if len(text) <= n else text[: n - 3] + "..."


def jget(d: Any, *path: Any, default: Any = None) -> Any:
    for p in path:
        if isinstance(d, dict):
            d = d.get(p)
        elif isinstance(d, list) and isinstance(p, int) and -len(d) <= p < len(d):
            d = d[p]
        else:
            return default
        if d is None:
            return default
    return d


class StepFailed(Exception):
    """Stop the agent's flow: a later step depends on this one."""


# ============================================================================================================ the run
class Run:
    def __init__(self, base_url: str, timeout: float, dsn: str):
        self.base = base_url.rstrip("/")
        self.http = httpx.Client(base_url=self.base, timeout=timeout)
        self.dsn = dsn
        self.db = psycopg.connect(dsn, autocommit=True)          # reads only (cleanup has its own connection)
        self.db.execute("SET default_transaction_read_only = on")
        self.tag = time.strftime("%m%d%H%M") + uuid.uuid4().hex[:4].upper()
        self.started = time.time()
        self.results: dict[str, dict[str, Any]] = {}
        self.agent = ""
        #: cleanup plan: (agent, schema, table, column, values) -- executed in the order registered, per agent
        self.cleanup_plan: list[tuple[str, str, str, str, list[Any]]] = []
        #: rows left on purpose: (agent, schema, table, how many, why)
        self.left: list[tuple[str, str, str, int, str]] = []
        self.failed_any = False

    # ---- reporting
    def _res(self) -> dict[str, Any]:
        return self.results.setdefault(self.agent, {"passed": 0, "failed": 0, "rules_seen": [], "db_rows_written": {},
                                                    "notes": []})

    def check(self, name: str, ok: bool, detail: Any = "", *, fatal: bool = False) -> bool:
        res = self._res()
        if ok:
            res["passed"] += 1
        else:
            res["failed"] += 1
            self.failed_any = True
        print(f"{'PASS' if ok else 'FAIL'}  [{self.agent}] {name}" + (f" -- {short(detail)}" if detail != "" else ""),
              flush=True)
        if not ok and fatal:
            raise StepFailed(name)
        return ok

    def info(self, text: str) -> None:
        print(f"INFO  [{self.agent}] {text}", flush=True)
        self._res()["notes"].append(text)

    def rules(self, *ids: Any) -> None:
        seen = self._res()["rules_seen"]
        for i in ids:
            if i is not None and str(i) not in seen:
                seen.append(str(i))

    # ---- HTTP
    def call(self, method: str, path: str, name: str, *, expect: int | tuple[int, ...] = 200, fatal: bool = True,
             **kw: Any) -> httpx.Response | None:
        expected = (expect,) if isinstance(expect, int) else expect
        t0 = time.perf_counter()
        try:
            r = self.http.request(method, path, **kw)
        except httpx.HTTPError as exc:
            self.check(f"{method} {path} ({name})", False, f"transport error {type(exc).__name__}: {exc}", fatal=fatal)
            return None
        ms = (time.perf_counter() - t0) * 1000
        ok = r.status_code in expected
        detail = f"HTTP {r.status_code} in {ms:.0f} ms" + ("" if ok else f"; expected {expected}; body {short(r.text, 400)}")
        self.check(f"{method} {path} ({name})", ok, detail, fatal=fatal)
        return r

    # ---- SQL (read-only)
    def q(self, sql: str, params: tuple | list = ()) -> list[tuple]:
        return self.db.execute(sql, params).fetchall()

    def q1(self, sql: str, params: tuple | list = ()) -> Any:
        row = self.db.execute(sql, params).fetchone()
        return row[0] if row else None

    def schema(self) -> str:
        """The current agent's own schema (from the config)."""
        return AGENT_SCHEMAS[self.agent][0]

    def t(self, table: str) -> str:
        """`"schema"."table"` in the current agent's own schema."""
        return f'"{self.schema()}"."{table}"'

    def table_exists(self, schema: str, table: str) -> bool:
        return bool(self.q1("SELECT to_regclass(%s) IS NOT NULL", (f'"{schema}"."{table}"',)))

    def columns(self, schema: str, table: str) -> set[str]:
        return {r[0] for r in self.q("SELECT column_name FROM information_schema.columns WHERE table_schema=%s AND "
                                     "table_name=%s", (schema, table))}

    def counts(self, schemas: list[str]) -> dict[str, int]:
        out: dict[str, int] = {}
        for s, t in self.q("SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema = ANY(%s) "
                           "AND table_type = 'BASE TABLE'", (schemas,)):
            out[f"{s}.{t}"] = int(self.q1(f'SELECT count(*) FROM "{s}"."{t}"'))
        return out

    # ---- cleanup registry
    def own(self, schema: str, table: str, column: str, values: list[Any]) -> None:
        values = [v for v in values if v is not None]
        if values:
            self.cleanup_plan.append((self.agent, schema, table, column, values))

    def leave(self, schema: str, table: str, n: int, why: str) -> None:
        if n:
            self.left.append((self.agent, schema, table, n, why))


# ======================================================================================================== the agents
# Each flow raises StepFailed when a step the rest depends on failed; the runner records it and goes on.

def flow_eligibility(r: Run) -> None:
    runs: list[str] = []

    def check_case(case_id: str, label: str, body_extra: dict, want: str, failing_rule: str | None) -> dict:
        resp = r.call("POST", f"{ELIG}/check", f"{label}: {case_id}", fatal=False,
                      json={"case_id": case_id, "use_saved": False, "detail": True, **body_extra})
        if resp is None or resp.status_code != 200:
            return {}
        j = resp.json()
        rules = {x.get("rule"): x.get("result") for x in j.get("rules") or []}
        r.rules(*rules)
        r.check(f"{label}: decision {want}", j.get("decision") == want, f"decision={j.get('decision')} rules={rules}")
        r.check(f"{label}: five rules reported (AGE, INCOME, SCORE, DPD, FOIR)",
                {"AGE", "INCOME", "SCORE", "DPD", "FOIR"} <= set(rules), rules)
        if failing_rule:
            r.check(f"{label}: rule {failing_rule} fails", rules.get(failing_rule) == "fail", rules)
        else:
            r.check(f"{label}: every applicable rule passes",
                    all(v in ("pass", "not_applicable") for v in rules.values()), rules)
        run_id = j.get("run_id")
        r.check(f"{label}: run saved (run_id returned)", bool(run_id),
                "no run_id: the decision was returned but NOT stored in eligibility_runs" if not run_id else run_id)
        if run_id:
            runs.append(run_id)
        return j

    ok = check_case("CASE-E11D00000006", "passing case", {}, "APPROVED", None)
    low = check_case("CASE-E11D00000006", "same case, income below the minimum",
                     {"income": {"method": "SALARIED", "gross_salary": 15000, "pf_deduction": 0, "other_deduction": 0,
                                 "other_income": 0}}, "REJECTED", "INCOME")
    bad = check_case("CASE-E11D00000018", "failing case (bureau score 610)", {}, "REJECTED", "SCORE")
    if ok and low:
        r.check("decision changes with the input (same case)", ok.get("decision") != low.get("decision"),
                f"{ok.get('decision')} -> {low.get('decision')}")
    r.call("GET", f"{ELIG}/cases/CASE-E11D00000006", "case view", fatal=False)
    for run_id in runs:
        g = r.call("GET", f"{ELIG}/runs/{run_id}", "saved run read back", fatal=False)
        row = r.q("SELECT case_id, decision, rule_set_hash FROM eligibility.eligibility_runs WHERE run_id=%s", (run_id,))
        r.check(f"DB eligibility_runs has {run_id} with rule_set_hash", bool(row and row[0][2]), row)
        if g is not None and g.status_code == 200 and row:
            r.check("API run == DB run (decision)", jget(g.json(), "decision") in (row[0][1], None)
                    or row[0][1] in json.dumps(g.json()), f"db={row[0][1]}")
    r.own("eligibility", "eligibility_runs", "run_id", runs)
    _ = bad


def flow_dedupe(r: Run) -> None:
    base = "CASE-SEED-LOS-DUMMY-0050"
    if not r.q1("SELECT 1 FROM public.applications WHERE case_id=%s", (base,)):
        base = r.q1("SELECT case_id FROM public.applications ORDER BY case_id LIMIT 1")
    r.info(f"dedupe runs on the LOS seed case {base} (dedupe only accepts an existing LOS case)")
    own_app = r.q1("SELECT applicant_id FROM public.applications WHERE case_id=%s", (base,))
    other = r.q("SELECT a.case_id, p.mobile FROM public.applications a JOIN public.applicants p USING (applicant_id) "
                "WHERE a.applicant_id <> %s AND p.mobile ~ '^[6-9][0-9]{9}$' ORDER BY a.case_id LIMIT 1", (own_app,))
    if not r.check("a synthetic mobile of another LOS seed case exists (for the MATCH input)", bool(other), fatal=True):
        return
    match_mobile = other[0][1]
    while True:                                         # a valid mobile that is on no LOS record
        nomatch = "6" + "".join(random.choice("0123456789") for _ in range(9))
        if not r.q1("SELECT 1 FROM public.applicants WHERE mobile=%s", (nomatch,)):
            break
    ids: list[str] = []
    out: dict[str, dict] = {}
    for label, param, value in (("match: mobile of another case", "Mobile No", match_mobile),
                                ("no-match: unseen mobile", "Mobile No", nomatch),
                                ("no-match: unseen PAN", "PAN", "ZQXPZ9137K")):
        resp = r.call("POST", DEDUPE, label, fatal=False,
                      json={"case_id": base, "dedupe_parameter": param, "dedupe_parameter_value": value,
                            "customer_type": "New"})
        if resp is None or resp.status_code != 200:
            continue
        j = resp.json()
        out[label] = j
        ids.append(j.get("request_id"))
        search = jget(j, "los_dedupe", "search", default={})
        r.rules(*(x.get("rule_id") for x in jget(j, "evaluation", "rules", default=[]) if isinstance(x, dict)))
        r.rules(*(s.get("scenario") for s in jget(j, "los_dedupe", "case", "scenarios", default=[]) if isinstance(s, dict)))
        r.check(f"{label}: outcome + reason codes present",
                bool(j.get("outcome")) and isinstance(j.get("reason_codes"), list),
                f"outcome={j.get('outcome')} search={search.get('status')} reasons={search.get('reason_codes')}")
        r.check(f"{label}: no searched value echoed", value not in resp.text, "the searched identifier is in the body")
        if label.startswith("match"):
            r.check("match: LOS search finds the other case", search.get("status") in ("MATCH", "POSSIBLE_MATCH")
                    and len(search.get("matches") or []) > 0, f"status={search.get('status')} n={len(search.get('matches') or [])}")
        else:
            r.check(f"{label}: LOS search says NO_MATCH", search.get("status") == "NO_MATCH"
                    and not search.get("matches"), f"status={search.get('status')} reasons={search.get('reason_codes')}")
        r.check(f"{label}: audit recorded", jget(j, "audit", "recorded") is True, j.get("audit"))
    if len(out) >= 2:
        statuses = {k: jget(v, "los_dedupe", "search", "status") for k, v in out.items()}
        r.check("search status changes with the input", len(set(statuses.values())) > 1, statuses)
    for rid in ids:
        g = r.call("GET", f"{DEDUPE}/{rid}/reason", "3-point reason", expect=(200, 404, 409), fatal=False)
        _ = g
    # DB: the decision trail in the dedupe agent's schema (`audit`)
    if r.table_exists("audit", "audit_customer_history"):
        n = r.q1("SELECT count(*) FROM audit.audit_customer_history WHERE request_id = ANY(%s)", (ids,))
        r.check("DB audit.audit_customer_history has a row per check", n >= len(ids), f"{n} rows for {len(ids)} checks")
        r.leave("audit", "audit_customer_history", n, "append-only (trigger refuses DELETE)")
    else:
        r.check("DB audit.audit_customer_history exists", False, "table missing")
    if r.table_exists("audit", "audit_dedupe_decisions"):
        rows = r.q("SELECT d.request_id, d.rule_set_hash FROM audit.audit_dedupe_decisions d WHERE d.occurred_at >= "
                   "to_timestamp(%s) AND d.case_id = %s", (r.started, base))
        r.check("DB audit.audit_dedupe_decisions has this run's decisions with rule_set_hash",
                len(rows) >= len(ids) and all(x[1] for x in rows), f"{len(rows)} rows, hashes={[bool(x[1]) for x in rows]}")
        r.leave("audit", "audit_dedupe_decisions", len(rows), "append-only (trigger refuses DELETE)")


def flow_docs_policy(r: Run) -> None:
    cases = {"CASE-D0C500000001": "COMPLETE", "CASE-D0C500000002": "ACTION_REQUIRED"}
    answers = {}
    for case_id, want in cases.items():
        before = r.q1("SELECT count(*) FROM docs_policy.docs_policy_evaluations WHERE case_id=%s", (case_id,))
        resp = r.call("POST", f"{DOCS}/{case_id}/rules", f"readiness + 11 rules ({want} expected)", fatal=False)
        if resp is None or resp.status_code != 200:
            continue
        j = resp.json()
        answers[case_id] = j
        board = j.get("rules") or []
        r.rules(*(x.get("rule_id") or x.get("id") for x in board if isinstance(x, dict)))
        r.check(f"{case_id}: overall_status {want}", jget(j, "answer", "overall_status") == want,
                f"overall={jget(j, 'answer', 'overall_status')} action={jget(j, 'answer', 'recommended_action')}")
        r.check(f"{case_id}: eleven rules on the board", len(board) == 11, f"{len(board)} rules")
        evid = jget(j, "answer", "audit", "evaluation_id")
        rows = r.q("SELECT evaluation_id, overall_status, rule_set_hash FROM docs_policy.docs_policy_evaluations "
                   "WHERE case_id=%s AND recorded_at >= to_timestamp(%s)", (case_id, r.started))
        after = r.q1("SELECT count(*) FROM docs_policy.docs_policy_evaluations WHERE case_id=%s", (case_id,))
        r.check(f"DB docs_policy_evaluations stored this evaluation (or replayed an identical one)",
                bool(rows) or after >= before, f"new rows={len(rows)} before={before} after={after} evaluation_id={evid}")
        if rows:
            r.check("DB evaluation carries rule_set_hash and the API status", all(x[2] for x in rows)
                    and rows[-1][1] == jget(j, "answer", "overall_status"), rows)
            r.own("docs_policy", "docs_policy_requirement_results", "evaluation_id", [x[0] for x in rows])
            r.own("docs_policy", "docs_policy_evaluations", "evaluation_id", [x[0] for x in rows])
    if len(answers) == 2:
        st = {k: jget(v, "answer", "overall_status") for k, v in answers.items()}
        r.check("readiness changes with the case's documents", len(set(st.values())) == 2, st)
    plain = r.call("POST", f"{DOCS}/CASE-D0C500000002", "plain readiness answer", fatal=False)
    if plain is not None and plain.status_code == 200:
        r.check("plain answer lists open requirements", len(plain.json().get("requirements") or []) > 0,
                short(plain.json().get("requirements")))


def bank_csv(holder: str, account: str) -> bytes:
    """A synthetic CSV bank statement in the agent's reader format ('# key: value' header, then the rows)."""
    rows = [("2026-10-01", "OPENING", "", "", "", "50000.00"),
            ("2026-10-20", "NEFT SALARY SYNTHETIC EMPLOYER", "NEFT001", "", "25000.00", "75000.00"),
            ("2026-10-22", "UPI GROCERY", "UPI002", "1200.00", "", "73800.00"),
            ("2026-10-25", "UPI ELECTRICITY", "UPI003", "800.00", "", "73000.00")]
    head = [f"# bank_name: State Bank of India", f"# account_holder: {holder}", f"# account_number: {account}",
            "# account_type: SAVINGS", "# ifsc: SBIN0001234", "# period: 2026-10-01 to 2026-10-31",
            "# opening_balance: 50000.00", "# closing_balance: 73000.00", "date,narration,reference,debit,credit,balance"]
    body = [",".join(r) for r in rows[1:]]
    return ("\n".join(head + body) + "\n").encode("utf-8")


def flow_bank_verification(r: Run) -> None:
    taken = {x[0] for x in r.q("SELECT case_id FROM bank_verification.cases")} \
        if r.table_exists("bank_verification", "cases") else set()
    candidates = [x[0] for x in r.q("SELECT case_id FROM public.applications WHERE case_id LIKE 'CASE-SEED-LOS-DUMMY-%%' "
                                    "ORDER BY case_id DESC LIMIT 50")]
    case_id = next((c for c in candidates if c not in taken), None)
    if not r.check("an LOS seed case not yet opened in bank verification", bool(case_id), fatal=True):
        return
    r.info(f"bank verification opens LOS seed case {case_id} (it only works on its own or LOS cases)")
    r.call("GET", f"{BANK}/config", "config")
    r.call("GET", f"{BANK}/summary", "dashboard counts (needs the store)")
    look = r.call("GET", f"{BANK}/lookup", "open the LOS case", params={"ref": case_id})
    r.check("lookup returns the case id", look.json().get("case_id") == case_id, look.json())
    created = r.q1("SELECT created_at FROM bank_verification.cases WHERE case_id=%s", (case_id,))
    r.check("DB bank_verification.cases row opened from the LOS", created is not None, created)
    r.own("bank_verification", "cases", "case_id", [case_id])          # cascades: sources/documents/runs/...
    n_audit = r.q1("SELECT count(*) FROM bank_verification.audit_events WHERE case_id=%s", (case_id,))
    detail = r.call("GET", f"{BANK}/cases/{case_id}", "case detail").json()
    holder = jget(detail, "case", "applicant_name") or jget(detail, "applicant_name") or "Synthetic Applicant"
    account = "30001234567890"
    entered = {"bank_name": "State Bank of India", "account_number": account, "account_type": "SAVINGS",
               "transactions": [{"date": "2026-10-25", "amount": "800.00", "direction": "DEBIT"},
                                {"date": "2026-10-22", "amount": "1200.00", "direction": "DEBIT"},
                                {"date": "2026-10-20", "amount": "25000.00", "direction": "CREDIT"}]}
    runs = {}
    for label, ent in (("statement + entered details that agree", entered),
                       ("statement + entered account number that differs", {**entered, "account_number": "30009999999999"})):
        req = {"case_id": case_id, "mode": "AA_FAILURE", "statement_source": "UPLOAD", "entered": ent}
        resp = r.call("POST", f"{BANK}/process", f"API 1: {label}", fatal=False, expect=(200, 202),
                      data={"request": json.dumps(req)},
                      files={"statement": (f"E2E-{r.tag}-statement.csv", bank_csv(holder, account), "text/csv")},
                      headers={"Idempotency-Key": f"E2E-{r.tag}-{len(runs)}"})
        if resp is None or resp.status_code not in (200, 202):
            continue
        j = resp.json()
        runs[label] = j
        rules = {x.get("rule_id"): x.get("status") for x in j.get("rules") or []}
        r.rules(*rules)
        r.check(f"{label}: eight rules + overall", len(rules) >= 8 and bool(j.get("overall_status")),
                f"overall={j.get('overall_status')} rules={rules}")
    if len(runs) == 2:
        a, b = ({x.get("rule_id"): x.get("status") for x in v.get("rules") or []} for v in runs.values())
        r.check("bank-details rule: agreeing PASS, differing FAIL / REVIEW",
                a.get("R1") == "PASS" and b.get("R1") in ("FAIL", "REVIEW_REQUIRED"), f"R1 {a.get('R1')} -> {b.get('R1')}")
        r.check("rule outcome changes with the entered details", a != b, {"agree": a, "differ": b})
    rows = r.q("SELECT run_id, rule_set_hash FROM bank_verification.runs WHERE case_id=%s", (case_id,))
    r.check("DB bank_verification.runs rows with rule_set_hash", len(rows) >= len(runs) and all(x[1] for x in rows),
            rows)
    rr = r.q1("SELECT count(*) FROM bank_verification.rule_results WHERE run_id = ANY(%s)", ([x[0] for x in rows],))
    r.check("DB bank_verification.rule_results written", rr >= 8 * len(rows), f"{rr} rule rows")
    nd = r.q1("SELECT count(*) FROM bank_verification.documents WHERE case_id=%s AND role='STATEMENT'", (case_id,))
    r.check("DB bank_verification.documents: the uploaded statement", nd >= 1, nd)
    fin_req = {"agency_id": "AGY-NORTHSTAR", "checklist": {"bank_name": "VERIFIED", "account_number": "MISMATCH",
                                                           "account_type": "VERIFIED", "account_holder": "VERIFIED",
                                                           "latest_transactions": "VERIFIED",
                                                           "statement_authentic": "VERIFIED"},
               "branch_visit": "COMPLETED", "ownership": "NOT_CONFIRMED", "requested_decision": "NEGATIVE",
               "rationale": "E2E synthetic: account number mismatch at the branch."}
    agency_pdf = make_pdf(["BANK VERIFICATION REPORT (synthetic E2E document)", f"Case {case_id}",
                           "Agency: Northstar Field Verification", "Branch visit: completed",
                           f"Account number on the statement: {account}", "Account number confirmed by the branch: NO",
                           "Ownership: not confirmed", "Recommendation: NEGATIVE"])
    fin = r.call("POST", f"{BANK}/{case_id}/finalize", "API 2: agency finalizes NEGATIVE (with its report)",
                 fatal=False, data={"request": json.dumps(fin_req)},
                 files={"report": (f"E2E-{r.tag}-agency-report.pdf", agency_pdf, "application/pdf")})
    if fin is not None and fin.status_code == 200:
        d = r.q("SELECT final_status FROM bank_verification.decisions WHERE case_id=%s", (case_id,))
        r.check("DB bank_verification.decisions row NEGATIVE", bool(d) and d[-1][0] == "NEGATIVE", d)
        st = r.q1("SELECT status FROM bank_verification.cases WHERE case_id=%s", (case_id,))
        r.check("DB case status after finalize", st == "NEGATIVE", st)
    r.call("GET", f"{BANK}/cases/{case_id}/history", "history", fatal=False)
    rep = r.call("GET", f"{BANK}/cases/{case_id}/report", "report pdf", fatal=False)
    if rep is not None and rep.status_code == 200:
        r.check("report is a PDF", rep.content[:4] == b"%PDF", rep.headers.get("content-type"))
    n_audit2 = r.q1("SELECT count(*) FROM bank_verification.audit_events WHERE case_id=%s", (case_id,))
    r.leave("bank_verification", "audit_events", n_audit2 - n_audit, "append-only (trigger refuses DELETE)")


def flow_crime_verification(r: Run) -> None:
    people = [
        {"role": "PRIMARY", "full_name": "Esha Tiwari", "father_name": "Ramesh Tiwari", "date_of_birth": "1990-04-12",
         "permanent_address": "Flat 7, Sunrise Residency, Baner, Pune 411045", "pan": "ZZQPT1234E"},
        {"role": "CO_APPLICANT", "seq": 1, "full_name": "Kunal Tiwari", "father_name": "Ramesh Tiwari",
         "date_of_birth": "1993-09-30", "permanent_address": "Flat 7, Sunrise Residency, Baner, Pune 411045",
         "pan": "ZZQPT5678K"}]
    cases: dict[str, dict] = {}
    for kind, scenario, decision, remarks in (("OK", "NO_RISK", "ACCEPTED", ""),
                                              ("HIGH", "HIGH_RISK", "REFER_TO_CREDIT", "E2E: high risk findings, refer.")):
        app = f"E2E-CRM-{r.tag}-{kind}"
        put = r.call("PUT", f"{CRIME}/applications/{app}", f"intake {app}", fatal=False,
                     json={"title": f"E2E {kind}", "branch": "MUM", "product": "Home Loan", "loan_amount": 2500000,
                           "stage": "Credit Assessment", "status": "Open", "people": people})
        if put is None or put.status_code != 200:
            continue
        r.check(f"{kind}: intake masks the PAN", "ZZQPT1234E" not in put.text, "full PAN in the intake answer")
        subjects = [{k: v for k, v in p.items() if k != "pan"} for p in people]
        body = {"application_id": app, "subjects": subjects, "confirmation_accepted": True, "demo_scenario": scenario}
        key = f"E2E-{r.tag}-{kind}"
        ini = r.call("POST", f"{CRIME}/initiate", f"{kind}: API 1 initiate ({scenario})", expect=201, fatal=False,
                     json=body, headers={"Idempotency-Key": key})
        if ini is None or ini.status_code != 201:
            continue
        case = ini.json()
        cases[kind] = case
        risks = [jget(s, "result", "risk_level") for s in case.get("subjects") or []]
        r.rules(*risks, case.get("status"))
        r.check(f"{kind}: every subject has a result with risk {scenario}", len(risks) == 2 and set(risks) == {scenario},
                f"status={case.get('status')} risks={risks}")
        again = r.call("POST", f"{CRIME}/initiate", f"{kind}: same Idempotency-Key replays", expect=200, fatal=False,
                       json=body, headers={"Idempotency-Key": key})
        if again is not None and again.status_code == 200:
            r.check(f"{kind}: replay returns the same case", again.json().get("case_id") == case["case_id"]
                    and again.json().get("replayed") is True, short(again.json(), 120))
        cid = case["case_id"]
        r.call("GET", f"{CRIME}/cases/{cid}/status", f"{kind}: status", fatal=False)
        r.call("GET", f"{CRIME}/cases/{cid}/summary", f"{kind}: summary", fatal=False)
        sid = jget(case, "subjects", 0, "subject_id")
        if sid:
            r.call("GET", f"{CRIME}/subjects/{sid}/result", f"{kind}: subject result", fatal=False)
        fin = r.call("POST", f"{CRIME}/{cid}/finalize", f"{kind}: API 2 finalize {decision}", fatal=False,
                     json={"decision": decision, "remarks": remarks})
        if fin is not None and fin.status_code == 200:
            r.check(f"{kind}: final decision recorded", fin.json().get("final_decision") == decision,
                    fin.json().get("final_decision"))
        rep = r.call("GET", f"{CRIME}/cases/{cid}/report", f"{kind}: case report pdf", fatal=False)
        if rep is not None and rep.status_code == 200:
            r.check(f"{kind}: report is a PDF", rep.content[:4] == b"%PDF", rep.headers.get("content-type"))
        # DB
        row = r.q("SELECT status, final_decision FROM crime_verification.crime_verification_cases WHERE case_id=%s", (cid,))
        r.check(f"DB {kind}: case row with the API status + decision", bool(row) and row[0][1] == decision
                and row[0][0] == jget(fin.json() if fin is not None and fin.status_code == 200 else {}, "status",
                                      default=row[0][0] if row else None), row)
        res = r.q("SELECT r.risk_level, r.rule_set_hash FROM crime_verification.crime_verification_results r JOIN "
                  "crime_verification.crime_verification_subjects s USING (subject_id) WHERE s.case_id=%s", (cid,))
        r.check(f"DB {kind}: results stored with rule_set_hash", len(res) == 2 and all(x[1] for x in res)
                and {x[0] for x in res} == {scenario}, res)
        n_app = r.q1("SELECT count(*) FROM crime_verification.crime_verification_applications WHERE application_id=%s", (app,))
        r.check(f"DB {kind}: application row", n_app == 1, n_app)
        n_audit = r.q1("SELECT count(*) FROM crime_verification.crime_verification_audit WHERE application_id=%s", (app,))
        r.check(f"DB {kind}: audit trail rows", n_audit >= 3, f"{n_audit} events")
    if len(cases) == 2:
        r.check("case status changes with the vendor result", cases["OK"].get("status") != cases["HIGH"].get("status"),
                {k: v.get("status") for k, v in cases.items()})
    # crime_verification_audit is append-only and cascades from applications / cases: those rows cannot be removed
    apps = [x[0] for x in r.q("SELECT application_id FROM crime_verification.crime_verification_applications WHERE "
                              "application_id LIKE %s", (f"E2E-CRM-{r.tag}-%",))]
    for tbl, col in (("crime_verification_audit", "application_id"), ("crime_verification_applications", "application_id"),
                     ("crime_verification_parties", "application_id"), ("crime_verification_cases", "application_id"),
                     ("crime_verification_subjects", "application_id")):
        n = r.q1(f"SELECT count(*) FROM crime_verification.{tbl} WHERE {col} = ANY(%s)", (apps,))
        r.leave("crime_verification", tbl, n, "append-only audit (and the cascade into it) refuses DELETE")


LEGAL_ANSWERS = {
    "owners": [{"first": "Sneha", "middle": "", "last": "Iyer"}], "property_belongs_to": "APPLICANT",
    "documents_provided": "Sale Deed, EC", "property_history": "Bought from Joseph Dsouza in 2018.",
    "title_docs_checked": "yes", "registered_mortgage": "no",
    "property_address": "Flat B-1104, Lakeview Towers, Powai, Mumbai 400076",
    "property_type": "RESIDENTIAL_FLAT", "document_type": "SALE_DEED", "sale_deed_number": "KRL1/5512/2018",
    "sale_deed_date": "19-03-2018", "sub_registrar_office": "SRO Kurla 1", "ec_obtained": "yes",
    "ec_from": "2005-01-01", "ec_to": "2026-10-01", "encumbrance_found": "no", "cersai_records_found": "no",
    "cersai_searches": [{"search_type": "DEBTOR_BASED", "result": "No relevant results"}],
    "property_doc_years": 20, "state": "Maharashtra", "district": "Mumbai Suburban",
    "title_traced_adequately": "yes", "chain_maintained": "yes", "ec_verified": "yes", "flat_title_certified": "yes",
    "flat_undivided_share": "na", "equitable_mortgage_possible": "yes", "title_clear_marketable": "yes",
    "roc_search": "na", "report_date": "2026-10-01", "report_reference": "LV/2026/E2E",
    "advocate_name": "Adv. Synthetic Signer",
    "documents_examined": [{"instrument": "SALE_DEED", "reg_no": "KRL1/5512/2018", "date": "19-03-2018",
                            "executed_by": "Joseph Dsouza", "in_favour_of": "Sneha Iyer", "copy": "ORIGINAL"}],
    "opinion_text": "Title clear and marketable, subject to the original deed being deposited.",
    "opinion_conditions": [{"condition": "Original Sale Deed deposited before disbursal"}]}


def flow_legal_verification(r: Run) -> None:
    def err(resp: httpx.Response) -> str | None:
        try:
            return jget(resp.json(), "error", "code")
        except ValueError:
            return None

    runs: dict[str, dict] = {}
    for kind in ("OK", "BAD"):
        app = f"E2E-LGV-{r.tag}-{kind}"
        h = {"Idempotency-Key": f"E2E-{r.tag}-{kind}-send"}
        put = r.call("PUT", f"{LEGAL}/applications/{app}", f"{kind}: create application", fatal=False,
                     json={"branch": "MUM", "product": "Home Loan", "loan_amount": 6400000, "applicant_name": "Sneha Iyer",
                           "property_type": "RESIDENTIAL_FLAT",
                           "property_address": "Flat B-1104, Lakeview Towers, Powai, Mumbai", "property_pin": "400076",
                           "owner_names": ["Sneha Iyer"], "stage": "Credit Assessment",
                           "details": {"owner_first_name": "Sneha", "owner_last_name": "Iyer", "flat_no": "B-1104",
                                       "address_line1": "Lakeview Towers", "address_line2": "Powai",
                                       "district": "Mumbai Suburban", "city": "Mumbai", "state": "Maharashtra",
                                       "pin_code": "400076", "property_type": "RESIDENTIAL_FLAT",
                                       "property_usage": "Residential"}})
        if put is None or put.status_code != 200:
            continue
        pdf = make_pdf(["SALE DEED (synthetic E2E test document)", f"Application {app}",
                        "Buyer: Sneha Iyer   Seller: Joseph Dsouza", "Registration No. KRL-1/5512/2018 dated 19-03-2018",
                        "Flat B-1104, Lakeview Towers, Powai, Mumbai 400076"])
        up = r.call("POST", f"{LEGAL}/applications/{app}/documents", f"{kind}: upload SALE_DEED pdf", fatal=False,
                    data={"kind": "SALE_DEED"}, files={"file": (f"{app}-sale-deed.pdf", pdf, "application/pdf")})
        if up is None or up.status_code != 200:
            continue
        w = up.json()
        r.check(f"{kind}: case DOCUMENTS_UPLOADED, send allowed", jget(w, "case", "status") == "DOCUMENTS_UPLOADED"
                and jget(w, "can", "send") is True, f"status={jget(w, 'case', 'status')} can={w.get('can')}")
        deed = r.call("POST", f"{LEGAL}/applications/{app}/sale-deed", f"{kind}: sale-deed details", fatal=False,
                      json={"values": {"owner_names": "Sneha Iyer", "seller_names": "Joseph Dsouza",
                                       "document_type": "SALE_DEED", "sale_deed_number": "KRL-1/5512/2018",
                                       "sale_deed_date": "19-03-2018", "sub_registrar_office": "Sub-Registrar Kurla 1",
                                       "property_address": "Flat B-1104, Lakeview Towers, Powai, Mumbai",
                                       "pin_code": "400076"}})
        if deed is not None and deed.status_code == 200:
            f = {x["field"]: x for x in deed.json().get("deed") or []}
            r.check(f"{kind}: deed date normalised", jget(f, "sale_deed_date", "value") == "2018-03-19",
                    jget(f, "sale_deed_date"))
        nc = r.call("POST", f"{LEGAL}/applications/{app}/send", f"{kind}: send without confirmation refused",
                    expect=(400, 409, 422), fatal=False, json={"agency": "LEX_ASSOCIATES"})
        if nc is not None:
            r.check(f"{kind}: NOT_CONFIRMED", err(nc) == "NOT_CONFIRMED", err(nc))
        sent = r.call("POST", f"{LEGAL}/applications/{app}/send", f"{kind}: send to agency", fatal=False,
                      json={"agency": "LEX_ASSOCIATES", "confirmation_accepted": True}, headers=h)
        if sent is None:
            continue
        st = r.q1("SELECT status FROM legal_verification.legal_verification_cases WHERE application_id=%s "
                  "ORDER BY created_at DESC LIMIT 1", (app,))
        if sent.status_code != 200:
            r.check(f"{kind}: a refused send leaves the case unsent", st not in ("WITH_AGENCY", "REPORT_RECEIVED"),
                    f"HTTP {sent.status_code} {err(sent)} but the case is {st} in the database")
            if st not in ("WITH_AGENCY", "REPORT_RECEIVED", "VALIDATED"):
                continue
        else:
            r.check(f"{kind}: sent (WITH_AGENCY, or the demo agency already answered)",
                    jget(sent.json(), "case", "status") in ("WITH_AGENCY", "REPORT_RECEIVED", "VALIDATED"),
                    jget(sent.json(), "case", "status"))
        answers = json.loads(json.dumps(LEGAL_ANSWERS))
        answers["report_reference"] = f"LV/E2E/{r.tag}/{kind}"
        if kind == "BAD":                         # a different owner on the deed + an active CERSAI charge
            answers["owners"] = [{"first": "Prakash", "middle": "", "last": "Shetty"}]
            answers["documents_examined"][0]["in_favour_of"] = "Prakash Shetty"
            answers["property_belongs_to"] = "THIRD_PARTY"
            answers["cersai_records_found"] = "yes"
            answers["cersai_searches"] = [{"search_type": "DEBTOR_BASED", "result": "1 active charge (not satisfied)"}]
        rep = r.call("POST", f"{LEGAL}/applications/{app}/agency-report", f"{kind}: agency report submitted",
                     fatal=False, json={"answers": answers})
        if rep is None or rep.status_code != 200:
            continue
        r.check(f"{kind}: report received", jget(rep.json(), "case", "status") in ("REPORT_RECEIVED", "VALIDATED"),
                jget(rep.json(), "case", "status"))
        gen = r.call("POST", f"{LEGAL}/applications/{app}/agency-report/generate", f"{kind}: generate report + rules",
                     fatal=False)
        if gen is None or gen.status_code != 200:
            continue
        val = r.call("POST", f"{LEGAL}/applications/{app}/validate", f"{kind}: validate (ten rules)", fatal=False)
        w = val.json() if val is not None and val.status_code == 200 else gen.json()
        rules = {x["id"]: x["status"] for x in jget(w, "run", "rules", default=[])}
        rec = jget(w, "run", "overview", "recommendation")
        runs[kind] = {"rules": rules, "rec": rec, "app": app}
        r.rules(*rules, rec)
        r.check(f"{kind}: ten rule results", len(rules) == 10 and set(rules) == {f"R{i}" for i in range(1, 11)}, rules)
        if kind == "OK":
            r.check("OK: R1 owner matches -> PASS; recommendation CLEAR_FOR_REVIEW / REVIEW_REQUIRED",
                    rules.get("R1") == "PASS" and rec in ("CLEAR_FOR_REVIEW", "REVIEW_REQUIRED"), f"R1={rules.get('R1')} rec={rec}")
            dec = r.call("POST", f"{LEGAL}/applications/{app}/decision", "OK: decision PROCEED", fatal=False,
                         json={"decision": "PROCEED", "remarks": ""})
            want = "PROCEED"
        else:
            r.check("BAD: R1 owner differs -> FAIL; R6 CERSAI charge -> FAIL; ESCALATE",
                    rules.get("R1") == "FAIL" and rules.get("R6") == "FAIL" and rec == "ESCALATE",
                    f"R1={rules.get('R1')} R6={rules.get('R6')} rec={rec}")
            blocked = r.call("POST", f"{LEGAL}/applications/{app}/decision", "BAD: PROCEED refused while ESCALATE",
                             expect=(400, 409, 422), fatal=False, json={"decision": "PROCEED", "remarks": ""})
            _ = blocked
            dec = r.call("POST", f"{LEGAL}/applications/{app}/decision", "BAD: decision ESCALATE_TO_LEGAL", fatal=False,
                         json={"decision": "ESCALATE_TO_LEGAL", "remarks": "E2E: owner mismatch and an active charge."})
            want = "ESCALATE_TO_LEGAL"
        if dec is not None and dec.status_code == 200:
            r.check(f"{kind}: DECIDED", jget(dec.json(), "case", "status") == "DECIDED", jget(dec.json(), "case", "status"))
        pdf_r = r.call("GET", f"{LEGAL}/applications/{app}/report", f"{kind}: report pdf", fatal=False)
        if pdf_r is not None and pdf_r.status_code == 200:
            r.check(f"{kind}: report is a PDF", pdf_r.content[:4] == b"%PDF", pdf_r.headers.get("content-type"))
        # DB
        case = r.q("SELECT case_id, status, decision FROM legal_verification.legal_verification_cases WHERE application_id=%s",
                   (app,))
        r.check(f"DB {kind}: case row DECIDED/{want}", bool(case) and case[-1][1] == "DECIDED" and case[-1][2] == want, case)
        if case:
            cids = [c[0] for c in case]
            dbruns = r.q("SELECT recommendation, rule_set_hash, rules FROM legal_verification.legal_verification_runs "
                         "WHERE case_id = ANY(%s) ORDER BY run_at", (cids,))
            r.check(f"DB {kind}: runs stored with rule_set_hash and the API recommendation",
                    bool(dbruns) and all(x[1] for x in dbruns) and dbruns[-1][0] == rec,
                    [(x[0], bool(x[1])) for x in dbruns])
            docs = r.q("SELECT kind FROM legal_verification.legal_verification_documents WHERE case_id = ANY(%s)", (cids,))
            r.check(f"DB {kind}: documents (SALE_DEED + AGENCY_REPORT)",
                    {"SALE_DEED", "AGENCY_REPORT"} <= {d[0] for d in docs}, docs)
            ar = r.q1("SELECT count(*) FROM legal_verification.legal_verification_agency_reports WHERE case_id = ANY(%s)", (cids,))
            r.check(f"DB {kind}: agency report row", ar >= 1, ar)
        n_audit = r.q1("SELECT count(*) FROM legal_verification.legal_verification_audit WHERE application_id=%s", (app,))
        r.check(f"DB {kind}: audit events", n_audit >= 4, f"{n_audit} events")
    if len(runs) == 2:
        r.check("recommendation changes with the agency's findings", runs["OK"]["rec"] != runs["BAD"]["rec"],
                {k: v["rec"] for k, v in runs.items()})
    apps = [x[0] for x in r.q("SELECT application_id FROM legal_verification.legal_verification_applications WHERE "
                              "application_id LIKE %s", (f"E2E-LGV-{r.tag}-%",))]
    for tbl in ("legal_verification_audit", "legal_verification_applications", "legal_verification_cases"):
        n = r.q1(f"SELECT count(*) FROM legal_verification.{tbl} WHERE application_id = ANY(%s)", (apps,))
        r.leave("legal_verification", tbl, n, "append-only audit (and the cascade into it) refuses DELETE")
    n = r.q1("SELECT count(*) FROM legal_verification.legal_verification_documents d JOIN "
             "legal_verification.legal_verification_cases c USING (case_id) WHERE c.application_id = ANY(%s)", (apps,))
    r.leave("legal_verification", "legal_verification_documents (+ runs, summaries, agency_reports; files on disk)", n,
            "children of the pinned cases")


def itr_pdf(name: str, pan: str, ay: str, gti: int, total: int, ack: str) -> bytes:
    return make_pdf(["INDIAN INCOME TAX RETURN ACKNOWLEDGEMENT (synthetic E2E document)",
                     f"Name: {name}", f"PAN: {pan}", "Status: Individual", "Form Number: ITR-1",
                     f"Assessment Year: {ay}", f"Acknowledgement Number: {ack}",
                     f"Gross Total Income: {gti:,}", f"Total Income: {total:,}",
                     "Date of filing: 15-07-2025"])


def flow_itr_verification(r: Run) -> None:
    r.call("GET", f"{ITR}/health", "health")
    rules = r.call("GET", f"{ITR}/rules", "rule configs").json()
    r.rules(*(f"{x.get('category')}:{x.get('field')}" for x in rules if x.get("enabled")))
    base = dict(name="Esha Tiwari", pan="ZZQPT1234E", ay="2025-26", gti=1250000, total=1180000, ack="123456789012345")
    pairs = {
        "matching input / output ITR": (itr_pdf(**base), itr_pdf(**base), "ACCEPT"),
        "vendor ITR with another PAN and income": (itr_pdf(**base), itr_pdf(**{**base, "pan": "ZZQPX9999Z", "gti": 450000,
                                                                              "total": 400000, "name": "Rohit Verma",
                                                                              "ack": "998877665544332"}), "REJECT"),
    }
    out = {}
    for label, (a, b, want) in pairs.items():
        resp = r.call("POST", f"{ITR}/verify", label, fatal=False,
                      files={"input_doc": (f"E2E-{r.tag}-input.pdf", a, "application/pdf"),
                             "output_doc": (f"E2E-{r.tag}-output.pdf", b, "application/pdf")})
        if resp is None or resp.status_code != 200:
            continue
        j = resp.json()
        out[label] = j
        r.check(f"{label}: decision {want}", j.get("decision") == want,
                f"decision={j.get('decision')} score={j.get('overall_score')} critical={j.get('critical_failures')}")
        r.check(f"{label}: field results present", len(j.get("field_results") or []) >= 5, len(j.get("field_results") or []))
        r.check(f"{label}: stored (run_id returned)", bool(j.get("run_id")),
                j.get("run_id") or "no run_id: the verification was NOT stored (best-effort insert failed silently)")
    if len(out) == 2:
        d = [v.get("decision") for v in out.values()]
        r.check("decision changes with the documents", d[0] != d[1], d)
    rows = r.q(f"SELECT run_id, decision, overall_score FROM {r.t('verification_results')} WHERE input_doc_id LIKE %s "
               "ORDER BY created_at", (f"E2E-{r.tag}-%",))
    r.check("DB itr_verification.verification_results: one row per run, decision as returned",
            len(rows) == len(out) and [x[1] for x in rows] == [v.get("decision") for v in out.values()],
            [(x[0], x[1]) for x in rows])
    for run_id, _d, _s in rows:
        r.call("GET", f"{ITR}/results/{run_id}", "stored run read back", fatal=False)
    r.own(r.schema(), "verification_results", "run_id", [x[0] for x in rows])


def flow_fraud_screening(r: Run) -> None:
    rules = r.call("GET", f"{FRAUD}/rules", "rule configuration", fatal=False)
    if rules is not None and rules.status_code == 200:
        enabled = [x.get("rule_key") for x in rules.json() if x.get("enabled")]
        r.check("rule configuration lists enabled rules", len(enabled) >= 5, enabled)
    if not r.table_exists(r.schema(), "fraud_results"):
        r.check(f"DB {r.schema()}.fraud_results exists", False,
                f"schema {r.schema()} has no fraud_results table: the agent's migrations were not applied there")
    # the agent reads an LOS application (no write API): the LOS seed applications. A CLEAN outcome needs a valid PAN;
    # said below when the seed data has none.
    valid = r.q1("SELECT count(*) FROM public.primary_applicant_kyc WHERE pan_number ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'")
    apps = [x[0] for x in r.q("SELECT la.application_number FROM public.loan_applications la JOIN public.primary_applicant_kyc k "
                              "USING (application_id) ORDER BY (k.pan_number ~ '^[A-Z]{5}[0-9]{4}[A-Z]$') DESC, "
                              "la.application_id LIMIT 3")]
    seen: dict[str, dict] = {}
    for num in apps:
        resp = r.call("POST", f"{FRAUD}/fraud/evaluate", f"evaluate {num}", fatal=False,
                      json={"application_number": num, "run_aml": True, "run_pep": True})
        if resp is None or resp.status_code != 200:
            break                                           # the same failure for every application
        j = resp.json()
        seen[num] = j
        results = [x for x in j.get("rule_results") or [] if isinstance(x, dict)]
        r.rules(*(x.get("rule_key") or x.get("rule_id") for x in results))
        r.check(f"{num}: risk level, rule results and result_id", bool(j.get("risk_level")) and len(results) >= 5
                and bool(j.get("result_id")), f"risk={j.get('risk_level')} flagged={j.get('flagged_rules')} "
                                               f"result_id={j.get('result_id')} aml={jget(j, 'aml', 'status')}")
        g = r.call("GET", f"{FRAUD}/fraud/results/{num}", f"{num}: latest stored result", fatal=False)
        if g is not None and g.status_code == 200:
            r.check(f"{num}: stored result == evaluation", g.json().get("result_id") == j.get("result_id")
                    or g.json().get("risk_level") == j.get("risk_level"), short(g.json(), 120))
    if seen:
        flagged = {n: v.get("flagged_rules") for n, v in seen.items()}
        r.check("flagged outcome: a malformed seed PAN triggers Rule1 (format) and raises the risk",
                any("Rule1_PAN_Aadhaar_Mismatch" in (v or []) for v in flagged.values()), flagged)
        if not valid:
            r.info("CLEAN outcome not testable: no LOS seed application has a valid-format PAN (0 of "
                   f"{r.q1('SELECT count(*) FROM public.primary_applicant_kyc')}), so Rule1 flags every one")
        else:
            r.check("a clean application (valid PAN) evaluates with no flagged rule",
                    any(not v.get("flagged_rules") for v in seen.values()), flagged)
        ids = [v.get("result_id") for v in seen.values()]
        if r.table_exists(r.schema(), "fraud_results"):
            rows = r.q(f"SELECT result_id, risk_level FROM {r.t('fraud_results')} WHERE result_id = ANY(%s)", (ids,))
            r.check(f"DB {r.schema()}.fraud_results rows as returned", len(rows) == len(seen)
                    and sorted(x[1] for x in rows) == sorted(v.get("risk_level") for v in seen.values()), rows)
            r.own(r.schema(), "fraud_results", "result_id", ids)


def flow_residence_office_verification(r: Run) -> None:
    pick = r.q("""SELECT p.application_id, p.participant_id FROM public.application_participants p
                  JOIN public.applicant_addresses a USING (participant_id)
                  WHERE lower(a.address_type) IN ('residence','residential','current residence','permanent residence',
                        'residential address','current','permanent','office')
                  GROUP BY 1, 2 HAVING count(*) = 1 ORDER BY 1, 2 LIMIT 1""")
    if not r.check("an LOS seed participant with exactly one accepted address", bool(pick), fatal=True):
        return
    app_id, part_id = pick[0]
    r.info(f"residence verification on LOS seed application {app_id}, participant {part_id}")
    r.call("GET", f"{ROV}/rule-configs", "rule settings", params={"verification_type": "RESIDENCE"})
    clean = {"status": "Positive", "final_status": "Approved", "neighbour_check": "Yes", "address_confirmed": "Yes",
             "corrected_address": None, "negative_area": "No", "political_link": "No", "name_plate_visible": "Yes",
             "community_dominated": "No"}
    bad = {"status": "Negative", "final_status": "Rejected", "neighbour_check": "No", "address_confirmed": "No",
           "corrected_address": "House 99, Another Street, Other City 999999", "negative_area": "Yes",
           "political_link": "Yes", "name_plate_visible": "No", "community_dominated": "No"}
    out, ids = {}, []
    for label, vr, want in (("clean vendor report", clean, "PASS"), ("negative vendor report", bad, "REFER")):
        resp = r.call("POST", f"{ROV}/residence-verification", label, fatal=False,
                      json={"application_id": app_id, "participant_id": part_id, "verification_type": "RESIDENCE",
                            "vendor_name": f"E2E-{r.tag} synthetic vendor", "vendor_response": vr})
        if resp is None or resp.status_code != 200:
            continue
        j = resp.json()
        out[label] = j
        ids.append(j.get("result_id"))
        rules = {x.get("rule_id") or x.get("rule_key"): x.get("status") for x in j.get("rules") or []}
        r.rules(*rules)
        r.check(f"{label}: recommendation {want}", j.get("overall_recommendation") == want,
                f"rec={j.get('overall_recommendation')} triggered={j.get('rules_triggered')} rules={rules}")
        r.check(f"{label}: result_id returned", bool(j.get("result_id")), j.get("result_id"))
    if len(out) == 2:
        a, b = out.values()
        r.check("triggered rules change with the vendor answer", (a.get("rules_triggered") or 0) < (b.get("rules_triggered") or 0),
                f"{a.get('rules_triggered')} -> {b.get('rules_triggered')}")
    rows = r.q(f"SELECT id, overall_recommendation FROM {r.t('residence_rule_results')} "
               "WHERE id = ANY(%s)", ([i for i in ids if i is not None],))
    r.check("DB residence_rule_results rows with the API recommendation",
            len(rows) == len(ids) and sorted(x[1] for x in rows) == sorted(v.get("overall_recommendation") for v in out.values()),
            rows)
    r.own(r.schema(), "residence_rule_results", "id", ids)


def flow_property_valuation(r: Run) -> None:
    num = r.q1("SELECT la.application_number FROM public.loan_applications la JOIN public.collateral_properties cp "
               "USING (application_id) ORDER BY la.application_id LIMIT 1")
    if not r.check("an LOS seed application with a collateral property", bool(num), fatal=True):
        return
    r.info(f"property valuation on LOS seed application {num}")
    rules = r.call("GET", f"{PV}/rules", "rule configuration").json()
    enabled = [x["rule_key"] for x in rules if x.get("enabled")]
    view = r.call("GET", f"{PV}/applications/{num}", "application + properties").json()
    prop = (view.get("properties") or [None])[0]
    r.check("property with a vendor request prefill", bool(prop and prop.get("vendor_request_prefill")), fatal=True)
    pid = prop["collateral_property_id"]
    pre = prop["vendor_request_prefill"]
    owner = " ".join(x for x in (prop.get("owner_first_name"), prop.get("owner_middle_name"), prop.get("owner_last_name")) if x)
    addr = pre.get("Complete Property Address")
    clean = {"Current Property Owner": owner or prop.get("property_owner"), "Address As Per Sale Deed": addr,
             "Inspection Address": addr, "House No/Flat": prop.get("house_flat_number"), "Sanction Plan Provided": "Yes",
             "Building As Per Sanction Plan": "Yes", "Property Usage": prop.get("collateral_usage") or "Residential",
             "Property Nature As Per Documents": prop.get("property_categorization") or "Residential",
             "Property Occupancy": "Self Occupied", "Number Of Tenants": 0, "Condition Of Property": "Good",
             "Residual Age": 40, "Land Area as per Deed": 1000, "Built up Area": 800, "Carpet Area": 700,
             "Carpet Area Unit": "sq.ft", "Area Adopted For Valuation": 800, "Land Rate": 1500,
             "Avg construction rate per sq ft": 1200, "Govt. Approved rate(₹)": 1000, "Current Market Value": 2460000,
             "Value to be Considered": 2460000, "Valuation Date": "22/10/2026", "Investment/Self used": "Self used and tenants",
             "Remarks": f"E2E-{r.tag} synthetic clean report", "Property Type": prop.get("property_type"),
             "Final Status": "Positive"}
    bad = {**clean, "Current Property Owner": "Unrelated Person Kumar", "Address As Per Sale Deed": "Plot 1, Nowhere Road, Elsewhere 000000",
           "Inspection Address": "Plot 1, Nowhere Road, Elsewhere 000000", "House No/Flat": "Z-999",
           "Current Market Value": 2460000, "Value to be Considered": 9900000, "Built up Area": 0,
           "Area Adopted For Valuation": 5000, "Remarks": "", "Final Status": "Negative"}
    out = {}
    for label, vr in (("clean vendor report", clean), ("contradicting vendor report", bad)):
        resp = r.call("POST", f"{PV}/applications/{num}/properties/{pid}/valuation", label, fatal=False,
                      json={"collateral_property_id": pid, "vendor_name": f"E2E-{r.tag} synthetic vendor",
                            "verification_type": "INITIAL_VISIT", "submitted_data": pre, "vendor_response": vr})
        if resp is None or resp.status_code != 200:
            continue
        j = resp.json()
        out[label] = j
        rl = find_dicts(j.get("evaluation"), "rule_key") or find_dicts(j.get("evaluation"), "rule_id")
        trig = sorted({str(x.get("rule_key") or x.get("rule_id")) for x in rl if x.get("triggered")})
        r.rules(*sorted({str(x.get("rule_key") or x.get("rule_id")) for x in rl}))
        summ = j.get("summary") or {}
        r.check(f"{label}: ids + summary returned", bool(j.get("verification_id") and j.get("result_id")),
                f"verification_id={j.get('verification_id')} result_id={j.get('result_id')} agent_status={summ.get('agent_status')}"
                f" checked={summ.get('total_rules_checked')} triggered={summ.get('total_rules_triggered')} rules={trig}")
        r.check(f"{label}: every enabled rule evaluated", (summ.get("total_rules_checked") or 0) == len(enabled),
                f"checked={summ.get('total_rules_checked')} enabled={len(enabled)}")
    if len(out) == 2:
        a, b = (v.get("summary") or {} for v in out.values())
        r.check("triggered rules + agent status change with the vendor report",
                (a.get("total_rules_triggered") or 0) < (b.get("total_rules_triggered") or 0)
                and a.get("agent_status") != b.get("agent_status"),
                f"{a.get('total_rules_triggered')}/{a.get('agent_status')} -> {b.get('total_rules_triggered')}/{b.get('agent_status')}")
    r.call("GET", f"{PV}/applications/{num}/history", "history", fatal=False, params={"collateral_property_id": pid})
    r.call("GET", f"{PV}/results/{num}", "stored results", fatal=False)
    vids = [v.get("verification_id") for v in out.values()]
    rids = [v.get("result_id") for v in out.values()]
    rows = r.q(f"SELECT result_id, agent_status, total_rules_triggered FROM {r.t('property_valuation_agent_results')} "
               "WHERE result_id = ANY(%s)", ([x for x in rids if x is not None],))
    r.check("DB agent_results rows as returned", len(rows) == len(out)
            and sorted(x[2] for x in rows) == sorted((v.get("summary") or {}).get("total_rules_triggered") for v in out.values()),
            rows)
    nv = r.q1(f"SELECT count(*) FROM {r.t('property_valuation_verifications')} WHERE verification_id = ANY(%s)",
              ([x for x in vids if x is not None],))
    r.check("DB verifications rows (vendor visits)", nv == len(out), nv)
    r.own(r.schema(), "property_valuation_agent_results", "result_id", rids)
    r.own(r.schema(), "property_valuation_verifications", "verification_id", vids)


def flow_collateral_verification(r: Run) -> None:
    r.call("GET", f"{COLL}/health", "health")
    cfg = r.call("GET", f"{COLL}/rules", "rules").json()
    r.rules(*(x.get("rule_id") for x in cfg if x.get("enabled")))
    # a JOINT property with two participants: the matching report names both owners
    row = r.q("""SELECT la.application_number, cp.owner_first_name, cp.owner_middle_name, cp.owner_last_name,
                        cp.property_owner, cp.pincode, cp.city, cp.state, cp.house_flat_number
                 FROM public.loan_applications la JOIN public.collateral_properties cp USING (application_id)
                 WHERE cp.pincode IS NOT NULL AND cp.city IS NOT NULL AND cp.property_ownership ILIKE 'joint%%'
                   AND (SELECT count(*) FROM public.application_participants ap
                        WHERE ap.application_id = la.application_id) >= 2
                 ORDER BY la.application_id LIMIT 1""")
    if not r.check("an LOS seed application with a joint collateral property and two participants", bool(row),
                   fatal=True):
        return
    num, f, m, l, owner, pin, city, state, unit = row[0]
    owner_name = " ".join(x for x in (f, m, l) if x) or owner
    people = [x[0] for x in r.q("""SELECT c.full_name FROM public.application_participants ap
                                   JOIN public.loan_applications la USING (application_id)
                                   LEFT JOIN public.customers c ON c.customer_id = ap.customer_id
                                   WHERE la.application_number = %s AND c.full_name IS NOT NULL
                                   ORDER BY ap.is_primary DESC, ap.participant_id""", (num,))]
    co_owner = next((p for p in people if p.lower() != owner_name.lower()), people[0] if people else "Co Owner")
    r.info(f"collateral verification on LOS seed application {num}")
    nl = chr(10)

    def report(owners: list[str], pin_v: str, city_v: str, unit_v: str, charge: str) -> bytes:
        names = nl.join(f"{p}, ZZQPC{1000 + i}Q" for i, p in enumerate(people)) or "NA"
        text = [f"Case number: E2E-{r.tag}", f"Applicant names: {names}", f"Owner/Transferor Names: {', '.join(owners)}",
                f"Property Address: {unit_v}, synthetic address", f"District/State: {city_v}, {state}",
                "Debtor Based Search", "Results : 1 record found", "Borrower name:", ", ".join(owners),
                "Charge details", f"City/Town/Village: {city_v}", f"State/UT: {state}", f"Pin Code: {pin_v}",
                f"House/Flat Number/Unit No: {unit_v}", "Security Interest ID: SI-E2E",
                f"Satisfaction Status: {charge}", "Holder details"]
        return (nl.join(text) + nl).encode()

    cases = {"matching report": report([owner_name, co_owner], pin, city, unit, "Satisfied"),
             "contradicting report": report(["Unrelated Person Kumar"], "999999", "Nowhere", "Z-999", "Not Satisfied")}
    out = {}
    for label, data in cases.items():
        resp = r.call("POST", f"{COLL}/collateral/verify", label, fatal=False,
                      data={"final_status": "approved", "application_number": num},
                      files={"report": (f"E2E-{r.tag}-{label.split()[0]}.txt", data, "text/plain")})
        if resp is None or resp.status_code != 200:
            continue
        j = resp.json()
        out[label] = j
        res = {x.get("rule_id"): x.get("status") for x in j.get("comparison_results") or []}
        r.rules(*res)
        r.check(f"{label}: comparison results + overall + run_id", bool(res) and bool(jget(j, "summary", "overall"))
                and bool(j.get("run_id")), f"overall={jget(j, 'summary', 'overall')} run_id={j.get('run_id')} rules={res}")
    if len(out) == 2:
        a, b = out.values()
        ra = {x.get("rule_id"): x.get("status") for x in a.get("comparison_results") or []}
        rb = {x.get("rule_id"): x.get("status") for x in b.get("comparison_results") or []}
        for rule in ("rule_1_owner_name", "rule_2_ownership", "rule_13_location", "rule_14_unit_number"):
            if rule in ra:
                r.check(f"{rule}: matching PASS, contradicting not PASS", ra.get(rule) == "PASS" and rb.get(rule) != "PASS",
                        f"{ra.get(rule)} -> {rb.get(rule)}")
        r.check("overall: matching not REFER, contradicting REFER",
                jget(a, "summary", "overall") != "REFER" and jget(b, "summary", "overall") == "REFER",
                f"{jget(a, 'summary', 'overall')} -> {jget(b, 'summary', 'overall')}")
    run_ids = [v.get("run_id") for v in out.values() if v.get("run_id")]
    rows = r.q(f"SELECT run_id, overall FROM {r.t('collateral_verification_results')} WHERE run_id = ANY(%s)", (run_ids,))
    r.check("DB collateral_verification_results rows with the API overall", len(rows) == len(out)
            and sorted(str(x[1]) for x in rows) == sorted(str(jget(v, "summary", "overall")) for v in out.values()), rows)
    r.call("GET", f"{COLL}/results", "stored runs", fatal=False, params={"application_number": num})
    r.own(r.schema(), "collateral_verification_results", "run_id", run_ids)


FLOWS: dict[str, Callable[[Run], None]] = {
    "eligibility": flow_eligibility, "dedupe": flow_dedupe, "docs_policy": flow_docs_policy,
    "bank_verification": flow_bank_verification, "crime_verification": flow_crime_verification,
    "legal_verification": flow_legal_verification, "itr_verification": flow_itr_verification,
    "fraud_screening": flow_fraud_screening, "residence_office_verification": flow_residence_office_verification,
    "property_valuation": flow_property_valuation, "collateral_verification": flow_collateral_verification,
}


# ============================================================================================================ cleanup
def cleanup(r: Run) -> dict[str, Any]:
    """Delete ONLY what this run recorded as its own, in registration order (child tables first), each in its own
    transaction; a refused delete (append-only trigger, FK) is rolled back and reported, never forced."""
    report: dict[str, Any] = {"deleted": [], "refused": [], "left": []}
    with psycopg.connect(r.dsn) as conn:
        for agent, schema, table, column, values in r.cleanup_plan:
            if schema not in AGENT_SCHEMAS.get(agent, []):           # only the agent's own schema
                report["refused"].append(f"{schema}.{table}: not {agent}'s schema, skipped")
                continue
            try:
                with conn.transaction():
                    cur = conn.execute(f'DELETE FROM "{schema}"."{table}" WHERE "{column}" = ANY(%s)', (values,))
                    report["deleted"].append(f"{schema}.{table}: {cur.rowcount} row(s) [{agent}]")
            except psycopg.Error as exc:
                report["refused"].append(f"{schema}.{table}: {type(exc).__name__}: {str(exc).splitlines()[0]} [{agent}]")
    for agent, schema, table, n, why in r.left:
        report["left"].append(f"{schema}.{table}: {n} row(s) left -- {why} [{agent}]")
    return report


# =============================================================================================================== main
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--base-url", required=True)
    ap.add_argument("--only", default="", help="comma-separated agents: " + ",".join(AGENTS))
    ap.add_argument("--timeout", type=float, default=120.0)
    ap.add_argument("--no-cleanup", action="store_true", help="keep the rows this run wrote")
    args = ap.parse_args()

    load_dotenv(BACKEND / ".env")
    dsn = os.environ.get("LOS_AGENTIC_DSN", "").strip()
    if not dsn:
        print("FAIL  LOS_AGENTIC_DSN is not set in backend/.env (the value is never printed)")
        return 1
    chosen = [a.strip() for a in args.only.split(",") if a.strip()] or AGENTS
    unknown = [a for a in chosen if a not in FLOWS]
    if unknown:
        print(f"unknown agent(s): {unknown}; choose from {AGENTS}")
        return 2

    configured = load_schemas()
    for agent in AGENTS:
        schema = configured.get(CONFIG_KEY[agent])
        if schema and schema != AGENT_SCHEMAS[agent][0]:
            print(f"INFO  {agent}: schema from config is {schema} (default {AGENT_SCHEMAS[agent][0]})")
            AGENT_SCHEMAS[agent] = [schema]
    r = Run(args.base_url, args.timeout, dsn)
    print(f"E2E live check against {r.base} -- run tag {r.tag}; agents: {', '.join(chosen)}", flush=True)
    try:
        h = r.http.get("/health")
        print(f"INFO  service /health -> HTTP {h.status_code}", flush=True)
    except httpx.HTTPError as exc:
        print(f"FAIL  service unreachable: {exc}")
        return 1

    for agent in chosen:
        r.agent = agent
        schemas = AGENT_SCHEMAS[agent]
        before = r.counts(schemas + SHARED_SCHEMAS)
        print(f"----- {agent} (schema {', '.join(schemas)})", flush=True)
        try:
            FLOWS[agent](r)
        except StepFailed as exc:
            r.info(f"flow stopped after the failed step '{exc}'")
        except Exception as exc:  # noqa: BLE001 - a script error is a FAIL of this agent, the run goes on
            r.check("flow ran without a script error", False, f"{type(exc).__name__}: {exc} @ "
                    f"{traceback.extract_tb(exc.__traceback__)[-1].lineno}")
        after = r.counts(schemas + SHARED_SCHEMAS)
        diff = {k: after.get(k, 0) - before.get(k, 0) for k in sorted(set(before) | set(after))
                if after.get(k, 0) != before.get(k, 0)}
        res = r._res()
        res["db_rows_written"] = {k: v for k, v in diff.items() if k.split(".")[0] in schemas}
        shared = {k: v for k, v in diff.items() if k.split(".")[0] not in schemas}
        if shared:
            res["shared_rows_written"] = shared
        r.check(f"rows written to the agent's schema ({', '.join(schemas)})", sum(res["db_rows_written"].values()) > 0,
                res["db_rows_written"] or "none")

    if args.no_cleanup:
        clean = {"skipped": True, "plan": [f"{s}.{t}: {len(v)} id(s)" for _a, s, t, _c, v in r.cleanup_plan]}
    else:
        print("----- cleanup (only rows this run created)", flush=True)
        clean = cleanup(r)
        for k in ("deleted", "refused", "left"):
            for line in clean.get(k, []):
                print(f"{k.upper():8s}{line}", flush=True)

    summary = {a: {k: v for k, v in r.results.get(a, {}).items() if k != "notes" or v} for a in chosen}
    print("===== SUMMARY")
    print(json.dumps({"base_url": r.base, "run_tag": r.tag, "agents": summary, "cleanup": clean}, indent=2, default=str))
    total_f = sum(v.get("failed", 0) for v in r.results.values())
    total_p = sum(v.get("passed", 0) for v in r.results.values())
    print(f"===== {total_p} passed, {total_f} failed")
    return 1 if r.failed_any else 0


if __name__ == "__main__":
    sys.exit(main())
