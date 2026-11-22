// docs/tonight.md is the owner's one-page card for the live run. Its commands are checked by owner-kits-commands.test.ts; this test keeps its promises: the two things never to do, the stop command, the cost
// cap, the owner's recorded answers, and that every file and script it names exists, in the order of the steps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const card = read("docs/tonight.md");

test("the card says what never to do, how to stop, and where to look at the cost", () => {
  assert.match(card, /put a key in the repository/);
  assert.ok(card.includes('**not** "Run as administrator"'), "the card says not to run as an administrator");
  assert.match(card, /npm run asp -- stop --all/);
  assert.match(card, /npm run asp -- live report/);
  assert.match(card, /provider's own usage page/);
  assert.match(card, /USD 5 an agent/);
  assert.match(card, /Credits are mock accounting entries, not money/);
  assert.match(card, /no outside security review/);
});

test("the card records the owner's answers of 2026-11-22 and agrees with the decisions file", () => {
  assert.match(card, /Claude Code first, then Codex/);
  assert.match(card, /your own key in this window only/);
  const decisions = read("docs/owner-decisions.md");
  assert.match(decisions, /Claude Code first, then Codex/);
  assert.match(decisions, /USD 5 an agent for each run/);
});

test("the steps come in order and every file the card names exists", () => {
  const order = ["Step 1: the rehearsal", "Step 2: set up", "Step 3: item 1", "Step 4: item 5", "To stop, to hold", "After the run"].map((h) => card.indexOf(h));
  assert.ok(order.every((i) => i >= 0), "every heading is there");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "in order");
  assert.ok(existsSync(new URL("scripts/evening-rehearsal.ps1", root)));
  for (const m of card.matchAll(/\]\(([^)#]+)\)/g)) assert.ok(existsSync(new URL(`docs/${m[1]}`, root)), `${m[1]} exists`);
});

test("the card tells the owner how to know that his cap admits one call, and what to do when it does not", () => {
  assert.ok(card.includes("**Check that your cap admits one call.**"));
  assert.match(card, /every model call would be refused/);
  assert.match(card, /goes \*\*RED\*\* on the line "the budget cap"/);
  assert.ok(card.includes("`budget   WARNING:`"), "the warning that asp run prints");
  assert.match(card, /gpt-5\.5, which Codex uses, and the Fable models are \*\*not\*\*/);
  assert.ok(card.includes("--price-in <in> --price-out <out>"), "the remedy names the flags");
  assert.ok(card.includes("--model"), "the other remedies");
  const script = read("scripts/evening-rehearsal.ps1");
  assert.ok(script.includes("$priceFlags"), "the rehearsal names a price");
  assert.ok(script.includes("(?<![0-9])1 refused"), "a count of 11 refused is not read as 1 refused");
  assert.ok(script.includes("tonight: the model's price"));
});

test("what the card says about the price table and the cap is what the code does", async () => {
  const { capProblem } = await import("../src/live-cmd.ts");
  const { isPricedModel } = await import("@agent-social/asp-package");
  for (const m of ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5", "claude-opus-5.5"]) assert.equal(isPricedModel(m), true, `${m} is priced`);
  for (const m of ["gpt-5.5", "claude-fable-5-2"]) assert.equal(isPricedModel(m), false, `${m} is not priced`);
  assert.equal(capProblem({ cap: 5, model: "claude-opus-5" }), undefined, "an Opus model admits a call under USD 5");
  const unpriced = capProblem({ cap: 5, model: "gpt-5.5" });
  assert.ok(unpriced && unpriced.worstUsd > 5 && unpriced.worstUsd < 6, "an unpriced model: about USD 5.58");
  assert.equal(capProblem({ cap: 5, model: "gpt-5.5", priceIn: 3, priceOut: 15 }), undefined, "named prices admit it");
  const opus = capProblem({ cap: 2, model: "claude-opus-5" });
  assert.ok(opus && opus.worstUsd > 2 && opus.worstUsd < 2.5, "an Opus model needs a cap above about USD 2.2");
});
