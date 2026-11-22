// DK1801, the engagement engine (packages/asp-package/src/cohort/life.ts): durations, the simulated clock, the wake limits (delay and coalesce), the notebook cap, suspending and waking with no model call between, leave.
// A fake clock and a fake sleep: nothing waits in real time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { arrivalAt, fmtSim, Life, parseArrivals, parseSimDuration, SimClock, WakeGovernor, DEFAULT_LIFE_LIMITS, type EventSource, type LifeEvent } from "../src/index.ts";

/** A clock the test moves: 1 real ms is 1 simulated ms (speed 1000 simulated seconds per real second = 1000 ms per ms). */
function fake() {
  let real = 0;
  const clock = new SimClock({ speed: 1000, now: () => real });
  const sleep = async (ms: number) => { real += ms; };
  return { clock, sleep, advanceSim: (simMs: number) => { real += simMs / 1000; }, sleeps: () => real };
}
const ctx = (agent = "a") => ({ agent, turn: 1, now: () => "t", signal: new AbortController().signal });

test("durations are read as the model writes them, and shown the same way", () => {
  assert.equal(parseSimDuration("30m"), 30 * 60_000);
  assert.equal(parseSimDuration("2h"), 2 * 3_600_000);
  assert.equal(parseSimDuration("1d"), 86_400_000);
  assert.equal(parseSimDuration("90s"), 90_000);
  assert.equal(parseSimDuration(15), 15 * 60_000);
  assert.equal(parseSimDuration("soon"), undefined);
  assert.equal(parseSimDuration("-3h"), undefined);
  assert.equal(fmtSim(0), "0m");
  assert.equal(fmtSim(95 * 60_000), "1h35m");
  assert.equal(fmtSim(26 * 3_600_000), "1d02h00m");
  assert.deepEqual(parseArrivals("staggered:3@30"), { size: 3, everySimMs: 30 * 60_000 });
  assert.throws(() => parseArrivals("all"), /staggered/);
  assert.throws(() => parseArrivals("staggered:0@10"), /staggered/);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((i) => arrivalAt({ size: 3, everySimMs: 600_000 }, i)), [0, 0, 0, 600_000, 600_000, 600_000, 1_200_000]);
});

test("the wake governor delays a wake over the agent's hourly limit and over the run's minute limit, and says by how long", () => {
  const f = fake();
  const g = new WakeGovernor({ ...DEFAULT_LIFE_LIMITS, agentWakesPerSimHour: 3, runWakesPerSimMinute: 4 }, f.clock);
  for (let i = 0; i < 3; i++) { assert.equal(g.delayFor("a"), 0); g.record("a"); f.advanceSim(60_000); }
  // three wakes in the last 3 minutes: the fourth waits until the first is an hour old
  const d = g.delayFor("a");
  assert.ok(d > 56 * 60_000 && d <= 57 * 60_000, `delay ${d}`);
  assert.equal(g.delayFor("b"), 0, "another agent is not held by a's limit");
  // run-wide: b, c, d, e, f wake inside one minute
  const g2 = new WakeGovernor({ ...DEFAULT_LIFE_LIMITS, runWakesPerSimMinute: 4 }, f.clock);
  for (const who of ["b", "c", "d", "e"]) { assert.equal(g2.delayFor(who), 0); g2.record(who); }
  assert.ok(g2.delayFor("f") > 0 && g2.delayFor("f") <= 60_000, "the fifth wake of the minute is held to the next minute");
});

test("rest and wait_for suspend with no work in between: a wait ends at the event or at the longest wait, and the observation says what happened since, coalesced", async () => {
  const f = fake();
  const raised: LifeEvent[] = [];
  const source: EventSource = { kinds: ["reply", "vote", "new_job"], async poll(_a, cursor) { const from = Number(cursor ?? 0); const evs = raised.filter((_e, i) => i >= from); return { events: evs, cursor: raised.length }; } };
  const life = new Life({ clock: f.clock, source, notebookDir: mkdtempSync(join(tmpdir(), "asp-life-")), sleep: f.sleep, limits: { pollRealMs: 10 } });
  const a = life.agent("a");
  const [rest, waitFor] = [a.tools().find((t) => t.name === "rest")!, a.tools().find((t) => t.name === "wait_for")!];
  // rest 2h: wakes at the time, nothing happened
  const t0 = f.clock.now();
  const r1 = await rest.run({ until: "2h" }, ctx());
  assert.equal(r1.ok, true); assert.equal(r1.reset, true);
  assert.ok(f.clock.now() - t0 >= 2 * 3_600_000 - 1000, "two simulated hours passed");
  assert.match(r1.text, /woke because the time you gave ran out/);
  assert.match(r1.text, /nothing that concerns you happened/);
  // wait for a reply up to a day: three events arrive while it waits, one wake, all three told, nothing else is cut
  raised.push({ kind: "vote", at: 1, text: "bo voted up on what you wrote" }, { kind: "reply", at: 2, text: "cy answered you: hello" }, { kind: "vote", at: 3, text: "di voted up on what you wrote" });
  const r2 = await waitFor.run({ events: ["reply"], max_wait: "1d" }, ctx());
  assert.match(r2.text, /woke because something you were waiting for happened \(reply\)/);
  assert.match(r2.text, /3 things happened/);
  assert.match(r2.text, /cy answered you: hello/);
  assert.ok(f.clock.now() < 3 * 3_600_000, "it woke at the event, not at the day");
  assert.equal(a.wakeCount(), 2);
});

test("waits are refused when they are a storm, unreadable, for something this world never raises, or too long; none of them suspends", async () => {
  const f = fake();
  const life = new Life({ clock: f.clock, source: { kinds: ["reply"], poll: async () => ({ events: [], cursor: 1 }) }, notebookDir: mkdtempSync(join(tmpdir(), "asp-life-")), sleep: f.sleep });
  const t = life.agent("a").tools();
  const rest = t.find((x) => x.name === "rest")!, wait = t.find((x) => x.name === "wait_for")!;
  const before = f.sleeps();
  const storm = await rest.run({ until: "30s" }, ctx()) as { ok: boolean; refused?: string; text: string };
  assert.equal(storm.ok, false); assert.equal(storm.refused, "wake_storm"); assert.match(storm.text, /shortest wait is 5m/);
  assert.equal((await wait.run({ events: ["reply"], max_wait: "1m" }, ctx()) as { refused?: string }).refused, "wake_storm");
  assert.equal((await rest.run({ until: "whenever" }, ctx()) as { refused?: string }).refused, "bad_input");
  const na = await wait.run({ events: ["offer"], max_wait: "1h" }, ctx()) as { refused?: string; text: string };
  assert.equal(na.refused, "not_available"); assert.match(na.text, /offer cannot happen in this run.*you can wait for: time, reply/);
  assert.equal((await wait.run({ events: ["reply"], max_wait: "30d" }, ctx()) as { refused?: string }).refused, "bad_input");
  assert.equal((await wait.run({ events: ["nonsense"], max_wait: "1h" }, ctx()) as { refused?: string }).refused, "bad_input");
  assert.equal(f.sleeps(), before, "nothing waited");
});

test("a wake over the limit is held and the events that arrive meanwhile join it (coalescing)", async () => {
  const f = fake();
  const raised: LifeEvent[] = [];
  const source: EventSource = { kinds: ["reply"], async poll(_a, c) { const from = Number(c ?? 0); const evs = raised.slice(from); return { events: evs, cursor: raised.length }; } };
  const woken: Array<{ delayedSimMs: number; events: number }> = [];
  const life = new Life({ clock: f.clock, source, notebookDir: mkdtempSync(join(tmpdir(), "asp-life-")), limits: { agentWakesPerSimHour: 1, pollRealMs: 5 }, onWake: (w) => woken.push({ delayedSimMs: w.delayedSimMs, events: w.events }),
    // while the wake is held, a second reply arrives
    sleep: async (ms) => { f.advanceSim(ms * 1000); if (!raised.some((e) => e.at === 99)) raised.push({ kind: "reply", at: 99, text: "late reply" }); } });
  const wait = life.agent("a").tools().find((x) => x.name === "wait_for")!;
  raised.push({ kind: "reply", at: 1, text: "first reply" });
  await wait.run({ events: ["reply"], max_wait: "1d" }, ctx());               // wake 1: now
  raised.push({ kind: "reply", at: 2, text: "second reply" });
  const r = await wait.run({ events: ["reply"], max_wait: "1d" }, ctx());      // wake 2: over the hourly limit of 1: held about an hour
  assert.ok(woken[1]!.delayedSimMs > 50 * 60_000, `held ${woken[1]!.delayedSimMs}`);
  assert.match(r.text, /held .* to keep the society's wake rate down/);
  assert.match(r.text, /second reply/); assert.match(r.text, /late reply/);
  assert.equal(woken[1]!.events, 2, "the two replies came as one wake");
});

test("the notebook is capped, persisted in the run folder, and kept across wakes; leave is voluntary, ends the loop and is recorded with its reason", async () => {
  const f = fake();
  const dir = mkdtempSync(join(tmpdir(), "asp-life-"));
  const life = new Life({ clock: f.clock, notebookDir: dir, sleep: f.sleep, limits: { notebookChars: 50 } });
  const a = life.agent("agent-01");
  const t = (n: string) => a.tools().find((x) => x.name === n)!;
  assert.match((await t("notebook_read").run({}, ctx())).text, /\(empty\)/);
  assert.equal((await t("notebook_write").run({ text: "met bo; owes me a reply" }, ctx())).ok, true);
  assert.equal((await t("notebook_write").run({ text: "ask about jobs", mode: "append" }, ctx())).ok, true);
  assert.equal(readFileSync(join(dir, "agent-01.md"), "utf8"), "met bo; owes me a reply\nask about jobs");
  const over = await t("notebook_write").run({ text: "x".repeat(40), mode: "append" }, ctx()) as { ok: boolean; refused?: string };
  assert.equal(over.ok, false); assert.equal(over.refused, "notebook_full");
  assert.equal(readFileSync(join(dir, "agent-01.md"), "utf8"), "met bo; owes me a reply\nask about jobs", "a refused write changes nothing");
  // the notebook comes back with every wake, and a new Life over the same folder loads it
  assert.match((await t("rest").run({ until: "10m" }, ctx())).text, /Your notebook \(\d+ of 50 characters\):\nmet bo/);
  assert.match(new Life({ clock: f.clock, notebookDir: dir, limits: { notebookChars: 50 } }).agent("agent-01").notebookText(), /met bo/);
  const left = await t("leave").run({ reason: "I have what I came for" }, ctx());
  assert.equal(left.end, true); assert.equal(left.leave, "I have what I came for");
  assert.notEqual(left.reset, true);
});

test("an abort ends a suspended agent at once, with no wake counted", async () => {
  const f = fake();
  const life = new Life({ clock: f.clock, notebookDir: mkdtempSync(join(tmpdir(), "asp-life-")), sleep: () => new Promise<void>((r) => setTimeout(r, 2)) });
  const ac = new AbortController();
  const rest = life.agent("a").tools().find((x) => x.name === "rest")!;
  setTimeout(() => ac.abort(), 5);
  const r = await rest.run({ until: "2d" }, { agent: "a", turn: 1, now: () => "t", signal: ac.signal });
  assert.match(r.text, /run is ending/);
  assert.equal(life.agent("a").wakeCount(), 0);
});
