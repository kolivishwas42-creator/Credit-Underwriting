"""
THE FINAL RESPONSE of POST /api/v1/eligibility/check (2026-10-13) -- the engine's result, presented. Deterministic:
every sentence is a config template (eligibility_config.yaml `response`) filled with the result's own figures; nothing
is decided or computed here beyond reading the result.

    case_id, run_id, decision, summary,
    loan        {product, requested, eligible, emi, tenure_months, rate_percent}
    ratios      {foir: {on_requested, on_eligible, limit}, ltv: {...} -- secured products only}
    limiting_factor, rules [{rule, label, result, value, limit}], next_steps [...], reasons [...], missing_fields
Empty fields are left out.
"""

from __future__ import annotations

from typing import Any

from agents.eligibility import config
from agents.eligibility.calc.finance import money as _money


def _spec() -> dict[str, Any]:
    return dict(config.document().get("response") or {})


def _say(template: str, **values: Any) -> str:
    try:
        return str(template).format(**values)
    except (KeyError, IndexError, ValueError):
        return str(template)


def _rule(r: dict[str, Any]) -> dict[str, Any]:
    """One rule, readable: {rule, label, result: pass / fail / missing / not_applicable, value, limit}."""
    labels = _spec().get("labels") or {}
    code = r.get("rule_code")
    passed, value, limit = r.get("passed"), r.get("actual_value"), r.get("threshold")
    out: dict[str, Any] = {"rule": code, "label": labels.get(code, code)}
    if passed is None:
        return {**out, "result": "not_applicable" if limit is None else "missing"}
    if code == "DPD" and isinstance(value, dict):                   # DPD: the worst delay; accounts in `detail`
        detail = {k: value.get(k) for k in ("write_offs", "settlements")}
        value, limit = value.get("max_dpd_12m"), (limit or {}).get("max_dpd_12m") if isinstance(limit, dict) else limit
        return {**out, "result": "pass" if passed else "fail", "value": value, "limit": limit, "detail": detail}
    if isinstance(value, dict):                                     # AGE: today's age (maturity is in the limit)
        value = value.get("age")
    if isinstance(limit, dict):
        limit = f"{limit.get('min')}-{limit.get('max')}, max {limit.get('max_at_maturity')} at maturity"
    return {**out, "result": "pass" if passed else "fail", "value": value, "limit": limit}


def _failed(r: dict[str, Any], spec: dict[str, Any]) -> str:
    """A failed rule in words: config `response.failed` templates, with rupees and age at maturity filled in."""
    code, value, limit = r.get("rule_code"), r.get("actual_value"), r.get("threshold")
    values = {"value": value, "limit": limit}
    if code == "AGE" and isinstance(value, dict) and isinstance(limit, dict):          # AGE
        values = {"age": value.get("age"), "at_maturity": value.get("at_maturity"), "min": limit.get("min"),
                  "max": limit.get("max"), "max_at_maturity": limit.get("max_at_maturity")}
        code = "AGE_MATURITY" if limit.get("min") <= value.get("age") <= limit.get("max") else "AGE"
    elif code == "INCOME":
        values = {"value": _money(value), "limit": _money(limit)}
    elif code == "DPD" and isinstance(value, dict) and isinstance(limit, dict):
        values = {"dpd": value.get("max_dpd_12m"), "limit": limit.get("max_dpd_12m"),
                  "refer_upto": limit.get("refer_upto"), "write_offs": value.get("write_offs"),
                  "settlements": value.get("settlements")}
        if (value.get("write_offs") or 0) or (value.get("settlements") or 0):
            code = "DPD_ACCOUNTS"
    template = (spec.get("failed") or {}).get(code) or "{value} (limit {limit})"
    return _say(template, **values)


def _ratio(result: dict[str, Any], code: str, key: str) -> dict[str, Any] | None:
    rule = next((r for r in result.get("rules") or [] if r.get("rule_code") == code), None)
    if not rule or rule.get("threshold") is None:
        return None
    out = {"on_requested": rule.get("actual_value"), "on_eligible": (result.get(key) or {}).get("value_pct"),
           "limit": rule.get("threshold")}
    return {k: v for k, v in out.items() if v is not None} or None


def _plain_missing(missing: list[str]) -> list[str]:
    from agents.eligibility.output.summary import _missing_words

    return _missing_words(missing) or []


def _working(ratios: dict[str, Any], result: dict[str, Any], inputs: dict[str, Any], requested: Any, eligible: Any,
             emi: Any) -> None:
    """THE FIGURES BEHIND EACH RATIO (owner 2026-10-15: "numbers ke neeche formula ke saath calculation"): the screen
    shows FOIR = (existing EMIs + EMI) / income and LTV = (loan + loans already on it) / property value with these.
    The same numbers the engine used -- recomputed here only for the EMI on the requested amount."""
    from agents.eligibility.calc.finance import emi as _emi

    income, existing = inputs.get("monthly_income"), inputs.get("monthly_obligations")
    rate, months = inputs.get("interest_rate_pct"), inputs.get("tenure_months")
    if "foir" in ratios and income:
        emi_req = None
        if requested and rate is not None and months:
            try:
                emi_req = round(_emi(float(requested), float(rate), int(months)), 2)
            except (TypeError, ValueError):
                emi_req = None
        ratios["foir"]["working"] = {k: v for k, v in {
            "income": income, "existing_emi": existing or 0.0, "emi_on_requested": emi_req,
            "emi_on_eligible": emi, "requested": requested, "eligible": eligible}.items() if v is not None}
    value = inputs.get("property_value")
    if "ltv" in ratios and value:
        ratios["ltv"]["working"] = {k: v for k, v in {
            "property_value": value, "existing_on_property": (result.get("exposure") or {}).get("existing", 0.0),
            "requested": requested, "eligible": eligible}.items() if v is not None}


def build(result: dict[str, Any], run_id: str | None) -> dict[str, Any]:
    """The final response for an engine result (EligibilityResult.to_dict())."""
    spec = _spec()
    decision = str(result.get("decision") or "")
    inputs = result.get("inputs") or {}
    requested, eligible, emi = result.get("requested_amount"), result.get("eligible_amount"), result.get("emi")
    limit = result.get("limiting_factor")
    rules = [_rule(r) for r in result.get("rules") or []]
    missing = list(result.get("missing_fields") or [])
    words = (spec.get("limit_words") or {})
    # LESS THAN ASKED: the summary states the ROUNDED amount to give and its EMI (owner 2026-10-14: "summary me bhi
    # rounded amount"), the same figures as `final` -- never two different amounts in one answer
    rec = result.get("recommendation") or {}
    shown, shown_emi = rec.get("amount", eligible), rec.get("emi", emi)
    values = {"requested": _money(requested), "eligible": _money(shown), "emi": _money(shown_emi),
              "tenure": inputs.get("tenure_months"), "limit": words.get(limit, limit),
              "gap": _money((requested or 0) - (shown or 0)) if requested and shown is not None else "-",
              # the same plain words the AI summary uses ("tenure of 240 months is outside the allowed 12-180
              # months", never "tenure months (allowed 12-180, given 240)" -- 2026-10-15)
              "fields": ", ".join(_plain_missing(missing)) or "-",
              # only the KNOCK-OUTS reject on their own; FOIR / LTV size the loan and are worded by their own summary
              "failed": "; ".join(_failed(r, spec) for r in result.get("rules") or []
                                  if r.get("passed") is False and r.get("knock_out")) or "-",
              "score": next((r.get("value") for r in rules if r["rule"] == "SCORE"), "-"),
              "failed_min": (result.get("reasons") or ["-"])[-1].rstrip(".")}
    key = decision
    if decision == "REFER" and result.get("refer_reason") == "DPD":
        key = "REFER_DPD"
        values["dpd"] = next((r.get("value") for r in rules if r["rule"] == "DPD"), "-")
    elif decision == "CONDITIONAL" and limit:
        key = f"CONDITIONAL_{limit}"
    elif decision == "REJECTED" and eligible == 0 and limit in ("FOIR", "LTV", "TOPUP"):
        key = {"FOIR": "REJECTED_NOTHING_AFFORDABLE", "LTV": "REJECTED_NO_LTV_ROOM", "TOPUP": "REJECTED_NO_TOPUP"}[limit]
    elif decision == "REJECTED" and not values["failed"].strip("-") and eligible:
        key = "REJECTED_BELOW_MIN"                  # no rule failed: the amount is below the product minimum
    summaries, steps = spec.get("summary") or {}, spec.get("next_steps") or {}
    summary = _say(summaries.get(key) or summaries.get(decision) or "", **values)
    templates = list(steps.get(key) or steps.get(decision) or [])
    if result.get("recommendation"):
        # the recommendation states the amount to give: a step offering the unrounded eligible amount would
        # contradict it, so only the steps that do not restate it are kept
        templates = [t for t in templates if "{eligible}" not in t]
    if result.get("what_it_takes"):
        # the exact levers are listed in `what_it_takes`: the generic "bridge the gap" step would repeat them vaguely
        templates = [t for t in templates if "{gap}" not in t]
    next_steps = [_say(s, **values) for s in templates]
    ratios = {k: v for k, v in (("foir", _ratio(result, "FOIR", "foir")), ("ltv", _ratio(result, "LTV", "ltv"))) if v}
    _working(ratios, result, inputs, requested, eligible, emi)
    loan = {"product": result.get("product"), "requested": requested, "eligible": eligible, "emi": emi,
            "tenure_months": inputs.get("tenure_months"), "rate_percent": inputs.get("interest_rate_pct")}
    recommendation = result.get("recommendation")
    if recommendation:
        # LESS THAN ASKED: the bucket recommendation leads the next steps (config response.recommendation)
        lead = [_say(spec.get("recommendation") or "", amount=_money(recommendation.get("amount")),
                     bucket=recommendation.get("bucket") or "-", emi=_money(recommendation.get("emi")),
                     tenure=inputs.get("tenure_months"))]
        longer = recommendation.get("longer_tenure")
        if longer:
            lead.append(_say(spec.get("longer_tenure") or "", months=longer.get("tenure_months"),
                             eligible=_money(longer.get("eligible")), bucket=longer.get("bucket") or "-",
                             emi=_money(longer.get("emi")),
                             covers=spec.get("covers_request", "") if longer.get("covers_request") else ""))
        next_steps = [s for s in lead if s] + next_steps
    # THE FINAL RESULT, in one place (owner 2026-10-14: "response clean showing the final result")
    final = {"decision": decision,
             "amount": (recommendation or {}).get("amount", eligible) if decision in ("APPROVED", "CONDITIONAL",
                                                                                       "REFER") else None,
             "emi": (recommendation or {}).get("emi", emi) if decision in ("APPROVED", "CONDITIONAL", "REFER") else None,
             "tenure_months": inputs.get("tenure_months"), "bucket": (recommendation or {}).get("bucket")}
    if final.get("amount") is None:
        final = {"decision": decision}                      # no amount to give: the tenure means nothing alone
    elif not final.get("bucket"):
        # THE FULL AMOUNT HAS A BUCKET TOO (owner 2026-10-15: "recommend me bucket nahi aa raha"): the ticket range the
        # offer falls in -- the same rule as a reduced offer (offer.offer_range), never a new one
        try:
            from agents.eligibility import config as _cfg
            from agents.eligibility.calc.offer import offer_range as _range

            final["bucket"] = _range(float(final["amount"]), _cfg.product(result.get("product")) or {})["label"]
        except Exception:  # noqa: BLE001 - a label only; the decision and amount stand without it
            pass
    out = {"case_id": result.get("case_id"), "run_id": run_id, "decision": decision, "summary": summary or None,
           "final": {k: v for k, v in final.items() if v is not None},
           "loan": {k: v for k, v in loan.items() if v is not None} or None, "ratios": ratios or None,
           "limiting_factor": limit, "recommendation": recommendation or None,
           "income": _income_block(result.get("income")), "topup": _topup_block(result.get("topup"), spec),
           "exposure": result.get("exposure") or None,
           "what_it_takes": _takes(result, spec, inputs) or None,
           "rules": rules, "next_steps": next_steps or None,
           "reasons": result.get("reasons") or [], "missing_fields": missing or None}
    return {k: v for k, v in out.items() if v is not None}


def _short(value: Any) -> str:
    from agents.eligibility.calc.finance import short as _engine_short

    return _engine_short(float(value or 0))


def _takes(result: dict[str, Any], spec: dict[str, Any], inputs: dict[str, Any]) -> list[str]:
    """`what_it_takes` in words (config response.what_it_takes): one line per lever."""
    lines = []
    texts = spec.get("what_it_takes") or {}
    words = spec.get("limit_words") or {}
    requested = result.get("requested_amount")
    for lever in result.get("what_it_takes") or []:
        template = texts.get(lever.get("lever"))
        if not template:
            continue
        outcome = _say(spec.get("what_it_takes_full") or "", requested=_money(requested)) if lever.get("full") else \
            _say(spec.get("what_it_takes_partial") or "", gives=_money(lever.get("gives")),
                 then=words.get(lever.get("then"), lever.get("then") or "another limit"))
        value = lever.get("value")
        shown = value if lever.get("lever") == "LONGER_TENURE" else _money(value)
        lines.append(_say(template, value=shown, outcome=outcome, tenure=inputs.get("tenure_months"),
                          gives_short=_money((requested or 0) - (value or 0)),
                          product=str(result.get("product") or "").replace("_", " ").title()))
    return lines


def compact(full: dict[str, Any]) -> dict[str, Any]:
    """THE DEFAULT RESPONSE (owner 2026-10-14: clean, mid-short): every figure once. The full shape is
    `detail: true` on the request, and is always saved in the run (GET /eligibility/runs/{run_id})."""
    final = full.get("final") or {}
    offer = None
    if final.get("amount") is not None:
        offer = {"amount": final.get("amount"), "range": final.get("bucket"), "emi": final.get("emi"),
                 "tenure_months": final.get("tenure_months"),
                 "rate_percent": (full.get("loan") or {}).get("rate_percent")}
        offer = {k: v for k, v in offer.items() if v is not None}
    checks = [{k: r.get(k) for k in ("label", "result", "value", "limit") if r.get(k) is not None}
              for r in full.get("rules") or []]
    working = {}
    income = full.get("income") or {}
    if income.get("monthly_income") is not None:
        yearly = f"₹{_short(income['annual_income'])}/year → " if income.get("annual_income") is not None else ""
        working["income"] = f"{str(income.get('method') or '').replace('_', ' ').title()}: {yearly}" \
                            f"₹{_money(income['monthly_income'])}/month"
    topup = full.get("topup") or {}
    if topup.get("type"):
        working["topup"] = f"{topup.get('label') or topup['type']}: {topup.get('applicable_pct', 0):g}% → " \
                           f"₹{_money(topup.get('eligible_topup'))}"
    exposure = full.get("exposure") or {}
    if exposure.get("limit_pct") is not None:
        already = f"; ₹{_money(exposure['existing'])} already lent on it" if exposure.get("existing") else ""
        working["property"] = f"LTV limit {exposure['limit_pct']:g}% ({exposure.get('limit_basis')}){already}"
    out = {"case_id": full.get("case_id"), "run_id": full.get("run_id"), "decision": full.get("decision"),
           "summary": full.get("summary"), "offer": offer, "checks": checks,
           "what_it_takes": full.get("what_it_takes"), "next_steps": full.get("next_steps"),
           "working": working or None, "missing_fields": full.get("missing_fields"),
           "explanation": full.get("explanation")}
    return {k: v for k, v in out.items() if v not in (None, [], {})}


def _income_block(calc: dict[str, Any] | None) -> dict[str, Any] | None:
    """The income working as the officer entered it: method, monthly (and annual) income, lines, notes."""
    if not calc:
        return None
    keep = ("method", "monthly_income", "annual_income", "lines", "notes", "missing")
    return {k: calc[k] for k in keep if calc.get(k) not in (None, [], "")} or None


def _topup_block(calc: dict[str, Any] | None, spec: dict[str, Any]) -> dict[str, Any] | None:
    if not calc:
        return None
    out = {k: v for k, v in calc.items() if v not in (None, [], "")}
    label = (spec.get("topup_labels") or {}).get(str(calc.get("type")))
    if label:
        out["label"] = label
    return out


__all__ = ["build", "compact"]
