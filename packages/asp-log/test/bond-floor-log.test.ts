import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { b64urlEncode, cosign, signerFromSeed, type Signer } from "@agent-social/asp-core";
import { randomBytes } from "node:crypto";
import { EventLog, MemoryStore } from "../src/index.ts";
import type { EventLogOptions } from "../src/index.ts";
import { alice, at, bank, codeOf, memory, pgUrl, postgres, rec, registerParties, type Harness } from "./harness.ts";

/** A fresh agent identity, sponsored by alice, self-issued key. */
function freshAgent(name: string): { did: string } & Signer & { publicKey: Uint8Array } {
  const did = `did:web:example.com:agents:${name}`;
  const seed = new Uint8Array(randomBytes(32));
  return { did, ...signerFromSeed(`${did}#key-1`, seed) };
}

type Person = { did: string } & Signer & { publicKey: Uint8Array };

/** A fresh human (a principal or a sponsor of its own), registered in the log. Since S161 a job only counts for standing when its principal is independent of the agent's sponsor, so alice (sponsor of every agent here) cannot be the principal of a job that should count. */
async function freshPerson(log: EventLog, name: string): Promise<Person> {
  const did = `did:web:example.com:users:${name}`;
  const p = { did, ...signerFromSeed(`${did}#key-1`, new Uint8Array(randomBytes(32))) };
  await log.append(rec("passport", p, { did, kind: "human", keys: [{ id: p.kid, type: "Ed25519", public_key: b64urlEncode(p.publicKey) }] }, null, did));
  return p;
}

async function registerAgent(log: EventLog, agent: { did: string } & Signer & { publicKey: Uint8Array }, opts: { fleet?: string; sponsor?: Person } = {}) {
  const sponsor = opts.sponsor ?? alice;
  const body: Record<string, unknown> = {
    did: agent.did, kind: "agent", sponsor: sponsor.did, tier: 1, shape: {},
    keys: [{ id: agent.kid, type: "Ed25519", public_key: b64urlEncode(agent.publicKey) }],
  };
  if (opts.fleet) body.fleet = opts.fleet;
  await log.append(rec("passport", sponsor, body, null, agent.did));
}

const contractBody = (performer: string, price: number, principal: string = alice.did) => ({
  principal, performer, bank: bank.did,
  purpose: "Fix the flaky test", price: { value: price, unit: "credit" as const },
  verification: "deterministic" as const, deadline: "2026-10-03T18:00:00Z",
  basis: { intent: "sha256:" + "0".repeat(64), offer: "sha256:" + "1".repeat(64) },
});

const bondBody = (contract: string, backer: string, bondAmount: number, escrowAmount: number, payer: string = alice.did) => ({
  contract, backer, amount: { value: bondAmount, unit: "credit" as const },
  escrow: { payer, amount: { value: escrowAmount, unit: "credit" as const } },
  slashing_conditions: ["lost_dispute" as const, "floor_breach" as const, "forbidden_means" as const],
});

/** contract -> bond, for one performer/backer, stopping at Bonded (or the bond's own failure). */
async function bondOnly(log: EventLog, performer: { did: string } & Signer, backer: { did: string } & Signer, price: number, bondAmount: number, escrowAmount: number, principal: { did: string } & Signer = alice) {
  const contract = cosign(rec("contract", principal, contractBody(performer.did, price, principal.did), null, performer.did), performer);
  await log.append(contract);
  const bond = rec("bond", backer, bondBody(contract.id, backer.did, bondAmount, escrowAmount, principal.did), contract.id, contract.id);
  const bondResult = await codeOf(log.append(bond));
  return { bondResult, contract, bond };
}

/** contract -> bond -> mandate -> settlement(revoked, basis pro-rata), the shortest path to Settled. */
async function settleWithSlash(log: EventLog, performer: { did: string } & Signer, backer: { did: string } & Signer, price: number, bondAmount: number, bondSlashed: number) {
  const { bondResult, contract, bond } = await bondOnly(log, performer, backer, price, bondAmount, price);
  if (bondResult) return { bondResult };
  const mandate = rec("mandate", alice, {
    contract: contract.id, purpose: "Fix the flaky test", floor: "asp.floor/v1",
    scopes: ["repo.read"], forbidden_means: [],
    spend: { cap: 0, unit: "credit" as const }, irreversible: { policy: "checkpoint" as const },
    subcontract: { allowed: false }, nodes: { max_parallel: 1 },
    learning: { scope: "harness" as const, share_to_commons: false }, self_modification: "principal_approves" as const,
    overlay: null, checkpoints: [], expires: "2026-10-04T00:00:00Z", revocable: true,
  }, bond.id, performer.did);
  await log.append(mandate);
  let settlement = rec("settlement", bank, {
    contract: contract.id, basis: "revoked", pro_rata_permille: 0,
    escrow_released: { value: 0, unit: "credit" }, bond_returned: { value: bondAmount - bondSlashed, unit: "credit" },
    bond_slashed: { value: bondSlashed, unit: "credit" },
  }, mandate.id, contract.id);
  settlement = cosign(settlement, alice);
  const settlementResult = await codeOf(log.append(settlement));
  return { settlementResult };
}

/** contract -> bond -> mandate -> settlement on basis `accepted` (all released, all returned). */
async function settleAccepted(log: EventLog, performer: { did: string } & Signer, backer: { did: string } & Signer, price: number, bondAmount: number, principal: { did: string } & Signer = alice) {
  const { bondResult, contract, bond } = await bondOnly(log, performer, backer, price, bondAmount, price, principal);
  if (bondResult) return { bondResult };
  const mandate = rec("mandate", principal, {
    contract: contract.id, purpose: "Fix the flaky test", floor: "asp.floor/v1",
    scopes: ["repo.read"], forbidden_means: [],
    spend: { cap: 0, unit: "credit" as const }, irreversible: { policy: "checkpoint" as const },
    subcontract: { allowed: false }, nodes: { max_parallel: 1 },
    learning: { scope: "harness" as const, share_to_commons: false }, self_modification: "principal_approves" as const,
    overlay: null, checkpoints: [], expires: "2026-10-04T00:00:00Z", revocable: true,
  }, bond.id, performer.did);
  await log.append(mandate);
  const delivery = rec("delivery", performer, {
    contract: contract.id, result: { summary: "Done", artifacts: [] },
    evidence: { trace: { uri: "asp://local/trace", sha256: "sha256:" + "2".repeat(64) }, forecasts: [] },
  }, mandate.id, contract.id);
  await log.append(delivery);
  const accept = rec("attestation", principal, { kind: "acceptance", about: delivery.id, verdict: "accepted" }, delivery.id, contract.id);
  await log.append(accept);
  let settlement = rec("settlement", bank, {
    contract: contract.id, basis: "accepted", cites: accept.id,
    escrow_released: { value: price, unit: "credit" }, bond_returned: { value: bondAmount, unit: "credit" },
    bond_slashed: { value: 0, unit: "credit" },
  }, accept.id, contract.id);
  settlement = cosign(settlement, principal);
  return { settlementResult: await codeOf(log.append(settlement)) };
}

const v2: EventLogOptions = { bondFloor: "v2" };

for (const h of [memory, postgres] as Harness[]) {
  describe(`bond floor v2 (S143) on ${h.name}`, { skip: h === postgres && !pgUrl && "set ASP_TEST_DATABASE_URL to run" }, () => {
    after(() => h.cleanup());

    test("the default is unchanged: with no option an unknown agent may bond below 400 permille", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      const performer = freshAgent("fl-perf-0"), backer = freshAgent("fl-backer-0");
      await registerAgent(log, performer); await registerAgent(log, backer);
      await log.mint(alice.did, 3000); await log.mint(backer.did, 1000);
      assert.equal((await bondOnly(log, performer, backer, 1000, 100, 1000)).bondResult, undefined);
    });

    test("v2: an unknown agent must bond 400 permille of the price, and a clean accepted job lowers it by 15", async () => {
      const log = new EventLog(await h.make(), v2);
      await registerParties(log);
      const performer = freshAgent("fl-perf-1"), backer = freshAgent("fl-backer-1");
      await registerAgent(log, performer); await registerAgent(log, backer);
      const buyer = await freshPerson(log, "fl-buyer-1");
      await log.mint(alice.did, 6000); await log.mint(buyer.did, 3000); await log.mint(backer.did, 3000);

      const low = await bondOnly(log, performer, backer, 1000, 399, 1000);
      assert.equal(low.bondResult, "GUARD_FAILED", "399 is under 40% of 1000");
      const first = await settleAccepted(log, performer, backer, 1000, 400, buyer);
      assert.equal(first.settlementResult, undefined, String(first.settlementResult));
      assert.deepEqual(await log.reputationOf(backer.did), { tier: 1, slashCount: 0, strikes: 0, acceptedJobs: 1, qualifyingJobs: 1 });

      const performer2 = freshAgent("fl-perf-1b");
      await registerAgent(log, performer2);
      assert.equal((await bondOnly(log, performer2, backer, 1000, 384, 1000)).bondResult, "GUARD_FAILED", "one clean job: the floor is 385");
      assert.equal((await bondOnly(log, performer2, backer, 1000, 385, 1000)).bondResult, undefined);
    });

    test("v2: a slash puts the floor back up and a job settled with a slash is not counted as clean", async () => {
      const log = new EventLog(await h.make(), v2);
      await registerParties(log);
      const performer = freshAgent("fl-perf-2");
      const backer = freshAgent("fl-backer-2");
      await log.append(rec("passport", alice, { did: backer.did, kind: "agent", sponsor: alice.did, tier: 4, shape: {}, keys: [{ id: backer.kid, type: "Ed25519", public_key: b64urlEncode(backer.publicKey) }] }, null, backer.did));
      await registerAgent(log, performer);
      await log.mint(alice.did, 6000); await log.mint(backer.did, 3000);
      await settleWithSlash(log, performer, backer, 1000, 500, 100);
      assert.deepEqual(await log.reputationOf(backer.did), { tier: 3, slashCount: 1, strikes: 0 });
      const performer2 = freshAgent("fl-perf-2b");
      await registerAgent(log, performer2);
      // 400 base + 250 for the slash = 650
      assert.equal((await bondOnly(log, performer2, backer, 1000, 649, 1000)).bondResult, "GUARD_FAILED");
      assert.equal((await bondOnly(log, performer2, backer, 1000, 650, 1000)).bondResult, undefined);
    });

    test("v2: the floor is never below 50 permille, however many clean jobs", async () => {
      const log = new EventLog(await h.make(), v2);
      await registerParties(log);
      const backer = freshAgent("fl-backer-3");
      await registerAgent(log, backer);
      // Twelve clean jobs from four independent principals, three each: within the counterparty cap (credits.md 5.4).
      const buyers = [await freshPerson(log, "fl-buyer-3a"), await freshPerson(log, "fl-buyer-3b"), await freshPerson(log, "fl-buyer-3c"), await freshPerson(log, "fl-buyer-3d")];
      await log.mint(alice.did, 40000); await log.mint(backer.did, 20000);
      for (const b of buyers) await log.mint(b.did, 10000);
      // A sponsor opens at most 10 agent passports a day (RG-11): the twelve performers have three sponsors.
      const sponsors = [alice as unknown as Person, await freshPerson(log, "fl-sponsor-3a"), await freshPerson(log, "fl-sponsor-3b")];
      for (let i = 0; i < 12; i++) {
        const p = freshAgent(`fl-perf-3-${i}`); await registerAgent(log, p, { sponsor: sponsors[i % 3] });
        assert.equal((await settleAccepted(log, p, backer, 1000, 1000, buyers[i % 4])).settlementResult, undefined);
      }
      const p = freshAgent("fl-perf-3z"); await registerAgent(log, p);
      // 12 clean jobs: tenure credit 150 (capped), so 400 - 150 = 250.
      assert.equal((await bondOnly(log, p, backer, 1000, 249, 1000)).bondResult, "GUARD_FAILED");
      assert.equal((await bondOnly(log, p, backer, 1000, 250, 1000)).bondResult, undefined);
    });
  });
}

describe("bond floor v2 cutover (register row T26, S412)", () => {
  test("a bond issued before the cutover keeps the legacy floor and one after it the v2 floor; with no cutover v2 refuses the early bond; verify() replays the log the same way", async () => {
    const setup = async (opts: EventLogOptions) => {
      const log = new EventLog(await memory.make(), opts);
      await registerParties(log);
      const backer = freshAgent(`cut-backer-${Math.random().toString(36).slice(2, 8)}`);
      await registerAgent(log, backer);
      await log.mint(alice.did, 9000); await log.mint(backer.did, 3000);
      return { log, backer };
    };
    const early = await setup({ bondFloor: "v2", bondFloorFrom: "2099-01-01T00:00:00Z" });
    const performer = freshAgent("cut-perf-a"); await registerAgent(early.log, performer);
    assert.equal((await bondOnly(early.log, performer, early.backer, 1000, 100, 1000)).bondResult, undefined, "before the cutover: the legacy floor, an unknown agent may bond 100 on a price of 1000");
    // The same bond with no cutover is refused by v2, which is the replay failure T26 describes.
    const none = await setup({ bondFloor: "v2" });
    const performerB = freshAgent("cut-perf-b"); await registerAgent(none.log, performerB);
    assert.equal((await bondOnly(none.log, performerB, none.backer, 1000, 100, 1000)).bondResult, "GUARD_FAILED");

    // A cutover in the past: the v2 floor applies to every bond issued from then on.
    const cut = await setup({ bondFloor: "v2", bondFloorFrom: "2020-01-01T00:00:00Z" });
    const performerC = freshAgent("cut-perf-c"); await registerAgent(cut.log, performerC);
    assert.equal((await bondOnly(cut.log, performerC, cut.backer, 1000, 399, 1000)).bondResult, "GUARD_FAILED");
    assert.equal((await bondOnly(cut.log, performerC, cut.backer, 1000, 400, 1000)).bondResult, undefined);
    for (const l of [early.log, cut.log]) assert.equal((await l.verify()).ok, true, "the log replays under its own cutover");
    assert.throws(() => new EventLog(new MemoryStore(), { bondFloor: "v2", bondFloorFrom: "not a time" }), /bondFloorFrom must be an ISO time/);
  });

  test("the cutover splits one log in two by the records' own times: the first bonds are judged by legacy, the later ones by v2, and the clock is never read", async () => {
    // The harness stamps each record a minute after the last, so a first run with no cutover tells where in time the third bond falls; the second run puts the cutover just before it.
    const run = async (opts: EventLogOptions) => {
      const base = Date.parse(at());
      const log = new EventLog(await memory.make(), opts);
      await registerParties(log);
      const backer = freshAgent("cut-backer-split"); await registerAgent(log, backer);
      await log.mint(alice.did, 9000); await log.mint(backer.did, 3000);
      const results: (string | undefined)[] = [], times: number[] = [];
      for (let i = 0; i < 5; i++) {
        const p = freshAgent(`cut-split-${i}`); await registerAgent(log, p);
        const r = await bondOnly(log, p, backer, 1000, 100, 1000);
        results.push(r.bondResult); times.push(Date.parse(r.bond.issued_at) - base);
      }
      return { base, results, times };
    };
    const first = await run({});
    assert.deepEqual(first.results, [undefined, undefined, undefined, undefined, undefined], "legacy accepts every one of them");
    const second = await (async () => { const base = Date.parse(at()); return run({ bondFloor: "v2", bondFloorFrom: new Date(base + first.times[2] - 30_000).toISOString() }); })();
    assert.deepEqual(second.results.slice(0, 2), [undefined, undefined], "the bonds before the cutover are under legacy");
    assert.deepEqual(second.results.slice(2), ["GUARD_FAILED", "GUARD_FAILED", "GUARD_FAILED"], "the bonds from the cutover on are under v2 and are below its 400 floor");
  });
});
