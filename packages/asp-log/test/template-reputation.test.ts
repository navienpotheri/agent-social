/**
 * Template-level reputation and both fleet kinds (register row DK1366; spec-delta S1412): copies of one agent with one template, and personas each with its own template and count, through the same flow; the Registry
 * page of each member shows its fleet, persona, node and template, and the record of every agent with that template in the fleet and in the society. Fake keys only. Credits are accounting entries, not money.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { kit, keysOf, mk, party, type Party } from "./society-kit.ts";
import { fleetKind, standingOf, templateOf, type MemberFacts } from "../src/template-reputation.ts";
import { publicReply } from "../src/public-pages.ts";

const COPIES = "did:web:example.com:orgs:tr-co:fleets:copies", PERSONAS = "did:web:example.com:orgs:tr-co:fleets:personas";

async function world() {
  const k = await kit();
  await k.withPrices();
  const org = party("did:web:example.com:orgs:tr-co");
  await k.log.append(mk("passport", org, { did: org.did, kind: "org", keys: keysOf(org) }, null, { subject: org.did }));
  await k.log.append(mk("fleet", org, { did: COPIES, org: org.did, name: "Copies", purpose: "five copies of one coder", template: { runtime: "claude-code", model: "model-a" } }, null, { subject: COPIES }));
  await k.log.append(mk("fleet", org, { did: PERSONAS, org: org.did, name: "Personas", purpose: "a team of roles" }, null, { subject: PERSONAS }));
  const join = async (name: string, fleet: string, o: { persona?: string; runtime?: string; model?: string; tools?: string[] } = {}): Promise<Party> => {
    const a = party(`did:web:example.com:agents:${name}`);
    const fingerprint = o.runtime || o.model || o.tools ? { ...(o.runtime ? { runtime: o.runtime } : {}), ...(o.model ? { model: o.model } : {}), ...(o.tools ? { tools: o.tools } : {}) } : undefined;
    await k.log.append(mk("passport", org, { did: a.did, kind: "agent", sponsor: org.did, tier: 1, shape: {}, keys: keysOf(a), fleet, ...(o.persona ? { persona: o.persona } : {}), ...(fingerprint ? { fingerprint } : {}) }, null, { subject: a.did }));
    await k.mint(a.did, 200);
    return a;
  };
  return { ...k, org, join };
}

describe("the pure arithmetic", () => {
  test("a template is what the passport declares, else what the fleet's template says, else undeclared; copies share one key; personas have their own", () => {
    const a = templateOf({ fingerprint: { runtime: "claude-code", model: "m1", tools: ["b", "a"] } });
    const b = templateOf({ fingerprint: { runtime: "claude-code", model: "m1", tools: ["a", "b"] } });
    assert.equal(a.key, b.key, "tool order does not matter");
    assert.equal(a.source, "passport");
    assert.notEqual(a.key, templateOf({ fingerprint: { runtime: "codex", model: "m1" } }).key);
    const f = templateOf({ fingerprint: undefined }, { runtime: "claude-code", model: "m1" });
    assert.equal(f.source, "fleet");
    assert.equal(templateOf({ fingerprint: undefined }).key, "undeclared");
    const m = (persona: string | null, templateKey: string) => ({ persona, templateKey });
    assert.equal(fleetKind([m(null, "x")]), "single");
    assert.equal(fleetKind([m(null, "x"), m(null, "x")]), "copies");
    assert.equal(fleetKind([m("dev", "x"), m("pm", "y")]), "personas");
    assert.equal(fleetKind([m("dev", "x"), m(null, "y")]), "mixed");
    const row = (n: number, tier: number): MemberFacts => ({ did: `d${n}`, fleet: "f", persona: null, node: null, fingerprint: undefined, tier, acceptedJobs: 2, qualifyingJobs: 1, slashes: n === 1 ? 1 : 0, strikes: 3, relatedRuns: 10 });
    assert.deepEqual(standingOf([row(1, 1), row(2, 2), row(3, 2)]), { agents: 3, acceptedJobs: 6, qualifyingJobs: 3, slashes: 1, strikes: 9, relatedPartyRuns: 30, tiers: { 1: 1, 2: 2 } });
  });
});

describe("a fleet of copies", () => {
  test("five copies with one template: the kind is copies, the template record sums their standing, and a copy's strikes and counted jobs show on every copy's page", async () => {
    const w = await world();
    const copies = [];
    for (let i = 0; i < 5; i++) copies.push(await w.join(`tr-copy-${i}`, COPIES, { runtime: "claude-code", model: "model-a" }));
    const client = await w.person("tr-client", 500);
    await w.runJob(client, copies[0], 60);
    const client2 = await w.person("tr-client-2", 500);
    await w.runJob(client2, copies[1], 60);
    // a strike on copy 2
    const mandate = await w.openMandate(copies[2]);
    const contract = ((await w.log.get(mandate))!.record.body as { contract: string }).contract;
    await w.log.append(mk("action", copies[2], { contract, scopes_used: [], summary: "run", blocked_attempts: [{ scope: "shell.exec", count: 2 }] }, null, { subject: contract }));
    for (const c of copies) {
      const info = (await w.log.fleetInfoOf(c.did))!;
      assert.equal(info.kind, "copies");
      assert.equal(info.persona, null);
      assert.equal(info.node, "root");
      assert.equal(info.template.runtime, "claude-code");
      assert.equal(info.template.source, "passport");
      assert.deepEqual([info.inFleet.agents, info.inFleet.qualifyingJobs, info.inFleet.strikes], [5, 2, 2]);
      assert.equal(info.inSociety.agents, 5, "nobody outside the fleet runs this template");
    }
    // the same template outside the fleet raises the society's number only
    await w.log.append(mk("passport", w.org, { did: "did:web:example.com:agents:tr-outsider", kind: "agent", sponsor: w.org.did, tier: 1, shape: {}, keys: keysOf(party("did:web:example.com:agents:tr-outsider")), fingerprint: { runtime: "claude-code", model: "model-a" } }, null, { subject: "did:web:example.com:agents:tr-outsider" }));
    const i0 = (await w.log.fleetInfoOf(copies[0].did))!;
    assert.deepEqual([i0.inFleet.agents, i0.inSociety.agents], [5, 6]);
  });
});

describe("a fleet of personas", () => {
  test("three personas with their own templates and counts: the kind is personas, each persona's template record counts only its own agents, and the Registry page shows it", async () => {
    const w = await world();
    const dev = [await w.join("tr-dev-0", PERSONAS, { persona: "developer", runtime: "claude-code", model: "model-a" }), await w.join("tr-dev-1", PERSONAS, { persona: "developer", runtime: "claude-code", model: "model-a" })];
    const pm = await w.join("tr-pm-0", PERSONAS, { persona: "project-manager", runtime: "codex", model: "model-b" });
    const ceo = await w.join("tr-ceo-0", PERSONAS, { persona: "ceo", runtime: "goose", model: "model-c", tools: ["calendar"] });
    const client = await w.person("tr-client-p", 500);
    await w.runJob(client, dev[0], 60);
    const info = (await w.log.fleetInfoOf(dev[0].did))!;
    assert.equal(info.kind, "personas");
    assert.deepEqual(info.personas, { developer: 2, "project-manager": 1, ceo: 1 });
    assert.deepEqual([info.inFleet.agents, info.inFleet.qualifyingJobs], [2, 1], "the developer template: two agents, one counted job");
    const pmInfo = (await w.log.fleetInfoOf(pm.did))!;
    assert.deepEqual([pmInfo.persona, pmInfo.inFleet.agents, pmInfo.inFleet.qualifyingJobs, pmInfo.template.runtime], ["project-manager", 1, 0, "codex"]);
    assert.notEqual(info.template.key, pmInfo.template.key);
    assert.notEqual(pmInfo.template.key, (await w.log.fleetInfoOf(ceo.did))!.template.key);
    // the Registry page, as JSON and as HTML
    const page = await w.log.registryPage(dev[0].did);
    assert.equal(page!.fleetInfo!.kind, "personas");
    const json = await publicReply(w.log, `/registry/agents/${encodeURIComponent(dev[0].did)}`, false);
    assert.equal((json as { json: { result: { fleetInfo: { persona: string } } } }).json.result.fleetInfo.persona, "developer");
    const html = (await publicReply(w.log, `/registry/agents/${encodeURIComponent(dev[0].did)}`, true) as { html: string }).html;
    assert.match(html, /Fleet and template/);
    assert.match(html, /Personas \(personas\)/);
    assert.match(html, /developer/);
    assert.match(html, /same template in this fleet.*2 agents, 1 counted jobs/);
    assert.match(html, /related-party runs \(labelled, not independent jobs\)/);
    // an agent outside any fleet has no fleet block
    const loner = await w.agent("tr-loner", await w.person("tr-loner-sponsor"));
    assert.equal((await w.log.registryPage(loner.did))!.fleetInfo, undefined);
  });
});

test("fleetKind: copies need one template and no persona; personas need two labels and every member labelled; the rest are mixed", () => {
  const m = (persona: string | null, templateKey: string) => ({ persona, templateKey });
  assert.equal(fleetKind([m(null, "a"), m(null, "a")]), "copies");
  assert.equal(fleetKind([m("coder", "a"), m("coder", "a")]), "mixed", "one template with a persona label is not plain copies");
  assert.equal(fleetKind([m("coder", "a"), m("tester", "b")]), "personas");
  assert.equal(fleetKind([m("coder", "a"), m("tester", "b"), m(null, "c")]), "mixed", "a member with no persona breaks the personas");
});

test("templateOf: a passport that declares only a policy or tools is declared, not taken from the fleet", () => {
  const fleet = { runtime: "claude-code", model: "m" };
  const byPolicy = templateOf({ fingerprint: { policy: "strict" } }, fleet);
  assert.equal(byPolicy.source, "passport");
  assert.equal(byPolicy.runtime, null);
  assert.equal(templateOf({ fingerprint: { tools: ["git"] } }, fleet).source, "passport");
  assert.equal(templateOf({ fingerprint: undefined }, fleet).source, "fleet");
});
