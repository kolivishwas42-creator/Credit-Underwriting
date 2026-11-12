"""
PSYCOPG FOR AN AGENT'S SCHEMA -- the one way a plain-SQL agent opens a connection (shared/db/core.py decides WHERE).

    connect(agent)         a psycopg 3 connection, rows as dicts, search_path = the agent's schema
    transaction(agent)     `with transaction("residence_office_verification") as conn:` -- commit / rollback / close
    ensure_schema(agent)   CREATE SCHEMA IF NOT EXISTS for the agent

The DSN comes only from the environment (core.require_dsn); never logged, never in an error.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Iterator

from shared.db import core


def connect(agent: str, *, connect_timeout: int = 8) -> Any:
    import psycopg
    from psycopg.rows import dict_row

    return psycopg.connect(core.require_dsn(agent), row_factory=dict_row, connect_timeout=connect_timeout)


@contextmanager
def transaction(agent: str) -> Iterator[Any]:
    """One transaction: committed when the block ends, rolled back on any error, the connection always closed."""
    conn = connect(agent)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def ensure_schema(agent: str) -> None:
    from psycopg import sql

    with transaction(agent) as conn:
        conn.execute(sql.SQL("CREATE SCHEMA IF NOT EXISTS {}").format(sql.Identifier(core.schema(agent))))


__all__ = ["connect", "ensure_schema", "transaction"]
