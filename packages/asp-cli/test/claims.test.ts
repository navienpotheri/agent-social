// The numbers the repository and the deck state publicly (register row DK66): one file holds them (docs/claims.json) and every public text is checked against it, so a stale count or an unqualified
// benchmark figure or a court described as more than it is cannot come back unnoticed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (p: string) => readFileSync(root + p, "utf8");
const claims = JSON.parse(read("docs/claims.json"));

test("the test count the texts state is true to what was counted, and every public text states the same figure", () => {
  const counted = claims.counted.typescript_suites + claims.counted.python;
  assert.ok(claims.tests_floor <= counted, `the stated floor ${claims.tests_floor} is no more than the ${counted} counted`);
  assert.match(read("README.md"), new RegExp(claims.tests_phrase));
  assert.match(read("AGENTS.md"), /more than 1,500 tests/);
  assert.ok(read("docs/agent-social-wsai-deck.html").includes(`>${claims.deck_tests_big_number}</p>`), "the deck's big number is the one in claims.json");
  assert.match(read("site/llms-full.txt"), new RegExp(claims.tests_phrase), "the generated site text follows the README");
  for (const p of ["README.md", "AGENTS.md", "docs/agent-social-wsai-deck.html", "site/llms-full.txt"]) {
    assert.doesNotMatch(read(p), /740\+|about 700 (automated )?tests/, `${p} has a stale test count`);
  }
});

test("the benchmark figure on the deck carries its context: the held-out set, the denylist and the model guard it is compared with, and that the gateway is rules-only", () => {
  const deck = read("docs/agent-social-wsai-deck.html");
  const b = claims.benchmark;
  assert.ok(deck.includes(`<b>${b.blocks_percent}%</b>`) && deck.includes(`<b>${b.false_refusals_percent}%</b>`));
  assert.ok(deck.includes(`${b.denylist_blocks_percent}% and ${b.denylist_false_refusals_percent}%`));
  assert.ok(deck.includes(`${b.model_guard_blocks_percent}% and ${b.model_guard_false_refusals_percent}%`), "the language-model guard's figure is shown beside it");
  assert.match(deck, /second, separate blind set/);
  assert.match(deck, /rules-only gateway/);
  assert.ok(read("docs/benchmark-article.md").includes(`(Claude Haiku 5.5) | ${b.model_guard_blocks_percent}% | ${b.model_guard_false_refusals_percent}%`), "the figure matches the article it comes from");
});

test("the court is described as what it is: operator-run in the beta, on a mock bank", () => {
  const deck = read("docs/agent-social-wsai-deck.html");
  assert.match(deck, /Courts, operator-run in the beta/);
  assert.match(deck, /the operator seats the panel and the bank is a mock/);
  assert.doesNotMatch(deck, /Decentralized Courts/);
  assert.match(read("README.md"), /operator/i);
});
