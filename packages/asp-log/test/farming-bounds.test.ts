// The edges of the farming detector (register row DK1357; found loose by a mutation check: nine of twelve mutants survived the route and red-team tests): a lineage `transfer` is not common control, only accepted settlements
// inside the window count, a wash needs its minimum jobs, balanced values and a real share, a pair is not a closed circle, a ring or circle needs its minimum jobs, and the common-control level follows the cluster size. Pure:
// synthetic records, no signing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyseFarming, thresholdsFor, FARMING_WINDOW_MS } from "../src/farming.ts";

const DAY = 86_400_000;
const AT = "2026-11-20T00:00:00Z";
let n = 0;
type R = { id: string; type: string; issuer: string; body: Record<string, unknown>; issued_at: string };
const passport = (agent: string, sponsor: string, over: Record<string, unknown> = {}): R => ({ id: `p${++n}`, type: "asp.passport/v0.2", issuer: sponsor, issued_at: "2026-10-01T00:00:00Z", body: { did: agent, sponsor, keys: [{ public_key: `key-${agent}` }], ...over } });
const job = (from: string, to: string, value: number, at: string, basis = "accepted"): R[] => {
  const c = `c${++n}`;
  return [
    { id: c, type: "asp.contract/v0.2", issuer: from, issued_at: at, body: { principal: from, performer: to, price: { value } } },
    { id: `s${++n}`, type: "asp.settlement/v0.2", issuer: "bank", issued_at: at, body: { contract: c, basis } },
  ];
};
const day = (d: number) => new Date(Date.parse(AT) - d * DAY).toISOString();
const world = () => [passport("a1", "A"), passport("b1", "B"), passport("c1", "C"), passport("d1", "D")];
const t = thresholdsFor();
const many = (k: number, from: string, to: string, value: number, atDay = 5) => Array.from({ length: k }, (_, i) => job(from, to, value, day(atDay + i * 0.01))).flat();
const kinds = (recs: R[]) => analyseFarming(recs, { at: AT }).findings.map((f) => f.kind);

test("a lineage transfer is not common control; a fork is", () => {
  const base = [passport("a1", "A"), passport("b1", "B")];
  const rep = (edge: string) => analyseFarming([...base, passport("c1", "C", { lineage: [{ edge, parent: "b1" }] })], { at: AT });
  assert.equal(rep("transfer").clusters.length, 0, "a sold agent does not tie its buyer to its seller");
  assert.equal(rep("fork").clusters.length, 1);
});

test("the level of a common-control finding follows the size of the cluster", () => {
  const share = (k: number) => Array.from({ length: k }, (_, i) => passport(`x${i}`, `S${i}`, { keys: [{ public_key: "shared" }] }));
  const lv = (k: number) => analyseFarming(share(k), { at: AT }).findings.find((f) => f.kind === "common_control")!.level;
  assert.deepEqual([lv(2), lv(3), lv(5)], ["watch", "likely", "strong"]);
});

test("only accepted settlements inside the window count, and work inside one controller never does", () => {
  const k = Math.max(t.washMinJobs, 4);
  // k jobs between a1 and b1, balanced in value, the last one a b1 > a1 job
  const x = Math.ceil(k / 2), y = Math.floor(k / 2);
  const pair = () => [...world(), ...many(x, "a1", "b1", y * 100), ...many(y, "b1", "a1", x * 100)];
  assert.ok(kinds(pair()).includes("wash"), "a balanced pair with enough jobs is a wash");
  const swapLast = (basis?: string, at?: string) => pair().map((r, i, all) => (i === all.length - 1 ? { ...r, ...(at ? { issued_at: at } : {}), body: { ...r.body, ...(basis ? { basis } : {}) } } : r));
  assert.ok(!kinds(swapLast("rejected")).includes("wash"), "a rejected job does not count");
  assert.ok(!kinds(swapLast(undefined, new Date(Date.parse(AT) + DAY).toISOString())).includes("wash"), "a job after the analysis time does not count");
  assert.ok(!kinds(swapLast(undefined, new Date(Date.parse(AT) - FARMING_WINDOW_MS - DAY).toISOString())).includes("wash"), "a job before the window does not count");
  assert.equal(kinds([...world(), passport("a2", "A"), ...many(10, "a1", "a2", 100)]).length, 0, "two agents of one sponsor hiring each other is one controller");
});

test("a wash needs its minimum jobs, balanced values and a real share; a pair is not a closed circle", () => {
  const k = Math.max(t.washMinJobs, 4);
  const trade = (a: number, b: number, va: number, vb: number) => [...world(), ...many(a, "a1", "b1", va), ...many(b, "b1", "a1", vb)];
  assert.ok(kinds(trade(k / 2, k / 2, 100, 100)).includes("wash"));
  { const lo = Math.floor((k - 1) / 2), hi = Math.ceil((k - 1) / 2); assert.ok(!kinds(trade(lo, hi, hi * 100, lo * 100)).includes("wash"), "one job short of the minimum, with balanced values"); }
  assert.ok(!kinds(trade(k / 2, k / 2, 100, Math.floor(100 * (t.washRatio - 0.15)))).includes("wash"), "the values are far from balanced");
  assert.ok(!kinds(trade(k, k, 100, 100)).includes("closed_circle"), "two controllers are a wash, not a circle");
  // a share below the ratio: a1 and b1 also trade a lot with others, so their pair is a small part of their work
  const diluted = [...trade(k / 2, k / 2, 100, 100), ...many(5 * k, "a1", "c1", 100, 6), ...many(5 * k, "b1", "d1", 100, 7)];
  assert.ok(!kinds(diluted).includes("wash"), "a pair that is a small share of both parties' work is not a wash");
});

test("a ring or a circle with fewer jobs than the minimum is not flagged", () => {
  const ring = [...world(), ...many(1, "a1", "b1", 100), ...many(1, "b1", "c1", 100), ...many(1, "c1", "a1", 100)];
  assert.ok(!kinds(ring).some((x) => x === "ring" || x === "closed_circle"), "three jobs round a ring are below the minimum");
});

test("a ring is looked for up to five controllers: five round a ring are found, six are not a ring (they may still be a closed circle)", () => {
  const ring = (k: number) => {
    const names = Array.from({ length: k }, (_, i) => String.fromCharCode(65 + i));
    const recs: R[] = names.map((s, i) => passport(`ag${i}`, s));
    for (let i = 0; i < k; i++) recs.push(...many(Math.max(t.ringEdge, 3) + 1, `ag${i}`, `ag${(i + 1) % k}`, 100));
    return recs;
  };
  assert.ok(kinds(ring(5)).includes("ring"), "five controllers hiring round in a circle, each hop repeated");
  assert.ok(!kinds(ring(6)).includes("ring"), "six are beyond the ring search");
});
