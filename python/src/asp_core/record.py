from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Iterable, Optional

from .canonical import canonical_bytes
from .crypto import b64url_decode, b64url_encode, public_key_from_seed, sha256_id, sign_bytes, verify_bytes
from .errors import AspError
from .schema import SchemaSet, default_schemas, full_type, short_type

Record = dict[str, Any]
# Returns the raw 32-byte public key for a kid, or None if unknown.
KeyResolver = Callable[[str], Optional[bytes]]

_UNSIGNED_FIELDS = ("type", "issuer", "actor", "subject", "body", "prev", "issued_at")


@dataclass(frozen=True)
class Signer:
    kid: str  # DID URL of the key
    seed: bytes  # 32-byte Ed25519 seed

    @property
    def public_key(self) -> bytes:
        return public_key_from_seed(self.seed)


def did_of(did_url: str) -> str:
    return did_url.split("#", 1)[0]


def unsigned_view(record: Record) -> Record:
    """The fields covered by id and every signature: everything except id, sig and cosigs."""
    return {k: record[k] for k in _UNSIGNED_FIELDS}


def signing_bytes(record: Record) -> bytes:
    return canonical_bytes(unsigned_view(record))


def _make_sig(data: bytes, signer: Signer) -> dict[str, str]:
    return {"alg": "Ed25519", "kid": signer.kid, "value": b64url_encode(sign_bytes(data, signer.seed))}


def create_record(
    *,
    type: str,
    issuer: str,
    subject: str | None,
    body: dict[str, Any],
    prev: str | None,
    issued_at: str,
    signer: Signer,
    actor: str | None = None,
) -> Record:
    if did_of(signer.kid) != issuer:
        raise AspError("KID_NOT_ISSUER", f"{signer.kid} does not belong to {issuer}")
    base = {
        "type": full_type(type),
        "issuer": issuer,
        "actor": actor or issuer,
        "subject": subject,
        "body": body,
        "prev": prev,
        "issued_at": issued_at,
    }
    data = signing_bytes(base)
    return {**base, "id": sha256_id(data), "sig": _make_sig(data, signer)}


def cosign(record: Record, signer: Signer) -> Record:
    """Adds a co-signature over the same bytes (e.g. the performer on a Contract)."""
    sig = _make_sig(signing_bytes(record), signer)
    return {**record, "cosigs": [*record.get("cosigs", []), sig]}


def static_resolver(keys: dict[str, bytes | str]) -> KeyResolver:
    def resolve(kid: str) -> bytes | None:
        k = keys.get(kid)
        if k is None:
            return None
        return b64url_decode(k) if isinstance(k, str) else k

    return resolve


def resolver_from_passports(passports: Iterable[Record]) -> KeyResolver:
    """Builds a resolver from passport records (keys listed in passport bodies)."""
    keys: dict[str, bytes | str] = {}
    for p in passports:
        for k in p["body"].get("keys", []):
            if "revoked_at" not in k:
                keys[k["id"]] = k["public_key"]
    return static_resolver(keys)


def _check_sig(sig: dict[str, str], data: bytes, resolve: KeyResolver) -> None:
    pub = resolve(sig["kid"])
    if pub is None:
        raise AspError("UNKNOWN_KEY", f"no key for {sig['kid']}")
    if not verify_bytes(b64url_decode(sig["value"]), data, pub):
        raise AspError("BAD_SIGNATURE", f"signature by {sig['kid']} does not verify")


def verify_record(record: Any, resolve: KeyResolver, schemas: SchemaSet | None = None) -> Record:
    """Verifies one record in isolation.

    Check order is normative (conformance vectors depend on it): envelope schema, known type,
    body schema, canonical form, id, actor, kid-issuer binding, signature, cosignatures.
    """
    schemas = schemas or default_schemas()
    schemas.assert_valid("envelope", record)
    short = short_type(record["type"])
    if short is None:
        raise AspError("UNKNOWN_TYPE", f"unknown record type {record['type']}")
    schemas.assert_valid(short, record["body"])

    data = signing_bytes(record)
    rid = sha256_id(data)
    if rid != record["id"]:
        raise AspError("BAD_ID", f"id should be {rid}")

    if did_of(record["actor"]) != record["issuer"]:
        raise AspError("BAD_ACTOR", f"{record['actor']} is not {record['issuer']} or one of its nodes")
    if did_of(record["sig"]["kid"]) != record["issuer"]:
        raise AspError("KID_NOT_ISSUER", f"{record['sig']['kid']} does not belong to {record['issuer']}")
    _check_sig(record["sig"], data, resolve)
    for c in record.get("cosigs", []):
        _check_sig(c, data, resolve)
    return record
