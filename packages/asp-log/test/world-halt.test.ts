/**
 * The world's kill-switch and invariants (register row DK76; spec-delta S1402; leisure-events.md 14): a halt signed by the operator stops every generated event and every shock, drill or experiment at once;
 * a resume ends it, with the owner's co-signature when it comes 24 hours or more later; an invariant check passes after every event of a seeded run and fails when supply is wrong; and an agent observes a
 * change and adapts to it, and goes back when the switch stops the change. Fake keys only. Credits are accounting entries, not money.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { AspError, b64urlEncode, cosign, createRecord, publicKeyFromSeed, signerFromSeed, staticResolver, type AspRecord, type Signer } from "@agent-social/asp-core";
import { EventLog, MemoryStore, TREASURY_DID } from "../src/index.ts";
import { WORLD_DID, dayBody, effectivePrice, generateDay, seedCommitment, worldStateAt } from "../src/world.ts";

const hex = (n: number) => new Uint8Array(32).fill(n);
const worldSeed = new Uint8Array(randomBytes(32));
const world = { did: WORLD_DID, ...signerFromSeed(`${WORLD_DID}#key-1`, worldSeed) };
const operator = { did: "did:web:asp.local:operator", ...signerFromSeed("did:web:asp.local:operator#key-1", hex(11)) };
const owner = { did: "did:web:asp.local:owner", ...signerFromSeed("did:web:asp.local:owner#key-1", hex(12)) };
const stranger = { did: "did:web:example.com:users:stranger", ...signerFromSeed("did:web:example.com:users:stranger#key-1", hex(17)) };
const SEED = "halt-test-seed";
const HOUR = 3600_000, DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");
const T0 = Date.parse("2026-11-20T00:00:00Z");

async function freshLog() {
  const resolver = staticResolver(Object.fromEntries([operator, owner, stranger].map((p) => [p.kid, (p as unknown as { publicKey: Uint8Array }).publicKey])));
  const log = new EventLog(new MemoryStore(), { operator: operator.did, owner: owner.did, fallbackResolver: resolver, now: () => new Date(T0 + 400 * DAY) });
  await log.append(createRecord({ type: "passport", issuer: WORLD_DID, subject: WORLD_DID, prev: null, issued_at: "2026-11-01T00:00:00Z", body: { did: WORLD_DID, kind: "org", keys: [{ id: world.kid, type: "Ed25519", public_key: b64urlEncode(publicKeyFromSeed(worldSeed)) }] } }, world));
  return log;
}
const rec = (by: Signer & { did: string }, body: Record<string, unknown>, at: string, cosigners: (Signer & { did: string })[] = []): AspRecord => {
  let r = createRecord({ type: "world", issuer: by.did, subject: null, prev: null, body, issued_at: at }, by);
  for (const c of cosigners) r = cosign(r, c);
  return r;
};
const entry = (id: string, kind: string, starts: string, ends: string, effect: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ kind: "calendar_entry", entry_id: id, source: "operator", event_kind: kind, title: id, starts, ends, effect, ...extra });
const refusedBy = async (p: Promise<unknown>) => { try { await p; } catch (e) { if (e instanceof AspError) return e.detail ?? e.code; throw e; } return undefined; };
const shock = (at: number) => entry("shock-code", "shock", iso(at), iso(at + 3 * DAY), { type: "price_multiplier", target: "code", value: 1500 }, { seed_commitment: seedCommitment("s"), generator: "asp-world-gen/1" });
const season = (at: number) => entry("autumn", "season", iso(at + 4 * DAY), iso(at + 30 * DAY), { type: "tax_free", target: "all", value: 1000 });

describe("the kill-switch", () => {
  test("only the operator halts; a second halt is refused; the halt is a public record", async () => {
    const log = await freshLog();
    assert.equal(await refusedBy(log.append(rec(stranger, { kind: "halt", reason: "I do not like it" }, iso(T0)))), "halt_unauthorised");
    assert.equal(await refusedBy(log.append(rec(world, { kind: "halt", reason: "the authority cannot halt itself" }, iso(T0)))), "halt_unauthorised");
    const h = await log.append(rec(operator, { kind: "halt", reason: "a shock hit one class too hard" }, iso(T0)));
    assert.equal(await refusedBy(log.append(rec(operator, { kind: "halt", reason: "again" }, iso(T0 + HOUR)))), "world_already_halted");
    assert.ok((await log.worldRecords()).some((r) => r.id === h.id), "the halt is in the world records anyone can read");
    assert.equal((await log.worldState(iso(T0 + HOUR))).halted?.record, h.id);
    assert.equal((await log.worldState(iso(T0 + HOUR))).halted?.reason, "a shock hit one class too hard");
  });

  test("a halt stops generated events and shocks at once and leaves scheduled and season entries running; the past is unchanged", async () => {
    const log = await freshLog();
    const day = iso(T0);
    await log.append(rec(world, dayBody(SEED, "2026-11-20"), iso(T0 + HOUR)));
    await log.append(rec(world, shock(T0), iso(T0 - 5 * DAY)));
    await log.append(rec(world, season(T0), iso(T0 - 5 * DAY)));
    void day;
    const before = await log.worldState(iso(T0 + 10 * HOUR));
    assert.equal(before.priceMultiplier.code, 1500, "the shock is in force");
    assert.equal(before.halted, null);
    await log.append(rec(operator, { kind: "halt", reason: "stop" }, iso(T0 + 12 * HOUR)));
    const during = await log.worldState(iso(T0 + 13 * HOUR));
    assert.equal(during.priceMultiplier.code, undefined, "the shock stopped the moment the halt was recorded");
    assert.ok(during.because.every((b) => !b.id.startsWith("2026-11-20:") && b.id !== "entry:shock-code"), "no generated event is in force");
    const mid = await log.worldState(iso(T0 + 5 * DAY));
    assert.equal(mid.halted?.reason, "stop");
    assert.equal(mid.taxFree, true, "a season entry is not a shock: it runs on");
    assert.equal((await log.worldState(iso(T0 + 10 * HOUR))).priceMultiplier.code, 1500, "the time before the halt is read as it was");
  });

  test("while halted no day record and no shock, drill or experiment is accepted, but a scheduled entry is", async () => {
    const log = await freshLog();
    await log.append(rec(operator, { kind: "halt", reason: "stop" }, iso(T0)));
    assert.equal(await refusedBy(log.append(rec(world, dayBody(SEED, "2026-11-20"), iso(T0 + HOUR)))), "world_halted");
    assert.equal(await refusedBy(log.append(rec(world, shock(T0 + 2 * DAY), iso(T0 + HOUR)))), "world_halted");
    await log.append(rec(world, entry("review", "review", iso(T0 + 5 * DAY), iso(T0 + 6 * DAY), { type: "tax_free", target: "all", value: 1000 }), iso(T0 + HOUR)));
  });

  test("a resume names the halt in force; within 24 hours the operator alone, after it with the owner's co-signature; the shock then runs again if its window still holds", async () => {
    const log = await freshLog();
    await log.append(rec(world, shock(T0), iso(T0 - 5 * DAY)));
    const h = await log.append(rec(operator, { kind: "halt", reason: "stop" }, iso(T0 + HOUR)));
    const other = "sha256:" + "9".repeat(64);
    assert.equal(await refusedBy(log.append(rec(stranger, { kind: "resume", halt: h.id, reason: "x" }, iso(T0 + 2 * HOUR)))), "resume_unauthorised");
    assert.equal(await refusedBy(log.append(rec(operator, { kind: "resume", halt: other, reason: "x" }, iso(T0 + 2 * HOUR)))), "resume_unknown_halt");
    await log.append(rec(operator, { kind: "resume", halt: h.id, reason: "fixed in two hours" }, iso(T0 + 3 * HOUR)));
    assert.equal((await log.worldState(iso(T0 + 4 * HOUR))).halted, null);
    assert.equal((await log.worldState(iso(T0 + 4 * HOUR))).priceMultiplier.code, 1500, "the shock's window still holds, so it runs again");
    assert.equal((await log.worldState(iso(T0 + 2 * HOUR))).halted?.record, h.id, "between the halt and the resume it was halted");
    assert.equal(await refusedBy(log.append(rec(operator, { kind: "resume", halt: h.id, reason: "twice" }, iso(T0 + 4 * HOUR)))), "resume_not_open");
    // a long halt: resumed 25 hours later it needs the owner
    const h2 = await log.append(rec(operator, { kind: "halt", reason: "a second stop" }, iso(T0 + 5 * HOUR)));
    assert.equal(await refusedBy(log.append(rec(operator, { kind: "resume", halt: h2.id, reason: "a day later" }, iso(T0 + 5 * HOUR + 25 * HOUR)))), "resume_needs_owner");
    assert.equal(await refusedBy(log.append(rec(operator, { kind: "resume", halt: h2.id, reason: "exactly 24 hours" }, iso(T0 + 5 * HOUR + 24 * HOUR)))), "resume_needs_owner", "24 hours is the boundary: it needs the owner");
    await log.append(rec(operator, { kind: "resume", halt: h2.id, reason: "23 hours and 59 minutes" }, iso(T0 + 5 * HOUR + 24 * HOUR - 60_000)));
    const h3 = await log.append(rec(operator, { kind: "halt", reason: "a third stop" }, iso(T0 + 40 * HOUR)));
    await log.append(rec(operator, { kind: "resume", halt: h3.id, reason: "with the owner" }, iso(T0 + 80 * HOUR), [owner]));
    assert.equal((await log.worldState(iso(T0 + 81 * HOUR))).halted, null);
    assert.equal((await log.verify()).ok, true, "a replica replays the halts and resumes the same way");
  });
});

describe("the world's invariants", () => {
  test("after every day of a seeded run the invariants hold and the number of days checked grows", async () => {
    const log = await freshLog();
    let events = 0;
    for (let i = 0; i < 40; i++) {
      const day = iso(Date.parse("2026-11-12T00:00:00Z") + i * DAY).slice(0, 10);
      await log.append(rec(world, dayBody(SEED, day), iso(Date.parse(`${day}T01:00:00Z`))));
      events += generateDay(SEED, day).length;
      const inv = await log.worldInvariants(iso(Date.parse(`${day}T12:00:00Z`)));
      assert.deepEqual(inv.failures, [], `after ${day}`);
      assert.equal(inv.ok, true);
      assert.equal(inv.checked.days, i + 1);
    }
    assert.ok(events > 5, "the run produced events to check");
  });

  test("the check fails when the credit supply rule is broken, and names it", async () => {
    const log = await freshLog();
    await log.append(rec(world, dayBody(SEED, "2026-11-12"), iso(Date.parse("2026-11-12T01:00:00Z"))));
    await log.append(createRecord({ type: "mint", issuer: operator.did, subject: TREASURY_DID, prev: null, issued_at: "2026-11-12T02:00:00Z", body: { to: TREASURY_DID, amount: { value: 100, unit: "credit" }, reason: "bootstrap", authority: "operator" } }, operator));
    assert.equal((await log.worldInvariants("2026-11-12T12:00:00Z")).ok, true);
    const store = (log as unknown as { store: MemoryStore }).store;
    await store.transaction(async (tx) => { await tx.putAccount({ did: TREASURY_DID, balance: 101 }); });
    const bad = await log.worldInvariants("2026-11-12T12:00:00Z");
    assert.equal(bad.ok, false);
    assert.match(bad.failures[0], /credit supply rule is broken/);
  });
});

describe("an agent observes a change and adapts (the Done line of DK76)", () => {
  /** A scripted agent that must buy 10 units of work in the cheaper of two classes at the prices in force: it reads the world, never a tier or a standing. */
  const choose = (state: ReturnType<typeof worldStateAt>) => {
    const list = { code: 100, research: 120 };
    const price = (c: keyof typeof list) => effectivePrice(list[c], c, state);
    return price("code") <= price("research") ? "code" : "research";
  };
  test("it buys code while code is cheap, switches to research when a shock doubles the price of code, and goes back when the operator halts the shock", async () => {
    const log = await freshLog();
    await log.append(rec(world, shock(T0), iso(T0 - 5 * DAY)));
    const at = (h: number) => iso(T0 + h * HOUR);
    assert.equal(choose(await log.worldState(iso(T0 - 6 * DAY))), "code", "before the shock");
    assert.equal(choose(await log.worldState(at(1))), "research", "the shock makes code dear: it adapts");
    await log.append(rec(operator, { kind: "halt", reason: "the shock is hurting newcomers" }, at(2)));
    assert.equal(choose(await log.worldState(at(3))), "code", "the kill-switch stopped the shock: it goes back");
    assert.equal(choose(await log.worldState(at(1))), "research", "and the record of the hour before is unchanged");
  });
});
