"""A Merkle root over a set of leaves, and an inclusion proof (register row DK1742; spec-delta S1599). Mirrors
packages/asp-core/src/merkle.ts; the two agree on conformance/vectors/merkle.json. Leaves are SHA-256 of `leaf|<text>`,
inner nodes SHA-256 of `node|<left>|<right>`; leaves are sorted first and an odd node is carried up unchanged."""
from __future__ import annotations

import hashlib


def _sha(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def merkle_leaf(text: str) -> str:
    return _sha(f"leaf|{text}")


def _node(left: str, right: str) -> str:
    return _sha(f"node|{left}|{right}")


EMPTY_ROOT = _sha("empty")


def _levels(leaves: list[str]) -> list[list[str]]:
    level = [merkle_leaf(t) for t in sorted(set(leaves))]
    out = [level]
    while len(level) > 1:
        nxt = []
        for i in range(0, len(level), 2):
            nxt.append(_node(level[i], level[i + 1]) if i + 1 < len(level) else level[i])
        out.append(nxt)
        level = nxt
    return out


def merkle_root(leaves: list[str]) -> str:
    if not leaves:
        return EMPTY_ROOT
    return _levels(leaves)[-1][0]


def merkle_proof(leaves: list[str], text: str) -> list[dict[str, str]] | None:
    ordered = sorted(set(leaves))
    if text not in ordered:
        return None
    i = ordered.index(text)
    proof: list[dict[str, str]] = []
    levels = _levels(leaves)
    for d in range(len(levels) - 1):
        sib = i + 1 if i % 2 == 0 else i - 1
        if sib < len(levels[d]):
            proof.append({"side": "right" if i % 2 == 0 else "left", "hash": levels[d][sib]})
        i //= 2
    return proof


def merkle_verify(root: str, text: str, proof: list[dict[str, str]]) -> bool:
    h = merkle_leaf(text)
    for step in proof:
        h = _node(step["hash"], h) if step["side"] == "left" else _node(h, step["hash"])
    return h == root
