"""
RULE SETTINGS API (owner 2026-11-12: "rules config hona chahiye: on/off, disable, add").

    GET   /api/v1/rule-settings                         the rule sets that can be changed here
    GET   /api/v1/rule-settings/{name}                  its rules: id, name, on/off, locked, the numbers they use,
                                                        the templates a new rule can be made from, recent changes
    PATCH /api/v1/rule-settings/{name}/rules/{rule_id}  turn a rule on / off, change its numbers
    POST  /api/v1/rule-settings/{name}/rules            add a rule from a template (Dedupe, Customer history)

Every change is a NEW VERSION of that rule set in the versioned rule store (shared/db/rule_store.py): the set's own
validator checks the whole set first (a wrong value never reaches an agent), the version is put in force, and who /
when / what is recorded in rule_set_changes. Where each set keeps its rules: shared/config/rule_settings.yaml.
"""

from __future__ import annotations

import copy
import importlib
import logging
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from shared.db import rule_store
from shared.security.auth import get_scopes, get_subject, require_jwt

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / "shared" / "config" / "rule_settings.yaml"


@lru_cache(maxsize=1)
def settings() -> dict[str, Any]:
    return yaml.safe_load(CONFIG.read_text(encoding="utf-8")) or {}


def _set_spec(name: str) -> tuple[str, dict[str, Any]]:
    """(base set name, its settings) for a set or a family member (docs_policy:<file>)."""
    base = name.split(rule_store.FAMILY_SEPARATOR, 1)[0]
    spec = (settings().get("sets") or {}).get(base)
    if not spec or (spec.get("family") and rule_store.FAMILY_SEPARATOR not in name):
        raise HTTPException(404, detail={"code": "RULE_SET_NOT_EDITABLE", "message": f"{name} has no rule settings"})
    return base, spec


# ------------------------------------------------------------------------------------------------ reading a path
def _get(obj: Any, path: str) -> Any:
    for part in path.split("."):
        if not isinstance(obj, dict) or part not in obj:
            return None
        obj = obj[part]
    return obj


def _set(obj: dict[str, Any], path: str, value: Any) -> None:
    parts = path.split(".")
    for part in parts[:-1]:
        obj = obj.setdefault(part, {})
    obj[parts[-1]] = value


def _number(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


@lru_cache(maxsize=16)
def _names_file(rel: str) -> dict[str, Any]:
    p = ROOT / rel
    return yaml.safe_load(p.read_text(encoding="utf-8")) or {} if p.exists() else {}


def _name(spec: dict[str, Any], rule_id: str, item: Any) -> str:
    names = spec.get("names")
    if names and isinstance(names.get("map"), dict) and names["map"].get(rule_id):
        return str(names["map"][rule_id])
    if names and names.get("file"):
        found = _get(_names_file(str(names["file"])), str(names["path"]).replace("{id}", rule_id))
        if isinstance(found, str) and found:
            return found
    field = spec.get("name_field")
    if field and isinstance(item, dict) and item.get(field):
        return str(item[field])
    return rule_id


# ------------------------------------------------------------------------------------------------ the rules of a set
def _rules(spec: dict[str, Any], content: dict[str, Any]) -> list[dict[str, Any]]:
    kind, path, locked = spec["kind"], spec["path"], set(spec.get("locked") or [])
    out: list[dict[str, Any]] = []

    def params_of(rule_id: str, item: Any) -> dict[str, float]:
        found: dict[str, float] = {}
        for p in (spec.get("params") or {}).get(rule_id) or []:
            v = _get(content, p)
            if _number(v):
                found[p.split(".")[-1]] = v
        for f in spec.get("params_in_rule") or []:
            if isinstance(item, dict) and _number(item.get(f)):
                found[f] = item[f]
        return found

    if kind == "list":
        for item in _get(content, path) or []:
            rid = str(item.get(spec["id"]))
            out.append({"id": rid, "enabled": item.get("enabled", True) is not False, "item": item})
    elif kind == "map":
        node = _get(content, path) or {}
        # `ids` in the settings: the rules of this map even when the version in force has no entry for them yet (on)
        ids = [str(i) for i in spec.get("ids") or []] + [str(k) for k in node if str(k) not in set(map(str, spec.get("ids") or []))]
        for rid in ids:
            item = node.get(rid) or {}
            out.append({"id": rid, "enabled": item.get("enabled", True) is not False, "item": item})
    elif kind == "bool_map":
        for rid, value in (_get(content, path) or {}).items():
            out.append({"id": str(rid), "enabled": value is not False, "item": None})
    elif kind == "membership":
        on = set(_get(content, path) or [])
        for rid in _get(content, spec["universe"]) or []:
            out.append({"id": str(rid), "enabled": rid in on, "item": None})
    else:
        raise ValueError(f"unknown rule settings kind {kind!r}")
    return [{"id": r["id"], "name": _name(spec, r["id"], r["item"]), "enabled": r["enabled"], "locked": r["id"] in locked,
             "params": params_of(r["id"], r["item"]),
             "severity": (r["item"] or {}).get("severity") if isinstance(r["item"], dict) else None}
            for r in out]


def _templates(spec: dict[str, Any]) -> dict[str, Any]:
    out = {}
    for tid, t in (spec.get("templates") or {}).items():
        signals: list[str] = []
        if t.get("signals_from"):
            module, attr = str(t["signals_from"]).split(":")
            signals = sorted(getattr(importlib.import_module(module), attr))
        out[tid] = {"title": t.get("title", tid), "fields": t.get("fields") or [], "signals": signals,
                    "operators": t.get("operators") or [], "severities": t.get("severities") or []}
    return out


def _content(name: str) -> dict[str, Any]:
    try:
        return copy.deepcopy(rule_store.load(name))
    except rule_store.RulesUnavailable as exc:
        raise HTTPException(503, detail={"code": "RULES_UNAVAILABLE", "message": str(exc)}) from None


def _save(name: str, content: dict[str, Any], who: str, note: str) -> str:
    try:
        return rule_store.import_version(name, content, by=who, note=note, activate=True)
    except rule_store.RulesInvalid as exc:
        raise HTTPException(422, detail={"code": "RULES_INVALID", "message": str(exc)}) from None
    except (ValueError, TypeError) as exc:                  # a validator's own error type
        raise HTTPException(422, detail={"code": "RULES_INVALID", "message": str(exc)}) from None
    except rule_store.RulesUnavailable as exc:
        raise HTTPException(503, detail={"code": "RULES_UNAVAILABLE", "message": str(exc)}) from None


def _writer(claims: dict[str, Any] = Depends(require_jwt)) -> dict[str, Any]:
    scope = str(settings().get("write_scope") or "los.rules.write")
    if scope not in get_scopes(claims):
        raise HTTPException(403, detail={"code": "FORBIDDEN", "message": f"Changing rules needs the {scope} scope"})
    return claims


def _who(claims: dict[str, Any]) -> str:
    return str(get_subject(claims) or "unknown")


# ------------------------------------------------------------------------------------------------ the API
router = APIRouter(prefix="/api/v1/rule-settings", tags=["Rule settings"])


class RuleChange(BaseModel):
    enabled: bool | None = None
    params: dict[str, float] | None = None
    note: str | None = Field(None, max_length=500)


class NewRule(BaseModel):
    template: str
    values: dict[str, Any]
    note: str | None = Field(None, max_length=500)


@router.get("", summary="The rule sets whose rules can be changed here")
def list_sets(claims: dict[str, Any] = Depends(require_jwt)) -> list[dict[str, Any]]:
    out = []
    for base, spec in (settings().get("sets") or {}).items():
        if base not in rule_store.names():
            continue
        members = ([m for m in rule_store.load_family(base)] if spec.get("family") else [base])
        for m in members:
            out.append({"name": m, "agent": spec.get("agent"), "title": spec.get("title", base),
                        "member": m.split(rule_store.FAMILY_SEPARATOR, 1)[1] if rule_store.FAMILY_SEPARATOR in m else None})
    return out


@router.get("/{name}", summary="The rules of one rule set: on / off, locked, their numbers, templates, recent changes")
def read_set(name: str, claims: dict[str, Any] = Depends(require_jwt)) -> dict[str, Any]:
    base, spec = _set_spec(name)
    content = _content(name)
    try:
        changes = rule_store.history(name)[-10:]
    except Exception:  # noqa: BLE001 - the history is a convenience
        changes = []
    return {"name": name, "title": spec.get("title", base), "agent": spec.get("agent"),
            "on_label": spec.get("on_label"), "rules": _rules(spec, content), "templates": _templates(spec),
            "changes": [{**c, "changed_at": str(c.get("changed_at"))} for c in reversed(changes)]}


@router.patch("/{name}/rules/{rule_id}", summary="Turn a rule on / off or change its numbers (a new version, recorded)")
def change_rule(name: str, rule_id: str, body: RuleChange, claims: dict[str, Any] = Depends(_writer)) -> dict[str, Any]:
    base, spec = _set_spec(name)
    content = _content(name)
    current = {r["id"]: r for r in _rules(spec, content)}
    if rule_id not in current:
        raise HTTPException(404, detail={"code": "RULE_NOT_FOUND", "message": f"{rule_id} is not a rule of {name}"})
    if body.enabled is False and current[rule_id]["locked"]:
        raise HTTPException(409, detail={"code": "RULE_LOCKED", "message": f"{rule_id} is always on"})
    kind, path, said = spec["kind"], spec["path"], []

    if body.enabled is not None and body.enabled != current[rule_id]["enabled"]:
        if kind == "list":
            for item in _get(content, path):
                if str(item.get(spec["id"])) == rule_id:
                    item["enabled"] = body.enabled
        elif kind == "map":
            node = _get(content, path)
            if not isinstance(node, dict):            # the version in force predates this map: it starts here
                node = {}
                _set(content, path, node)
            node[rule_id] = {**(node.get(rule_id) or {}), "enabled": body.enabled}
        elif kind == "bool_map":
            _get(content, path)[rule_id] = body.enabled
        elif kind == "membership":
            members = [m for m in (_get(content, path) or []) if m != rule_id]
            if body.enabled:                       # keep the universe's order
                members = [m for m in _get(content, spec["universe"]) if m in set(members) | {rule_id}]
            _set(content, path, members)
        said.append(f"{rule_id} {'on' if body.enabled else 'off'}")

    for key, value in (body.params or {}).items():
        if key not in current[rule_id]["params"]:
            raise HTTPException(422, detail={"code": "PARAM_NOT_EDITABLE", "message": f"{rule_id} has no number {key!r}"})
        done = False
        for p in (spec.get("params") or {}).get(rule_id) or []:
            if p.split(".")[-1] == key:
                _set(content, p, value)
                done = True
        if not done and key in (spec.get("params_in_rule") or []) and kind == "list":
            for item in _get(content, path):
                if str(item.get(spec["id"])) == rule_id:
                    item[key] = value
        said.append(f"{rule_id}.{key} = {value}")

    if not said:
        return {"changed": False, "rules": _rules(spec, content)}
    who = _who(claims)
    digest = _save(name, content, who, body.note or f"Rule settings: {', '.join(said)}")
    logger.info("rule settings: %s changed %s (%s) -> %s", who, name, "; ".join(said), digest[:12])
    return {"changed": True, "version": digest, "rules": _rules(spec, _content(name))}


_ID = re.compile(r"^[A-Z][A-Z0-9_]{2,60}$")


@router.post("/{name}/rules", summary="Add a rule from a template (where rules are data: Dedupe, Customer history)")
def add_rule(name: str, body: NewRule, claims: dict[str, Any] = Depends(_writer)) -> dict[str, Any]:
    base, spec = _set_spec(name)
    template = (spec.get("templates") or {}).get(body.template)
    if not template or spec["kind"] != "list":
        raise HTTPException(422, detail={"code": "NO_SUCH_TEMPLATE", "message": f"{name} has no template {body.template!r}"})
    shown = _templates(spec)[body.template]
    v = {k: body.values.get(k) for k in template.get("fields") or []}
    rid = str(v.get("rule_id") or "").strip().upper()
    problems = []
    if not _ID.match(rid):
        problems.append("rule_id: capital letters, digits and _ (e.g. P20_HIGH_EMI)")
    if shown["signals"] and v.get("signal") not in shown["signals"]:
        problems.append("signal: choose one of the listed signals")
    if shown["operators"] and v.get("operator") not in shown["operators"]:
        problems.append("operator: choose one of " + ", ".join(shown["operators"]))
    if shown["severities"] and v.get("severity") not in shown["severities"]:
        problems.append("severity: choose one of " + ", ".join(shown["severities"]))
    for need in ("description", "recommendation", "reason_code", "next_action"):
        if need in v and not str(v.get(need) or "").strip():
            problems.append(f"{need}: required")
    content = _content(name)
    rules = _get(content, spec["path"])
    if any(str(r.get(spec["id"])) == rid for r in rules or []):
        problems.append(f"rule_id: {rid} already exists")
    if problems:
        raise HTTPException(422, detail={"code": "INVALID_RULE", "message": "; ".join(problems)})
    new = {**(template.get("defaults") or {}), spec["id"]: rid}
    for k, value in v.items():
        if k == "rule_id":
            continue
        if k == "signal":
            new["inputs"] = [value]
        else:
            new[k] = value.strip() if isinstance(value, str) else value
    new["enabled"] = True
    rules.append(new)
    who = _who(claims)
    digest = _save(name, content, who, body.note or f"Rule settings: added {rid} ({body.template})")
    logger.info("rule settings: %s added %s to %s -> %s", who, rid, name, digest[:12])
    return {"added": rid, "version": digest, "rules": _rules(spec, _content(name))}


__all__ = ["router", "settings"]
