from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Iterable

from .errors import AspError
from .record import KeyResolver, Record, did_of, verify_record
from .schema import SPEC_DIR, SchemaSet, default_schemas, short_type

LIFECYCLE: dict[str, Any] = json.loads((SPEC_DIR / "lifecycle.json").read_text("utf-8"))


class Job:
    """A job chain: verifies each record, checks the hash link, and applies the lifecycle.

    Records must arrive in chain order, starting with the Contract.
    """

    def __init__(self, resolve: KeyResolver, schemas: SchemaSet | None = None):
        self._resolve = resolve
        self._schemas = schemas or default_schemas()
        self.state: str | None = None
        self.records: list[Record] = []
        self.contract_id: str | None = None
        self.principal: str | None = None
        self.performer: str | None = None
        self.bank: str | None = None
        self.open_checkpoint: str | None = None
        self.latest_delivery: str | None = None
        self.acceptance: str | None = None
        self.ruling: str | None = None
        self.redeliveries = 0

    @classmethod
    def replay(cls, records: Iterable[Record], resolve: KeyResolver, schemas: SchemaSet | None = None) -> Job:
        job = cls(resolve, schemas)
        for r in records:
            job.apply(r)
        return job

    @property
    def head(self) -> str | None:
        return self.records[-1]["id"] if self.records else None

    def apply(self, raw: Any) -> str:
        r = verify_record(raw, self._resolve, self._schemas)

        last = self.records[-1] if self.records else None
        expected_prev = last["id"] if last else None
        if r["prev"] != expected_prev:
            raise AspError("BAD_PREV", f"prev should be {expected_prev}")
        if last and datetime.fromisoformat(r["issued_at"]) < datetime.fromisoformat(last["issued_at"]):
            raise AspError("TIME_REVERSED", f"{r['issued_at']} is before {last['issued_at']}")

        if self.state in LIFECYCLE["terminal"]:
            raise AspError("TERMINAL_STATE", f"job is {self.state}")

        rtype = short_type(r["type"])
        t = next(
            (
                t for t in LIFECYCLE["transitions"]
                if self.state in t["from"] and t["type"] == rtype and _matches(t.get("when"), r["body"])
            ),
            None,
        )
        if t is None:
            raise AspError("ILLEGAL_TRANSITION", f"no transition from {self.state} on {_describe(r)}")

        if rtype == "contract":
            b = r["body"]
            self.contract_id, self.principal, self.performer, self.bank = (
                r["id"], b["principal"], b["performer"], b["bank"],
            )
        try:
            self._check_issuer(t["issuer"], r)
            for g in t.get("guards", []):
                if not self._guard(g, r):
                    raise AspError("GUARD_FAILED", f"guard {g} rejected {_describe(r)}", g)
        except AspError:
            # A rejected record leaves the job unchanged.
            if rtype == "contract":
                self.contract_id = self.principal = self.performer = self.bank = None
            raise

        self._record(t, rtype, r)
        self.state = t["to"]
        self.records.append(r)
        return self.state

    def _check_issuer(self, role: str, r: Record) -> None:
        issuer = r["issuer"]
        if role == "principal":
            ok = issuer == self.principal
        elif role == "performer":
            ok = issuer == self.performer
        elif role == "bank":
            ok = issuer == self.bank
        elif role == "backer":
            ok = issuer == r["body"].get("backer")
        else:  # neutral
            ok = issuer not in (self.principal, self.performer)
        if not ok:
            raise AspError("WRONG_ISSUER", f"{issuer} is not the {role}")

    def _cosigned_by(self, r: Record, did: str | None) -> bool:
        return any(did_of(c["kid"]) == did for c in r.get("cosigs", []))

    def _guard(self, name: str, r: Record) -> bool:
        b = r["body"]
        match name:
            case "cosigned_by_performer":
                return self._cosigned_by(r, self.performer)
            case "cosigned_by_principal":
                return self._cosigned_by(r, self.principal)
            case "refs_contract":
                return b.get("contract") == self.contract_id
            case "escrow_payer_is_principal":
                return b.get("escrow", {}).get("payer") == self.principal
            case "subject_is_performer":
                return r["subject"] == self.performer
            case "about_open_checkpoint":
                return b.get("about") == self.open_checkpoint
            case "about_latest_delivery":
                return b.get("about") == self.latest_delivery
            case "about_contract":
                return b.get("about") == self.contract_id
            case "not_yet_accepted":
                return self.acceptance is None
            case "redelivery_available":
                return self.redeliveries < LIFECYCLE["max_redeliveries"]
            case "no_ruling_yet":
                return self.ruling is None
            case "cites_acceptance":
                return b.get("cites") is not None and b.get("cites") == self.acceptance
            case "cites_ruling":
                return b.get("cites") is not None and b.get("cites") == self.ruling
        raise ValueError(f"unknown guard {name}")

    def _record(self, t: dict[str, Any], rtype: str, r: Record) -> None:
        if rtype == "checkpoint":
            self.open_checkpoint = r["id"]
        if rtype == "attestation" and "Checkpoint" in t["from"]:
            self.open_checkpoint = None
        if rtype == "delivery":
            self.latest_delivery = r["id"]
        for e in t.get("effects", []):
            if e == "mark_accepted":
                self.acceptance = r["id"]
            elif e == "count_redelivery":
                self.redeliveries += 1
            elif e == "record_ruling":
                self.ruling = r["id"]
            else:
                raise ValueError(f"unknown effect {e}")


def _matches(when: dict[str, str] | None, body: dict[str, Any]) -> bool:
    return not when or all(body.get(k) == v for k, v in when.items())


def _describe(r: Record) -> str:
    b = r["body"]
    extra = [f"{k}={b[k]}" for k in ("kind", "verdict", "basis") if isinstance(b.get(k), str)]
    return " ".join([r["type"], *extra])
