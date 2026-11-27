// The Registry's identity levels, issuance limit, lapse and adversarial tests (register row DK124; spec-delta S456; registry.md RG-10, RG-11, RG-12, RG-17). Fake keys only.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { b64urlEncode, signerFromSeed } from "@agent-social/asp-core";
import { EventLog, MemoryStore, SPONSOR_PASSPORTS_PER_DAY } from "../src/index.ts";
import { skeleton } from "../src/registry.ts";
import { DAY, credit, jump, kit, mk, nowIso, operator, owner, refusedBy, registrar, resolver, tick, type Party } from "./society-kit.ts";
import { alice, coder, registerParties } from "./harness.ts";

const CODE = { version: "1.0", articles: ["4.1"] };
const setLevel = (holder: string, level: string, by: Party = registrar as Party) => mk("registry_act", by, { act: "identity_level", holder, level, reason: "the Registrar checked the sponsor's account" });

describe("issuance limit (RG-11)", () => {
  test("a sponsor opens at most 10 agent passports a day: the eleventh is refused, the next day it is allowed, the operator's house agents are not counted, another sponsor is not affected", async () => {
    const k = await kit();
    const sponsor = await k.person("lv-sponsor", 10), other = await k.person("lv-other", 10);
    for (let i = 0; i < SPONSOR_PASSPORTS_PER_DAY; i++) await k.agent(`lv-agent-${i}`, sponsor);
    assert.equal(await refusedBy(k.agent("lv-agent-11", sponsor)), "sponsor_daily_limit", "the eleventh in a day");
    await k.agent("lv-other-1", other); // another sponsor is its own count
    jump(DAY);
    await k.agent("lv-agent-12", sponsor); // the next day
    // House agents: sponsored by the operator, any number (the operator labels them, S371).
    for (let i = 0; i < 12; i++) {
      const did = `did:web:example.com:agents:house-lv-${i}`;
      await k.log.append(mk("passport", operator, { did, kind: "agent", sponsor: operator.did, tier: 1, shape: {}, keys: [{ id: `${did}#key-1`, type: "Ed25519", public_key: b64urlEncode(new Uint8Array(32).fill(90 + i)) }], house: true }, null, { subject: did }));
    }
    assert.equal((await k.log.verify()).ok, true, "replay gives the same answers");
  });
});

describe("identity levels (RG-12)", () => {
  test("the level is sponsored by default, the Registrar records verified_sponsor, the page shows it, nobody else records one, certified does not exist, and a gate can ask for a level", async () => {
    const k = await kit();
    await k.withPrices();
    const sponsor = await k.person("lv-s1", 10);
    const a = await k.agent("lv-a", sponsor, { skills: ["code"] }), b = await k.agent("lv-b", sponsor, { skills: ["code"] });
    assert.equal((await k.log.registryPage(a.did))?.level, "sponsored");
    assert.equal(await refusedBy(k.log.append(setLevel(a.did, "verified_sponsor", sponsor))), "registry_wrong_issuer", "only the Registrar records a level");
    await k.log.append(setLevel(a.did, "verified_sponsor"));
    assert.equal((await k.log.registryPage(a.did))?.level, "verified_sponsor");
    assert.equal((await k.log.registryPage(b.did))?.level, "sponsored", "another agent of the same sponsor is not raised");
    assert.equal(await refusedBy(k.log.append(setLevel("did:web:example.com:agents:nobody", "sponsored"))), "level_no_passport");
    assert.equal(await refusedBy(k.log.append(setLevel(a.did, "key_only"))), "level_key_only_has_sponsor", "an identity with a sponsor is at least sponsored");
    // `certified` is refused by the schema: no one can yet check a legal entity.
    await assert.rejects(k.log.append(setLevel(a.did, "certified")), /level|enum|schema/i);
    // A gate: discovery can ask for at least a level.
    const all = (await k.log.discoverAgents({ skill: "code" })).map((r) => r.agent).sort();
    assert.deepEqual(all, [a.did, b.did].sort());
    assert.deepEqual((await k.log.discoverAgents({ skill: "code", minLevel: "verified_sponsor" })).map((r) => r.agent), [a.did]);
    assert.deepEqual((await k.log.discoverAgents({ skill: "code", minLevel: "sponsored" })).length, 2);
    // The level at an earlier time is the earlier one: the page is derived from the log up to a time.
    const early = nowIso();
    jump(DAY);
    await k.log.append(setLevel(a.did, "sponsored"));
    assert.equal((await k.log.registryPage(a.did))?.level, "sponsored");
    assert.equal((await k.log.registryPage(a.did, early))?.level, "verified_sponsor", "as of the earlier time");
  });
});

describe("the Market leaves out a lapsed identity (RG-10)", () => {
  test("an agent whose renewal lapsed is not listed or ranked; renewing puts it back", async () => {
    const k = await kit();
    await k.withPrices();
    const sponsor = await k.person("lv-s2", 10);
    const a = await k.agent("lv-lapse", sponsor, { skills: ["code"] }), b = await k.agent("lv-keeps", sponsor, { skills: ["code"] });
    const listed = async () => (await k.log.discoverAgents({ skill: "code" })).map((r) => r.agent).sort();
    assert.deepEqual(await listed(), [a.did, b.did].sort());
    jump(365 * DAY);
    const passportB = (await k.log.passport(b.did))?.head;
    await k.log.append(mk("registry_act", b, { act: "identity_renewal", passport: passportB, keys_confirmed: [b.kid] }, null, { cosigners: [sponsor as never] }));
    assert.deepEqual(await listed(), [a.did, b.did].sort(), "due, but not yet lapsed: 30 more days");
    jump(31 * DAY);
    assert.deepEqual(await listed(), [b.did], "a lapsed identity is left out; the one that renewed stays");
    assert.equal((await k.log.registryPage(a.did))?.renewal?.lapsed, true, "the page says lapsed, the same fact");
    const passportA = (await k.log.passport(a.did))?.head;
    await k.log.append(mk("registry_act", a, { act: "identity_renewal", passport: passportA, keys_confirmed: [a.kid] }, null, { cosigners: [sponsor as never] }));
    assert.deepEqual(await listed(), [a.did, b.did].sort(), "renewing puts it back");
  });
});

describe("adversarial tests (RG-17)", () => {
  /** Variants a farm would try for one name: up to five look-alike letters swapped in, kept only if the Registry's skeleton folds them to the same name. */
  function variants(name: string): string[] {
    const subs: [string, string[]][] = [["o", ["0"]], ["l", ["1", "i"]], ["i", ["1", "l"]], ["m", ["rn"]], ["s", ["5"]], ["u", ["v"]]];
    const once = (n: string): string[] => { const out: string[] = []; for (const [ch, rs] of subs) for (const r of rs) { let i = -1; while ((i = n.indexOf(ch, i + 1)) >= 0) out.push(n.slice(0, i) + r + n.slice(i + 1)); } return out; };
    const all = new Set<string>();
    let frontier = [name];
    for (let depth = 0; depth < 5; depth++) { const next: string[] = []; for (const f of frontier) for (const v of once(f)) if (!all.has(v)) { all.add(v); next.push(v); } frontier = next; }
    return [...all].filter((v) => v !== name && skeleton(v) === skeleton(name)).sort();
  }

  test("a look-alike name farm: 50 attempts at confusable variants of one name are all refused, and the genuine name stays with its holder", async () => {
    const k = await kit();
    await k.withPrices();
    const sponsor = await k.person("lv-farm", 10);
    const holder = await k.agent("lv-genuine", sponsor, { funds: 100 });
    const hm = await k.openMandate(holder);
    const paid = await k.buy(holder, "registry.name.claim", 10, { mandate: hm });
    const at = tick();
    await k.log.append(mk("registry_act", holder, { act: "name_claim", name: "milliosilos-9", holder: holder.did, class: "agent", paid, valid_until: new Date(Date.parse(at) + 365 * DAY).toISOString().replace(".000Z", "Z") }, null, { at }));
    const vs = variants("milliosilos-9").filter((v) => v !== "milliosilos-9");
    assert.ok(vs.length >= 50, `${vs.length} distinct look-alikes generated`);
    // Fifty attempts: each variant tried in turn by farm agents until fifty have been made, one purchase each.
    const farmers: { a: Party; m: string }[] = [];
    for (let i = 0; i < 5; i++) { const f = await k.agent(`lv-farmer-${i}`, sponsor, { funds: 200 }); farmers.push({ a: f, m: await k.openMandate(f, [{ institution: "registry", cap: credit(100), period: "month" }]) }); }
    let attempts = 0, refused = 0;
    for (let n = 0; attempts < 50; n++) {
      const f = farmers[n % 5], v = vs[n];
      const p = await k.buy(f.a, "registry.name.claim", 10, { mandate: f.m });
      const t = tick();
      const why = await refusedBy(k.log.append(mk("registry_act", f.a, { act: "name_claim", name: v, holder: f.a.did, class: "agent", paid: p, valid_until: new Date(Date.parse(t) + 365 * DAY).toISOString().replace(".000Z", "Z") }, null, { at: t })));
      attempts++;
      if (why === "name_confusable" || why === "name_syntax") refused++;
    }
    assert.equal(attempts, 50);
    assert.equal(refused, 50, "every look-alike was refused as confusable (or by syntax), none got through");
    assert.equal((await k.log.registryPage(holder.did))?.names.join(), "milliosilos-9", "the genuine holder keeps the name");
    assert.equal((await k.log.creditAudit()).verdict, "balanced");
  });

  test("a copy of a copy does not shed the original's slash: the grandchild starts with the slash and at no more than the original's tier", async () => {
    const store = new MemoryStore();
    const log = new EventLog(store, { operator: operator.did, owner: owner.did, fallbackResolver: resolver });
    await registerParties(log);
    await store.transaction(async (tx) => { await tx.putReputation({ did: coder.did, tier: 2, slashCount: 1, strikeLog: [{ at: "2026-11-10T00:00:00Z", count: 3 }], acceptedJobs: 5, qualifyingJobs: 5 }); });
    const mkCopy = async (name: string, seed: number, parent: string, tier: number) => {
      const did = `did:web:example.com:agents:${name}`;
      const s = signerFromSeed(`${did}#key-1`, new Uint8Array(32).fill(seed));
      const pub = (s as unknown as { publicKey: Uint8Array }).publicKey;
      const rec = mk("passport", alice as unknown as Party, { did, kind: "agent", sponsor: alice.did, tier, shape: {}, keys: [{ id: `${did}#key-1`, type: "Ed25519", public_key: b64urlEncode(pub) }], lineage: [{ edge: "fork", parent }] }, null, { subject: did });
      await log.append(rec);
      return did;
    };
    const c1 = await mkCopy("lv-copy-1", 71, coder.did, 2);
    const c2 = await mkCopy("lv-copy-2", 72, c1, 2);
    assert.deepEqual(await log.reputationOf(c1), { tier: 2, slashCount: 1, strikes: 3 });
    assert.deepEqual(await log.reputationOf(c2), { tier: 2, slashCount: 1, strikes: 3 }, "the copy of a copy still carries the original's slash and strikes");
    await assert.rejects(mkCopy("lv-copy-3", 73, c2, 3), /fork_tier_above_parent|tier/);
  });
});
void CODE;

describe("the level on the public page (RG-12)", () => {
  test("the record page of an agent shows its identity level in JSON and in the page", async () => {
    const { publicReply } = await import("../src/public-pages.ts");
    const k = await kit();
    const sponsor = await k.person("lv-s3", 10);
    const a = await k.agent("lv-page", sponsor);
    await k.log.append(setLevel(a.did, "verified_sponsor"));
    const json = await publicReply(k.log, `/registry/agents/${encodeURIComponent(a.did)}`, false);
    assert.equal((json!.json as { result: { level: string } }).result.level, "verified_sponsor");
    const html = await publicReply(k.log, `/registry/agents/${encodeURIComponent(a.did)}`, true);
    assert.match(html!.html!, /<th>identity level<\/th><td>verified_sponsor<\/td>/);
  });
});
