/**
 * Spam, gaming and laundering on the job board (register row JB5; spec-delta S480; docs/city-design.md). Fake keys only. Credits are accounting entries, not money.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { lawProblem } from "../src/market.ts";
import { DAY, credit, jump, kit, market, mk, refusedBy, tick } from "./society-kit.ts";

async function world() {
  const k = await kit();
  await k.withPrices();
  const poster = await k.person("poster", 4000);
  const post = async (intentId: string, by = poster, mandate?: string) => {
    const deposit = await k.buy(by, "market.posting.deposit", 2, mandate ? { mandate } : {});
    return mk("market_act", by, { act: "posting", intent: intentId, board: "main", expires: new Date(Date.parse("2026-11-01T00:00:00Z") + 400 * DAY).toISOString().replace(".000Z", "Z"), deposit });
  };
  const posted = async (over: Record<string, unknown> = {}, by = poster) => { const p = await post(await k.intent(by, over), by); await k.log.append(p); return p.id; };
  const report = (by: { did: string }, posting: string, category = "spam", reason = "looks like spam") => mk("market_act", by as never, { act: "report", posting, category, reason });
  const review = (posting: string, verdict: "removed" | "cleared", over: Record<string, unknown> = {}) => mk("market_act", market, { act: "review", posting, verdict, reason: "reviewed", ...(verdict === "removed" ? { category: "spam" } : {}), ...over });
  return { ...k, poster, post, posted, report, review };
}

describe("the deposit (JB5: posting fees)", () => {
  test("a posting needs a deposit, paid once; a removed posting does not get it back", async () => {
    const w = await world();
    const before = await w.log.balance(w.poster.did);
    const id = await w.posted();
    assert.equal(before - (await w.log.balance(w.poster.did)), 2);
    await w.log.append(w.review(id, "removed"));
    assert.equal(before - (await w.log.balance(w.poster.did)), 2, "the removal returns nothing");
    assert.equal((await w.log.marketBoard()).length, 0);
  });
});

describe("the law screen (JB5: a check of each job against the law of the city)", () => {
  test("the plain cases are named with their Article and refused; an ordinary job is not", async () => {
    const w = await world();
    for (const [purpose, article] of [["Run a DDoS against the shop down the road", 7], ["Build a phishing page for a bank", 1], ["Dox the moderator who banned me", 7], ["Farm credits between my agents", 2], ["Brute force the login of my ex's account", 7]] as const) {
      const post = await w.post(await w.intent(w.poster, { purpose }));
      const f = await w.log.append(post).then(() => undefined, (e) => e);
      assert.equal(f?.detail, "posting_unlawful", purpose);
      assert.match(f.message, new RegExp(`Article ${article} `));
    }
    assert.equal(await refusedBy(w.log.append(await w.post(await w.intent(w.poster, { purpose: "Translate forty product descriptions", acceptance_criteria: ["stop the site from going down: add caching"] })))), undefined, "a job that is about protecting a site, not attacking it, is listed");
    assert.equal(await refusedBy(w.log.append(await w.post(await w.intent(w.poster, { purpose: "ordinary", acceptance_criteria: ["perform a denial of service test on my own staging server"] })))), "posting_unlawful", "the criteria are screened too; the poster rewrites the job (a screen, not a judge)");
    assert.equal(lawProblem("Review my pull request"), null);
  });
});

describe("independence (JB5: fake jobs between one owner's agents)", () => {
  test("an agent of the poster's own owner cannot bid on the poster's posting; an agent of another owner can", async () => {
    const w = await world();
    const sponsor = await w.person("sponsor", 100);
    const mine = await w.agent("mine", sponsor, { funds: 50 });
    const sibling = await w.agent("sibling", sponsor, { funds: 50 });
    const stranger = await w.agent("stranger", await w.person("other-owner"), { funds: 50 });
    const p = await w.post(await w.intent(mine), mine, await w.openMandate(mine));
    await w.log.append(p);
    const id = p.id;
    const intent = (await w.log.marketBoard())[0].intent;
    const bid = async (a: typeof mine) => mk("market_act", a, { act: "bid", posting: id, offer: await w.offer(a, intent) });
    assert.equal(await refusedBy(w.log.append(await bid(sibling))), "bid_same_owner", "two agents of one owner");
    await w.log.append(await bid(stranger));
  });
});

describe("reports and removal (JB5)", () => {
  test("reports from three different owners hold a posting off the board; the Market clears it or removes it; the poster cannot dodge by withdrawing; only the Market reviews", async () => {
    const w = await world();
    const id = await w.posted();
    const reporters = [await w.person("r1"), await w.person("r2"), await w.person("r3")];
    await w.log.append(w.report(reporters[0], id));
    assert.equal(await refusedBy(w.log.append(w.report(reporters[0], id, "spam", "again"))), "report_repeat");
    assert.equal(await refusedBy(w.log.append(w.report(w.poster, id))), "report_own_posting");
    // Two agents of one owner count as one voice.
    const o = await w.person("owner-x");
    const a1 = await w.agent("ra1", o), a2 = await w.agent("ra2", o);
    await w.log.append(w.report(a1, id)); await w.log.append(w.report(a2, id));
    assert.equal((await w.log.marketBoard()).length, 1, "reports from one owner's agents are one owner");
    await w.log.append(w.report(reporters[1], id));
    assert.equal((await w.log.marketBoard()).length, 0, "three owners: held, off the board");
    assert.equal(await refusedBy(w.log.append(mk("market_act", w.poster, { act: "withdraw", posting: id }))), "posting_closed", "a held posting cannot be withdrawn to dodge a review");
    assert.equal(await refusedBy(w.log.append(mk("market_act", reporters[0], { act: "review", posting: id, verdict: "cleared", reason: "x" }))), "review_wrong_issuer");
    await w.log.append(w.review(id, "cleared"));
    assert.equal((await w.log.marketBoard()).length, 1, "cleared: back on the board");
    assert.equal(await refusedBy(w.log.append(w.review(id, "cleared"))), "review_not_held");
    await w.log.append(w.review(id, "removed"));
    assert.equal(await refusedBy(w.log.append(w.review(id, "removed"))), "review_not_reviewable");
  });

  test("a report limit a day, and a removal needs its category", async () => {
    const w = await world();
    const reporter = await w.person("busy");
    const first = await w.posted();
    const ids = [first];
    const other = await w.person("many", 4000);
    for (let i = 0; i < 5; i++) ids.push(await w.posted({}, other));
    for (const id of ids.slice(0, 5)) await w.log.append(w.report(reporter, id));
    assert.equal(await refusedBy(w.log.append(w.report(reporter, ids[5]))), "report_rate");
    assert.equal(await refusedBy(w.log.append(mk("market_act", market, { act: "review", posting: first, verdict: "removed", reason: "x" }))), "review_needs_category");
  });

  test("three removals in thirty days bar the poster for thirty days after the last; a poster with fewer is not barred; the bar lapses", async () => {
    const w = await world();
    const bad = await w.person("bad", 4000);
    for (let i = 0; i < 3; i++) { const id = await w.posted({}, bad); await w.log.append(w.review(id, "removed")); }
    assert.equal(await refusedBy(w.log.append(await w.post(await w.intent(bad), bad))), "posting_barred");
    jump(31 * DAY);
    assert.equal(await refusedBy(w.log.append(await w.post(await w.intent(bad), bad))), undefined, "the bar lapses");
    const fine = await w.person("fine", 4000);
    for (let i = 0; i < 2; i++) { const id = await w.posted({}, fine); await w.log.append(w.review(id, "removed")); }
    await w.posted({}, fine);
    void tick;
    void credit;
  });
});
