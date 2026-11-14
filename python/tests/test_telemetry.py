"""The derived measures of cognition telemetry give the same numbers in Python as in the TypeScript library (shared vectors, register row DK195)."""
from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from asp_core import telemetry as T

CASES = json.loads((Path(__file__).resolve().parents[2] / "conformance" / "vectors" / "telemetry.json").read_text("utf-8"))["cases"]


def same(got, want, exact: bool) -> bool:
    if isinstance(want, dict):
        return got.keys() == want.keys() and all(same(got[k], want[k], exact) for k in want)
    if isinstance(want, list):
        return len(got) == len(want) and all(same(g, w, exact) for g, w in zip(got, want))
    if want is None or isinstance(want, bool) or isinstance(want, str):
        return got == want
    return got == want if exact else math.isclose(got, want, rel_tol=0, abs_tol=1e-9)


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["name"])
def test_measure(case):
    fn = getattr(T, case["fn"])
    got = fn(**case["input"]) if case["fn"] not in ("brier", "mean_surprisal", "calibration") else fn(case["input"]["items"], **{k: v for k, v in case["input"].items() if k != "items"})
    assert same(got, case["expected"], case["exact"]), f"{case['name']}: {got!r} != {case['expected']!r}"


def test_the_vectors_cover_the_four_named_measures():
    assert {c["fn"] for c in CASES} >= {"brier", "surprisal", "kl_bits", "calibration"}
    assert any(c["fn"] == "calibration" and c["expected"]["ece"] is None for c in CASES), "a thin sample withholds ECE"
    assert any(c["fn"] == "calibration" and c["expected"]["ece"] is not None for c in CASES), "a large one reports it"
