"""The world engine, first slice (docs/spec-deltas.md S170): the seeded event generator and the log's rules on world records.

Mirrors packages/asp-log/src/world.ts. Both are held to conformance/vectors/world.json, so the same (seed, day, generator) gives the same events in either
language. Pure functions: no clock, no store, no random source.
"""
from __future__ import annotations

import hashlib
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from .errors import AspError

WORLD_DID = "did:web:asp.local:world"
GENERATOR = "asp-world-gen/1"

LISTING_CLASSES = ("code", "research", "data", "review", "writing")
JOB_TYPES = ("code-review", "data-labeling", "literature-scan", "test-writing", "translation")
SERVICES = ("market", "forum", "events", "registry")
PRICE_MULTIPLIERS = (700, 800, 900, 1150, 1250, 1500)

PRICE_MULTIPLIER_MIN = 500
PRICE_MULTIPLIER_MAX = 2000
NOTICE_HOURS = 72
MAX_WINDOW_DAYS = 90
NOTICE_KINDS = {"scheduled", "season", "funding", "review"}
SEEDED_KINDS = {"shock", "drill", "experiment"}

_HOUR = timedelta(hours=1)
_DAY = timedelta(days=1)


def _sha(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def is_day(s: str) -> bool:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        return False
    try:
        datetime.strptime(s, "%Y-%m-%d")
    except ValueError:
        return False
    return True


def _day_start(day: str) -> datetime:
    return datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc)


def _iso(t: datetime) -> str:
    return t.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def seed_commitment(seed: str) -> str:
    return "sha256:" + _sha(f"asp.world.seed.v1|{seed}")


def _draw(seed: str, day: str, label: str, n: int) -> int:
    return int(_sha(f"{GENERATOR}|{seed}|{day}|{label}")[:12], 16) % n


def _pick(seed: str, day: str, label: str, xs: tuple) -> Any:
    return xs[_draw(seed, day, label, len(xs))]


def _pct(permille: int) -> str:
    # JavaScript prints 112.5 as "112.5" and 70 as "70"; match it.
    v = permille / 10
    return str(int(v)) + "%" if v == int(v) else f"{v}%"


def _price_shock(s: str, d: str, t0: datetime) -> dict:
    cls = _pick(s, d, "price_shock:class", LISTING_CLASSES)
    mult = _pick(s, d, "price_shock:mult", PRICE_MULTIPLIERS)
    days = 1 + _draw(s, d, "price_shock:days", 3)
    return {"title": f"Price shock: {cls} listings at {_pct(mult)} of list price for {days} day(s)", "starts": _iso(t0), "ends": _iso(t0 + days * _DAY),
            "effect": {"type": "price_multiplier", "target": cls, "value": mult}}


def _job_opening(s: str, d: str, t0: datetime) -> dict:
    job = _pick(s, d, "job_opening:type", JOB_TYPES)
    return {"title": f"A new job type opens: {job}", "starts": _iso(t0), "ends": _iso(t0 + 7 * _DAY), "effect": {"type": "job_type_open", "target": job, "value": 0}}


def _service_outage(s: str, d: str, t0: datetime) -> dict:
    svc = _pick(s, d, "service_outage:service", SERVICES)
    at = t0 + _draw(s, d, "service_outage:hour", 24) * _HOUR
    hours = 2 + _draw(s, d, "service_outage:hours", 5)
    return {"title": f"{svc} is down for {hours} hour(s)", "starts": _iso(at), "ends": _iso(at + hours * _HOUR), "effect": {"type": "service_outage", "target": svc, "value": 0}}


def _tax_free_week(_s: str, _d: str, t0: datetime) -> dict:
    return {"title": "Tax-free week: the transaction tax is waived", "starts": _iso(t0), "ends": _iso(t0 + 7 * _DAY), "effect": {"type": "tax_free", "target": "all", "value": 1000}}


def _flash_gathering(_s: str, _d: str, t0: datetime) -> dict:
    at = t0 + 2 * _DAY + 18 * _HOUR
    return {"title": "A flash gathering in the forum (free, no prize)", "starts": _iso(at), "ends": _iso(at + _HOUR), "effect": {"type": "gathering", "target": "forum", "value": 0}}


_CATALOGUE = (
    ("price_shock", 250, _price_shock),
    ("job_opening", 200, _job_opening),
    ("service_outage", 100, _service_outage),
    ("tax_free_week", 40, _tax_free_week),
    ("flash_gathering", 60, _flash_gathering),
)


def _guard(name: str, message: str) -> AspError:
    return AspError("GUARD_FAILED", message, name)


def generate_day(seed: str, day: str, generator: str = GENERATOR) -> list[dict]:
    """What a seed gives on a day. The same (seed, day, generator) always gives the same list, in catalogue order."""
    if generator != GENERATOR:
        raise _guard("world_generator_unknown", f"unknown world generator {generator}")
    if not is_day(day):
        raise _guard("world_bad_day", f"{day} is not a day (YYYY-MM-DD)")
    t0 = _day_start(day)
    out = []
    for kind, chance, make in _CATALOGUE:
        d = _draw(seed, day, f"{kind}:fire", 1000)
        if d < chance:
            out.append({"event_id": f"{day}:{kind}", "event_type": kind, **make(seed, day, t0), "draw": d, "chance": chance})
    return out


def day_body(seed: str, day: str) -> dict:
    return {"kind": "day", "day": day, "generator": GENERATOR, "seed": seed, "seed_commitment": seed_commitment(seed), "events": generate_day(seed, day)}


def check_world_record(issuer: str, issued_at: str, body: dict) -> None:
    """The rules the log enforces on a world record whose schema has passed (see packages/asp-log/src/world.ts)."""
    if issuer != WORLD_DID:
        raise _guard("world_not_authority", f"{issuer} is not the world authority ({WORLD_DID})")
    if body["kind"] == "calendar_entry":
        s, e = _parse(body["starts"]), _parse(body["ends"])
        if not e > s:
            raise _guard("world_bad_window", f"entry {body['entry_id']} ends no later than it starts")
        if e - s > MAX_WINDOW_DAYS * _DAY:
            raise _guard("world_bad_window", f"entry {body['entry_id']} lasts more than {MAX_WINDOW_DAYS} days")
        if body["event_kind"] in NOTICE_KINDS and s - _parse(issued_at) < NOTICE_HOURS * _HOUR:
            raise _guard("world_notice_too_short", f"a {body['event_kind']} entry must be published at least {NOTICE_HOURS} hours before it starts")
        if body["event_kind"] in SEEDED_KINDS and (not body.get("seed_commitment") or not body.get("generator")):
            raise _guard("seed_not_committed", "a shock, drill or experiment must carry a seed commitment and the generator's version")
        eff = body["effect"]
        if eff["type"] == "price_multiplier" and not PRICE_MULTIPLIER_MIN <= eff["value"] <= PRICE_MULTIPLIER_MAX:
            raise _guard("calendar_out_of_bounds", f"a price multiplier of {eff['value']} permille is outside {PRICE_MULTIPLIER_MIN} to {PRICE_MULTIPLIER_MAX}")
        return
    if not is_day(body["day"]):
        raise _guard("world_bad_day", f"{body['day']} is not a day")
    if body["seed_commitment"] != seed_commitment(body["seed"]):
        raise _guard("seed_commitment_mismatch", "the seed does not match its commitment")
    if _parse(issued_at) < _day_start(body["day"]):
        raise _guard("world_day_not_started", f"{body['day']} has not begun at {issued_at}")
    if body["events"] != generate_day(body["seed"], body["day"], body["generator"]):
        raise _guard("event_not_reproducible", f"the events of {body['day']} are not what {body['generator']} gives for that seed")
