// Register row DK1405: the journey view says, in words, that a contract is between related parties (DK1344), and says nothing of the kind for an independent one.
// The job board's label is tested in self-hire.test.ts. Fake keys only; credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign } from "@agent-social/asp-core";
import { Kit, bankP, hashOf, credit, type Party } from "./academy-kit.ts";
import { journeyOf } from "../src/journey.ts";
import type { StoredRec } from "../src/society-story.ts";

const hire = (k: Kit, principal: Party, performer: Party) =>
  cosign(k.mk("contract", principal, { principal: principal.did, performer: performer.did, bank: bankP.did, purpose: "A job", price: credit(100), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: hashOf("0"), offer: hashOf("1") } }, null, { subject: performer.did }), performer);
const stored = async (k: Kit) => (await (k.log as unknown as { since: (a: number, l: number) => Promise<StoredRec[]> }).since(0, 100000));

test("the journey of a related-party hire carries the label and the words; an independent hire carries neither", async () => {
  const k = new Kit();
  const sponsor = await k.person("journey-sponsor");
  const a1 = await k.agent("journey-a1", sponsor), a2 = await k.agent("journey-a2", sponsor), stranger = await k.agent("journey-stranger", await k.person("journey-other"));
  await k.put(hire(k, a1, a2));
  await k.put(hire(k, a1, stranger));
  const inp = { stored: await stored(k), now: "2026-11-21T00:00:00Z" };
  for (const view of ["public", "sponsor"] as const) {
    const j = journeyOf(inp, a1.did, view)!;
    const hired = j.steps.filter((s) => s.kind === "hired");
    assert.equal(hired.length, 2);
    const related = hired.find((s) => s.with.includes(journeyOf(inp, a2.did, view)!.name))!;
    assert.equal(related.related, "same_sponsor");
    assert.match(related.text, /the two are related \(one sponsor\), which grants and removes nothing/);
    const indep = hired.find((s) => s !== related)!;
    assert.equal(indep.related, undefined);
    assert.doesNotMatch(indep.text, /related/);
    const performer = journeyOf(inp, a2.did, view)!.steps.find((s) => s.kind === "was_hired")!;
    assert.equal(performer.related, "same_sponsor", "the performer's journey carries it too");
  }
});

test("a sponsor and its own agent are related", async () => {
  const k = new Kit();
  const sponsor = await k.person("journey-owner");
  const a = await k.agent("journey-owned", sponsor);
  await k.put(hire(k, sponsor, a));
  const all = await stored(k);
  const j = journeyOf({ stored: all, now: "2026-11-21T00:00:00Z" }, a.did)!;
  assert.equal(j.steps.find((s) => s.kind === "was_hired")!.related, "same_sponsor");
});
