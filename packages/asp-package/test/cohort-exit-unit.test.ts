// The exit logic of the engagement engine (life.ts), at the unit level: the exit check is asked again after a wake, a text-only turn rests until an event it can be woken by and is ended after too many idles, and a
// confirmed leave tells how long the agent had stayed since its own arrival and what was waiting for it. A fake clock and sleep.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Life, SimClock, type EventSource, type LifeEvent, type LifeNote } from "../src/index.ts";

function fake() {
  let real = 0;
  const clock = new SimClock({ speed: 1000, now: () => real });
  return { clock, sleep: async (ms: number) => { real += ms; }, advanceSim: (simMs: number) => { real += simMs / 1000; } };
}
const ctx = () => ({ agent: "a", turn: 1, now: () => "t", signal: new AbortController().signal });
const mk = (f: ReturnType<typeof fake>, over: { source?: EventSource; notes?: LifeNote[]; limits?: Record<string, number> } = {}) =>
  new Life({ clock: f.clock, sleep: f.sleep, notebookDir: mkdtempSync(join(tmpdir(), "asp-exit-")), ...(over.source ? { source: over.source } : {}), onNote: (n) => over.notes?.push(n), ...(over.limits ? { limits: over.limits } : {}) });

test("a wake asks for a new exit check: leave, rest, leave shows the check again, and only the next call leaves", async () => {
  const f = fake();
  const t = (l: Life, n: string) => l.agent("a").tools().find((x) => x.name === n)!;
  const life = mk(f);
  assert.notEqual((await t(life, "leave").run({ reason: "done" }, ctx())).end, true);
  await t(life, "rest").run({ until: "10m" }, ctx());
  const again = await t(life, "leave").run({ reason: "done" }, ctx());
  assert.notEqual(again.end, true, "after a wake the first leave is a check again");
  assert.match(again.text, /Exit check/);
  assert.equal((await t(life, "leave").run({ reason: "done" }, ctx())).end, true);
});

test("a confirmed leave says how long the agent had stayed since ITS arrival and how many events were waiting; a differing second reason is kept with the first", async () => {
  const f = fake();
  const notes: LifeNote[] = [];
  const waiting: LifeEvent[] = [{ kind: "reply", at: 1, text: "bo answered you" }, { kind: "vote", at: 2, text: "cy voted" }];
  const source: EventSource = { kinds: ["reply", "vote"], async poll() { return { events: waiting.splice(0), cursor: 2 }; } };
  const life = mk(f, { source, notes });
  f.advanceSim(3 * 3_600_000);                                       // the run is three simulated hours old when this agent arrives
  const a = life.agent("a");
  a.observation("You are here now.");                                // arrival
  f.advanceSim(7 * 60_000);
  const t = (n: string) => a.tools().find((x) => x.name === n)!;
  const check = await t("leave").run({ reason: "I am done" }, ctx());
  assert.match(check.text, /1 reply to what you wrote; 1 vote on what you wrote/, "the exit check lists what is open");
  const left = await t("leave").run({ reason: "really done" }, ctx());
  assert.equal(left.leave, "I am done / really done");
  const note = notes.find((n) => n.kind === "leave") as Extract<LifeNote, { kind: "leave" }>;
  assert.ok(Math.abs(note.sinceArrivalSimMs - 7 * 60_000) < 2000, `stayed ${note.sinceArrivalSimMs} ms since arrival, not since the run began`);
  assert.equal(note.pending, 2, "two things were waiting");
  assert.equal(note.afterCheck, true);
});

test("a text-only turn rests until an event it can be woken by (not only the time), and an agent that idles too often is ended", async () => {
  const f = fake();
  const raised: LifeEvent[] = [];
  const source: EventSource = { kinds: ["reply"], async poll(_a, c) { const from = Number(c ?? 0); return { events: raised.slice(from), cursor: raised.length }; } };
  const life = mk(f, { source, limits: { maxIdles: 2, pollRealMs: 5 } });
  const a = life.agent("a");
  raised.push({ kind: "reply", at: 1, text: "bo answered you" });
  const t0 = f.clock.now();
  const woke = await a.idle("I have nothing to do.", new AbortController().signal);
  assert.ok(woke && /not leaving: you stayed/.test(woke) && /bo answered you/.test(woke));
  assert.ok(f.clock.now() - t0 < 3_600_000, "woken by the event, long before the idle limit of a day");
  assert.ok(await a.idle("Still nothing.", new AbortController().signal));
  assert.equal(await a.idle("Nothing again.", new AbortController().signal), undefined, "the third idle is over the limit: the agent is ended");
});
