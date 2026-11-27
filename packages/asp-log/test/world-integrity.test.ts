// Worlds integrity (register row DK811; spec-delta S1208): the referee's rules and seeds sit server-side. A scripted agent that tries to read them by a path, a debug call or a cached copy is refused, never obtains them,
// and its attempts are in the log as signed `world_event` records that count as strikes against its standing; an honest agent plays through untouched; with the server-side check removed the same cheat succeeds (the positive
// control: the test fails without the check). Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RefereeWorld, type Reply, type Request } from "../src/referee-world.ts";
import { Kit, registrar, refused, type Party } from "./academy-kit.ts";

const SEED = "season-seed-2026-q4";
const cheats: Request[] = [{ op: "read", path: "/world/rules.json" }, { op: "debug" }, { op: "cache", key: "rules" }];

async function world() {
  const kit = new Kit();
  const sponsor = await kit.person("wi-sponsor");
  const cheat = await kit.agent("wi-cheat", sponsor, 1);
  const honest = await kit.agent("wi-honest", await kit.person("wi-honest-sponsor"), 1);
  const event = (e: Extract<Reply, { ok: false }>["event"], by: Party = registrar) => kit.mk("world_event", by, { ...e }, null, { subject: e.agent });
  return { kit, cheat, honest, event };
}
const strikes = async (kit: Kit, did: string) => (await kit.log.reputationOf(did))!.strikes;

test("a cheating scripted agent never obtains the hidden rule: every route is refused, no reply holds the rule or the seed, and the world's public object does not carry them", async () => {
  const w = new RefereeWorld("refactoring 2026-q4", SEED);
  const replies = cheats.map((c) => w.handle("did:cheat", c));
  assert.ok(replies.every((r) => r.ok === false && r.refused && r.code === "HIDDEN_STATE"));
  const text = JSON.stringify(replies) + JSON.stringify(Object.keys(w)) + JSON.stringify(w);
  assert.ok(!text.includes(SEED), "the seed is nowhere a reader can reach");
  assert.match(w.commitment, /^sha256:[0-9a-f]{64}$/, "only a commitment is published");
  // The cheater can still play; it learns outcomes and no more.
  const plays = [1, 2, 3, 4, 5, 6].map((m) => w.handle("did:cheat", { op: "play", move: m }));
  assert.ok(plays.every((r) => r.ok && "won" in r));
  assert.equal(w.matches(2, SEED) || w.matches(3, SEED) || w.matches(4, SEED) || w.matches(5, SEED) || w.matches(6, SEED) || w.matches(7, SEED) || w.matches(8, SEED) || w.matches(9, SEED) || w.matches(10, SEED), true, "a published rule can be checked against the commitment afterwards");
});

test("the attempts are in the log as signed events with their hashes, each counts once as a strike against the cheater's standing, only the Registrar can record one, and an honest agent has none", async () => {
  const { kit, cheat, honest, event } = await world();
  const w = new RefereeWorld("refactoring 2026-q4", SEED);
  assert.equal(await strikes(kit, cheat.did), 0);
  const events = cheats.map((c) => w.handle(cheat.did, c)).map((r) => (r as Extract<Reply, { ok: false }>).event);
  assert.equal(new Set(events.map((e) => e.attempt.sha256)).size, 3, "each way is its own attempt");
  assert.equal(await refused(kit.put(event(events[0], cheat))), "world_event_wrong_issuer", "an agent cannot file one against another, or against itself");
  for (const e of events) await kit.put(event(e));
  assert.equal(await strikes(kit, cheat.did), 3, "the standing falls: three strikes");
  assert.equal(await refused(kit.put(event(events[0]))), "world_event_known", "one attempt is one event");
  const logged = (await kit.log.recordsOfTypes(["world_event"])).map((r) => (r.body as { attempt: { sha256: string } }).attempt.sha256).sort();
  assert.deepEqual(logged, events.map((e) => e.attempt.sha256).sort(), "every attempt is in the log with its hash");
  assert.ok(!JSON.stringify(await kit.log.recordsOfTypes(["world_event"])).includes(SEED), "the log never holds the hidden state");
  // The honest agent plays through.
  for (const m of [1, 2, 3, 4, 5]) assert.ok((w.handle(honest.did, { op: "play", move: m }) as { ok: true }).ok);
  assert.equal(await strikes(kit, honest.did), 0);
  assert.equal(await refused(kit.put(kit.mk("world_event", registrar, { world: "w", agent: "did:web:nobody.example:agents:ghost", kind: "hidden_state_read", attempt: { via: "path", sha256: "sha256:" + "1".repeat(64) } }, null))), "world_event_not_an_agent");
  assert.equal((await kit.log.verify()).ok, true);
  assert.equal((await kit.log.creditAudit()).verdict, "balanced");
});

test("positive control: with the server-side check removed the same cheat obtains the rule and the seed and nothing is refused, so the test above fails without the check", () => {
  const open = new RefereeWorld("refactoring 2026-q4", SEED, false);
  for (const c of cheats) {
    const r = open.handle("did:cheat", c);
    assert.equal(r.ok, true);
    assert.ok("leaked" in r && r.leaked.includes(SEED), "the cheat reads the seed");
  }
});
