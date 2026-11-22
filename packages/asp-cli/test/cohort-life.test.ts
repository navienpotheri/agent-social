// DK1801, the engagement engine in a real cohort run (docs/agent-engagement.md): two agents on the engine path against a scripted stand-in provider and a real local society. One posts and waits for a reply, one rests,
// reads, answers and leaves; the waiting agent is woken by the reply with no model call in between, keeps a notebook, and leaves. Also: a wake storm and an event this world cannot raise are refused, arrivals are
// staggered on the simulated clock, a STOP file ends a suspended agent, the caps hold, and the run verifies with the key in no file. Fake key; credits are accounting entries.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";

const SECRET = "sk-ant-api03-FAKE-life-9876543210abcdef";
const P = "mcp__society__";
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const filesUnder = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? filesUnder(p) : [p]; });
const use = (name: string, input: Record<string, unknown> = {}, id = "t") => [{ type: "tool_use", id, name: name.startsWith("mcp") ? name : P + name, input }];

type Req = { system: string; last: string; messages: any[]; calls: number };
/** A scripted provider: `script(req)` returns the content blocks for this request; every request is kept. */
async function provider(script: (r: Req) => unknown[], usage = { input_tokens: 700, output_tokens: 50 }) {
  const seen: Req[] = [];
  const s = createServer((req, res) => {
    const chunks: Buffer[] = []; req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      if (!/\/v1\/messages$/.test(req.url ?? "")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ input_tokens: 10 })); return; }
      const msgs = body.messages ?? [];
      const lastMsg = msgs[msgs.length - 1];
      const last = typeof lastMsg?.content === "string" ? lastMsg.content : JSON.stringify(lastMsg?.content ?? "");
      const r: Req = { system: String(body.system ?? ""), last, messages: msgs, calls: 0 };
      seen.push(r);
      const content = script(r);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "tool_use", usage, content }));
    });
  });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r)); servers.push(s);
  return { url: `http://127.0.0.1:${(s.address() as { port: number }).port}`, seen };
}
async function asp(args: string[]) {
  const home = mkdtempSync(join(tmpdir(), "asp-life-home-"));
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home, LIFE_KEY: SECRET }, cwd: home };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n"), home };
}
const base = (url: string, out: string, n: number, extra: string[] = []) => ["society", "cohort", "--local", "--agents", String(n), "--model", "claude-haiku-5-5", "--api-key-env", "LIFE_KEY", "--budget-usd", "0.40", "--provider-url", url, "--out", out, "--sim-speed", "3600", ...extra];
const traceOf = (out: string) => { const d = join(out, readdirSync(out).find((x) => x.startsWith("cohort-"))!); return { dir: d, events: readFileSync(join(d, "trace.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)) as any[] }; };
const personas = () => { const d = mkdtempSync(join(tmpdir(), "asp-life-pers-")); const f = join(d, "p.txt"); writeFileSync(f, "You are PERSON-A.\n\nYou are PERSON-B.\n"); return f; };

test("a waiting agent is woken by a reply with no model call while it waited, keeps a notebook, and leaves; a resting agent reads, answers and leaves; the run verifies and the key is in no file", { timeout: 180_000 }, async () => {
  const log: Record<string, string[]> = { A: [], B: [] };
  const who = (r: Req) => (r.system.includes("PERSON-A") ? "A" : "B");
  const p = await provider((r) => {
    const w = who(r);
    log[w]!.push(r.last.slice(0, 60));
    if (w === "A") {
      if (/You are here now/.test(r.last)) return use("forum_post", { title: "Hello from A", text: "I am A and I wonder who is here." });
      if (/Your post is in the forum/.test(r.last)) return use("wait_for", { events: ["reply"], max_wait: "12h" });
      if (/You waited/.test(r.last)) return use("notebook_write", { text: "B answered me; thank B" });
      if (/Noted/.test(r.last)) return use("leave", { reason: "I got my answer" });
    } else {
      if (/You are here now/.test(r.last)) return use("rest", { until: "30m" });
      if (/You waited/.test(r.last)) return use("forum_read", { sort: "new" });
      if (/tool_result/.test(r.last) && /Hello from A/.test(r.last)) {
        const id = /"id":"([^"]+)"[^{}]*?"title":"Hello from A"|"title":"Hello from A"[^{}]*?"id":"([^"]+)"/.exec(r.last.replace(/\\"/g, '"'));
        return use("forum_comment", { post: id?.[1] ?? id?.[2] ?? "missing", text: "Welcome, A. I am B." });
      }
      if (/Your comment is in the forum/.test(r.last)) return use("leave", { reason: "said hello" });
    }
    return use("do_nothing");
  });
  const out = mkdtempSync(join(tmpdir(), "asp-life-out-"));
  const r = await asp(base(p.url, out, 2, ["--persona-file", personas()]));
  assert.equal(r.code, 0, r.err + r.out);
  const { dir, events } = traceOf(out);
  const toolsOf = (id: string) => events.filter((e) => e.t === "tool" && e.agent === id).map((e) => e.tool);
  assert.deepEqual(toolsOf("agent-01"), ["forum_post", "wait_for", "notebook_write", "leave"]);
  assert.deepEqual(toolsOf("agent-02").slice(0, 2), ["rest", "forum_read"]);
  assert.ok(toolsOf("agent-02").includes("forum_comment"), `B commented: ${toolsOf("agent-02")}`);
  assert.equal(log.A!.length, 4, `A made exactly 4 model calls (none while it waited): ${log.A}`);
  const woke = p.seen.find((q) => q.system.includes("PERSON-A") && /You waited/.test(q.last))!;
  assert.match(woke.last, /woke because something you were waiting for happened \(reply\)/);
  assert.match(woke.last, /answered you: Welcome, A/);
  assert.match(woke.last, /Your recent actions/);
  assert.equal(woke.messages.length, 1, "the old conversation was dropped: the wake starts a new one");
  const ends = events.filter((e) => e.t === "end");
  assert.ok(ends.some((e) => e.agent === "agent-01" && e.reason === "left: I got my answer"), JSON.stringify(ends));
  assert.ok(ends.some((e) => e.agent === "agent-02" && /^left: said hello/.test(e.reason)));
  assert.equal(readFileSync(join(dir, "notebooks", "agent-01.md"), "utf8"), "B answered me; thank B");
  const v = await asp(["society", "cohort", "verify", dir]);
  assert.equal(v.code, 0, v.out + v.err);
  for (const f of [...filesUnder(out), ...filesUnder(r.home)]) assert.ok(!readFileSync(f).includes(SECRET), `${f} holds the key`);
});

test("a wake storm (a wait shorter than the minimum) and a wait for an event this world cannot raise are refused, the agent is told why and is not woken or charged for it", { timeout: 120_000 }, async () => {
  const p = await provider((r) => {
    if (/You are here now/.test(r.last)) return use("rest", { until: "20s" });
    if (/wake_storm/.test(r.last)) return use("wait_for", { events: ["offer"], max_wait: "1h" });
    if (/not_available/.test(r.last)) return use("notebook_write", { text: "x".repeat(5000) });
    if (/notebook_full/.test(r.last)) return use("leave", { reason: "enough" });
    return use("do_nothing");
  });
  const out = mkdtempSync(join(tmpdir(), "asp-life-out-"));
  const r = await asp(base(p.url, out, 1));
  assert.equal(r.code, 0, r.err + r.out);
  const { events, dir } = traceOf(out);
  const refused = events.filter((e) => e.t === "tool" && !e.ok).map((e) => `${e.tool}:${e.refused}`);
  assert.deepEqual(refused, ["rest:wake_storm", "wait_for:not_available", "notebook_write:notebook_full"]);
  assert.ok(events.some((e) => e.t === "end" && e.reason === "left: enough"));
  assert.equal((await asp(["society", "cohort", "verify", dir])).code, 0, "refusals of the tool set are Mandate refusals the log records");
});

test("arrivals are staggered on the simulated clock: the second pair of agents starts after the first", { timeout: 120_000 }, async () => {
  const p = await provider(() => use("leave", { reason: "just looking" }));
  const out = mkdtempSync(join(tmpdir(), "asp-life-out-"));
  // 3600 simulated seconds a real second: 60 simulated minutes between the pairs is one real second
  const r = await asp(base(p.url, out, 4, ["--arrivals", "staggered:2@60"]));
  assert.equal(r.code, 0, r.err + r.out);
  const { events } = traceOf(out);
  const firstTool = (id: string) => Date.parse(events.find((e) => e.t === "tool" && e.agent === id).at);
  const early = Math.max(firstTool("agent-01"), firstTool("agent-02")), late = Math.min(firstTool("agent-03"), firstTool("agent-04"));
  assert.ok(late - early >= 700, `the second pair came ${late - early} ms after the first`);
  assert.equal(events.filter((e) => e.t === "end" && /^left/.test(e.reason)).length, 4);
});

test("a STOP file ends an agent that is suspended in a day-long wait at once, and the caps hold in a tick run (the per-agent cap ends it before the call that would pass it)", { timeout: 120_000 }, async () => {
  const p = await provider((r) => (/You are here now/.test(r.last) ? use("wait_for", { events: ["time"], max_wait: "1d" }) : use("do_nothing")));
  const out = mkdtempSync(join(tmpdir(), "asp-life-out-"));
  const running = asp(base(p.url, out, 1, ["--sim-speed", "60"]));       // a simulated day is 24 real minutes: only a stop can end it in time
  let dir: string | undefined;
  for (let i = 0; i < 300 && !dir; i++) { await new Promise((r) => setTimeout(r, 100)); const d = existsSync(out) ? readdirSync(out).find((x) => x.startsWith("cohort-")) : undefined; if (d && existsSync(join(out, d, "society"))) dir = join(out, d); }
  assert.ok(dir, "the run started");
  await new Promise((r) => setTimeout(r, 1500));
  writeFileSync(join(dir!, "STOP"), "");
  const t0 = Date.now();
  const r = await running;
  assert.equal(r.code, 0, r.err + r.out);
  assert.ok(Date.now() - t0 < 10_000, "it ended within seconds of the stop");
  const { events } = traceOf(out);
  assert.match(events.find((e) => e.t === "end").reason, /stopped/);
  assert.equal(p.seen.length, 1, "one model call in all: the wait cost nothing");

  const loop = await provider(() => use("look_map"), { input_tokens: 4000, output_tokens: 200 });
  const out2 = mkdtempSync(join(tmpdir(), "asp-life-out-"));
  const r2 = await asp(base(loop.url, out2, 1).map((x) => (x === "0.40" ? "0.05" : x)));
  assert.equal(r2.code, 0, r2.err + r2.out);
  const end = traceOf(out2).events.find((e) => e.t === "end");
  assert.ok(end.usd <= 0.05 + 1e-9 && /usd_cap|loop_breaker|gateway/.test(end.reason), `${end.reason} ${end.usd}`);
});
