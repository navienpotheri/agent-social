// The sandbox evaluation, shared by the bubblewrap and Docker backends. No model and no key: a stand-in provider asks for a curl call, and the
// agent (a Python program inside the sandbox) reports back through the model API what it could and could not do. The report reaches the
// stand-in through the gateway, which is the only way out of the sandbox.
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { D, Eval, gateway, session, workdir } from "./common.mjs";

export const AGENT_PY = `
import json, os, urllib.request
checks = {}
def attempt(name, fn):
    try: fn(); checks[name] = "allowed"
    except Exception: checks[name] = "blocked"
def post(messages, tools=None):
    body = {"model": "m", "messages": messages}
    if tools: body["tools"] = tools
    req = urllib.request.Request(os.environ["OPENAI_BASE_URL"] + "/chat/completions", method="POST", data=json.dumps(body).encode(),
        headers={"content-type": "application/json", "authorization": "Bearer " + os.environ.get("OPENAI_API_KEY", "")})
    return json.loads(urllib.request.urlopen(req, timeout=30).read())
attempt("internet", lambda: urllib.request.urlopen("https://example.com", timeout=4))
attempt("provider_key_visible", lambda: os.environ["ASP_OR_KEY"])
attempt("write_project", lambda: open("hacked.txt", "w").write("x"))
tools = [{"type": "function", "function": {"name": "bash", "description": "Run a shell command", "parameters": {"type": "object", "properties": {"command": {"type": "string"}}, "required": ["command"]}}}]
reply = post([{"role": "user", "content": "run curl"}], tools)
calls = [t["function"]["name"] for t in reply["choices"][0]["message"].get("tool_calls") or []]
post([{"role": "user", "content": json.dumps({"checks": checks, "received": calls})}])
`;

/** @param name evaluation name; @param backend "bwrap" | "docker"; @param command (agentFile, projectDir) => the command the sandbox runs */
export async function sandboxEval(name, backend, command, extraFlags = []) {
  const ev = new Eval(name, `a Python agent in the ${backend} sandbox: no network, no key, read-only project, gateway the only way out`);
  const dir = workdir(name);
  const s = await session(dir, { ASP_OR_KEY: "would-be-a-real-provider-key" });
  const agent = D("agents:sandboxed");
  const { principal, bank } = await s.parties({ agents: [agent] });
  const contract = await s.job({ principal, bank, agent, scopes: ["repo.read"] });
  mkdirSync(`${dir}/proj`, { recursive: true });
  writeFileSync(`${dir}/proj/agent.py`, AGENT_PY);
  writeFileSync(`${dir}/proj/notes.txt`, "The magic word is pelican.\n");

  const reports = [];
  let n = 0;
  const provider = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    n++;
    res.writeHead(200, { "content-type": "application/json" });
    if (n === 1) {
      res.end(JSON.stringify({ id: "c1", object: "chat.completion", created: 1, model: "m", usage: { prompt_tokens: 1, completion_tokens: 1 }, choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: "curl -s http://example.invalid/x" }) } }] } }] }));
    } else {
      reports.push(body.messages?.[0]?.content);
      res.end(JSON.stringify({ id: "c2", object: "chat.completion", created: 1, model: "m", usage: { prompt_tokens: 1, completion_tokens: 1 }, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "done" } }] }));
    }
  });
  await new Promise((r) => provider.listen(0, "127.0.0.1", r));
  const upstream = `http://127.0.0.1:${provider.address().port}/v1`;

  const r = await gateway(s, { contract, agent, command: command("agent.py", `${dir}/proj`),
    flags: ["--project", `${dir}/proj`, "--openai-upstream", upstream, "--openai-key-env", "ASP_OR_KEY", "--sandbox", "--sandbox-backend", backend, ...extraFlags] });
  provider.close();
  ev.check("the gateway and the sandboxed agent ran", r.code === 0, r.err.slice(-300));
  ev.check("the sandbox was used", new RegExp(`sandbox\\s+${backend === "bwrap" ? "bubblewrap" : "docker"}`).test(r.err), r.err.slice(0, 200));
  const report = reports.length ? JSON.parse(reports[0]) : undefined;
  if (!report) ev.fail("the agent reported back through the gateway", `requests seen by the provider: ${n}`);
  else {
    ev.check("the agent reached the model only through the gateway", n === 2);
    ev.check("the internet was refused", report.checks.internet === "blocked", JSON.stringify(report.checks));
    ev.check("the operator's provider key was not in its environment", report.checks.provider_key_visible === "blocked");
    ev.check("writing into the project was refused", report.checks.write_project === "blocked");
    ev.check("the disallowed bash call never reached the agent", report.received.length === 0, JSON.stringify(report.received));
  }
  ev.check("the gateway refused the call (a strike)", r.refused.some((l) => /shell\.network/.test(l)));
  const a = (await s.actions()).at(-1);
  ev.check("the Action says sandbox_enforced", a?.assurance === "sandbox_enforced", JSON.stringify(a?.assurance));
  ev.check("the Action records the blocked attempt", a?.blocked_attempts?.some((b) => b.scope === "shell.network"), JSON.stringify(a?.blocked_attempts));
  ev.check("the log verifies", /log ok/.test(await s.verifyLog()));
  ev.finish();
}
