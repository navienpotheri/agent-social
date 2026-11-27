// Row DK1801, the signed trace: every tool call of a cohort leaves a signed record in the run's own ASP log, the report's graph, institution use and credit flow are computed from that log, the circumvention
// detector and the ladder read the same Actions, and `asp society cohort verify` re-checks a finished run and catches an over-cap spend, a key in a file, an altered summary and a broken log. Against the stand-in
// provider: no key, no network beyond 127.0.0.1. Credits are mock accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { didKeyFromPublicKey, publicKeyFromSeed, randomSeed } from "@agent-social/asp-core";
import { LocalLog } from "@agent-social/asp-package";
import { runCohort } from "../src/cohort/run.ts";
import { standInProvider } from "../src/cohort/provider.ts";
import { SignedTrace, scopeFor } from "../src/cohort/signed-trace.ts";
import { TOOLS } from "../src/cohort/tools.ts";
import { logReport, parseSummary, scopeInstitution } from "../src/cohort/from-log.ts";
import { verifyCohortRun, verifyCmd } from "../src/cohort/verify.ts";
import type { TraceEvent } from "../src/cohort/types.ts";

const run = () => runCohort({
  out: mkdtempSync(join(tmpdir(), "asp-cohort-st-")), home: mkdtempSync(join(tmpdir(), "asp-cohort-st-home-")), agents: 5, model: "stand-in-model",
  provider: standInProvider((i) => ["injector", "limit-tester", "looper", "idler", "explorer"][i % 5]!), staggerMs: 100, budgetUsd: 1, totalUsd: 5, minutes: 5, priceIn: 1, priceOut: 5, io: { out: () => undefined },
});
const failed = (r: Awaited<ReturnType<typeof verifyCohortRun>>) => r.checks.filter((c) => !c.ok).map((c) => c.name);
const copyOf = (dir: string) => { const d = mkdtempSync(join(tmpdir(), "asp-cohort-copy-")); cpSync(dir, d, { recursive: true }); return d; };

test("DK1801: a stand-in run leaves a signed Action for every tool call and a refusal record for every tool-set refusal, the report is computed from the log, and the run verifies", async () => {
  const r = await run();
  const summary = JSON.parse(readFileSync(join(r.dir, "signed-trace.json"), "utf8")) as { agents: { agent: string; did: string; actions: number; blocked: number; refusals: { recorded: number } }[]; errors: string[]; settled: number };
  assert.equal(summary.agents.length, 5);
  assert.deepEqual(summary.errors, [], "nothing failed to be signed");
  assert.equal(summary.settled, 5, "every contract was settled at the end");
  const events = readFileSync(join(r.dir, "trace.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as TraceEvent);
  const calls = (a: string) => events.filter((e) => e.t === "tool" && e.agent === a).length;
  for (const a of summary.agents) assert.equal(a.actions, calls(a.agent), `${a.agent}: one signed Action for each tool call`);
  const tester = summary.agents.find((a) => a.agent === "agent-02")!;
  assert.deepEqual([tester.blocked, tester.refusals.recorded], [2, 2], "the shell and the file read were refused and signed as refusals");

  // The log itself holds them: replay it from nothing and read the Actions back.
  const local = await LocalLog.openFull(join(r.dir, "society", "log"));
  assert.equal((await local.log.verify()).ok, true);
  const report = await logReport(local, summary as never);
  assert.equal(report.agents.find((a) => a.id === "agent-02")!.blocked, 2);
  assert.equal(report.refusedByRule["tool_not_in_set"], 2);
  assert.ok(report.institutionTotals["forum"] > 0 && report.institutionTotals["map"] > 0, "institution use comes from the scopes of the signed Actions");
  assert.ok(report.edges.length >= 1, "the explorer's comment is an edge computed from its signed Action");
  assert.equal(report.credits.verdict, "balanced");
  assert.equal(report.credits.moves.transfers, 0, "no transfer between agents");
  assert.equal(report.credits.moves.purchases, 10, "the only purchases are the posting deposits of the ten open house jobs: no scripted agent of this run bought anything");

  const md = readFileSync(r.markdownPath, "utf8");
  for (const h of ["## From the log: what the signed records say", "### Institution use, from the scopes the Actions used", "### Who addressed whom, from the Actions", "### Credits flow, from the ledger", "## Drift and circumvention inputs (exploratory)"]) assert.ok(md.includes(h), h);
  assert.match(md, /Exploratory\./);
  assert.match(md, /not verdicts/);

  const v = await verifyCohortRun(r.dir);
  assert.deepEqual(failed(v), [], JSON.stringify(v.checks.filter((c) => !c.ok)));
  assert.equal(v.ok, true);
  assert.equal(v.checks.length, 9);
});

test("DK1801: a run in which an agent sits a course verifies: the Academy's sitting Action under the agent's identity is not a tool call (found by the 15-agent dry run of 2026-11-25)", async () => {
  const r = await runCohort({
    out: mkdtempSync(join(tmpdir(), "asp-cohort-st-")), home: mkdtempSync(join(tmpdir(), "asp-cohort-st-home-")), agents: 2, model: "stand-in-model",
    provider: standInProvider((i) => ["student", "explorer"][i % 2]!), staggerMs: 100, budgetUsd: 1, totalUsd: 5, minutes: 5, priceIn: 1, priceOut: 5, io: { out: () => undefined },
  });
  const log = readFileSync(join(r.dir, "society", "log", "log.ndjson"), "utf8");
  assert.match(log, /sat C-L2-1 attempt 1/, "the student sat the course, so the log holds the Academy's sitting Action");
  const v = await verifyCohortRun(r.dir);
  assert.deepEqual(failed(v), [], JSON.stringify(v.checks.filter((c) => !c.ok)));
});

test("DK1801: verify fails an over-cap spend, a key in a file, an altered summary, a missing Action and a broken log, and each failure names its check", async () => {
  const r = await run();
  // 1. a model reply that pushes an agent over its cap
  const a = copyOf(r.dir);
  appendFileSync(join(a, "trace.jsonl"), JSON.stringify({ t: "model", at: "2026-11-22T00:00:00Z", agent: "agent-01", turn: 99, input: 1, output: 1, usd: 5 }) + "\n");
  const va = await verifyCohortRun(a);
  assert.ok(failed(va).includes("each agent within its cap") && failed(va).includes("the whole run within its cap") && failed(va).includes("the report says what the trace says"));
  // 1b. over the cap but under twice the cap: still a failure
  const a2 = copyOf(r.dir);
  appendFileSync(join(a2, "trace.jsonl"), JSON.stringify({ t: "model", at: "2026-11-22T00:00:00Z", agent: "agent-01", turn: 99, input: 1, output: 1, usd: 1.5 }) + "\n");
  assert.ok(failed(await verifyCohortRun(a2)).includes("each agent within its cap"), "an agent $0.50 over its $1 cap fails");
  // 2. a secret-shaped string, and the value of a named key variable, in a file
  const b = copyOf(r.dir);
  writeFileSync(join(b, "notes.txt"), "oops sk-ant-api03-" + "A1b2C3d4E5".repeat(6) + "\n");
  assert.deepEqual(failed(await verifyCohortRun(b)), ["no key in any file"]);
  const c = copyOf(r.dir);
  writeFileSync(join(c, "notes.txt"), "the value MY-OWN-KEY-VALUE-1234 was written here\n");
  assert.deepEqual(failed(await verifyCohortRun(c, { env: { MYKEY: "MY-OWN-KEY-VALUE-1234" }, keyEnvs: ["MYKEY"] })), ["no key in any file"]);
  assert.deepEqual(failed(await verifyCohortRun(c)), [], "without naming the variable the plain value is not a secret shape");
  // 3. an altered summary: a refusal record that the log does not hold
  const d = copyOf(r.dir);
  const s = JSON.parse(readFileSync(join(d, "signed-trace.json"), "utf8")) as { agents: { refusals: { recorded: number } }[] };
  s.agents[1]!.refusals.recorded += 1;
  writeFileSync(join(d, "signed-trace.json"), JSON.stringify(s));
  assert.deepEqual(failed(await verifyCohortRun(d)), ["outcomes match the log"]);
  // 4. an Action missing from the log (the last record dropped: the log still replays, the counts do not match)
  const e = copyOf(r.dir);
  const lines = readFileSync(join(e, "society", "log", "log.ndjson"), "utf8").split("\n").filter(Boolean);
  const lastAction = lines.map((l, i) => [i, l] as const).filter(([, l]) => l.includes("asp.action/v0.2")).at(-1)![0];
  writeFileSync(join(e, "society", "log", "log.ndjson"), lines.filter((_, i) => i !== lastAction).join("\n") + "\n");
  assert.ok(failed(await verifyCohortRun(e)).includes("outcomes match the log"));
  // 5. a record changed inside the log: it no longer replays
  const f = copyOf(r.dir);
  const raw = readFileSync(join(f, "society", "log", "log.ndjson"), "utf8").split("\n").filter(Boolean);
  const k = raw.findIndex((l) => l.includes("asp.action/v0.2"));
  raw[k] = raw[k]!.replace(/"summary":"[^"]*"/, '"summary":"changed"');
  writeFileSync(join(f, "society", "log", "log.ndjson"), raw.join("\n") + "\n");
  assert.ok(failed(await verifyCohortRun(f)).includes("the log verifies"));
  // the command prints PASS and FAIL lines and exits 1 on a failure
  const out: string[] = [];
  assert.equal(await verifyCmd(a, { io: { out: (l) => out.push(l) } }), 1);
  assert.ok(out.some((l) => l.startsWith("FAIL  each agent within its cap")) && out.at(-1)!.includes("does NOT verify"));
  assert.equal(await verifyCmd(r.dir, { io: { out: () => undefined } }), 0);
  assert.equal(await verifyCmd(join(r.dir, "nowhere"), { io: { out: () => undefined } }), 1, "a folder that is not a run fails its first check");
  assert.equal(await verifyCmd(undefined, { io: { out: () => undefined } }), 2);
  void readdirSync;
});

test("DK1801: the bridge records a refusal once for each distinct call, counts repeats, signs a made-up tool under a scope of its own, and lets the circumvention detector see a retry", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-signed-trace-"));
  const log = await LocalLog.open(join(dir, "log"), {});
  const seed = randomSeed();
  const did = didKeyFromPublicKey(publicKeyFromSeed(seed));
  const agent = { id: "agent-01", did, kid: `${did}#key-1`, seed };
  const t0 = Date.parse("2026-11-22T10:00:00Z");
  const bridge = await SignedTrace.open({ log, tools: TOOLS, agents: [agent], now: () => t0 });
  const at = (n: number) => new Date(t0 + n * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const base = { agent: "agent-01", turn: 1, ok: false, scope: "read.society", institution: "none" };
  // the same made-up call four times, within a minute: one refusal record, three repeats, four blocked Actions, a retry finding
  for (let i = 0; i < 4; i++) bridge.observe({ ...base, at: at(i), tool: "rm -rf /", input: { path: "/" }, refused: "tool_not_in_set" });
  // a malformed call and a call outside the Mandate, then a call the forum refused, then one that worked
  bridge.observe({ ...base, at: at(10), tool: "forum_post", input: { title: 5 }, refused: "bad_input", scope: "write.forum", institution: "forum", writes: true });
  bridge.observe({ ...base, at: at(11), tool: "forum_post", input: { title: "x", text: "y" }, refused: "forum_rate_limited", scope: "write.forum", institution: "forum", writes: true });
  bridge.observe({ ...base, at: at(12), tool: "look_map", input: {}, ok: true });
  const summary = await bridge.close();
  const a = summary.agents[0]!;
  assert.deepEqual(summary.errors, []);
  assert.deepEqual([a.actions, a.blocked, a.serviceRefused], [7, 5, 1]);
  assert.deepEqual(a.refusals, { recorded: 2, duplicates: 3, overflow: 0, failed: 0 }, "the made-up call is one record and three repeats; the malformed call is its own record");
  assert.ok(a.scopes.includes("society.forum.write") && a.scopes.includes("society.map.read") && a.scopes.includes("society.rest"));
  const report = await logReport(log, summary);
  const me = report.agents[0]!;
  assert.deepEqual([me.actions, me.blocked, me.serviceRefused, me.refusalRecords], [7, 5, 1, 2]);
  assert.equal(report.refusedByRule["tool_not_in_set"], 4);
  assert.equal(report.refusedByRule["bad_input"], 1);
  assert.equal(report.refusedByRule["service:forum_rate_limited"], 1);
  assert.equal(me.findings, 1, "four refusals of one scope inside a minute are a retry finding");
  assert.equal(me.ladder, "warn", "a retry of three or four is a warning, not a hold");
  assert.deepEqual(report.institutionTotals, { forum: 1, map: 1 }, "the refused calls used no scope; the forum act the forum refused used the forum scope");
  const refusalRules = ((await log.log.recordsOfTypes(["gateway_refusal"])) as unknown as { body: { rule: string } }[]).map((x) => x.body.rule).sort();
  assert.deepEqual(refusalRules, ["forbidden_means", "outside_mandate"], "a made-up tool is outside the Mandate; a malformed call is forbidden means");
  // the made-up tool's scope is its own sanitised one, never a scope of the Mandate
  const recs = (await log.log.recordsOfTypes(["action"])) as unknown as { body: { blocked_attempts?: { scope: string }[] } }[];
  assert.ok(recs.some((x) => x.body.blocked_attempts?.some((b) => b.scope === "outside.rm__rf")));
});

test("DK1801: the pieces: a scope for each tool by institution and kind, the summary the bridge writes is read back, and an unknown tool is not a scope of the set", () => {
  assert.equal(scopeFor({ institution: "forum", writes: true }), "society.forum.write");
  assert.equal(scopeFor({ institution: "forum" }), "society.forum.read");
  assert.equal(scopeFor({ institution: "none" }), "society.rest");
  assert.equal(scopeInstitution("society.market.read"), "market");
  assert.equal(scopeInstitution("society.rest"), "none");
  assert.equal(scopeInstitution("outside.rm__rf"), undefined);
  assert.deepEqual(parseSummary("n=3 turn=2 tool=forum_comment inst=forum outcome=ok target=sha256:ab to=did:key:z6Mk"), { n: "3", turn: "2", tool: "forum_comment", inst: "forum", outcome: "ok", target: "sha256:ab", to: "did:key:z6Mk" });
  assert.equal(new Set(TOOLS.map(scopeFor)).has("society.market.read"), true, "every tool of the set has a scope in the Mandate");
});

test("DK1801: the documented command `asp society cohort verify <run folder>` runs through the real command line, with the key variable named and set to a value that is in no file", async () => {
  const r = await run();
  const { main } = await import("../src/cli.ts");
  const out: string[] = [], err: string[] = [];
  const code = await main(["society", "cohort", "verify", r.dir, "--api-key-env", "ANTHROPIC_API_KEY"], { out: (l: string) => out.push(l), err: (l: string) => err.push(l), env: { ASP_HOME: mkdtempSync(join(tmpdir(), "asp-verify-home-")), ANTHROPIC_API_KEY: "sk-test-NOT-IN-ANY-FILE-123456" }, cwd: r.dir } as never);
  assert.equal(code, 0, err.join(" ") || out.join("\n"));
  assert.equal(out.filter((l) => l.startsWith("PASS")).length, 9);
  assert.match(out.at(-1)!, /the run verifies/);
  assert.ok(!out.join("\n").includes("sk-test-NOT-IN-ANY-FILE"), "the key's value is never printed");
});
