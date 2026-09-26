from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

from .errors import AspError

SPEC_DIR = Path(__file__).resolve().parents[3] / "spec"

RECORD_TYPES = (
    "intent", "call", "proposal", "offer", "contract", "mandate", "bond",
    "checkpoint", "delivery", "attestation", "settlement", "passport", "lineage", "package",
)
TYPE_VERSION = "v0.2"
_TYPE_RE = re.compile(r"^asp\.([a-z_]+)/v0\.2$")


def full_type(short: str) -> str:
    return f"asp.{short}/{TYPE_VERSION}"


def short_type(full: str) -> str | None:
    m = _TYPE_RE.match(full)
    return m.group(1) if m and m.group(1) in RECORD_TYPES else None


class SchemaSet:
    def __init__(self, schema_dir: Path | None = None):
        schema_dir = schema_dir or SPEC_DIR / "schemas"
        schemas = {p.name.removesuffix(".schema.json"): json.loads(p.read_text("utf-8"))
                   for p in sorted(schema_dir.glob("*.schema.json"))}
        registry = Registry().with_resources(
            (s["$id"], Resource.from_contents(s)) for s in schemas.values()
        )
        checker = FormatChecker()
        self._validators = {
            name: Draft202012Validator(s, registry=registry, format_checker=checker)
            for name, s in schemas.items()
        }

    def has(self, name: str) -> bool:
        return name in self._validators

    def assert_valid(self, name: str, instance: Any) -> None:
        v = self._validators.get(name)
        if v is None:
            raise AspError("UNKNOWN_TYPE", f"no schema named {name}")
        err = next(iter(v.iter_errors(instance)), None)
        if err is not None:
            path = "/" + "/".join(str(p) for p in err.absolute_path)
            raise AspError("SCHEMA_INVALID", f"{name}{path} {err.message}", path)

    def is_valid(self, name: str, instance: Any) -> bool:
        try:
            self.assert_valid(name, instance)
            return True
        except AspError as e:
            if e.code == "SCHEMA_INVALID":
                return False
            raise


@lru_cache(maxsize=1)
def default_schemas() -> SchemaSet:
    return SchemaSet()
