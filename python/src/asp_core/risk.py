"""The Market's risk model (docs/institutions/market.md 13.1; register rows DK1455 and DK43; spec-delta S1404): the bond and escrow the Market SUGGESTS for a job.

Pure and integer-only (permille), the same arithmetic as packages/asp-log/src/market-risk.ts and held to conformance/vectors/risk.json. Never binding: it moves how much is suggested to be locked,
never a tier, a rank or a standing.
"""
from __future__ import annotations

from typing import Any

RISK_MODEL = "asp-risk-model/1"
CLASSES = ("trivial", "routine", "skilled", "critical")
VERIFICATIONS = ("deterministic", "principal", "arbiter")

ZERO_TERMS: dict[str, Any] = {
    "class_permille": {c: 0 for c in CLASSES},
    "verification_permille": {v: 0 for v in VERIFICATIONS},
    "poster_permille": 0,
    "escrow_share_permille": 1000,
}


def _ceil_div(a: int, b: int) -> int:
    return -(-a // b)


def _round_half_up(a: int, b: int) -> int:
    """round(a / b) for non-negative a, b > 0, halves up (the same as JavaScript's Math.round on these values)."""
    return (2 * a + b) // (2 * b)


def suggest_risk(terms: dict[str, Any] | None, inp: dict[str, Any]) -> dict[str, Any]:
    t = terms or ZERO_TERMS
    lost = max(0, min(1000, inp["posterLostPermille"]))
    parts = {
        "floor": inp["floorPermille"],
        "class": t["class_permille"][inp["jobClass"]],
        "verification": t["verification_permille"][inp["verification"]],
        "poster": _round_half_up(lost * t["poster_permille"], 1000),
    }
    bond_permille = max(0, min(1000, parts["floor"] + parts["class"] + parts["verification"] + parts["poster"]))
    return {
        "bondPermille": bond_permille,
        "bond": _ceil_div(inp["price"] * bond_permille, 1000),
        "escrow": _ceil_div(inp["price"] * t["escrow_share_permille"], 1000),
        "parts": parts,
    }


def only_removes_rule(prev: dict[str, Any], nxt: dict[str, Any]) -> bool:
    return (
        all(nxt["class_permille"][c] <= prev["class_permille"][c] for c in CLASSES)
        and all(nxt["verification_permille"][v] <= prev["verification_permille"][v] for v in VERIFICATIONS)
        and nxt["poster_permille"] <= prev["poster_permille"]
        and nxt["escrow_share_permille"] >= prev["escrow_share_permille"]
    )
