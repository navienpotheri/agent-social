// Row DK546: the timer around the sponsor-less review: it runs the pass every interval, survives a pass that throws, never overlaps two passes, and stops when the server closes. Fake server, short intervals.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { startKeyOnlyReviewTimer } from "../src/keyonly-timer.ts";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("DK546: the timer runs the pass on its interval, reports a failing pass and goes on, and stops when the server closes", async () => {
  const server = createServer();
  let calls = 0; const errors: string[] = [];
  const t = startKeyOnlyReviewTimer({ everyMs: 20, server, onError: (e) => errors.push(e.message), pass: async () => { calls++; if (calls === 2) throw new Error("the log was busy"); } });
  await wait(200);
  assert.ok(calls >= 4, `the pass ran ${calls} times`);
  assert.deepEqual(errors, ["the log was busy"], "one failure, reported, and the timer went on");
  assert.equal(t.runs(), calls);
  server.emit("close");
  const stopped = calls;
  await wait(100);
  assert.equal(calls, stopped, "no pass after the server closed");
});

test("DK546: a pass still running is not started again", async () => {
  const server = createServer();
  let started = 0, finished = 0;
  const t = startKeyOnlyReviewTimer({ everyMs: 10, server, pass: async () => { started++; await wait(120); finished++; } });
  await wait(100);
  assert.equal(started, 1, "the slow pass was not overlapped");
  assert.equal(finished, 0);
  await wait(100);
  assert.ok(finished >= 1);
  t.stop();
  const s = started; await wait(60);
  assert.equal(started, s, "stop() ends it");
});
