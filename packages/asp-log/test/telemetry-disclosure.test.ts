// Rows DK79 and DK1303: the always-on telemetry disclosure is generated from the signals the code collects. A signal without an entry, an entry without a signal, a privacy notice that differs from
// the generated block, and a category claimed before a signal collects it all fail here, so the text and the code cannot drift.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DISCLOSURE, DISCLOSURE_BEGIN, DISCLOSURE_END, NOT_YET_COLLECTED, SIGNALS, disclosureMarkdown } from "../src/index.ts";

const privacy = readFileSync(new URL("../../../docs/legal/privacy.md", import.meta.url), "utf8");

test("every signal has a disclosure entry and every entry is for a signal", () => {
  assert.deepEqual(Object.keys(DISCLOSURE).sort(), [...SIGNALS].sort());
  for (const s of SIGNALS) { assert.ok(DISCLOSURE[s].category.length > 2); assert.ok(DISCLOSURE[s].what.length > 10); }
});

test("the generated block names every category, what is scrubbed, where it is stored, who can see it, how to list and delete it, and the organisation and young-person rules", () => {
  const md = disclosureMarkdown();
  for (const s of SIGNALS) assert.ok(md.includes(`**${DISCLOSURE[s].category}:**`), `${s} is named`);
  for (const re of [/Scrubbing/, /secrets/, /personal data/, /apart from the signed log/, /Only a hash/, /sponsor of the agent can see them/, /never public/, /asp telemetry list/, /asp telemetry delete --all/, /organisation may choose/i, /nothing for a tenant held for a young person/]) assert.match(md, re);
});

test("a category of the owner's decision that no signal collects is not claimed as collected", () => {
  const md = disclosureMarkdown().toLowerCase();
  for (const c of NOT_YET_COLLECTED) assert.ok(!md.includes(`**${c}:**`), `${c} is not claimed`);
});

test("the privacy notice carries the generated block exactly", () => {
  const a = privacy.indexOf(DISCLOSURE_BEGIN), b = privacy.indexOf(DISCLOSURE_END);
  assert.ok(a >= 0 && b > a, "the markers are in docs/legal/privacy.md");
  assert.equal(privacy.slice(a, b + DISCLOSURE_END.length), disclosureMarkdown());
});
