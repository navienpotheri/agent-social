import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from asp_core import AgentReporter, MandateRefusal, Signer, public_key_from_seed, static_resolver, verify_record

AGENT = "did:web:example.com:agents:hosted"
CONTRACT = "sha256:" + "c" * 64
SEED = bytes(range(32))


class FakeLog(BaseHTTPRequestHandler):
    state = {"state": "Running", "scopes": ["repo.read"]}
    appended: list = []

    def log_message(self, *a):  # silence
        pass

    def do_POST(self):
        call = json.loads(self.rfile.read(int(self.headers["content-length"])))
        m, args = call["method"], call["args"]
        if call["target"] == "log" and m == "chainInfo":
            result = {"state": self.state["state"]}
        elif call["target"] == "log" and m == "mandateOf":
            result = {"contract": args[0], "scopes": self.state["scopes"]}
        elif call["target"] == "handle" and m == "append":
            self.appended.append(args[0])
            result = {"id": args[0]["id"], "seq": len(self.appended)}
        else:
            return self._send({"ok": False, "error": {"message": "unknown"}})
        self._send({"ok": True, "result": result})

    def _send(self, body):
        data = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


@pytest.fixture()
def server():
    FakeLog.state = {"state": "Running", "scopes": ["repo.read"]}
    FakeLog.appended = []
    srv = HTTPServer(("127.0.0.1", 0), FakeLog)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}"
    srv.shutdown()


def reporter(url):
    return AgentReporter(url=url, agent=AGENT, signer=Signer(kid=f"{AGENT}#key-1", seed=SEED), contract=CONTRACT)


def test_guard_runs_allowed_refuses_the_rest_and_flush_signs_a_self_reported_action(server):
    r = reporter(server)
    assert r.allowed("repo.read") and not r.allowed("repo.push")
    assert r.guard("repo.read", lambda: "done", artifact={"uri": "asp://tool-call/read", "sha256": "sha256:" + "a" * 64}) == "done"
    ran = []
    with pytest.raises(MandateRefusal, match="repo.push is not granted"):
        r.guard("repo.push", lambda: ran.append(1))
    assert ran == []
    out = r.flush("answered the customer")
    assert out["seq"] == 1
    rec = FakeLog.appended[0]
    assert rec["type"] == "asp.action/v0.2" and rec["issuer"] == AGENT
    assert rec["body"]["scopes_used"] == ["repo.read"]
    assert rec["body"]["blocked_attempts"] == [{"scope": "repo.push", "count": 1}]
    assert rec["body"]["assurance"] == "self_reported"
    # The record is a real, verifiable ASP record signed by the agent's key.
    verify_record(rec, static_resolver({f"{AGENT}#key-1": public_key_from_seed(SEED)}))
    assert r.flush() is None


def test_a_job_that_is_no_longer_running_refuses_everything(server):
    FakeLog.state["state"] = "Settled"
    with pytest.raises(MandateRefusal, match="not running"):
        reporter(server).guard("repo.read", lambda: "x")


def test_unknown_assurance_level_is_rejected(server):
    with pytest.raises(ValueError):
        AgentReporter(url=server, agent=AGENT, signer=Signer(kid=f"{AGENT}#key-1", seed=SEED), contract=CONTRACT, assurance="trust_me")
