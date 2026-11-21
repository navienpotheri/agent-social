/**
 * The fleet declaration, co-sponsors and the template read by the log (register row DK1353; spec-delta S1407; docs/enterprise-fleets.md). Membership rules: undeclared fleet, wrong sponsor, over the cap, a co-sponsor
 * the organisation named accepted, a closed fleet, a strict template refusing a declared difference and a loose one only labelling it. Fake keys only. Credits are accounting entries, not money.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { kit, keysOf, mk, party, refusedBy, type Party } from "./society-kit.ts";

const FLEET = "did:web:example.com:orgs:acme:fleets:coders";

async function world() {
  const k = await kit();
  const org = await k.person("acme-org");
  const dev1 = await k.person("acme-dev-1");
  const dev2 = await k.person("acme-dev-2");
  const stranger = await k.person("not-acme");
  let n = 0;
  const declare = (body: Record<string, unknown> = {}, prev: string | null = null, by: Party = org) => mk("fleet", by, { did: FLEET, org: org.did, name: "Coders", purpose: "ship code", ...body }, prev, { subject: FLEET });
  const join = (sponsor: Party, over: Record<string, unknown> = {}, fleet: string | null = FLEET) => {
    const a = party(`did:web:example.com:agents:fleet-member-${++n}`);
    const rec = mk("passport", sponsor, { did: a.did, kind: "agent", sponsor: sponsor.did, tier: 1, shape: {}, keys: keysOf(a), ...(fleet ? { fleet } : {}), ...over }, null, { subject: a.did });
    return { a, rec };
  };
  return { ...k, org, dev1, dev2, stranger, declare, join };
}

describe("who may sponsor a member", () => {
  test("an undeclared fleet, a wrong sponsor and an over-the-cap member are refused; the organisation and a co-sponsor it named are accepted", async () => {
    const w = await world();
    assert.equal(await refusedBy(w.log.append(w.join(w.org).rec)), "fleet_unknown");
    const head = (await w.log.append(w.declare({ max_members: 3, co_sponsors: [w.dev1.did] }))).id;
    assert.equal(await refusedBy(w.log.append(w.join(w.stranger).rec)), "fleet_sponsor_mismatch", "someone the organisation did not name");
    assert.equal(await refusedBy(w.log.append(w.join(w.dev2).rec)), "fleet_sponsor_mismatch", "a person the organisation has not named yet");
    await w.log.append(w.join(w.org).rec);
    await w.log.append(w.join(w.dev1).rec); // a named individual sponsor
    await w.log.append(w.join(w.dev1).rec);
    assert.equal(await refusedBy(w.log.append(w.join(w.org).rec)), "fleet_full", "the cap of 3");
    // the organisation names another co-sponsor by restating its declaration; a cap below the members is refused
    assert.equal(await refusedBy(w.log.append(w.declare({ max_members: 2, co_sponsors: [w.dev1.did, w.dev2.did] }, head))), "fleet_cap_below_members");
    const next = (await w.log.append(w.declare({ max_members: 5, co_sponsors: [w.dev1.did, w.dev2.did] }, head))).id;
    await w.log.append(w.join(w.dev2).rec);
    const d = (await w.log.fleetDetails(FLEET))!;
    assert.deepEqual(d.coSponsors, [w.dev1.did, w.dev2.did]);
    assert.equal(d.members.length, 4);
    assert.deepEqual(d.members.map((m) => m.sponsor).sort(), [w.org.did, w.dev1.did, w.dev1.did, w.dev2.did].sort());
    // removing a co-sponsor does not unseat its members; it stops new ones
    await w.log.append(w.declare({ max_members: 5, co_sponsors: [w.dev2.did] }, next));
    assert.equal((await w.log.fleetDetails(FLEET))!.members.length, 4);
    assert.equal(await refusedBy(w.log.append(w.join(w.dev1).rec)), "fleet_sponsor_mismatch");
    assert.deepEqual(await w.log.fleetsOf(w.org.did), [FLEET]);
    assert.equal((await w.log.verify()).ok, true, "a replica replays the declarations and the members the same way");
  });

  test("only the organisation declares and updates its fleet; the organisation is not its own co-sponsor; the organisation of a fleet never changes", async () => {
    const w = await world();
    const bad = mk("fleet", w.stranger, { did: FLEET, org: w.org.did, name: "x", purpose: "y" }, null, { subject: FLEET });
    assert.ok(await refusedBy(w.log.append(bad)), "a stranger cannot declare someone's fleet");
    assert.equal(await refusedBy(w.log.append(w.declare({ co_sponsors: [w.org.did] }))), "fleet_co_sponsor_is_org");
    const head = (await w.log.append(w.declare())).id;
    assert.ok(await refusedBy(w.log.append(mk("fleet", w.stranger, { did: FLEET, org: w.stranger.did, name: "x", purpose: "y" }, head, { subject: FLEET }))), "the organisation of a fleet is not changed by another");
    assert.ok(await refusedBy(w.log.append(w.declare({}, null))), "a second declaration must follow the first");
  });
});

describe("closing a fleet", () => {
  test("a closed fleet takes no new member and keeps the ones it has", async () => {
    const w = await world();
    const head = (await w.log.append(w.declare())).id;
    await w.log.append(w.join(w.org).rec);
    await w.log.append(w.declare({ closed: true }, head));
    assert.equal(await refusedBy(w.log.append(w.join(w.org).rec)), "fleet_closed");
    const d = (await w.log.fleetDetails(FLEET))!;
    assert.equal(d.closed, true);
    assert.equal(d.members.length, 1);
  });
});

describe("the template is read by the log", () => {
  test("a member that declares a different runtime or model is labelled, not refused; one that declares nothing is labelled undeclared; a matching member matches", async () => {
    const w = await world();
    await w.log.append(w.declare({ template: { runtime: "claude-code", model: "model-a" } }));
    const same = w.join(w.org, { fingerprint: { runtime: "claude-code", model: "model-a" } });
    const other = w.join(w.org, { fingerprint: { runtime: "codex", model: "model-a" } });
    const none = w.join(w.org);
    for (const x of [same, other, none]) await w.log.append(x.rec);
    const d = (await w.log.fleetDetails(FLEET))!;
    const label = (p: Party) => d.members.find((m) => m.did === p.did)!.label;
    assert.equal(label(same.a), "matches");
    assert.equal(label(other.a), "differs: runtime");
    assert.equal(label(none.a), "undeclared: runtime, model");
  });

  test("a strict fleet refuses a member that declares a different runtime or model, accepts a matching one and one that declares nothing", async () => {
    const w = await world();
    await w.log.append(w.declare({ template: { runtime: "claude-code", model: "model-a" }, strict: true }));
    assert.equal(await refusedBy(w.log.append(w.join(w.org, { fingerprint: { runtime: "codex" } }).rec)), "fleet_template_mismatch");
    assert.equal(await refusedBy(w.log.append(w.join(w.org, { fingerprint: { model: "model-b" } }).rec)), "fleet_template_mismatch");
    assert.equal(await refusedBy(w.log.append(w.join(w.org, { fingerprint: { runtime: "claude-code", model: "model-b" } }).rec)), "fleet_template_mismatch", "one difference is enough");
    await w.log.append(w.join(w.org, { fingerprint: { runtime: "claude-code", model: "model-a" } }).rec);
    await w.log.append(w.join(w.org).rec);
    assert.equal((await w.log.fleetDetails(FLEET))!.members.length, 2);
  });
});
