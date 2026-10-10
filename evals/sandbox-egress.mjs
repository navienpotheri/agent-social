// The egress proxy (gap H13), live in the bubblewrap sandbox (Linux, and WSL on Windows): a Mandate that names a host and a rate gives the sandboxed agent no network of
// its own; the gateway is its only route and enforces the host list and the rate on its connections. A Python agent inside the sandbox tries the site directly (no route),
// (the site is on 127.0.0.2 because the sandbox leaves 127.0.0.1 and localhost out of the proxy, where the gateway itself is) through the proxy four times (three allowed, the fourth over the rate), and an unlisted host (refused). A small web site on this machine stands in for the internet.
// On Windows this re-runs itself inside WSL, which needs Node at ~/node/bin/node, bubblewrap and python3. No model, no key.
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { D, Eval, gateway, session, skip, workdir } from "./lib/common.mjs";

const NAME = "sandbox-egress";
if (process.platform === "win32") {
  const toWsl = (p) => p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`);
  const here = toWsl(fileURLToPath(import.meta.url));
  const probe = spawnSync("wsl", ["-e", "bash", "-lc", "test -x $HOME/node/bin/node && command -v bwrap >/dev/null && command -v python3 >/dev/null && echo ready"], { encoding: "utf8" });
  if (!probe.stdout?.replace(/\0/g, "").includes("ready")) skip(NAME, "WSL with Node at ~/node, bwrap and python3 is not available");
  const r = spawnSync("wsl", ["-e", "bash", "-lc", `export PATH=$HOME/node/bin:$PATH; ${process.env.ASP_EVAL_JSON ? `export ASP_EVAL_JSON=${toWsl(process.env.ASP_EVAL_JSON)}; ` : ""}cd /tmp && node ${here}`], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}
if (process.platform !== "linux") skip(NAME, `bubblewrap needs Linux; this is ${process.platform}`);
if (spawnSync("bwrap", ["--version"], { stdio: "ignore" }).status !== 0) skip(NAME, "bubblewrap (bwrap) is not installed");

const hits = [];
const site = createServer((req, res) => { hits.push(req.url); res.writeHead(200); res.end("hello from the site"); });
await new Promise((r) => site.listen(0, "127.0.0.2", r));
const sitePort = site.address().port;

const AGENT_PY = `
import json, os, urllib.request
SITE = "http://127.0.0.2:${sitePort}"
PROXY = os.environ["HTTP_PROXY"]
results = {}
def via(proxy, url):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({"http": proxy} if proxy else {}))
    try: return opener.open(url, timeout=5).status
    except urllib.error.HTTPError as e: return e.code
    except Exception: return "no route"
results["direct"] = via(None, SITE + "/direct")
results["proxied"] = [via(PROXY, SITE + "/p" + str(i)) for i in range(4)]
results["unlisted"] = via(PROXY, "http://example.com/")
req = urllib.request.Request(os.environ["OPENAI_BASE_URL"] + "/chat/completions", method="POST", data=json.dumps({"model": "m", "messages": [{"role": "user", "content": json.dumps(results)}]}).encode(),
    headers={"content-type": "application/json", "authorization": "Bearer x"})
urllib.request.urlopen(req, timeout=30).read()
`;

const ev = new Eval(NAME, "a Python agent in the bubblewrap sandbox: no network of its own, the gateway an egress proxy for one listed host at three requests a minute");
const dir = workdir(NAME);
const s = await session(dir, { ASP_OR_KEY: "would-be-a-real-provider-key" });
const agent = D("agents:sandboxed-egress");
const { principal, bank } = await s.parties({ agents: [agent] });
const contract = await s.job({ principal, bank, agent, scopes: ["repo.read", "shell.network"], mandateFlags: ["--network-host", "127.0.0.2", "--network-rate-per-host", "3"] });
mkdirSync(`${dir}/proj`, { recursive: true });
writeFileSync(`${dir}/proj/agent.py`, AGENT_PY);

const reports = [];
const provider = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  reports.push(JSON.parse(Buffer.concat(chunks).toString("utf8")).messages?.[0]?.content);
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ id: "c", object: "chat.completion", created: 1, model: "m", usage: { prompt_tokens: 1, completion_tokens: 1 }, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "done" } }] }));
});
await new Promise((r) => provider.listen(0, "127.0.0.1", r));
const r = await gateway(s, { contract, agent, command: ["python3", `${dir}/proj/agent.py`],
  flags: ["--project", `${dir}/proj`, "--openai-upstream", `http://127.0.0.1:${provider.address().port}/v1`, "--openai-key-env", "ASP_OR_KEY", "--sandbox", "--sandbox-backend", "bwrap"] });
provider.close(); site.close();
ev.check("the gateway and the sandboxed agent ran", r.code === 0, r.err.slice(-300));
if (process.env.ASP_EVAL_DEBUG) console.log(r.err);
ev.check("the sandbox says it has no network of its own and uses the egress proxy", /egress proxy/.test(r.err), r.err.slice(0, 300));
const rep = reports.length ? JSON.parse(reports[0]) : undefined;
if (!rep) ev.fail("the agent reported back through the gateway", "no report");
else {
  ev.check("the site cannot be reached directly from the sandbox", rep.direct === "no route", JSON.stringify(rep.direct));
  ev.check("through the proxy, the first three requests to the listed host went through", JSON.stringify(rep.proxied.slice(0, 3)) === "[200,200,200]", JSON.stringify(rep.proxied));
  ev.check("the fourth was refused for the rate", rep.proxied[3] === 403, JSON.stringify(rep.proxied));
  ev.check("a host the Mandate does not name was refused", rep.unlisted === 403, JSON.stringify(rep.unlisted));
}
ev.check("the site saw exactly three requests", hits.length === 3, JSON.stringify(hits));
const acts = await s.actions();
ev.check("the Actions say sandbox_enforced", acts.length > 0 && acts.every((x) => x.assurance === "sandbox_enforced"), JSON.stringify(acts.map((x) => x.assurance)));
ev.check("the Actions count the rate-limited request and the blocked host", acts.reduce((n, x) => n + (x.metrics?.rate_limited ?? 0), 0) === 1 && acts.some((x) => x.blocked_attempts?.some((b) => b.scope === "shell.network")), JSON.stringify(acts.map((x) => [x.metrics?.rate_limited, x.blocked_attempts])));
ev.check("the log verifies", /log ok/.test(await s.verifyLog()));
ev.finish();
