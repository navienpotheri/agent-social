// docs/cohort-run-card.md is the owner's one page for the model-cohort run (register row DK1801). Every `asp` command on it is run through the real command line against a local stand-in that speaks the provider's
// interface (a fake key, no outside network), with only the folder, the provider address and a short turn limit swapped in; each must finish and write a report, the lines that the card says to expect are lines that the
// run prints, the run verifies from what it left on disk, the card's amounts follow from its own caps, and its never-dos and standing statements are kept.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";
import { verifyCohortRun } from "../src/cohort/verify.ts";
import { isPricedModel } from "@agent-social/asp-package";

const SECRET = "sk-test-NOT-A-REAL-KEY-card-1234567890";
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const card = readFileSync(new URL("../../../docs/cohort-run-card.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
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
async function asp(args: string[], env: Record<string, string> = {}, home = mkdtempSync(join(tmpdir(), "asp-card-home-"))) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home, ...env }, cwd: home };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n"), home };
}
const blocks = [...card.matchAll(/```powershell\n([\s\S]*?)```/g)].map((m) => m[1]!.trim());
const lines = blocks.flatMap((b) => b.split("\n"));
const asps = lines.filter((l) => l.startsWith("npm run asp -- ")).map((l) => l.slice("npm run asp -- ".length));
const cohorts = asps.filter((l) => l.startsWith("society cohort ") && !l.startsWith("society cohort verify"));
const tokens = (cmd: string): string[] => cmd.split(/\s+/).filter(Boolean);

test("the card gives the dry run, then one, three and fifteen agents, in that order, with the owner's model and caps", () => {
  assert.equal(cohorts.length, 4);
  assert.match(cohorts[0]!, /--provider stand-in --agents 3/);
  assert.match(cohorts[1]!, /--agents 1 --model claude-haiku-5-5 --api-key-env ANTHROPIC_API_KEY --budget-usd 0\.40/);
  assert.match(cohorts[2]!, /--agents 3 --model claude-haiku-5-5/);
  assert.match(cohorts[3]!, /--agents 15 --model claude-haiku-5-5 .*--budget-usd 0\.40 --total-usd 6 /);
  assert.ok(isPricedModel("claude-haiku-5-5"), "the model is in the price table, so no price flags are needed");
  for (const c of cohorts) assert.ok(c.includes("--local"), `${c} is local`);
  for (const c of cohorts.slice(1)) assert.doesNotMatch(c, /--price-in|--provider-url|--persona-file/);
  assert.ok(lines.includes('$env:ANTHROPIC_API_KEY = "PASTE-YOUR-OWN-KEY"'), "the key is set in the window and is a placeholder");
});

test("every cohort command on the card runs and writes a report; the lines that the card says to expect are printed; the run verifies and holds no key", async () => {
  const url = await fakeProvider();
  const expected: Record<number, string[]> = {
    0: ["cohort: 3 agents of stand-in through stand-in, on a local society only; no goal is given and no persona is used.", "worst case for the whole run: $3.00.", "3 agents enrolled", "done: 3 agents, estimated spend"],
    1: ["cohort: 1 agent of claude-haiku-5-5 through anthropic, on a local society only; no goal is given and no persona is used.", "caps: $0.4 per agent, $0.4 in all, 15 minutes", "worst case for the whole run: $0.40.", "1 agent enrolled; model claude-haiku-5-5", "done: 1 agents, estimated spend $"],
    2: ["cohort: 3 agents of claude-haiku-5-5", "caps: $0.4 per agent, $1.2000000000000002 in all", "worst case for the whole run: $1.20.", "3 agents enrolled"],
    3: ["cohort: 15 agents of claude-haiku-5-5", "caps: $0.4 per agent, $6 in all, 20 minutes", "worst case for the whole run: $6.00.", "15 agents enrolled"],
  };
  for (const [i, cmd] of cohorts.entries()) {
    const out = mkdtempSync(join(tmpdir(), "asp-card-out-"));
    const real = !/--provider stand-in/.test(cmd);
    const r = await asp([...tokens(cmd), "--out", out, "--max-turns", "3", ...(real ? ["--provider-url", url] : [])], { ANTHROPIC_API_KEY: SECRET });
    assert.equal(r.code, 0, `${cmd}: ${r.err || r.out}`);
    for (const frag of expected[i]!) {
      assert.ok(r.out.includes(frag), `${cmd}: the run prints ${JSON.stringify(frag)}`);
      assert.ok(card.includes(frag), `the card says to expect ${JSON.stringify(frag)}`);
    }
    assert.match(r.out, /what happened, in words: .*report\.md/);
    assert.match(r.out, /raw trace: .*trace\.jsonl/);
    const dirs = readdirSync(out).filter((d) => d.startsWith("cohort-"));
    assert.equal(dirs.length, 1);
    const dir = join(out, dirs[0]!);
    assert.ok(existsSync(join(dir, "report.md")) && existsSync(join(dir, "trace.jsonl")), `${cmd}: a report and a trace`);
    const v = await verifyCohortRun(dir, { env: { ANTHROPIC_API_KEY: SECRET }, keyEnvs: ["ANTHROPIC_API_KEY"] });
    assert.equal(v.ok, true, `${cmd}: ${JSON.stringify(v.checks.filter((c) => !c.ok))}`);
    for (const f of [...filesUnder(out), ...filesUnder(r.home)]) assert.ok(!readFileSync(f).includes(SECRET), `${f} holds the key`);
    assert.ok(!r.out.includes(SECRET) && !r.err.includes(SECRET), "the key is not printed");
    if (i === 1) {
      // The verify command of the card, with the run folder filled in, prints a PASS line for each check and exits 0.
      const verify = asps.find((c) => c.startsWith("society cohort verify "))!;
      assert.match(verify, /<run folder> --api-key-env ANTHROPIC_API_KEY$/);
      const w = await asp(tokens(verify.replace("<run folder>", "RUNFOLDER")).map((t) => (t === "RUNFOLDER" ? dir : t)), { ANTHROPIC_API_KEY: SECRET });
      assert.equal(w.code, 0, w.err || w.out);
      assert.equal((w.out.match(/PASS/g) ?? []).length, 9, "nine checks, as the card says");
      assert.doesNotMatch(w.out, /FAIL/);
    }
  }
});

test("without the key in the window, the real steps refuse and say so, as the card says; without --local nothing starts", async () => {
  const r = await asp(tokens(cohorts[1]!), {});
  assert.equal(r.code === 0, false);
  assert.match(r.err + r.out, /the environment variable ANTHROPIC_API_KEY is not set/);
  assert.ok(card.includes("the environment variable ANTHROPIC_API_KEY is not set"));
  const nl = await asp(tokens(cohorts[1]!).filter((t) => t !== "--local"), { ANTHROPIC_API_KEY: SECRET });
  assert.equal(nl.code === 0, false);
  assert.match(nl.err + nl.out, /add --local/);
  const np = await asp(tokens(cohorts[1]!).map((t) => (t === "claude-haiku-5-5" ? "some-unpriced-model" : t)), { ANTHROPIC_API_KEY: SECRET });
  assert.match(np.err + np.out, /is not in the price table/);
  assert.ok(card.includes("is not in the price table"));
});

test("the stop command is a documented command and ends nothing when nothing runs; the quiet switch and the second window are explained", async () => {
  const stop = asps.find((c) => c === "stop --all");
  assert.ok(stop, "stop --all is on the card");
  const r = await asp(["stop", "--all"]);
  assert.equal(r.code, 0, r.err || r.out);
  const cmdMd = readFileSync(new URL("../../../docs/commands.md", import.meta.url), "utf8");
  assert.match(cmdMd, /`asp stop --all/);
  assert.match(card, /empty file called `STOP`/);
  assert.match(card, /set the same value in the second/);
  assert.match(card, /`stop requested`/);
  assert.match(readFileSync(new URL("../src/cohort/run.ts", import.meta.url), "utf8"), /stop requested \(\$\{why\}\)/);
});

test("the card's amounts follow from its caps, and the never-dos and the standing statements are kept", () => {
  assert.ok(Math.abs(0.4 + 3 * 0.4 + 6 - 7.6) < 1e-9);
  assert.match(card, /0\.40 \+ 1\.20 \+ 6\.00 = USD 7\.60/);
  assert.match(card, /Credits are mock accounting entries, not money/);
  assert.match(card, /The service is a beta/);
  assert.match(card, /no outside security review/);
  assert.match(card, /not the provider's bill/);
  assert.match(card, /\*\*not\*\* "Run as administrator"/);
  assert.match(card, /put a key in the repository, in a file or in a command line/);
  assert.match(card, /nothing in it says that any rule makes an agent more aligned/);
  assert.match(card, /there is no hosted run/);
  assert.doesNotMatch(card, /sk-[A-Za-z0-9_-]{20,}|BEGIN [A-Z ]*PRIVATE KEY/);
  for (const m of card.matchAll(/\]\(([^)#]+)\)/g)) assert.ok(existsSync(new URL(`../../../docs/${m[1]}`, import.meta.url)), `${m[1]} exists`);
  // The long form's commands are the same commands: each real step of the card is in society-models-run.md.
  const long = readFileSync(new URL("../../../docs/society-models-run.md", import.meta.url), "utf8");
  for (const c of cohorts) assert.ok(long.includes(c.replace(" --max-turns 3", "")) || long.includes(`npm run asp -- ${c}`), `the long form has: ${c}`);
});
