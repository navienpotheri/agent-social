"""The derived-measure library for cognition telemetry (docs/institutions/instrumentation.md 5 and 13; register row DK195): Brier, calibration (reliability bins and ECE), surprisal, KL and the normative
posterior, from numbers alone. It mirrors packages/asp-log/src/telemetry.ts and is tested against the shared vectors (conformance/vectors/telemetry.json), so both languages give the same numbers: the
rounded measures (3 decimals, half up, as JavaScript's Math.round) are identical, the unrounded ones agree to 1e-9. No free text enters it; credits and standing never read it."""
from __future__ import annotations

import math
from typing import Sequence, TypedDict

MIN_CALIBRATION_N = 50
"""ECE is withheld under this many resolved items (a calibration figure on a thin sample is noise)."""


class Item(TypedDict):
    p: float
    outcome: int


def round3(x: float) -> float:
    """Three decimals, rounding half up like JavaScript's Math.round (Python's round() is banker's)."""
    return math.floor(x * 1000 + 0.5) / 1000


def _log2(x: float) -> float:
    return math.log(x) / math.log(2)


def brier(items: Sequence[Item]) -> float:
    return round3(sum((i["p"] - i["outcome"]) ** 2 for i in items) / len(items))


def surprisal(p: float, outcome: int) -> float:
    return -_log2(p if outcome == 1 else 1 - p)


def mean_surprisal(items: Sequence[Item]) -> float:
    return round3(sum(surprisal(i["p"], i["outcome"]) for i in items) / len(items))


def kl_bits(post: float, prior: float) -> float:
    def t(a: float, b: float) -> float:
        return 0.0 if a == 0 else a * _log2(a / b)
    return t(post, prior) + t(1 - post, 1 - prior)


def normative_posterior(prior: float, lr: float) -> float:
    odds = (prior / (1 - prior)) * lr
    return odds / (1 + odds)


def calibration(items: Sequence[Item], bins: int = 5) -> dict:
    table = [{"lo": i / bins, "hi": (i + 1) / bins, "n": 0, "mean_p": 0.0, "freq": 0.0} for i in range(bins)]
    for it in items:
        k = min(bins - 1, math.floor(it["p"] * bins))
        table[k]["n"] += 1
        table[k]["mean_p"] += it["p"]
        table[k]["freq"] += it["outcome"]
    for b in table:
        if b["n"]:
            b["mean_p"] = round3(b["mean_p"] / b["n"])
            b["freq"] = round3(b["freq"] / b["n"])
    met = len(items) >= MIN_CALIBRATION_N
    ece = round3(sum((b["n"] / len(items)) * abs(b["mean_p"] - b["freq"]) for b in table)) if met else None
    return {"n": len(items), "bins": table, "brier": brier(items) if items else 0, "ece": ece, "min_n_met": met}
