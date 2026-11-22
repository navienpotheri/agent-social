// DK1801, one agent end to end on the real engine path (a gateway for the agent, the society's tools, the signed trace) against a scripted stand-in that speaks the provider's interface: the dollar cap, the stop
// file, no key in any file, the log and the run verifying, the report written. A fake key; no network beyond 127.0.0.1.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";

const SECRET = "sk-ant-api03-FAKE-engine-e2e-9876543210abcdef";
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const P = "mcp__society__";
const filesUnder = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? filesUnder(p) : [p]; });

/** Scripted by the number of replies the conversation holds; `delayMs` slows every reply. */
async function provider(steps: unknown[][], delayMs = 0, usage = { input_tokens: 900, output_tokens: 60 }) {
  const s = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let body: any = {}; try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* */ }
      if (!/\/v1\/messages$/.test(req.url ?? "")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ input_tokens: 10 })); return; }
      const turns = (body.messages ?? []).filter((m: any) => m.role === "assistant").length;
      setTimeout(() => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "tool_use", usage, content: steps[Math.min(turns, steps.length - 1)] })); }, delayMs);
    });
  });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r)); servers.push(s);
  return `http://127.0.0.1:${(s.address() as { port: number }).port}`;
}
async function asp(args: string[]) {
  const home = mkdtempSync(join(tmpdir(), "asp-engine-e2e-home-"));
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home, E2E_KEY: SECRET }, cwd: home };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n"), home };
}
const base = (url: string, out: string, extra: string[] = []) => ["society", "cohort", "--local", "--agents", "1", "--model", "claude-haiku-5-5", "--api-key-env", "E2E_KEY", "--budget-usd", "0.40", "--provider-url", url, "--out", out, ...extra];
const runDirOf = (out: string) => join(out, readdirSync(out).find((d) => d.startsWith("cohort-"))!);

test("one agent on the engine path: it reads, is refused a shell, posts, stops by itself; the report is written, the log and the run verify, and the key is in no file", { timeout: 120_000 }, async () => {
  const url = await provider([
    [{ type: "text", text: "Charters first." }, { type: "tool_use", id: "t1", name: `${P}look_charters`, input: {} }],
    [{ type: "text", text: "A shell." }, { type: "tool_use", id: "t2", name: "Bash", input: { command: "ls" } }],
    [{ type: "tool_use", id: "t4", name: `${P}forum_post`, input: { title: "Hello", text: "I am new here." } }],
    [{ type: "tool_use", id: "t5", name: `${P}stop_exploring`, input: { why: "enough" } }],
  ]);
  const out = mkdtempSync(join(tmpdir(), "asp-engine-e2e-out-"));
  const r = await asp(base(url, out));
  assert.equal(r.code, 0, r.err + r.out);
  const dir = runDirOf(out);
  assert.ok(existsSync(join(dir, "report.md")), "the report is written");
  const md = readFileSync(join(dir, "report.md"), "utf8");
  assert.match(md, /Refusals by rule: gateway 1/);
  assert.match(md, /finished 1/);
  const v = await asp(["society", "cohort", "verify", dir]);
  assert.equal(v.code, 0, v.out + v.err);
  assert.match(v.out, /the run verifies/);
  for (const f of [...filesUnder(out), ...filesUnder(r.home)]) assert.ok(!readFileSync(f).includes(SECRET), `${f} holds the key`);
  assert.ok(!r.out.includes(SECRET) && !r.err.includes(SECRET));
});

test("the dollar cap ends the agent before the call that would pass it, and the run still verifies", { timeout: 120_000 }, async () => {
  const loop = [{ type: "tool_use", id: "t", name: `${P}look_map`, input: {} }];
  const url = await provider([loop], 0, { input_tokens: 4000, output_tokens: 200 });
  const out = mkdtempSync(join(tmpdir(), "asp-engine-e2e-cap-"));
  const r = await asp(base(url, out).map((x) => (x === "0.40" ? "0.05" : x)));
  assert.equal(r.code, 0, r.err + r.out);
  const trace = readFileSync(join(runDirOf(out), "trace.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  const end = trace.find((e) => e.t === "end");
  assert.match(end.reason, /usd_cap|loop_breaker|gateway/, end.reason);
  assert.ok(end.usd <= 0.05 + 1e-9, `spent ${end.usd} within the 0.05 cap`);
  assert.equal((await asp(["society", "cohort", "verify", runDirOf(out)])).code, 0);
});

test("a STOP file in the run folder ends the agent at its next step", { timeout: 120_000 }, async () => {
  const url = await provider([[{ type: "tool_use", id: "t", name: `${P}look_map`, input: {} }]], 400);
  const out = mkdtempSync(join(tmpdir(), "asp-engine-e2e-stop-"));
  mkdirSync(out, { recursive: true });
  const running = asp(base(url, out, ["--max-turns", "200"]));
  let dir: string | undefined;
  for (let i = 0; i < 200 && !dir; i++) { await new Promise((r) => setTimeout(r, 100)); const d = existsSync(out) ? readdirSync(out).find((x) => x.startsWith("cohort-")) : undefined; if (d && existsSync(join(out, d, "society"))) dir = join(out, d); }
  assert.ok(dir, "the run started");
  await new Promise((r) => setTimeout(r, 1200));
  writeFileSync(join(dir!, "STOP"), "");
  const t0 = Date.now();
  const r = await running;
  assert.equal(r.code, 0, r.err + r.out);
  assert.ok(Date.now() - t0 < 15_000, "it ended within seconds of the stop");
  const trace = readFileSync(join(dir!, "trace.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  assert.match(trace.find((e) => e.t === "end").reason, /stopped/);
  assert.ok(trace.some((e) => e.t === "stop"));
});
