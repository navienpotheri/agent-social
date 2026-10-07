import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { cosign } from "@agent-social/asp-core";
import { EventLog } from "../src/index.ts";
import { alice, bank, coder, failure, memory, party, passport, pgUrl, postgres, rec, registerParties, type Harness } from "./harness.ts";

const verifier = party("panel"); // an independent DID, not sponsored by anyone in the job
const mallory = party("mallory"); // registered below as an agent sponsored by alice (the principal)
const art = (n: string) => ({ uri: `asp://trace/${n}`, sha256: "sha256:" + Buffer.from(n).toString("hex").padEnd(64, "0").slice(0, 64) });

const contractBody = (extra: Record<string, unknown> = {}) => ({
  principal: alice.did, performer: coder.did, bank: bank.did, verifier: verifier.did,
  purpose: "Screen candidate materials", price: { value: 0, unit: "credit" as const },
  verification: "outcome" as const, deadline: "2026-10-30T18:00:00Z", review_deadline: "2026-10-04T00:00:00Z",
  basis: { intent: "sha256:" + "0".repeat(64), offer: "sha256:" + "1".repeat(64) }, ...extra,
});

const CLAIMS = [
  { claim: "the band gap is 2.35 eV", grade: "predicted" as const },
  { claim: "all 50 test runs pass", grade: "measured" as const, evidence: art("span-7") },
];

/** contract -> bond -> mandate -> delivery (with claims), reaching Delivered. */
async function delivered(log: EventLog, opts: { verifier?: boolean; claims?: unknown[] } = {}) {
  const body = contractBody();
  if (opts.verifier === false) delete (body as Record<string, unknown>).verifier;
  const contract = cosign(rec("contract", alice, body, null, coder.did), coder);
  await log.append(contract);
  const bond = rec("bond", coder, {
    contract: contract.id, backer: coder.did, amount: { value: 0, unit: "credit" as const },
    escrow: { payer: alice.did, amount: { value: 0, unit: "credit" as const } }, slashing_conditions: ["lost_dispute" as const],
  }, contract.id, contract.id);
  await log.append(bond);
  const mandate = rec("mandate", alice, {
    contract: contract.id, purpose: "Screen candidate materials", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [],
    spend: { cap: 0, unit: "credit" as const }, irreversible: { policy: "checkpoint" as const }, subcontract: { allowed: false },
    nodes: { max_parallel: 1 }, learning: { scope: "harness" as const, share_to_commons: false }, self_modification: "principal_approves" as const,
    overlay: null, checkpoints: [], expires: "2026-10-30T00:00:00Z", revocable: true,
  }, bond.id, coder.did);
  await log.append(mandate);
  const delivery = rec("delivery", coder, {
    contract: contract.id,
    result: { summary: "two candidates", artifacts: [], ...(opts.claims === undefined ? { claims: CLAIMS } : opts.claims.length ? { claims: opts.claims } : {}) },
    evidence: { trace: art("trace"), forecasts: [] },
  }, mandate.id, contract.id);
  const res = await log.append(delivery);
  assert.equal(res.state, "Delivered");
  return { contract, delivery };
}

const verification = (by: typeof verifier, about: string, verdict: string, claims?: { index: number; grade: string }[]) =>
  rec("attestation", by, { kind: "verification", about, verdict, ...(claims ? { claims } : {}) }, null, about);
const acceptance = (about: string, prev: string, contract: string, verdict = "accepted") =>
  rec("attestation", alice, { kind: "acceptance", about, verdict, ...(verdict === "rejected" ? { reasons: ["not what I asked for"] } : {}) }, prev, contract);
const GOOD = [{ index: 0, grade: "predicted" }, { index: 1, grade: "measured" }];

async function parties(log: EventLog) {
  await registerParties(log);
  await log.append(passport(verifier.did, verifier, [verifier], null));
  await log.append(passport(mallory.did, alice, [mallory], null, true));
}

for (const h of [memory, postgres] as Harness[]) {
  describe(`outcome verification on ${h.name}`, { skip: h === postgres && !pgUrl && "set ASP_TEST_DATABASE_URL to run" }, () => {
    after(() => h.cleanup());
    const fresh = async (opts?: Parameters<typeof delivered>[1]) => {
      const log = new EventLog(await h.make());
      await parties(log);
      return { log, ...(await delivered(log, opts)) };
    };

    test("a confirming verification by the named, independent verifier lets the principal accept", async () => {
      const { log, contract, delivery } = await fresh();
      await log.append(verification(verifier, delivery.id, "confirmed", GOOD));
      assert.equal((await log.verificationOf(delivery.id))?.verdict, "confirmed");
      const res = await log.append(acceptance(delivery.id, delivery.id, contract.id));
      assert.equal(res.state, "Delivered");
    });

    test("without a verification, acceptance is refused; rejection is still free", async () => {
      const { log, contract, delivery } = await fresh();
      assert.equal((await failure(log.append(acceptance(delivery.id, delivery.id, contract.id))))?.detail, "verification_required");
      assert.equal((await log.append(acceptance(delivery.id, delivery.id, contract.id, "rejected"))).state, "Disputed");
    });

    test("a verdict of not_confirmed blocks acceptance, but partly_confirmed leaves the principal to decide", async () => {
      const a = await fresh();
      await a.log.append(verification(verifier, a.delivery.id, "not_confirmed"));
      assert.equal((await failure(a.log.append(acceptance(a.delivery.id, a.delivery.id, a.contract.id))))?.detail, "verification_required");

      const b = await fresh();
      await b.log.append(verification(verifier, b.delivery.id, "partly_confirmed", [{ index: 0, grade: "unverified" }, { index: 1, grade: "measured" }]));
      assert.equal((await b.log.append(acceptance(b.delivery.id, b.delivery.id, b.contract.id))).state, "Delivered");
    });

    test("a contract that names no verifier behaves exactly as before", async () => {
      const { log, contract, delivery } = await fresh({ verifier: false });
      assert.equal((await log.append(acceptance(delivery.id, delivery.id, contract.id))).state, "Delivered");
      assert.equal((await failure(log.append(verification(verifier, delivery.id, "confirmed", GOOD))))?.detail, "no_verifier_named");
    });

    test("only the named verifier, and never the principal, the performer, or anyone they sponsor", async () => {
      const { log, delivery } = await fresh();
      assert.equal((await failure(log.append(verification(mallory, delivery.id, "confirmed", GOOD))))?.detail, "not_the_verifier");

      // The same conflict rules, with the verifier named by the contract being each conflicted party in turn.
      for (const [name, who] of [["the principal", alice], ["the performer", coder], ["a DID sponsored by the principal", mallory]] as const) {
        const log2 = new EventLog(await h.make());
        await parties(log2);
        const d = await delivered(log2);
        const body = { ...contractBody(), verifier: who.did };
        const c2 = cosign(rec("contract", alice, body, null, coder.did), coder);
        // A second contract naming the conflicted party; its Delivery is verified by that party.
        await log2.append(c2);
        const bond = rec("bond", coder, {
          contract: c2.id, backer: coder.did, amount: { value: 0, unit: "credit" as const },
          escrow: { payer: alice.did, amount: { value: 0, unit: "credit" as const } }, slashing_conditions: ["lost_dispute" as const],
        }, c2.id, c2.id);
        await log2.append(bond);
        const mandate = rec("mandate", alice, {
          contract: c2.id, purpose: "x", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [],
          spend: { cap: 0, unit: "credit" as const }, irreversible: { policy: "checkpoint" as const }, subcontract: { allowed: false },
          nodes: { max_parallel: 1 }, learning: { scope: "harness" as const, share_to_commons: false }, self_modification: "principal_approves" as const,
          overlay: null, checkpoints: [], expires: "2026-10-30T00:00:00Z", revocable: true,
        }, bond.id, coder.did);
        await log2.append(mandate);
        const delivery = rec("delivery", coder, { contract: c2.id, result: { summary: "s", artifacts: [] }, evidence: { trace: art("t"), forecasts: [] } }, mandate.id, c2.id);
        await log2.append(delivery);
        assert.equal((await failure(log2.append(verification(who, delivery.id, "confirmed"))))?.detail, "verifier_conflicted", name);
        assert.ok(d.delivery.id, "the first contract is unaffected");
      }
    });

    test("claims: unknown, duplicate and incomplete gradings are refused, and a downgrade cannot be called confirmed", async () => {
      const { log, delivery } = await fresh();
      const detail = async (verdict: string, claims?: { index: number; grade: string }[]) =>
        (await failure(log.append(verification(verifier, delivery.id, verdict, claims))))?.detail;
      assert.equal(await detail("confirmed", [...GOOD, { index: 2, grade: "measured" }]), "verification_claim_unknown");
      assert.equal(await detail("confirmed", [{ index: 0, grade: "predicted" }, { index: 0, grade: "predicted" }]), "verification_claim_duplicate");
      assert.equal(await detail("confirmed", [{ index: 0, grade: "predicted" }]), "verification_claims_incomplete");
      assert.equal(await detail("confirmed", [{ index: 0, grade: "unverified" }, { index: 1, grade: "measured" }]), "verification_downgrade_not_confirmed");
      assert.equal(await detail("confirmed", [{ index: 0, grade: "predicted" }, { index: 1, grade: "simulated" }]), "verification_downgrade_not_confirmed");
      // Upgrading what the performer was modest about is fine.
      assert.equal(await detail("confirmed", [{ index: 0, grade: "simulated" }, { index: 1, grade: "measured" }]), undefined);
    });

    test("a Delivery with no claims can only be confirmed or not confirmed; one verification per Delivery", async () => {
      const { log, delivery } = await fresh({ claims: [] });
      assert.equal((await failure(log.append(verification(verifier, delivery.id, "partly_confirmed"))))?.detail, "verification_no_claims");
      await log.append(verification(verifier, delivery.id, "confirmed"));
      assert.equal((await failure(log.append(verification(verifier, delivery.id, "not_confirmed"))))?.detail, "already_verified");
    });

    test("a verification must be about a real Delivery", async () => {
      const { log, contract } = await fresh();
      assert.equal((await failure(log.append(verification(verifier, contract.id, "confirmed"))))?.detail, "verification_about_unknown");
    });

    test("silence cannot settle a Delivery that was never confirmed, but can once it is", async () => {
      const settle = (about: string) => rec("settlement", bank, {
        contract: "", basis: "silence", escrow_released: { value: 0, unit: "credit" }, bond_returned: { value: 0, unit: "credit" }, bond_slashed: { value: 0, unit: "credit" },
      }, about, null);
      const a = await fresh();
      const s1 = settle(a.delivery.id);
      (s1.body as any).contract = a.contract.id;
      const bad = rec("settlement", bank, s1.body as Record<string, unknown>, a.delivery.id, a.contract.id);
      assert.equal((await failure(a.log.append(bad)))?.detail, "verification_required");

      const b = await fresh();
      await b.log.append(verification(verifier, b.delivery.id, "confirmed", GOOD));
      const ok = rec("settlement", bank, { ...(s1.body as Record<string, unknown>), contract: b.contract.id }, b.delivery.id, b.contract.id);
      assert.equal((await b.log.append(ok)).state, "Settled");
    });

    test("verify() replays a verified job without breaking", async () => {
      const { log, contract, delivery } = await fresh();
      await log.append(verification(verifier, delivery.id, "confirmed", GOOD));
      await log.append(acceptance(delivery.id, delivery.id, contract.id));
      assert.equal((await log.verify()).ok, true);
    });
  });
}
