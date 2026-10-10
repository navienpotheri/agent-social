import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { cosign, createRecord } from "@agent-social/asp-core";
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

    test("blocked attempts are a signed strike, not a violation: they may name scopes outside the Mandate", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      const contract = await running(log, ["repo.read"]);
      const withStrikes = rec("action", coder, {
        contract: contract.id, scopes_used: ["repo.read"], blocked_attempts: [{ scope: "shell.exec", count: 2 }],
      }, null, contract.id);
      assert.equal(await codeOf(log.append(withStrikes)), undefined);
      const onlyStrikes = rec("action", coder, {
        contract: contract.id, scopes_used: [], blocked_attempts: [{ scope: "repo.push", count: 1 }], summary: "only blocked attempts",
      }, null, contract.id);
      assert.equal(await codeOf(log.append(onlyStrikes)), undefined);
      // The same out-of-scope scope in scopes_used (it executed) is still refused.
      const executed = rec("action", coder, { contract: contract.id, scopes_used: ["shell.exec"], blocked_attempts: [] }, null, contract.id);
      assert.equal(await codeOf(log.append(executed)), "GUARD_FAILED");
    });

    test("strikes count on the performer and nudge its next Bond's risk floor, capped, with no demotion", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      const contract = await running(log, ["repo.read"]);
      assert.deepEqual(await log.reputationOf(coder.did), { tier: 1, slashCount: 0, strikes: 0 });
      await log.append(rec("action", coder, {
        contract: contract.id, scopes_used: [], blocked_attempts: [{ scope: "shell.exec", count: 3 }, { scope: "repo.push", count: 2 }],
      }, null, contract.id));
      assert.deepEqual(await log.reputationOf(coder.did), { tier: 1, slashCount: 0, strikes: 5 });

      await log.mint(alice.did, 2000);
      await log.mint(coder.did, 2000);
      const DAY = 24 * 60 * 60 * 1000;
      const stamp = (days: number) => new Date(Date.parse("2026-10-05T12:00:00Z") + days * DAY).toISOString().replace(".000Z", "Z");
      const make = (type: "contract" | "bond", by: typeof alice, body: Record<string, unknown>, prev: string | null, subject: string, days: number) =>
        days ? createRecord({ type, issuer: by.did, subject, body, prev, issued_at: stamp(days) }, by) : rec(type, by, body, prev, subject);
      const bondWith = async (amount: number, days = 0) => {
        const c = cosign(make("contract", alice, { ...contractBody(), price: { value: 1000, unit: "credit" as const } }, null, coder.did, days), coder);
        await log.append(c);
        return codeOf(log.append(make("bond", coder, {
          contract: c.id, backer: coder.did, amount: { value: amount, unit: "credit" as const },
          escrow: { payer: alice.did, amount: { value: 1000, unit: "credit" as const } }, slashing_conditions: ["lost_dispute" as const],
        }, c.id, c.id, days)));
      };
      assert.equal(await bondWith(49), "GUARD_FAILED", "5 strikes x 10 permille = 50 of 1000");
      assert.equal(await bondWith(50), undefined);

      await log.append(rec("action", coder, { contract: contract.id, scopes_used: [], blocked_attempts: [{ scope: "shell.exec", count: 100 }] }, null, contract.id));
      assert.equal(await bondWith(199), "GUARD_FAILED", "capped at 200 permille");
      assert.equal(await bondWith(200), undefined);

      await log.mint(alice.did, 1000);
      // Strikes decay: still counted 29 days later, gone after 30.
      assert.equal(await bondWith(199, 29), "GUARD_FAILED");
      assert.equal(await bondWith(0, 40), undefined, "40 days on, the strikes no longer weigh");
    });

    test("a tier 1 agent's Mandate may not exceed 100 credits or 4 parallel nodes (tier_limit_exceeded)", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log); // coder is tier 1
      const contract = cosign(rec("contract", alice, contractBody(), null, coder.did), coder);
      await log.append(contract);
      const bond = rec("bond", coder, {
        contract: contract.id, backer: coder.did, amount: { value: 0, unit: "credit" as const },
        escrow: { payer: alice.did, amount: { value: 0, unit: "credit" as const } }, slashing_conditions: ["lost_dispute" as const],
      }, contract.id, contract.id);
      await log.append(bond);
      const mandateWith = (spend: Record<string, unknown>, parallel = 4) => rec("mandate", alice, {
        contract: contract.id, purpose: "Fix the flaky test", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [],
        spend: { unit: "credit" as const, ...spend }, irreversible: { policy: "checkpoint" as const },
        subcontract: { allowed: false }, nodes: { max_parallel: parallel },
        learning: { scope: "harness" as const, share_to_commons: false }, self_modification: "principal_approves" as const,
        overlay: null, checkpoints: [], expires: "2026-10-04T00:00:00Z", revocable: true,
      }, bond.id, coder.did);
      await assert.rejects(log.append(mandateWith({ cap: 100 }, 5)), /max_parallel may not exceed 4/);
      await assert.rejects(log.append(mandateWith({ cap: 101 })), /may not exceed 100 credits/);
      await assert.rejects(log.append(mandateWith({ cap: 100, per_action_max: 101 })), /may not exceed 100 credits/);
      assert.equal((await log.append(mandateWith({ cap: 100, per_action_max: 100 }))).state, "Running");
    });

    test("a tier 1 agent's Mandate may grant a network scope only if it names the hosts (network_hosts_required)", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log); // coder is tier 1
      const contract = cosign(rec("contract", alice, contractBody(), null, coder.did), coder);
      await log.append(contract);
      const bond = rec("bond", coder, {
        contract: contract.id, backer: coder.did, amount: { value: 0, unit: "credit" as const },
        escrow: { payer: alice.did, amount: { value: 0, unit: "credit" as const } }, slashing_conditions: ["lost_dispute" as const],
      }, contract.id, contract.id);
      await log.append(bond);
      const mandateWith = (scopes: string[], network?: { hosts: string[] }) => rec("mandate", alice, {
        contract: contract.id, purpose: "Fix the flaky test", floor: "asp.floor/v1", scopes, ...(network ? { network } : {}), forbidden_means: [],
        spend: { unit: "credit" as const, cap: 10 }, irreversible: { policy: "checkpoint" as const },
        subcontract: { allowed: false }, nodes: { max_parallel: 1 },
        learning: { scope: "harness" as const, share_to_commons: false }, self_modification: "principal_approves" as const,
        overlay: null, checkpoints: [], expires: "2026-10-04T00:00:00Z", revocable: true,
      }, bond.id, coder.did);
      await assert.rejects(log.append(mandateWith(["repo.read", "web.read"])), /must name the hosts/);
      await assert.rejects(log.append(mandateWith(["shell.network"])), /must name the hosts/);
      assert.equal((await log.append(mandateWith(["repo.read", "web.read"], { hosts: ["docs.python.org", "*.github.com"] }))).state, "Running");
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

    test("a late report: the performer may report its last stretch of activity after the job is settled, within a short window, and the rules still hold (S80)", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      const contract = await running(log, ["repo.read"]);
      const mandateId = (await log.chain(contract.id)).at(-1)!.id;
      const settlement = cosign(rec("settlement", bank, {
        contract: contract.id, basis: "revoked", escrow_released: { value: 0, unit: "credit" }, bond_returned: { value: 0, unit: "credit" },
        bond_slashed: { value: 0, unit: "credit" }, pro_rata_permille: 0,
      }, mandateId, contract.id), alice);
      assert.equal((await log.append(settlement)).state, "Settled");
      const settledAt = Date.parse(settlement.issued_at);
      const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");
      const action = (issuedAt: number, body: Record<string, unknown>, by = coder) => createRecord({
        type: "action", issuer: by.did, subject: contract.id, prev: null, issued_at: iso(issuedAt), body: { contract: contract.id, ...body },
      }, by);
      const late = (activityEnded: number) => ({ scopes_used: ["repo.read"], late: { activity_ended: iso(activityEnded) } });

      // An ordinary report on a settled job is still refused, and so is a late one on a job that is still running.
      assert.equal(await codeOf(log.append(action(settledAt + 1000, { scopes_used: ["repo.read"] }))), "GUARD_FAILED");
      const running2 = await running(log, ["repo.read"]);
      const lateWhileRunning = createRecord({ type: "action", issuer: coder.did, subject: running2.id, prev: null, issued_at: iso(Date.parse(running2.issued_at) + 1000), body: { contract: running2.id, scopes_used: [], late: { activity_ended: iso(Date.parse(running2.issued_at)) } } }, coder);
      assert.equal(await codeOf(log.append(lateWhileRunning)), "GUARD_FAILED");

      // A late report: activity up to the settlement and a little after it (the performer cannot know at once), within ten minutes.
      assert.equal(await codeOf(log.append(action(settledAt + 60_000, late(settledAt - 5_000)))), undefined);
      assert.equal(await codeOf(log.append(action(settledAt + 61_000, late(settledAt + 20_000)))), undefined, "within the thirty seconds of slack");
      // Not activity from after the end, not after the window, not another party's, not a scope the Mandate never granted.
      assert.equal(await codeOf(log.append(action(settledAt + 62_000, late(settledAt + 31_000)))), "GUARD_FAILED");
      assert.equal(await codeOf(log.append(action(settledAt + 11 * 60_000, late(settledAt - 1_000)))), "GUARD_FAILED");
      assert.equal(await codeOf(log.append(action(settledAt + 63_000, late(settledAt - 1_000), alice))), "WRONG_ISSUER");
      assert.equal(await codeOf(log.append(action(settledAt + 64_000, { scopes_used: ["shell.exec"], late: { activity_ended: iso(settledAt) } }))), "GUARD_FAILED");

      // Its blocked attempts are strikes like any other's, and the log still verifies.
      const before = (await log.reputationOf(coder.did))!.strikes;
      assert.equal(await codeOf(log.append(action(settledAt + 65_000, { scopes_used: [], blocked_attempts: [{ scope: "shell.exec", count: 2 }], late: { activity_ended: iso(settledAt) } }))), undefined);
      assert.equal((await log.reputationOf(coder.did))!.strikes, before + 2);
      const report = await log.verify();
      assert.equal(report.ok, true, report.error && JSON.stringify(report.error));
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
