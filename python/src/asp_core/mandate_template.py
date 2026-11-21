"""The Mandate template of a fleet or a persona (register row DK1355; spec-delta S1408).

Pure and integer-only: the same rules as packages/asp-core/src/mandate-template.ts, held to conformance/vectors/mandate-template.json. A Mandate here is the body of an `asp.mandate/v0.2` record without its contract.
"""
from __future__ import annotations

from datetime import datetime
import re
from typing import Any

IRREVERSIBLE_STRICTNESS = {"allow": 0, "checkpoint": 1, "forbid": 2}
SELF_MODIFICATION_LOOSENESS = {"forbidden": 0, "principal_approves": 1, "sponsor_approves": 2, "mentor_approves": 3, "automatic_audited": 4}


def _num(x: Any) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def _ts(s: str) -> float:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def scope_covered(ceiling: list[str], scope: str) -> bool:
    return any(c == scope or (c.endswith(".*") and scope.startswith(c[:-1])) for c in ceiling)


def mandate_violations(ceiling: dict[str, Any], m: dict[str, Any]) -> list[str]:
    out: list[str] = []
    has = lambda x: x is not None  # noqa: E731
    if has(ceiling.get("scopes")) and not all(scope_covered(ceiling["scopes"], s) for s in (m.get("scopes") or [])):
        out.append("scopes")
    if has(ceiling.get("forbidden_means")) and not all(f in (m.get("forbidden_means") or []) for f in ceiling["forbidden_means"]):
        out.append("forbidden_means")
    if has(ceiling.get("spend")):
        c, s = ceiling["spend"], (m.get("spend") or {})
        if not (_num(s.get("cap")) and s["cap"] <= c["cap"]) or (has(c.get("per_action_max")) and not (_num(s.get("per_action_max")) and s["per_action_max"] <= c["per_action_max"])):
            out.append("spend")
    if has(ceiling.get("irreversible")) and IRREVERSIBLE_STRICTNESS.get((m.get("irreversible") or {}).get("policy"), -1) < IRREVERSIBLE_STRICTNESS[ceiling["irreversible"]["policy"]]:
        out.append("irreversible")
    if has(ceiling.get("subcontract")):
        c, s = ceiling["subcontract"], (m.get("subcontract") or {})
        if (s.get("allowed") and not c.get("allowed")) or (has(c.get("max_depth")) and s.get("allowed") and not (_num(s.get("max_depth")) and s["max_depth"] <= c["max_depth"])):
            out.append("subcontract")
    if has(ceiling.get("nodes")) and not (_num((m.get("nodes") or {}).get("max_parallel")) and m["nodes"]["max_parallel"] <= ceiling["nodes"]["max_parallel"]):
        out.append("nodes")
    if has(ceiling.get("learning")):
        c, s = ceiling["learning"], (m.get("learning") or {})
        allowed = c.get("private_scopes") if isinstance(c.get("private_scopes"), list) else []
        mine = s.get("private_scopes") if isinstance(s.get("private_scopes"), list) else []
        widened = any(n not in allowed for n in mine)
        if (s.get("share_to_commons") and not c.get("share_to_commons")) or s.get("scope") != c.get("scope") or widened:
            out.append("learning")
    if has(ceiling.get("self_modification")) and not (SELF_MODIFICATION_LOOSENESS.get(m.get("self_modification"), 99) <= SELF_MODIFICATION_LOOSENESS[ceiling["self_modification"]]):
        out.append("self_modification")
    if has(ceiling.get("checkpoints")) and not all(k in (m.get("checkpoints") or []) for k in ceiling["checkpoints"]):
        out.append("checkpoints")
    if has(ceiling.get("expires")) and not (has(m.get("expires")) and _ts(m["expires"]) <= _ts(ceiling["expires"])):
        out.append("expires")
    if has((ceiling.get("network") or {}).get("hosts")):
        hosts = (m.get("network") or {}).get("hosts") or []
        if not hosts or not all(h in ceiling["network"]["hosts"] for h in hosts):
            out.append("network")
    if has(ceiling.get("token_budget")):
        c = ceiling["token_budget"]
        s = m.get("token_budget") or {}
        for k in ("per_run", "per_month", "per_day"):
            if has(c.get(k)) and not (isinstance(s.get(k), int) and not isinstance(s.get(k), bool) and s[k] <= c[k]):
                out.append("token_budget")
                break
    if has(ceiling.get("loop_limits")):
        c = ceiling["loop_limits"]
        s = m.get("loop_limits") or {}
        for k in ("equivalent_calls", "depth", "near_repeats"):
            if has(c.get(k)) and not (isinstance(s.get(k), int) and not isinstance(s.get(k), bool) and s[k] <= c[k]):
                out.append("loop_limits")
                break
    if has(ceiling.get("institution_spend")):
        lines = m.get("institution_spend") or []
        ok = all(any(c["institution"] == l["institution"] and c["period"] == l["period"] and l["cap"]["value"] <= c["cap"]["value"] for c in ceiling["institution_spend"]) for l in lines)
        if not ok:
            out.append("institution_spend")
    return out


def derive_mandate(template: dict[str, Any], contract: str, narrowing: dict[str, Any] | None = None) -> dict[str, Any]:
    """Returns {"mandate": ...} or {"widens": [...]}: a narrowing that goes beyond the template is refused."""
    base = {**template, "contract": contract}
    if not narrowing:
        return {"mandate": base}
    candidate = {**base, **narrowing, "contract": contract}
    widens = mandate_violations(template, candidate)
    return {"widens": widens} if widens else {"mandate": candidate}


PRIVATE_SCOPE_NAME = re.compile(r"^[a-z0-9_-]{1,64}$")
MAX_PRIVATE_SCOPES = 16


def private_scopes_problem(value: Any) -> str | None:
    """The rule a Mandate's `learning.private_scopes` breaks (`private_scopes_invalid`), or None (register rows D12 and DK272; spec-delta S1593)."""
    if value is None:
        return None
    if not isinstance(value, list) or len(value) > MAX_PRIVATE_SCOPES:
        return "private_scopes_invalid"
    if not all(isinstance(n, str) and PRIVATE_SCOPE_NAME.fullmatch(n) for n in value):
        return "private_scopes_invalid"
    return None if len(set(value)) == len(value) else "private_scopes_invalid"
