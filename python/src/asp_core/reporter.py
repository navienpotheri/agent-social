"""The self-report SDK for agents that cannot be wrapped (hosted, enterprise, or running in someone else's cloud).

The agent checks the live Mandate itself, records what it did, and signs its own Action with its own key. The evidence is
``self_reported``, the weakest assurance level: it is only as good as the agent, but it puts the agent under the same
Mandate, Bond, strikes and Courts as any other, and the log still refuses an Action that reports a scope the Mandate
does not grant. Talks to a log service (``asp serve``) over its JSON RPC; standard library only.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from .errors import AspError
from .record import Signer, create_record

ASSURANCE = ("self_reported", "runtime_observed", "gateway_observed", "gateway_enforced", "hook_enforced", "sandbox_enforced")


class MandateRefusal(Exception):
    def __init__(self, scope: str, why: str):
        super().__init__(f"ASP: {why}")
        self.scope = scope


class AgentReporter:
    def __init__(self, *, url: str, agent: str, signer: Signer, contract: str, token: Optional[str] = None,
                 assurance: str = "self_reported", timeout: float = 60.0):
        if assurance not in ASSURANCE:
            raise ValueError(f"assurance must be one of {ASSURANCE}")
        self.url = url.rstrip("/")
        self.agent = agent
        self.signer = signer
        self.contract = contract
        self.token = token
        self.assurance = assurance
        self.timeout = timeout
        self._used: set[str] = set()
        self._blocked: dict[str, int] = {}
        self._artifacts: list[dict[str, str]] = []
        self._last_activity = datetime.now(timezone.utc)

    # --- the log service's JSON RPC ---
    def _rpc(self, target: str, method: str, *args: Any) -> Any:
        req = urllib.request.Request(
            f"{self.url}/rpc", method="POST", data=json.dumps({"target": target, "method": method, "args": list(args)}).encode(),
            headers={"content-type": "application/json", **({"authorization": f"Bearer {self.token}"} if self.token else {})},
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                body = json.loads(res.read())
        except urllib.error.HTTPError as e:
            try:
                body = json.loads(e.read())
            except Exception:
                raise RuntimeError(f"the log service answered {e.code}") from None
        except urllib.error.URLError as e:
            raise RuntimeError(f"cannot reach the log service at {self.url}: {e.reason}") from None
        if body.get("ok"):
            return None if body.get("undefined") else body.get("result")
        err = body.get("error", {})
        if err.get("name") == "AspError" and err.get("code"):
            raise AspError(err["code"], str(err.get("message", "")).split(": ", 1)[-1])
        raise RuntimeError(err.get("message", "the log service refused the request"))

    # --- the Mandate ---
    def mandate(self) -> dict[str, Any]:
        """The live Mandate: its scopes, and whether the job is still running. Re-read each time, since a Mandate can end."""
        info = self._rpc("log", "chainInfo", self.contract) or {}
        m = self._rpc("log", "mandateOf", self.contract) or {}
        state = info.get("state")
        return {"scopes": m.get("scopes", []), "running": state in ("Running", "Checkpoint"), "state": state}

    def allowed(self, scope: str) -> bool:
        m = self.mandate()
        return bool(m["running"] and scope in m["scopes"])

    def guard(self, scope: str, fn: Callable[[], Any], artifact: Optional[dict[str, str]] = None) -> Any:
        """Checks the Mandate, then runs ``fn``; a refused scope is recorded as a blocked attempt and ``fn`` is not run."""
        m = self.mandate()
        if not m["running"]:
            raise MandateRefusal(scope, f"the job is {m['state'] or 'not in the log'}, not running")
        if scope not in m["scopes"]:
            self._blocked[scope] = self._blocked.get(scope, 0) + 1
            raise MandateRefusal(scope, f"the scope {scope} is not granted by this job's Mandate")
        out = fn()
        self._last_activity = datetime.now(timezone.utc)
        self._used.add(scope)
        if artifact:
            self._artifacts.append(artifact)
        return out

    def note(self, scope: str, artifact: Optional[dict[str, str]] = None) -> None:
        self._last_activity = datetime.now(timezone.utc)
        self._used.add(scope)
        if artifact:
            self._artifacts.append(artifact)

    def flush(self, summary: Optional[str] = None) -> Optional[dict[str, Any]]:
        """Signs and appends one Action with what has been recorded since the last flush; None when there is nothing to say."""
        if not self._used and not self._blocked:
            return None
        body: dict[str, Any] = {"contract": self.contract, "scopes_used": sorted(self._used), "assurance": self.assurance}
        if summary:
            body["summary"] = summary
        if self._blocked:
            body["blocked_attempts"] = [{"scope": s, "count": c} for s, c in self._blocked.items()]
        if self._artifacts:
            body["artifacts"] = self._artifacts
        def sign(b: dict[str, Any]) -> Any:
            return create_record(
                type="action", issuer=self.agent, subject=self.contract, prev=None, body=b, signer=self.signer,
                issued_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            )

        try:
            res = self._rpc("handle", "append", sign(body))
        except AspError as e:
            # The job ended before this report: say so, for the activity up to the agent's last (S80).
            if "is not currently Running" not in str(e):
                raise
            late = {"activity_ended": self._last_activity.strftime("%Y-%m-%dT%H:%M:%SZ")}
            res = self._rpc("handle", "append", sign({**body, "late": late}))
        self._used, self._blocked, self._artifacts = set(), {}, []
        return res
