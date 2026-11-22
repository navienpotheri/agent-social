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

test("the card makes the owner name his model's price, because an unpriced model under a cap of USD 5 is refused on every call", () => {
  assert.ok(card.includes("**Name your model's price. This step cannot be skipped.**"));
  assert.match(card, /every model call is refused/);
  assert.match(card, /claude-opus-5/);
  assert.ok(card.split("--price-in <in> --price-out <out>").length - 1 >= 2, "both runs carry the price flags");
  assert.ok(card.includes("--price-in <dollars per million input tokens> --price-out <dollars per million output tokens>"), "the preflight too");
  const script = read("scripts/evening-rehearsal.ps1");
  assert.ok(script.includes("$priceFlags"), "the rehearsal names a price");
  assert.ok(script.includes("(?<![0-9])1 refused"), "a count of 11 refused is not read as 1 refused");
  assert.ok(script.includes("tonight: the model's price"));
});
