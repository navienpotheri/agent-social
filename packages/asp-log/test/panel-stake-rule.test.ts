// DK365 (spec-delta S1200): the rest of the v2 panel draw. The stake rule (docs/institutions/courts.md, "The panel draw is versioned": a juror's stake must cover every case it has sat on in the window and one more; the
// numbers are parameters, JUROR_STAKE_PER_CASE and JUROR_CASE_WINDOW_DAYS, with the owner's decision in docs/owner-decisions.md), the cases a ruling records for the jurors who signed it, and the backfill: a replay of
// the records rebuilds every marker, the funding sources included. Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign, b64urlEncode, type Signer } from "@agent-social/asp-core";
import { JUROR_CASE_WINDOW_DAYS, JUROR_STAKE_PER_CASE, drawPanel, type PanelSource } from "../src/index.ts";
import { DAY, credit, jump, kit, mk, operator, party, registrar, type Party } from "./society-kit.ts";

const PRINCIPAL = "did:web:example.com:users:principal", PERFORMER = "did:web:example.com:agents:performer";
const j = (n: string) => `did:web:example.com:agents:juror-${n}`;
const AT = "2026-12-20T00:00:00Z";
const ago = (days: number) => new Date(Date.parse(AT) - days * DAY).toISOString().replace(".000Z", "Z");

function bench(rows: { n: string; staked: number; cases?: string[] }[]): PanelSource {
  const markers = new Map<string, string>();
  const passports = new Map<string, { did: string; head: string; sponsor: string | null; fleet: string | null }>();
  for (const r of rows) {
    passports.set(j(r.n), { did: j(r.n), head: "h", sponsor: `did:web:example.com:users:sponsor-${r.n}`, fleet: null });
    if (r.cases) markers.set(`juror_cases:${j(r.n)}`, JSON.stringify(r.cases));
  }
  passports.set(PERFORMER, { did: PERFORMER, head: "h", sponsor: "did:web:example.com:users:performer-sponsor", fleet: null });
  return { getRecord: async () => undefined, getPassport: async (d) => passports.get(d) as never, activeJurors: async () => rows.map((r) => ({ did: j(r.n), head: "j", staked: r.staked })) as never, getMarker: async (k) => markers.get(k) };
}
const sitting = async (src: PanelSource, over: { v2?: boolean; at?: string | undefined } = {}) => {
  const seen = new Set<string>();
  for (let i = 0; i < 400; i++) for (const d of await drawPanel(src, { principal: PRINCIPAL, performer: PERFORMER, seed: `seed-${i}`, size: 3, v2: over.v2 ?? true, ...(over.at === undefined && "at" in over ? {} : { at: over.at ?? AT }) })) seen.add(d);
  return seen;
};

test("the stake rule: a v2 draw skips a juror whose stake does not cover the cases it sat on in the window and one more; cases outside the window do not count; v1 and a draw with no time are unchanged", async () => {
  assert.equal(JUROR_STAKE_PER_CASE, 20);
  assert.equal(JUROR_CASE_WINDOW_DAYS, 30);
  const src = bench([
    { n: "fresh", staked: 20 },                                                   // 20 covers one case
    { n: "busy-ok", staked: 100, cases: [ago(1), ago(2), ago(3), ago(4)] },        // 4 recent + 1 = 5 x 20 = 100: covered
    { n: "busy-over", staked: 100, cases: [ago(1), ago(2), ago(3), ago(4), ago(5)] }, // 6 x 20 = 120 > 100: skipped
    { n: "thin", staked: 30, cases: [ago(2)] },                                    // 2 x 20 = 40 > 30: skipped
    { n: "old-cases", staked: 20, cases: [ago(31), ago(40), ago(90)] },            // all outside the window: covered
    { n: "future", staked: 20, cases: ["2027-02-01T00:00:00Z"] },                  // after the draw's own time: not counted
    { n: "low", staked: 19 },                                                      // does not cover even one
  ]);
  const v2 = await sitting(src);
  for (const ok of ["fresh", "busy-ok", "old-cases", "future"]) assert.ok(v2.has(j(ok)), `${ok} sits`);
  for (const no of ["busy-over", "thin", "low"]) assert.ok(!v2.has(j(no)), `${no} is skipped`);
  const v1 = await sitting(src, { v2: false });
  for (const n of ["busy-over", "thin", "low"]) assert.ok(v1.has(j(n)), `v1 ignores the stake rule: ${n}`);
  const noTime = await sitting(src, { at: undefined });
  assert.ok(noTime.has(j("thin")), "a draw that is given no time applies no stake rule");
  const withoutMarkers = await sitting({ ...src, getMarker: undefined } as PanelSource);
  assert.ok(withoutMarkers.has(j("thin")), "a source that has no markers draws as before");
});

async function world() {
  const k = await kit({ panelV2From: "2026-10-01T00:00:00Z" });
  await k.withPrices();
  const jurors: Party[] = [];
  for (let i = 0; i < 9; i++) { const p = await k.person(`st-juror-${i}`, 500); await k.log.append(mk("juror", p, { did: p.did, stake: credit(100) }, null)); jurors.push(p); }
  const byDid = new Map(jurors.map((p) => [p.did, p]));
  const sponsor = await k.person("st-sponsor", 300);
  const agent = await k.agent("st-agent", sponsor, { funds: 100 });
  const site = party("did:web:victim-site.example");
  const report = mk("abuse_report", site, { accused: agent.did, kind: "network_abuse", description: "the agent scanned our servers", reporter_key: { id: site.kid, public_key: b64urlEncode(site.publicKey) }, proof: { url: "https://victim-site.example/.well-known/did.json", sha256: "sha256:" + "e".repeat(64) } }, null, { subject: agent.did, cosigners: [operator] });
  await k.log.append(report);
  const refer = mk("court_act", registrar, { act: "abuse_case", report: report.id }, null);
  await k.log.append(refer);
  jump(20 * DAY);
  const panel = await k.log.drawPanel(refer.id).catch(() => [] as string[]);
  return { k, jurors, byDid, sponsor, agent, refer, panel };
}
const marker = (log: unknown, key: string) => (log as { store: { transaction<T>(f: (tx: { getMarker(k: string): Promise<string | undefined> }) => Promise<T>): Promise<T> } }).store.transaction((tx) => tx.getMarker(key));

test("a ruling records the case for the jurors of the drawn panel who signed it, and for no one else; the record is the stake rule's load", async () => {
  const w = await world();
  const { drawPanel: draw } = await import("../src/index.ts");
  const panel = await draw(w.k.log.store as never, { principal: w.sponsor.did, performer: w.agent.did, seed: w.refer.id, size: 3 });
  assert.equal(panel.length, 3);
  const signers = panel.slice(0, 2).map((d) => w.byDid.get(d)!);
  const [first, ...rest] = signers;
  let r = mk("court_act", first, { act: "abuse_ruling", case: w.refer.id, finding: "dismissed", reasons: ["not enough evidence"], code: { version: "1.0", articles: ["7"] } }, null);
  for (const s of rest) r = cosign(r, s as Signer);
  await w.k.log.append(r);
  for (const d of panel.slice(0, 2)) assert.deepEqual(JSON.parse((await marker(w.k.log, `juror_cases:${d}`)) ?? "[]"), [r.issued_at], `${d} sat`);
  assert.equal(await marker(w.k.log, `juror_cases:${panel[2]}`), undefined, "the drawn juror who did not sign did not sit");
  for (const p of w.jurors.filter((x) => !panel.includes(x.did))) assert.equal(await marker(w.k.log, `juror_cases:${p.did}`), undefined);
});

test("the backfill is a replay: a fresh log rebuilt from the records alone has the same funding sources, the same cases for each juror and the same panels, and verifies", async () => {
  const w = await world();
  const { drawPanel: draw } = await import("../src/index.ts");
  const panel = await draw(w.k.log.store as never, { principal: w.sponsor.did, performer: w.agent.did, seed: w.refer.id, size: 3 });
  const [first, second] = panel.slice(0, 2).map((d) => w.byDid.get(d)!);
  await w.k.log.append(cosign(mk("court_act", first, { act: "abuse_ruling", case: w.refer.id, finding: "dismissed", reasons: ["x"], code: { version: "1.0", articles: ["7"] } }, null), second as Signer));
  const client = await w.k.person("st-client", 5000);
  const performer = await w.k.agent("st-perf", await w.k.person("st-perf-sponsor", 500), { funds: 2000 });
  await w.k.runJob(client, performer, 100);
  const replay = await w.k.log.replayed();
  assert.equal((await replay.head()).logHash, (await w.k.log.head()).logHash, "the same log");
  const keys = [`funders:${performer.did}`, `juror_cases:${first.did}`, `juror_cases:${second.did}`, `juror_cases:${panel[2]}`];
  for (const key of keys) assert.equal(await marker(replay, key), await marker(w.k.log, key), key);
  assert.deepEqual(JSON.parse((await marker(replay, `funders:${performer.did}`)) ?? "[]"), [client.did], "the source of the performer's funds is seen again after a rebuild");
  assert.deepEqual(await draw(replay.store as never, { principal: w.sponsor.did, performer: w.agent.did, seed: w.refer.id, size: 3, v2: true, at: "2026-12-20T00:00:00Z" }), await draw(w.k.log.store as never, { principal: w.sponsor.did, performer: w.agent.did, seed: w.refer.id, size: 3, v2: true, at: "2026-12-20T00:00:00Z" }), "the same v2 panel");
  assert.equal((await replay.verify()).ok, true);
  assert.equal((await w.k.log.verify()).ok, true);
});
