"""
The AI risk summary of a verification run: the local model (Ollama, shared/llm/config.py) turns the TRIGGERED rules into
a few short markdown bullet points with actionable insights. It explains; it never decides (the rule engine's
overall_recommendation stands).

    triggered_rules(evaluation)        the rules that raised an issue, in the compact shape the model sees
    summarise(evaluation, mode, ...)   {"ai_summary", "ai_summary_source", "ai_summary_model"} -- never raises
    OllamaSummariser(spec)             the model call (injected into the service; tests pass a fake or none)

No rule triggered -> the configured all-clear text, no model call. Model down / slow / error -> the configured notice,
source "unavailable" (the verification itself never fails because of the summary). All texts, the model, the timeout
and the prompt are in conf/settings.yaml (ai_summary).
"""

from __future__ import annotations

import json
import logging
import re
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

Summariser = Callable[[str, list], str]          # (verification_type, triggered rules) -> text; raises on failure


@dataclass(frozen=True)
class AiSummarySettings:
    enabled: bool
    model: Optional[str]                         # None -> the app's model (OLLAMA_MODEL)
    timeout_seconds: float
    temperature: float
    system_prompt: str
    user_prompt: str                             # .format(verification_type=..., triggered=...)
    all_clear_text: str
    unavailable_text: str

    def model_name(self) -> str:
        from shared.llm.config import ollama_model

        return self.model or ollama_model()


def triggered_rules(evaluation: dict[str, Any]) -> list[dict[str, Any]]:
    return [{"rule_id": r.get("rule_id"), "name": r.get("rule_name"), "summary": r.get("summary"),
             "finding": r.get("finding")}
            for r in evaluation.get("rules") or [] if r.get("triggered") is True]


def summarise(evaluation: dict[str, Any], verification_type: str, spec: Optional[AiSummarySettings],
              summariser: Optional[Summariser]) -> dict[str, Any]:
    if spec is None or not spec.enabled or summariser is None:
        return {"ai_summary": "", "ai_summary_source": "off", "ai_summary_model": None}
    triggered = triggered_rules(evaluation)
    if not triggered:
        return {"ai_summary": spec.all_clear_text, "ai_summary_source": "rules", "ai_summary_model": None}
    try:
        text = summariser(verification_type, triggered).strip()
        if not text:
            raise ValueError("empty reply")
        return {"ai_summary": text, "ai_summary_source": "ai", "ai_summary_model": spec.model_name()}
    except Exception as exc:  # noqa: BLE001 - a summary never breaks a verification run
        logger.warning("residence/office summary: model unavailable (%s)", type(exc).__name__)
        return {"ai_summary": spec.unavailable_text, "ai_summary_source": "unavailable", "ai_summary_model": None}


class OllamaSummariser:
    """One non-streaming /api/chat call to the local Ollama daemon (host from OLLAMA_HOST)."""

    def __init__(self, spec: AiSummarySettings):
        self.spec = spec

    def __call__(self, verification_type: str, triggered: list) -> str:
        from shared.llm.config import ollama_host, with_num_ctx

        spec = self.spec
        user = spec.user_prompt.format(verification_type=verification_type,
                                       triggered=json.dumps(triggered, ensure_ascii=False, default=str))
        body = {"model": spec.model_name(), "stream": False,
                "messages": [{"role": "system", "content": spec.system_prompt.strip()},
                             {"role": "user", "content": user}],
                "options": with_num_ctx({"temperature": spec.temperature})}
        request = urllib.request.Request(f"{ollama_host().rstrip('/')}/api/chat", json.dumps(body).encode(),
                                         {"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=spec.timeout_seconds) as response:
            reply = json.loads(response.read())
        text = str((reply.get("message") or {}).get("content") or "")
        return re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()
