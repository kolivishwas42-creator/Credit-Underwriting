"""
A plain-language EXPLANATION of an eligibility result -- written by the local model, never a decision.

THE MODEL EXPLAINS, IT NEVER DECIDES. It is handed the finished result (decision, amounts, FOIR / LTV, the failed
rules, the engine's reasons) and asked for one or two sentences an officer can read to the customer. Nothing it writes
is read back by the engine; `decision`, every amount and every rule stay exactly as computed.

CHECKED BEFORE IT IS SHOWN (`accepted`): every number it writes must be one of the result's own figures (any
grouping -- "3,65,000" and "365000" are the same figure); it may not use a decision word that contradicts the decision
("approved" for a REJECTED case); at most `max_chars`. Anything else -> None, and the response simply has no
`explanation`. The model slow / down / unavailable -> None as well -- never an error, never a delay past the timeout.

Off unless the caller asks (`explain: true` on POST /check) and config `explanation.enabled` allows it.
"""

from __future__ import annotations

import json
import logging
import re
import threading
from collections import OrderedDict
from typing import Any

from agents.eligibility import config

logger = logging.getLogger(__name__)

#: decision -> words its explanation must not use (each one says a different decision)
_CONTRADICTS = {
    "APPROVED": ("rejected", "reject", "not eligible", "declined", "refer"),
    "CONDITIONAL": ("rejected", "not eligible", "declined", "full amount approved"),
    "REFER": ("rejected", "approved", "declined"),
    "REJECTED": ("approved", "eligible for", "sanctioned", "conditional"),
    "DATA_MISSING": ("approved", "rejected", "eligible for", "sanctioned"),
}


def _spec() -> dict[str, Any]:
    return dict(config.document().get("explanation") or {})


def _setting(key: str):
    """One AI-summary setting, strictly from config (section AI SUMMARY) -- no number in the code."""
    return config.setting("explanation", key)


def enabled() -> bool:
    return bool(_setting("enabled"))


def _digits(text: str) -> set[str]:
    """Every figure in a text, grouping and decimals of zero removed: "3,65,000" / "365000.0" -> "365000"."""
    out = set()
    for raw in re.findall(r"\d[\d,]*(?:\.\d+)?", text or ""):
        value = raw.replace(",", "")
        if "." in value:
            whole, frac = value.split(".", 1)
            value = whole if not frac.strip("0") else f"{whole}.{frac.rstrip('0')}"
        out.add(value.lstrip("0") or "0")
    return out


def facts(result: dict[str, Any]) -> dict[str, Any]:
    """What the model is shown: the result's own figures and words, nothing else."""
    if "loan" in result or "ratios" in result:                  # the final response shape (response.build)
        loan, ratios = result.get("loan") or {}, result.get("ratios") or {}
        result = {**result, "requested_amount": loan.get("requested"), "eligible_amount": loan.get("eligible"),
                  "emi": loan.get("emi"), "foir": (ratios.get("foir") or {}).get("on_eligible"),
                  "ltv": (ratios.get("ltv") or {}).get("on_eligible")}
        final = result.get("final") or {}
        result = {**result, "offered_amount": final.get("amount"), "offer_range": final.get("bucket")}
    return {k: result.get(k) for k in ("decision", "requested_amount", "eligible_amount", "offered_amount",
                                       "offer_range", "emi", "foir", "ltv", "limiting_factor", "missing_fields",
                                       "reasons", "summary") if result.get(k) is not None} | {
        "failed_rules": [_with_maturity(r, result) for r in result.get("rules") or []
                         if r.get("result") in ("fail", "missing")]}


def _with_maturity(rule: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    """AGE: the age when the loan ends (age + tenure / 12) -- the response keeps only the age, and "Age 47 (limit
    21-60, max 65 at maturity)" was read as "47 exceeds 60" (2026-10-15)."""
    tenure = (result.get("loan") or {}).get("tenure_months") or (result.get("inputs") or {}).get("tenure_months")
    if rule.get("rule") != "AGE" or not isinstance(rule.get("value"), (int, float)) or not tenure:
        return rule
    return {**rule, "at_maturity": round(float(rule["value"]) + float(tenure) / 12.0, 1)}


def _missing_words(fields: Any) -> list[str] | None:
    """Missing fields as the officer reads them -- never a field code (2026-10-15: the model copied "tenure_months",
    the guard refused it, and 9 of 19 summaries were missing). "tenure_months (allowed 6-60, given 237)" ->
    "tenure 237 months (allowed 6-60 months)"; others by config response.missing_labels."""
    if not fields:
        return None
    labels = (config.document().get("response") or {}).get("missing_labels") or {}
    out: list[str] = []
    absent: list[str] = []                       # plain missing fields: one phrase ("X and Y are missing")
    for field in fields:
        text = str(field)
        tenure = re.match(r"tenure_months \(allowed (\d+)-(\d+), given (\d+)\)", text)
        if tenure:
            low, high, given = tenure.groups()
            word = f"tenure of {given} months is outside the allowed {low}-{high} months"
            if word not in out:
                out.append(word)
        else:
            key = text.split(" ")[0].split(".")[-1]
            name = str(labels.get(key) or key.replace("_", " "))
            if name not in absent:
                absent.append(name)
    if absent:
        joined = absent[0] if len(absent) == 1 else ", ".join(absent[:-1]) + " and " + absent[-1]
        out.append(f"{joined} {'is' if len(absent) == 1 else 'are'} missing")
    return out


def _limit_words(code: Any) -> str | None:
    """FOIR -> "FOIR (the EMIs the income can carry)" (config response.limit_words); None when nothing limited."""
    if not code:
        return None
    words = ((config.document().get("response") or {}).get("limit_words") or {}).get(str(code))
    return str(words or code)


def _rupees(value: Any) -> str:
    """₹ with Indian grouping (₹22,00,000), so the model writes amounts the way an officer reads them."""
    try:
        amount = round(float(value))
    except (TypeError, ValueError):
        return str(value)
    digits = str(abs(amount))
    head, tail = digits[:-3], digits[-3:]
    groups = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    return "₹" + ",".join(([head] if head else []) + groups + [tail])


def _shown(found: dict[str, Any]) -> dict[str, Any]:
    """The facts as the MODEL sees them (2026-10-15: raw floats "2222000.0" and an escaped "\\u20b9" were copied into
    the text): amounts as ₹ with grouping, ratios as percentages, the decision in plain words. Same figures."""
    # COMPACT AND UNAMBIGUOUS (2026-10-15): 477 prompt tokens -> ~120 (CPU prompt time is per token), and every name
    # says WHICH amount a figure belongs to -- "foir" alone was read as the FOIR on the full request. The engine's
    # reasons repeat these figures and are left out. Same figures as the result, nothing new.
    f = found
    offer = f.get("offered_amount") if f.get("offered_amount") is not None else f.get("eligible_amount")
    if str(f.get("decision")) in ("REJECTED", "DATA_MISSING") or not offer:
        offer = None                                    # nothing is offered: no "₹0 can be offered" sentence
    out: dict[str, Any] = {"decision": f.get("decision"),
                           "requested": _rupees(f["requested_amount"]) if f.get("requested_amount") is not None else None,
                           "can_offer": _rupees(offer) if offer is not None else None,
                           "emi_at_offer": _rupees(f["emi"]) if f.get("emi") and offer is not None else None,
                           # in words (config response.limit_words); the ratios AT the offer are left out -- the
                           # 4B model read "foir_at_offer 49.95%" as the FOIR limit (2026-10-15)
                           "limited_by": _limit_words(f.get("limiting_factor")) if offer is not None else None,
                           "to_fix": _missing_words(f.get("missing_fields"))}
    failed = []
    for r in f.get("failed_rules") or []:
        rule = str(r.get("rule") or "")
        label = str(r.get("label") or rule)
        value, limit = r.get("value"), r.get("limit")
        if rule in ("FOIR", "LTV"):
            label = f"{rule} on the full request"
            value = f"{value}%" if value is not None else None
            limit = f"{limit}%" if limit is not None else None
        elif rule == "INCOME":
            value = _rupees(value) if value is not None else None
            limit = _rupees(limit) if limit is not None else None
        elif rule == "AGE":
            bounds = re.match(r"\s*(\d+)-(\d+)(?:.*?max (\d+))?", str(limit or ""))
            if bounds and value is not None:
                low, high, at_most = bounds.groups()
                if int(low) <= float(value) <= int(high) and at_most and r.get("at_maturity") is not None:
                    failed.append(f"age at the end of the loan {r['at_maturity']:g} (maximum {at_most})")
                else:
                    failed.append(f"age {value:g} (allowed {low}-{high})" if isinstance(value, (int, float))
                                  else f"age {value} (allowed {low}-{high})")
                continue
        line = label + (f" {value}" if value is not None else "") + (f" (limit {limit})" if limit is not None else "")
        failed.append(line if r.get("result") == "fail" else f"{label}: not available")
    code = str(f.get("limiting_factor") or "")
    if offer is not None and code:
        # THE BINDING LIMIT, with its figure (2026-10-15: a Personal Loan capped at the product maximum was explained
        # by its failed FOIR -- true, but not what set the amount)
        if code in ("FOIR", "LTV"):
            binding = next((x for x in failed if x.startswith(f"{code} on the full request")), None)
            out["limited_by"] = binding or code
        elif code == "PRODUCT_MAX" and f.get("eligible_amount") is not None:
            out["limited_by"] = f"the product maximum of {_rupees(f['eligible_amount'])}"
    if failed and not (str(f.get("decision")) == "CONDITIONAL" and code) and str(f.get("decision")) != "DATA_MISSING":
        out["failed"] = failed                       # a conditional offer is explained by what limits it, only
    # THE ENGINE'S OWN REASON when nothing can be offered ("the affordable amount ₹4,51,000 is below the product
    # minimum ₹5,00,000" -- not a failed rule, so it was missing from the facts, 2026-10-15)
    reason = str(f.get("summary") or "").strip()
    if str(f.get("decision")) in ("REJECTED", "REFER") and reason:
        out["reason"] = re.sub(r"^(Not eligible|Cannot decide yet)[:.]\s*", "", reason).rstrip(".")
    return {k: v for k, v in out.items() if v not in (None, [], "")}


def accepted(result: dict[str, Any], text: str) -> bool:
    """Whether the explanation may be shown: its figures are the result's, no contradicting decision word, short."""
    text = (text or "").strip()
    if not text or len(text) > int(_setting("max_chars")):
        return False
    if re.search(r"[a-z]_[a-z]", text):
        return False                                            # a field name ("can_offer") is not for the officer
    found = facts(result)
    # the raw figures AND the figures as the model was shown them (EMI 13495.89 is shown, and written, as ₹13,496)
    known = _digits(json.dumps(found, default=str)) | _digits(json.dumps(_shown(found), default=str,
                                                                          ensure_ascii=False))
    if not _digits(text) <= known:
        return False                                            # a figure the result does not hold
    low = text.lower()
    # A COUNT IN WORDS is a figure too ("all five checks pass" for six rules, 2026-10-15): never written in words
    if set(re.findall(r"[a-z]+", low)) & _COUNT_WORDS:
        return False
    return not any(w in low for w in _CONTRADICTS.get(str(result.get("decision")), ()))


#: number words the digit check cannot see -- a count in words is refused
_COUNT_WORDS = {"two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "both", "dono", "teen", "char",
                "paanch", "chhe"}


#: THE SAME FACTS -> THE SAME SENTENCE (2026-10-15): a re-check with unchanged figures, or another case with the same
#: result, answers at once instead of ~3-5 s of CPU generation. Only ACCEPTED texts are kept; bounded.
_CACHE: OrderedDict[str, str] = OrderedDict()
_CACHE_LOCK = threading.Lock()


def _messages(result: dict[str, Any], language: str) -> tuple[list[dict[str, str]], str]:
    spec = _spec()
    instructions = str(_setting("instructions")).strip()
    languages = _setting("languages")
    lang = str(languages.get(language) or languages["en"])
    user = json.dumps(_shown(facts(result)), default=str, ensure_ascii=False)
    return ([{"role": "system", "content": instructions.replace("{language}", lang)},
             {"role": "user", "content": user}], f"{language}|{user}")


def _call(messages: list[dict[str, str]], num_predict: int, timeout: float) -> str:
    import urllib.request

    from shared.llm.config import ollama_host, ollama_model

    spec = _spec()
    body = {"model": str(spec.get("model") or ollama_model()), "stream": False,
            "keep_alive": str(_setting("keep_alive")), "messages": messages,
            "options": {"temperature": 0.2, "num_predict": num_predict}}
    request = urllib.request.Request(f"{ollama_host().rstrip('/')}/api/chat", json.dumps(body).encode(),
                                     {"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return str((json.load(response).get("message") or {}).get("content") or "")


def _whole_sentences(text: str) -> str:
    """A reply cut off by the token limit ends mid-sentence: keep the complete sentences, or nothing."""
    text = text.strip().strip('"').replace("\\u20b9", "₹")  # an escaped rupee sign copied from a JSON string
    if not text or text[-1] in ".!?":
        return text
    cut = max(text.rfind(". "), text.rfind("! "), text.rfind("? "))
    return text[:cut + 1] if cut > 0 else ""


def _stream_call(messages: list[dict[str, str]], num_predict: int, timeout: float, sentences: int):
    """The model's words as they come (Ollama stream), STOPPED once `sentences` sentences are complete -- the model
    tends to run on past the one sentence asked for, and every extra word is ~0.1 s of CPU. A "." inside a number
    ("49.99%") is not an end: a sentence ends at . ! ? followed by a space or the end of the reply."""
    import urllib.request

    from shared.llm.config import ollama_host, ollama_model

    spec = _spec()
    body = {"model": str(spec.get("model") or ollama_model()), "stream": True,
            "keep_alive": str(_setting("keep_alive")), "messages": messages,
            "options": {"temperature": 0.2, "num_predict": num_predict}}
    request = urllib.request.Request(f"{ollama_host().rstrip('/')}/api/chat", json.dumps(body).encode(),
                                     {"Content-Type": "application/json"})
    text, ended = "", 0
    with urllib.request.urlopen(request, timeout=timeout) as response:
        for raw in response:
            if not raw.strip():
                continue
            chunk = json.loads(raw)
            delta = str((chunk.get("message") or {}).get("content") or "")
            if text.rstrip() and text.rstrip()[-1] in ".!?" and (delta[:1].isspace() or not delta):
                ended += 1
                if ended >= sentences:
                    return                                   # closing the response stops the generation
            if delta:
                text += delta
                yield delta
            if chunk.get("done"):
                return


#: a decision code copied as it is -> the word an officer reads ("This case is CONDITIONAL ..." -> "conditional")
_CODES = {"APPROVED": "approved", "CONDITIONAL": "conditional", "REJECTED": "rejected", "REFER": "referred",
          "DATA_MISSING": "missing data"}


def _regroup(match: re.Match) -> str:
    """One ₹ amount in Indian grouping; an amount with paise is left exactly as written; a trailing comma stays."""
    whole, paise = match.group(1), match.group(2)
    if paise:
        return match.group(0)
    tail = "," if whole.endswith(",") else ""
    return _rupees(whole.rstrip(",").replace(",", "")) + tail


def _tidy(text: str) -> str:
    for code, word in _CODES.items():
        text = re.sub(rf"\b{code}\b", word, text)
    # NO DASH in a sentence the officer reads (owner 2026-10-15): "requested -- FOIR ..." -> "requested, FOIR ..."
    text = re.sub(r"\s*(?:--|—|–)\s*", ", ", text)
    # EVERY RUPEE AMOUNT IN INDIAN GROUPING (2026-10-15: the model wrote "₹100,00,000" for ₹1,00,00,000 -- the same
    # digits, so the figure check passed; the officer reads the grouping)
    text = re.sub(r"₹\s?(\d[\d,]*)(\.\d+)?", _regroup, text)
    return re.sub(r",\s*,", ",", text)


def _cached(key: str) -> str | None:
    with _CACHE_LOCK:
        if key in _CACHE:
            _CACHE.move_to_end(key)
            return _CACHE[key]
    return None


def _keep(key: str, text: str) -> None:
    with _CACHE_LOCK:
        _CACHE[key] = text
        while len(_CACHE) > int(_setting("cache_size")):
            _CACHE.popitem(last=False)


def fallback(result: dict[str, Any]) -> str | None:
    """THE SAME ONE-LINE REMARK, BUILT FROM THE FACTS (owner 2026-10-15: "summary should tell for every case"): the
    model's sentence shapes filled in directly -- used when the model is slow, down or its text fails the check, so
    the card never says "not available". Every figure comes from the result, exactly as shown to the model."""
    f = _shown(facts(result))
    decision = str(f.get("decision") or "")
    if decision == "APPROVED" and f.get("can_offer"):
        emi = f" at an EMI of {f['emi_at_offer']}" if f.get("emi_at_offer") else ""
        return f"Approved for the full {f['can_offer']}{emi}."
    if decision == "CONDITIONAL" and f.get("can_offer"):
        why = f", limited by {f['limited_by']}" if f.get("limited_by") else ""
        asked = f" of the {f['requested']} requested" if f.get("requested") else ""
        return f"Eligible for {f['can_offer']}{asked}{why}."
    if decision == "REJECTED":
        why = f.get("reason") or "; ".join(f.get("failed") or [])
        return f"Not eligible, as {why[0].lower() + why[1:]}." if why else "Not eligible."
    if decision == "REFER":
        why = f.get("reason")
        return f"Referred for review, as {why[0].lower() + why[1:]}." if why else "Referred for a credit review."
    if decision == "DATA_MISSING":
        fix = f.get("to_fix") or []
        return f"Cannot be assessed yet, as {' and '.join(fix)}." if fix else "Cannot be assessed yet."
    return None


def stream(result: dict[str, Any], language: str = "en"):
    """("delta", words) as the model writes, then ("final", text | None) -- the CHECKED sentence, or None when the
    model is down or its text failed `accepted` (the screen then withdraws what it showed). A cached answer comes as
    one delta + final at once."""
    if not enabled():
        yield ("final", None)
        return
    spec = _spec()
    messages, key = _messages(result, language)
    hit = _cached(key)
    if hit:
        yield ("delta", hit)
        yield ("final", hit)
        return
    parts: list[str] = []
    try:
        for delta in _stream_call(messages, int(_setting("num_predict")), float(_setting("timeout_seconds")),
                                  int(_setting("sentences"))):
            parts.append(delta)
            yield ("delta", delta)
    except Exception as exc:  # noqa: BLE001 - model slow / down: the same remark built from the facts
        logger.info("eligibility explanation unavailable (%s): built from the facts", type(exc).__name__)
        yield ("final", fallback(result))
        return
    text = _tidy(_whole_sentences("".join(parts)))
    if not accepted(result, text):
        logger.info("eligibility explanation rejected for decision %s: built from the facts", result.get("decision"))
        yield ("final", fallback(result))
        return
    _keep(key, text)
    yield ("final", text)


def explain(result: dict[str, Any], language: str = "en") -> str | None:
    """One or two sentences for the officer, or None (off / model unavailable / did not pass `accepted`)."""
    final = None
    for kind, value in stream(result, language):
        if kind == "final":
            final = value
    return final


def warm() -> None:
    """Load the model and its copy of the (fixed) instructions before the first officer asks: the first summary then
    pays only for its own facts. Best effort -- a down model is simply not warmed."""
    if not enabled():
        return
    try:
        messages, _ = _messages({"decision": "APPROVED"}, "en")
        _call(messages, 1, 120.0)
        logger.info("eligibility explanation model warmed")
    except Exception as exc:  # noqa: BLE001
        logger.info("eligibility explanation model not warmed (%s)", type(exc).__name__)


__all__ = ["accepted", "enabled", "explain", "facts", "fallback", "stream", "warm"]


# EVERY SUMMARY RETURNED AS NUMBERED POINTS (2026-11-02; shared/core/summary_points.py, config summary_format.yaml):
# how it is made and checked above is unchanged -- only what is returned
from shared.core import summary_points as _points  # noqa: E402

explain = _points.as_text(explain)
fallback = _points.as_text(fallback)
stream = _points.final_event(stream)
