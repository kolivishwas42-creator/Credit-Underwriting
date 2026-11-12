"""
EVERY AGENT'S OWN DATABASE, END TO END (shared/db, scripts/setup_agent_databases.py) on a REAL PostgreSQL server:
five fresh databases (eligibility, docs policy, bank, crime, chatbot) built exactly as production builds them.

    migrate + seed demo -> typed tables, demo rows marked is_demo
    real rows next to them -> a second demo seed is refused; --purge-demo removes ONLY the demo rows (and their files)
    --check reports every database up to date; a changed released migration is an error; the old untyped bank schema
    is refused; WARNING+ logs land in agent_logs masked; the chatbot's rows are written in the background
"""

from __future__ import annotations

import json
import logging
import uuid

import psycopg
import pytest

AGENTS = ("eligibility", "docs_policy", "bank_verification", "crime_verification", "legal_verification", "chatbot",
          "audit",
          # the five agents added 2026-11-02 (agents/<agent>/db/schema.py MIGRATIONS)
          "itr_verification", "fraud_screening", "residence_office_verification", "property_valuation",
          "collateral_verification")
#: the five added 2026-11-02 keep their rules in their own tables (not yet the versioned rule store) and have no demo
#: seed: the rule-store and demo-seed checks below are about the agents that have them
LAYERED = {"itr_verification", "fraud_screening", "residence_office_verification", "property_valuation",
           "collateral_verification"}
ENV = {"eligibility": "ELIGIBILITY_DSN", "docs_policy": "DOCS_POLICY_DSN", "bank_verification": "BANK_VERIFICATION_DSN",
       "crime_verification": "CRIME_VERIFICATION_DSN", "legal_verification": "LEGAL_VERIFICATION_DSN",
       "chatbot": "CHATBOT_DSN", "audit": "LOS_AUDIT_DSN",
       "itr_verification": "ITR_VERIFICATION_DSN", "fraud_screening": "FRAUD_SCREENING_DSN",
       "residence_office_verification": "RESIDENCE_OFFICE_VERIFICATION_DSN",
       "property_valuation": "PROPERTY_VALUATION_DSN", "collateral_verification": "COLLATERAL_VERIFICATION_DSN"}


@pytest.fixture()
def servers(tmp_path, monkeypatch):
    """Empty databases on the test server, each agent's DSN pointing at its own."""
    from shared.store.testing import _admin_dsn, _with_db

    admin = _admin_dsn()
    names = {a: f"agdb_{a[:5]}_{uuid.uuid4().hex[:8]}" for a in AGENTS}
    with psycopg.connect(admin, autocommit=True) as conn:
        for name in names.values():
            conn.execute(f'CREATE DATABASE "{name}"')
    dsns = {a: _with_db(admin, n) for a, n in names.items()}
    for agent, value in dsns.items():
        monkeypatch.setenv(ENV[agent], value)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("AGENT_DB_ADMIN_DSN", raising=False)
    monkeypatch.setenv("ENVIRONMENT", "test")              # never inherited from another test module
    # tests never call the local model: the demo activity's AI summaries see it "down" unless a test answers for it
    from agents.bank_verification.services import summary_service as bank_summary
    from agents.crime_verification.services import summary_service as crime_summary

    def model_down(shown):
        raise ConnectionError("the local model is not running in tests")

    from agents.legal_verification.services import summary as legal_summary

    monkeypatch.setattr(bank_summary, "ask", model_down)
    monkeypatch.setattr(crime_summary, "ask", model_down)
    monkeypatch.setattr(legal_summary, "ask", model_down)
    for key, value in {"BANK_VERIFICATION_HOME": str(tmp_path / "bank"), "BANK_VERIFICATION_AI_SUMMARY": "off",
                       "BANK_VERIFICATION_LOS": "off", "BANK_VERIFICATION_SCANS": "off",
                       "CRIME_VERIFICATION_REPORTS_DIR": str(tmp_path / "crime_reports"),
                       "LEGAL_VERIFICATION_DOCUMENTS_DIR": str(tmp_path / "legal_docs"),
                       "LEGAL_VERIFICATION_AI_SUMMARY": "off", "LEGAL_VERIFICATION_DEMO_START": "STAGED",
                       "LEGAL_VERIFICATION_DEMO_AGENCY_REPLY": "off"}.items():
        monkeypatch.setenv(key, value)
    yield dsns
    from shared.db import core, writer
    from agents.bank_verification.repository import close_pools
    from agents.eligibility.data import migrations

    from agents.eligibility.data import providers

    writer.close_all()
    core.forget()
    close_pools()
    providers.close_pools()
    migrations.forget()
    with psycopg.connect(admin, autocommit=True) as conn:
        for name in names.values():
            conn.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


def setup(*args: str) -> int:
    from scripts.setup_agent_databases import main

    return main(list(args))


def one(dsn: str, sql: str, *params):
    with psycopg.connect(dsn) as conn:
        return conn.execute(sql, params).fetchone()[0]


def column_types(dsn: str, table: str) -> dict[str, str]:
    with psycopg.connect(dsn) as conn:
        return {r[0]: r[1] for r in conn.execute(
            "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = %s", (table,))}


# ------------------------------------------------------------------------------------------------ the full journey
def test_migrate_seed_real_rows_purge_and_check(servers, capsys):
    assert setup("--seed-demo") == 0, capsys.readouterr().out
    out = capsys.readouterr().out
    for value in servers.values():
        assert value not in out                                     # never a DSN on screen
    # clean, typed columns
    bank = column_types(servers["bank_verification"], "cases")
    assert bank["loan_amount"] == "numeric" and bank["created_at"] == "timestamp with time zone"
    assert bank["historical"] == "boolean" and bank["is_demo"] == "boolean"
    assert column_types(servers["bank_verification"], "runs")["response"] == "jsonb"
    assert column_types(servers["chatbot"], "chat_turns_log")["frame"] == "jsonb"
    assert column_types(servers["docs_policy"], "docs_policy_evaluations")["evaluated_at"] == "timestamp with time zone"
    for agent, value in servers.items():
        assert one(value, "SELECT count(*) FROM information_schema.tables WHERE table_name = 'agent_logs'") == 1, agent
    # demo rows, marked
    assert one(servers["eligibility"], "SELECT count(*) FROM eligibility_cases WHERE is_demo") == 36
    assert one(servers["bank_verification"], "SELECT count(*) FROM cases WHERE is_demo") >= 12
    assert one(servers["bank_verification"], "SELECT count(*) FROM cases WHERE NOT is_demo") == 0
    assert one(servers["crime_verification"], "SELECT count(*) FROM crime_verification_applications WHERE is_demo") >= 12
    from agents.legal_verification.config import demo as legal_demo
    assert one(servers["legal_verification"], "SELECT count(*) FROM legal_verification_applications WHERE is_demo") ==         len(legal_demo()["applications"])
    assert one(servers["legal_verification"], "SELECT count(*) FROM legal_verification_agency_reports "
                                              "WHERE document_id IS NOT NULL") >= 1        # generated, attached

    # REAL rows next to the demo ones
    with psycopg.connect(servers["eligibility"]) as conn:
        conn.execute("INSERT INTO eligibility_cases (case_id, applicant_id, product) VALUES "
                     "('CASE-AAAAAAAAAAAA', 'APP-AAAAAAAAAAAA', 'HOME_LOAN')")
    from agents.bank_verification.repository import Repository

    Repository().put_case({"case_id": "BV-REAL-0001", "application_ref": "LOS-1", "applicant_name": "A Person",
                           "loan_amount": "2500000", "product": "HOME_LOAN", "stage": "CREDIT", "mode": "AA_FAILURE",
                           "status": "NEW"})
    with psycopg.connect(servers["crime_verification"]) as conn:
        conn.execute("INSERT INTO crime_verification_applications (application_id, title, branch, product, loan_amount, "
                     "stage, status) VALUES ('APP-REAL-1', 'Home loan', 'MUM', 'Home Loan', 100, 'Credit', 'Open')")
    with psycopg.connect(servers["legal_verification"]) as conn:
        conn.execute("INSERT INTO legal_verification_applications (application_id, branch, applicant_name, property_type, "
                     "property_address, is_demo) VALUES ('LGV-REAL-1', 'MUM', 'A Person', 'RESIDENTIAL_FLAT', "
                     "'Unit 1, Test Lane', false)")
    from agents.docs_policy.services import store_service

    def evaluation(case_id: str, n: str) -> dict:
        return {"stage": "CREDIT", "overall_status": "NOT_READY", "recommended_action": "REQUEST_DOCUMENTS",
                "agent_version": "t", "outcomes": [
                    {"rule_id": "RULE-01", "rule_name": "Mandatory", "check_id": "PAN", "status": "MISSING",
                     "severity": "BLOCKING", "reason": "PAN missing", "recommended_action": "REQUEST_DOCUMENTS",
                     "missing_documents": ["PAN"]},
                    {"rule_id": "RULE-02", "rule_name": "Read", "check_id": "ID", "status": "SATISFIED",
                     "severity": "BLOCKING", "reason": "ok", "recommended_action": "PROCEED"}],
                "audit": {"evaluation_id": f"EV{n}", "policy_id": "home_loan", "policy_version": "1",
                          "policy_status": "APPROVED", "policy_file_sha256": "0" * 64, "input_hash": f"H{n}",
                          "rules_evaluated": 10, "rules_disabled": [], "requirements_satisfied": 1,
                          "requirements_open": 1, "evaluated_at": "2026-10-28T10:00:00+00:00"}}

    assert store_service.save("CASE-REAL0000001", evaluation("CASE-REAL0000001", "1")) is True
    assert store_service.save("CASE-REAL0000001", evaluation("CASE-REAL0000001", "1")) is False    # idempotent
    assert store_service.save("DEMO-CASE-0001", evaluation("DEMO-CASE-0001", "2")) is True
    rows = one(servers["docs_policy"], "SELECT json_agg(json_build_object('o', is_open, 's', status) ORDER BY seq) "
                                       "FROM docs_policy_requirement_results WHERE evaluation_id = 'EV1'")
    assert rows == [{"o": True, "s": "MISSING"}, {"o": False, "s": "SATISFIED"}]
    from shared.db import writer
    from shared.applicant import chat_store

    chat_store.audit({"ts": "2026-10-28T10:00:00+00:00", "request_id": "r1", "subject": "officer", "case_id": "CASE-X",
                      "intent": "DOCS", "tools": ["docs"], "status": "OK"})
    chat_store.audit({"ts": "2026-10-28T10:00:01+00:00", "request_id": "r2", "subject": "officer",
                      "case_id": "DEMO-CASE-0001", "intent": "DOCS", "tools": [], "status": "OK"})
    chat_store.turn({"ts": 1761645600.0, "rid": "r1", "by": "abc", "chat": "def", "q": "pending docs?",
                     "frame": {"documents": ["PAN"]}, "layer": "L1", "intent": "DOCS", "label": "DOCS",
                     "outcome": "answered", "ms": 120})
    chat_store.feedback({"ts": 1761645601.0, "by": "abc", "rid": "r1", "rating": "up", "reason": None})
    writer.flush_all()
    assert one(servers["chatbot"], "SELECT count(*) FROM chat_audit WHERE NOT is_demo") == 1          # CASE-X
    assert one(servers["chatbot"], "SELECT count(*) FROM chat_audit WHERE is_demo AND case_id = 'DEMO-CASE-0001'") == 1
    assert one(servers["chatbot"], "SELECT frame->'documents'->>0 FROM chat_turns_log WHERE NOT is_demo") == "PAN"
    assert one(servers["chatbot"], "SELECT rating FROM chat_feedback WHERE NOT is_demo") == "up"

    # a second demo seed would reset the demo tables: refused where real rows live
    assert setup("--seed-demo", "--only", "eligibility,bank_verification") == 1
    assert "REFUSED" in capsys.readouterr().out
    assert one(servers["bank_verification"], "SELECT count(*) FROM cases WHERE case_id = 'BV-REAL-0001'") == 1

    # purge needs --yes; then ONLY the demo rows go
    assert setup("--purge-demo") == 2
    files_before = sum(1 for _ in (servers and __import__("pathlib").Path(
        __import__("os").environ["BANK_VERIFICATION_HOME"]) / "files").glob("*"))
    assert files_before > 0
    assert setup("--purge-demo", "--yes") == 0, capsys.readouterr().out
    assert one(servers["eligibility"], "SELECT count(*) FROM eligibility_cases") == 1
    assert one(servers["eligibility"], "SELECT case_id FROM eligibility_cases") == "CASE-AAAAAAAAAAAA"
    assert one(servers["bank_verification"], "SELECT count(*) FROM cases") == 1
    assert one(servers["bank_verification"], "SELECT count(*) FROM documents") == 0
    assert one(servers["bank_verification"], "SELECT count(*) FROM runs") == 0           # went with their cases
    files_after = sum(1 for _ in (__import__("pathlib").Path(__import__("os").environ["BANK_VERIFICATION_HOME"])
                                  / "files").glob("*"))
    assert files_after == 0
    assert one(servers["crime_verification"], "SELECT count(*) FROM crime_verification_applications") == 1
    assert one(servers["crime_verification"], "SELECT count(*) FROM crime_verification_parties") == 0
    assert one(servers["legal_verification"], "SELECT application_id FROM legal_verification_applications") == "LGV-REAL-1"
    assert one(servers["legal_verification"], "SELECT count(*) FROM legal_verification_applications") == 1
    assert one(servers["legal_verification"], "SELECT count(*) FROM legal_verification_documents") == 0
    assert not any(__import__("pathlib").Path(__import__("os").environ["LEGAL_VERIFICATION_DOCUMENTS_DIR"]).glob("*"))
    assert one(servers["docs_policy"], "SELECT count(*) FROM docs_policy_evaluations") == 1
    assert one(servers["docs_policy"], "SELECT count(*) FROM docs_policy_requirement_results") == 2
    assert one(servers["docs_policy"], "SELECT count(*) FROM audit_events") == 1
    assert one(servers["chatbot"], "SELECT count(*) FROM chat_audit") == 1
    capsys.readouterr()
    assert setup("--check") == 0
    out = capsys.readouterr().out
    assert out.count("(up to date)") == len(AGENTS) and "all good" in out


def test_a_missing_dsn_is_reported_never_guessed(servers, monkeypatch, capsys):
    monkeypatch.delenv("CHATBOT_DSN")
    monkeypatch.delenv("LOS_AGENTIC_DSN", raising=False)
    assert setup("--check") == 1
    assert "neither LOS_AGENTIC_DSN nor CHATBOT_DSN is set" in capsys.readouterr().out


def test_a_changed_released_migration_is_an_error(servers):
    from shared.db import AgentDbError, apply_migrations

    with psycopg.connect(servers["chatbot"]) as conn:
        assert apply_migrations(conn, "t", [("x-1", "one table", "CREATE TABLE t1 (a int)")]) == ["x-1"]
        assert apply_migrations(conn, "t", [("x-1", "one table", "CREATE TABLE t1 (a int)")]) == []
        with pytest.raises(AgentDbError, match="changed after it was applied"):
            apply_migrations(conn, "t", [("x-1", "one table", "CREATE TABLE t1 (a bigint)")])


def test_the_old_untyped_bank_tables_are_refused_not_converted(servers, capsys):
    with psycopg.connect(servers["bank_verification"]) as conn:
        conn.execute("CREATE TABLE cases (case_id TEXT PRIMARY KEY, loan_amount TEXT NOT NULL)")
    assert setup("--only", "bank_verification") == 1
    assert "OLD untyped tables" in capsys.readouterr().out
    from agents.bank_verification.repository import Repository, StoreConfigError

    with pytest.raises(StoreConfigError, match="old untyped"):
        Repository()


def test_warning_logs_land_in_the_agent_database_masked(servers):
    from shared.db import logs

    assert setup("--only", "eligibility") == 0
    handlers = logs.install()
    try:
        assert "eligibility" in handlers
        log = logging.getLogger("eligibility.engine")
        log.info("an info line stays on the console")
        log.warning("case CASE-1 failed for PAN ABCDE1234F, db postgresql://u:topsecret@h:5432/x")
        try:
            raise ValueError("token=abc123")
        except ValueError:
            log.exception("it broke")
        handlers["eligibility"].flush()
    finally:
        logs.uninstall()
    with psycopg.connect(servers["eligibility"]) as conn:
        rows = conn.execute("SELECT level, logger, message, exception FROM agent_logs ORDER BY log_id").fetchall()
    assert [r[0] for r in rows] == ["WARNING", "ERROR"]
    text = json.dumps(rows)
    assert "ABCDE1234F" not in text and "topsecret" not in text and "abc123" not in text
    assert "[PAN]" in rows[0][2] and rows[0][1] == "eligibility.engine"
    assert "ValueError" in rows[1][3]


def test_eligibility_runs_and_saved_entries_write_their_audit_rows(servers):
    from agents.eligibility.data import inputs_store, runs

    assert setup("--only", "eligibility", "--seed-demo") == 0
    run_id = runs.save({"case_id": "CASE-E11D00000001", "decision": "APPROVED", "eligible_amount": 500000, "emi": 13000,
                        "foir": {"value_pct": 40}, "product": "PERSONAL_LOAN", "config": {"version": "v1"}},
                       requested_by="officer.one")
    inputs_store.save("CASE-E11D00000001", {"requested_amount": 400000, "tenure_months": 36, "income": None},
                      saved_by="officer.one")
    with psycopg.connect(servers["eligibility"]) as conn:
        rows = conn.execute("SELECT event_type, actor, entity_id, outcome, details FROM audit_events "
                            "WHERE actor = 'officer.one' ORDER BY event_id").fetchall()
    assert rows[0][:4] == ("ELIGIBILITY_CHECKED", "officer.one", run_id, "APPROVED")
    assert rows[1][0] == "INPUTS_SAVED" and rows[1][4] == {"fields": ["requested_amount", "tenure_months"]}
    assert setup("--only", "eligibility", "--purge-demo", "--yes") == 0
    assert one(servers["eligibility"], "SELECT count(*) FROM eligibility_runs") == 0       # demo case's run went too
    assert one(servers["eligibility"], "SELECT count(*) FROM audit_events") == 0


def test_create_makes_the_databases_with_their_owner_and_prints_the_env_line(monkeypatch, capsys):
    from shared.db import core
    from shared.store.testing import _admin_dsn, _with_db

    admin = _admin_dsn()
    tag = uuid.uuid4().hex[:8]
    role = f"agdb_role_{tag}"
    names = {a: f"agdb_c_{a[:5]}_{tag}" for a in AGENTS}
    shared = f"agdb_c_shared_{tag}"                                  # los_agentic of this test
    monkeypatch.setitem(core.config(), "shared_database", shared)
    for agent, name in names.items():
        monkeypatch.setitem(core.config()["databases"][agent], "database", name)
        monkeypatch.delenv(ENV[agent], raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("LOS_AGENTIC_DSN", raising=False)
    monkeypatch.setenv("AGENT_DB_ADMIN_DSN", admin)
    with psycopg.connect(admin, autocommit=True) as conn:
        conn.execute(f'CREATE ROLE "{role}" LOGIN')
    try:
        # the agent's user does not exist -> said plainly, never created by the script (its password is not ours)
        from psycopg.conninfo import conninfo_to_dict, make_conninfo

        ghost = conninfo_to_dict(_with_db(admin, names["chatbot"]))
        ghost["user"] = f"ghost_{tag}"
        ghost.pop("password", None)
        monkeypatch.setenv("CHATBOT_DSN", make_conninfo(**ghost))
        rc = setup("--create", "--only", "eligibility,chatbot")
        out = capsys.readouterr().out
        # nothing set: the ONE shared database is created, the agent migrated into its own schema
        assert "add to .env:  LOS_AGENTIC_DSN=" in out and "schema eligibility" in out
        assert "migrations 7/7 (up to date)" in out and "search_path" not in out
        assert one(_with_db(admin, shared), "SELECT count(*) FROM information_schema.tables WHERE table_schema = "
                   "'eligibility' AND table_name = 'eligibility_runs'") == 1
        assert rc == 1 and f"the role ghost_{tag} does not exist yet" in out
        assert one(admin, "SELECT count(*) FROM pg_roles WHERE rolname = %s", f"ghost_{tag}") == 0
        # an agent user that exists becomes the database's owner
        parts = conninfo_to_dict(_with_db(admin, names["docs_policy"]))
        parts["user"] = role
        parts.pop("password", None)
        monkeypatch.setenv("DOCS_POLICY_DSN", make_conninfo(**parts))
        assert setup("--create", "--only", "docs_policy") == 0
        assert "owner " + role in capsys.readouterr().out
        assert one(admin, "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = %s",
                   names["docs_policy"]) == role
    finally:
        core.forget()
        with psycopg.connect(admin, autocommit=True) as conn:
            for name in [*names.values(), shared]:
                conn.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
            conn.execute(f'DROP ROLE IF EXISTS "{role}"')


def test_a_demo_seed_never_deletes_files_another_store_keeps_in_the_same_folder(servers, tmp_path):
    # 2026-10-28: a demo seed into a new database deleted the local store's uploaded files (one shared folder)
    import os
    from pathlib import Path

    files = Path(os.environ["BANK_VERIFICATION_HOME"]) / "files"
    files.mkdir(parents=True, exist_ok=True)
    theirs = files / "DOC-OTHERSTORE.pdf"
    theirs.write_bytes(b"%PDF- another store's upload")
    reports = Path(os.environ["CRIME_VERIFICATION_REPORTS_DIR"])
    reports.mkdir(parents=True, exist_ok=True)
    their_report = reports / "RPT-OTHERSTORE.pdf"
    their_report.write_bytes(b"%PDF- another store's report")
    assert setup("--seed-demo", "--only", "bank_verification,crime_verification") == 0
    assert setup("--seed-demo", "--only", "bank_verification,crime_verification") == 0      # a reset of its own
    assert theirs.read_bytes() == b"%PDF- another store's upload"
    assert their_report.read_bytes() == b"%PDF- another store's report"


# ------------------------------------------------------------------------------------------------ copy local data
def copy(*args: str) -> int:
    from scripts.copy_local_data_to_agent_databases import main

    return main(list(args))


def test_local_data_is_copied_once_demo_replaced_real_never_touched(servers, tmp_path, monkeypatch, capsys):
    import os
    import sqlite3
    from types import SimpleNamespace

    from shared.store.testing import _admin_dsn, _with_db

    # LOCAL sources: a SQLite bank store (processed demo cases), a crime DB, an eligibility DB, chat JSONL files
    local_home = tmp_path / "local_bank"
    target_bank = os.environ["BANK_VERIFICATION_DSN"]
    monkeypatch.setenv("BANK_VERIFICATION_HOME", str(local_home))
    monkeypatch.delenv("BANK_VERIFICATION_DSN")
    from agents.bank_verification.demo_data import seed as bank_seed
    from agents.bank_verification.repository import Repository

    local = Repository(local_home)
    bank_seed.reset(local, start_state=False)
    local_db = local_home / "bank_verification.sqlite3"
    local_runs = sqlite3.connect(local_db).execute("SELECT count(*) FROM runs").fetchone()[0]
    assert local.backend == "sqlite" and local_runs > 0
    monkeypatch.setenv("BANK_VERIFICATION_DSN", target_bank)
    monkeypatch.setenv("BANK_VERIFICATION_HOME", str(tmp_path / "target_bank"))

    admin = _admin_dsn()
    src = {k: f"agdb_src_{k}_{uuid.uuid4().hex[:8]}" for k in ("crime", "elig")}
    with psycopg.connect(admin, autocommit=True) as conn:
        for name in src.values():
            conn.execute(f'CREATE DATABASE "{name}"')
    crime_src, elig_src = _with_db(admin, src["crime"]), _with_db(admin, src["elig"])
    try:
        assert setup("--seed-demo") == 0                         # the new databases, with demo rows
        from agents.crime_verification.db import Database
        from agents.crime_verification.demo_data import seed as crime_seed
        from agents.eligibility.data import migrations as elig_migrations

        db = Database(crime_src, min_size=0, max_size=2)
        db.migrate()
        crime_seed.reset(db)
        with db.tx() as conn:                                  # a local-only application
            conn.execute("INSERT INTO crime_verification_applications (application_id, title, branch, product, "
                         "loan_amount, stage, status) VALUES ('APP-LOCAL-1', 'x', 'MUM', 'Home Loan', 1, 's', 'o')")
        db.close()
        elig_migrations.seed_demo(elig_src)
        with psycopg.connect(elig_src) as conn:
            conn.execute("INSERT INTO eligibility_runs (run_id, case_id, decision, result) VALUES "
                         "('er_local1', 'CASE-E11D00000001', 'APPROVED', '{}'::jsonb)")
        # a REAL row in the target sharing an id with a local one: never overwritten
        with psycopg.connect(servers["crime_verification"]) as conn:
            conn.execute("UPDATE crime_verification_applications SET is_demo = false, title = 'REAL' "
                         "WHERE application_id = 'APP-2026-001'")
        chat_dir = tmp_path / "chat"
        chat_dir.mkdir()
        (chat_dir / "audit.jsonl").write_text(json.dumps({"ts": "2026-10-28T09:00:00+00:00", "request_id": "q1",
                                                          "intent": "DOCS", "tools": [], "status": "OK"}) + "\n",
                                              encoding="utf-8")
        (chat_dir / "turn.jsonl").write_text(json.dumps({"ts": 1761642000.0, "rid": "q1", "q": "docs?", "frame": {},
                                                         "outcome": "answered"}) + "\n", encoding="utf-8")
        monkeypatch.setenv("APPLICANT_AGENT_AUDIT_PATH", str(chat_dir / "audit.jsonl"))
        from shared.observability import turn_log

        monkeypatch.setattr(turn_log, "_path", lambda key, default: chat_dir / {"path": "turn.jsonl"}.get(key, "none"))
        payload = {"stage": "CREDIT", "overall_status": "READY", "outcomes": [],
                   "audit": {"evaluation_id": "EVL1", "policy_id": "p", "policy_version": "1",
                             "policy_file_sha256": "0" * 64, "input_hash": "IH1", "rules_evaluated": 1,
                             "requirements_satisfied": 0, "requirements_open": 0,
                             "evaluated_at": "2026-10-28T09:00:00+00:00"}}
        fake = SimpleNamespace(_all=lambda sql, args: [{"case_id": "CASE-REAL0000002"}],
                               get_case_findings=lambda case_id, kind=None: [SimpleNamespace(payload=payload)])
        monkeypatch.setattr("shared.store.get_repository", lambda: fake)

        argv = ["--bank-sqlite", str(local_db), "--crime-source", crime_src, "--eligibility-source", elig_src,
                "--only", "eligibility,docs_policy,bank_verification,crime_verification,chatbot"]   # audit: own test
        before = one(servers["bank_verification"], "SELECT count(*) FROM runs")
        assert copy(*argv) == 0                                   # dry run: nothing written
        assert "DRY RUN" in capsys.readouterr().out
        assert one(servers["bank_verification"], "SELECT count(*) FROM runs") == before
        assert copy("--yes", *argv) == 0, capsys.readouterr().out
        tables = ("cases", "runs", "rule_results", "documents", "audit_events")
        counts = {t: one(servers["bank_verification"], f"SELECT count(*) FROM {t}") for t in tables}
        assert counts["runs"] == local_runs and counts["rule_results"] == local_runs * 8
        assert one(servers["crime_verification"], "SELECT title FROM crime_verification_applications "
                                                  "WHERE application_id = 'APP-2026-001'") == "REAL"
        assert one(servers["crime_verification"], "SELECT count(*) FROM crime_verification_applications "
                                                  "WHERE application_id = 'APP-LOCAL-1' AND NOT is_demo") == 1
        assert one(servers["eligibility"], "SELECT count(*) FROM eligibility_runs WHERE run_id = 'er_local1'") == 1
        assert one(servers["docs_policy"], "SELECT count(*) FROM docs_policy_evaluations") == 1
        assert one(servers["chatbot"], "SELECT count(*) FROM chat_audit WHERE NOT is_demo") == 1
        assert one(servers["chatbot"], "SELECT count(*) FROM chat_turns_log WHERE NOT is_demo") == 1
        out = capsys.readouterr().out
        for value in (*servers.values(), crime_src, elig_src):
            assert value not in out                                # never a DSN
        crime_audit = one(servers["crime_verification"], "SELECT count(*) FROM crime_verification_audit")
        # again: nothing twice
        assert copy("--yes", *argv) == 0
        assert {t: one(servers["bank_verification"], f"SELECT count(*) FROM {t}") for t in tables} == counts
        assert one(servers["chatbot"], "SELECT count(*) FROM chat_turns_log WHERE NOT is_demo") == 1
        assert one(servers["eligibility"], "SELECT count(*) FROM eligibility_runs WHERE run_id = 'er_local1'") == 1
        assert one(servers["crime_verification"], "SELECT count(*) FROM crime_verification_audit") == crime_audit
        # the sources are untouched
        assert one(crime_src, "SELECT count(*) FROM crime_verification_applications") == 13
        assert sqlite3.connect(local_db).execute("SELECT count(*) FROM runs").fetchone()[0] == local_runs
    finally:
        from agents.bank_verification.repository import close_pools

        close_pools()
        with psycopg.connect(admin, autocommit=True) as conn:
            for name in src.values():
                conn.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


# ------------------------------------------------------------------------------------------------ demo in every table
def _table_counts(dsn: str) -> dict[str, int]:
    with psycopg.connect(dsn) as conn:
        names = [r[0] for r in conn.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = "
                                            "current_schema() AND table_type = 'BASE TABLE'")]
        return {n: conn.execute(f'SELECT count(*) FROM "{n}"').fetchone()[0] for n in names}


def test_seed_demo_fills_every_table_and_purge_empties_them(servers, monkeypatch, capsys):
    from types import SimpleNamespace

    from agents.bank_verification.services import summary_service
    from agents.docs_policy.services import readiness_service

    monkeypatch.setattr(summary_service, "ask", lambda shown: "Some checks found problems.")   # the model, answered
    from agents.legal_verification.services import summary as legal_summary

    monkeypatch.setattr(legal_summary, "ask", lambda lines: list(lines))      # the model answers with the checked points

    # the LOS case store's demo cases, as the Document Desk would read them (nothing is written to the LOS store)
    monkeypatch.setattr("shared.store.get_repository",
                        lambda: SimpleNamespace(get_application=lambda case_id: object()))
    # a real policy file of the desk: its evaluation is stored with that policy in rule_sets
    from agents.docs_policy.config import policy_loader

    policy_file = policy_loader.load_in_force()[0]
    payload = {"stage": "CREDIT", "overall_status": "NOT_READY", "recommended_action": "REQUEST_DOCUMENTS",
               "outcomes": [{"rule_id": "RULE-01", "check_id": "PAN", "status": "MISSING", "severity": "BLOCKING",
                             "reason": "PAN missing", "recommended_action": "REQUEST_DOCUMENTS"}],
               "audit": {"policy_id": policy_file.policy.policy_id, "policy_version": str(policy_file.policy.version),
                         "policy_file_sha256": policy_file.sha256,
                         "rules_evaluated": 10, "requirements_satisfied": 0, "requirements_open": 1,
                         "evaluated_at": "2026-10-28T10:00:00+00:00"}}
    monkeypatch.setattr(readiness_service, "_compute", lambda case_id, repo, on: (
        {**payload, "audit": {**payload["audit"], "evaluation_id": "EV-" + case_id, "input_hash": "H-" + case_id}}, {}))

    assert setup("--seed-demo") == 0, capsys.readouterr().out
    out = capsys.readouterr().out
    assert "finalized" in out and "verified" in out and "eligibility checks" in out and "turns" in out
    # legal_verification_corrections: the CPA no longer re-keys the Sale Deed (its details are the agency's), so no
    # demo path writes a correction any more
    keep_empty = {"schema_migrations", "agent_logs", "crime_verification_migrations", "legal_verification_migrations",
                  "legal_verification_corrections",
                  "api_responses"}                       # filled by API calls; the demo seed calls the agents' code
    for agent, value in servers.items():
        if agent == "audit" or agent in LAYERED:
            continue                    # no demo rows of its own (audit: it fills as dedupe / risk / runs / issuer run)
        counts = _table_counts(value)
        empty = sorted(t for t, n in counts.items() if n == 0 and t not in keep_empty)
        assert not empty, (agent, empty)
    # the demo activity ran through each agent's own paths
    assert one(servers["bank_verification"], "SELECT count(*) FROM decisions") == 3
    assert one(servers["crime_verification"], "SELECT count(*) FROM crime_verification_reports") > 0
    assert one(servers["eligibility"], "SELECT count(*) FROM audit_events WHERE event_type = 'ELIGIBILITY_CHECKED'") > 0
    assert one(servers["chatbot"], "SELECT count(*) FROM chat_turns_log WHERE NOT is_demo") == 0
    # a second seed replaces the demo activity, it never doubles it
    first = {a: _table_counts(v) for a, v in servers.items()}
    assert setup("--seed-demo") == 0
    second = {a: _table_counts(v) for a, v in servers.items()}
    for agent in ("eligibility", "docs_policy", "chatbot", "bank_verification"):
        same = {t: n for t, n in first[agent].items() if t not in ("schema_migrations", "agent_logs")}
        assert {t: second[agent][t] for t in same} == same, agent
    # purge: nothing demo is left anywhere
    assert setup("--purge-demo", "--yes") == 0
    for agent, value in servers.items():
        if agent in LAYERED:
            continue                    # their rows are reference rules from their migrations, never demo rows
        left = {t: n for t, n in _table_counts(value).items() if n and t not in keep_empty}
        assert not left, (agent, left)


def test_the_connection_report_judges_every_connection_without_showing_it(servers, monkeypatch, capsys):
    from scripts.setup_agent_databases import connections

    monkeypatch.setenv("LOS_STORE_BACKEND", "sqlite")                               # the old .env.example line
    monkeypatch.setenv("LOS_STORE_DSN", "Host=localhost;Port=5432;Database=x;Username=postgres;Password=secretpw")
    monkeypatch.delenv("QDRANT_URL", raising=False)
    monkeypatch.setenv("QDRANT_PATH", "runtime/qdrant_demo")
    monkeypatch.setenv("ENVIRONMENT", "development")
    assert connections() == 2                                     # the backend and the .NET-style DSN
    out = capsys.readouterr().out
    assert "NOT SUPPORTED" in out and "NOT A VALID CONNECTION STRING" in out and "secretpw" not in out
    assert out.count("ok (database agdb_") == len(AGENTS)        # every agent database reachable
    monkeypatch.setenv("LOS_STORE_BACKEND", "postgres")
    monkeypatch.setenv("LOS_STORE_DSN", servers["chatbot"].replace("agdb_", "agdb_missing_"))
    monkeypatch.setenv("ENVIRONMENT", "production")
    assert connections() == 2                                     # an unknown database; embedded Qdrant in production
    out = capsys.readouterr().out
    assert "NOT REACHABLE" in out and "production needs QDRANT_URL" in out
    for value in servers.values():
        assert value not in out


# ------------------------------------------------------------------------------------------------ the audit database
def test_every_audit_trail_lands_in_los_audit_and_the_files_stay(tmp_path, monkeypatch):
    import os

    from shared.db import audit_store, writer
    from shared.observability.audit_log import append_line
    from shared.store.testing import _admin_dsn, _with_db

    admin = _admin_dsn()
    name = f"agdb_audit_{uuid.uuid4().hex[:8]}"
    with psycopg.connect(admin, autocommit=True) as conn:
        conn.execute(f'CREATE DATABASE "{name}"')
    dsn = _with_db(admin, name)
    monkeypatch.setenv("LOS_AUDIT_DSN", dsn)
    files = {s: tmp_path / f"{s}.jsonl" for s in audit_store.SOURCES}
    for source, path in files.items():
        env = audit_store.core.spec("audit")["sources"][source]["env"]
        monkeypatch.setenv(env, str(path))
    try:
        lines = {
            "dedupe_decisions": {"at": "2026-10-28T10:00:00+00:00", "request_id": "r1", "case_id": "CASE-0000000000A1",
                                 "policy_version": "1", "status": "NO_MATCH", "recommendation": "PROCEED",
                                 "rules": {"D1": "PASS"}, "coverage": {"mode": "SCAN", "cases_scanned": 10,
                                                                       "partial": False}},
            "customer_history": {"at": "2026-10-28T10:00:01+00:00", "request_id": "r2", "case_id": "DEMO-CASE-001",
                                 "parameter": "PAN", "party_role": "PRIMARY", "match": "NONE", "history_status": "NEW",
                                 "outcome": "CLEAR", "reason_codes": [], "policy_version": "1", "is_demo": True,
                                 "explanation_source": "rules"},
            "risk_decisions": {"timestamp": "2026-10-28T10:00:02+00:00", "request_id": "r3", "application_id": "APP-1",
                               "policy_version": "2", "policy_signed_off": True, "risk_score": 42,
                               "risk_category": "MEDIUM", "final_outcome": "REVIEW", "flags": [{"code": "F1"}],
                               "data_gaps": [], "summary_source": "rules", "duration_ms": 12.5},
            "agent_runs": {"timestamp": "2026-10-28T10:00:03+00:00", "run_id": "run_1", "agent_id": "credit_agent",
                           "agent_version": "0.1", "request_id": "r4", "status": "SUCCEEDED", "error": None,
                           "violations": [], "started_at": "2026-10-28T10:00:02+00:00", "duration_ms": 900,
                           "tools": [["repayment.get", None, "OK", 1]], "model_calls": []},
            "issuer_verifications": {"timestamp": "2026-10-28T10:00:04+00:00", "event_id": "e1", "request_id": "r5",
                                     "case_id": "CASE-0000000000A1", "document_type": "PAN", "attempted": True,
                                     "provider": "nsdl", "mode": "demo", "provider_status": "VERIFIED",
                                     "verified_fields": ["name"], "mismatched_fields": [], "reason_codes": [],
                                     "latency_ms": 80, "document_verdict": "VERIFIED", "source": "los_flow"},
        }
        for source, data in lines.items():
            append_line(files[source], json.dumps(data))
        append_line(tmp_path / "some_other_audit.jsonl", json.dumps({"at": "x"}))      # not a source: ignored
        audit_store.field_correction(request_id="r6", case_id="CASE-0000000000A1", document_id="D1",
                                     document_type="PAN", source_id="S1", field="name",
                                     reason="typo, PAN ABCDE1234F", corrected_by="officer.one")
        writer.flush_all()
        counts = {t: one(dsn, f"SELECT count(*) FROM {t}") for t in audit_store.TABLES}
        assert counts == {t: 1 for t in audit_store.TABLES}, counts
        assert all(p.read_text(encoding="utf-8").strip() for p in files.values())          # the files still written
        assert one(dsn, "SELECT is_demo FROM audit_customer_history") is True
        assert one(dsn, "SELECT is_demo FROM audit_dedupe_decisions") is False
        assert one(dsn, "SELECT rules->>'D1' FROM audit_dedupe_decisions") == "PASS"
        assert one(dsn, "SELECT risk_score FROM audit_risk_decisions") == 42
        assert one(dsn, "SELECT tools->0->>0 FROM audit_agent_runs") == "repayment.get"
        reason = one(dsn, "SELECT reason FROM audit_field_corrections")
        assert "ABCDE1234F" not in reason and "[PAN]" in reason                            # masked; no values stored
        cols = {r[0] for r in psycopg.connect(dsn).execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'audit_field_corrections'")}
        assert not cols & {"extracted", "corrected", "value", "old_value", "new_value"}
        # copying the same files again adds nothing; purge removes only the demo row
        from scripts.copy_local_data_to_agent_databases import copy_audit

        done = copy_audit(dsn, True)
        assert all(done[f"{s}_new"] == 0 for s in audit_store.SOURCES), done
        assert setup("--purge-demo", "--yes", "--only", "audit") == 0
        assert one(dsn, "SELECT count(*) FROM audit_customer_history") == 0
        assert one(dsn, "SELECT count(*) FROM audit_dedupe_decisions") == 1
    finally:
        writer.close_all()
        with psycopg.connect(admin, autocommit=True) as conn:
            conn.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


def test_one_database_every_agent_in_its_own_schema(servers, monkeypatch, capsys):
    """LOS_AGENTIC_DSN alone (owner 2026-11-02: "db ek hi sabka under los_agentic, schemas alag alag"): every agent
    migrates into ITS schema of the one database -- the same table names (audit_events, rule_sets, agent_logs) in
    several schemas never collide -- and a demo seed / purge works there exactly as with a database per agent."""
    from shared.db import core
    from agents.bank_verification.repository import close_pools
    from shared.store.testing import _admin_dsn, _with_db

    admin = _admin_dsn()
    name = f"agdb_shared_{uuid.uuid4().hex[:8]}"
    with psycopg.connect(admin, autocommit=True) as conn:
        conn.execute(f'CREATE DATABASE "{name}"')
    try:
        for agent in AGENTS:
            monkeypatch.delenv(ENV[agent], raising=False)
        monkeypatch.setenv("LOS_AGENTIC_DSN", _with_db(admin, name))
        core.forget()
        close_pools()
        assert setup() == 0, capsys.readouterr().out
        shared = _with_db(admin, name)
        schemas = {r[0] for r in psycopg.connect(shared).execute(
            "SELECT schema_name FROM information_schema.schemata")}
        # each agent's configured schema (fraud_screening -> fraud_detection, residence -> office_residence_verification)
        assert {core.schema(a) for a in AGENTS} <= schemas
        for agent in set(AGENTS) - {"chatbot"} - LAYERED:         # the chatbot has no rules
            assert one(shared, "SELECT count(*) FROM information_schema.tables WHERE table_schema = %s AND "
                       "table_name = 'rule_sets'", agent) == 1, agent
        assert one(shared, "SELECT count(*) FROM information_schema.tables WHERE table_name = 'audit_events' AND "
                   "table_schema IN ('eligibility', 'docs_policy', 'bank_verification')") == 3
        assert one(shared, "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'") == 0
        assert setup("--seed-demo") == 0, capsys.readouterr().out
        assert one(shared, "SELECT count(*) FROM eligibility.eligibility_runs") > 0
        assert one(shared, "SELECT count(*) FROM bank_verification.runs WHERE rule_set_hash IS NOT NULL") > 0
        # an audit row cannot be changed in the shared database either
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            with psycopg.connect(shared) as conn:
                conn.execute("UPDATE eligibility.audit_events SET actor = 'x'")
        assert setup("--purge-demo", "--yes") == 0, capsys.readouterr().out
        assert one(shared, "SELECT count(*) FROM eligibility.eligibility_runs") == 0
    finally:
        core.forget()
        close_pools()
        from agents.eligibility.data import migrations, providers

        providers.close_pools()
        migrations.forget()
        from shared.db import writer

        writer.close_all()
        with psycopg.connect(admin, autocommit=True) as conn:
            conn.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


# ------------------------------------------------------------------------------------------------- the rules in the DB
def test_the_rules_live_in_the_database_versioned_with_who_and_why(servers, monkeypatch, tmp_path, capsys):
    """2026-11-02 (owner: "rules db me config rahenge sabke"): outside production the first read loads the file once and
    puts it in force; a new version is stored but changes nothing until it is activated -- by a named person, for a
    reason, kept in an append-only history; a decision stores the hash of the rules it was made with."""
    import yaml

    from shared.db import rule_store
    from agents.eligibility import config as elig

    monkeypatch.setenv("ENVIRONMENT", "development")
    rule_store.forget()
    first_hash, first = rule_store.load_with_hash("eligibility_policy")
    db = servers["eligibility"]
    assert one(db, "SELECT rule_set_hash FROM rule_set_active WHERE name = 'eligibility_policy'") == first_hash
    assert one(db, "SELECT changed_by FROM rule_set_changes WHERE to_hash = %s", first_hash) == "system:first-load"
    # a new version: stored, NOT in force
    changed = dict(first)
    changed["rules"] = {**first["rules"], "min_score": int(first["rules"]["min_score"]) + 5}
    source = tmp_path / "eligibility_new.yaml"
    source.write_text(yaml.safe_dump(changed), encoding="utf-8")
    from scripts import rules as cli

    assert cli.main(["import", "eligibility_policy", "--file", str(source), "--by", "A. Officer",
                     "--note", "min score +5 (committee)"]) == 0
    rule_store.forget()
    assert elig.setting("rules", "min_score") == first["rules"]["min_score"]
    new_hash = rule_store.versions("eligibility_policy")[-1]["hash"]
    assert cli.main(["activate", "eligibility_policy", new_hash[:12], "--by", "A. Officer", "--note", "approved"]) == 0
    rule_store.forget()
    assert elig.setting("rules", "min_score") == first["rules"]["min_score"] + 5
    assert [(h["changed_by"], h["note"]) for h in rule_store.history("eligibility_policy")][-1] == ("A. Officer", "approved")
    # back to the first version: one more history row, nothing lost
    assert cli.main(["activate", "eligibility_policy", first_hash, "--by", "A. Officer", "--note", "rolled back"]) == 0
    assert len(rule_store.history("eligibility_policy")) == 3 and len(rule_store.versions("eligibility_policy")) == 2
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with psycopg.connect(db) as conn:
            conn.execute("UPDATE rule_set_changes SET note = 'x'")
    # a version missing a required setting is refused before it is stored
    broken = dict(first)
    broken.pop("rules")
    source.write_text(yaml.safe_dump(broken), encoding="utf-8")
    assert cli.main(["import", "eligibility_policy", "--file", str(source), "--by", "A", "--note", "b"]) == 1
    assert "REFUSED" in capsys.readouterr().out and len(rule_store.versions("eligibility_policy")) == 2
    # no name or no reason: refused
    with pytest.raises(rule_store.RulesInvalid):
        rule_store.activate("eligibility_policy", first_hash, by="", note="x")


def test_production_never_loads_rules_from_a_file(servers, monkeypatch):
    from shared.db import rule_store

    monkeypatch.setenv("ENVIRONMENT", "production")
    rule_store.forget()
    with pytest.raises(rule_store.RulesUnavailable, match="scripts/rules.py import"):
        rule_store.load("bank_verification_policy")                 # a database, but nothing in force
    monkeypatch.delenv("BANK_VERIFICATION_DSN")
    monkeypatch.delenv("LOS_AGENTIC_DSN", raising=False)
    rule_store.forget()
    with pytest.raises(rule_store.RulesUnavailable, match="LOS_AGENTIC_DSN"):
        rule_store.load("bank_verification_policy")                 # no database at all


def test_reading_the_rules_never_changes_a_database(servers, monkeypatch):
    """`rules.py list` / versions / history on a database without the rule tables: nothing is created there."""
    from shared.db import rule_store
    from scripts import rules as cli

    monkeypatch.setenv("ENVIRONMENT", "production")
    rule_store.forget()
    assert cli.main(["list"]) == 0
    assert rule_store.versions("crime_verification_policy") == [] and rule_store.history("dedupe_policy") == []
    for agent in ("crime_verification", "legal_verification", "audit"):
        assert one(servers[agent], "SELECT to_regclass('rule_set_active') IS NULL"), agent


def test_a_database_that_goes_away_keeps_the_version_in_force(servers, monkeypatch):
    from shared.db import rule_store

    monkeypatch.setenv("ENVIRONMENT", "development")
    rule_store.forget()
    digest, content = rule_store.load_with_hash("legal_verification_policy")
    monkeypatch.setitem(rule_store.settings(), "cache_seconds", 0)              # every read goes to the database

    def down(name, *, write=False):
        raise psycopg.OperationalError("connection refused")

    monkeypatch.setattr(rule_store, "_connect", down)                          # the database goes away
    assert rule_store.load_with_hash("legal_verification_policy") == (digest, content)


def test_the_old_databases_are_copied_into_los_agentic_unchanged(servers, monkeypatch, capsys):
    """scripts/move_agents_to_los_agentic.py: every agent's own database (tables in public) copied into its schema of
    the one database -- every count equal, the source untouched, a second copy refused, the ids continue."""
    from shared.db import core
    from shared.store.testing import _admin_dsn, _with_db
    from scripts import move_agents_to_los_agentic as move

    from agents.bank_verification.services import summary_service
    from agents.legal_verification.services import summary as legal_summary

    monkeypatch.setattr(summary_service, "ask", lambda shown: "Some checks found problems.")
    monkeypatch.setattr(legal_summary, "ask", lambda lines: list(lines))
    assert setup("--seed-demo") == 0, capsys.readouterr().out
    before = {a: _table_counts(v) for a, v in servers.items()}
    admin = _admin_dsn()
    name = f"agdb_move_{uuid.uuid4().hex[:8]}"
    with psycopg.connect(admin, autocommit=True) as conn:
        conn.execute(f'CREATE DATABASE "{name}"')
    try:
        monkeypatch.setenv("LOS_AGENTIC_DSN", _with_db(admin, name))
        assert move.main(["--copy"]) == 0, capsys.readouterr().out
        assert "every count matches" in capsys.readouterr().out
        shared = _with_db(admin, name)
        for agent in set(servers) - LAYERED:                         # never had a database of their own to copy
            src = {t: n for t, n in before[agent].items()
                   if t not in move.SKIP and t != "agent_logs"}            # logs keep arriving while it runs
            for table, n in src.items():
                assert one(shared, f'SELECT count(*) FROM "{core.schema(agent)}"."{table}"') == n, (agent, table)
        # the source databases are exactly as they were (logs aside: they keep arriving)
        for agent, value in servers.items():
            now = {t: n for t, n in _table_counts(value).items() if t != "agent_logs"}
            assert now == {t: n for t, n in before[agent].items() if t != "agent_logs"}, agent
        assert move.main(["--copy", "--only", "eligibility"]) == 1                        # not into a filled schema
        assert "REFUSED" in capsys.readouterr().out
        # a new audit row in the copy gets the next id, never a copied one
        with psycopg.connect(shared) as conn:
            top = conn.execute("SELECT max(event_id) FROM eligibility.audit_events").fetchone()[0] or 0
            conn.execute("INSERT INTO eligibility.audit_events (actor, event_type) VALUES ('t', 'T')")
            assert conn.execute("SELECT max(event_id) FROM eligibility.audit_events").fetchone()[0] == top + 1 \
                or top == 0
    finally:
        core.forget()
        from agents.bank_verification.repository import close_pools

        close_pools()
        with psycopg.connect(admin, autocommit=True) as conn:
            conn.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


def test_the_production_preflight_fails_every_demo_thing_and_changes_nothing(servers, monkeypatch, capsys):
    """scripts/preflight_production.py on demo databases in production: NOT READY, naming the demo rules, the demo
    rows and the demo switches -- and it writes nothing (no first load of the rules, no table) and prints no value."""
    from scripts import preflight_production as preflight

    monkeypatch.setenv("ENVIRONMENT", "development")
    assert setup() == 0                                              # migrated, empty
    before = {a: _table_counts(v) for a, v in servers.items()}
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("ALLOW_DEMO_BUREAU", "true")
    secret = "postgresql://someone:pw-not-to-print@h/x"
    monkeypatch.setenv("LOS_STORE_DSN", secret)
    assert preflight.main([]) == 1
    out = capsys.readouterr().out
    assert "NOT READY" in out and "pw-not-to-print" not in out
    assert "FAIL  ALLOW_DEMO_BUREAU" in out and "FAIL  in force" in out          # demo switch; no rules in force
    assert "PASS  migrations" in out and "PASS  audit append-only" in out
    assert {a: _table_counts(v) for a, v in servers.items()} == before            # nothing written anywhere
    assert preflight.main(["--json"]) == 1
    data = json.loads(capsys.readouterr().out)
    assert data["ready"] is False and any(c["state"] == "FAIL" for c in data["checks"])
    # rules in force but DEMO -> still not ready, and says so
    from shared.db import rule_store

    monkeypatch.setenv("ENVIRONMENT", "development")
    rule_store.forget()
    rule_store.load("bank_verification_policy")                      # first load: the demo policy in force
    monkeypatch.setenv("ENVIRONMENT", "production")
    preflight.main([])
    out = capsys.readouterr().out
    assert "rules bank_verification_policy" in out and "FAIL  confirmed" in out and "FAIL  demo_mode" in out


def test_every_api_response_lands_in_its_agents_schema_masked(servers, monkeypatch):
    """2026-11-02 (owner: "response bhi dalna h db me"): a POST's JSON response is stored in api_responses of the
    agent that answered it -- identifiers masked, the route's template, the status -- a GET is not, and a stored
    response can never be changed."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from shared.db import responses, writer

    app = FastAPI()
    responses.install(app)

    @app.post("/api/v1/eligibility/check/{case_id}")
    def check(case_id: str):
        return {"request_id": "elig_r1", "decision": "APPROVED", "pan": "ABCDE1234F", "case_id": case_id}

    @app.get("/api/v1/eligibility/form")
    def form():
        return {"fields": []}

    c = TestClient(app)
    assert c.post("/api/v1/eligibility/check/CASE-1").json()["pan"] == "ABCDE1234F"      # the caller sees it all
    c.get("/api/v1/eligibility/form")
    writer.flush_all()
    db = servers["eligibility"]
    assert one(db, "SELECT count(*) FROM api_responses") == 1                             # the GET is not stored
    assert one(db, "SELECT path FROM api_responses") == "/api/v1/eligibility/check/{case_id}"
    assert one(db, "SELECT request_id FROM api_responses") == "elig_r1"
    stored = one(db, "SELECT response::text FROM api_responses")
    assert "ABCDE1234F" not in stored and "APPROVED" in stored                            # masked, the rest kept
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with psycopg.connect(db) as conn:
            conn.execute("UPDATE api_responses SET status_code = 500")
