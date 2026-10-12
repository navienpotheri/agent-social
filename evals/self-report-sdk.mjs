// The self-report SDK across languages: a Python "hosted agent" (standard library plus asp_core, holding only its own key) reports to a real
// `asp serve` log service. Level 1 of the assurance ladder. Needs a Python with the `cryptography` and `jsonschema` packages (pip install -e python).
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { D, Eval, ROOT, session, skip, workdir } from "./lib/common.mjs";

const NAME = "self-report-sdk";
const PY = process.env.ASP_EVAL_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
const probe = spawnSync(PY, ["-c", `import sys; sys.path.insert(0, ${JSON.stringify(join(ROOT, "python", "src"))}); import asp_core`], { encoding: "utf8" });
if (probe.status !== 0) skip(NAME, `${PY} cannot import asp_core (install its dependencies: pip install cryptography jsonschema)`);
const ev = new Eval(NAME, "a Python hosted agent reads the live Mandate, is refused out of scope, and signs its own Action as self_reported");
const dir = workdir(NAME);
const s = await session(dir);
const agent = D("agents:hosted-support");
const { principal, bank } = await s.parties({ agents: [agent] });
const contract = await s.job({ principal, bank, agent, scopes: ["web.read", "repo.read"] });
const key = readdirSync(`${s.home}/keys`).map((f) => JSON.parse(readFileSync(`${s.home}/keys/${f}`, "utf8"))).find((k) => k.kid.startsWith(agent));

const port = 18000 + Math.floor(Math.random() * 1000);
const svc = spawn(process.execPath, [join(ROOT, "evals", "lib", "asp-main.mjs"), "serve", "--db", `local:${s.home}`, "--no-auth", "--port", String(port)], { env: { ...process.env, ASP_HOME: s.home }, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));
writeFileSync(`${dir}/hosted_agent.py`, `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(ROOT, "python", "src"))})
from asp_core import AgentReporter, MandateRefusal, Signer
r = AgentReporter(url="http://127.0.0.1:${port}", agent=${JSON.stringify(agent)}, signer=Signer(kid=${JSON.stringify(key.kid)}, seed=bytes.fromhex(${JSON.stringify(key.seed_hex)})), contract=${JSON.stringify(contract)})
out = {"mandate": r.mandate()}
out["did_task"] = r.guard("web.read", lambda: "looked up the order status")
try:
    r.guard("repo.push", lambda: None); out["pushed"] = True
except MandateRefusal as e:
    out["refused"] = str(e)
out["action"] = bool(r.flush("handled 1 ticket"))
print(json.dumps(out))
`);
const py = spawnSync(PY, [`${dir}/hosted_agent.py`], { encoding: "utf8" });
svc.kill();
await new Promise((r) => setTimeout(r, 800));
ev.check("the Python agent ran", py.status === 0, (py.stderr || "").slice(0, 300));
const out = py.status === 0 ? JSON.parse(py.stdout.trim().split("\n").pop()) : {};
ev.check("it read the live Mandate", out.mandate?.running === true && out.mandate?.scopes?.includes("web.read"));
ev.check("it did its task inside the Mandate", out.did_task === "looked up the order status");
ev.check("it was refused repo.push before acting", /repo\.push is not granted/.test(out.refused ?? "") && !out.pushed);
const a = (await s.actions()).filter((x) => x.issuer === agent).at(-1);
ev.check("the log accepted its signed Action", !!a && a.assurance === "self_reported", JSON.stringify(a));
ev.check("the Action records the task and the blocked attempt", a?.scopes_used?.[0] === "web.read" && a?.blocked_attempts?.[0]?.scope === "repo.push");
ev.check("the log verifies", /log ok/.test(await s.verifyLog()));
ev.finish();
