import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { cosign } from "@agent-social/asp-core";
import { EventLog } from "../src/index.ts";
import { alice, bank, coder, failure, memory, pgUrl, postgres, rec, registerParties, type Harness } from "./harness.ts";

const contractBody = () => ({
  principal: alice.did, performer: coder.did, bank: bank.did, purpose: "Ship the fix",
  price: { value: 0, unit: "credit" as const }, verification: "principal" as const, deadline: "2026-10-30T18:00:00Z",
  basis: { intent: "sha256:" + "0".repeat(64), offer: "sha256:" + "1".repeat(64) },
});
const mandateBody = (contract: string, scopes: string[], irreversible: Record<string, unknown>) => ({
  contract, purpose: "Ship the fix", floor: "asp.floor/v1", scopes, forbidden_means: [],
  spend: { cap: 0, unit: "credit" as const }, irreversible, subcontract: { allowed: false },
  nodes: { max_parallel: 1 }, learning: { scope: "harness" as const, share_to_commons: false }, self_modification: "principal_approves" as const,
  overlay: null, checkpoints: ["before_irreversible"], expires: "2026-10-30T00:00:00Z", revocable: true,
});

async function bonded(log: EventLog) {
  const contract = cosign(rec("contract", alice, contractBody(), null, coder.did), coder);
  await log.append(contract);
  const bond = rec("bond", coder, {
    contract: contract.id, backer: coder.did, amount: { value: 0, unit: "credit" as const },
    escrow: { payer: alice.did, amount: { value: 0, unit: "credit" as const } }, slashing_conditions: ["lost_dispute" as const],
  }, contract.id, contract.id);
  await log.append(bond);
  return { contract, bond };
}

for (const h of [memory, postgres] as Harness[]) {
  describe(`approval gates on ${h.name}`, { skip: h === postgres && !pgUrl && "set ASP_TEST_DATABASE_URL to run" }, () => {
    after(() => h.cleanup());
    const fresh = async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      return { log, ...(await bonded(log)) };
    };

    test("a Mandate may gate only scopes it grants", async () => {
      const { log, contract, bond } = await fresh();
      const stray = rec("mandate", alice, mandateBody(contract.id, ["repo.read"], { policy: "checkpoint", scopes: ["repo.push"] }), bond.id, coder.did);
      assert.equal((await failure(log.append(stray)))?.detail, "gate_not_granted");
      const ok = rec("mandate", alice, mandateBody(contract.id, ["repo.read", "repo.push"], { policy: "checkpoint", scopes: ["repo.push"] }), bond.id, coder.did);
      assert.equal((await log.append(ok)).state, "Running");
    });

    test("the gate round trip: a Checkpoint pauses the job, the principal's signed resolution resumes it, and actions are still reported", async () => {
      const { log, contract, bond } = await fresh();
      const mandate = rec("mandate", alice, mandateBody(contract.id, ["repo.read", "repo.push"], { policy: "checkpoint", scopes: ["repo.push"] }), bond.id, coder.did);
      await log.append(mandate);
      const checkpoint = rec("checkpoint", coder, {
        contract: contract.id, kind: "before_irreversible", question: "May I run Bash (repo.push)?", proposed_action: "git push origin main",
      }, mandate.id, contract.id);
      assert.equal((await log.append(checkpoint)).state, "Checkpoint");

      const during = rec("action", coder, { contract: contract.id, scopes_used: ["repo.read"] }, null, contract.id);
      assert.equal((await failure(log.append(during))), undefined, "reports are accepted while the job waits at a Checkpoint");

      const byPerformer = rec("attestation", coder, { kind: "checkpoint_resolution", about: checkpoint.id, verdict: "approved" }, checkpoint.id, contract.id);
      assert.ok(await failure(log.append(byPerformer)), "the performer cannot approve its own gate");
      const approved = rec("attestation", alice, { kind: "checkpoint_resolution", about: checkpoint.id, verdict: "approved" }, checkpoint.id, contract.id);
      assert.equal((await log.append(approved)).state, "Running");
    });

    test("a refusal is a corrected resolution with the reason, and also resumes the job", async () => {
      const { log, contract, bond } = await fresh();
      const mandate = rec("mandate", alice, mandateBody(contract.id, ["repo.push"], { policy: "checkpoint", scopes: ["repo.push"] }), bond.id, coder.did);
      await log.append(mandate);
      const checkpoint = rec("checkpoint", coder, { contract: contract.id, kind: "before_irreversible", question: "Push?" }, mandate.id, contract.id);
      await log.append(checkpoint);
      const noCorrection = rec("attestation", alice, { kind: "checkpoint_resolution", about: checkpoint.id, verdict: "corrected" }, checkpoint.id, contract.id);
      assert.ok(await failure(log.append(noCorrection)), "a correction needs its text");
      const refused = rec("attestation", alice, { kind: "checkpoint_resolution", about: checkpoint.id, verdict: "corrected", correction: "do not push; open a PR instead" }, checkpoint.id, contract.id);
      assert.equal((await log.append(refused)).state, "Running");
    });
  });
}
