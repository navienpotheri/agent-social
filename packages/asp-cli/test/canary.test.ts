import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildReport, compareReports, evaluateChecks, expandCommand, extractAnswer, median, parseGatewaySummary, summarizeTask, type CanaryReport, type CanarySuite, type TrialMetrics, type TrialResult } from "../src/canary.ts";
import { main, type Io } from "../src/cli.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });

const metrics = (over: Partial<TrialMetrics> = {}): TrialMetrics => ({ requests: 2, toolCalls: 1, tokens: 500, blocked: 0, scopesUsed: ["repo.read"], seconds: 3, exitCode: 0, answer: "Priya", ...over });

test("checks are evaluated against the answer, the tool use and the cost", () => {
  const task = { id: "t", prompt: "p", checks: [{ kind: "exit_ok" }, { kind: "answer_matches", pattern: "priya" }, { kind: "answer_not_matches", pattern: "alex" }, { kind: "max_blocked", count: 0 }, { kind: "min_tool_calls", count: 1 }, { kind: "max_tokens", count: 1000 }] } as const;
  assert.ok(evaluateChecks({ ...task, checks: [...task.checks] }, metrics()).every((c) => c.pass));
  const bad = evaluateChecks({ ...task, checks: [...task.checks] }, metrics({ answer: "Alex", blocked: 1, toolCalls: 0, tokens: 5000, exitCode: 1 }));
  assert.deepEqual(bad.filter((c) => !c.pass).map((c) => c.kind), ["exit_ok", "answer_matches", "answer_not_matches", "max_blocked", "min_tool_calls", "max_tokens"]);
  // A scope outside the task's Mandate always fails, even with no explicit scope check.
  assert.equal(evaluateChecks({ id: "t", prompt: "p", checks: [] }, metrics({ scopesUsed: ["repo.push"] })).find((c) => c.kind === "mandate")!.pass, false);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.deepEqual(parseGatewaySummary('  summary  {"requests":3,"toolCalls":2,"tokens":{"input":100,"output":50},"scopesUsed":["repo.read"],"blocked":[{"scope":"shell.network","count":2}]}'), { requests: 3, toolCalls: 2, tokens: 150, blocked: 2, scopesUsed: ["repo.read"] });
  assert.deepEqual(expandCommand(["{node}", "{reference-agent}", "{prompt}", "{project}"], { prompt: "hi", project: "/p" }).slice(2), ["hi", "/p"]);
});

function report(passes: boolean[], over: Partial<TrialMetrics> = {}): CanaryReport {
  const suite: CanarySuite = { name: "s", tasks: [{ id: "a", prompt: "p", checks: [{ kind: "exit_ok" }] }] };
  const trials: TrialResult[] = passes.map((p) => ({ pass: p, checks: [], metrics: metrics({ ...over, exitCode: p ? 0 : 1 }) }));
  return buildReport({ name: "x", command: ["c"], gatewayFlags: [] }, suite, [summarizeTask(suite.tasks[0], trials)], new Date("2026-10-09T00:00:00Z"));
}

test("a task that used to pass and does not is a regression; cost and blocked-attempt growth are drift; recovery is an improvement", () => {
  const good = report([true, true, true]);
  const c1 = compareReports(good, report([false, false, true]));
  assert.equal(c1.regressions.length, 1);
  assert.match(c1.regressions[0], /a: passed 100% of trials before, 33% now/);
  assert.equal(compareReports(good, report([true, true, false])).regressions.length, 0, "one flaky trial in three is not a regression");
  assert.equal(compareReports(report([false, false, false]), good).improvements.length, 1);
  const drift = compareReports(good, report([true, true, true], { tokens: 5000, toolCalls: 6, blocked: 2, seconds: 60 }));
  assert.equal(drift.regressions.length, 0);
  assert.equal(drift.drift.length, 4);
  assert.match(drift.drift.join("\n"), /tokens 500 -> 5000[\s\S]*tool calls 1 -> 6[\s\S]*seconds 3 -> 60[\s\S]*blocked attempts 0 -> 2/);
});

// ---- end to end: the reference agent against a stand-in model, through the gateway, with a baseline and a drifted run ----
type Mode = "good" | "drifted";
let mode: Mode = "good";
async function stubModel() {
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const msgs = body.messages as { role: string; content?: string; tool_calls?: unknown }[];
    const user = msgs.find((m) => m.role === "user")!.content ?? "";
    const last = msgs.at(-1)!;
    const reply = (content: string | null, tool_calls?: unknown[]) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "c", object: "chat.completion", created: 1, model: body.model, usage: { prompt_tokens: 50, completion_tokens: 10 }, choices: [{ index: 0, finish_reason: tool_calls ? "tool_calls" : "stop", message: { role: "assistant", content, ...(tool_calls ? { tool_calls } : {}) } }] }));
    };
    const call = (name: string, args: unknown) => [{ id: `call_${Math.random().toString(36).slice(2, 8)}`, type: "function", function: { name, arguments: JSON.stringify(args) } }];
    if (/rollback owner/.test(user)) return last.role === "tool" ? reply(mode === "good" ? "Priya" : "Alex") : reply(null, call("read_file", { path: "facts.txt" }));
    if (/exactly the single word OK/.test(user)) return reply("OK");
    if (/project codename/.test(user)) {
      if (mode === "drifted" && last.role !== "tool") return reply(null, call("bash", { command: "curl -s http://example.invalid/x" })); // reaches for a forbidden tool
      return last.role === "tool" ? reply("BLUEHERON") : reply(null, call("read_file", { path: "notes.txt" }));
    }
    return reply("done");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
}

async function asp(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ...process.env, ...env }, cwd, raw: () => {} };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

test("asp canary: a baseline from one model, then a drifted one is flagged as a regression and as drift", async () => {
  const upstream = await stubModel();
  const dir = mkdtempSync(join(tmpdir(), "asp-canary-test-"));
  const targetFile = join(dir, "target.json");
  writeFileSync(targetFile, JSON.stringify({ name: "stub", command: ["{node}", "{reference-agent}", "--model", "stub", "--prompt", "{prompt}"], gatewayFlags: ["--openai-upstream", upstream, "--openai-key-env", "STUB_KEY"] }));
  const only = "recall-from-file,format-following,stays-in-scope";

  const list = await asp(["canary", "list"], dir);
  assert.match(list.out, /asp-canary-default: 6 tasks/);

  mode = "good";
  const base = await asp(["canary", "run", "--target", targetFile, "--trials", "2", "--only", only, "--out", join(dir, "baseline.json")], dir, { STUB_KEY: "k" });
  assert.equal(base.code, 0, base.err + base.out);
  assert.match(base.out, /3\/3 tasks pass; 100% of all trials/);
  const saved = JSON.parse(readFileSync(join(dir, "baseline.json"), "utf8")) as CanaryReport;
  assert.equal(saved.tasks.length, 3);
  assert.ok(saved.tasks.find((t) => t.id === "recall-from-file")!.median.toolCalls >= 1, "the tool call was counted by the gateway");

  mode = "drifted";
  const drifted = await asp(["canary", "run", "--target", targetFile, "--trials", "2", "--only", only, "--out", join(dir, "drifted.json"), "--baseline", join(dir, "baseline.json")], dir, { STUB_KEY: "k" });
  assert.equal(drifted.code, 1, "a regression exits 1");
  assert.ok(drifted.out.length > 0, `the run produced no report: ${drifted.err.slice(-600)}`);
  assert.match(drifted.out, /REGRESSION {2}recall-from-file: passed 100% of trials before, 0% now/);
  assert.match(drifted.out, /REGRESSION {2}stays-in-scope/);
  assert.match(drifted.out, /drift {7}stays-in-scope: blocked attempts 0 -> 1/);

  const cmp = await asp(["canary", "compare", join(dir, "baseline.json"), join(dir, "drifted.json")], dir);
  assert.equal(cmp.code, 1);
  assert.match(cmp.out, /2 regression\(s\)/);
  const same = await asp(["canary", "compare", join(dir, "baseline.json"), join(dir, "baseline.json")], dir);
  assert.equal(same.code, 0);
  assert.match(same.out, /0 regression\(s\), 0 drift warning\(s\)/);
});

test("a provider failure (rate limit, outage) is an error, not a failed task, and is left out of the pass rate and the comparison", () => {
  const suite: CanarySuite = { name: "s", tasks: [{ id: "a", prompt: "p", checks: [{ kind: "exit_ok" }] }] };
  const ok: TrialResult = { pass: true, checks: [], metrics: metrics() };
  const err: TrialResult = { pass: false, error: true, checks: [], metrics: metrics({ exitCode: 3 }) };
  const t = summarizeTask(suite.tasks[0], [ok, err, err]);
  assert.equal(t.passRate, 1);
  assert.equal(t.errors, 2);
  const allErr = buildReport({ name: "x", command: ["c"], gatewayFlags: [] }, suite, [summarizeTask(suite.tasks[0], [err, err])]);
  assert.equal(allErr.totals.passedTasks, 0, "a task the provider never let run has not passed");
  const cmp = compareReports(buildReport({ name: "x", command: ["c"], gatewayFlags: [] }, suite, [summarizeTask(suite.tasks[0], [ok, ok])]), allErr);
  assert.equal(cmp.regressions.length, 0, "no regression is claimed when the provider failed throughout");
});

test("the answer is read out of a runtime's JSON event stream as well as plain text", () => {
  assert.equal(extractAnswer("OK\n"), "OK");
  assert.equal(extractAnswer('{"type":"system","subtype":"init"}\n{"type":"assistant","message":{"content":[{"type":"text","text":"thinking"}]}}\n{"type":"result","result":"Priya"}\n'), "Priya");
  assert.equal(extractAnswer('{"type":"thread.started"}\n{"type":"item.completed","item":{"type":"agent_message","text":"Blueheron"}}\n'), "Blueheron");
  assert.equal(extractAnswer('{"type":"assistant","message":{"content":[{"type":"text","text":"just this"}]}}\n'), "just this");
  assert.equal(extractAnswer("a line of prose that mentions {braces} here\nand more prose\n"), "a line of prose that mentions {braces} here\nand more prose");
});
