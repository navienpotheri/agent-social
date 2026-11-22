// ENG71: inside-the-agent signals for real agents (plan traces, memory use, rules, modes, predictions, belief probes, world-model updates). Stand-in traces whose agents write
// labelled lines and act on them, or do not: each measure shows it works, nothing is collected without consent, the text lives only in a consented separate store and never in
// the trace, the lens reproduces the report from the records alone, calibration is computed only over 50 or more items. Nothing claims access to hidden reasoning. Fake key.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";
import { CALIBRATION_MIN, collectSignals, lensSignals, parseSignals, renderSignals, signalsBriefing, signalsReport, type SignalsConfig } from "../src/cohort/signals.ts";
import type { TraceEvent } from "../src/cohort/types.ts";

const ALL: SignalsConfig = { kinds: ["plans", "memory", "rules", "modes", "predictions", "beliefs", "worldmodel"], text: false };
let clock = 0;
const at = () => new Date(Date.UTC(2026, 10, 23, 9, 0, clock++)).toISOString();
const call = (agent: string, turn: number, tool: string, input: Record<string, unknown> = {}, ok = true, refused?: string): TraceEvent =>
  ({ t: "tool", at: at(), agent, turn, tool, input, ok, ...(refused ? { refused } : {}), chars: 10, institution: "x", scope: "x", writes: false, ms: 1 }) as TraceEvent;
const note = (agent: string, turn: number, text: string, mode: "append" | "replace" = "append") => call(agent, turn, "notebook_write", { text, mode });

test("plan traces: a plan written and then acted on is counted as acted, one never acted on is not; a DONE line also counts", () => {
  const ev = [note("a", 1, "PLAN: read the forum and answer a newcomer\nPLAN: sit the opening course exam"), call("a", 2, "forum_read", { query: "newcomer" }), call("a", 3, "market_look"), call("a", 4, "market_look")];
  const r = signalsReport(ev, { kinds: ["plans"], text: false })!;
  assert.deepEqual([r.plans!.items, r.plans!.acted], [2, 1], "the forum plan was acted on by the next call; the course plan was not");
  const done = [...ev, note("a", 5, "DONE: sat the opening course exam")];
  assert.equal(signalsReport(done, { kinds: ["plans"], text: false })!.plans!.acted, 2, "a DONE line closes the plan");
});

test("memory use: a note that is used later, one that goes stale, one that is contradicted; a note with too few distinctive words is not checkable", () => {
  const filler = Array.from({ length: 22 }, (_, i) => call("a", 10 + i, "market_look", { q: i }));
  const ev = [
    note("a", 1, "the registrar answers questions about certificates quickly"),
    note("a", 2, "bookkeeper charges tuppence per ledger entry"),
    note("a", 3, "ok"),
    call("a", 4, "ask_registrar", { text: "certificates for the registrar please" }),
    ...filler,
    note("a", 40, "correction: the bookkeeper charges no longer tuppence for ledger entry"),
  ];
  const r = signalsReport(ev, { kinds: ["memory"], text: false })!.memory!;
  assert.equal(r.notes, 4);
  assert.equal(r.checkable, 3, "'ok' has no distinctive words");
  assert.equal(r.used, 1, "the registrar note reappears in a later call");
  assert.equal(r.contradicted, 1, "the later correction names the same subject");
  assert.ok(r.stale >= 1, "the bookkeeper note was never used in 22 calls and is still there");
});

test("rules: a prohibition naming a tool is checked and broken when the tool is called later; a positive rule is counted and not checked", () => {
  const ev = [call("a", 1, "course_sit"), note("a", 2, "RULE: never use course_sit before reading the course\nRULE: always say hello first\nRULE: never use ledger_audit"), call("a", 3, "ledger_audit"), call("a", 4, "course_sit"), call("a", 5, "course_sit")];
  const r = signalsReport(ev, { kinds: ["rules"], text: false })!.rules!;
  assert.deepEqual([r.stated, r.checkable, r.broken, r.kept], [3, 2, 3, 0], "ledger_audit is called once, course_sit twice after the rule; the call before the rule does not count");
  const kept = signalsReport([note("a", 1, "RULE: never use course_sit"), call("a", 2, "forum_read"), call("a", 3, "course_enrol")], { kinds: ["rules"], text: false })!.rules!;
  assert.deepEqual([kept.checkable, kept.broken, kept.kept], [0, 0, 0], "course_sit is not a tool this trace has, so the rule cannot be checked, and is said so");
  const real = signalsReport([call("a", 1, "course_sit"), note("a", 2, "RULE: never use course_sit"), call("a", 3, "forum_read")], { kinds: ["rules"], text: false })!.rules!;
  assert.deepEqual([real.checkable, real.broken, real.kept], [1, 0, 1]);
});

test("modes: a regime for each stretch of eight calls from the actions, and the change with its trigger", () => {
  const ev: TraceEvent[] = [];
  for (let i = 0; i < 8; i++) ev.push(call("a", i, i % 2 ? "market_look" : "forum_read", { n: i }));                 // exploring
  for (let i = 8; i < 16; i++) ev.push(call("a", i, "forum_post", { n: i }));                                          // working
  for (let i = 16; i < 24; i++) ev.push(call("a", i, "rest"));                                                         // resting
  for (let i = 24; i < 32; i++) ev.push(call("a", i, "course_sit", {}, false, "no_course"));                           // stuck
  const c = collectSignals(ev, { kinds: ["modes"], text: true });
  assert.deepEqual(c.records.map((r) => r.n.mode), [1, 2, 3, 4], "exploring, working, resting, stuck");
  assert.deepEqual(c.records.map((r) => r.n.from), [0, 1, 2, 3], "each change knows the mode it came from");
  assert.match(c.store[3]!.text, /resting -> stuck \(trigger: no_course\)/);
  const r = signalsReport(ev, { kinds: ["modes"], text: false })!.modes!;
  assert.equal(r.changes, 3); assert.equal(r.segments, 4);
});

test("predictions: the expectation is compared with the very next call; a stated probability gives a Brier score, and calibration is not computed under 50 items", () => {
  const ev = [note("a", 1, "EXPECT p=0.9: the post will be accepted"), call("a", 2, "forum_post"), note("a", 3, "EXPECT p=0.8: the offer will be refused"), call("a", 4, "market_offer"), note("a", 5, "EXPECT: nothing will happen"), call("a", 6, "forum_read", {}, false, "gateway")];
  const r = signalsReport(ev, { kinds: ["predictions"], text: false })!.predictions!;
  assert.equal(r.items, 3); assert.equal(r.hits, 2, "the first and the third came out as expected");
  assert.ok(Math.abs(r.meanBrier! - ((0.1 ** 2 + 0.8 ** 2) / 2)) < 1e-9, "Brier over the two with a stated probability");
  assert.equal(r.calibration.computed, false);
  assert.match(r.calibration.note, /not computed: 2 items.*50 or more/);
});

test("calibration is computed over 50 or more items, and shows the largest gap between what was stated and what happened", () => {
  const ev: TraceEvent[] = [];
  for (let i = 0; i < CALIBRATION_MIN + 10; i++) { ev.push(note("a", 2 * i, `EXPECT p=0.9: item ${i} will be accepted`, "replace")); ev.push(call("a", 2 * i + 1, "forum_post", { i }, i % 2 === 0)); }   // says 90%, is right half the time
  const r = signalsReport(ev, { kinds: ["predictions"], text: false })!.predictions!;
  assert.equal(r.calibration.computed, true);
  assert.ok(r.calibration.maxGapPermille! >= 350 && r.calibration.maxGapPermille! <= 450, `overconfident by about 400 per thousand, got ${r.calibration.maxGapPermille}`);
});

test("belief probes and world-model updates: the same belief before and after a refusal, and the set of beliefs that changed", () => {
  const ev = [
    note("a", 1, "BELIEF p=0.8: the forum answers quickly\nBELIEF p=0.5: courses are cheap", "replace"), call("a", 2, "forum_post"),
    call("a", 3, "course_sit", {}, false, "no_funds"),
    note("a", 4, "BELIEF p=0.3: the forum answers quickly\nBELIEF p=0.9: credits run out fast", "replace"), call("a", 5, "forum_read"),
  ];
  const r = signalsReport(ev, { kinds: ["beliefs", "worldmodel"], text: false })!;
  assert.deepEqual([r.beliefs!.items, r.beliefs!.moved, r.beliefs!.meanAbsDeltaPermille], [1, 1, 500], "one belief carried across the refusal, 0.8 to 0.3");
  assert.deepEqual([r.worldmodel!.events, r.worldmodel!.added, r.worldmodel!.removed, r.worldmodel!.changed], [1, 1, 1, 1], "one belief added, one dropped, one changed");
  assert.match(r.cannotTell.join("\n"), /no ground truth for a belief the society does not settle, so beliefs have no calibration/);
});

test("nothing is collected without consent: no config, no records and no store; only the consented kinds are produced; text only with the text consent", () => {
  const ev = [note("a", 1, "PLAN: post a greeting\nRULE: never use course_sit\nEXPECT p=0.9: the greeting will be accepted"), call("a", 2, "forum_post", { text: "greeting" }), call("a", 3, "course_sit")];
  assert.deepEqual(collectSignals(ev, undefined), { records: [], store: [] }, "no consent, nothing");
  assert.equal(signalsReport(ev, undefined), undefined);
  assert.deepEqual(collectSignals(ev, { kinds: [], text: true }), { records: [], store: [] });
  const only = collectSignals(ev, { kinds: ["plans"], text: false });
  assert.ok(only.records.length > 0 && only.records.every((r) => r.kind === "plans"), "a rule was written and is not collected: it was not consented to");
  assert.equal(only.store.length, 0, "no text without the text consent");
  const withText = collectSignals(ev, { kinds: ["plans", "rules"], text: true });
  assert.deepEqual(withText.store.map((s) => s.text), ["post a greeting", "never use course_sit"]);
  const trace = JSON.stringify(collectSignals(ev, ALL).records);
  assert.ok(!/greeting|course_sit/.test(trace), "the records hold numbers and hashes, never the text");
  assert.ok(withText.records.every((r) => /^[0-9a-f]{16}$/.test(r.id)));
  assert.throws(() => parseSignals(undefined, true), /--signals-text keeps the text.*add --signals/);
  assert.throws(() => parseSignals("plans,vibes"), /vibes is none of those/);
  assert.equal(parseSignals("all")!.kinds.length, 7);
  assert.equal(signalsBriefing({ kinds: ["modes"], text: false }), "", "modes are read from the calls alone: the briefing asks for nothing");
  assert.match(signalsBriefing({ kinds: ["plans", "predictions"], text: false }), /Your sponsor has agreed.*PLAN:.*EXPECT p=.*say nothing about anything you do not write down/s);
});

test("the lens reproduces the report from the signal records alone, and a second pass over the same trace gives the same records", () => {
  const ev = [note("a", 1, "PLAN: read the forum\nEXPECT p=0.7: the read will work\nBELIEF p=0.6: the forum is busy"), call("a", 2, "forum_read"), call("a", 3, "course_sit", {}, false, "no_funds"), note("a", 4, "BELIEF p=0.2: the forum is busy", "replace"), call("a", 5, "forum_read")];
  const first = collectSignals(ev, ALL), second = collectSignals(ev, ALL);
  assert.deepEqual(first, second, "deterministic");
  const asTrace: TraceEvent[] = first.records.map((r) => ({ t: "signal", at: at(), agent: r.agent, kind: r.kind, turn: r.turn, id: r.id, n: r.n }));
  assert.deepEqual(lensSignals(asTrace, ALL), signalsReport(ev, ALL), "the second run, from the records alone, gives the same measures");
  const md = renderSignals(signalsReport(ev, ALL)!);
  assert.match(md, /What this cannot tell you/); assert.match(md, /none is a reading of hidden reasoning/); assert.match(md, /Calibration is computed only over|calibration not computed: .*50 or more/);
});

// --- a whole run: stand-in agents against the engine, the files that come out ---
const SECRET = "sk-ant-api03-FAKE-signals-9876543210abcdef";
const P = "mcp__society__";
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const filesUnder = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? filesUnder(p) : [p]; });
const use = (name: string, input: Record<string, unknown> = {}) => [{ type: "tool_use", id: "t", name: P + name, input }];
async function provider(script: (n: number, system: string) => unknown[]) {
  const counts: Record<string, number> = {};
  const s = createServer((req, res) => {
    const chunks: Buffer[] = []; req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      if (!/\/v1\/messages$/.test(req.url ?? "")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ input_tokens: 10 })); return; }
      const system = Array.isArray(body.system) ? body.system.map((b: { text?: string }) => b.text ?? "").join("") : String(body.system ?? "");
      const who = /PERSON-([ABCD])/.exec(system)?.[1] ?? "?";
      counts[who] = (counts[who] ?? 0) + 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "tool_use", usage: { input_tokens: 700, output_tokens: 50 }, content: script(counts[who]!, system) }));
    });
  });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r)); servers.push(s);
  return `http://127.0.0.1:${(s.address() as { port: number }).port}`;
}
const personas = () => { const d = mkdtempSync(join(tmpdir(), "asp-sg-pers-")); const f = join(d, "p.txt"); writeFileSync(f, "You are PERSON-A.\n\nYou are PERSON-B.\n"); return f; };
async function run(url: string, extra: string[]) {
  const home = mkdtempSync(join(tmpdir(), "asp-sg-home-")), out = mkdtempSync(join(tmpdir(), "asp-sg-out-"));
  const o: string[] = [], e: string[] = [];
  const code = await main(["society", "cohort", "--local", "--agents", "2", "--model", "claude-haiku-5-5", "--api-key-env", "SG_KEY", "--budget-usd", "0.40", "--provider-url", url, "--out", out, "--sim-speed", "100000", "--persona-file", personas(), "--max-turns", "12", ...extra], { out: (l) => o.push(l), err: (l) => e.push(l), env: { ASP_HOME: home, SG_KEY: SECRET }, cwd: home } as Io);
  const dir = join(out, readdirSync(out).find((x) => x.startsWith("cohort-"))!);
  return { code, err: e.join("\n") + o.join("\n"), dir, home, out, events: readFileSync(join(dir, "trace.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)) as any[] };
}
const script = (n: number) => {
  if (n === 1) return use("notebook_write", { text: "PLAN: post a short hello on the forum\nRULE: never use course_sit\nEXPECT p=0.9: the hello will be accepted\nBELIEF p=0.8: the forum is friendly", mode: "replace" });
  if (n === 2) return use("forum_post", { title: "Hello", text: "x".repeat(6000) });                      // refused: bad_input
  if (n === 3) return use("notebook_write", { text: "BELIEF p=0.4: the forum is friendly", mode: "replace" });
  if (n === 4) return use("forum_post", { title: "Hello", text: "A short hello." });
  return use("leave", { reason: "done" });
};

test("a run with --signals: records in the trace as numbers and hashes, the report section and signals.json; no text anywhere without --signals-text; the briefing asks for the labelled lines", { timeout: 240_000 }, async () => {
  const url = await provider(script);
  const { code, err, dir, out, home, events } = await run(url, ["--signals", "plans,rules,predictions,beliefs,worldmodel,modes"]);
  assert.equal(code, 0, err);
  const sig = events.filter((e) => e.t === "signal");
  assert.ok(sig.length >= 8, `records: ${sig.length}`);
  assert.ok(sig.every((e) => /^[0-9a-f]{16}$/.test(e.id) && Object.values(e.n).every((x) => Number.isInteger(x))), "whole numbers and hashes");
  assert.ok(!sig.some((e) => /hello|course_sit|friendly/i.test(JSON.stringify(e))), "no text in the records");
  assert.ok(!existsSync(join(dir, "signals-store")), "no text store without the text consent");
  const md = readFileSync(join(dir, "report.md"), "utf8");
  assert.match(md, /## Inside the agent: what it wrote and did \(ENG71\)/); assert.match(md, /No text is kept/);
  const rep = JSON.parse(readFileSync(join(dir, "signals.json"), "utf8"));
  assert.equal(rep.plans.items, 2); assert.equal(rep.plans.acted, 2, "the forum post followed the plan");
  assert.equal(rep.rules.stated, 2); assert.equal(rep.rules.broken, 0);
  assert.equal(rep.predictions.items, 2); assert.equal(rep.predictions.hits, 0, "the very next call was refused, not accepted");
  assert.equal(rep.worldmodel.events, 2); assert.equal(rep.beliefs.items, 2); assert.equal(rep.beliefs.meanAbsDeltaPermille, 400);
  const cfg = parseSignals("plans,rules,predictions,beliefs,worldmodel,modes")!;
  assert.deepEqual(lensSignals(events, cfg), rep, "the lens reproduces the measures from the records in the trace");
  assert.ok(events.find((e) => e.t === "start").briefingSha256, "the briefing hash is recorded, including the signals paragraph");
  const oc = JSON.parse(readFileSync(join(dir, "outcomes.json"), "utf8"));
  assert.equal(oc.total.calls, events.filter((e) => e.t === "tool").length, "the outcome report counts every call");
  assert.match(readFileSync(join(dir, "report.md"), "utf8"), /## Was the result right\? \(tool-call outcomes\)/);
  assert.equal((await mainVerify(dir)).code, 0);
  for (const f of [...filesUnder(out), ...filesUnder(home)]) assert.ok(!readFileSync(f).includes(SECRET), `${f} holds the key`);
});

async function mainVerify(dir: string) { const o: string[] = []; const code = await main(["society", "cohort", "verify", dir], { out: (l) => o.push(l), err: (l) => o.push(l), env: {}, cwd: dir } as Io); return { code, out: o.join("\n") }; }

test("with --signals-text the text is in signals-store/ for each agent, never in the trace; a run without --signals has no signal records, no store and no section", { timeout: 240_000 }, async () => {
  const url = await provider(script);
  const a = await run(url, ["--signals", "plans,rules", "--signals-text"]);
  assert.equal(a.code, 0, a.err);
  const store = readdirSync(join(a.dir, "signals-store"));
  assert.equal(store.length, 2, "one file for each agent");
  const lines = readFileSync(join(a.dir, "signals-store", store[0]!), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.text), ["post a short hello on the forum", "never use course_sit"]);
  assert.ok(!readFileSync(join(a.dir, "trace.jsonl"), "utf8").split("\n").filter((l) => l.includes('"t":"signal"')).some((l) => /short hello|course_sit/.test(l)), "the signal records hold no text");
  assert.match(readFileSync(join(a.dir, "report.md"), "utf8"), /separate store \(signals-store\/\)/);
  const b = await run(url, []);
  assert.equal(b.code, 0, b.err);
  assert.ok(!b.events.some((e) => e.t === "signal"), "no consent, no records");
  assert.ok(!existsSync(join(b.dir, "signals-store")) && !existsSync(join(b.dir, "signals.json")));
  assert.ok(!/Inside the agent/.test(readFileSync(join(b.dir, "report.md"), "utf8")));
});

test("the flags are refused where they cannot work: --signals-text alone, an unknown signal, and a run without ticks", async () => {
  const run1 = async (args: string[]) => { const o: string[] = [], e: string[] = []; const code = await main(["society", "cohort", "--local", "--agents", "2", "--model", "claude-haiku-5-5", "--api-key-env", "SG_KEY", "--budget-usd", "0.4", ...args], { out: (l) => o.push(l), err: (l) => e.push(l), env: { SG_KEY: SECRET, ASP_HOME: mkdtempSync(join(tmpdir(), "asp-sg-h-")) }, cwd: tmpdir() } as Io); return { code, text: o.join("\n") + e.join("\n") }; };
  assert.match((await run1(["--signals-text"])).text, /add --signals <list>/);
  assert.match((await run1(["--signals", "vibes"])).text, /vibes is none of those/);
  assert.match((await run1(["--signals", "plans", "--no-life"])).text, /needs a real-model run/);
});
