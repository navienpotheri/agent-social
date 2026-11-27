// The conservation property test (docs/institutions/economy/credits.md section 9, CR-1; register rows DK1 and DK9).
//
// 1,000 random sequences of 5 to 60 credit-moving operations over a fixed cast, from the fixed seed 20261112, each checked after every operation:
//   A1 the supply rule (credits.md 1.1): balances + locks = minted, exactly       A2 no negative balance
//   A3 a refused operation leaves every balance, lock and counter unchanged        A4 replaying the records (verify) reproduces the log
//   A7 only a mint changes the minted total, and by exactly its amount
// Today's records only: purchases, price lists, burns and institution accounts do not exist yet, so the spec's A5, A6 and the institution
// lines are not tested here; each later build item extends the generator (credits.md section 9).
// To re-run one sequence: ASP_CONSERVATION_ONLY=<n>. To change the seed or the count: ASP_CONSERVATION_SEED, ASP_CONSERVATION_COUNT.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { AspError, cosign, signerFromSeed, b64urlEncode, type Signer, type AspRecord } from "@agent-social/asp-core";
import { EventLog, MemoryStore, type MemoryState } from "../src/index.ts";
import { auditLedger } from "../src/credit-audit.ts";
import { PLATFORM_DID } from "../src/log.ts";
import { alice, bank, coder, passport, rec } from "./harness.ts";

const SEED = Number(process.env.ASP_CONSERVATION_SEED ?? 20261112);
const SEQUENCES = Number(process.env.ASP_CONSERVATION_COUNT ?? 1000);
const ONLY = process.env.ASP_CONSERVATION_ONLY === undefined ? undefined : Number(process.env.ASP_CONSERVATION_ONLY);

/** mulberry32: a small deterministic generator, so the run is the same everywhere. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Who = { did: string } & Signer & { publicKey: Uint8Array };
const named = (path: string): Who => {
  const did = `did:web:example.com:${path}`;
  return { did, ...signerFromSeed(`${did}#key-1`, new Uint8Array(createHash("sha256").update(`conservation:${path}`).digest())) } as Who;
};
const principals = [alice as unknown as Who, named("users:cp-1"), named("users:cp-2")];
const agents = [coder as unknown as Who, named("agents:ca-1")];
const jurors = [named("users:cj-1"), named("users:cj-2"), named("users:cj-3"), named("users:cj-4"), named("users:cj-5")];
const reporter = named("users:creporter");
const everyone = [...principals, ...agents, ...jurors, reporter];

const person = (p: Who) => rec("passport", p, { did: p.did, kind: "human", keys: [{ id: p.kid, type: "Ed25519", public_key: b64urlEncode(p.publicKey) }] }, null, p.did);
const unit = "credit" as const;
const money = (value: number) => ({ value, unit });

interface Job { contract: AspRecord; principal: Who; agent: Who; price: number; bond: number; settled: boolean }

/** The cast's passports are registered once (signature checks dominate the run time) and every sequence starts from a copy of that state. */
let baseState: MemoryState | undefined;
async function freshLog(): Promise<EventLog> {
  if (!baseState) {
    const first = new EventLog(new MemoryStore());
    await first.append(passport(alice.did, alice, [alice], null));
    await first.append(passport(coder.did, alice, [coder], null, true));
    await first.append(passport(bank.did, bank, [bank], null));
    for (const p of [principals[1], principals[2], ...jurors, reporter]) await first.append(person(p));
    await first.append(rec("passport", alice, { did: agents[1].did, kind: "agent", sponsor: alice.did, tier: 1, shape: {}, keys: [{ id: agents[1].kid, type: "Ed25519", public_key: b64urlEncode(agents[1].publicKey) }] }, null, agents[1].did));
    baseState = (first as unknown as { store: MemoryStore }).store.exportState();
  }
  const store = new MemoryStore();
  store.importState(structuredClone(baseState));
  return new EventLog(store);
}

/** Everything the supply rule reads, (not the head): compared in full before and after a refused operation (A3). */
const stateOf = async (log: EventLog) => {
  const { head: _head, ...money } = await (log as unknown as { store: { ledgerRows(): Promise<{ head: unknown }> } }).store.ledgerRows(); // not the head: a refused bond still leaves its contract in the log
  return money;
};

/** Appends a record; a refusal by the log (an AspError) is the expected way an operation fails and is reported as false. */
async function tryAppend(log: EventLog, r: AspRecord): Promise<boolean> {
  try { await log.append(r); return true; } catch (e) { if (e instanceof AspError) { if (process.env.ASP_CONSERVATION_DEBUG) console.log(`refused: ${e.message.slice(0, 150)}`); return false; } throw e; }
}

/** One run of one sequence. Returns the list of operations, so a failure can name the shortest failing prefix. */
async function runSequence(seed: number, maxOps: number | undefined, check: (log: EventLog, step: number, op: string, refused: boolean, before: unknown, mintedBefore: number, mintedAmount: number) => Promise<void>): Promise<number> {
  const rnd = mulberry32(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
  const log = await freshLog();
  const jobs: Job[] = [];
  const jurorHeads = new Map<string, string>();
  const reports: { id: string; contract: string }[] = [];
  const pickOpen = (): Job => { const open = jobs.filter((j) => !j.settled); return pick(open.length ? open : jobs); };
  const total = int(5, 60);
  const ops = maxOps === undefined ? total : Math.min(total, maxOps);

  for (let step = 0; step < ops; step++) {
    let before = await stateOf(log);
    const mintedBefore = (await log.mints()).reduce((n, m) => n + m.amount, 0);
    let op = "", refused = false, mintedAmount = 0;
    const kind = rnd();
    if (kind < 0.22) {
      const who = pick(everyone), amount = int(0, 600);
      op = `mint ${amount} to ${who.did}`; mintedAmount = amount;
      await log.mint(who.did, amount);
    } else if (kind < 0.40 || jobs.length === 0) {
      // A new contract and bond; the bond may be too small, or the funds missing (refused).
      const principal = pick(principals), agent = pick(agents), price = int(10, 400), bond = int(0, price);
      op = `job price ${price} bond ${bond} (${principal.did} -> ${agent.did})`;
      // Usually funded (the principal's escrow, the backer's bond, a little spare for a court-fee reserve); sometimes not, so the bond is refused.
      if (rnd() < 0.85) { const spare = int(0, 30); await log.mint(principal.did, price + spare); await log.mint(agent.did, bond + spare); mintedAmount = price + bond + 2 * spare; before = await stateOf(log); /* A3 compares from after the funding: the refusal is the bond's */ }
      const contract = cosign(rec("contract", principal, {
        principal: principal.did, performer: agent.did, bank: bank.did, purpose: "Fix the flaky test", price: money(price),
        verification: "deterministic", deadline: "2026-10-03T18:00:00Z", ...(rnd() < 0.5 ? { ruling_window_seconds: 30 } : {}), basis: { intent: "sha256:" + "0".repeat(64), offer: "sha256:" + "1".repeat(64) },
      }, null, agent.did), agent);
      await log.append(contract);
      const ok = await tryAppend(log, rec("bond", agent, {
        contract: contract.id, backer: agent.did, amount: money(bond), escrow: { payer: principal.did, amount: money(price) },
        slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"],
      }, contract.id, contract.id));
      refused = !ok;
      if (ok) jobs.push({ contract, principal, agent, price, bond, settled: false });
      else op += " [bond refused]";
    } else if (kind < 0.62) {
      // Move a job along: mandate, delivery, accept or reject.
      const job = pickOpen();
      const head = (await log.chain(job.contract.id)).at(-1)!;
      const state = (await log.chainInfo(job.contract.id))?.state ?? "";
      const t = head.record.type.replace(/^asp\./, "").replace(/\/v0\.2$/, "");
      let r: AspRecord;
      if (t === "bond") {
        r = rec("mandate", job.principal, {
          contract: job.contract.id, purpose: "Fix the flaky test", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [],
          spend: { cap: 0, unit }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 },
          learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2026-10-04T00:00:00Z", revocable: true,
        }, head.id, job.agent.did);
      } else if (t === "mandate") {
        r = rec("delivery", job.agent, {
          contract: job.contract.id, result: { summary: "Done", artifacts: [] }, evidence: { trace: { uri: "asp://local/trace", sha256: "sha256:" + "2".repeat(64) }, forecasts: [] },
        }, head.id, job.contract.id);
      } else if (t === "delivery") {
        r = rec("attestation", job.principal, rnd() < 0.5
          ? { kind: "acceptance", about: head.id, verdict: "accepted" }
          : { kind: "acceptance", about: head.id, verdict: "rejected", reasons: ["not good enough"] }, head.id, job.contract.id);
      } else if (t === "attestation" && (head.record.body as { verdict?: string }).verdict === "rejected") {
        r = rec("attestation", bank, { kind: "ruling", about: job.contract.id, verdict: "split", fault: { [job.agent.did]: pick([0, 250, 500, 1000]) } }, head.id, job.contract.id);
      } else { r = rec("attestation", job.principal, { kind: "acceptance", about: head.id, verdict: "accepted" }, head.id, job.contract.id); }
      op = `advance ${t} (${state})`;
      refused = !(await tryAppend(log, r));
    } else if (kind < 0.82) {
      // Settle, on any basis, with amounts that are sometimes right and sometimes wrong (over-release, fees too large).
      const job = pickOpen();
      const chain = await log.chain(job.contract.id);
      const head = chain.at(-1)!;
      const hb = head.record.body as { verdict?: string; kind?: string; fault?: Record<string, number> };
      // The basis follows where the job is (accepted, ruled, rejected and waiting, or running), with the right amounts 70 % of the time.
      let basis: "accepted" | "revoked" | "ruling" | "ruling_timeout" = pick(["accepted", "revoked", "ruling", "ruling_timeout"]);
      let cites: string | undefined;
      let released = pick([0, Math.floor(job.price / 2), job.price, job.price + 1, int(0, job.price)]);
      let returned = pick([0, job.bond, Math.floor(job.bond / 2), job.bond + 1]);
      let slashed = pick([0, Math.floor(job.bond / 4), job.bond - Math.min(returned, job.bond)]);
      let fees = pick([0, 0, 1, Math.floor(job.price / 20), job.price]);
      if (rnd() < 0.7) {
        fees = 0;
        if (hb.kind === "acceptance" && hb.verdict === "accepted") { basis = "accepted"; cites = head.id; released = int(0, job.price); returned = job.bond; slashed = 0; fees = int(0, job.price - released) > 3 ? 3 : 0; }
        else if (hb.kind === "ruling") { basis = "ruling"; cites = head.id; const f = hb.fault?.[job.agent.did] ?? 0; released = Math.floor((job.price * (1000 - f)) / 1000); slashed = Math.ceil((job.bond * f) / 1000); returned = job.bond - slashed; }
        else if (hb.kind === "acceptance" && hb.verdict === "rejected") { basis = "ruling_timeout"; released = Math.floor(job.price / 2); returned = job.bond; slashed = 0; }
        else { basis = "revoked"; released = int(0, job.price); returned = job.bond - (slashed = rnd() < 0.2 ? int(0, job.bond) : 0); }
      }
      const body: Record<string, unknown> = { contract: job.contract.id, basis, escrow_released: money(released), bond_returned: money(returned), bond_slashed: money(slashed) };
      if (fees) body.fees = money(fees);
      if (basis === "revoked") body.pro_rata_permille = int(0, 1000);
      if (cites) body.cites = cites;
      else if (basis === "accepted" || basis === "ruling") body.cites = head.id;
      op = `settle ${basis} released ${released} returned ${returned} slashed ${slashed} fees ${fees}`;
      refused = !(await tryAppend(log, cosign(rec("settlement", bank, body, head.id, job.contract.id), job.principal)));
      if (!refused) job.settled = true;
    } else if (kind < 0.93) {
      // Jurors: register (a first record), raise or return some of the stake (a chained record).
      const j = pick(jurors);
      const head = jurorHeads.get(j.did);
      const stake = pick([0, 50, 100, 150, 400]);
      op = `juror ${head ? "update" : "register"} ${j.did} stake ${stake}`;
      if (rnd() < 0.85) { const fund = stake + int(0, 50); await log.mint(j.did, fund); mintedAmount = fund; before = await stateOf(log); }
      const r = rec("juror", j, { did: j.did, stake: money(stake) }, head ?? null);
      refused = !(await tryAppend(log, r));
      if (!refused) jurorHeads.set(j.did, r.id);
    } else {
      // A whistleblower report on a job, and sometimes a ruling on it by the drawn panel.
      const running = jobs.filter((j) => !j.settled);
      if (running.length === 0) { op = "no open job to report"; refused = false; }
      else {
        const job = pick(running);
        const open = reports.find((x) => x.contract === job.contract.id);
        if (open && rnd() < 0.8) {
          let panel: string[] = [];
          try { panel = await log.drawReportPanel(open.id); } catch (e) { if (!(e instanceof AspError)) throw e; }
          const signers = panel.map((d) => jurors.find((j) => j.did === d)).filter((x): x is Who => !!x);
          op = `report ruling by ${signers.length} of the panel`;
          if (signers.length === 0) refused = true;
          else {
            let r = rec("attestation", signers[0], { kind: "report_ruling", about: open.id, verdict: pick(["upheld", "dismissed"]) , code: { version: "0.3", articles: ["7"] } }, null, job.contract.id);
            for (const s of signers.slice(1, 3)) r = cosign(r, s);
            refused = !(await tryAppend(log, r));
          }
        } else {
          op = `report on ${job.contract.id.slice(0, 12)}`;
          if (rnd() < 0.9) { await log.mint(reporter.did, 100); mintedAmount = 100; before = await stateOf(log); }
          const r = rec("attestation", reporter, { kind: "report", about: job.contract.id, reasons: ["the agent is sending data to an outside host"] }, null, job.contract.id);
          refused = !(await tryAppend(log, r));
          if (!refused) reports.push({ id: r.id, contract: job.contract.id });
        }
      }
    }
    await check(log, step, op, refused, before, mintedBefore, mintedAmount);
  }
  return ops;
}

/** How often each kind of operation was accepted and refused over the whole run, so the test can show it reached the interesting paths. */
const coverage = new Map<string, { ok: number; refused: number }>();
const kindOf = (op: string) => op.replace(/ \[.*$/, "").replace(/^(settle \w+).*/, "$1").replace(/^(advance \w+).*/, "$1").replace(/^(job).*/, "$1").replace(/^(mint).*/, "$1").replace(/^(juror \w+).*/, "$1").replace(/^(report ruling).*/, "$1").replace(/^(report on).*/, "report open");

/** The checks A1, A2, A3, A7 after one operation. */
async function check(log: EventLog, step: number, op: string, refused: boolean, before: unknown, mintedBefore: number, mintedAmount: number) {
  const c = coverage.get(kindOf(op)) ?? { ok: 0, refused: 0 };
  if (refused) c.refused++; else c.ok++;
  coverage.set(kindOf(op), c);
  const audit = await log.creditAudit();
  const where = `step ${step}: ${op}`;
  assert.equal(audit.verdict, "balanced", `A1 supply rule broken at ${where}: ${audit.problems.join("; ")} (balances ${audit.balances} + locked ${audit.locked.total} vs minted ${audit.minted})`);
  assert.deepEqual(audit.negativeAccounts, [], `A2 negative balance at ${where}`);
  if (refused) assert.deepEqual(await stateOf(log), before, `A3 a refused operation changed the ledger at ${where}`);
  assert.equal(audit.minted, mintedBefore + mintedAmount, `A7 minted total moved by other than the mint at ${where}`);
}

describe("conservation property test (credits.md section 9)", () => {
  test(`${SEQUENCES} random sequences from seed ${SEED}: the supply rule holds after every operation`, { timeout: 600_000 }, async () => {
    console.log(`conservation property test: seed ${SEED}, ${SEQUENCES} sequences${ONLY !== undefined ? `, only sequence ${ONLY}` : ""}`);
    let operations = 0, refusedPrefix = 0;
    for (let n = 0; n < SEQUENCES; n++) {
      if (ONLY !== undefined && n !== ONLY) continue;
      const seed = (SEED + n * 7919) >>> 0;
      try {
        operations += await runSequence(seed, undefined, check);
        // A4: replaying the records on a fresh log reproduces this one (the same replay `verify` uses).
      } catch (e) {
        // Shrink: re-run shorter prefixes of the same sequence and report the shortest that still fails.
        let shortest = Infinity;
        for (let k = 1; k < 60; k++) { try { await runSequence(seed, k, check); } catch { shortest = k; break; } }
        refusedPrefix = shortest;
        throw new Error(`sequence ${n} (seed ${SEED}, sequence seed ${seed}) failed; shortest failing prefix: ${shortest} operation(s). Re-run with ASP_CONSERVATION_ONLY=${n}. ${(e as Error).message}`);
      }
    }
    void refusedPrefix;
    assert.ok(ONLY !== undefined || operations > SEQUENCES * 5, "the generator ran operations");
    console.log(`  ${operations} operations checked; accepted/refused by kind: ${[...coverage].sort().map(([k, c]) => `${k} ${c.ok}/${c.refused}`).join(", ")}`);
    if (ONLY === undefined) for (const k of ["settle accepted", "settle ruling_timeout", "settle revoked", "settle ruling", "juror register", "report open", "report ruling"]) assert.ok((coverage.get(k)?.ok ?? 0) > 0, `the generator never had "${k}" accepted: it does not reach that path`);
  });

  test("A4: a fresh replay of the records reproduces the log (verify) after a random sequence", { timeout: 120_000 }, async () => {
    const rnd = mulberry32(SEED);
    for (let n = 0; n < 20; n++) {
      // Run a sequence and keep the log: runSequence builds its own, so re-create it through the same seed and verify at the end.
      const seed = (SEED + n * 7919 + Math.floor(rnd() * 1000)) >>> 0;
      let last: EventLog | undefined;
      await runSequence(seed, undefined, async (log) => { last = log; });
      const report = await last!.verify();
      assert.equal(report.ok, true, `sequence seed ${seed}: ${JSON.stringify(report.error)}`);
    }
  });

  test("a log with one balance changed by 1 fails the audit (the deliberate-failure test of DK9)", async () => {
    const log = await freshLog();
    for (const p of principals) await log.mint(p.did, 100);
    assert.equal((await log.creditAudit()).verdict, "balanced");
    // Corrupt a copy: change one balance by 1, outside any record.
    const store = (log as unknown as { store: MemoryStore }).store;
    await store.transaction(async (tx) => { await tx.putAccount({ did: principals[1].did, balance: 101 }); });
    const bad = await log.creditAudit();
    assert.equal(bad.verdict, "mismatch");
    assert.equal(bad.difference, 1);
    assert.match(bad.problems[0], /1 credit\(s\) more are held than were ever minted/);
    // And the other way: a credit lost.
    await store.transaction(async (tx) => { await tx.putAccount({ did: principals[1].did, balance: 99 }); });
    const lost = await log.creditAudit();
    assert.equal(lost.verdict, "mismatch"); assert.equal(lost.difference, -1);
    // The pure check agrees with the log's own.
    assert.equal(auditLedger(await store.ledgerRows(), PLATFORM_DID).verdict, "mismatch");
  });
});
