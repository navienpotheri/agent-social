// BM11: Sybil jurors. The suite found that 20 fake jurors sponsored by one front account the performer controls held a panel majority in half of the disputes, because the draw excluded only jurors sponsored by
// the parties themselves. The draw now gives one seat to each control (a sponsor, or the juror itself when it has none), so a front that registers many jurors holds at most one seat. Fake DIDs only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { drawPanel, type PanelSource } from "../src/index.ts";

const FRONT = "did:web:example.com:users:front-account";
const fake = (i: number) => `did:web:example.com:agents:fake-${i}`;
const honest = (i: number) => `did:web:example.com:agents:honest-${i}`;
const sponsorOfHonest = (i: number) => `did:web:example.com:users:honest-sponsor-${i}`;

function source(fakes: number, honests: number, fronts = 1): PanelSource {
  const passports = new Map<string, { did: string; head: string; sponsor: string | null; fleet: string | null }>();
  const jurors: { did: string; head: string; staked: number }[] = [];
  for (let i = 0; i < fakes; i++) { passports.set(fake(i), { did: fake(i), head: "h", sponsor: `${FRONT}-${i % fronts}`, fleet: null }); jurors.push({ did: fake(i), head: "j", staked: 50 }); }
  for (let i = 0; i < honests; i++) { passports.set(honest(i), { did: honest(i), head: "h", sponsor: sponsorOfHonest(i), fleet: null }); jurors.push({ did: honest(i), head: "j", staked: 50 }); }
  passports.set("did:web:example.com:agents:performer", { did: "did:web:example.com:agents:performer", head: "h", sponsor: "did:web:example.com:users:performer-sponsor", fleet: null });
  return { getRecord: async () => undefined, getPassport: async (d) => passports.get(d) as never, activeJurors: async () => jurors as never };
}
const draw = (src: PanelSource, n: number, size = 3) => Promise.all(Array.from({ length: n }, (_, i) => drawPanel(src, { principal: "did:web:example.com:users:principal", performer: "did:web:example.com:agents:performer", seed: `sha256:${String(i).padStart(64, "0")}`, size })));

test("BM11: 20 fake jurors under one front account and 20 honest ones: in 2,000 disputes the fakes never hold more than one seat, so never a majority", async () => {
  const panels = await draw(source(20, 20), 2000);
  const fakeSeats = panels.map((p) => p.filter((d) => d.includes("fake-")).length);
  assert.ok(fakeSeats.every((n) => n <= 1), `most fake seats on one panel: ${Math.max(...fakeSeats)}`);
  assert.ok(panels.every((p) => p.length === 3), "every panel still fills");
  assert.ok(panels.some((p) => p.some((d) => d.includes("fake-"))), "the front's one juror is still eligible: the rule limits it, it does not ban sponsors");
  assert.ok(panels.every((p) => new Set(p).size === p.length));
});

test("the draw is still deterministic and conflict-free, and a larger panel gives the front one seat of five", async () => {
  const src = source(20, 20);
  assert.deepEqual(await draw(src, 50), await draw(src, 50), "the same inputs give the same panels");
  const five = await draw(src, 500, 5);
  assert.ok(five.every((p) => p.filter((d) => d.includes("fake-")).length <= 1 && p.length === 5));
  // When only one control is left, the panel is what it can be rather than a seat given twice.
  const onlyFront = await draw(source(20, 0), 20);
  assert.ok(onlyFront.every((p) => p.length === 1), "a pool controlled by one sponsor seats one juror");
});

test("what this does not stop, stated: many separate fronts, each sponsoring one juror, are many controls", async () => {
  const panels = await draw(source(20, 20, 20), 2000); // twenty fronts, one fake juror each
  const majority = panels.filter((p) => p.filter((d) => d.includes("fake-")).length >= 2).length;
  assert.ok(majority > 0, "twenty separate sponsors can still win majorities: that needs twenty sponsors, each a sign-in, and the stake of each (the register's DK-level limit)");
});
