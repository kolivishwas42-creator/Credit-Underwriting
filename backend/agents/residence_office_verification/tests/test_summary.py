"""The AI risk summary (summary.py) with fake summarisers: no network, no model."""

from __future__ import annotations

from dataclasses import replace

from agents.residence_office_verification.config import load_settings
from agents.residence_office_verification.schemas import ResidenceVerificationRequest
from agents.residence_office_verification.service import ResidenceVerificationService
from agents.residence_office_verification.summary import summarise, triggered_rules

ISSUE = {"rules": [{"rule_id": "R1", "rule_name": "Negative area", "summary": "Area is negative", "finding": "Yes",
                    "triggered": True},
                   {"rule_id": "R2", "rule_name": "Name plate", "summary": "OK", "finding": None, "triggered": False}]}


def _spec(**changes):
    return replace(load_settings().ai_summary, **changes)


def test_settings_carry_the_ai_summary_and_the_env_switch(monkeypatch):
    spec = load_settings().ai_summary
    assert spec.timeout_seconds == 10 and spec.all_clear_text.startswith("* **All Clear:**")
    monkeypatch.setenv("RESIDENCE_OFFICE_VERIFICATION_AI_SUMMARY", "off")
    assert load_settings().ai_summary.enabled is False


def test_only_triggered_rules_reach_the_model():
    assert triggered_rules(ISSUE) == [{"rule_id": "R1", "name": "Negative area", "summary": "Area is negative",
                                       "finding": "Yes"}]


def test_summary_sources():
    calls = []

    def fake(mode, triggered):
        calls.append((mode, triggered))
        return "* **Risk:** negative area"

    spec = _spec(enabled=True, model="test-model")
    assert summarise(ISSUE, "RESIDENCE", spec, fake) == {"ai_summary": "* **Risk:** negative area",
                                                          "ai_summary_source": "ai", "ai_summary_model": "test-model"}
    assert calls[0][0] == "RESIDENCE" and len(calls[0][1]) == 1
    clear = summarise({"rules": []}, "OFFICE", spec, fake)
    assert clear["ai_summary_source"] == "rules" and clear["ai_summary"] == spec.all_clear_text and len(calls) == 1

    def down(mode, triggered):
        raise TimeoutError("model slow")

    out = summarise(ISSUE, "RESIDENCE", spec, down)
    assert out == {"ai_summary": spec.unavailable_text, "ai_summary_source": "unavailable", "ai_summary_model": None}
    assert summarise(ISSUE, "RESIDENCE", spec, None)["ai_summary_source"] == "off"
    assert summarise(ISSUE, "RESIDENCE", _spec(enabled=False), fake)["ai_summary"] == ""


def test_verify_returns_the_summary(fake_repo, settings, sample_request):
    settings = replace(settings, ai_summary=_spec(enabled=True))
    out = ResidenceVerificationService(fake_repo, settings, lambda m, t: "never called").verify(
        ResidenceVerificationRequest(**sample_request))
    assert out["overall_recommendation"] == "PASS"
    assert out["ai_summary_source"] == "rules" and out["ai_summary"] == settings.ai_summary.all_clear_text
    assert "ai_summary" not in fake_repo.saved[0][1]["evaluation"]
