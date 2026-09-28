import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { cosign } from "@agent-social/asp-core";
import { EventLog } from "../src/index.ts";
import { alice, bank, codeOf, coder, memory, pgUrl, postgres, rec, registerParties, type Harness } from "./harness.ts";

const contractBody = () => ({
  principal: alice.did, performer: coder.did, bank: bank.did,
  purpose: "Fix the flaky test", price: { value: 0, unit: "credit" as const },
  verification: "deterministic" as const, deadline: "2026-10-03T18:00:00Z",
  basis: { intent: "sha256:" + "0".repeat(64), offer: "sha256:" + "1".repeat(64) },
});

/** contract -> bond -> mandate(scopes), reaching Running, ready for an Action report. */
async function running(log: EventLog, scopes: string[]) {
  const contract = cosign(rec("contract", alice, contractBody(), null, coder.did), coder);
  await log.append(contract);
  const bond = rec("bond", coder, {
    contract: contract.id, backer: coder.did, amount: { value: 0, unit: "credit" as const },
    escrow: { payer: alice.did, amount: { value: 0, unit: "credit" as const } },
    slashing_conditions: ["lost_dispute" as const],
  }, contract.id, contract.id);
  await log.append(bond);
  const mandate = rec("mandate", alice, {
    contract: contract.id, purpose: "Fix the flaky test", floor: "asp.floor/v1",
    scopes, forbidden_means: [],
    spend: { cap: 0, unit: "credit" as const }, irreversible: { policy: "checkpoint" as const },
    subcontract: { allowed: false }, nodes: { max_parallel: 1 },
    learning: { scope: "harness" as const, share_to_commons: false }, self_modification: "principal_approves" as const,
    overlay: null, checkpoints: [], expires: "2026-10-04T00:00:00Z", revocable: true,
  }, bond.id, coder.did);
  const mandateRes = await log.append(mandate);
  assert.equal(mandateRes.state, "Running");
  return contract;
}

function actionRec(contract: string, scopesUsed: string[], summary = "tool calls this run") {
  return rec("action", coder, { contract, scopes_used: scopesUsed, summary }, null, contract);
}

for (const h of [memory, postgres] as Harness[]) {
  describe(`compliance bridge (action) on ${h.name}`, { skip: h === postgres && !pgUrl && "set ASP_TEST_DATABASE_URL to run" }, () => {
    after(() => h.cleanup());

    test("an action report within the Mandate's granted scopes succeeds", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      const contract = await running(log, ["repo.read", "repo.write"]);
      const result = await codeOf(log.append(actionRec(contract.id, ["repo.read"])));
      assert.equal(result, undefined);
    });

    test("an action report using a scope the Mandate never granted is refused", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      const contract = await running(log, ["repo.read"]);
      const result = await codeOf(log.append(actionRec(contract.id, ["repo.read", "shell.exec"])));
      assert.equal(result, "GUARD_FAILED");
    });

    test("only the contract's own performer may report an action for it", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      const contract = await running(log, ["repo.read"]);
      const bogus = rec("action", alice, { contract: contract.id, scopes_used: ["repo.read"] }, null, contract.id);
      assert.equal(await codeOf(log.append(bogus)), "WRONG_ISSUER");
    });

    test("an action report against an unknown contract, or one not yet Running, is refused", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      assert.equal(await codeOf(log.append(actionRec("sha256:" + "9".repeat(64), ["repo.read"]))), "GUARD_FAILED");

      const contract = cosign(rec("contract", alice, contractBody(), null, coder.did), coder);
      await log.append(contract); // Contracted, not yet Running
      assert.equal(await codeOf(log.append(actionRec(contract.id, ["repo.read"]))), "GUARD_FAILED");
    });

    test("verify() replays action reports (both accepted and would-be-rejected) without breaking", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      const contract = await running(log, ["repo.read", "repo.write"]);
      await log.append(actionRec(contract.id, ["repo.read"]));
      await log.append(actionRec(contract.id, ["repo.write"], "second batch"));

      const report = await log.verify();
      assert.equal(report.ok, true, report.error && JSON.stringify(report.error));
      assert.deepEqual(await log.mandateOf(contract.id), { contract: contract.id, scopes: ["repo.read", "repo.write"] });
    });
  });
}
