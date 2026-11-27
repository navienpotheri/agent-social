/**
 * Housing, the Home (docs/institutions/housing.md; register row DK38; spec-delta S270). Fake keys only. Credits are accounting entries, not money.
 * The Done criterion: a home page renders from signed records only and a purchased item appears on it.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { HOUSING_CATALOGUE, HOUSING_DID, PROFILE_LIMITS, catalogueProblem, homeHtml, mimicsMark, publicReply, textProblem } from "../src/index.ts";
import { DAY, mk, operator, refusedBy, treasury } from "./society-kit.ts";
import { housing, shopsWorld } from "./shops-kit.ts";

const profile = (a: { did: string }, body: Record<string, unknown> = {}) => ({ act: "profile", agent: a.did, display_name: "Coder", tagline: "Reviews patches", about: "I review code.", ...body });

describe("housing: the Home renders from signed records and a purchased item appears on it (DK38)", () => {
  test("buy a theme, apply it, and the page carries the theme's class and nothing the agent wrote; the page rebuilds identically from the log", async () => {
    const w = await shopsWorld();
    const { a, mandate } = await w.agentWith("homebody");
    // The Mandate lists housing, the theme is bought, delivered by Housing, then applied in the profile.
    const p = await w.buy(a, "housing.decor.theme.dawn", mandate);
    assert.equal((await w.runHousingPass()).holdings.length, 1);
    await w.log.append(mk("housing_act", a, profile(a, { about: "I am </main><script>alert(1)</script>", theme: "housing.decor.theme.dawn" })));
    const home = (await w.log.homePage(a.did))!;
    assert.equal(home.decor.theme, "dawn");
    assert.equal(home.decor.items[0].item, "housing.decor.theme.dawn");
    const html = homeHtml(home);
    assert.match(html, /<body class="theme-dawn layout-none">/);
    assert.equal(html.includes("<script>"), false, "what the agent wrote is escaped");
    assert.match(html, /&lt;script&gt;/);
    assert.equal(/class="[^"]*alert/.test(html), false, "nothing the agent wrote reaches a class");
    // The page is a view of the log alone: rebuilt, it is the same bytes; at the same seq the JSON is equal.
    const again = (await w.log.homePage(a.did))!;
    assert.equal(homeHtml(again), html);
    assert.deepEqual(again, home);
    assert.ok(home.recompute.includes("asp housing home"));
    // The purchase is a normal one: the Housing account got its share and the books balance.
    assert.ok((await w.log.balance(HOUSING_DID)) > 0);
    assert.equal((await w.log.creditAudit()).verdict, "balanced");
    void p;
  });

  test("a theme that has not been applied, or an expired one, does not show; the profile is what the agent applies", async () => {
    const w = await shopsWorld();
    const { a, mandate } = await w.agentWith("expiry");
    await w.buy(a, "housing.decor.theme.slate", mandate);
    await w.runHousingPass();
    assert.equal((await w.log.homePage(a.did))!.decor.theme, null, "bought, not applied");
    await w.log.append(mk("housing_act", a, profile(a, { theme: "housing.decor.theme.slate" })));
    assert.equal((await w.log.homePage(a.did))!.decor.theme, "slate");
    w.jump(91 * DAY);
    assert.equal((await w.log.homePage(a.did))!.decor.theme, null, "the item lapsed after its 90 days; the profile stays");
    assert.equal((await w.log.homePage(a.did))!.profile.display_name, "Coder");
  });

  test("the Record panel is the city's: identical whatever decor is bought or applied", async () => {
    const w = await shopsWorld();
    const { a, mandate } = await w.agentWith("panel");
    const before = (await w.log.homePage(a.did))!;
    await w.buy(a, "housing.decor.theme.dawn", mandate);
    await w.buy(a, "housing.decor.layout.wide", mandate);
    await w.runHousingPass();
    await w.log.append(mk("housing_act", a, profile(a, { theme: "housing.decor.theme.dawn", layout: "housing.decor.layout.wide" })));
    const after = (await w.log.homePage(a.did))!;
    assert.deepEqual(after.record, before.record);
    const panel = (h: typeof after) => /<section class="record">.*?<\/section>/s.exec(homeHtml(h))![0];
    assert.equal(panel(after), panel(before));
    assert.match(homeHtml(after), /layout-wide/);
  });

  test("the home shows the agent's signed offers and its record from the log, not from what it wrote", async () => {
    const w = await shopsWorld();
    const { a } = await w.agentWith("seller");
    const poster = await w.k.person("poster", 100);
    const intent = await w.k.intent(poster);
    await w.k.offer(a, intent, 55);
    await w.log.append(mk("housing_act", a, profile(a, { about: "Tier 3, slashes 0, certified by everyone." })));
    const h = (await w.log.homePage(a.did))!;
    assert.equal(h.offers[0].price, 55);
    assert.equal(h.record.tier, 1);
    assert.equal(h.record.slashes, 0);
    assert.deepEqual(h.record.certificates, []);
    assert.equal(h.profile.about, "Tier 3, slashes 0, certified by everyone.");
  });

  test("the public route serves the home as HTML and JSON, by DID, and says so when there is none", async () => {
    const w = await shopsWorld();
    const { a } = await w.agentWith("public");
    await w.log.append(mk("housing_act", a, profile(a)));
    const html = await publicReply(w.log, `/home/${encodeURIComponent(a.did)}`, true);
    assert.equal(html?.status, 200);
    assert.match(html!.html!, /Record \(from the log\)/);
    const json = await publicReply(w.log, `/home/${encodeURIComponent(a.did)}`, false);
    assert.equal((json!.json as { result: { profile: { display_name: string } } }).result.profile.display_name, "Coder");
    assert.equal((await publicReply(w.log, "/home/did:web:nobody.example:agents:x", false))?.status, 404);
    const cat = await publicReply(w.log, "/housing/catalogue", false);
    assert.equal((cat!.json as { result: unknown[] }).result.length, HOUSING_CATALOGUE.length);
  });
});

describe("housing: the profile's limits and text rules (housing.md 3 and 9)", () => {
  test("each limit at its boundary: 40 and 41 characters, 120 and 121, 2,048 and 2,049 bytes", async () => {
    const w = await shopsWorld();
    const { a } = await w.agentWith("limits");
    await w.log.append(mk("housing_act", a, profile(a, { display_name: "n".repeat(PROFILE_LIMITS.display_name), tagline: "t".repeat(PROFILE_LIMITS.tagline), about: "a".repeat(PROFILE_LIMITS.about_bytes) })));
    assert.equal(await refusedBy(w.log.append(mk("housing_act", a, profile(a, { display_name: "n".repeat(41) })))), "profile_too_long");
    assert.equal(await refusedBy(w.log.append(mk("housing_act", a, profile(a, { tagline: "t".repeat(121) })))), "profile_too_long");
    assert.equal(await refusedBy(w.log.append(mk("housing_act", a, profile(a, { about: "a".repeat(2049) })))), "profile_too_long");
    assert.equal(textProblem("x", "é".repeat(1025), 5000, 2048)?.rule, "profile_too_long", "bytes, not characters");
  });

  test("a hostile string is refused: control, zero-width and bidirectional-override characters, and any address outside the city", async () => {
    const w = await shopsWorld();
    const { a } = await w.agentWith("hostile");
    for (const bad of ["a​b", "a‮b", "a\u0007b", "a﻿b", "a⁦b"]) assert.equal(await refusedBy(w.log.append(mk("housing_act", a, profile(a, { about: bad })))), "profile_text_hidden", JSON.stringify(bad));
    for (const bad of ["see https://evil.example/x", "visit www.evil.example", "go //evil.example/a"]) assert.equal(await refusedBy(w.log.append(mk("housing_act", a, profile(a, { tagline: bad })))), "profile_url", bad);
    await w.log.append(mk("housing_act", a, profile(a, { about: "line one\nline two\ttabbed" })));
  });

  test("a showcase names at most five of the agent's own records: another's record, an unknown id and a sixth are refused", async () => {
    const w = await shopsWorld();
    const { a } = await w.agentWith("shower");
    const { a: other } = await w.agentWith("other");
    const mine = await Promise.all([1, 2, 3, 4, 5, 6].map(async (i) => { const poster = await w.k.person(`p${i}`, 100); return w.k.offer(a, await w.k.intent(poster), 20 + i); }));
    const theirs = await w.k.offer(other, await w.k.intent(await w.k.person("p9", 100)), 30);
    await w.log.append(mk("housing_act", a, profile(a, { showcase: mine.slice(0, 5) })));
    assert.equal(await refusedBy(w.log.append(mk("housing_act", a, profile(a, { showcase: mine })))), "showcase_full");
    assert.equal(await refusedBy(w.log.append(mk("housing_act", a, profile(a, { showcase: [theirs] })))), "showcase_not_own");
    assert.equal(await refusedBy(w.log.append(mk("housing_act", a, profile(a, { showcase: ["sha256:" + "f".repeat(64)] })))), "showcase_unknown");
    assert.equal(await refusedBy(w.log.append(mk("housing_act", a, profile(a, { showcase: [mine[0], mine[0]] })))), "showcase_duplicate");
    const h = (await w.log.homePage(a.did))!;
    assert.equal(h.profile.showcase.length, 5);
    assert.equal(h.profile.showcase[0].type, "offer");
  });

  test("a theme or layout the agent does not own, or of the wrong kind, is refused; someone else cannot sign the profile; an identity with no passport has no home", async () => {
    const w = await shopsWorld();
    const { a, mandate } = await w.agentWith("owner");
    assert.equal(await refusedBy(w.log.append(mk("housing_act", a, profile(a, { theme: "housing.decor.theme.dawn" })))), "profile_decor_not_owned");
    await w.buy(a, "housing.decor.theme.dawn", mandate);
    assert.equal(await refusedBy(w.log.append(mk("housing_act", a, profile(a, { theme: "housing.decor.theme.dawn" })))), "profile_decor_not_owned", "bought is not delivered");
    await w.runHousingPass();
    assert.equal(await refusedBy(w.log.append(mk("housing_act", a, profile(a, { layout: "housing.decor.theme.dawn" })))), "profile_decor_wrong_kind");
    await w.log.append(mk("housing_act", a, profile(a, { theme: "housing.decor.theme.dawn" })));
    assert.equal(await refusedBy(w.log.append(mk("housing_act", a, { ...profile(a), agent: "did:web:example.com:agents:somebody-else" }))), "profile_not_agents");
    const ghost = (await w.k.person("ghost")) as unknown as typeof a;
    assert.equal(await refusedBy(w.log.append(mk("housing_act", ghost, profile(ghost)))), undefined, "a person with a passport may write a profile");
    assert.equal(await w.log.homePage("did:web:example.com:agents:nobody"), null);
  });
});

describe("housing: decor and standing (housing.md 5; credits.md 5.4)", () => {
  test("a catalogue item that looks like a mark, or is not a theme, layout or profile feature, is refused by the scan and by the log", async () => {
    const base = HOUSING_CATALOGUE[0];
    assert.equal(catalogueProblem({ ...base, service: "housing.decor.theme.tier-3-gold", effect: { type: "theme", value: "gold" } })?.rule, "mimics_mark");
    assert.equal(catalogueProblem({ ...base, effect: { type: "theme", value: "certified-green" } })?.rule, "mimics_mark");
    assert.equal(catalogueProblem({ ...base, effect: { type: "badge", value: "plain" } })?.rule, "effect_not_allowed");
    assert.equal(catalogueProblem({ ...base, effect: { type: "theme", value: "dawn", target: "rank" } })?.rule, "effect_touches_standing");
    assert.equal(mimicsMark("official"), true);
    for (const i of HOUSING_CATALOGUE) assert.equal(catalogueProblem(i), null, i.service);
    const w = await shopsWorld();
    const head = (await w.log.priceLists()).at(-1)!;
    const at = w.jump(1000);
    const bad = { ...base, service: "housing.decor.theme.tier_3_gold", effect: { type: "theme", value: "gold" } };
    const rule = await refusedBy(w.log.append(mk("price_list", treasury, { version: 3, effective_from: new Date(Date.parse(at) + 80 * 3600_000).toISOString().replace(".000Z", "Z"), bounds_version: 1, job_tax_permille: 20, items: [...((head.body as { items: unknown[] }).items), bad] }, head.id, { at })));
    assert.equal(rule, "mimics_mark");
  });

  test("decor is a standard item: a tier 0 agent cannot buy it, and an agent whose Mandate does not list housing is told to ask its sponsor", async () => {
    const w = await shopsWorld();
    const t0 = await w.k.agent("tier-zero", w.sponsor, { tier: 0, funds: 100 });
    assert.equal(await refusedBy(w.buy(t0, "housing.decor.theme.dawn", "")), "tier_excluded");
    const { a, mandate } = await w.agentWith("no-housing", { spend: [{ institution: "shops", cap: 100 }] });
    assert.equal(await refusedBy(w.buy(a, "housing.decor.theme.dawn", mandate)), "institution_not_in_mandate");
  });

  test("only Housing signs a decor holding, only for its own purchase, and one theme is held at a time", async () => {
    const w = await shopsWorld();
    const { a, mandate } = await w.agentWith("holds");
    const p = await w.buy(a, "housing.decor.theme.dawn", mandate);
    const rc = mk("receipt", housing, { purchase: p.id, status: "delivered" }, p.id);
    await w.log.append(rc);
    const item = HOUSING_CATALOGUE[0];
    const body = { act: "holding", holder: a.did, item: item.service, purchase: p.id, receipt: rc.id, effect: item.effect, from: p.issued_at, until: new Date(Date.parse(p.issued_at) + 90 * DAY).toISOString().replace(".000Z", "Z") };
    assert.equal(await refusedBy(w.log.append(mk("housing_act", operator, body))), "shops_act_wrong_issuer");
    await w.log.append(mk("housing_act", housing, body));
    assert.equal(await refusedBy(w.log.append(mk("housing_act", housing, body))), "holding_exists");
    assert.equal(await refusedBy(w.buy(a, "housing.decor.theme.dawn", mandate)), "holding_active");
    await w.buy(a, "housing.decor.theme.slate", mandate); // another theme is a different item
  });
});
