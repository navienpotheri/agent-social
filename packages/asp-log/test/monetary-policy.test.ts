/**
 * The written monetary policy and the mints (register row DK1; docs/institutions/economy/credits.md section 2): every way a signed mint can create credits is a named faucet with a rule; the schema's list of mint
 * reasons, the policy table here and the document agree; each rule is refused when broken; and over random sequences of mints, claims, jobs, sales and burns the supply audit reproduces the minted total from the log's
 * signed records alone. Fixed seeds. Fake keys only. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { credit, jump, kit, mk, operator, owner, refusedBy, DAY } from "./society-kit.ts";
import { STARTER_POOL_DID, TREASURY_DID } from "../src/economy.ts";
import { STARTER_PER_DID, STARTER_UPFRONT } from "../src/starter.ts";

/** The policy: each mint reason, who may sign it and what else it needs (the document says the same in words). */
export const MINT_POLICY: Record<string, { signer: "operator"; needs: string }> = {
  starter_upfront: { signer: "operator", needs: "tops up the starter pool; agents claim from the pool by fixed rules" },
  starter_rest: { signer: "operator", needs: "tops up the starter pool; agents claim from the pool by fixed rules" },
  bootstrap: { signer: "operator", needs: "the first credits of a new account" },
  test: { signer: "operator", needs: "tests and rehearsals only" },
  repair: { signer: "operator", needs: "putting right a recorded fault" },
  treasury_issuance: { signer: "operator", needs: "the owner's co-signature" },
  demand: { signer: "operator", needs: "to the Treasury only, with the owner's co-signature, at most a tenth of what performers were paid in 30 days" },
};

test("the schema's mint reasons, the policy table and the written policy name the same faucets", () => {
  const schema = JSON.parse(readFileSync(new URL("../../../spec/schemas/mint.schema.json", import.meta.url), "utf8")) as { properties: { reason: { enum: string[] } } };
  assert.deepEqual([...schema.properties.reason.enum].sort(), Object.keys(MINT_POLICY).sort(), "a new mint reason needs a policy row here and a faucet in credits.md");
  const doc = readFileSync(new URL("../../../docs/institutions/economy/credits.md", import.meta.url), "utf8");
  for (const reason of ["treasury_issuance", "demand"]) assert.match(doc, new RegExp(reason), `credits.md names ${reason}`);
  assert.match(doc, /Operator mint/);
  assert.match(doc, /Starter grant/);
  assert.match(doc, /Sale of purchased credits/);
});

test("each rule of the policy is enforced: only the operator mints, a treasury issuance and a demand mint need the owner, a demand mint goes to the Treasury only, nothing goes to the Burn account", async () => {
  const k = await kit();
  const p = await k.person("policy-p");
  const body = (reason: string, to: string, v = 10) => ({ to, amount: credit(v), reason, authority: "operator" });
  assert.equal(await refusedBy(k.log.append(mk("mint", owner, body("test", p.did), null, { subject: p.did }))), "mint_unauthorised");
  assert.equal(await refusedBy(k.log.append(mk("mint", operator, body("treasury_issuance", TREASURY_DID), null, { subject: TREASURY_DID }))), "mint_needs_cosign");
  await k.log.append(mk("mint", operator, body("treasury_issuance", TREASURY_DID), null, { subject: TREASURY_DID, cosigners: [owner] }));
  assert.equal(await refusedBy(k.log.append(mk("mint", operator, body("demand", p.did), null, { subject: p.did, cosigners: [owner] }))), "demand_mint_to_treasury");
  assert.equal(await refusedBy(k.log.append(mk("mint", operator, body("demand", TREASURY_DID), null, { subject: TREASURY_DID }))), "mint_needs_cosign");
  assert.equal(await refusedBy(k.log.append(mk("mint", operator, body("demand", TREASURY_DID, 5), null, { subject: TREASURY_DID, cosigners: [owner] }))), "demand_mint_cap", "no paid work, no demand mint");
  assert.equal(await refusedBy(k.log.append(mk("mint", operator, body("test", "did:web:asp.local:burn"), null, { subject: "did:web:asp.local:burn" }))), "mint_to_burn");
  assert.equal(await refusedBy(k.log.append(mk("mint", operator, body("test", p.did, 0), null, { subject: p.did }))), "amount_not_positive");
});

test("over random sequences, every credit that exists was minted by a signed record: the audit reproduces the minted total from the signed mints alone, and the books balance after every step", async () => {
  for (const seed0 of [11, 2026, 90210]) {
    const k = await kit();
    await k.withPrices();
    await k.mint(STARTER_POOL_DID, 4000);
    const people = [await k.person("pol-a"), await k.person("pol-b"), await k.person("pol-c")];
    const agents = [await k.agent("pol-ag-a", people[0]), await k.agent("pol-ag-b", people[1]), await k.agent("pol-ag-c", people[2])];
    let seed = seed0;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const reasons = Object.keys(MINT_POLICY).filter((r) => !["treasury_issuance", "demand"].includes(r));
    let minted = 4000;
    for (let step = 0; step < 120; step++) {
      const i = Math.floor(rand() * 3), op = Math.floor(rand() * 5);
      try {
        if (op === 0) { const v = 1 + Math.floor(rand() * 90), reason = reasons[Math.floor(rand() * reasons.length)]; await k.log.append(mk("mint", operator, { to: people[i].did, amount: credit(v), reason, authority: "operator" }, null, { subject: people[i].did })); minted += v; }
        else if (op === 1) { const v = 1 + Math.floor(rand() * 40); await k.log.append(mk("mint", operator, { to: TREASURY_DID, amount: credit(v), reason: "treasury_issuance", authority: "operator" }, null, { subject: TREASURY_DID, cosigners: [owner] })); minted += v; }
        else if (op === 2) await k.log.append(mk("starter_claim", agents[i], { part: "upfront", amount: credit(STARTER_UPFRONT) }, null, { subject: agents[i].did }));
        else if (op === 3) await k.buy(people[i], "registry.name.claim", 10);
        else await k.runJob(people[i], agents[(i + 1) % 3], 60);
      } catch { /* a refused step must leave the books as they were */ }
      if (step % 10 === 0) jump(DAY);
      const a = await k.log.creditAudit();
      assert.equal(a.verdict, "balanced", `seed ${seed0} step ${step}: ${a.problems.join("; ")}`);
    }
    const signed = (await k.log.recordsOfTypes(["mint"])).reduce((n, r) => n + (r.body as { amount: { value: number } }).amount.value, 0);
    const a = await k.log.creditAudit();
    assert.equal(a.mintedSigned, signed, "the signed total the audit reports is the sum of the signed mint records");
    assert.equal(a.minted, a.mintedSigned + a.mintedUnsigned);
    assert.equal(signed, minted, "every mint the sequence made, and no other, is a signed record");
    assert.equal(a.mintedUnsigned, 0, "this log has no unsigned mint");
    assert.equal((await k.log.verify()).ok, true, "a replica reproduces every balance");
  }
  void STARTER_PER_DID;
});
