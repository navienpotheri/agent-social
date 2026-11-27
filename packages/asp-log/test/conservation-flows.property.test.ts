// The conservation property test, extended to the flows of the Market, the Registry and the Courts (docs/institutions/economy/credits.md section 9; register row DK129; spec-delta S455).
//
// Random sequences of credit-moving operations from a fixed seed over a small cast: funding, purchases of every priced service (a posting deposit, a name claim and renewal, an appeal fee and an exam sitting)
// at the right price and one credit off it, refunds of those purchases by their institution (the right amount and too much), name claims, postings with their deposits, and identity renewals after time passes.
// After every operation: A1 the supply rule (balances + locks = minted, exactly), A2 no negative balance, A3 a refused operation leaves every balance, lock and counter unchanged, A7 only a mint changes
// the minted total, by exactly its amount; and at the end of a sequence A4 a replay of the records reproduces the log (verify). The run counts how often each kind was accepted and refused and fails if a kind
// never succeeded, so the generator is shown to reach the paths it is meant to. Two compound operations (DK441) take the state the plain ones cannot reach: a posting is filled (a bid, the Market's assignment, a job run to settlement) and
// its deposit is returned, or refused for a wrong amount; and a dispute is ruled, appealed, the appeal reverses (or affirms) the ruling, and the Courts refund the appeal fee, or are refused for an affirmed one. Their set-up steps
// stand, and the last step is the one that may be refused; A1 to A7 are asserted after the whole operation, and A3 for a refused last step. To re-run one: ASP_FLOWS_ONLY=<n>; to change the seed or the count: ASP_FLOWS_SEED, ASP_FLOWS_COUNT.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AspError, cosign, type AspRecord, type Signer } from "@agent-social/asp-core";
import { EventLog } from "../src/index.ts";
import { NAME_TERM_MS } from "../src/registry.ts";
import { PRICES, credit, courts, jump, kit, market, mk, nowIso, registrar, tick, type Party } from "./society-kit.ts";

const SEED = Number(process.env.ASP_FLOWS_SEED ?? 20261114);
const SEQUENCES = Number(process.env.ASP_FLOWS_COUNT ?? 60);
const ONLY = process.env.ASP_FLOWS_ONLY === undefined ? undefined : Number(process.env.ASP_FLOWS_ONLY);
const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Everything the supply rule reads, not the head (a refused record can still leave the head's record behind). */
const stateOf = async (log: EventLog) => { const { head: _h, ...rows } = await (log as unknown as { store: { ledgerRows(): Promise<{ head: unknown }> } }).store.ledgerRows(); return rows; };
const refusedOnly = async (p: Promise<unknown>): Promise<boolean> => { try { await p; return false; } catch (e) { if (e instanceof AspError) return true; throw e; } };
const CODE = { version: "1.0", articles: ["4.1"] };
const SIGNER: Record<string, Party> = { [market.did]: market as Party, [registrar.did]: registrar as Party, [courts.did]: courts as Party };

const coverage = new Map<string, { ok: number; refused: number }>();
const count = (kind: string, refused: boolean) => { const c = coverage.get(kind) ?? { ok: 0, refused: 0 }; if (refused) c.refused++; else c.ok++; coverage.set(kind, c); };

async function sequence(seed: number): Promise<EventLog> {
  const rnd = mulberry32(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
  const k = await kit();
  await k.withPrices();
  const sponsor = await k.person("fl-sponsor", 300);
  const poster = await k.person("fl-poster", 300);
  const agent = await k.agent("fl-agent", sponsor, { funds: 100 });
  const mandate = await k.openMandate(agent);
  const who: Party[] = [poster, agent];
  const purchases: { id: string; service: string; price: number; item: (typeof PRICES)[number] }[] = [];
  const names = ["scout-7", "scout-8", "ranger-1"];
  // Nine staked jurors (a mint each, before the first operation) so a dispute can be ruled and appealed.
  const jurors = new Map<string, Party>();
  for (let i = 0; i < 9; i++) { const j = await k.person(`fl-juror-${i}`, 500); await k.log.append(mk("juror", j, { did: j.did, stake: credit(100) }, null)); jurors.set(j.did, j); }
  const postings: { id: string; intent: string; deposit: string; stage: 0 | 1 | 2 }[] = [];
  let disputes = 0;
  const signed = (dids: string[], body: Record<string, unknown>, prev: string | null, subject?: string, type: "attestation" | "court_act" = "attestation"): AspRecord => { const [f, ...rest] = dids.map((d) => jurors.get(d)!); let r = mk(type, f, body, prev, subject ? { subject } : undefined); for (const x of rest) r = cosign(r, x as Signer); return r; };
  const total = int(8, 40);

  for (let step = 0; step < total; step++) {
    let before = await stateOf(k.log);
    const mintedBefore = (await k.log.creditAudit()).minted;
    let minted = 0, refused = false, kind = "", skipA3 = false;
    const r = rnd();
    if (r < 0.15) {
      kind = "mint"; const to = pick([sponsor, poster, agent]), amount = int(1, 80); minted = amount; await k.mint(to.did, amount);
    } else if (r < 0.42) {
      kind = "purchase"; const item = pick(PRICES), buyer = pick(who), amount = pick([item.price, item.price, item.price, item.price + 1, Math.max(1, item.price - 1)]);
      const opts = buyer === agent ? { mandate } : {};
      try { const id = await k.buy(buyer, item.service, amount, opts); purchases.push({ id, service: item.service, price: item.price, item }); } catch (e) { if (!(e instanceof AspError)) throw e; refused = true; }
    } else if (r < 0.58) {
      kind = "refund";
      const refundable = purchases.filter((x) => SIGNER[x.item.institution]);
      if (!refundable.length) { kind = "refund (nothing bought)"; } else {
        const p = pick(refundable), amount = pick([p.price, p.price, Math.floor(p.price / 2), p.price + 1, 0]);
        refused = await refusedOnly(k.log.append(mk("receipt", SIGNER[p.item.institution], { purchase: p.id, status: "refunded", refund_amount: credit(amount) }, p.id)));
      }
    } else if (r < 0.74) {
      kind = "name claim";
      try {
        const paid = await k.buy(agent, "registry.name.claim", pick([10, 10, 10, 9]), { mandate });
        before = await stateOf(k.log); // the purchase is a move that stands; the claim that follows is what may be refused
        const at = tick();
        refused = await refusedOnly(k.log.append(mk("registry_act", agent, { act: "name_claim", name: pick(names), holder: agent.did, class: "agent", paid, valid_until: iso(Date.parse(at) + NAME_TERM_MS) }, null, { at })));
      } catch (e) { if (!(e instanceof AspError)) throw e; refused = true; }
    } else if (r < 0.80) {
      kind = "posting";
      try {
        const intent = await k.intent(poster, { budget: credit(60) });
        const bought = await k.buy(poster, "market.posting.deposit", 2);
        purchases.push({ id: bought, service: "market.posting.deposit", price: 2, item: PRICES[0] });
        const deposit = postings.length && rnd() < 0.25 ? pick(postings).deposit : bought; // a deposit used twice is refused
        before = await stateOf(k.log);
        const posting = mk("market_act", poster, { act: "posting", intent, board: "main", expires: iso(Date.parse(nowIso()) + 60 * 86_400_000), deposit });
        refused = await refusedOnly(k.log.append(posting));
        if (!refused) postings.push({ id: posting.id, intent, deposit, stage: 0 });
      } catch (e) { if (!(e instanceof AspError)) throw e; refused = true; }
    } else if (r < 0.88) {
      kind = "deposit return";
      const p = postings.find((x) => x.stage < 2);
      if (!p) { kind = "deposit return (no posting)"; } else {
        try {
          if (p.stage === 0) {
            await k.mint(poster.did, 100); minted += 100; // the job's price and tax, so the set-up cannot fail for want of funds
            const offer = await k.offer(agent, p.intent, 60);
            await k.log.append(mk("market_act", agent, { act: "bid", posting: p.id, offer }));
            const ranked = await k.log.rankPosting(p.id, "best_match", "seed-1");
            await k.log.append(mk("market_act", market, { act: "assignment", posting: p.id, intent: p.intent, agent: agent.did, rule: "best_match", ranked, seed: "seed-1" }));
            await k.runJob(poster, agent, 60, { intent: p.intent, offer });
            p.stage = 1;
          }
          before = await stateOf(k.log);
          const amount = pick([2, 2, 3]); // the right amount, or one credit too many
          refused = await refusedOnly(k.log.append(mk("receipt", market, { purchase: p.deposit, status: "refunded", refund_amount: credit(amount) }, p.deposit)));
          if (!refused) p.stage = 2;
        } catch (e) { if (!(e instanceof AspError)) throw e; refused = true; skipA3 = true; kind = "deposit return (set-up refused)"; }
      }
    } else if (r < 0.94 && disputes < 2) {
      kind = "appeal fee refund"; disputes++;
      try {
        await k.mint(poster.did, 200); minted += 200;
        const job = await k.runJob(poster, agent, 80, undefined, { settle: false });
        const rej = mk("attestation", poster, { kind: "acceptance", about: job.delivery, verdict: "rejected", reasons: ["the work is not good enough"] }, job.delivery, { subject: job.contract });
        await k.log.append(rej);
        const panel = await k.log.drawPanel(job.contract);
        const ruling = signed(panel.slice(0, Math.ceil(panel.length / 2)), { kind: "ruling", about: job.contract, verdict: "for_principal", fault: { [agent.did]: 1000 }, reasons: ["decided on the record"], code: CODE }, rej.id, job.contract);
        await k.log.append(ruling);
        const fee = await k.buy(poster, "courts.appeal.small", 5);
        const appeal = mk("court_act", poster, { act: "appeal", ruling: ruling.id, grounds: "error_of_law", statement: "Article 4.1 was misapplied to this delivery", fee_paid: fee });
        await k.log.append(appeal);
        const signers1 = [ruling.sig.kid, ...(ruling.cosigs ?? []).map((c) => c.kid)].map((x) => x.split("#")[0]);
        const { drawPanel } = await import("../src/index.ts");
        const appealPanel = await drawPanel((k.log as unknown as { store: never }).store, { principal: poster.did, performer: agent.did, seed: appeal.id, size: 5, exclude: signers1 });
        const outcome = pick(["reversed", "reversed", "affirmed"]);
        await k.log.append(signed(appealPanel.slice(0, 3), { act: "appeal_ruling", appeal: appeal.id, outcome, ...(outcome === "affirmed" ? {} : { fault: { [poster.did]: 1000 } }), reasons: ["decided"], code: CODE }, null, undefined, "court_act") as never);
        before = await stateOf(k.log);
        refused = await refusedOnly(k.log.append(mk("receipt", courts, { purchase: fee, status: "refunded", refund_amount: credit(5) }, fee)));
      } catch (e) { if (!(e instanceof AspError)) throw e; if (process.env.ASP_FLOWS_DEBUG) console.log("appeal set-up refused:", (e as AspError).message); refused = true; skipA3 = true; kind = "appeal fee refund (set-up refused)"; }
    } else {
      kind = "renewal";
      const at = jump(int(0, 200) * 86_400_000);
      const passport = (await k.log.passport(agent.did))?.head;
      refused = await refusedOnly(k.log.append(mk("registry_act", agent, { act: "identity_renewal", passport, keys_confirmed: [agent.kid] }, null, { cosigners: [sponsor as never], at })));
    }
    count(kind, refused);
    const audit = await k.log.creditAudit();
    const where = `sequence seed ${seed}, step ${step}: ${kind}`;
    assert.equal(audit.verdict, "balanced", `A1 supply rule broken at ${where}: ${audit.problems.join("; ")}`);
    assert.deepEqual(audit.negativeAccounts, [], `A2 negative balance at ${where}`);
    if (refused && !skipA3) assert.deepEqual(await stateOf(k.log), before, `A3 a refused operation changed the ledger at ${where}`);
    assert.equal(audit.minted, mintedBefore + minted, `A7 minted total moved by other than the mint at ${where}`);
  }
  return k.log;
}

test(`DK129: ${SEQUENCES} random sequences from seed ${SEED} over postings and their deposits, name claims and renewals, appeal and exam fees and refunds: the supply rule holds after every operation and a refusal changes nothing`, { timeout: 600_000 }, async () => {
  let replayed = 0;
  for (let n = 0; n < SEQUENCES; n++) {
    if (ONLY !== undefined && n !== ONLY) continue;
    const log = await sequence((SEED + n * 7919) >>> 0);
    if (n % 6 === 0) { const rep = await log.verify(); assert.equal(rep.ok, true, `A4 replay failed for sequence ${n}: ${JSON.stringify(rep.error)}`); replayed++; }
  }
  console.log(`  accepted/refused by kind: ${[...coverage].sort().map(([k, c]) => `${k} ${c.ok}/${c.refused}`).join(", ")}; ${replayed} replays verified`);
  if (ONLY === undefined) for (const kind of ["mint", "purchase", "refund", "name claim", "posting", "renewal", "deposit return", "appeal fee refund"]) {
    assert.ok((coverage.get(kind)?.ok ?? 0) > 0, `${kind} was accepted at least once`);
    assert.ok((coverage.get(kind)?.refused ?? 0) > 0 || kind === "mint", `${kind} was refused at least once`);
  }
  if (ONLY === undefined) {
    assert.ok((coverage.get("deposit return")?.ok ?? 0) >= 3, "DK441: an accepted deposit return was drawn several times");
    assert.ok((coverage.get("appeal fee refund")?.ok ?? 0) >= 3, "DK441: an accepted appeal-fee refund (an appeal that reversed the ruling) was drawn several times");
  }
});
