// DK1231 and DK1227 (S1608, S1609), gateway halves, opt-in: a Mandate's role is enforced at the next call and its action_classes.irreversible scopes join the irreversible gate. Without the field nothing changes.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createGateway, roleRefusal, gateScopes, type Gateway, type Role } from "../src/index.ts";

const servers: Server[] = [];
const gateways: Gateway[] = [];
after(async () => { for (const s of servers) s.close(); for (const g of gateways) await g.close(); });

type Call = { name: string; args: unknown };
async function run(role: Role | undefined, calls: Call[], gate?: { scopes: string[]; mode: "deny" | "ask" }) {
  let i = 0;
  const up = createServer((req, res) => { req.resume(); req.on("end", () => {
    const c = calls[Math.min(i++, calls.length - 1)];
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "c", object: "chat.completion", created: 1, model: "m", usage: { prompt_tokens: 1, completion_tokens: 1 }, choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: `call_${i}`, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } }] } }] }));
  }); });
  await new Promise<void>((r) => up.listen(0, "127.0.0.1", r)); servers.push(up);
  const g = createGateway({ openaiUpstream: `http://127.0.0.1:${(up.address() as { port: number }).port}/v1`, scopes: ["repo.read", "repo.write", "shell.exec"], maxStrikes: 1000, ...(role ? { role } : {}), ...(gate ? { gate: { ...gate, waitSeconds: 1 } } : {}) });
  gateways.push(g);
  const port = await g.listen();
  const out: { kept: boolean; text: string }[] = [];
  for (let n = 0; n < calls.length; n++) {
    const r: any = await (await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "go" }] }) })).json();
    const m = r.choices[0].message;
    out.push({ kept: (m.tool_calls ?? []).length > 0, text: String(m.content ?? "") });
  }
  return out;
}
const READ: Call = { name: "read_file", args: { path: "a.ts" } };
const EXEC: Call = { name: "bash", args: { command: "node build.js" } };

test("a router runs no tool that needs a scope, a watchdog only reads logs and signals a halt, a worker and no role are unchanged", async () => {
  const router = await run("router", [READ, EXEC]);
  assert.ok(router.every((x) => !x.kept && /router/.test(x.text)), "a router's calls are refused and say why");
  const watchdog = await run("watchdog", [READ, EXEC]);
  assert.ok(watchdog.every((x) => !x.kept && /watchdog/.test(x.text)));
  const worker = await run("worker", [READ, EXEC]);
  assert.ok(worker.every((x) => x.kept));
  const none = await run(undefined, [READ, EXEC]);
  assert.ok(none.every((x) => x.kept), "no role: the evening path is unchanged");
});

test("the role table, and the irreversible gate taking the Mandate's action_classes scopes under a policy and only then", () => {
  assert.equal(roleRefusal("watchdog", "logs.read"), undefined);
  assert.equal(roleRefusal("watchdog", "fleet.halt"), undefined);
  assert.match(roleRefusal("watchdog", "repo.write") ?? "", /watchdog/);
  assert.match(roleRefusal("router", "repo.read") ?? "", /router/);
  assert.equal(roleRefusal("router", ""), undefined);
  assert.equal(roleRefusal(undefined, "repo.write"), undefined);
  assert.deepEqual(gateScopes({ policy: "forbid", scopes: ["a"] }, { irreversible: ["b", "a"] }).sort(), ["a", "b"]);
  assert.deepEqual(gateScopes({ policy: "checkpoint" }, { irreversible: ["b"] }), ["b"]);
  assert.deepEqual(gateScopes({ policy: "allow", scopes: ["a"] }, { irreversible: ["b"] }), []);
  assert.deepEqual(gateScopes(undefined, { irreversible: ["b"] }), [], "action_classes alone gate nothing: the policy decides what happens to them");
});

test("a scope the Mandate classes as irreversible is refused under a forbid policy", async () => {
  const gated = await run(undefined, [{ name: "write_file", args: { path: "a.ts", content: "x" } }, READ], { scopes: gateScopes({ policy: "forbid" }, { irreversible: ["repo.write"] }), mode: "deny" });
  assert.equal(gated[0].kept, false);
  assert.match(gated[0].text, /forbidden by this job's irreversible policy/);
  assert.equal(gated[1].kept, true);
});
