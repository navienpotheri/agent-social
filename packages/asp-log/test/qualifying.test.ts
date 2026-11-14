// Qualifying jobs (spec-delta S161, credits.md 5.4, register row DK69): a job settled `accepted` always settles, but counts toward the
// bond floor and the starter grant's rest only if the principal is independent, the price is not trivial, and one principal's share is within the cap.
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { b64urlEncode, cosign, signerFromSeed, type Signer } from "@agent-social/asp-core";
import { randomBytes } from "node:crypto";
import { EventLog } from "../src/index.ts";
import { CAP_WINDOW_JOBS, QUALIFYING_MIN_PRICE, admitEligibleJob, counterpartyCap, independent, type RecentJob } from "../src/qualifying.ts";
import { releaseStarter } from "../../asp-package/src/account.ts";
import { alice, bank, codeOf, memory, pgUrl, postgres, rec, registerParties, type Harness } from "./harness.ts";

type Party = { did: string } & Signer & { publicKey: Uint8Array };
const newParty = (path: string): Party => { const did = `did:web:example.com:${path}`; return { did, ...signerFromSeed(`${did}#key-1`, new Uint8Array(randomBytes(32))) }; };
const keysOf = (p: Party) => [{ id: p.kid, type: "Ed25519", public_key: b64urlEncode(p.publicKey) }];

async function person(log: EventLog, name: string): Promise<Party> {
  const p = newParty(`users:${name}`);
  await log.append(rec("passport", p, { did: p.did, kind: "human", keys: keysOf(p) }, null, p.did));
  return p;
}
async function agent(log: EventLog, name: string, sponsor: Party | typeof alice): Promise<Party> {
  const a = newParty(`agents:${name}`);
  await log.append(rec("passport", sponsor, { did: a.did, kind: "agent", sponsor: sponsor.did, tier: 1, shape: {}, keys: keysOf(a) }, null, a.did));
  return a;
}

/** One job: principal -> performer (also the backer), accepted and paid in full. Returns the failure code, if any. */
async function acceptedJob(log: EventLog, principal: Party | typeof alice, performer: Party, price: number, bondAmount: number): Promise<string | undefined> {
  const contract = cosign(rec("contract", principal, {
    principal: principal.did, performer: performer.did, bank: bank.did, purpose: "Fix the flaky test", price: { value: price, unit: "credit" },
    verification: "deterministic", deadline: "2026-10-03T18:00:00Z", basis: { intent: "sha256:" + "0".repeat(64), offer: "sha256:" + "1".repeat(64) },
  }, null, performer.did), performer);
  await log.append(contract);
  const bond = rec("bond", performer, {
    contract: contract.id, backer: performer.did, amount: { value: bondAmount, unit: "credit" },
    escrow: { payer: principal.did, amount: { value: price, unit: "credit" } }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"],
  }, contract.id, contract.id);
  const bonded = await codeOf(log.append(bond));
  if (bonded) return bonded;
  const mandate = rec("mandate", principal, {
    contract: contract.id, purpose: "Fix the flaky test", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [],
    spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 },
    learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2026-10-04T00:00:00Z", revocable: true,
  }, bond.id, performer.did);
  await log.append(mandate);
  const delivery = rec("delivery", performer, {
    contract: contract.id, result: { summary: "Done", artifacts: [] }, evidence: { trace: { uri: "asp://local/trace", sha256: "sha256:" + "2".repeat(64) }, forecasts: [] },
  }, mandate.id, contract.id);
  await log.append(delivery);
  const accept = rec("attestation", principal, { kind: "acceptance", about: delivery.id, verdict: "accepted" }, delivery.id, contract.id);
  await log.append(accept);
  const settlement = cosign(rec("settlement", bank, {
    contract: contract.id, basis: "accepted", cites: accept.id, escrow_released: { value: price, unit: "credit" },
    bond_returned: { value: bondAmount, unit: "credit" }, bond_slashed: { value: 0, unit: "credit" },
  }, accept.id, contract.id), principal);
  return codeOf(log.append(settlement));
}

/** What the starter release reads, with just enough of its options to run it. */
async function starterRest(log: EventLog, did: string) {
  let left = 10_000;
  const o = {
    handle: { log, mint: (d: string, n: number) => log.mint(d, n) },
    starter: { get left() { return left; }, take: (n: number) => { if (n > left) return false; left -= n; return true; }, give: (n: number) => { left += n; } },
    updateTenant: () => {}, now: () => Date.parse("2026-10-06T00:00:00Z"),
  };
  return releaseStarter(o as never, { name: "t", starter: { at: "x", amount: 100, held: 400, dids: [did] } } as never);
}

describe("counterparty cap and independence (pure rules, credits.md 5.4)", () => {
  test("the cap is max(2, ceil(n / 2))", () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6, 20].map(counterpartyCap), [2, 2, 2, 2, 3, 3, 10]);
  });

  test("a job from one principal counts exactly up to the cap and not one over, at n = 2, 3, 4 and 20", () => {
    const at = (i: number) => new Date(Date.parse("2026-10-01T00:00:00Z") + i * 60_000).toISOString();
    const run = (principals: string[]) => { let w: RecentJob[] = []; return principals.map((p, i) => { const r = admitEligibleJob(w, p, at(i)); w = r.window; return r.counts; }); };
    assert.deepEqual(run(["P", "P"]), [true, true], "n = 2: both within a cap of 2");
    assert.deepEqual(run(["P", "P", "P"]), [true, true, false], "n = 3: the third from one principal is one over");
    assert.deepEqual(run(["P", "Q", "P", "P"]), [true, true, true, false], "n = 4: P's third is over, a cap of 2");
    assert.deepEqual(run(["P", "P", "Q", "Q"]), [true, true, true, true], "n = 4: two each, exactly at the cap");
    assert.equal(run([...Array(10).fill("Q"), ...Array(10).fill("P")])[19], true, "n = 20, P has 10: exactly at the cap of 10");
    assert.equal(run([...Array(9).fill("Q"), ...Array(11).fill("P")])[19], false, "n = 20, P has 11: one over");
  });

  test("jobs older than 90 days and beyond the last 20 leave the window", () => {
    let w: RecentJob[] = [{ p: "P", at: "2026-01-01T00:00:00Z" }, { p: "P", at: "2026-01-02T00:00:00Z" }];
    assert.equal(admitEligibleJob(w, "P", "2026-10-01T00:00:00Z").counts, true, "the two old jobs no longer weigh");
    w = Array.from({ length: 30 }, (_, i) => ({ p: "Q", at: `2026-09-${String(1 + (i % 28)).padStart(2, "0")}T00:00:00Z` }));
    assert.equal(admitEligibleJob(w, "Q", "2026-09-29T00:00:00Z").window.length, CAP_WINDOW_JOBS);
  });

  test("independence: same DID, one sponsor, one sponsoring the other, one fleet are all refused", () => {
    const f = (did: string, sponsor = did, fleet: string | null = null) => ({ did, sponsor, fleet });
    assert.equal(independent(f("p"), f("q")), true);
    assert.equal(independent(f("p"), f("p")), false);
    assert.equal(independent(f("a1", "s"), f("a2", "s")), false, "agents of one sponsor");
    assert.equal(independent(f("s"), f("a", "s")), false, "the principal is the performer's sponsor");
    assert.equal(independent(f("a", "s"), f("s")), false, "the performer is the principal's sponsor");
    assert.equal(independent(f("a1", "s1", "fleet"), f("a2", "s2", "fleet")), false, "one fleet");
  });
});

for (const h of [memory, postgres] as Harness[]) {
  describe(`qualifying jobs in the log on ${h.name}`, { skip: h === postgres && !pgUrl && "set ASP_TEST_DATABASE_URL to run" }, () => {
    after(() => h.cleanup());
    const v2 = { bondFloor: "v2" as const };

    test("a pair of agents of one sponsor exchanging 30 accepted jobs neither lowers the bond floor nor releases the starter rest", async () => {
      const log = new EventLog(await h.make(), v2);
      await registerParties(log);
      const a = await agent(log, "pair-a", alice), b = await agent(log, "pair-b", alice);
      await log.mint(a.did, 50_000); await log.mint(b.did, 50_000); await log.mint(alice.did, 5000);
      for (let i = 0; i < 30; i++) assert.equal(await acceptedJob(log, i % 2 ? a : b, i % 2 ? b : a, 100, 400), undefined);
      const [ra, rb] = [await log.reputationOf(a.did), await log.reputationOf(b.did)];
      assert.equal(ra?.acceptedJobs, 15); assert.equal(rb?.acceptedJobs, 15); // they settled and were paid, as before
      assert.equal(ra?.qualifyingJobs, undefined); assert.equal(rb?.qualifyingJobs, undefined);
      // The floor is still the full 400 permille of the price: a bond of 399 on a 1000 job is refused.
      assert.equal(await acceptedJob(log, alice, b, 1000, 399), "GUARD_FAILED");
      const rest = await starterRest(log, a.did);
      assert.ok("reason" in rest, "the rest of the starter grant stays held");
    });

    test("the same 30 jobs from independent principals lower the floor and release the starter rest", async () => {
      const log = new EventLog(await h.make(), v2);
      await registerParties(log);
      const performer = await agent(log, "ind-perf", alice);
      const buyers: Party[] = [];
      for (let i = 0; i < 5; i++) { const p = await person(log, `ind-buyer-${i}`); buyers.push(p); await log.mint(p.did, 50_000); }
      await log.mint(performer.did, 50_000);
      for (let i = 0; i < 30; i++) assert.equal(await acceptedJob(log, buyers[i % 5], performer, 100, 400), undefined);
      const rep = await log.reputationOf(performer.did);
      assert.equal(rep?.acceptedJobs, 30); assert.equal(rep?.qualifyingJobs, 30);
      // 30 clean jobs: the tenure credit is capped at 150, so 400 - 150 = 250 permille (249 refused).
      assert.equal(await acceptedJob(log, buyers[0], performer, 1000, 249), "GUARD_FAILED");
      const rest = await starterRest(log, performer.did);
      assert.ok("released" in rest, JSON.stringify(rest));
    });

    test("the counterparty cap, exactly at the limit and one over", async () => {
      const log = new EventLog(await h.make(), v2);
      await registerParties(log);
      const performer = await agent(log, "cap-perf", alice);
      const p = await person(log, "cap-p"), q = await person(log, "cap-q");
      for (const x of [p, q, performer]) await log.mint(x.did, 50_000);
      const qualifying = async () => (await log.reputationOf(performer.did))?.qualifyingJobs ?? 0;
      assert.equal(await acceptedJob(log, p, performer, 100, 400), undefined);
      assert.equal(await acceptedJob(log, p, performer, 100, 400), undefined);
      assert.equal(await qualifying(), 2, "two from one principal, n = 2: at the cap");
      assert.equal(await acceptedJob(log, p, performer, 100, 400), undefined);
      assert.equal(await qualifying(), 2, "a third from the same principal settles but does not count");
      assert.equal((await log.reputationOf(performer.did))?.acceptedJobs, 3);
      assert.equal(await acceptedJob(log, q, performer, 100, 400), undefined);
      assert.equal(await qualifying(), 3, "a second principal's job counts");
    });

    test("price 19 never counts, price 20 does (a job with no class is treated as routine)", async () => {
      const log = new EventLog(await h.make(), v2);
      await registerParties(log);
      const performer = await agent(log, "price-perf", alice);
      const p = await person(log, "price-p");
      await log.mint(p.did, 50_000); await log.mint(performer.did, 50_000);
      assert.equal(QUALIFYING_MIN_PRICE, 20);
      assert.equal(await acceptedJob(log, p, performer, 19, 8), undefined);
      assert.equal((await log.reputationOf(performer.did))?.qualifyingJobs, undefined);
      assert.equal(await acceptedJob(log, p, performer, 20, 8), undefined);
      assert.equal((await log.reputationOf(performer.did))?.qualifyingJobs, 1);
    });

    test("a principal who sponsors the performer does not count; an agent of another sponsor as principal does", async () => {
      const log = new EventLog(await h.make(), v2);
      await registerParties(log);
      const boss = await person(log, "own-boss");
      const worker = await agent(log, "own-worker", boss);
      const other = await agent(log, "own-other", alice);
      await log.mint(boss.did, 50_000); await log.mint(worker.did, 50_000); await log.mint(other.did, 50_000);
      assert.equal(await acceptedJob(log, boss, worker, 100, 400), undefined, "principal sponsors the performer");
      assert.equal((await log.reputationOf(worker.did))?.qualifyingJobs, undefined);
      assert.equal(await acceptedJob(log, worker, other, 100, 400), undefined, "different sponsors");
      assert.equal((await log.reputationOf(other.did))?.qualifyingJobs, 1);
    });
  });
}
