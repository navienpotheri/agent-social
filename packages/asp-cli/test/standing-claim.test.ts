/**
 * Two sessions of one agent starting at once (register row T3): neither loses the other's session count, and two that both made a standing job end up on the same one. Includes a real race of several
 * processes on one standing.json. Fake data only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { claimStanding, readStanding, type StandingJob } from "../src/standing.ts";

const job = (contract: string, sessions = 0): StandingJob => ({ contract, agent: "did:web:example.com:agents:coder", key: "k", createdAt: "2026-11-14T10:00:00Z", expiresAt: "2026-11-21T10:00:00Z", scopes: ["repo.read"], hosts: [], sessions });
const home = () => mkdtempSync(join(tmpdir(), "asp-standing-"));

test("two sessions that both read the job before either wrote it each add themselves: the count is 2, not 1", () => {
  const h = home();
  const a = claimStanding(h, "k", job("c1"), true), b = claimStanding(h, "k", job("c1"), false); // b still holds a stale copy with 0 sessions
  assert.equal(a.job.sessions, 1);
  assert.equal(b.job.sessions, 2);
  assert.equal(readStanding(h).k.sessions, 2);
});

test("two sessions that each made a standing job end up on the first one's, and the count covers both", () => {
  const h = home();
  const a = claimStanding(h, "k", job("c-first"), true);
  const b = claimStanding(h, "k", job("c-second"), true);
  assert.equal(a.adopted, false);
  assert.equal(b.adopted, true);
  assert.equal(b.job.contract, "c-first");
  assert.equal(readStanding(h).k.contract, "c-first");
  assert.equal(readStanding(h).k.sessions, 2);
});

test("--prepare makes sure the job exists without counting a session, and a job for another key is untouched", () => {
  const h = home();
  claimStanding(h, "other", { ...job("c-other"), key: "other" }, true);
  assert.equal(claimStanding(h, "k", job("c1"), true, false).job.sessions, 0);
  assert.equal(readStanding(h).other.sessions, 1);
});

test("six processes claiming 15 times each on one standing.json lose none (90 sessions)", async () => {
  const h = home();
  const script = fileURLToPath(new URL("./standing-claim-worker.mjs", import.meta.url));
  const run = () => new Promise<number>((resolve) => { const c = spawn(process.execPath, [script, h], { stdio: "ignore" }); c.on("close", (code) => resolve(code ?? 1)); });
  const codes = await Promise.all(Array.from({ length: 6 }, run));
  assert.deepEqual(codes, [0, 0, 0, 0, 0, 0]);
  const stored = readStanding(h).k;
  assert.equal(stored.sessions, 90);
  assert.equal(stored.contract, "c-race", "one standing job");
});
