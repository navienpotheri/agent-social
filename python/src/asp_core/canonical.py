"""RFC 8785 (JCS) canonical JSON, restricted to the ASP profile.

Numbers must be safe integers (integral floats such as 1.0 count as integers,
matching JavaScript), and strings must be well-formed Unicode.
"""
from __future__ import annotations

import json
from typing import Any

from .errors import AspError

MAX_SAFE_INTEGER = 2**53 - 1


def _string(s: str) -> str:
    try:
        s.encode("utf-8")
    except UnicodeEncodeError:
        raise AspError("SCHEMA_INVALID", "string contains a lone surrogate") from None
    return json.dumps(s, ensure_ascii=False)


def _integer(n: int | float) -> str:
    if isinstance(n, float):
        if not n.is_integer():
            raise AspError("NON_INTEGER_NUMBER", f"number {n} is not a safe integer")
        n = int(n)
    if abs(n) > MAX_SAFE_INTEGER:
        raise AspError("NON_INTEGER_NUMBER", f"number {n} is not a safe integer")
    return str(n)


def canonicalize(value: Any) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, (int, float)):
        return _integer(value)
    if isinstance(value, str):
        return _string(value)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(canonicalize(v) for v in value) + "]"
    if isinstance(value, dict):
        # JCS sorts keys by UTF-16 code units, not code points.
        keys = sorted(value.keys(), key=lambda k: k.encode("utf-16-be"))
        return "{" + ",".join(f"{_string(k)}:{canonicalize(value[k])}" for k in keys) + "}"
    raise AspError("SCHEMA_INVALID", f"cannot canonicalize a {type(value).__name__}")


def canonical_bytes(value: Any) -> bytes:
    return canonicalize(value).encode("utf-8")
