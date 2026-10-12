"""did:key: round-trip correctness, and agreement with the TypeScript SDK on the same keys."""
from __future__ import annotations

import os

import pytest

from asp_core import (
    AspError,
    did_key_from_public_key,
    is_did_key_for,
    public_key_from_did_key,
    public_key_from_seed,
)


def test_round_trips_and_shape():
    for _ in range(20):
        seed = os.urandom(32)
        pub = public_key_from_seed(seed)
        did = did_key_from_public_key(pub)
        assert did.startswith("did:key:z")
        assert public_key_from_did_key(did) == pub
        assert is_did_key_for(did, pub)


def test_every_ed25519_did_key_starts_with_the_fixed_prefix():
    # multicodec ed25519-pub varint-encodes as [0xed, 0x01]; z6Mk is that prefix's fixed base58btc
    # rendering, shared by every Ed25519 did:key regardless of the key that follows it.
    for _ in range(5):
        did = did_key_from_public_key(public_key_from_seed(os.urandom(32)))
        assert did.startswith("did:key:z6Mk")


def test_rejects_a_key_that_is_not_32_bytes():
    with pytest.raises(AspError):
        did_key_from_public_key(bytes(31))
    with pytest.raises(AspError):
        did_key_from_public_key(bytes(33))


def test_rejects_a_non_did_key_string_and_invalid_base58():
    with pytest.raises(AspError, match="not a did:key"):
        public_key_from_did_key("did:web:example.com")
    with pytest.raises(AspError, match="not a did:key"):
        public_key_from_did_key("did:key:zNotBase580OIl")


def test_is_did_key_for_is_false_for_a_mismatch_or_malformed_did_never_raises():
    pub = public_key_from_seed(os.urandom(32))
    did = did_key_from_public_key(pub)
    other = public_key_from_seed(os.urandom(32))
    assert is_did_key_for(did, other) is False
    assert is_did_key_for("not-a-did", pub) is False
    assert is_did_key_for("did:key:zInvalid0OIl", pub) is False


def test_agrees_with_the_typescript_sdk_on_the_shared_conformance_keys():
    """conformance/keys.json's did_key field was computed by the TypeScript SDK
    (conformance/generate.ts). Python must derive the exact same string from the exact same seed --
    did:key is a pure function of the public key, with no per-language choice to diverge on."""
    import json
    from pathlib import Path

    keys_path = Path(__file__).resolve().parents[2] / "conformance" / "keys.json"
    keys = json.loads(keys_path.read_text())["keys"]
    assert len(keys) >= 3, "sanity check: the fixture actually loaded"
    for k in keys:
        seed = bytes.fromhex(k["seed_hex"])
        did = did_key_from_public_key(public_key_from_seed(seed))
        assert did == k["did_key"]
