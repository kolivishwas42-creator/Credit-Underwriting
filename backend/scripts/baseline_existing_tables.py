"""
ADOPT TABLES AN AGENT'S OWN APP CREATED BEFORE IT JOINED THIS SERVICE (2026-11-07).

Fraud screening, residence / office verification and property valuation were first run as the teammates' standalone
apps, which created their tables (and seed rows) in agentic_LOS without this service's migration record. On first use
the migration runner then tried their table-creating migration again ("relation already exists") and the agent
answered 500. This script, for each agent named:

    1. checks that every table the BASELINE migrations create already exists (else it stops: run the normal setup)
    2. records those migrations in the agent's schema_migrations (checksum of their SQL) -- no table, no row changed
    3. applies every later migration through the normal runner (shared.db.core.apply_migrations)

    python scripts/baseline_existing_tables.py            # the three agents below
    python scripts/baseline_existing_tables.py --dry-run  # say what it would do

Reads .env; never prints a DSN. Take a backup first (pg_dump -n <schema>).
"""

from __future__ import annotations

import argparse
import importlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# agent -> the migrations its standalone app already applied (tables + seed rows exist)
BASELINE = {
    "fraud_screening": ["0001"],
    "residence_office_verification": ["rov-0001", "rov-0002"],
    "property_valuation": ["0001"],
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env", override=False)
    import psycopg

    from shared.db import core

    failed = 0
    for agent, versions in BASELINE.items():
        migrations = importlib.import_module(f"agents.{agent}.db.schema").MIGRATIONS
        schema = core.schema(agent)
        with psycopg.connect(core.require_dsn(agent), connect_timeout=10) as conn:
            core.ensure_schema(conn)
            have = {r[0] for r in conn.execute(
                "SELECT table_name FROM information_schema.tables WHERE table_schema = %s", (schema,))}
            base = [m for m in migrations if m[0] in versions]
            needed = {t for _, _, sql in base
                      for t in re.findall(r"(?i)CREATE TABLE (?:IF NOT EXISTS )?([a-z_]+)", sql)}
            missing = sorted(needed - have)
            if missing:
                print(f"{agent}: STOP -- tables missing in {schema}: {missing} (use setup_agent_databases.py)")
                failed += 1
                continue
            conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, description TEXT "
                         "NOT NULL, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())")
            done = {r[0] for r in conn.execute("SELECT version FROM schema_migrations")}
            todo = [m for m in base if m[0] not in done]
            later = [m[0] for m in migrations if m[0] not in versions and m[0] not in done]
            print(f"{agent} [{schema}]: baseline {[m[0] for m in todo] or 'already recorded'}; then apply {later}")
            if args.dry_run:
                conn.rollback()
                continue
            for version, description, sql in todo:
                conn.execute("INSERT INTO schema_migrations (version, description, checksum) VALUES (%s, %s, %s)",
                             (version, description + " (baseline: tables created by the agent's former app)",
                              core.checksum(sql)))
            conn.commit()
            applied = core.apply_migrations(conn, agent, migrations)
            print(f"   applied now: {applied or 'nothing'}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
