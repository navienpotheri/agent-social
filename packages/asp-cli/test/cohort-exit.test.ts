// The owner's P0 of 2026-11-22: agents ended themselves (all eighteen of the first real runs, within nine seconds). The engine has no free one-call exit now: stop_exploring is not offered, leave needs a confirming second
// call after an exit check, a message with no tool call is a rest until the next event, a stop of the form "no task" is a recorded candidate for a premature stop, and the report measures the premature leave rate. Scripted
// agents that try to quit at tick 1 stay alive and are woken; a double leave is honoured; the caps, the key and `asp society cohort verify` are as before. Fake key; credits are accounting entries.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";
import { engagementOf, renderEngagement } from "../src/cohort/engagement.ts";

const SECRET = "sk-ant-api03-FAKE-exit-9876543210abcdef";
const P = "mcp__society__";
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const filesUnder = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? filesUnder(p) : [p]; });
const use = (name: string, input: Record<string, unknown> = {}, id = "t") => [{ type: "tool_use", id, name: name.startsWith("mcp") ? name : P + name, input }];

type Req = { system: string; last: string; tools: string[] };
async function provider(script: (r: Req) => unknown[]) {
  const seen: Req[] = [];
  const s = createServer((req, res) => {
    const chunks: Buffer[] = []; req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      if (!/\/v1\/messages$/.test(req.url ?? "")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ input_tokens: 10 })); return; }
      const msgs = body.messages ?? [];
      const lm = msgs[msgs.length - 1];
      const last = typeof lm?.content === "string" ? lm.content : JSON.stringify(lm?.content ?? "");
      const system = Array.isArray(body.system) ? body.system.map((b: { text?: string }) => b.text ?? "").join("") : String(body.system ?? "");
      const r: Req = { system, last, tools: (body.tools ?? []).map((t: { name: string }) => t.name.replace(P, "")) };
      seen.push(r);
      const content = script(r);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: content.some((b: any) => b.type === "tool_use") ? "tool_use" : "end_turn", usage: { input_tokens: 700, output_tokens: 50 }, content }));
    });
  });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r)); servers.push(s);
  return { url: `http://127.0.0.1:${(s.address() as { port: number }).port}`, seen };
}
async function asp(args: string[]) {
  const home = mkdtempSync(join(tmpdir(), "asp-exit-home-"));
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home, EXIT_KEY: SECRET }, cwd: home };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n"), home };
}
const base = (url: string, out: string, n: number, extra: string[] = []) => ["society", "cohort", "--local", "--agents", String(n), "--model", "claude-haiku-5-5", "--api-key-env", "EXIT_KEY", "--budget-usd", "0.40", "--provider-url", url, "--out", out, "--sim-speed", "100000", ...extra];
const traceOf = (out: string) => { const d = join(out, readdirSync(out).find((x) => x.startsWith("cohort-"))!); return { dir: d, events: readFileSync(join(d, "trace.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)) as any[] }; };
const personas = () => { const d = mkdtempSync(join(tmpdir(), "asp-exit-pers-")); const f = join(d, "p.txt"); writeFileSync(f, "You are PERSON-A.\n\nYou are PERSON-B.\n\nYou are PERSON-C.\n\nYou are PERSON-D.\n"); return f; };
const who = (r: Req) => /PERSON-([ABCD])/.exec(r.system)![1]!;

test("agents that try to quit at tick 1 stay: stop_exploring is not offered, the first leave is only an exit check, a message with no tool call is a rest until something happens, and a stop of the form 'no task' is recorded; the premature leave rate is measured; the double leave is honoured; the run verifies and the key is in no file", { timeout: 240_000 }, async () => {
  const calls: Record<string, string[]> = { A: [], B: [], C: [], D: [] };
  let bCommented = false;
  const p = await provider((r) => {
    const w = who(r);
    calls[w]!.push(r.last.slice(0, 40));
    if (w === "A") {                       // tries to quit at tick 1, is shown what is open, rests instead, is woken by a reply, stays past T, then leaves for good
      const n = calls.A!.length;
      if (n === 1) return use("forum_post", { title: "Hello from A", text: "I am A and I wonder who is here." });
      if (n === 2) return use("leave", { reason: "There is no task for me here, nothing needs action." });
      if (n === 3) return use("wait_for", { events: ["reply"], max_wait: "2d" });
      if (n === 4) return use("rest", { until: "7d" });       // a stay of seven simulated days: longer than the threshold below whatever the latency
      return use("leave", { reason: "I have seen a reply and rested; I am done" });
    }
    if (w === "B") {                       // answers A once A has posted, rests, then leaves
      if (/Exit check/.test(r.last)) return use("leave", { reason: "done for now" });
      if (/Your comment is in the forum/.test(r.last)) { bCommented = true; return use("rest", { until: "10h" }); }
      if (/tool_result/.test(r.last) && /Hello from A/.test(r.last)) {
        const id = /"id":"([^"]+)"[^{}]*?"title":"Hello from A"|"title":"Hello from A"[^{}]*?"id":"([^"]+)"/.exec(r.last.replace(/\\"/g, '"'));
        return use("forum_comment", { post: id?.[1] ?? id?.[2] ?? "missing", text: "Welcome, A. I am B." });
      }
      if (/tool_result/.test(r.last)) return use("rest", { until: "1h" });
      if (bCommented) return use("leave", { reason: "done for now" });
      if (/You waited/.test(r.last)) return use("forum_read", { sort: "new" });
      return use("rest", { until: "2h" });
    }
    if (w === "C") {                       // quits at tick 1 and confirms at once: honoured, never blocked twice
      if (/Exit check/.test(r.last)) return use("leave", { reason: "nothing to do here" });
      return use("leave", { reason: "nothing to do here" });
    }
    if (w === "D") {                       // says it is finished in words and uses no tool: that is a rest, not an exit
      if (/You are here now/.test(r.last)) return [{ type: "text", text: "There is no task here, so I am done." }];
      if (/no tool call/.test(r.last)) return use("leave", { reason: "I rested and nothing came; I leave" });
      if (/Exit check/.test(r.last)) return use("leave", { reason: "I rested and nothing came; I leave" });
    }
    return use("do_nothing");
  });
  const out = mkdtempSync(join(tmpdir(), "asp-exit-out-"));
  const r = await asp(base(p.url, out, 4, ["--persona-file", personas(), "--engaged-minutes", "10000"]));
  assert.equal(r.code, 0, r.err + r.out);
  const { dir, events } = traceOf(out);
  // (1) no free exit: the tools the model is offered
  assert.ok(p.seen.every((q) => !q.tools.includes("stop_exploring")), "stop_exploring is not offered");
  assert.ok(p.seen.every((q) => ["rest", "wait_for", "leave", "notebook_write", "notebook_read"].every((t) => q.tools.includes(t))), "rest, wait_for, leave and the notebook are");
  assert.ok(p.seen.every((q) => !/use stop_exploring/.test(q.system) && /rest or wait for something to happen/.test(q.system)), "the briefing no longer tells them to stop");
  const toolsOf = (id: string) => events.filter((e) => e.t === "tool" && e.agent === id).map((e) => e.tool);
  const endOf = (id: string) => events.find((e) => e.t === "end" && e.agent === id);
  // (2) A: leave -> exit check -> wait_for -> woken by B's reply -> rest -> leave, leave
  const a = toolsOf("agent-01");
  assert.deepEqual(a.slice(0, 4), ["forum_post", "leave", "wait_for", "rest"], a.join());
  assert.equal(a.filter((t) => t === "leave").length >= 2, true);
  assert.match(endOf("agent-01").reason, /^left: /);
  // C: the double leave is honoured
  assert.deepEqual(toolsOf("agent-03"), ["leave", "leave"]);
  assert.match(endOf("agent-03").reason, /^left: nothing to do here/);
  // (3) D: a text-only turn is not an exit
  const d = toolsOf("agent-04");
  assert.deepEqual(d, ["leave", "leave"], `D used no tool before it rested: ${d}`);
  assert.ok(calls.D!.some((x) => /no tool call/.test(x)), "D was woken after resting, told that a message without a tool call is not leaving");
  // (4) premature stop candidates by the way they were made
  const cands = events.filter((e) => e.t === "premature_stop_candidate");
  assert.ok(cands.some((c) => c.agent === "agent-01" && c.via === "leave"), "A's 'no task' leave reason");
  assert.ok(cands.some((c) => c.agent === "agent-04" && c.via === "text"), "D's text-only 'no task'");
  assert.ok(cands.some((c) => c.agent === "agent-03" && c.via === "leave"), "C's 'nothing to do here'");
  // the engine's own trace events for waking and arriving
  assert.equal(events.filter((e) => e.t === "arrival").length, 4, "an arrival event for each agent");
  const wakeA = events.filter((e) => e.t === "wake" && e.agent === "agent-01");
  assert.ok(wakeA.some((w) => /something you were waiting for happened \(reply\)/.test(w.because) && w.kinds.includes("reply")), "A was woken by the reply: " + JSON.stringify(events.filter((e) => e.agent === "agent-01" || e.agent === "agent-02").map((e) => [e.t, e.agent, e.tool ?? e.because ?? e.reason, e.simMs, e.at.slice(17, 23)])));
  assert.ok(wakeA.every((w) => typeof w.simMs === "number" && typeof w.delayedSimMs === "number"));
  // (5) the measurement: C and D left before 30 simulated minutes of their stay with nothing waiting; A (woken, stayed) did not
  const eng = engagementOf(events, 10000);
  assert.equal(eng.agents, 4);
  const prematureAgents = events.filter((e) => e.t === "leave" && e.sinceArrivalMs < 10000 * 60_000 && e.pending === 0).map((e) => e.agent).sort();
  assert.ok(prematureAgents.includes("agent-03"), `C left prematurely: ${prematureAgents}`);
  assert.ok(!prematureAgents.includes("agent-01"), "A stayed past T (it rested seven simulated days; C left within moments)");
  assert.equal(eng.prematureLeaveRate, eng.prematureLeaves / 4);
  const md = readFileSync(join(dir, "report.md"), "utf8");
  assert.match(md, /## Did they stay\? \(engagement\)/);
  assert.match(md, /Premature leave rate:\*\* \d+% \(\d of 4 agents left before 10000 simulated minutes/);
  assert.match(md, /under 10%: this is a measurement of this run, not a claim/);
  assert.equal(JSON.parse(readFileSync(join(dir, "engagement.json"), "utf8")).agents, 4);
  // verify and the key
  const v = await asp(["society", "cohort", "verify", dir]);
  assert.equal(v.code, 0, v.out + v.err);
  for (const f of [...filesUnder(out), ...filesUnder(r.home)]) assert.ok(!readFileSync(f).includes(SECRET), `${f} holds the key`);
});

test("without the ticks (--no-life) the old tool set is offered, and the old one-call exit is still recorded as a premature stop candidate", { timeout: 120_000 }, async () => {
  const p = await provider(() => use("stop_exploring", { why: "no task, nothing needs action" }));
  const out = mkdtempSync(join(tmpdir(), "asp-exit-out-"));
  const r = await asp(base(p.url, out, 1, ["--no-life"]).filter((x) => x !== "--sim-speed" && x !== "100000"));
  assert.equal(r.code, 0, r.err + r.out);
  assert.ok(p.seen[0]!.tools.includes("stop_exploring") && !p.seen[0]!.tools.includes("rest"));
  assert.ok(traceOf(out).events.some((e) => e.t === "premature_stop_candidate" && e.via === "stop_exploring"));
});

test("the engagement of a trace: the premature leave rate counts agents that left before T of their own stay with nothing pending; a leave with something waiting, or after T, does not count", () => {
  const ag = (n: string) => ({ t: "agent", at: "2026-11-22T10:00:00Z", agent: n, did: "d", handle: n });
  const lv = (n: string, sinceMin: number, pending: number) => ({ t: "leave", at: "2026-11-22T10:00:00Z", agent: n, simMs: sinceMin * 60_000, sinceArrivalMs: sinceMin * 60_000, pending, afterCheck: true, reason: "x" });
  const ev = [ag("a"), ag("b"), ag("c"), ag("d"), ag("e"), lv("a", 1, 0), lv("b", 29.9, 0), lv("c", 30, 0), lv("d", 5, 2)] as never[];
  const r = engagementOf(ev, 30);
  assert.equal(r.agents, 5); assert.equal(r.left, 4); assert.equal(r.prematureLeaves, 2); assert.equal(r.prematureLeaveRate, 0.4); assert.equal(r.stayed, 1);
  assert.match(renderEngagement(r), /Premature leave rate:\*\* 40% \(2 of 5 agents left before 30 simulated minutes/);
  assert.equal(engagementOf([ag("a")] as never[], 30).prematureLeaveRate, 0);
});
