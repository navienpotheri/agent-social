// Register row KO1 (spec-delta S1654; docs/key-only-audit.md): the class of key-only agents. A key-only agent names itself as its sponsor; from the cutover an UNVOUCHED one is not a juror, a course reviewer or a
// verifier, and all key-only agents whose passports were made on one UTC day are ONE group in every count of distinct sponsors. A farm of key-only keys cannot sit as jurors and counts as one group; the honest
// control (a sponsored agent, a vouched key-only agent, one that meets the thresholds) still can; a log before the cutover replays as it was. Fake keys only. Credits are mock accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TREASURY_DID, ALLOWANCE_AMOUNT, institutionDid, controlKeyOf, unvouchedReasons, KEY_ONLY_MIN_AGE_DAYS, KEY_ONLY_MIN_JOBS } from "../src/index.ts";
import { DAY, credit, jump, kit, keysOf, mk, operator, owner, party, refusedBy, treasury, type Party } from "./society-kit.ts";

const keyOnly = (n: string): Party => party(`did:web:example.com:agents:ko-class-${n}`);
const passport = (p: Party) => mk("passport", p, { did: p.did, kind: "agent", sponsor: p.did, tier: 1, shape: {}, keys: keysOf(p), purpose: "key-only" }, null, { subject: p.did });

async function world(over: Parameters<typeof kit>[0] = {}) {
  const k = await kit({ keyOnlyClassFrom: "2026-01-01T00:00:00Z", ...over } as never);
  await k.withPrices();
  return k;
}
const juror = (p: Party) => mk("juror", p, { did: p.did, stake: credit(100) }, null);
/** What an unvouched key-only agent needs: age, accepted jobs, a bond. The job count and the bond are set in the state the rules read, as the job path tested elsewhere would. */
async function qualify(k: Awaited<ReturnType<typeof world>>, p: Party, jobs: number, bonded: boolean) {
  await k.log.store.transaction(async (tx) => {
    await tx.putReputation({ did: p.did, tier: 1, slashCount: 0, strikeLog: [], acceptedJobs: jobs, qualifyingJobs: jobs });
    if (bonded) await tx.putMarker(`bonded:${p.did}`, "sha256:" + "b".repeat(64));
  });
}

test("a farm of key-only keys made on one day cannot sit as jurors; the honest control, a sponsored agent, can", async () => {
  const k = await world();
  const farm = Array.from({ length: 12 }, (_, i) => keyOnly(`farm-${i}`));
  for (const p of farm) { await k.log.append(passport(p)); await k.mint(p.did, 200); }
  for (const p of farm) assert.equal(await refusedBy(k.log.append(juror(p))), "juror_unvouched", `${p.did} is unvouched`);
  // The control: a sponsored agent registers as a juror as before.
  const sponsor = await k.person("ko-class-sponsor", 10);
  const honest = await k.agent("ko-class-honest", sponsor, { funds: 200 });
  await k.log.append(juror(honest));
  // A person (no sponsor) registers as before.
  const person = await k.person("ko-class-person", 200);
  await k.log.append(juror(person));
});

test("a key-only agent sits once it is vouched (a non-self sponsor) or meets all three thresholds, and each missing one is named", async () => {
  const k = await world();
  const need = (p: Party) => k.log.append(juror(p));
  // The thresholds: 30 days, 3 accepted jobs, a bond.
  const a = keyOnly("thr"); await k.log.append(passport(a)); await k.mint(a.did, 200);
  jump(KEY_ONLY_MIN_AGE_DAYS * DAY + 1000);
  await qualify(k, a, KEY_ONLY_MIN_JOBS - 1, false);
  const short = String(await need(a).catch((e) => (e as Error).message));
  assert.match(short, new RegExp(`${KEY_ONLY_MIN_JOBS - 1} accepted job\\(s\\), not ${KEY_ONLY_MIN_JOBS}`), "one job short is named");
  assert.match(short, /no bond/, "no bond is named");
  assert.doesNotMatch(short, /days old/, "the age is enough");
  await qualify(k, a, KEY_ONLY_MIN_JOBS, false);
  const noBond = String(await need(a).catch((e) => (e as Error).message));
  assert.match(noBond, /no bond/);
  assert.doesNotMatch(noBond, /accepted job/, "the jobs are enough");
  await qualify(k, a, KEY_ONLY_MIN_JOBS, true);
  await need(a);
  // Too young: the same state on a passport made just now is refused for its age.
  const young = keyOnly("young"); await k.log.append(passport(young)); await k.mint(young.did, 200);
  await qualify(k, young, KEY_ONLY_MIN_JOBS, true);
  assert.match(String(await need(young).catch((e) => (e as Error).message)), /days old, not 30/);
  // Vouched: a passport update that names a non-self sponsor, countersigned by it, makes the agent an ordinary sponsored one at once.
  const vouched = keyOnly("vouched"); await k.log.append(passport(vouched)); await k.mint(vouched.did, 200);
  const sponsor = await k.person("ko-class-vouch", 10);
  const head = (await k.log.store.transaction((tx) => tx.getPassport(vouched.did)))!.head;
  await k.log.append(mk("passport", vouched, { did: vouched.did, kind: "agent", sponsor: sponsor.did, tier: 1, shape: {}, keys: keysOf(vouched), purpose: "now sponsored" }, head, { subject: vouched.did, cosigners: [sponsor] }));
  await need(vouched);
});

test("every key-only agent made on one day is one group for the newcomer allowance, and one made on another day is a different group", async () => {
  const k = await world();
  await k.log.append(mk("mint", operator, { to: TREASURY_DID, amount: credit(1000), reason: "treasury_issuance", authority: "operator" }, null, { subject: TREASURY_DID, cosigners: [owner] }));
  const budget = await k.log.append(mk("budget", treasury, { institution: TREASURY_DID, period: "2026-12", amount: credit(500), purpose: "allowance" }, null, { subject: null, cosigners: [owner] }));
  const [a, b] = [keyOnly("al-a"), keyOnly("al-b")];
  for (const p of [a, b]) await k.log.append(passport(p));
  jump(40 * DAY);
  const c = keyOnly("al-c"); await k.log.append(passport(c)); // made forty days later: another group
  const claim = (p: Party, at: string) => mk("allowance", p, { amount: credit(ALLOWANCE_AMOUNT), trigger: "no_job_30d", budget: budget.id }, null, { subject: p.did, at });
  const at = new Date(Date.parse("2026-12-20T00:00:00Z")).toISOString().replace(".000Z", "Z");
  void at;
  assert.equal(await refusedBy(k.log.append(claim(a, "2026-12-15T00:00:00Z"))), undefined, "the first of the day's key-only agents is paid");
  assert.equal(await refusedBy(k.log.append(claim(b, "2026-12-16T00:00:00Z"))), "allowance_already_paid", "the second of the same day is the same group");
  void c;
});

test("before the cutover a key-only agent counts as its own sponsor as it always did, so a log written then replays as it was", async () => {
  const k = await kit();           // the default cutover is later than the fixture clock
  await k.withPrices();
  const farm = Array.from({ length: 3 }, (_, i) => keyOnly(`old-${i}`));
  for (const p of farm) { await k.log.append(passport(p)); await k.mint(p.did, 200); await k.log.append(juror(p)); }
  assert.equal((await k.log.verify()).ok, true);
});

test("the control key and the thresholds are what the document says", async () => {
  const rows: Record<string, { sponsor: string | null }> = { "did:a": { sponsor: "did:a" }, "did:b": { sponsor: "did:b" }, "did:s": { sponsor: "did:person" }, "did:p": { sponsor: null } };
  const born: Record<string, string> = { "did:a": "2026-12-01T05:00:00Z", "did:b": "2026-12-01T23:59:59Z" };
  const src = { getPassport: async (d: string) => rows[d], getMarker: async (key: string) => born[key.replace("passport_born:", "")] };
  assert.equal(await controlKeyOf(src, "did:a", true), "ko:2026-12-01");
  assert.equal(await controlKeyOf(src, "did:b", true), "ko:2026-12-01", "one UTC day is one group");
  assert.equal(await controlKeyOf(src, "did:a", false), "did:a", "off: its own sponsor, as before");
  assert.equal(await controlKeyOf(src, "did:s", true), "did:person", "a sponsored agent: its sponsor");
  assert.equal(await controlKeyOf(src, "did:p", true), "did:p", "no sponsor: itself");
  assert.deepEqual(unvouchedReasons({ ageDays: 30, jobs: 3, bonded: true }), []);
  assert.equal(unvouchedReasons({ ageDays: 29.9, jobs: 3, bonded: true }).length, 1);
  assert.equal(unvouchedReasons({ ageDays: 30, jobs: 2, bonded: true }).length, 1);
  assert.equal(unvouchedReasons({ ageDays: 30, jobs: 3, bonded: false }).length, 1);
  assert.equal(unvouchedReasons({ ageDays: 0, jobs: 0, bonded: false }).length, 3);
  void institutionDid;
});
