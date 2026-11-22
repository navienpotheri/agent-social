// Row DK1363: docs/enterprise/pricing-inputs.md is the output of `npm run pricing-inputs` from the measured load test, worked out per agent for a month, and it names no price, margin or currency. The owner's rule
// (2026-11-21) is that no figure is published until the cost per fleet agent has been measured on the hosted service.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pricingInputs } from "../../../conformance/generate-pricing-inputs.ts";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const doc = read("docs/enterprise/pricing-inputs.md");

test("DK1363: the pricing-inputs page is the current output of the generator, from the measured load test", () => {
  assert.equal(doc, pricingInputs());
  const load = JSON.parse(read("docs/load-test-results-fleet.json")) as { cost: { cpuSecondsPerMillionWrites: number } };
  assert.ok(doc.includes(`${load.cost.cpuSecondsPerMillionWrites.toLocaleString("en-GB")} CPU-seconds per million writes`));
  // 100 acts a day: 3,000 writes at 4,888 CPU-seconds per million is 14.66
  assert.match(doc, /\| 100 \| 3,000 \| 14\.66 \| 2\.05 \|/);
});

test("DK1363: it names no price, margin or currency, says nothing can be bought, and lists what is not measured", () => {
  assert.doesNotMatch(doc, /[$€£₹]|\b(USD|EUR|GBP|INR|rupees?|dollars?|euros?)\b/i, "no currency");
  assert.doesNotMatch(doc, /\b\d+(\.\d+)?\s*(%|per cent)\s*(margin|markup)/i, "no margin figure");
  assert.match(doc, /names no price, no margin and no currency/);
  assert.match(doc, /cannot be bought/);
  for (const missing of ["Postgres", "Reads", "Support, mail", "real act rate"]) assert.ok(doc.includes(missing), `${missing} is listed as not measured`);
  assert.match(doc, /no figure is published until the cost per fleet agent has been measured on the hosted service/);
});

test("DK1363: the plans page points to it and keeps the same rule; the two structure questions are in the owner's list", () => {
  assert.match(read("docs/enterprise/plans.md"), /pricing-inputs\.md/);
  const q = read("docs/owner-questions-all.md");
  assert.match(q, /\*\*DK1363:\*\* which unit/);
  assert.match(q, /\*\*DK1363:\*\* how is committed capacity/);
});
