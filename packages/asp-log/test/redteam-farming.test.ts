/**
 * The farming red team (register row DK1357; spec-delta S1410): 1,000 farm sponsors try to harvest starter credits and standing with six strategies (rings, dense circles, a shared key, collectors fed by many
 * sponsors, wash pairs, and an evasive mix that also takes honest work), hidden among 1,000 honest sponsors (a sparse random market, popular performers, loyal clients, enterprise fleets and honest freelancer pairs).
 * The detector must catch the farm and leave the honest alone; both rates are MEASURED here and printed. The thresholds are not published: the run uses the default seed and is repeated with other seeds to show the
 * result does not hang on one setting. Records are fabricated (the detector reads bodies only); fake keys and DIDs. Credits are accounting entries, not money.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AspRecord } from "@agent-social/asp-core";
import { analyseFarming, commonControl, thresholdsFor, type ExternalFacts } from "../src/farming.ts";

type Rec = Pick<AspRecord, "id" | "type" | "issuer" | "body" | "issued_at">;
const T0 = Date.parse("2026-09-01T00:00:00Z");
const NOW = "2026-11-20T00:00:00Z";

function prng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

class Society {
  records: Rec[] = [];
  private n = 0;
  external: ExternalFacts = {};
  readonly rand: () => number;
  constructor(seed: number) { this.rand = prng(seed); }
  private id = (p: string) => `${p}:${++this.n}`;
  at = (dayOffset: number) => new Date(T0 + dayOffset * 86_400_000).toISOString().replace(".000Z", "Z");
  sponsor(name: string, o: { key?: string; org?: boolean } = {}): { did: string; agent: string } {
    const did = `did:web:example.com:${o.org ? "orgs" : "users"}:${name}`, agent = `did:web:example.com:agents:${name}-a`;
    this.records.push({ id: this.id("pp"), type: "asp.passport/v0.2", issuer: did, issued_at: this.at(0), body: { did, kind: o.org ? "org" : "human", keys: [{ id: `${did}#k`, type: "Ed25519", public_key: o.key ?? `key-${did}` }] } } as Rec);
    this.records.push({ id: this.id("pp"), type: "asp.passport/v0.2", issuer: did, issued_at: this.at(0), body: { did: agent, kind: "agent", sponsor: did, keys: [{ id: `${agent}#k`, type: "Ed25519", public_key: `key-${agent}` }] } } as Rec);
    return { did, agent };
  }
  fleetMember(org: string, name: string, fleet: string): string {
    const agent = `did:web:example.com:agents:${name}`;
    this.records.push({ id: this.id("pp"), type: "asp.passport/v0.2", issuer: org, issued_at: this.at(0), body: { did: agent, kind: "agent", sponsor: org, fleet, keys: [{ id: `${agent}#k`, type: "Ed25519", public_key: `key-${agent}` }] } } as Rec);
    return agent;
  }
  job(principalAgent: string, performerAgent: string, day: number, price = 40): void {
    const c = this.id("ct");
    this.records.push({ id: c, type: "asp.contract/v0.2", issuer: principalAgent, issued_at: this.at(day), body: { principal: principalAgent, performer: performerAgent, price: { value: price, unit: "credit" } } } as Rec);
    this.records.push({ id: this.id("st"), type: "asp.settlement/v0.2", issuer: "bank", issued_at: this.at(day + 0.1), body: { contract: c, basis: "accepted" } } as Rec);
  }
  day = () => 5 + Math.floor(this.rand() * 70);
}

interface Built { s: Society; farm: Map<string, string>; honest: Set<string> }

function build(seed: number): Built {
  const s = new Society(seed);
  const farm = new Map<string, string>(); // sponsor did -> strategy
  const honest = new Set<string>();
  const r = s.rand;
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)];

  // ---- honest: 1,000 sponsors ----
  const people = Array.from({ length: 760 }, (_, i) => s.sponsor(`honest-${i}`));
  people.forEach((p) => honest.add(p.did));
  const popular = people.slice(0, 100), loyal = people.slice(100, 200);
  for (let i = 0; i < 3600; i++) { const a = pick(people), b = pick(people); if (a !== b) s.job(a.agent, b.agent, s.day()); } // a sparse random market
  for (const p of popular) for (let i = 0; i < 25 + Math.floor(r() * 35); i++) { const c = pick(people); if (c !== p) s.job(c.agent, p.agent, s.day()); } // star topology
  for (const c of loyal) { const p = pick(popular); for (let i = 0; i < 5 + Math.floor(r() * 5); i++) s.job(c.agent, p.agent, s.day()); } // a loyal client
  for (let i = 0; i < 20; i++) { const a = people[200 + 2 * i], b = people[201 + 2 * i]; for (let k = 0; k < 2; k++) { s.job(a.agent, b.agent, s.day()); s.job(b.agent, a.agent, s.day()); } } // honest freelancer pairs
  for (let i = 0; i < 50; i++) { // enterprise fleets: heavy work inside, some outside clients (diverse)
    const org = s.sponsor(`org-${i}`, { org: true }); honest.add(org.did);
    const members = Array.from({ length: 6 }, (_, m) => s.fleetMember(org.did, `fl-${i}-${m}`, `did:web:example.com:orgs:org-${i}:fleets:f`));
    for (let k = 0; k < 30; k++) s.job(pick(members), pick(members), s.day());
    for (let k = 0; k < 14; k++) s.job(pick(people).agent, pick(members), s.day());
  }
  const honestOther = 1000 - honest.size; // top up to 1,000 honest sponsors
  for (let i = 0; i < honestOther; i++) { const p = s.sponsor(`honest-x-${i}`); honest.add(p.did); for (let k = 0; k < 3; k++) { s.job(pick(people).agent, p.agent, s.day()); s.job(p.agent, pick(people).agent, s.day()); } }

  // ---- farm: 1,000 sponsors ----
  const mark = (name: string, k: number, keyOf?: (i: number) => string) => Array.from({ length: k }, (_, i) => { const p = s.sponsor(`${name}-${i}`, keyOf ? { key: keyOf(i) } : {}); farm.set(p.did, name); return p; });
  const ringsA = mark("ring", 250);
  for (let g = 0; g < 50; g++) { const m = ringsA.slice(g * 5, g * 5 + 5); for (let i = 0; i < 5; i++) for (let k = 0; k < 4; k++) s.job(m[i].agent, m[(i + 1) % 5].agent, s.day(), 60); }
  const circlesB = mark("circle", 150);
  for (let g = 0; g < 15; g++) { const m = circlesB.slice(g * 10, g * 10 + 10); for (let k = 0; k < 70; k++) { const a = pick(m), b = pick(m); if (a !== b) s.job(a.agent, b.agent, s.day(), 50); } }
  const keysC = mark("key", 200, (i) => `shared-key-${Math.floor(i / 10)}`);
  for (let k = 0; k < 400; k++) { const a = pick(keysC), b = pick(keysC); if (a !== b) s.job(a.agent, b.agent, s.day()); } // they also trade a little among themselves
  const collectors = mark("collector", 4), feeders = mark("feeder", 196);
  feeders.forEach((f, i) => { for (let k = 0; k < 3 + (i % 3); k++) s.job(f.agent, collectors[i % 4].agent, s.day(), 30); });
  const washE = mark("wash", 100);
  for (let g = 0; g < 50; g++) { const a = washE[2 * g], b = washE[2 * g + 1]; for (let k = 0; k < 6; k++) { s.job(a.agent, b.agent, s.day(), 80); s.job(b.agent, a.agent, s.day(), 80); } }
  const evasiveF = mark("evasive", 50);
  for (let g = 0; g < 10; g++) { const m = evasiveF.slice(g * 5, g * 5 + 5); for (let i = 0; i < 5; i++) { for (let k = 0; k < 3; k++) s.job(m[i].agent, m[(i + 1) % 5].agent, s.day(), 60); for (let k = 0; k < 8; k++) s.job(pick(people).agent, m[i].agent, s.day(), 40); } } // 60 percent of their work is honest-looking
  // stealth: every hop only twice, most of the work honest-looking: below every rule here, and the report says so
  const stealth = mark("stealth", 50);
  for (let g = 0; g < 10; g++) { const m = stealth.slice(g * 5, g * 5 + 5); for (let i = 0; i < 5; i++) { for (let k = 0; k < 2; k++) s.job(m[i].agent, m[(i + 1) % 5].agent, s.day(), 60); for (let k = 0; k < 10; k++) s.job(pick(people).agent, m[i].agent, s.day(), 40); } }
  return { s, farm, honest };
}

function measure(seed: number, detectorSeed?: string) {
  const { s, farm, honest } = build(seed);
  const rep = analyseFarming(s.records, { at: NOW, ...(detectorSeed ? { seed: detectorSeed } : {}), external: s.external });
  const flagged = new Set(rep.flaggedSponsors);
  const by = new Map<string, { n: number; caught: number }>();
  for (const [d, strat] of farm) { const x = by.get(strat) ?? { n: 0, caught: 0 }; x.n++; if (flagged.has(d)) x.caught++; by.set(strat, x); }
  const caught = [...farm.keys()].filter((d) => flagged.has(d)).length;
  const falseFlags = [...honest].filter((d) => flagged.has(d));
  // honest agents are named by their sponsors: a finding that names an honest agent's controller counts as a false flag
  return { rep, by, caught, farm: farm.size, honest: honest.size, falseFlags, catchRate: caught / farm.size, falseRate: falseFlags.length / honest.size };
}

describe("1,000 farm sponsors against the detector", () => {
  test("the detector catches the farm and leaves honest sponsors alone: measured catch and false-flag rates, per strategy", { timeout: 600_000 }, () => {
    const m = measure(7);
    const perStrategy = Object.fromEntries([...m.by].map(([k, v]) => [k, `${v.caught}/${v.n}`]));
    console.log(`red team (seed 7): ${m.farm} farm sponsors, ${m.honest} honest sponsors, ${m.rep.jobs} jobs; caught ${m.caught} (${(m.catchRate * 100).toFixed(1)} %); false flags ${m.falseFlags.length} (${(m.falseRate * 100).toFixed(2)} %); per strategy ${JSON.stringify(perStrategy)}`);
    assert.equal(m.farm, 1000);
    assert.equal(m.honest, 1000);
    for (const strat of ["ring", "circle", "key", "collector", "feeder", "wash"]) { const v = m.by.get(strat); if (!v) continue; assert.ok(v.caught / v.n >= 0.95, `${strat}: ${v.caught}/${v.n}`); }
    assert.ok(m.catchRate >= 0.9, `catch rate ${m.catchRate}`);
    const st = m.by.get("stealth")!;
    console.log(`known gap: the stealth farm (each hop twice, most work honest-looking) is caught ${st.caught}/${st.n}; its ring jobs are still refused by the loop rule at counting time, so it gains starter credits and the honest-looking work only`);
    assert.ok(m.falseRate <= 0.02, `false-flag rate ${m.falseRate}: ${m.falseFlags.slice(0, 5).join(", ")}`);
  });

  test("the result does not hang on one threshold setting: other operator seeds and other random societies give the same bands", { timeout: 900_000 }, () => {
    const rows: string[] = [];
    for (const [world, seed] of [[11, "operator-seed-a"], [23, "operator-seed-b"], [42, "operator-seed-c"]] as const) {
      const m = measure(world, seed);
      rows.push(`world ${world} / ${seed}: catch ${(m.catchRate * 100).toFixed(1)} %, false ${(m.falseRate * 100).toFixed(2)} %`);
      assert.ok(m.catchRate >= 0.8, `catch ${m.catchRate} (${seed})`);
      assert.ok(m.falseRate <= 0.03, `false ${m.falseRate} (${seed})`);
    }
    console.log(rows.join("\n"));
  });

  test("the thresholds are named but their values move with the operator seed, within a band", () => {
    const a = thresholdsFor("seed-one"), b = thresholdsFor("seed-two"), d = thresholdsFor();
    assert.notDeepEqual(a, b, "two operators get different values");
    assert.deepEqual(thresholdsFor("seed-one"), a, "the same seed is deterministic");
    for (const k of Object.keys(d) as (keyof typeof d)[]) assert.ok(Math.abs(a[k] - d[k]) <= 0.35 * d[k] + 1, `${k} stays within its band`);
  });
});

describe("common control", () => {
  test("a shared key, a shared lineage edge and the service's payment, domain and address facts each join sponsors into one controller; an honest pair with nothing shared stays two", () => {
    const s = new Society(1);
    const [a, b, c, d, e, f, g, h] = ["a", "b", "c", "d", "e", "f", "g", "h"].map((n, i) => s.sponsor(n, { key: n === "a" || n === "b" ? "shared-k" : undefined }));
    // c's agent is a fork of d's agent: a lineage edge across two sponsors
    s.records.push({ id: "pp-x", type: "asp.passport/v0.2", issuer: c.did, issued_at: s.at(1), body: { did: c.agent, kind: "agent", sponsor: c.did, keys: [{ id: "k", type: "Ed25519", public_key: "key-c-agent" }], lineage: [{ edge: "fork", parent: d.agent }] } } as Rec);
    s.external = { payment: { [e.did]: "card-1", [f.did]: "card-1" }, domain: { [g.did]: "corp.example" }, address: { [h.did]: "addr-9" } };
    const { clusters, controllerOf } = commonControl(s.records, s.external);
    const ids = clusters.map((x) => x.sponsors);
    assert.ok(ids.some((x) => x.includes(a.did) && x.includes(b.did)), "a shared key");
    assert.ok(ids.some((x) => x.includes(c.did) && x.includes(d.did)), "a lineage edge");
    assert.ok(ids.some((x) => x.includes(e.did) && x.includes(f.did)), "a shared payment instrument");
    assert.equal(controllerOf(a.agent), controllerOf(b.did), "an agent has its sponsor's controller");
    assert.notEqual(controllerOf(g.did), controllerOf(h.did), "two sponsors with different domain and address facts stay two");
    assert.deepEqual(clusters.find((x) => x.sponsors.includes(e.did))!.basis, ["payment"]);
    assert.deepEqual(clusters.find((x) => x.sponsors.includes(a.did))!.basis, ["key_lineage"]);
  });
});

describe("what the detector must not flag", () => {
  test("a big honest fleet working inside itself, a popular performer, a loyal client and a freelancer pair are leads at most, never a freeze", () => {
    const s = new Society(5);
    const people = Array.from({ length: 80 }, (_, i) => s.sponsor(`p-${i}`));
    const r = s.rand;
    for (let i = 0; i < 300; i++) { const a = people[Math.floor(r() * 80)], b = people[Math.floor(r() * 80)]; if (a !== b) s.job(a.agent, b.agent, s.day()); }
    const star = people[0]; for (let i = 1; i < 50; i++) s.job(people[i].agent, star.agent, s.day()); // popular
    const loyal = people[60]; for (let i = 0; i < 8; i++) s.job(loyal.agent, people[1].agent, s.day()); // a loyal client
    const org = s.sponsor("big-org", { org: true });
    const mem = Array.from({ length: 40 }, (_, i) => s.fleetMember(org.did, `m-${i}`, "did:web:example.com:orgs:big-org:fleets:f"));
    for (let i = 0; i < 400; i++) s.job(mem[Math.floor(r() * 40)], mem[Math.floor(r() * 40)], s.day()); // inside one controller: never a graph edge
    const rep = analyseFarming(s.records, { at: NOW });
    const flagged = new Set(rep.flaggedSponsors);
    for (const d of [star.did, loyal.did, org.did, people[1].did]) assert.equal(flagged.has(d), false, d);
    assert.equal(rep.findings.some((f) => f.sponsors.includes(org.did)), false, "work inside one controller is not even a lead");
  });
});
