"""The job-data term of a contract (register row JO3; spec-delta S1569): the default reading of an absent
`data_handling` field and the validation the log applies. Mirrors packages/asp-core/src/data-handling.ts; the
two agree on conformance/vectors/data-handling.json. Pure."""
from __future__ import annotations

from typing import Any

JOB_DATA_TERM = "asp.job-data/v1"
KNOWN_JOB_DATA_TERMS = (JOB_DATA_TERM,)
MAX_RETAIN_DAYS = 365


def read_data_handling(d: dict[str, Any] | None = None) -> dict[str, Any]:
    d = d or {}
    return {
        "term": d.get("term", JOB_DATA_TERM),
        "commons_sharing": d.get("commons_sharing", False),
        "retention": d.get("retention", "delete_at_settlement"),
        "retain_days": d.get("retain_days"),
        "personal_data": d.get("personal_data", "none"),
    }


def data_handling_problem(d: dict[str, Any] | None = None) -> str | None:
    """The rule a data-handling object breaks (`data_handling_unknown_term` or `data_handling_retention_invalid`), or None."""
    if not d:
        return None
    if "term" in d and d["term"] not in KNOWN_JOB_DATA_TERMS:
        return "data_handling_unknown_term"
    retention = d.get("retention", "delete_at_settlement")
    days = d.get("retain_days")
    if retention == "retain_days":
        if "retain_days" not in d:
            return "data_handling_retention_invalid"
    elif "retain_days" in d:
        return "data_handling_retention_invalid"
    if "retain_days" in d and not (isinstance(days, int) and not isinstance(days, bool) and 1 <= days <= MAX_RETAIN_DAYS):
        return "data_handling_retention_invalid"
    return None
