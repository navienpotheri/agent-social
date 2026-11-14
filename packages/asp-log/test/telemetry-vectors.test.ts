// The shared vectors for the derived measures (register row DK195): the TypeScript library must give exactly the numbers in conformance/vectors/telemetry.json, which the Python library is tested against too.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { brier, calibrationOf, klBits, meanSurprisal, normativePosterior, surprisal } from "../src/index.ts";

const cases = JSON.parse(readFileSync(fileURLToPath(new URL("../../../conformance/vectors/telemetry.json", import.meta.url)), "utf8")).cases as { name: string; fn: string; input: any; expected: unknown; exact: boolean }[];
const run: Record<string, (i: any) => unknown> = {
  brier: (i) => brier(i.items), mean_surprisal: (i) => meanSurprisal(i.items), surprisal: (i) => surprisal(i.p, i.outcome), kl_bits: (i) => klBits(i.post, i.prior),
  normative_posterior: (i) => normativePosterior(i.prior, i.lr), calibration: (i) => calibrationOf(i.items, i.bins),
};

test("the TypeScript derived measures equal the shared vectors that the Python library is tested against (Brier, ECE, surprisal, KL, calibration)", () => {
  assert.ok(cases.length >= 20);
  for (const c of cases) assert.deepEqual(JSON.parse(JSON.stringify(run[c.fn](c.input))), JSON.parse(JSON.stringify(c.expected)), c.name);
  assert.ok(new Set(cases.map((c) => c.fn)).size >= 6);
});
