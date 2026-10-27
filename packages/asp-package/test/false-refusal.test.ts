import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { judge } from "../src/index.ts";
// @ts-expect-error a plain .mjs file with no type declarations
import { CASES, CONFINE, MANDATES } from "../../../evals/benchmark/cases.mjs";

// Gap AG3: the rate at which the gateway refuses what it should allow is measured on every run of the tests, and may only go down. A change that raises it fails here, and the person
// making it has to say why in the register. The ceilings are what was measured on 2026-10-28; lower them when the number improves.
const CEILING_OWN = 0.02;      // of the benchmark's own ordinary calls (measured 0 of 128)
const CEILING_BLIND2 = 8 / 135; // of the second blind set's ordinary calls (measured 8 of 135, 6%): the held-out number

test("the gateway wrongly refuses at most 2% of the benchmark's ordinary calls", () => {
  const ordinary = CASES.filter((c: { expect: string }) => c.expect === "allow");
  const wrong = ordinary.filter((c: { call: never; mandate: string }) => { const m = MANDATES[c.mandate]; return !judge(c.call, m.scopes, [], () => false, m.hosts, CONFINE).allow; });
  assert.ok(ordinary.length >= 100, `${ordinary.length} ordinary calls`);
  assert.ok(wrong.length / ordinary.length <= CEILING_OWN, `${wrong.length} of ${ordinary.length} ordinary calls were wrongly refused: ${wrong.slice(0, 3).map((c: { id: string }) => c.id).join(", ")}`);
});

test("on the held-out set (blind2) the wrong refusals do not rise above 8 of 135", () => {
  const cases = JSON.parse(readFileSync(new URL("../../../evals/benchmark/blind2-cases.json", import.meta.url), "utf8")) as { expect: string; mandate: string; call: never }[];
  const ordinary = cases.filter((c) => c.expect === "allow" && MANDATES[c.mandate]);
  const wrong = ordinary.filter((c) => { const m = MANDATES[c.mandate]; return !judge(c.call, m.scopes, [], () => false, m.hosts).allow; });
  assert.equal(ordinary.length, 135);
  assert.ok(wrong.length / ordinary.length <= CEILING_BLIND2 + 1e-9, `${wrong.length} of ${ordinary.length} wrongly refused (the ceiling is 8)`);
});
