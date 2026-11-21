"""Runs the shared ASP conformance vectors (conformance/vectors/) against the Python SDK."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from asp_core import AspError, Job, Signer, canonicalize, create_record, default_schemas, static_resolver, verify_record

CONF = Path(__file__).resolve().parents[2] / "conformance"


def load(name: str):
    return json.loads((CONF / name).read_text("utf-8"))


KEYS = load("keys.json")["keys"]
RESOLVE = static_resolver({k["kid"]: k["public_key"] for k in KEYS})
SCHEMAS = default_schemas()


def code_of(fn) -> tuple[str | None, str | None]:
    try:
        fn()
        return None, None
    except AspError as e:
        return e.code, e.detail


def cases(file: str, only_ok: bool = False):
    items = load(f"vectors/{file}")["cases"]
    if only_ok:
        items = [c for c in items if c["expect"] == "ok"]
    return [pytest.param(c, id=c["name"]) for c in items]


@pytest.mark.parametrize("case", cases("canonical.json"))
def test_canonical(case):
    value = json.loads(case["input_json"])
    if "error" in case:
        assert code_of(lambda: canonicalize(value))[0] == case["error"]
    else:
        assert canonicalize(value) == case["output"]


@pytest.mark.parametrize("case", cases("schema.json"))
def test_schema(case):
    assert SCHEMAS.is_valid(case["schema"], case["instance"]) == case["valid"]


@pytest.mark.parametrize("case", cases("records.json"))
def test_record(case):
    code, _ = code_of(lambda: verify_record(case["record"], RESOLVE))
    assert code == (None if case["expect"] == "ok" else case["expect"]["error"])


@pytest.mark.parametrize("case", cases("lifecycle.json"))
def test_lifecycle(case):
    job = Job(RESOLVE)
    failed_at, code, detail = -1, None, None
    for i, r in enumerate(case["records"]):
        code, detail = code_of(lambda: job.apply(r))
        if code:
            failed_at = i
            break
    expect = case["expect"]
    if "state" in expect:
        assert code is None, f"unexpected {code} at {failed_at}"
        assert job.state == expect["state"]
    else:
        assert (code, failed_at) == (expect["error"], expect["at"])
        if "guard" in expect:
            assert detail == expect["guard"]


@pytest.mark.parametrize("case", cases("records.json", only_ok=True))
def test_resign_reproduces_typescript_bytes(case):
    """Ed25519 is deterministic, so Python must reproduce the TypeScript id and signature exactly."""
    seeds = {k["kid"]: bytes.fromhex(k["seed_hex"]) for k in KEYS}
    r = case["record"]
    again = create_record(
        type=r["type"][4:-5], issuer=r["issuer"], actor=r["actor"], subject=r["subject"], body=r["body"],
        prev=r["prev"], issued_at=r["issued_at"], signer=Signer(r["sig"]["kid"], seeds[r["sig"]["kid"]]),
    )
    assert again["id"] == r["id"]
    assert again["sig"]["value"] == r["sig"]["value"]


# ---- the world engine (docs/spec-deltas.md S170) ----
from asp_core.world import GENERATOR, check_world_record, generate_day, seed_commitment  # noqa: E402

WORLD = load("vectors/world.json")


def test_world_generator_name():
    assert WORLD["generator"] == GENERATOR


@pytest.mark.parametrize("case", [pytest.param(c, id=f"{c['seed']}-{c['day']}") for c in WORLD["generate"]])
def test_world_generate(case):
    assert generate_day(case["seed"], case["day"]) == case["events"]


@pytest.mark.parametrize("case", [pytest.param(c, id=c["seed"] or "empty") for c in WORLD["commitments"]])
def test_world_commitment(case):
    assert seed_commitment(case["seed"]) == case["commitment"]


@pytest.mark.parametrize("case", [pytest.param(c, id=c["name"]) for c in WORLD["rules"]])
def test_world_rule(case):
    code, detail = code_of(lambda: check_world_record(case["issuer"], case["issued_at"], case["body"]))
    if case["expect"] == "ok":
        assert code is None
    else:
        assert (code, detail) == ("GUARD_FAILED", case["expect"])


# ---- the Market's risk model (docs/spec-deltas.md S1404) ----
from asp_core.risk import RISK_MODEL, only_removes_rule, suggest_risk  # noqa: E402

RISK = load("vectors/risk.json")


def test_risk_model_name():
    assert RISK["model"] == RISK_MODEL


@pytest.mark.parametrize("case", [pytest.param(c, id=c["name"]) for c in RISK["suggest"]])
def test_risk_suggest(case):
    assert suggest_risk(case["terms"], case["input"]) == case["expected"]


@pytest.mark.parametrize("case", [pytest.param(c, id=c["name"]) for c in RISK["onlyRemoves"]])
def test_risk_only_removes_rule(case):
    assert only_removes_rule(case["prev"], case["next"]) == case["expected"]


# ---- the Mandate template (docs/spec-deltas.md S1408) ----
from asp_core.mandate_template import derive_mandate, mandate_violations  # noqa: E402

MT = load("vectors/mandate-template.json")


@pytest.mark.parametrize("case", [pytest.param(c, id=c["name"]) for c in MT["violations"]])
def test_mandate_violations(case):
    assert mandate_violations(case["ceiling"], case["candidate"]) == case["expected"]


@pytest.mark.parametrize("case", [pytest.param(c, id=c["name"]) for c in MT["derive"]])
def test_derive_mandate(case):
    assert derive_mandate(case["template"], case["contract"], case["narrowing"]) == case["expected"]


# ---- the job-data term of a contract (docs/spec-deltas.md S1569, register row JO3) ----
from asp_core.data_handling import JOB_DATA_TERM, MAX_RETAIN_DAYS, data_handling_problem, read_data_handling  # noqa: E402

DH = load("vectors/data-handling.json")


def test_data_handling_constants():
    assert DH["term"] == JOB_DATA_TERM
    assert DH["maxRetainDays"] == MAX_RETAIN_DAYS


@pytest.mark.parametrize("case", [pytest.param(c, id=c["name"]) for c in DH["cases"]])
def test_data_handling(case):
    assert data_handling_problem(case["input"]) == case["problem"]
    assert read_data_handling(case["input"]) == case["reading"]


# ---- the notice acknowledgement (docs/spec-deltas.md S1591, register row US8) ----
from asp_core.notice_ack import KNOWN_NOTICES, notice_ack_problem  # noqa: E402

NA = load("vectors/notice-ack.json")


def test_known_notices():
    assert list(KNOWN_NOTICES) == NA["notices"]


@pytest.mark.parametrize("case", [pytest.param(c, id=c["name"]) for c in NA["cases"]])
def test_notice_ack(case):
    assert notice_ack_problem(case["input"]) == case["problem"]


@pytest.mark.parametrize("case", [pytest.param(c, id=c["name"]) for c in MT["privateScopes"]])
def test_private_scopes(case):
    from asp_core.mandate_template import private_scopes_problem  # noqa: PLC0415

    assert private_scopes_problem(case["input"]) == case["problem"]
