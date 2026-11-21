/**
 * A quarantine that begins while a session runs (register row DK96; clinic.md "A job already running"): the gateway keeps judging against the scope list it was started with, and `watchQuarantine` keeps that
 * list in step with the Clinic's freeze, so a risky call made after the freeze is refused within the polling time, and the scopes come back when it is released. A real gateway, a fake log and a fake model.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createGateway, type Gateway } from "@agent-social/asp-package";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { rewriteHookScopes, watchQuarantine } from "../src/clinic.ts";

const servers: Server[] = [];
const gateways: Gateway[] = [];
after(async () => { for (const s of servers) s.close(); for (const g of gateways) await g.close(); });
const AGENT = "did:web:example.com:agents:coder";
const POLL = 40;

/** A fake log whose quarantine records can be added and released while the gateway runs. */
function fakeLog() {
  const records: { id: string; type: string; body: Record<string, unknown> }[] = [];
  return {
    records,
    handle: { log: { quarantinesOf: async () => records.map((r) => ({ ...r, issuer: "did:web:example.com:clinic", issued_at: "2026-11-15T10:00:00Z", subject: null, prev: null })) } } as never,
    freeze: (level: "observe" | "halt") => records.push({ id: `q-${records.length}`, type: "asp.quarantine/v0.2", body: { members: [AGENT], level, until: "2099-01-01T00:00:00Z" } }),
    release: () => { const q = records.filter((r) => r.type === "asp.quarantine/v0.2").at(-1)!; records.push({ id: `r-${records.length}`, type: "asp.quarantine_release/v0.2", body: { quarantine: q.id, member: AGENT } }); },
  };
}

async function modelAskingFor(call: { name: string; args: unknown }) {
  const server = createServer(async (req, res) => {
    for await (const _ of req) { /* drain */ }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "c", object: "chat.completion", created: 1, model: "m", usage: { prompt_tokens: 3, completion_tokens: 2 }, choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "a", type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] } }] }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
}
const asked = async (gwUrl: string) => { const r: any = await (await fetch(`${gwUrl}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "m", messages: [] }) })).json(); if (!r.choices) throw new Error(`the gateway answered without choices: ${JSON.stringify(r).slice(0, 400)}`); return (r.choices[0].message.tool_calls ?? []).length; };
const until = async (fn: () => Promise<boolean>, ms = 2000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 15)); } return false; };

test("a gateway that started before a freeze refuses a risky call made after it, within the polling time, and allows it again after the release", async () => {
  const original = ["repo.read", "shell.exec"];
  const live = [...original];
  const upstream = await modelAskingFor({ name: "bash", args: { command: "node build.js" } });
  // The test polls the gateway while the risky call is refused, and each refusal is a blocked attempt; the default of 3 would stop the run as probing
  // before the quarantine is checked, so the limit is raised for this test only (the probing rule has its own tests).
  const g = createGateway({ openaiUpstream: upstream, scopes: live, maxStrikes: 100000 });
  const port = await g.listen(); gateways.push(g);
  const url = `http://127.0.0.1:${port}`;
  const log = fakeLog();
  const said: string[] = [];
  const stop = watchQuarantine(log.handle, AGENT, original, live, POLL, () => new Date().toISOString(), (l) => said.push(l));
  try {
    assert.equal(await asked(url), 1, "before the freeze the call is allowed");
    log.freeze("observe");
    const t = Date.now();
    assert.ok(await until(async () => (await asked(url)) === 0), "the risky call is refused after the freeze");
    assert.ok(Date.now() - t < 5 * POLL + 500, `refused within the polling time (${Date.now() - t} ms)`);
    assert.deepEqual(live, ["repo.read"], "the Mandate's own list is untouched and the live one lost the risky scope");
    assert.deepEqual(original, ["repo.read", "shell.exec"]);
    assert.match(said.join("\n"), /was quarantined by the Clinic while this session ran \(observe, q-0/);
    log.release();
    assert.ok(await until(async () => (await asked(url)) === 1), "after the release the scope is back");
    assert.deepEqual(live, ["repo.read", "shell.exec"]);
    assert.match(said.join("\n"), /the quarantine of did:web:example\.com:agents:coder has ended/);
  } finally { stop(); }
});

test("a halt withholds every scope, and a log that cannot be read leaves the list as it is", async () => {
  const live = ["repo.read", "tests.run"];
  const log = fakeLog();
  const stop = watchQuarantine(log.handle, AGENT, ["repo.read", "tests.run"], live, POLL, () => new Date().toISOString(), () => {});
  try {
    log.freeze("halt");
    assert.ok(await until(async () => live.length === 0), "halt takes every scope");
  } finally { stop(); }
  const kept = ["repo.read"];
  const broken = watchQuarantine({ log: { quarantinesOf: async () => { throw new Error("no such read"); } } } as never, AGENT, ["repo.read"], kept, POLL, () => new Date().toISOString(), () => {});
  await new Promise((r) => setTimeout(r, 4 * POLL));
  broken();
  assert.deepEqual(kept, ["repo.read"]);
});

// ---- The hooked runtimes (DK500): the pre-call hook reads asp-mandate.json for each call; the run rewrites its scope list with the freeze and again with the release.
const CLAUDE_HOOK = fileURLToPath(new URL("../../asp-package/src/adapters/claude-code-mandate-hook.mjs", import.meta.url));
const AGY_HOOK = fileURLToPath(new URL("../../asp-package/src/adapters/antigravity-mandate-hook.mjs", import.meta.url));

test("the Claude Code hook follows a freeze that began after it was set up: its next risky call is refused, and allowed again after the release; the rest of the Mandate file is kept", async () => {
  const run = mkdtempSync(join(tmpdir(), "asp-qh-"));
  const plugin = join(run, "plugin");
  mkdirSync(join(plugin, "scripts"), { recursive: true });
  writeFileSync(join(plugin, "scripts", "asp-mandate.mjs"), readFileSync(CLAUDE_HOOK));
  const file = join(plugin, "asp-mandate.json");
  writeFileSync(file, JSON.stringify({ scopes: ["repo.read", "shell.exec"], hosts: ["docs.example.org"] }));
  const fire = (cmd: string) => spawnSync(process.execPath, [join(plugin, "scripts", "asp-mandate.mjs")], { input: JSON.stringify({ tool_name: "Bash", tool_input: { command: cmd }, tool_use_id: "t", session_id: "s" }), encoding: "utf8" });
  const original = ["repo.read", "shell.exec"];
  const log = fakeLog();
  const stop = watchQuarantine(log.handle, AGENT, original, [...original], POLL, () => new Date().toISOString(), () => {}, (scopes) => { rewriteHookScopes(file, scopes); });
  try {
    assert.equal(fire("node build.js").status, 0, "before the freeze the hooked call is allowed");
    log.freeze("observe");
    assert.ok(await until(async () => fire("node build.js").status === 2), "the risky call is refused after the freeze");
    assert.match(fire("node build.js").stderr, /shell\.exec is not granted/);
    const kept = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(kept.scopes, ["repo.read"]);
    assert.deepEqual(kept.hosts, ["docs.example.org"], "everything else in the file is kept");
    assert.deepEqual(original, ["repo.read", "shell.exec"], "the Mandate's own list is untouched");
    log.release();
    assert.ok(await until(async () => fire("node build.js").status === 0), "after the release the scope is back");
  } finally { stop(); }
});

test("the Antigravity hook follows the freeze the same way, and a missing Mandate file is left alone", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agy-qh-"));
  mkdirSync(join(dir, "asp-hook"));
  writeFileSync(join(dir, "asp-hook", "asp-mandate-hook.mjs"), readFileSync(AGY_HOOK));
  const file = join(dir, "asp-hook", "asp-mandate.json");
  writeFileSync(file, JSON.stringify({ scopes: ["repo.read", "shell.exec"] }));
  const decision = () => { const r = spawnSync(process.execPath, [join(dir, "asp-hook", "asp-mandate-hook.mjs"), "pre"], { input: JSON.stringify({ toolCall: { name: "run_command", args: { CommandLine: "node build.js" } }, stepIdx: 1 }), encoding: "utf8" }); return JSON.parse(r.stdout.trim()).decision as string; };
  const original = ["repo.read", "shell.exec"];
  const log = fakeLog();
  const stop = watchQuarantine(log.handle, AGENT, original, [...original], POLL, () => new Date().toISOString(), () => {}, (scopes) => { rewriteHookScopes(file, scopes); });
  try {
    assert.equal(decision(), "allow");
    log.freeze("halt");
    assert.ok(await until(async () => decision() === "deny"), "a halt takes every scope from the hook");
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).scopes, []);
    log.release();
    assert.ok(await until(async () => decision() === "allow"));
  } finally { stop(); }
  assert.equal(rewriteHookScopes(join(dir, "nowhere.json"), []), false, "no file, nothing written");
});
