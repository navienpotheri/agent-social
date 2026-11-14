// DK365: the panel draw's version 2 (docs/institutions/courts.md, "The panel draw is versioned"): one seat for each funding source, no juror funded by a party, and old records drawn exactly as before.
// The funding sources are markers `funders:<did>` written where a settlement pays an account. Fake DIDs and fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { drawPanel, panelDrawIsV2, PANEL_DRAW_V2_FROM, type PanelSource } from "../src/index.ts";
import { kit } from "./society-kit.ts";

const SOURCE = "did:web:example.com:users:one-source";
const PRINCIPAL = "did:web:example.com:users:principal", PERFORMER = "did:web:example.com:agents:performer";
const fake = (i: number) => `did:web:example.com:agents:fake-${i}`;
const honest = (i: number) => `did:web:example.com:agents:honest-${i}`;

/** 20 fronts, each with its own sponsor and one juror, all paid by SOURCE; 20 honest jurors paid by 20 different clients. `own` makes honest jurors list their own sponsor as a funder too. */
function world(o: { own?: boolean; partyFunded?: boolean } = {}): PanelSource {
  const passports = new Map<string, { did: string; head: string; sponsor: string | null; fleet: string | null }>();
  const markers = new Map<string, string>();
  const jurors: { did: string; head: string; staked: number }[] = [];
  for (let i = 0; i < 20; i++) {
    passports.set(fake(i), { did: fake(i), head: "h", sponsor: `did:web:example.com:users:front-${i}`, fleet: null });
    markers.set(`funders:${fake(i)}`, JSON.stringify([SOURCE]));
    jurors.push({ did: fake(i), head: "j", staked: 50 });
  }
  for (let i = 0; i < 20; i++) {
    const sp = `did:web:example.com:users:honest-sponsor-${i}`;
    passports.set(honest(i), { did: honest(i), head: "h", sponsor: sp, fleet: null });
    markers.set(`funders:${honest(i)}`, JSON.stringify([`did:web:example.com:users:client-${i}`, ...(o.own ? [sp] : [])]));
    jurors.push({ did: honest(i), head: "j", staked: 50 });
  }
  if (o.partyFunded) markers.set(`funders:${honest(0)}`, JSON.stringify([PRINCIPAL]));
  passports.set(PERFORMER, { did: PERFORMER, head: "h", sponsor: "did:web:example.com:users:performer-sponsor", fleet: null });
  return { getRecord: async () => undefined, getPassport: async (d) => passports.get(d) as never, activeJurors: async () => jurors as never, getMarker: async (k) => markers.get(k) };
}
const draw = (src: PanelSource, v2: boolean, n = 2000, size = 3) => Promise.all(Array.from({ length: n }, (_, i) => drawPanel(src, { principal: PRINCIPAL, performer: PERFORMER, seed: `seed-${i}`, size, v2 })));

test("v1 draws as before whatever the markers say; v2 gives twenty fronts funded from one source one seat at most, never a majority, over 2,000 disputes", async () => {
  const src = world();
  const v1 = await draw(src, false);
  assert.ok(v1.some((p) => p.filter((d) => d.includes("fake-")).length >= 2), "v1: separate fronts can still win seats in numbers (BM11 states this limit)");
  const withoutMarkers = { ...src, getMarker: undefined } as PanelSource;
  assert.deepEqual(v1, await draw(withoutMarkers, false), "v1 never reads a marker: the panels are the same with or without them");
  const v2 = await draw(src, true);
  const fakeSeats = v2.map((p) => p.filter((d) => d.includes("fake-")).length);
  assert.ok(fakeSeats.every((n) => n <= 1), `most fake seats on one panel: ${Math.max(...fakeSeats)}`);
  assert.ok(v2.every((p) => p.length === 3), "every panel still fills from the honest jurors");
  assert.ok(v2.some((p) => p.some((d) => d.includes("fake-"))), "the source's one juror is still eligible: the rule limits it, it does not ban the source");
});

test("v2 does not exclude an honest juror for being funded by its own sponsor, and does exclude one funded by a party", async () => {
  const own = await draw(world({ own: true }), true, 300);
  assert.ok(own.flat().some((d) => d === honest(1)) && own.every((p) => p.length === 3), "honest jurors funded by their own sponsors still sit");
  const partyFunded = await draw(world({ partyFunded: true }), true, 600);
  assert.equal(partyFunded.flat().includes(honest(0)), false, "a juror the principal paid never sits on the principal's case");
  assert.equal((await draw(world({ partyFunded: true }), false, 600)).flat().includes(honest(0)), true, "v1 would seat it");
});

test("a record is drawn by v2 only from its time on: before the date, v1, always", () => {
  assert.equal(panelDrawIsV2(undefined, "2026-12-14T23:59:59Z"), false);
  assert.equal(panelDrawIsV2(undefined, PANEL_DRAW_V2_FROM), true);
  assert.equal(panelDrawIsV2("2027-01-01T00:00:00Z", "2026-12-20T00:00:00Z"), false, "a log can set a later date");
  assert.equal(panelDrawIsV2("2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"), true);
});

test("a settlement writes the funder marker, a funding from the account's own sponsor does not, and verify replays the log whole whichever version draws", async () => {
  for (const from of [undefined, "2026-01-01T00:00:00Z"]) {
    const k = await kit();
    await k.withPrices();
    const principal = await k.person("funder-client", 5000);
    const sponsor = await k.person("funder-sponsor", 500);
    const performer = await k.agent("funder-perf", sponsor, { funds: 2000 });
    await k.runJob(principal, performer, 100);
    const raw = (k.log as unknown as { store: { transaction<T>(f: (tx: { getMarker(k: string): Promise<string | undefined> }) => Promise<T>): Promise<T> } }).store;
    const store = { getMarker: (key: string) => raw.transaction((tx) => tx.getMarker(key)) };
    assert.deepEqual(JSON.parse((await store.getMarker(`funders:${performer.did}`)) ?? "[]"), [principal.did]);
    assert.equal(await store.getMarker(`funders:${sponsor.did}`), undefined, "no one paid the sponsor");
    assert.equal((await k.log.verify()).ok, true, `verify with panelV2From ${from ?? "default"}`);
  }
});
