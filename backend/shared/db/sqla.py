"""
SQLALCHEMY FOR AN AGENT'S SCHEMA -- the one way an ORM agent reaches its tables (shared/db/core.py decides WHERE).

    engine(agent)          one pooled Engine per agent (psycopg 3); search_path = the agent's schema, so its models
                           and SQL stay unqualified
    session(agent)         `with session("fraud_screening") as s:` -- commits on success, rolls back on error
    session_dependency(a)  the FastAPI dependency form: `db: Session = Depends(session_dependency("fraud_screening"))`
    ensure_schema(agent)   CREATE SCHEMA IF NOT EXISTS for the agent (before its schema SQL runs)

The DSN comes only from the environment (core.require_dsn: LOS_AGENTIC_DSN or the agent's own variable); it is never
logged or put in an error. Engines are created on first use, never at import, so importing an agent needs no database.
"""

from __future__ import annotations

import threading
from contextlib import contextmanager
from typing import Any, Callable, Iterator

from shared.db import core

_LOCK = threading.Lock()
_ENGINES: dict[tuple[str, str], Any] = {}


def engine(agent: str):
    """The agent's Engine (created once per agent and DSN)."""
    import psycopg
    from sqlalchemy import create_engine

    value = core.require_dsn(agent)
    key = (agent, value)
    with _LOCK:
        found = _ENGINES.get(key)
        if found is None:
            # creator: the DSN may be a libpq key=value string with `options` (core.with_schema), which a URL cannot
            # carry; psycopg connects with it exactly as the psycopg agents do
            found = create_engine("postgresql+psycopg://", creator=lambda: psycopg.connect(value),
                                  pool_pre_ping=True, future=True)
            _ENGINES[key] = found
        return found


@contextmanager
def session(agent: str) -> Iterator[Any]:
    """One unit of work: committed when the block ends, rolled back on any error."""
    from sqlalchemy.orm import Session

    with Session(engine(agent), expire_on_commit=False) as s:
        try:
            yield s
            s.commit()
        except Exception:
            s.rollback()
            raise


def session_dependency(agent: str) -> Callable[[], Iterator[Any]]:
    """A FastAPI dependency yielding the agent's Session (one per request)."""
    def _dependency() -> Iterator[Any]:
        with session(agent) as s:
            yield s

    _dependency.__name__ = f"{agent}_session"
    return _dependency


def ensure_schema(agent: str) -> None:
    """CREATE SCHEMA IF NOT EXISTS for the agent's schema (a no-op for an agent on its own database)."""
    from sqlalchemy import text

    with engine(agent).begin() as conn:
        conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{core.schema(agent)}"'))


def dispose(agent: str | None = None) -> None:
    """Close the pooled connections (tests, shutdown)."""
    with _LOCK:
        for key in [k for k in _ENGINES if agent is None or k[0] == agent]:
            _ENGINES.pop(key).dispose()


__all__ = ["dispose", "engine", "ensure_schema", "session", "session_dependency"]
