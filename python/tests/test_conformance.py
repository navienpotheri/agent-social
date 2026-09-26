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
