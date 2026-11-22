// The lost wake-up of the owner's P0 (2026-11-23): an event that happened before an agent began to wait was never seen, because the event source took its baseline at the agent's FIRST WAIT. A wake must never depend on
// timing. Deterministic tests with a fake society (no clock, no network): a reply posted BEFORE the agent's first wait_for, a reply posted DURING the exit check, two replies coalesced into one wake, a vote that came
// before, and a job that appears after the arrival (new) against one that was already there (not news). The fake answers the same routes as the local society.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Life, SimClock } from "@agent-social/asp-package";
import { societySource } from "../src/cohort/events.ts";
import type { WorldApi } from "../src/cohort/types.ts";

type Reply = { seq: number; kind: "comment" | "vote"; by: string; handle: string; on: string; text?: string; value?: 1 | -1 };
function fakeSociety() {
  const replies: Reply[] = [];
  let jobs: string[] = ["job-old"];
  const world: WorldApi = {
    base: "http://fake", now: () => new Date(),
    async get(path) {
      if (path.startsWith("/forum/head")) return { status: 200, text: JSON.stringify({ seq: replies.length }) };
      if (path.startsWith("/forum/replies")) {
        const since = Number(/since=(\d+)/.exec(path)![1]);
        const out = replies.filter((r) => r.seq > since);
        return { status: 200, text: JSON.stringify({ ok: true, replies: out, next_since: out.length ? out[out.length - 1]!.seq : since }) };
      }
      if (path.startsWith("/market/board")) return { status: 200, text: JSON.stringify(jobs.map((id) => ({ id }))) };
      return { status: 404, text: "" };
    },
    async postJson() { return { status: 404, json: {} }; },
  };
  const comment = (text: string, handle = "bo") => replies.push({ seq: replies.length + 1, kind: "comment", by: "did:key:zB", handle, on: "post-1", text });
  const vote = (handle = "cy") => replies.push({ seq: replies.length + 1, kind: "vote", by: "did:key:zC", handle, on: "post-1", value: 1 });
  return { world, comment, vote, addJob: (id: string) => jobs.push(id) };
}
function setup(s: ReturnType<typeof fakeSociety>) {
  let real = 0;
  const clock = new SimClock({ speed: 1000, now: () => real });
  const source = societySource({ world: s.world, didOf: () => "did:key:zA", clock });
  const life = new Life({ clock, source, notebookDir: mkdtempSync(join(tmpdir(), "asp-race-")), sleep: async (ms) => { real += ms; }, limits: { pollRealMs: 10 } });
  const ctx = () => ({ agent: "a", turn: 1, now: () => "t", signal: new AbortController().signal });
  const t = (n: string) => life.agent("a").tools().find((x) => x.name === n)!;
  return { life, clock, t, ctx, source, advance: (ms: number) => { real += ms; } };
}

test("a reply posted BEFORE the agent's first wait_for is seen by that wait_for, which wakes at once (not at the longest wait)", async () => {
  const s = fakeSociety();
  const x = setup(s);
  await x.source.prime!("a");                       // the arrival
  s.comment("Welcome, A. I am B.");                 // B answers before A has begun to wait
  const t0 = x.clock.now();
  const r = await x.t("wait_for").run({ events: ["reply"], max_wait: "12h" }, x.ctx());
  assert.match(r.text, /woke because something you were waiting for happened \(reply\)/);
  assert.match(r.text, /bo answered you: Welcome, A\. I am B\./);
  assert.ok(x.clock.now() - t0 < 60_000, `woke at once, after ${x.clock.now() - t0} simulated ms`);
});

test("the same without any prime (a source used by someone who never calls it): the first poll still returns what is there, it does not take it as the baseline", async () => {
  const s = fakeSociety();
  const x = setup(s);
  s.comment("hello before anything");
  const r = await x.t("wait_for").run({ events: ["reply"], max_wait: "12h" }, x.ctx());
  assert.match(r.text, /hello before anything/);
});

test("a reply posted DURING the exit check is listed by the check and is still delivered to the next wait_for, which wakes at once", async () => {
  const s = fakeSociety();
  const x = setup(s);
  await x.source.prime!("a");
  const check = await x.t("leave").run({ reason: "I think I am done" }, x.ctx());     // the check polls the society
  assert.match(check.text, /0 replies to what you wrote/);
  s.comment("a reply that arrives right after the check");
  const check2 = await x.t("leave").run({ reason: "still done" }, x.ctx());           // (a second call confirms; the reply must not be lost to it either)
  assert.equal(check2.end, true);
  // a fresh agent: the reply lands between the exit check and the wait
  const s2 = fakeSociety(); const y = setup(s2);
  await y.source.prime!("a");
  await y.t("leave").run({ reason: "done" }, y.ctx());
  s2.comment("between the check and the wait");
  const t0 = y.clock.now();
  const r = await y.t("wait_for").run({ events: ["reply"], max_wait: "12h" }, y.ctx());
  assert.match(r.text, /between the check and the wait/);
  assert.ok(y.clock.now() - t0 < 60_000, "woke at once");
});

test("a reply that the exit check itself saw stays in the agent's queue: the next wait_for wakes on it at once", async () => {
  const s = fakeSociety();
  const x = setup(s);
  await x.source.prime!("a");
  s.comment("seen by the check");
  const check = await x.t("leave").run({ reason: "done" }, x.ctx());
  assert.match(check.text, /1 reply to what you wrote/);
  const t0 = x.clock.now();
  const r = await x.t("wait_for").run({ events: ["reply"], max_wait: "12h" }, x.ctx());
  assert.match(r.text, /seen by the check/);
  assert.ok(x.clock.now() - t0 < 60_000);
});

test("two replies and a vote that came before the wait are coalesced into ONE wake that tells all three", async () => {
  const s = fakeSociety();
  const x = setup(s);
  await x.source.prime!("a");
  s.comment("first reply", "bo"); s.vote("cy"); s.comment("second reply", "di");
  const r = await x.t("wait_for").run({ events: ["reply"], max_wait: "12h" }, x.ctx());
  assert.match(r.text, /3 things happened/);
  assert.match(r.text, /first reply/); assert.match(r.text, /second reply/); assert.match(r.text, /cy voted up/);
  assert.equal(x.life.agent("a").wakeCount(), 1, "one wake");
  // and nothing is delivered twice: the next wait sees nothing new and waits for the time
  const t0 = x.clock.now();
  const r2 = await x.t("wait_for").run({ events: ["reply"], max_wait: "1h" }, x.ctx());
  assert.match(r2.text, /the time you gave ran out/);
  assert.ok(x.clock.now() - t0 >= 3_600_000 - 1000);
});

test("a job on the board at the arrival is not news, a job posted after the arrival is, even if it appears before the agent's first wait", async () => {
  const s = fakeSociety();
  const x = setup(s);
  await x.source.prime!("a");                       // job-old is on the board at the arrival
  s.addJob("job-new");                              // posted before the agent waits
  const r = await x.t("wait_for").run({ events: ["new_job"], max_wait: "12h" }, x.ctx());
  assert.match(r.text, /woke because something you were waiting for happened \(new_job\)/);
  assert.match(r.text, /a new job is on the board: job-new/);
  assert.doesNotMatch(r.text, /job-old/);
});
