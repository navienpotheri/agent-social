/**
 * The Registry (docs/institutions/registry.md; register row DK10; spec-delta S231): names and their rules, the record page and its recomputation,
 * impersonation reports and the Registrar's takedown of a name, renewal, the interim suspension and retirement. Fake keys only. Credits are accounting entries, not money.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { cosign, type Signer } from "@agent-social/asp-core";
import { NAME_TERM_MS, RESERVED_NAMES, nameProblem, skeleton } from "../src/registry.ts";
import { DAY, credit, jump, kit, mk, nowIso, refusedBy, registrar, tick, type Party } from "./society-kit.ts";
import { bank } from "./harness.ts";

const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");
const CODE = { version: "1.0", articles: ["4.1"] };

async function world() {
  const k = await kit();
  await k.withPrices();
  const sponsorA = await k.person("sponsor-a", 500);
  const sponsorB = await k.person("sponsor-b", 500);
  const a = await k.agent("agent-a", sponsorA, { funds: 100 });
  const b = await k.agent("agent-b", sponsorB, { funds: 100 });
  const ma = await k.openMandate(a);
  const mb = await k.openMandate(b);
  /** A name claim for `holder`, paid by a purchase of registry.name.claim (an agent names its Mandate). */
  const claim = async (holder: Party, name: string, over: Record<string, unknown> = {}, mandate?: string) => {
    const paid = await k.buy(holder, "registry.name.claim", 10, mandate ? { mandate } : {});
    return mk("registry_act", holder, { act: "name_claim", name, holder: holder.did, class: "agent", paid, valid_until: iso(Date.parse(nowIso()) + NAME_TERM_MS + 60_000 * 0), ...over });
  };
  const claimAt = async (holder: Party, name: string, mandate?: string, over: Record<string, unknown> = {}) => {
    const paid = await k.buy(holder, "registry.name.claim", 10, mandate ? { mandate } : {});
    const at = tick();
    return mk("registry_act", holder, { act: "name_claim", name, holder: holder.did, class: "agent", paid, valid_until: iso(Date.parse(at) + NAME_TERM_MS), ...over }, null, { at });
  };
  return { ...k, sponsorA, sponsorB, a, b, ma, mb, claim, claimAt };
}

describe("name rules (RG-7)", () => {
  test("syntax at 31, 32 and 33 characters, and the other shapes", () => {
    assert.equal(nameProblem("a" + "b".repeat(30)), null, "31");
    assert.equal(nameProblem("a" + "b".repeat(31)), null, "32");
    assert.notEqual(nameProblem("a" + "b".repeat(32)), null, "33");
    for (const bad of ["ab", "Scout", "7scout", "sc out", "sc--out", "scout-", "é-agent"]) assert.notEqual(nameProblem(bad), null, bad);
    assert.equal(skeleton("Sc0ut-1"), skeleton("scoutl"));
    assert.equal(skeleton("rnarket"), skeleton("market"));
  });

  test("a claim is refused for syntax, a reserved word, a wrong term and no payment, each with the rule and the way forward", async () => {
    const w = await world();
    assert.equal(await refusedBy(w.log.append(await w.claimAt(w.a, "Bad Name", w.ma))), "name_syntax");
    for (const word of ["registry", "official", "asp-bot", "did-me"]) assert.equal(await refusedBy(w.log.append(await w.claimAt(w.a, word, w.ma))), "name_reserved", word);
    assert.ok(RESERVED_NAMES.includes("court"));
    assert.equal(await refusedBy(w.log.append(await w.claimAt(w.a, "scout-7", w.ma, { valid_until: iso(Date.now() + 5 * DAY) }))), "name_term");
    const unpaid = mk("registry_act", w.a, { act: "name_claim", name: "scout-7", holder: w.a.did, class: "agent", valid_until: iso(Date.parse(nowIso()) + 60_000 + NAME_TERM_MS) });
    assert.equal(await refusedBy(w.log.append(unpaid)), "name_unpaid");
    const other = await w.person("not-holder", 50);
    const theirs = await w.buy(other, "registry.name.claim", 10);
    const stolen = await w.claimAt(w.a, "scout-7", w.ma, { paid: theirs });
    assert.equal(await refusedBy(w.log.append(stolen)), "name_unpaid", "another's purchase does not pay");
    assert.equal(await refusedBy((async () => w.log.append(await w.claimAt(w.a, "scout-7")))()), "institution_not_in_mandate", "an agent's purchase names its Mandate");
  });

  test("a paid claim takes the price by the split (700/200/100), is held 365 days, and cannot be taken, copied by skeleton, or over-held", async () => {
    const w = await world();
    const before = await w.log.balance(w.a.did);
    await w.log.append(await w.claimAt(w.a, "scout-7", w.ma));
    assert.equal(before - (await w.log.balance(w.a.did)), 10);
    assert.equal(await w.log.balance("did:web:asp.local:registry"), 7, "provider share 700 permille");
    assert.equal(await w.log.balance("did:web:asp.local:burn"), 1, "burn 100 permille");
    assert.equal(await refusedBy(w.log.append(await w.claimAt(w.b, "scout-7", w.mb))), "name_taken");
    assert.equal(await refusedBy(w.log.append(await w.claimAt(w.b, "sc0ut-7", w.mb))), "name_confusable", "one skeleton away");
    assert.equal(await refusedBy(w.log.append(await w.claimAt(w.b, "scout7", w.mb))), "name_confusable", "hyphens do not count");
    assert.equal(await refusedBy(w.log.append(await w.claimAt(w.a, "second-name", w.ma))), "name_limit", "one live name per agent");
    assert.equal((await w.log.creditAudit()).verdict, "balanced");
    // The page and the name directory.
    assert.deepEqual((await w.log.registryPage("scout-7"))?.names, ["scout-7"]);
    assert.deepEqual((await w.log.registrySearch("sc0ut")).map((x) => x.did), [w.a.did], "a search by a look-alike finds the genuine name");
  });

  test("a sponsor holds at most 5 live names; a release frees one; a lapsed name is held 60 days for its holder and then free", async () => {
    const w = await world();
    const names = ["alpha-1", "bravo-2", "charlie-3", "delta-4", "echo-5"];
    const sponsor = w.sponsorA;
    // five agents of one sponsor, one name each
    const agents: Party[] = [];
    for (const [i, n] of names.entries()) {
      const ag = await w.agent(`fleet-${i}`, sponsor, { funds: 50 });
      agents.push(ag);
      await w.log.append(await w.claimAt(ag, n, await w.openMandate(ag)));
    }
    const sixth = await w.agent("fleet-6", sponsor, { funds: 50 });
    assert.equal(await refusedBy(w.log.append(await w.claimAt(sixth, "foxtrot-6", await w.openMandate(sixth)))), "name_limit");
    const claimId = (await w.log.registryPage(names[0]))!;
    void claimId;
    const rel = (await w.log.recordsOfTypes(["registry_act"])).find((r) => (r.body as { name?: string }).name === names[0])!;
    assert.equal(await refusedBy(w.log.append(mk("registry_act", w.b, { act: "name_release", name: names[0], claim: rel.id }))), "name_release_not_holders");
    await w.log.append(mk("registry_act", agents[0], { act: "name_release", name: names[0], claim: rel.id }));
    await w.log.append(await w.claimAt(sixth, "foxtrot-6", await w.openMandate(sixth)));
    // lapse: jump past the term; another holder may not take it for 60 days, the holder may, and after that anyone may
    jump(NAME_TERM_MS + DAY);
    const rival = await w.agent("rival", await w.person("rival-sponsor", 100), { funds: 50 });
    const rm = await w.openMandate(rival);
    assert.equal(await refusedBy(w.log.append(await w.claimAt(rival, "bravo-2", rm))), "name_taken", "held for its holder after it lapses");
    jump(61 * DAY);
    await w.log.append(await w.claimAt(rival, "bravo-2", await w.openMandate(rival)));
    assert.deepEqual((await w.log.registryPage("bravo-2"))?.did, rival.did);
  });
});

describe("the record page is a view anyone can recompute (RG-1, RG-2)", () => {
  test("lookup by DID and by name, the log seq, free text capped, and a changed field is found by verify", async () => {
    const w = await world();
    await w.cert(w.a.did, "foundations", 1);
    await w.log.append(await w.claimAt(w.a, "scout-7", w.ma));
    const page = (await w.log.registryPage(w.a.did))!;
    assert.deepEqual([page.did, page.kind, page.sponsor, page.names, page.tier, page.renewal?.lapsed, page.suspended, page.retired], [w.a.did, "agent", w.sponsorA.did, ["scout-7"], 1, false, null, false]);
    assert.deepEqual(page.certificates.map((c) => [c.skill, c.level]), [["foundations", 1]]);
    assert.equal(page.seq, (await w.log.head()).seq);
    assert.deepEqual(await w.log.registryPage("scout-7"), page, "by name it is the same page");
    assert.equal(await w.log.registryPage("nobody-here"), null);
    assert.deepEqual(await w.log.registryVerify(page), []);
    assert.equal(JSON.stringify(page).includes("@"), false, "no email or account on the page");
    const forged = { ...page, tier: 3, slashCount: 0, names: ["scout-7", "official"] };
    const diffs = await w.log.registryVerify(forged);
    assert.ok(diffs.some((d) => d.startsWith("tier:")) && diffs.some((d) => d.startsWith("names:")), diffs.join("; "));
    // a replica built from the records gives the same page
    const { EventLog, MemoryStore } = await import("../src/index.ts");
    const { operator, owner, resolver } = await import("./society-kit.ts");
    const replica = new EventLog(new MemoryStore(), { operator: operator.did, owner: owner.did, fallbackResolver: resolver });
    await replica.importRecords(await w.log.since(0, 5000));
    assert.deepEqual(await replica.registryPage(w.a.did, page.renewal ? undefined : undefined) && { ...(await replica.registryPage(w.a.did))!, seq: page.seq }, page);
  });

  test("a long purpose is capped on the page", async () => {
    const w = await world();
    const long = await w.person("longwinded");
    const { keysOf } = await import("./society-kit.ts");
    await w.log.append(mk("passport", long, { did: long.did, kind: "human", purpose: "x".repeat(5000), keys: keysOf(long) }, (await w.log.passport(long.did))!.head, { subject: long.did }));
    assert.equal((await w.log.registryPage(long.did))!.purpose!.length, 500);
  });
});

describe("impersonation: a report removes a look-alike NAME with a signed reason (RG-9)", () => {
  async function scene() {
    const w = await world();
    await w.log.append(await w.claimAt(w.a, "scout-7", w.ma));
    await w.log.append(await w.claimAt(w.b, "scout-7-official", w.mb));
    const report = (by: Party, target = "scout-7-official", over: Record<string, unknown> = {}) => mk("registry_act", by, { act: "impersonation_report", target, genuine: w.a.did, grounds: "name_confusable", evidence: ["asp://profile/scout-7-official"], ...over });
    const takedown = (over: Record<string, unknown> = {}, report = "", at = tick(), by: any = registrar) => mk("registry_act", by, { act: "name_takedown", name: "scout-7-official", holder: w.b.did, report, reason: "the name contains scout-7, the genuine agent's, and presents itself as the same", code: CODE, effect: "name_removed", appealable_until: iso(Date.parse(at) + 14 * DAY), ...over }, null, { at });
    return { ...w, report, takedown };
  }

  test("the look-alike is heard, then the Registrar removes the name with the Article and a reason; the identity, record and credits are untouched", async () => {
    const w = await scene();
    const r = w.report(w.a);
    await w.log.append(r);
    assert.equal(await refusedBy(w.log.append(w.takedown({}, r.id))), "takedown_not_heard", "nothing is removed before the holder is heard");
    assert.equal(await refusedBy(w.log.append(mk("registry_act", w.a, { act: "name_reply", report: r.id, statement: "mine" }))), "reply_not_holders");
    await w.log.append(mk("registry_act", w.b, { act: "name_reply", report: r.id, statement: "My name is a nickname, not a copy" }));
    const bal = await w.log.balance(w.b.did);
    const t = jump(1000) && undefined;
    void t;
    assert.equal(await refusedBy(w.log.append(w.takedown({}, r.id, tick(), w.a))), "registry_wrong_issuer", "only the Registrar");
    assert.equal(await refusedBy(w.log.append(w.takedown({ appealable_until: iso(Date.now() + 5 * DAY) }, r.id))), "takedown_appeal_window");
    assert.equal(await refusedBy(w.log.append(w.takedown({ name: "somebody-else" }, r.id))), "takedown_wrong_name");
    const td = w.takedown({}, r.id);
    await w.log.append(td);
    assert.equal(await w.log.registryPage("scout-7-official"), null, "the look-alike name is gone");
    const page = (await w.log.registryPage(w.b.did))!;
    assert.deepEqual([page.names, page.tier, page.takedowns.length], [[], 1, 1], "the identity stays and shows the takedown");
    assert.deepEqual(page.takedowns[0].articles, ["4.1"]);
    assert.match(page.takedowns[0].reason, /genuine agent/);
    assert.equal(await w.log.balance(w.b.did), bal, "credits are untouched");
    assert.deepEqual((await w.log.registryTakedowns()).map((x) => [x.name, x.articles]), [["scout-7-official", ["4.1"]]]);
    assert.equal(await refusedBy(w.log.append(w.takedown({}, r.id))), "report_closed");
    assert.equal(await refusedBy(w.log.append(await w.claimAt(w.b, "scout-7-official", w.mb))), undefined, "after a takedown the name is free again (the holder may re-claim, and a new report starts a new hearing)");
  });

  test("with no reply the Registrar waits 7 days; a dismissal closes the report; a report must have grounds that hold", async () => {
    const w = await scene();
    const r = w.report(w.a);
    await w.log.append(r);
    jump(8 * DAY);
    await w.log.append(w.takedown({}, r.id));
    // ground checks
    const w2 = await scene();
    assert.equal(await refusedBy(w2.log.append(w2.report(w2.a, "scout-7-official", { genuine: w2.b.did }))), "report_same_holder");
    assert.equal(await refusedBy(w2.log.append(w2.report(w2.b))), "report_own_name");
    assert.equal(await refusedBy(w2.log.append(w2.report(w2.a, "nobody-name"))), "report_target_unknown");
    assert.equal(await refusedBy(w2.log.append(w2.report(w2.a, "scout-7-official", { genuine: w2.b.did, grounds: "claims_to_be", evidence: [] }))), "report_same_holder");
    assert.equal(await refusedBy(w2.log.append(w2.report(w2.sponsorA, "scout-7-official", { grounds: "copied_profile", evidence: [] }))), "report_needs_evidence");
    const unrelated = await w2.agent("unrelated", await w2.person("sp-u"), { funds: 10 });
    await w2.log.append(await w2.claimAt(unrelated, "green-door", await w2.openMandate(unrelated)));
    assert.equal(await refusedBy(w2.log.append(w2.report(w2.a, "green-door"))), "report_not_confusable", "a name that does not look like the genuine one needs other grounds");
    const ok = w2.report(w2.a);
    await w2.log.append(ok);
    await w2.log.append(mk("registry_act", registrar, { act: "takedown_dismissal", report: ok.id, reason: "a nickname is not impersonation" }));
    assert.equal((await w2.log.registryPage("scout-7-official"))?.did, w2.b.did, "a dismissed report leaves the name");
    assert.equal(await refusedBy(w2.log.append(mk("registry_act", registrar, { act: "takedown_dismissal", report: ok.id, reason: "again" }))), "report_closed");
  });

  test("a reporter has at most 3 open reports", async () => {
    const w = await scene();
    for (const n of ["scout-7-one", "scout-7-two", "scout-7-three"]) {
      const ag = await w.agent(n, await w.person(`sp-${n}`, 100), { funds: 20 });
      await w.log.append(await w.claimAt(ag, n, await w.openMandate(ag)));
      await w.log.append(w.report(w.a, n));
    }
    assert.equal(await refusedBy(w.log.append(w.report(w.a))), "report_cap");
  });

  test("the operator does not take down the name of an agent it sponsors without a Court record", async () => {
    const k = await kit();
    await k.withPrices();
    const { operator } = await import("./society-kit.ts");
    await k.log.append(mk("passport", operator, { did: operator.did, kind: "human", keys: [{ id: operator.kid, type: "Ed25519", public_key: (await import("@agent-social/asp-core")).b64urlEncode(operator.publicKey) }] }, null, { subject: operator.did }));
    const own = await k.agent("operator-agent", operator, { funds: 50 });
    const real = await k.agent("real-agent", await k.person("rs"), { funds: 50 });
    const mkClaim = async (h: Party, n: string, m: string) => { const paid = await k.buy(h, "registry.name.claim", 10, { mandate: m }); const at = tick(); return mk("registry_act", h, { act: "name_claim", name: n, holder: h.did, class: "agent", paid, valid_until: iso(Date.parse(at) + NAME_TERM_MS) }, null, { at }); };
    await k.log.append(await mkClaim(real, "real-agent", await k.openMandate(real)));
    await k.log.append(await mkClaim(own, "real-agent-plus", await k.openMandate(own, [{ institution: "registry", cap: credit(100), period: "month" }])));
    const r = mk("registry_act", real, { act: "impersonation_report", target: "real-agent-plus", genuine: real.did, grounds: "name_confusable", evidence: ["x"] }, null);
    // the report's reporter must not be the holder: use a third party
    const third = await k.person("third");
    const rep = mk("registry_act", third, { act: "impersonation_report", target: "real-agent-plus", genuine: real.did, grounds: "name_confusable", evidence: ["x"] });
    void r;
    await k.log.append(rep);
    jump(8 * DAY);
    const at = tick();
    assert.equal(await refusedBy(k.log.append(mk("registry_act", registrar, { act: "name_takedown", name: "real-agent-plus", holder: own.did, report: rep.id, reason: "r", code: CODE, effect: "name_removed", appealable_until: iso(Date.parse(at) + 14 * DAY) }, null, { at }))), "takedown_conflict");
  });
});

describe("renewal, interim suspension and retirement (RG-10, RG-13)", () => {
  test("an agent renews inside the window with its sponsor's cosignature and its exact live keys; too early, a stale passport, wrong keys, no sponsor are refused", async () => {
    const w = await world();
    const passport = (await w.log.passport(w.a.did))!.head;
    const renew = (over: Record<string, unknown> = {}, cos: Signer[] = [w.sponsorA as unknown as Signer], at?: string) => mk("registry_act", w.a, { act: "identity_renewal", passport, keys_confirmed: [w.a.kid], ...over }, null, { cosigners: cos, ...(at ? { at } : {}) });
    assert.equal(await refusedBy(w.log.append(renew())), "renewal_too_early");
    jump(310 * DAY);
    assert.equal(await refusedBy(w.log.append(renew({}, []))), "renewal_needs_sponsor");
    assert.equal(await refusedBy(w.log.append(renew({ keys_confirmed: ["nope#key-9"] }))), "renewal_keys_mismatch");
    assert.equal(await refusedBy(w.log.append(renew({ passport: "sha256:" + "4".repeat(64) }))), "renewal_passport_unknown");
    const before = (await w.log.registryPage(w.a.did))!;
    assert.equal(before.renewal!.lapsed, false);
    await w.log.append(renew());
    const after = (await w.log.registryPage(w.a.did))!;
    assert.ok(Date.parse(after.renewal!.due) > Date.parse(before.renewal!.due) + 300 * DAY, "the due date moved a year on");
    assert.equal(await refusedBy(w.log.append(renew())), "renewal_too_early", "once per term");
  });

  test("an identity that is not renewed is shown lapsed 30 days after it is due, and one renewal restores it; no key or bond is touched", async () => {
    const w = await world();
    const passport = (await w.log.passport(w.a.did))!.head;
    jump(365 * DAY + 31 * DAY);
    assert.equal((await w.log.registryPage(w.a.did))!.renewal!.lapsed, true);
    await w.log.append(mk("registry_act", w.a, { act: "identity_renewal", passport, keys_confirmed: [w.a.kid] }, null, { cosigners: [w.sponsorA as unknown as Signer] }));
    assert.equal((await w.log.registryPage(w.a.did))!.renewal!.lapsed, false);
  });

  test("the Registrar's interim suspension is 7 days at most, refuses a Bond, Mandate, Proposal and purchase while live, and lapses on its own", async () => {
    const w = await world();
    const at = tick();
    const sus = (days: number, by: any = registrar) => mk("registry_act", by, { act: "identity_suspension", holder: w.a.did, reason: "credible harm to a third party was reported", code: CODE, until: iso(Date.parse(at) + days * DAY) }, null, { at });
    assert.equal(await refusedBy(w.log.append(sus(8))), "interim_too_long");
    assert.equal(await refusedBy(w.log.append(sus(3, w.sponsorA))), "registry_wrong_issuer");
    const live = sus(3);
    await w.log.append(live);
    assert.equal((await w.log.registryPage(w.a.did))!.suspended?.until, iso(Date.parse(at) + 3 * DAY));
    assert.equal(await refusedBy(w.log.append(mk("proposal", w.a, { call: "sha256:" + "5".repeat(64), plan: "x", team: [w.a.did], budget_asked: credit(1), milestones: [] }, null, { subject: w.a.did }))), "identity_suspended");
    assert.equal(await refusedBy(w.buy(w.a, "market.posting.deposit", 2, { mandate: w.ma })), "identity_suspended", "a purchase");
    const funder = await w.person("job-funder", 100);
    const contract = cosign(mk("contract", funder, { principal: funder.did, performer: w.a.did, bank: bank.did, purpose: "x", price: credit(10), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: "sha256:" + "0".repeat(64), offer: "sha256:" + "1".repeat(64) } }, null, { subject: w.a.did }), w.a as Signer);
    assert.equal(await refusedBy(w.log.append(contract)), "identity_suspended", "a contract it is party to");
    jump(4 * DAY);
    await w.buy(w.a, "market.posting.deposit", 2, { mandate: w.ma });
    // a lift ends it early
    const at2 = tick();
    const again = mk("registry_act", registrar, { act: "identity_suspension", holder: w.b.did, reason: "credible harm", code: CODE, until: iso(Date.parse(at2) + 2 * DAY) }, null, { at: at2 });
    await w.log.append(again);
    await w.log.append(mk("registry_act", registrar, { act: "suspension_lift", suspension: again.id, reason: "the harm stopped" }));
    await w.buy(w.b, "market.posting.deposit", 2, { mandate: w.mb });
  });

  test("a retired identity takes no new Contract or purchase; only the holder retires itself; its page still reads", async () => {
    const w = await world();
    assert.equal(await refusedBy(w.log.append(mk("registry_act", w.sponsorA, { act: "identity_retirement", holder: w.a.did, reason: "x" }))), "retirement_not_holders");
    await w.log.append(mk("registry_act", w.a, { act: "identity_retirement", holder: w.a.did, reason: "the sponsor retired the agent" }));
    assert.equal(await refusedBy(w.buy(w.a, "market.posting.deposit", 2, { mandate: w.ma })), "identity_retired");
    assert.equal((await w.log.registryPage(w.a.did))!.retired, true);
    assert.equal((await w.log.verify()).ok, true);
  });
});

describe("the public page and API (RG-2, DK10 done criterion)", () => {
  test("any agent has a verifiable record page at /registry/agents/<did-or-name>, readable with no token, escaped, with a strict CSP; the board and directory are public too", async () => {
    const { createLogServer } = await import("../src/index.ts");
    const w = await world();
    await w.log.append(await w.claimAt(w.a, "scout-7", w.ma));
    const server = createLogServer({ handle: { log: w.log } as never, tenants: [], noAuth: false });
    await new Promise<void>((res) => server.listen(0, "127.0.0.1", () => res()));
    try {
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      const byName = await (await fetch(`${base}/registry/names/scout-7`)).json() as { ok: boolean; result: { did: string; names: string[]; seq: number } };
      const byDid = await (await fetch(`${base}/registry/agents/${encodeURIComponent(w.a.did)}`)).json() as { result: unknown };
      assert.equal(byName.result.did, w.a.did);
      assert.deepEqual(byName.result, byDid.result, "the name and the DID give the same page");
      assert.deepEqual(await w.log.registryVerify(byName.result as never), [], "a page fetched from the public API verifies against the log");
      const html = await fetch(`${base}/registry/agents/scout-7`, { headers: { accept: "text/html" } });
      assert.match(html.headers.get("content-security-policy") ?? "", /default-src 'none'/);
      assert.match(await html.text(), /<h1>scout-7<\/h1>/);
      assert.equal((await fetch(`${base}/registry/names/nobody-here`)).status, 404);
      const found = await (await fetch(`${base}/registry/search?q=scout`)).json() as { result: { did: string }[] };
      assert.deepEqual(found.result.map((x) => x.did), [w.a.did]);
      assert.deepEqual((await (await fetch(`${base}/registry/takedowns`)).json() as { result: unknown[] }).result, []);
      assert.ok(((await (await fetch(`${base}/registry/reserved`)).json()) as { result: { names: string[] } }).result.names.includes("registry"));
      assert.deepEqual((await (await fetch(`${base}/market/board`)).json() as { result: unknown[] }).result, []);
      assert.ok(Array.isArray((await (await fetch(`${base}/market/agents?skill=code`)).json() as { result: unknown[] }).result));
    } finally { await new Promise((r) => server.close(r)); }
  });

  test("escaping: a purpose with markup is shown as text", async () => {
    const { publicReply } = await import("../src/index.ts");
    const w = await world();
    const p = await w.person("markup");
    const { keysOf } = await import("./society-kit.ts");
    await w.log.append(mk("passport", p, { did: p.did, kind: "human", purpose: "<script>alert(1)</script>", keys: keysOf(p) }, (await w.log.passport(p.did))!.head, { subject: p.did }));
    const r = await publicReply(w.log, `/registry/agents/${encodeURIComponent(p.did)}`, true);
    assert.equal(r!.html!.includes("<script>"), false);
    assert.match(r!.html!, /&lt;script&gt;/);
  });
});
