// The P1 of the first real run (2026-11-22): Claude Code's default model was not in the price table, the high default made the worst case of ONE call about $5.58, and a $5 cap refused EVERY call, which looks like a key fault.
// `asp live preflight` is RED when the cap cannot admit one worst-case call (with the remedy), the gateway command says the same at its start, and the rule is exact at its boundary. Fake model names, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { capProblem, CLAUDE_CODE_MAX_REPLY_TOKENS, CLAUDE_CODE_REQUEST_CHARS } from "../src/live-cmd.ts";
import { worstCaseUsd } from "@agent-social/asp-package";

const worstAt = (inPerM: number, outPerM: number) => worstCaseUsd({ max_tokens: CLAUDE_CODE_MAX_REPLY_TOKENS, messages: [{ role: "user", content: "x".repeat(CLAUDE_CODE_REQUEST_CHARS) }] }, { inPerM, outPerM });

test("the high default makes one call cost about $5.58, as in the owner's first run, so a $5 cap is a problem with the remedy named", () => {
  const w = worstAt(15, 75);
  assert.ok(w > 5.5 && w < 5.65, `worst case ${w}`);
  const p = capProblem({ cap: 5, model: "claude-fable-5-2" });
  assert.ok(p);
  assert.equal(p!.priced, false);
  assert.match(p!.text, /could cost up to \$5\.58/);
  assert.match(p!.text, /the model claude-fable-5-2 is not in the price table/);
  assert.match(p!.text, /refuses EVERY model call, the first one included/);
  assert.match(p!.text, /not a fault of your key/);
  assert.match(p!.text, /\(1\) name the real prices .* --price-in .* --price-out/);
  assert.match(p!.text, /\(2\) pin a model that is in the table with --model/);
  assert.match(p!.text, /\(3\) raise --budget-usd to at least \$5\.58 plus what you want to spend/);
  assert.match(capProblem({ cap: 5 })!.text, /no --model is named, so if the model Claude Code picks is not in the price table/);
});

test("the boundary is exact: a cap equal to the worst case is enough, one cent under is a problem", () => {
  const w = worstAt(15, 75);
  assert.equal(capProblem({ cap: w, model: "claude-fable-5-2" }), undefined, "exactly the worst case: the gateway admits the call (its test is > cap)");
  assert.ok(capProblem({ cap: w - 0.01, model: "claude-fable-5-2" }), "one cent under");
  assert.equal(capProblem({ cap: w + 0.01, model: "claude-fable-5-2" }), undefined);
  // a priced model: haiku, sonnet and opus pass a $5 cap; the worst case of each is stated
  for (const m of ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5"]) assert.equal(capProblem({ cap: 5, model: m }), undefined, m);
  const opus = worstAt(6, 30), sonnet = worstAt(3.5, 17.5);
  assert.ok(opus < 5 && sonnet < opus);
  assert.ok(capProblem({ cap: opus - 0.01, model: "claude-opus-5-5" }), "an Opus call is a problem under its own worst case");
  assert.equal(capProblem({ cap: opus, model: "claude-opus-5-5" }), undefined);
});

test("naming the real prices removes the problem, a single named price is not enough for an unpriced model, and the numbers in the remedy are the ones used", () => {
  assert.equal(capProblem({ cap: 5, model: "claude-fable-5-2", priceIn: 8, priceOut: 40 }), undefined, "the owner's remedy 1: real prices");
  const half = capProblem({ cap: 4, model: "claude-fable-5-2", priceIn: 8 });
  assert.ok(half, "only the input price named: the output side is still the high default");
  assert.equal(half!.priced, false);
  assert.match(half!.text, /\$8 in and \$75 out per million/);
  assert.ok(capProblem({ cap: 0.5, model: "claude-haiku-5-5" }), "a priced model with a cap below one call");
  assert.equal(capProblem({ cap: 0.5, model: "claude-haiku-5-5" })!.priced, true);
  assert.ok(!/is not in the price table/.test(capProblem({ cap: 0.5, model: "claude-haiku-5-5" })!.text), "a priced model is not called unpriced");
});

// Through the command: the preflight is RED at the boundary, with the remedy; priced models and named prices pass; the key is never printed.
import { mkdirSync } from "node:fs";
import { main, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";
const SECRET = "sk-ant-api03-" + "Q".repeat(40);
async function asp(aspHome: string, args: string[], env: Record<string, string> = {}) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: aspHome, ...env }, cwd: aspHome };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
test("asp live preflight --local: RED for an unpriced model at the owner's $5 cap with the three remedies, GREEN or AMBER at 5.59, GREEN for a priced Opus and for named prices", async () => {
  const f = makeFixture(); mkdirSync(f.aspHome, { recursive: true });
  const env = { ANTHROPIC_API_KEY: SECRET, ASP_CLAUDE_BIN: process.execPath };
  const red = await asp(f.aspHome, ["live", "preflight", "--local", "--model", "claude-fable-5-2", "--budget-usd", "5"], env);
  assert.equal(red.code, 1);
  assert.match(red.out, /RED\s+the budget cap/);
  assert.match(red.out, /\(1\) name the real prices/);
  assert.match(red.out, /\(2\) pin a model that is in the table with --model/);
  assert.match(red.out, /\(3\) raise --budget-usd to at least \$5\.58/);
  assert.ok(!(red.out + red.err).includes(SECRET));
  const under = await asp(f.aspHome, ["live", "preflight", "--local", "--model", "claude-fable-5-2", "--budget-usd", "5.58"], env);
  assert.match(under.out, /RED\s+the budget cap/, "5.58 is one cent under the worst case of 5.5810");
  const over = await asp(f.aspHome, ["live", "preflight", "--local", "--model", "claude-fable-5-2", "--budget-usd", "5.59"], env);
  assert.doesNotMatch(over.out, /RED\s+the budget cap/, "5.59 admits the call");
  assert.match(over.out, /AMBER\s+the budget cap.*not in the price table/);
  const opus = await asp(f.aspHome, ["live", "preflight", "--local", "--model", "claude-opus-5", "--budget-usd", "5"], env);
  assert.match(opus.out, /GREEN\s+the budget cap.*priced at \$6 in and \$30 out/);
  const named = await asp(f.aspHome, ["live", "preflight", "--local", "--model", "claude-fable-5-2", "--budget-usd", "5", "--price-in", "8", "--price-out", "40"], env);
  assert.match(named.out, /GREEN\s+the budget cap.*priced at \$8 in and \$40 out/);
  const unnamed = await asp(f.aspHome, ["live", "preflight", "--local", "--budget-usd", "5"], env);
  assert.match(unnamed.out, /RED\s+the budget cap.*no --model is named/);
});
