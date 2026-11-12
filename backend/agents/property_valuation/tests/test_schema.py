"""The migrations: ordered, unique, unqualified (the agent's schema comes from the search_path)."""

from agents.property_valuation.db.models import Base
from agents.property_valuation.db.schema import MIGRATIONS


def test_migrations_are_ordered_unique_and_unqualified():
    versions = [v for v, _d, _sql in MIGRATIONS]
    assert versions == sorted(versions) and len(set(versions)) == len(versions)
    sql = MIGRATIONS[0][2]
    assert "property_valuation." not in sql and "public." not in sql


def test_models_match_the_migrated_tables():
    sql = MIGRATIONS[0][2]
    for table in Base.metadata.tables.values():
        assert table.schema is None
        assert f"CREATE TABLE IF NOT EXISTS {table.name} (" in sql
        for column in table.columns:
            assert f"    {column.name} " in sql, (table.name, column.name)
