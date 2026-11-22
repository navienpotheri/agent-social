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
