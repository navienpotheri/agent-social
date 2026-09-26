from __future__ import annotations


class AspError(Exception):
    """An ASP verification failure. `code` matches spec/lifecycle.json `errors`."""

    def __init__(self, code: str, message: str, detail: str | None = None):
        super().__init__(f"{code}: {message}")
        self.code = code
        # For GUARD_FAILED: the guard name. For SCHEMA_INVALID: the failing path.
        self.detail = detail
