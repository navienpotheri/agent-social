"""did:key for Ed25519 (https://w3c-ccg.github.io/did-method-key/): a self-certifying DID derived
directly from a public key, with no domain, server or registry to depend on or lose access to.
Unlike did:web, nothing about it can be taken away by whoever hosts the domain it might otherwise
live under -- the point raised when did:web-only identity was checked against "take your agent and
leave" (2026-09-27, see docs/spec-deltas.md). Recommended for anyone who doesn't want to run their
own domain; did:web remains supported for anyone who does.
"""
from __future__ import annotations

import re

from .errors import AspError

# multicodec varint prefix for "ed25519-pub" (0xed), then the raw 32-byte key: 34 bytes total.
_ED25519_PUB_CODEC = bytes([0xED, 0x01])

_BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
_BASE58_INDEX = {c: i for i, c in enumerate(_BASE58)}
_DID_KEY_RE = re.compile(r"^did:key:z([1-9A-HJ-NP-Za-km-z]+)$")


def _base58_encode(data: bytes) -> str:
    zeros = 0
    while zeros < len(data) and data[zeros] == 0:
        zeros += 1
    num = int.from_bytes(data, "big")
    out = ""
    while num > 0:
        num, rem = divmod(num, 58)
        out = _BASE58[rem] + out
    return "1" * zeros + out


def _base58_decode(s: str) -> bytes:
    zeros = 0
    while zeros < len(s) and s[zeros] == "1":
        zeros += 1
    num = 0
    for c in s:
        v = _BASE58_INDEX.get(c)
        if v is None:
            raise AspError("SCHEMA_INVALID", f"not base58: character {c!r}")
        num = num * 58 + v
    body = num.to_bytes((num.bit_length() + 7) // 8, "big") if num else b""
    return b"\x00" * zeros + body


def did_key_from_public_key(public_key: bytes) -> str:
    """Derives a did:key from a 32-byte Ed25519 public key. The DID itself proves the key belongs to it."""
    if len(public_key) != 32:
        raise AspError("SCHEMA_INVALID", f"an Ed25519 public key is 32 bytes, got {len(public_key)}")
    return "did:key:z" + _base58_encode(_ED25519_PUB_CODEC + public_key)


def public_key_from_did_key(did: str) -> bytes:
    """Recovers the Ed25519 public key a did:key was derived from -- decoding, not a network lookup."""
    m = _DID_KEY_RE.match(did)
    if not m:
        raise AspError("SCHEMA_INVALID", f"not a did:key: {did}")
    decoded = _base58_decode(m.group(1))
    if len(decoded) != 34 or decoded[0:2] != _ED25519_PUB_CODEC:
        raise AspError("SCHEMA_INVALID", f"{did} is not an Ed25519 did:key")
    return decoded[2:]


def is_did_key_for(did: str, public_key: bytes) -> bool:
    """True if a did:key's own encoding actually matches this public key -- the whole point of did:key."""
    try:
        return public_key_from_did_key(did) == public_key
    except AspError:
        return False
