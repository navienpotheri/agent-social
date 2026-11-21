/**
 * The second ledger class (register row DK1370, ledger part; spec-delta S1413): purchased credits in lots with an expiry and a refund window, kept apart from starter and earned credits. A sale needs the operator and the
 * owner's go; purchased credits buy the platform's services and move between a sponsor and its own agent, and never pay for a job; expiry and refund burn what is left; the supply audit balances for both classes after every
 * step of a random sequence. No payment, invoice or tax is here (other lanes' parts), and nothing is sold until the owner co-signs a grant. Fake keys only. Credits are accounting entries, not money.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DAY, credit, jump, kit, mk, nowIso, operator, owner, refusedBy, type Party } from "./society-kit.ts";
import { drawPlan, applyDraw, outstanding, spendable } from "../src/credit-lots.ts";

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const ref = (n: number) => "sha256:" + n.toString(16).padStart(64, "0");

async function world() {
  const k = await kit();
  await k.withPrices();
  const grant = (to: Party, amount: number, o: { days?: number; refundDays?: number; n?: number; sign?: boolean } = {}) => {
    const now = Date.parse(nowIso());
    return mk("credit_lot", operator, { act: "grant", holder: to.did, amount: credit(amount), expires: iso(now + (o.days ?? 365) * DAY), ...(o.refundDays ? { refund_until: iso(now + o.refundDays * DAY) } : {}), reference: ref(o.n ?? Math.floor(Math.random() * 1e9)) }, null, { subject: to.did, ...(o.sign === false ? {} : { cosigners: [owner] }) });
  };
  const act = (kind: "expire" | "refund", to: Party, lot: string, amount: number, sign = true) => mk("credit_lot", operator, { act: kind, holder: to.did, amount: credit(amount), lot }, null, { subject: to.did, ...(sign ? { cosigners: [owner] } : {}) });
  return { ...k, grant, act };
}

describe("the pure arithmetic", () => {
  test("a purchase draws unexpired lots first, earliest expiry first, then credits that are in no lot; expired lots are never spent", () => {
    const lots = [{ id: "b", left: 50, expires: "2027-03-01T00:00:00Z" }, { id: "a", left: 30, expires: "2027-01-01T00:00:00Z" }, { id: "x", left: 99, expires: "2026-01-01T00:00:00Z" }];
    const at = "2026-11-21T00:00:00Z";
    assert.equal(outstanding(lots), 179);
    assert.equal(spendable(lots, at), 80, "the expired lot is not spendable");
    const p = drawPlan(lots, 60, at, 100);
    assert.deepEqual(p.draws, [{ id: "a", take: 30 }, { id: "b", take: 30 }]);
    assert.deepEqual([p.ok, p.fromLots, p.fromFree], [true, 60, 0]);
    const q = drawPlan(lots, 100, at, 25);
    assert.deepEqual([q.ok, q.fromLots, q.fromFree], [true, 80, 20]);
    assert.equal(drawPlan(lots, 100, at, 5).ok, false, "80 in lots and 5 free do not cover 100");
    assert.deepEqual(applyDraw(lots, p.draws).map((l) => [l.id, l.left]), [["b", 20], ["x", 99]]);
  });
});

describe("a sale, and what purchased credits may do", () => {
  test("only the operator with the owner's go grants a lot, once per payment reference, with a sensible expiry and window; the holder's balance and the supply audit rise together", async () => {
    const w = await world();
    const buyer = await w.person("lot-buyer");
    const stranger = await w.person("lot-stranger");
    const g = (over: Record<string, unknown>) => mk("credit_lot", operator, { act: "grant", holder: buyer.did, amount: credit(500), expires: iso(Date.parse(nowIso()) + 365 * DAY), reference: ref(1), ...over }, null, { subject: buyer.did, cosigners: [owner] });
    assert.equal(await refusedBy(w.log.append(w.grant(buyer, 500, { sign: false }))), "credit_lot_needs_owner", "no sale without the owner's go");
    assert.equal(await refusedBy(w.log.append(mk("credit_lot", stranger, { act: "grant", holder: buyer.did, amount: credit(5), expires: iso(Date.parse(nowIso()) + DAY), reference: ref(9) }, null))), "credit_lot_unauthorised");
    assert.equal(await refusedBy(w.log.append(g({ holder: "did:web:example.com:users:nobody" }))), "credit_lot_holder");
    assert.equal(await refusedBy(w.log.append(g({ expires: iso(Date.parse(nowIso()) - DAY) }))), "credit_lot_expiry");
    assert.equal(await refusedBy(w.log.append(g({ expires: iso(Date.parse(nowIso()) + 4 * 365 * DAY) }))), "credit_lot_expiry_too_long");
    assert.equal(await refusedBy(w.log.append(g({ refund_until: iso(Date.parse(nowIso()) + 400 * DAY) }))), "credit_lot_refund_window");
    const before = await w.log.creditAudit();
    await w.log.append(g({}));
    assert.equal(await refusedBy(w.log.append(g({}))), "credit_lot_reference_known", "one lot per payment reference");
    assert.equal(await w.log.balance(buyer.did), 500);
    const after = await w.log.creditAudit();
    assert.equal(after.minted - before.minted, 500, "a sale is minted supply, counted in the audit");
    assert.equal(after.verdict, "balanced");
    const classes = await w.log.creditClassAudit();
    assert.deepEqual([classes.sold, classes.outstanding, classes.consumed, classes.verdict], [500, 500, 0, "balanced"]);
  });

  test("purchased credits buy services (lots first), never pay for a job, and a sponsor funds its own agent with them", async () => {
    const w = await world();
    const sponsor = await w.person("lot-sponsor", 30); // 30 earned credits
    const agent = await w.agent("lot-agent", sponsor);
    const mandate = await w.openMandate(agent);
    await w.log.append(w.grant(sponsor, 100, { n: 2 }));
    assert.equal(await w.log.balance(sponsor.did), 130);
    // a job: escrow draws only what is not purchased, so 130 - 100 locked = 30 free
    const client = sponsor;
    const price = 60;
    assert.equal(await (async () => { try { await w.runJob(client, agent, price); return undefined; } catch (e) { return (e as { detail?: string }).detail; } })(), "purchased_credits_restricted", "60 would reach into the 100 purchased credits");
    // a service: 40 credits draw the lot first
    await w.buy(sponsor, "registry.name.claim", 10);
    const c1 = await w.log.creditClassAudit();
    assert.deepEqual([c1.consumed, c1.outstanding], [10, 90], "ten purchased credits were consumed at the Registry; the credits moved on as ordinary platform credits");
    assert.equal(await w.log.balance(sponsor.did), 120);
    // the sponsor funds its agent: prepaid credits go first, class and expiry travel with them
    await w.log.append(mk("internal_transfer", sponsor, { to: agent.did, amount: credit(50) }, null, { subject: agent.did }));
    assert.equal(await w.log.balance(agent.did), 50);
    const c2 = await w.log.creditClassAudit();
    assert.equal(c2.outstanding, 90, "the lots moved to the agent, nothing was consumed");
    await w.buy(agent, "registry.name.claim", 10, { mandate });
    assert.equal((await w.log.creditClassAudit()).consumed, 20, "the agent spent purchased credits on a service");
    // the agent returns credits: what is not purchased goes first
    await w.log.append(mk("internal_transfer", agent, { to: sponsor.did, amount: credit(10) }, null, { subject: sponsor.did }));
    assert.equal((await w.log.creditClassAudit()).verdict, "balanced");
    assert.equal((await w.log.creditAudit()).verdict, "balanced");
    // and never to a third party
    const other = await w.person("lot-other");
    assert.equal(await refusedBy(w.log.append(mk("internal_transfer", sponsor, { to: other.did, amount: credit(5) }, null, { subject: other.did }))), "transfer_not_allowed");
  });
});

describe("expiry and refund", () => {
  test("an expired lot cannot be spent and is burned by the expiry; a refund inside the window burns the unspent part, whole or part, once the owner agrees; after the window it is refused", async () => {
    const w = await world();
    const p = await w.person("lot-expiry");
    const short = w.grant(p, 100, { days: 10, refundDays: 5, n: 3 });
    await w.log.append(short);
    const long = w.grant(p, 200, { days: 400, refundDays: 30, n: 4 });
    await w.log.append(long);
    assert.equal(await refusedBy(w.log.append(w.act("expire", p, short.id, 100))), "credit_lot_not_expired");
    assert.equal(await refusedBy(w.log.append(w.act("refund", p, long.id, 50, false))), "credit_lot_needs_owner");
    assert.equal(await refusedBy(w.log.append(w.act("refund", p, long.id, 500))), "credit_lot_over");
    await w.log.append(w.act("refund", p, long.id, 50));
    assert.equal(await w.log.balance(p.did), 250, "a refund burns the credits; the money is the payment lane's");
    jump(6 * DAY);
    assert.equal(await refusedBy(w.log.append(w.act("refund", p, short.id, 10))), "credit_lot_refund_closed", "the short lot's window ended");
    jump(10 * DAY); // the short lot has expired
    await w.buy(p, "registry.name.claim", 10);
    assert.deepEqual([(await w.log.creditClassAudit()).consumed], [10], "the purchase drew the unexpired long lot, not the expired one");
    assert.equal((await w.log.creditClassAudit()).expiredNotBurned, 100);
    assert.equal(await refusedBy(w.log.append(w.act("expire", p, short.id, 40))), "credit_lot_expire_all");
    await w.log.append(w.act("expire", p, short.id, 100, false));
    const c = await w.log.creditClassAudit();
    assert.deepEqual([c.sold, c.refunded, c.expired, c.consumed, c.outstanding, c.expiredNotBurned, c.verdict], [300, 50, 100, 10, 140, 0, "balanced"]);
    assert.equal((await w.log.creditAudit()).verdict, "balanced");
    assert.equal((await w.log.verify()).ok, true, "a replica replays the lots the same way");
  });
});

describe("a random sequence keeps both classes balanced", () => {
  test("three seeds of 300 steps of sales, purchases, funding transfers both ways, refunds and expiries: after every step the supply audit balances, the classes add up and no account holds more purchased credits than its balance", async () => {
   for (const seed0 of [20261121, 31337, 8675309]) {
    const w = await world();
    const people = [await w.person("lot-p0", 50), await w.person("lot-p1", 50), await w.person("lot-p2", 50)];
    const agents = [await w.agent("lot-a0", people[0]), await w.agent("lot-a1", people[1]), await w.agent("lot-a2", people[2])];
    const mandates = [await w.openMandate(agents[0]), await w.openMandate(agents[1]), await w.openMandate(agents[2])];
    let seed = seed0;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
    const lots: { id: string; holder: Party; at: number }[] = [];
    let n = 100, applied = 0;
    for (let step = 0; step < 300; step++) {
      const op = Math.floor(rand() * 7), i = Math.floor(rand() * 3);
      try {
        if (op === 0) { const g = w.grant(pick([people[i], agents[i]]), 20 + Math.floor(rand() * 80), { days: 20 + Math.floor(rand() * 60), refundDays: 10, n: ++n }); await w.log.append(g); lots.push({ id: g.id, holder: (g.body as { holder: string }).holder === people[i].did ? people[i] : agents[i], at: step }); }
        else if (op === 1) await w.buy(people[i], "registry.name.claim", 10);
        else if (op === 2) await w.buy(agents[i], "registry.name.claim", 10, { mandate: mandates[i] });
        else if (op === 3) await w.log.append(mk("internal_transfer", people[i], { to: agents[i].did, amount: credit(1 + Math.floor(rand() * 30)) }, null, { subject: agents[i].did }));
        else if (op === 4) await w.log.append(mk("internal_transfer", agents[i], { to: people[i].did, amount: credit(1 + Math.floor(rand() * 30)) }, null, { subject: people[i].did }));
        else if (op === 5 && lots.length) { const l = pick(lots); await w.log.append(w.act("refund", l.holder, l.id, 1 + Math.floor(rand() * 15))); }
        else if (op === 6) { jump(Math.floor(rand() * 9) * DAY); const l = lots.length ? pick(lots) : undefined; if (l) { const c = await w.log.creditClassAudit(); void c; try { const left = await leftOf(w, l.holder.did, l.id); if (left > 0) await w.log.append(w.act("expire", l.holder, l.id, left, false)); } catch { /* not expired yet */ } } }
        applied++;
      } catch { /* a refused step is part of the sequence: it must leave the books as they were */ }
      const a = await w.log.creditAudit(), c = await w.log.creditClassAudit();
      assert.equal(a.verdict, "balanced", `step ${step}: ${a.problems.join("; ")}`);
      assert.equal(c.verdict, "balanced", `step ${step}: ${c.problems.join("; ")}`);
      assert.equal(c.outstanding, c.sold - c.consumed - c.expired - c.refunded);
    }
    assert.ok(applied > 100, `${applied} of 300 steps were applied`);
    const last = await w.log.creditClassAudit();
    assert.ok(last.sold > 0 && last.consumed > 0, `sold ${last.sold}, consumed ${last.consumed}: the sequence exercised both`);
    assert.equal((await w.log.verify()).ok, true);
   }
  });
});

async function leftOf(w: Awaited<ReturnType<typeof world>>, holder: string, lot: string): Promise<number> {
  const { lotsOf } = await import("../src/credit-lots.ts");
  return (w.log as unknown as { store: { transaction: <T>(f: (tx: never) => Promise<T>) => Promise<T> } }).store.transaction(async (tx) => (await lotsOf(tx, holder)).find((l) => l.id === lot)?.left ?? 0);
}
