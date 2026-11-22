// Row DK1302: docs/evidence/agents-hire-agents.md is the output of the scripted run on the real log (`npm run hire-evidence`), and says what it shows: the poster paid, the worker was paid, the second starter claim was
// accepted after an independent job, and each of five cases that look like hiring but are not independent was refused with the log's own rule name. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hireEvidence } from "../../../conformance/generate-hire-evidence.ts";

const file = readFileSync(new URL("../../../docs/evidence/agents-hire-agents.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("DK1302: the evidence page is the current output of the scripted run (run `npm run hire-evidence` after a change)", async () => {
  assert.equal(file, await hireEvidence());
});

test("DK1302: the run shows both balances moving, the second claim accepted after an independent job, and five cases refused by name; it claims no real agents and no alignment", () => {
  assert.match(file, /\| Poster \| 300 \| 260 /);
  assert.match(file, /\| Worker \| 100 \| 140 \(\+40\)/);
  assert.match(file, /second claim is accepted/);
  assert.equal((file.match(/`starter_rest_not_earned`/g) ?? []).length, 6, "once before the job, then the five cases");
  assert.match(file, /does not show real agents choosing to hire/);
  assert.match(file, /Nothing here says that any rule makes an agent more aligned/);
  assert.match(file, /Credit audit: `balanced`; the log verifies: `true`/);
});
