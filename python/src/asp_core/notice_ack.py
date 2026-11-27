"""The signed acknowledgement of a notice (register row US8; spec-delta S1591): the validation the log applies to a
`notice_ack` body. Mirrors packages/asp-core/src/notice-ack.ts; the two agree on conformance/vectors/notice-ack.json. Pure."""
from __future__ import annotations

import re
from typing import Any

KNOWN_NOTICES = ("asp.my-data/v1", "asp.privacy/v1", "asp.terms/v1")
_HASH = re.compile(r"^[0-9a-f]{64}$")


def notice_ack_problem(b: dict[str, Any]) -> str | None:
    """The rule a notice acknowledgement breaks (`notice_ack_unknown_notice` or `notice_ack_bad_hash`), or None."""
    notice = b.get("notice")
    if not isinstance(notice, str) or notice not in KNOWN_NOTICES:
        return "notice_ack_unknown_notice"
    digest = b.get("statement_sha256")
    if not isinstance(digest, str) or not _HASH.fullmatch(digest):
        return "notice_ack_bad_hash"
    return None
