<<<<<<< HEAD
// Rows M3, BM11, DK271, DK365, DK122 (mutation check, launch-bar-2, 2026-11-22): who can never sit on a panel, and the edges of the stake and caseload windows. Thirteen mutants of the draw went undetected because the
// older tests drew from large pools of strangers: a party registered as a juror, a juror who sponsors a party, a juror sponsored by a party, a juror in a party's fleet, an explicit exclusion, a funder that also paid
// a party, the edges of the windows and the sorted order were not exercised one at a time. Fake DIDs, a fake record source and fake markers only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { drawPanel, type PanelSource } from "../src/index.ts";

const P = "did:web:example.com:users:principal", PERF = "did:web:example.com:agents:performer";
const PSP = "did:web:example.com:users:principal-sponsor", PERFSP = "did:web:example.com:users:performer-sponsor";
const j = (n: string) => `did:web:example.com:agents:${n}`;

interface World { passports: Record<string, { sponsor: string | null; fleet: string | null }>; jurors: { did: string; staked?: number }[]; markers?: Record<string, string> }

function src(w: World): PanelSource {
  const all: Record<string, { sponsor: string | null; fleet: string | null }> = { [P]: { sponsor: PSP, fleet: "fleet-p" }, [PERF]: { sponsor: PERFSP, fleet: null }, ...w.passports };
  return {
    getRecord: async () => undefined,
    getPassport: async (d) => (all[d] ? { did: d, head: "h", ...all[d] } : undefined) as never,
    activeJurors: async () => w.jurors.map((x) => ({ did: x.did, head: "j", staked: x.staked ?? 1000 })) as never,
    ...(w.markers ? { getMarker: async (k: string) => w.markers![k] } : {}),
  };
}
/** Draws many panels of a given size from the world and returns every juror that was ever seated. */
async function seated(s: PanelSource, opts: Partial<Parameters<typeof drawPanel>[1]> = {}, n = 60): Promise<Set<string>> {
  const seen = new Set<string>();
  for (let i = 0; i < n; i++) for (const d of await drawPanel(s, { principal: P, performer: PERF, seed: `s${i}`, size: 10, ...opts })) seen.add(d);
  return seen;
}
const strangers = (k: number) => Array.from({ length: k }, (_, i) => ({ did: j(`stranger-${i}`) }));
const strangerPassports = (k: number) => Object.fromEntries(Array.from({ length: k }, (_, i) => [j(`stranger-${i}`), { sponsor: `did:web:example.com:users:ss-${i}`, fleet: null }]));

test("a party, the sponsor of a party, a juror sponsored by a party, one that shares a party's sponsor and one in a party's fleet never sit", async () => {
  const w: World = {
    passports: {
      ...strangerPassports(12),
      [j("sponsored-by-principal")]: { sponsor: P, fleet: null },
      [j("sponsored-by-performer")]: { sponsor: PERF, fleet: null },
      [j("shares-principal-sponsor")]: { sponsor: PSP, fleet: null },
      [j("shares-performer-sponsor")]: { sponsor: PERFSP, fleet: null },
      [j("in-principal-fleet")]: { sponsor: "did:web:example.com:users:other", fleet: "fleet-p" },
      [j("other-fleet")]: { sponsor: "did:web:example.com:users:other2", fleet: "fleet-x" },
    },
    jurors: [...strangers(12), { did: P }, { did: PERF }, { did: PSP }, { did: PERFSP }, { did: j("sponsored-by-principal") }, { did: j("sponsored-by-performer") }, { did: j("shares-principal-sponsor") }, { did: j("shares-performer-sponsor") }, { did: j("in-principal-fleet") }, { did: j("other-fleet") }],
  };
  const seen = await seated(src(w));
  for (const out of [P, PERF, PSP, PERFSP, j("sponsored-by-principal"), j("sponsored-by-performer"), j("shares-principal-sponsor"), j("shares-performer-sponsor"), j("in-principal-fleet")]) assert.ok(!seen.has(out), `${out} never sits`);
  assert.ok(seen.has(j("other-fleet")), "a juror in another fleet is eligible");
  assert.ok([...seen].some((d) => d.includes("stranger")), "strangers are drawn");
});

test("an explicit exclusion and a further party (`also`) are honoured", async () => {
  const w: World = { passports: strangerPassports(12), jurors: strangers(12) };
  const seen = await seated(src(w), { exclude: [j("stranger-0"), j("stranger-1")], also: [j("stranger-2")] });
  for (const d of [j("stranger-0"), j("stranger-1"), j("stranger-2")]) assert.ok(!seen.has(d), `${d} is out`);
  assert.ok(seen.has(j("stranger-3")));
});

test("the draw does not depend on the order in which the registry lists the jurors, and a panel has three by default", async () => {
  const w: World = { passports: strangerPassports(12), jurors: strangers(12) };
  const a = await drawPanel(src(w), { principal: P, performer: PERF, seed: "same" });
  const b = await drawPanel(src({ ...w, jurors: [...w.jurors].reverse() }), { principal: P, performer: PERF, seed: "same" });
  assert.deepEqual(a, b);
  assert.equal(a.length, 3);
  assert.notDeepEqual(a, await drawPanel(src(w), { principal: P, performer: PERF, seed: "another" }));
});

test("v2: a juror funded by a party, or by a source that also paid a party, is out; a juror's own sponsor as a funder is not a conflict", async () => {
  const FUNDER = "did:web:example.com:users:funder-x";
  const w: World = {
    passports: { ...strangerPassports(12), [j("paid-by-principal")]: { sponsor: "did:web:example.com:users:a", fleet: null }, [j("paid-by-party-funder")]: { sponsor: "did:web:example.com:users:b", fleet: null }, [j("paid-by-own-sponsor")]: { sponsor: "did:web:example.com:users:c", fleet: null } },
    jurors: [...strangers(12), { did: j("paid-by-principal") }, { did: j("paid-by-party-funder") }, { did: j("paid-by-own-sponsor") }],
    markers: {
      [`funders:${j("paid-by-principal")}`]: JSON.stringify([P]),
      [`funders:${P}`]: JSON.stringify([FUNDER]),
      [`funders:${j("paid-by-party-funder")}`]: JSON.stringify([FUNDER]),
      [`funders:${j("paid-by-own-sponsor")}`]: JSON.stringify(["did:web:example.com:users:c"]),
    },
  };
  const seen = await seated(src(w), { v2: true });
  assert.ok(!seen.has(j("paid-by-principal")), "funded by a party");
  assert.ok(!seen.has(j("paid-by-party-funder")), "funded by a source that also paid a party");
  assert.ok(seen.has(j("paid-by-own-sponsor")), "its own sponsor as a funder is not a conflict");
});

const AT = "2026-12-20T00:00:00Z";
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

test("v2 stake rule: a juror's stake covers every case in the last 30 days and one more, exactly; a case 30 days ago to the second is outside, a case at the draw time is inside", async () => {
  const at = Date.parse(AT);
  const mk = (cases: string[], staked: number): World => ({ passports: strangerPassports(1), jurors: [{ did: j("stranger-0"), staked }], markers: { [`juror_cases:${j("stranger-0")}`]: JSON.stringify(cases) } });
  const draws = async (w: World) => (await drawPanel(src(w), { principal: P, performer: PERF, seed: "x", size: 3, v2: true, at: AT })).length;
  assert.equal(await draws(mk([iso(at - 5 * DAY)], 40)), 1, "one case inside: 40 covers 20 x (1 + 1)");
  assert.equal(await draws(mk([iso(at - 5 * DAY)], 39)), 0, "39 does not cover two");
  assert.equal(await draws(mk([iso(at - 30 * DAY)], 20)), 1, "a case exactly 30 days ago is outside the window");
  assert.equal(await draws(mk([iso(at - 30 * DAY + 1000)], 20)), 0, "a case one second inside the window counts");
  assert.equal(await draws(mk([iso(at)], 20)), 0, "a case at the draw time counts");
  assert.equal(await draws(mk([iso(at + 1000)], 20)), 1, "a case after the draw time does not");
});

test("v3 caseload cap: five cases in the last 7 days keep a juror out, four do not; the edge of the window is exact", async () => {
  const at = Date.parse(AT);
  const mk = (cases: string[]): World => ({ passports: strangerPassports(1), jurors: [{ did: j("stranger-0") }], markers: { [`juror_cases:${j("stranger-0")}`]: JSON.stringify(cases) } });
  const draws = async (w: World) => (await drawPanel(src(w), { principal: P, performer: PERF, seed: "x", size: 3, v3: true, at: AT })).length;
  const inside = (n: number) => Array.from({ length: n }, (_, i) => iso(at - (i + 1) * 3600_000));
  assert.equal(await draws(mk(inside(4))), 1, "four cases: drawn");
  assert.equal(await draws(mk(inside(5))), 0, "five cases: not drawn");
  assert.equal(await draws(mk([...inside(4), iso(at - 7 * DAY)])), 1, "a case exactly 7 days ago is outside the window");
  assert.equal(await draws(mk([...inside(4), iso(at - 7 * DAY + 1000)])), 0, "a case one second inside counts");
});

test("a party with no sponsor that is also registered as a juror never sits (nothing else excludes it)", async () => {
  const ORPHAN = j("orphan-party");
  const w: World = { passports: { ...strangerPassports(12), [ORPHAN]: { sponsor: null, fleet: null } }, jurors: [...strangers(12), { did: ORPHAN }] };
  const seen = await seated(src(w), { also: [ORPHAN] });
  assert.ok(!seen.has(ORPHAN));
  assert.ok(seen.has(j("stranger-0")) || seen.size > 0);
  const without = await seated(src(w));
  assert.ok(without.has(ORPHAN), "without being named a party, it is an ordinary juror");
});

test("v2: a juror whose own sponsor funds it is not out merely because that sponsor also funded a party", async () => {
  const SPX = "did:web:example.com:users:sponsor-x";
  const w: World = {
    passports: { ...strangerPassports(12), [j("self-funded")]: { sponsor: SPX, fleet: null } },
    jurors: [...strangers(12), { did: j("self-funded") }],
    markers: { [`funders:${j("self-funded")}`]: JSON.stringify([SPX]), [`funders:${P}`]: JSON.stringify([SPX]) },
  };
  assert.ok((await seated(src(w), { v2: true })).has(j("self-funded")));
=======
// The conflict rules of the panel draw (register rows DK365 and BM11; courts.md 5, CT-4; found loose by a mutation check: five of sixteen mutants of drawPanel survived, all of them the basic conflicts): a juror who is a party,
// the sponsor of a party, sponsored by a party, sharing a sponsor with a party, in a party's fleet, or listed in `exclude` is never drawn; the size is the one asked for; the draw is the same whatever order the jurors are listed
// in. A fake source, no log.
import { test } from "node:test";
import assert from "node:assert/strict";
import { drawPanel, type PanelSource } from "../src/panel.ts";

const P = "did:web:t:users:principal", F = "did:web:t:agents:performer";
const source = (passports: Record<string, { sponsor?: string; fleet?: string }>, jurors: string[]): PanelSource => ({
  getRecord: async () => undefined,
  getPassport: async (d: string) => (passports[d] ? ({ did: d, ...passports[d] } as never) : undefined),
  activeJurors: async () => jurors.map((did) => ({ did, staked: 1000 }) as never),
});
const names = (n: number, prefix = "j") => Array.from({ length: n }, (_, i) => `did:web:t:agents:${prefix}${i}`);

test("a party, a party's sponsor, an agent sponsored by a party, one sharing a party's sponsor, one in a party's fleet and an excluded juror are never drawn", async () => {
  const sponsorOfF = "did:web:t:users:sponsor-of-performer";
  const passports: Record<string, { sponsor?: string; fleet?: string }> = { [P]: {}, [F]: { sponsor: sponsorOfF, fleet: "fleet-1" } };
  const clean = names(12, "clean");
  const bad = { party: P, sponsor: sponsorOfF, sponsoredByParty: "did:web:t:agents:kid-of-principal", sharesSponsor: "did:web:t:agents:sibling", inFleet: "did:web:t:agents:fleetmate", excluded: "did:web:t:agents:excluded" };
  passports[bad.sponsoredByParty] = { sponsor: P };
  passports[bad.sharesSponsor] = { sponsor: sponsorOfF };
  passports[bad.inFleet] = { fleet: "fleet-1" };
  for (const d of clean) passports[d] = {};
  const jurors = [...Object.values(bad), ...clean];
  for (let k = 0; k < 40; k++) {
    const picked = await drawPanel(source(passports, jurors), { principal: P, performer: F, seed: `sha256:${k}`, size: 5, exclude: [bad.excluded] });
    assert.equal(picked.length, 5);
    for (const [why, d] of Object.entries(bad)) assert.ok(!picked.includes(d), `seed ${k}: the ${why} juror was drawn`);
  }
});

test("the panel has the size asked for (3 by default), the same jurors listed in any order give the same panel, and a short list gives a short panel", async () => {
  const passports = Object.fromEntries([P, F, ...names(10)].map((d) => [d, {}]));
  const jurors = names(10);
  assert.equal((await drawPanel(source(passports, jurors), { principal: P, performer: F, seed: "sha256:a" })).length, 3);
  assert.equal((await drawPanel(source(passports, jurors), { principal: P, performer: F, seed: "sha256:a", size: 7 })).length, 7);
  const a = await drawPanel(source(passports, jurors), { principal: P, performer: F, seed: "sha256:b", size: 4 });
  const b = await drawPanel(source(passports, [...jurors].reverse()), { principal: P, performer: F, seed: "sha256:b", size: 4 });
  assert.deepEqual(a, b, "the draw sorts its candidates, so the order of the list does not matter");
  assert.equal((await drawPanel(source(passports, names(2)), { principal: P, performer: F, seed: "sha256:c", size: 5 })).length, 2);
  assert.notDeepEqual(await drawPanel(source(passports, jurors), { principal: P, performer: F, seed: "sha256:x1", size: 4 }), await drawPanel(source(passports, jurors), { principal: P, performer: F, seed: "sha256:x2", size: 4 }), "another seed, another panel");
});

test("v2: a juror is out when its SPONSOR was paid by the same source as a party, even if the juror itself was paid by no one", async () => {
  const SRC = "did:web:t:users:the-common-source", SPON = "did:web:t:users:juror-sponsor";
  const passports: Record<string, { sponsor?: string; fleet?: string }> = { [P]: {}, [F]: {}, "did:web:t:agents:funded-by-sponsor": { sponsor: SPON } };
  const clean = names(8, "c");
  for (const d of clean) passports[d] = {};
  const markers = new Map<string, string>([[`funders:${P}`, JSON.stringify([SRC])], [`funders:${SPON}`, JSON.stringify([SRC])]]);
  const src: PanelSource = { ...source(passports, ["did:web:t:agents:funded-by-sponsor", ...clean]), getMarker: async (k: string) => markers.get(k) };
  for (let k = 0; k < 30; k++) {
    const picked = await drawPanel(src, { principal: P, performer: F, seed: `sha256:${k}`, size: 4, v2: true });
    assert.ok(!picked.includes("did:web:t:agents:funded-by-sponsor"), `seed ${k}`);
  }
>>>>>>> claude/protocol-ledger-3
});
