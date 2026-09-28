import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { b64urlEncode, cosign, signerFromSeed, type Signer } from "@agent-social/asp-core";
import { randomBytes } from "node:crypto";
import { EventLog } from "../src/index.ts";
import { alice, bank, codeOf, memory, pgUrl, postgres, rec, registerParties, type Harness } from "./harness.ts";

function freshAgent(name: string): { did: string } & Signer & { publicKey: Uint8Array } {
  const did = `did:web:example.com:agents:${name}`;
  const seed = new Uint8Array(randomBytes(32));
  return { did, ...signerFromSeed(`${did}#key-1`, seed) };
}

async function registerAgent(log: EventLog, agent: { did: string } & Signer & { publicKey: Uint8Array }) {
  await log.append(rec("passport", alice, {
    did: agent.did, kind: "agent", sponsor: alice.did, tier: 1, shape: {},
    keys: [{ id: agent.kid, type: "Ed25519", public_key: b64urlEncode(agent.publicKey) }],
  }, null, agent.did));
}

function contractRec(principal: { did: string } & Signer, performer: { did: string } & Signer, price: number, parentContract?: string) {
  const body: Record<string, unknown> = {
    principal: principal.did, performer: performer.did, bank: bank.did,
    purpose: "Fix the flaky test", price: { value: price, unit: "credit" as const },
    verification: "deterministic" as const, deadline: "2026-10-03T18:00:00Z",
    basis: { intent: "sha256:" + "0".repeat(64), offer: "sha256:" + "1".repeat(64) },
  };
  if (parentContract) body.parent_contract = parentContract;
  return cosign(rec("contract", principal, body, null, performer.did), performer);
}

for (const h of [memory, postgres] as Harness[]) {
  describe(`subcontract nesting on ${h.name}`, { skip: h === postgres && !pgUrl && "set ASP_TEST_DATABASE_URL to run" }, () => {
    after(() => h.cleanup());

    test("a parent's own performer can subcontract to a sub-agent, funded from its own balance", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      const leadAgent = freshAgent("lead");
      const subAgent = freshAgent("sub");
      await registerAgent(log, leadAgent);
      await registerAgent(log, subAgent);

      const parent = contractRec(alice, leadAgent, 1000);
      const parentRes = await log.append(parent);
      assert.equal(parentRes.state, "Contracted");

      const child = contractRec(leadAgent, subAgent, 300, parent.id);
      const childRes = await codeOf(log.append(child));
      assert.equal(childRes, undefined);
    });

    test("a subcontract's principal must be the parent's own performer, not an unrelated DID", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      const leadAgent = freshAgent("lead-2");
      const subAgent = freshAgent("sub-2");
      await registerAgent(log, leadAgent);
      await registerAgent(log, subAgent);

      const parent = contractRec(alice, leadAgent, 1000);
      await log.append(parent);

      // alice (the parent's principal, not its performer) tries to claim the subcontract.
      const bogusChild = contractRec(alice, subAgent, 300, parent.id);
      assert.equal(await codeOf(log.append(bogusChild)), "GUARD_FAILED");
    });

    test("a parent_contract that doesn't exist, or isn't actually a Contract, is refused", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      const leadAgent = freshAgent("lead-3");
      const subAgent = freshAgent("sub-3");
      await registerAgent(log, leadAgent);
      await registerAgent(log, subAgent);

      const child = contractRec(leadAgent, subAgent, 300, "sha256:" + "9".repeat(64));
      assert.equal(await codeOf(log.append(child)), "GUARD_FAILED");
    });

    test("subcontracting under an already-Settled parent is refused", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      const leadAgent = freshAgent("lead-4");
      const subAgent = freshAgent("sub-4");
      await registerAgent(log, leadAgent);
      await registerAgent(log, subAgent);

      const parent = contractRec(alice, leadAgent, 0);
      await log.append(parent);
      const bond = rec("bond", leadAgent, {
        contract: parent.id, backer: leadAgent.did, amount: { value: 0, unit: "credit" as const },
        escrow: { payer: alice.did, amount: { value: 0, unit: "credit" as const } },
        slashing_conditions: ["lost_dispute" as const],
      }, parent.id, parent.id);
      await log.append(bond);
      let settlement = rec("settlement", bank, {
        contract: parent.id, basis: "revoked", pro_rata_permille: 0,
        escrow_released: { value: 0, unit: "credit" }, bond_returned: { value: 0, unit: "credit" }, bond_slashed: { value: 0, unit: "credit" },
      }, bond.id, parent.id);
      settlement = cosign(settlement, alice);
      const settleRes = await log.append(settlement);
      assert.equal(settleRes.state, "Settled");

      const child = contractRec(leadAgent, subAgent, 300, parent.id);
      assert.equal(await codeOf(log.append(child)), "GUARD_FAILED");
    });

    test("verify() replays a subcontract chain without breaking", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      const leadAgent = freshAgent("lead-5");
      const subAgent = freshAgent("sub-5");
      await registerAgent(log, leadAgent);
      await registerAgent(log, subAgent);
      const parent = contractRec(alice, leadAgent, 1000);
      await log.append(parent);
      const child = contractRec(leadAgent, subAgent, 300, parent.id);
      await log.append(child);

      const report = await log.verify();
      assert.equal(report.ok, true, report.error && JSON.stringify(report.error));
    });
  });
}
