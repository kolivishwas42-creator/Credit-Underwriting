"""The agent's ORM models. Unqualified table names: the session's search_path is the agent's schema (shared.db.sqla).
The tables themselves are created by db/schema.py (MIGRATIONS), never by metadata.create_all."""

from __future__ import annotations

from sqlalchemy import BigInteger, Boolean, Column, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class PropertyValuationVerification(Base):
    __tablename__ = "property_valuation_verifications"

    verification_id = Column(BigInteger, primary_key=True, autoincrement=True)
    application_id = Column(BigInteger, nullable=False, index=True)
    collateral_property_id = Column(BigInteger, nullable=False, index=True)
    vendor_name = Column(String(150))
    verification_type = Column(String(30), nullable=False, default="INITIAL_VISIT")
    vendor_status = Column(String(30))
    submitted_data = Column(JSONB, nullable=False, default=dict)
    vendor_response = Column(JSONB, nullable=False, default=dict)
    verified_at = Column(DateTime(timezone=False))
    created_at = Column(DateTime(timezone=False), server_default=func.now(), nullable=False)


class PropertyValuationAgentResult(Base):
    __tablename__ = "property_valuation_agent_results"

    result_id = Column(BigInteger, primary_key=True, autoincrement=True)
    application_id = Column(BigInteger, nullable=False, index=True)
    collateral_property_id = Column(BigInteger, nullable=False, index=True)
    verification_id = Column(BigInteger, ForeignKey("property_valuation_verifications.verification_id",
                                                    ondelete="SET NULL"), nullable=True, index=True)
    agent_version = Column(String(50))
    vendor_status = Column(String(30))
    agent_status = Column(String(30), nullable=False)
    total_rules_checked = Column(Integer, default=0)
    total_rules_passed = Column(Integer, default=0)
    total_rules_triggered = Column(Integer, default=0)
    critical_issues_count = Column(Integer, default=0)
    major_issues_count = Column(Integer, default=0)
    minor_issues_count = Column(Integer, default=0)
    key_insights = Column(JSONB, nullable=False, default=list)
    risk_factors = Column(JSONB, nullable=False, default=list)
    recommended_actions = Column(JSONB, nullable=False, default=list)
    created_at = Column(DateTime(timezone=False), server_default=func.now(), nullable=False, index=True)


class PropertyValuationRuleConfig(Base):
    __tablename__ = "property_valuation_rule_configs"

    rule_key = Column(String(30), primary_key=True)
    original_id = Column(String(30), nullable=False)
    name = Column(String(200), nullable=False)
    description = Column(Text)
    enabled = Column(Boolean, nullable=False, default=True)
    sequence = Column(Integer, nullable=False, default=1)
    severity = Column(String(20), nullable=False, default="MAJOR")
    fields = Column(JSONB, nullable=False, default=dict)
    settings = Column(JSONB, nullable=False, default=dict)
    updated_at = Column(DateTime(timezone=False), server_default=func.now(), onupdate=func.now(), nullable=False)
