import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { Limits } from "../src/limits.ts";

// Gaps O2, O19: the lockout after failed sign-ins is shared between the processes of one service and survives a restart.
const state = () => join(mkdtempSync(join(tmpdir(), "lim-")), "limits-state.json");
const opts = (stateFile: string, now: () => number) => ({ failedAuthMax: 3, failedAuthWindowSec: 300, addressPerMinute: 0, stateFile, now });

test("without a state file the lockout is per process, as before", () => {
  let t = 1_000_000;
  const a = new Limits({ failedAuthMax: 3, now: () => t }), b = new Limits({ failedAuthMax: 3, now: () => t });
  for (let i = 0; i < 3; i++) a.authFailed("203.0.113.9");
  assert.equal(a.checkAddress("203.0.113.9").ok, false);
  assert.equal(b.checkAddress("203.0.113.9").ok, true, "another process knows nothing");
});

test("two limiters on one state file share the lockout, and a new one after a restart keeps it", () => {
  let t = 1_000_000;
  const f = state();
  const a = new Limits(opts(f, () => t)), b = new Limits(opts(f, () => t));
  a.authFailed("203.0.113.9"); b.authFailed("203.0.113.9"); a.authFailed("203.0.113.9");
  assert.equal(b.checkAddress("203.0.113.9").ok, false, "three failures split between two processes lock the address in both");
  assert.equal(a.checkAddress("203.0.113.9").ok, false);
  assert.equal(b.checkAddress("198.51.100.7").ok, true, "another address is not locked");
  const restarted = new Limits(opts(f, () => t));
  const v = restarted.checkAddress("203.0.113.9");
  assert.equal(v.ok, false, "a restart does not clear it");
  assert.match(v.why ?? "", /failed sign-ins/);
  t += 301_000;
  assert.equal(new Limits(opts(f, () => t)).checkAddress("203.0.113.9").ok, true, "the lockout ends with its window");
});

test("the file holds no address, only a salted hash, and stays small", () => {
  let t = 1_000_000;
  const f = state();
  const l = new Limits(opts(f, () => t));
  for (let i = 0; i < 3; i++) l.authFailed("203.0.113.9");
  const text = readFileSync(f, "utf8");
  assert.equal(text.includes("203.0.113.9"), false);
  const salt = readFileSync(`${f}.salt`, "utf8").trim();
  assert.equal(salt.length, 64);
  assert.equal(readdirSync(join(f, "..")).some((n) => n.endsWith(".part") || n.endsWith(".lock")), false, "no temporary files left");
  t += 400_000;
  l.authFailed("198.51.100.7");
  assert.equal(Object.keys(JSON.parse(readFileSync(f, "utf8")).failures).length, 1, "an old lockout is dropped on the next write");
});

test("a damaged state file is ignored, and the next write replaces it", () => {
  const f = state();
  const l0 = new Limits(opts(f, Date.now));
  l0.authFailed("203.0.113.9");
  require_("node:fs").writeFileSync(f, "{not json");
  const l = new Limits(opts(f, Date.now));
  assert.equal(l.checkAddress("203.0.113.9").ok, true);
  l.authFailed("203.0.113.9");
  assert.ok(JSON.parse(readFileSync(f, "utf8")).failures);
});

test("separate processes failing at the same moment lock the address exactly when the limit is reached", () => {
  const f = state();
  const mod = pathToFileURL(fileURLToPath(new URL("../src/limits.ts", import.meta.url))).href;
  const script = `import { Limits } from ${JSON.stringify(mod)};
const l = new Limits({ failedAuthMax: 20, failedAuthWindowSec: 300, addressPerMinute: 0, stateFile: ${JSON.stringify(f)} });
for (let i = 0; i < 4; i++) l.authFailed("203.0.113.9");
console.log("done");`;
  const procs = Array.from({ length: 5 }, () => spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" }));
  assert.equal(procs.every((p) => p.status === 0), true, procs.map((p) => p.stderr).join(""));
  // 5 processes x 4 failures = 20 = the limit: every failure counted, none lost to a race, so the address is locked.
  assert.equal(new Limits({ failedAuthMax: 20, failedAuthWindowSec: 300, addressPerMinute: 0, stateFile: f }).checkAddress("203.0.113.9").ok, false);
});

function require_(m: string) { return { writeFileSync: (f: string, d: string) => writeFileSyncImpl(f, d) }; }
import { writeFileSync as writeFileSyncImpl } from "node:fs";
