/**
 * The v3 panel draw (register row DK122, spec-delta S1611; courts.md CT-5 and CT-7): a dispute's panel is seeded from the records of three other controllers that follow the rejection, so nothing the rejecting party
 * writes moves it; a party's own records, and many records of one controller, do not count; the panel is not drawn until three others have recorded something; and a juror at the caseload cap is not drawn. Dated, like v2:
 * before the date the seed is the rejection's id and replays as before. Fake keys only. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign, type Signer } from "@agent-social/asp-core";
import { JUROR_CASELOAD_CAP, JUROR_CASELOAD_WINDOW_DAYS, SEED_CONTROLLERS, disputeSeedV3, drawPanel, panelDrawIsV3, type PanelSource } from "../src/index.ts";
import { DAY, credit, kit, mk, type Party } from "./society-kit.ts";

// ---- the pure seed ----

const rec = (seq: number, id: string, issuer: string) => ({ seq, id, record: { issuer } }) as never;
function chainOf(records: { seq: number; id: string; issuer: string }[], sponsors: Record<string, string> = {}) {
  const all = records.map((r) => rec(r.seq, r.id, r.issuer));
  return {
    getRecord: async (id: string) => all.find((r: { id: string }) => r.id === id),
    getPassport: async (d: string) => (sponsors[d] ? ({ did: d, head: "h", sponsor: sponsors[d], fleet: null } as never) : undefined),
    recordsSince: async (after: number, limit: number) => all.filter((r: { seq: number }) => r.seq > after).slice(0, limit),
  };
}
const P = "did:web:t:users:principal", A = "did:web:t:agents:performer", PS = "did:web:t:users:performer-sponsor";
const base = [{ seq: 10, id: "rej", issuer: P }];

test("DK122: the seed ignores the rejection: 200 variants of it give the same seed, and a different third record gives another", async () => {
  const later = [{ seq: 11, id: "k1", issuer: "did:x:1" }, { seq: 12, id: "k2", issuer: "did:x:2" }, { seq: 13, id: "k3", issuer: "did:x:3" }];
  const seeds = new Set<string | undefined>();
  for (let i = 0; i < 200; i++) {
    const src = chainOf([{ seq: 10, id: `rejection-variant-${i}`, issuer: P }, ...later]);
    seeds.add(await disputeSeedV3(src, "contract-1", `rejection-variant-${i}`, [P, A]));
  }
  assert.equal(seeds.size, 1, "one seed for 200 variants of the rejection");
  assert.ok([...seeds][0]);
  const other = chainOf([...base, ...later.slice(0, 2), { seq: 13, id: "k3-other", issuer: "did:x:3" }]);
  assert.notEqual(await disputeSeedV3(other, "contract-1", "rej", [P, A]), [...seeds][0], "another record, another seed");
  assert.notEqual(await disputeSeedV3(chainOf([...base, ...later]), "contract-2", "rej", [P, A]), [...seeds][0], "another contract, another seed");
});

test("DK122: a party's own records and its sponsor's do not count, nor do many records of one controller; fewer than three controllers is not a seed", async () => {
  assert.equal(SEED_CONTROLLERS, 3);
  const mine = [{ seq: 11, id: "p1", issuer: P }, { seq: 12, id: "a1", issuer: A }, { seq: 13, id: "s1", issuer: PS }];
  assert.equal(await disputeSeedV3(chainOf([...base, ...mine], { [A]: PS }), "c", "rej", [P, A]), undefined, "the parties and the performer's sponsor are not third parties");
  const one = [{ seq: 11, id: "x1", issuer: "did:x:1" }, { seq: 12, id: "x2", issuer: "did:x:1" }, { seq: 13, id: "x3", issuer: "did:x:1" }, { seq: 14, id: "y1", issuer: "did:x:2" }];
  assert.equal(await disputeSeedV3(chainOf([...base, ...one]), "c", "rej", [P, A]), undefined, "two controllers are not three");
  const sameSponsor = [{ seq: 11, id: "x1", issuer: "did:x:a1" }, { seq: 12, id: "x2", issuer: "did:x:a2" }, { seq: 13, id: "x3", issuer: "did:x:a3" }];
  assert.equal(await disputeSeedV3(chainOf([...base, ...sameSponsor], { "did:x:a1": "did:x:boss", "did:x:a2": "did:x:boss", "did:x:a3": "did:x:boss" }), "c", "rej", [P, A]), undefined, "three agents of one sponsor are one controller");
  const three = [...one, { seq: 15, id: "z1", issuer: "did:x:3" }];
  assert.ok(await disputeSeedV3(chainOf([...base, ...three]), "c", "rej", [P, A]));
  assert.equal(await disputeSeedV3(chainOf([...base, ...three]), "c", "rejection-missing", [P, A]), undefined);
});

test("DK122: the seed takes the first record of each controller: a later record of a controller already counted changes nothing", async () => {
  const three = [{ seq: 11, id: "k1", issuer: "did:x:1" }, { seq: 12, id: "k2", issuer: "did:x:2" }, { seq: 13, id: "k3", issuer: "did:x:3" }];
  const plain = await disputeSeedV3(chainOf([...base, ...three]), "c", "rej", [P, A]);
  const repeated = await disputeSeedV3(chainOf([...base, { seq: 11, id: "k1", issuer: "did:x:1" }, { seq: 12, id: "k1-again", issuer: "did:x:1" }, { seq: 13, id: "k2", issuer: "did:x:2" }, { seq: 14, id: "k2-again", issuer: "did:x:2" }, { seq: 15, id: "k3", issuer: "did:x:3" }]), "c", "rej", [P, A]);
  assert.equal(repeated, plain, "a controller cannot move the seed by recording again");
});

test("DK122: a ruling reads only the records before it: the seed it was checked against is the seed it is paid against", async () => {
  const recs = [...base, { seq: 11, id: "k1", issuer: "did:x:1" }, { seq: 12, id: "k2", issuer: "did:x:2" }, { seq: 13, id: "k3", issuer: "did:x:3" }, { seq: 14, id: "k4", issuer: "did:x:4" }];
  const src = chainOf(recs);
  const full = await disputeSeedV3(src, "c", "rej", [P, A]);
  assert.equal(await disputeSeedV3(src, "c", "rej", [P, A], 14), full, "a ruling at seq 14 sees the same three");
  assert.equal(await disputeSeedV3(src, "c", "rej", [P, A], 20), full, "later records change nothing once there are three");
  assert.equal(await disputeSeedV3(src, "c", "rej", [P, A], 13), undefined, "a ruling at seq 13 sees only two");
});

test("DK122: the date: v3 applies from it and not before", () => {
  assert.equal(panelDrawIsV3("2026-12-15T00:00:00Z", "2026-12-14T23:59:59Z"), false);
  assert.equal(panelDrawIsV3("2026-12-15T00:00:00Z", "2026-12-15T00:00:00Z"), true);
  assert.equal(panelDrawIsV3(undefined, "2026-11-22T00:00:00Z"), false, "the default date is later than today");
});

// ---- the caseload cap ----

const AT = "2026-12-20T00:00:00Z";
const ago = (days: number) => new Date(Date.parse(AT) - days * DAY).toISOString().replace(".000Z", "Z");
const j = (n: string) => `did:web:example.com:agents:cap-${n}`;
function bench(rows: { n: string; cases?: string[] }[]): PanelSource {
  const markers = new Map<string, string>();
  const passports = new Map<string, { did: string; head: string; sponsor: string | null; fleet: string | null }>();
  for (const r of rows) { passports.set(j(r.n), { did: j(r.n), head: "h", sponsor: `did:web:example.com:users:cap-sponsor-${r.n}`, fleet: null }); if (r.cases) markers.set(`juror_cases:${j(r.n)}`, JSON.stringify(r.cases)); }
  return { getRecord: async () => undefined, getPassport: async (d) => passports.get(d) as never, activeJurors: async () => rows.map((r) => ({ did: j(r.n), head: "j", staked: 1000 })) as never, getMarker: async (k) => markers.get(k) };
}
const sitting = async (src: PanelSource, v3: boolean) => {
  const seen = new Set<string>();
  for (let i = 0; i < 300; i++) for (const d of await drawPanel(src, { principal: "did:web:example.com:users:p", performer: "did:web:example.com:agents:q", seed: `seed-${i}`, size: 3, at: AT, v3 })) seen.add(d);
  return seen;
};

test("DK122: a juror who sat on five cases in the last seven days is not drawn; four, or five older ones, are; without v3 the cap is off", async () => {
  assert.equal(JUROR_CASELOAD_CAP, 5);
  assert.equal(JUROR_CASELOAD_WINDOW_DAYS, 7);
  const src = bench([{ n: "free" }, { n: "four", cases: [ago(1), ago(2), ago(3), ago(4)] }, { n: "five", cases: [ago(1), ago(2), ago(3), ago(4), ago(5)] }, { n: "old", cases: [ago(8), ago(9), ago(10), ago(11), ago(12), ago(13)] }, { n: "future", cases: [ago(-1), ago(-2), ago(-3), ago(-4), ago(-5)] }]);
  const v3 = await sitting(src, true);
  for (const ok of ["free", "four", "old", "future"]) assert.ok(v3.has(j(ok)), `${ok} sits`);
  assert.ok(!v3.has(j("five")), "the juror at the cap is not drawn");
  assert.ok((await sitting(src, false)).has(j("five")), "v2 and v1 have no cap");
});

// ---- through the log ----

async function world() {
  const k = await kit({ panelV2From: "2020-01-01T00:00:00Z", panelV3From: "2020-01-01T00:00:00Z" });
  await k.withPrices();
  const jurors: Party[] = [];
  for (let i = 0; i < 9; i++) { const p = await k.person(`v3-juror-${i}`, 500); await k.log.append(mk("juror", p, { did: p.did, stake: credit(200) }, null)); jurors.push(p); }
  const byDid = new Map(jurors.map((p) => [p.did, p]));
  const principal = await k.person("v3-claimant", 20_000);
  const sponsor = await k.person("v3-sponsor", 50);
  const performer = await k.agent("v3-performer", sponsor, { funds: 2000 });
  const dispute = async () => {
    const job = await k.runJob(principal, performer, 40, undefined, { settle: false });
    const rej = mk("attestation", principal, { kind: "acceptance", about: job.delivery, verdict: "rejected", reasons: ["not good enough"] }, job.delivery, { subject: job.contract });
    await k.log.append(rej);
    return { contract: job.contract, rej };
  };
  const ruling = (d: { contract: string; rej: { id: string } }, signers: Party[]) => {
    const [first, ...others] = signers;
    let r = mk("attestation", first, { kind: "ruling", about: d.contract, verdict: "for_principal", fault: { [performer.did]: 1000 }, reasons: ["decided on the record"], code: { version: "1.0", articles: ["4.1"] } }, d.rej.id, { subject: d.contract });
    for (const s of others) r = cosign(r, s as Signer);
    return r;
  };
  return { k, jurors, byDid, principal, performer, dispute, ruling };
}

test("DK122: through the log, the panel is not drawn until three other controllers have recorded something; then it is fixed, and the ruling by that panel is accepted", async () => {
  const w = await world();
  const d = await w.dispute();
  await assert.rejects(() => w.k.log.drawPanel(d.contract), /not drawn yet/);
  await assert.rejects(() => w.k.log.append(w.ruling(d, w.jurors.slice(0, 2))), /not drawn yet/, "a ruling cannot precede the draw");
  await w.k.person("v3-other-1", 10); // its passport and the operator's grant: two controllers
  await assert.rejects(() => w.k.log.drawPanel(d.contract), /not drawn yet/, "two others are not three");
  await w.k.person("v3-other-2", 10);
  const panel = await w.k.log.drawPanel(d.contract);
  assert.equal(panel.length, 3);
  await w.k.person("v3-other-3", 10);
  assert.deepEqual(await w.k.log.drawPanel(d.contract), panel, "later records do not move the panel");
  const outsiders = w.jurors.filter((p) => !panel.includes(p.did)).slice(0, 2);
  await assert.rejects(() => w.k.log.append(w.ruling(d, outsiders)), /needs 2 of the drawn panel/);
  const ok = w.ruling(d, panel.slice(0, 2).map((x) => w.byDid.get(x)!));
  await w.k.log.append(ok);
  assert.ok(await w.k.log.get(ok.id));
});

test("DK122: the parties' own records do not make the draw: the claimant recording again changes nothing", async () => {
  const w = await world();
  const d = await w.dispute();
  await w.k.person("v3-x-1", 10);
  for (let i = 0; i < 3; i++) await w.k.log.append(mk("juror", w.principal, { did: w.principal.did, stake: credit(1 + i) }, null)).catch(() => undefined);
  await assert.rejects(() => w.k.log.drawPanel(d.contract), /not drawn yet/, "the claimant's own records are not a third controller");
});

test("DK122: with v3 not yet in force the seed is the rejection's id, as before", async () => {
  const k = await kit({ panelV2From: "2020-01-01T00:00:00Z" });
  await k.withPrices();
  for (let i = 0; i < 5; i++) { const p = await k.person(`v3-old-${i}`, 500); await k.log.append(mk("juror", p, { did: p.did, stake: credit(200) }, null)); }
  const principal = await k.person("v3-old-claimant", 20_000);
  const performer = await k.agent("v3-old-performer", await k.person("v3-old-sponsor", 50), { funds: 2000 });
  const job = await k.runJob(principal, performer, 40, undefined, { settle: false });
  await k.log.append(mk("attestation", principal, { kind: "acceptance", about: job.delivery, verdict: "rejected", reasons: ["x"] }, job.delivery, { subject: job.contract }));
  assert.equal((await k.log.drawPanel(job.contract)).length, 3, "drawn at once, from the rejection");
});
