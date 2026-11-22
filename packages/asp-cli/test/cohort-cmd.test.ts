// Row DK1801: every `asp society cohort` command in docs/society-models-run.md is run through the real command line against a local stand-in that speaks the provider's interface (a fake key, no outside network), with
// the folder, the provider address and a short turn limit swapped in; each must finish, write its report and keep the key out of every file. The flags that must refuse (no --local, no cap, no variable) are checked.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";

const SECRET = "sk-test-NOT-A-REAL-KEY-cmd-9876543210";
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const doc = readFileSync(new URL("../../../docs/society-models-run.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const filesUnder = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? filesUnder(p) : [p]; });

async function fakeProvider() {
  const s = createServer(async (req, res) => {
    for await (const _ of req) { /* drain */ }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ content: [{ type: "text", text: "I will look at the charters." }, { type: "tool_use", id: "t1", name: "mcp__society__look_charters", input: {} }], usage: { input_tokens: 900, output_tokens: 40 }, stop_reason: "tool_use" }));
  });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r)); servers.push(s);
  return `http://127.0.0.1:${(s.address() as { port: number }).port}`;
}
async function asp(args: string[], env: Record<string, string> = {}) {
  const home = mkdtempSync(join(tmpdir(), "asp-cohort-cmd-home-"));
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home, ...env }, cwd: home };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n"), home };
}
/** The documented commands: the fenced PowerShell lines that run `asp society cohort`, with the placeholders filled in (`verify` checks a finished run and is tested in cohort-signed-trace.test.ts). */
const documented = [...doc.matchAll(/```powershell\n([\s\S]*?)```/g)].flatMap((m) => m[1]!.split("\n")).filter((l) => /society cohort/.test(l) && !/society cohort verify/.test(l)).map((l) => l.replace(/^npm run asp -- /, "").replace(/<usd per million input tokens>/g, "1").replace(/<usd per million output tokens>/g, "5"));
const tokens = (cmd: string): string[] => cmd.split(/\s+/).filter(Boolean);

test("DK1801: the document gives the dry run and the three real steps and the persona run, and each command in it runs and writes a report", async () => {
  assert.ok(documented.length >= 5, `${documented.length} documented cohort commands`);
  assert.ok(documented.some((c) => /--provider stand-in/.test(c)), "the dry run is documented");
  assert.ok(documented.some((c) => /--agents 1 /.test(c)) && documented.some((c) => /--agents 3 /.test(c)) && documented.some((c) => /--agents 15 /.test(c)), "one, three and fifteen agents");
  assert.ok(documented.some((c) => /--budget-usd 0\.40 --total-usd 6/.test(c)), "the owner's cap for the first real cohort");
  const url = await fakeProvider();
  const dir = mkdtempSync(join(tmpdir(), "asp-personas-"));
  writeFileSync(join(dir, "personas.txt"), "You are curious and like to read everything.\n\nYou look for work to do.\n");
  for (const cmd of documented) {
    const out = mkdtempSync(join(tmpdir(), "asp-cohort-cmd-out-"));
    const real = !/--provider stand-in/.test(cmd);
    const args = [...tokens(cmd).map((t) => (t === "personas.txt" ? join(dir, "personas.txt") : t)), "--out", out, "--max-turns", "3", ...(real ? ["--provider-url", url] : [])];
    const r = await asp(args, { ANTHROPIC_API_KEY: SECRET });
    assert.equal(r.code, 0, `${cmd}: ${r.err || r.out}`);
    assert.match(r.out, /cohort: \d+ agents? of /);
    assert.match(r.out, /what happened, in words: .*report\.md/);
    const runDirs = readdirSync(out).filter((d) => d.startsWith("cohort-"));
    assert.equal(runDirs.length, 1, cmd);
    assert.ok(existsSync(join(out, runDirs[0]!, "report.md")), `${cmd}: a report`);
    for (const f of [...filesUnder(out), ...filesUnder(r.home)]) assert.ok(!readFileSync(f).includes(SECRET), `${f} holds the key`);
    assert.ok(!r.out.includes(SECRET) && !r.err.includes(SECRET), "the key is not printed");
  }
});

test("DK1801: the persona file is read, one persona to each agent in rotation, and the report records which", async () => {
  const url = await fakeProvider();
  const dir = mkdtempSync(join(tmpdir(), "asp-personas2-"));
  const file = join(dir, "personas.txt");
  writeFileSync(file, "You are curious and like to read everything.\n\nYou look for work to do.\n");
  const r = await asp(["society", "cohort", "--local", "--agents", "3", "--model", "m", "--api-key-env", "ANTHROPIC_API_KEY", "--budget-usd", "0.4", "--price-in", "1", "--price-out", "5", "--persona-file", file, "--out", join(dir, "o"), "--max-turns", "2", "--provider-url", url], { ANTHROPIC_API_KEY: SECRET });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /2 persona\(s\)/);
  const run = readdirSync(join(dir, "o")).find((d) => d.startsWith("cohort-"))!;
  const md = readFileSync(join(dir, "o", run, "report.md"), "utf8");
  assert.match(md, /persona: You are curious/);
  assert.match(md, /persona: You look for work/);
  // the real-model path runs through the gateway engine: the tool calls, the model turns and the ends are in the trace
  const trace = readFileSync(join(dir, "o", run, "trace.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(trace.some((e) => e.t === "tool" && e.tool === "look_charters" && e.ok), "a tool call is traced");
  assert.ok(trace.some((e) => e.t === "model" && e.input > 0), "a model turn with its tokens is traced");
  assert.equal(trace.filter((e) => e.t === "end").length, 3, "each agent ends");
  assert.ok(existsSync(join(dir, "o", run, "agents", "agent-01", "run-log.ndjson")), "each agent has a gateway run log");
});

test("DK1801: a run without --local, without a cap, without the variable or with the variable unset is refused with a reason, and the key is never taken as a flag", async () => {
  const common = ["--agents", "1", "--model", "m", "--api-key-env", "COHORT_KEY", "--budget-usd", "0.4", "--price-in", "1", "--price-out", "5"];
  const noLocal = await asp(["society", "cohort", ...common], { COHORT_KEY: SECRET });
  assert.equal(noLocal.code, 2);
  assert.match(noLocal.err, /only on a local society.*--local/);
  const noCap = await asp(["society", "cohort", "--local", "--agents", "1", "--model", "m", "--api-key-env", "COHORT_KEY", "--price-in", "1", "--price-out", "5"], { COHORT_KEY: SECRET });
  assert.equal(noCap.code, 2);
  assert.match(noCap.err, /--budget-usd is needed/);
  const noVar = await asp(["society", "cohort", "--local", "--agents", "1", "--model", "m", "--budget-usd", "0.4", "--price-in", "1", "--price-out", "5"], { COHORT_KEY: SECRET });
  assert.equal(noVar.code, 2);
  assert.match(noVar.err, /--api-key-env names the environment variable/);
  const unset = await asp(["society", "cohort", "--local", ...common], {});
  assert.equal(unset.code, 2);
  assert.match(unset.err, /COHORT_KEY is not set/);
  assert.ok(!unset.err.includes(SECRET));
  const noPrice = await asp(["society", "cohort", "--local", "--agents", "1", "--model", "brand-new", "--api-key-env", "COHORT_KEY", "--budget-usd", "0.4"], { COHORT_KEY: SECRET });
  assert.equal(noPrice.code, 2);
  assert.match(noPrice.err, /brand-new is not in the price table.*--price-in and --price-out.*claude-haiku-5-5/);
  const priced = await asp(["society", "cohort", "--local", "--provider", "stand-in", "--agents", "1", "--model", "claude-haiku-5-5", "--budget-usd", "0.4", "--out", join(tmpdir(), "asp-priced-" + Date.now())], {});
  assert.equal(priced.code, 0, "a priced model needs no price flags: " + priced.err);
  const badProvider = await asp(["society", "cohort", "--local", "--provider", "openai", ...common], { COHORT_KEY: SECRET });
  assert.equal(badProvider.code, 2);
  assert.match(badProvider.err, /--provider is anthropic/);
  const flag = await asp(["society", "cohort", "--local", ...common, "--api-key", SECRET], { COHORT_KEY: SECRET });
  assert.notEqual(flag.code, 0, "there is no flag that takes the key itself");
});

test("DK1801: a finished cohort is in the session index, so `asp runs` lists it and `asp stop --all` has nothing left to stop", async () => {
  const home = mkdtempSync(join(tmpdir(), "asp-cohort-runs-"));
  const run = async (args: string[]) => { const out: string[] = [], err: string[] = []; const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home }, cwd: home } as Io); return { code, text: out.join("\n") + err.join("\n") }; };
  const r = await run(["society", "cohort", "--local", "--provider", "stand-in", "--agents", "1", "--budget-usd", "1", "--minutes", "1", "--out", join(home, "o")]);
  assert.equal(r.code, 0, r.text);
  const runs = await run(["runs"]);
  assert.equal(runs.code, 0, runs.text);
  assert.match(runs.text, /cohort/);
  const stop = await run(["stop", "--all"]);
  assert.match(stop.text, /nothing is running/);
});
