import { test } from "node:test";
import assert from "node:assert/strict";
import { RateLimiter } from "../src/gateway/rate.ts";

test("RateLimiter: calls to one host are counted over a sliding minute, hosts are counted apart, and the total caps them all", () => {
  let t = 1_000_000;
  const r = new RateLimiter(() => t);
  const rate = { per_host_per_minute: 3, total_per_minute: 5 };
  assert.deepEqual([1, 2, 3].map(() => r.take(["a.example"], rate).ok), [true, true, true]);
  const refused = r.take(["a.example"], rate);
  assert.equal(refused.ok, false);
  assert.match(refused.reason!, /a.example was called 3 times in the last minute; this job's Mandate allows 3 a minute to any one host/);
  assert.equal(r.take(["b.example"], rate).ok, true, "another host has its own count");
  assert.equal(r.take(["b.example"], rate).ok, true);
  const total = r.take(["c.example"], rate);
  assert.equal(total.ok, false, "five calls have been made in the minute");
  assert.match(total.reason!, /allows 5 network calls a minute and 5 were made/);
  // The window slides: a minute on, the first host is open again.
  t += 61_000;
  assert.equal(r.take(["a.example"], rate).ok, true);
  // A call with no readable host counts only toward the total.
  const u = new RateLimiter(() => t);
  assert.deepEqual([1, 2, 3, 4].map(() => u.take([], { per_host_per_minute: 1, total_per_minute: 3 }).ok), [true, true, true, false]);
  // A refused call is not counted.
  const w = new RateLimiter(() => t);
  w.take(["x.example"], { per_host_per_minute: 1 });
  for (let i = 0; i < 5; i++) w.take(["x.example"], { per_host_per_minute: 1 });
  t += 61_000;
  assert.equal(w.take(["x.example"], { per_host_per_minute: 1 }).ok, true, "the refused calls did not extend the wait");
});

import { requestsOfCommand } from "../src/gateway/requests.ts";
// @ts-expect-error: plain .mjs without type declarations
import { requestsOfCommand as claudeCount, rateRefusal as claudeRefusal } from "../src/adapters/claude-code-mandate-hook.mjs";
// @ts-expect-error: plain .mjs without type declarations
import { requestsOfCommand as agyCount } from "../src/adapters/antigravity-mandate-hook.mjs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const COMMANDS: Array<[string, number, Record<string, number>]> = [
  ["curl -s https://a.example/x", 1, { "a.example": 1 }],
  ["curl https://a.example/1 https://a.example/2 https://b.example/3", 3, { "a.example": 2, "b.example": 1 }],
  ["curl -s 'http://a.example/page[1-50]'", 50, { "a.example": 50 }],
  ["curl -s 'http://a.example/p{1..8}'", 8, { "a.example": 8 }],
  ["curl -s http://a.example/{a,b,c}", 3, { "a.example": 3 }],
  ["for i in 1 2 3 4 5; do curl -s http://a.example/$i; done", 5, { "a.example": 5 }],
  ["for i in $(seq 1 100); do curl -s http://a.example/$i; done", 100, { "a.example": 100 }],
  ["while true; do curl -s http://a.example/; done", 1000, { "a.example": 1000 }],
  ["seq 1 30 | xargs -I{} curl -s http://a.example/{}", 1000, { "a.example": 1000 }],
  ["wget -r https://a.example/", 1000, { "a.example": 1000 }],
  ["nmap -sS 10.0.0.5", 1000, { "10.0.0.5": 1000 }],
  ["ping -c 4 a.example", 4, { "a.example": 4 }],
  ["ping a.example", 1000, { "a.example": 1000 }],
  ["curl -s http://a.example/1 ; curl -s http://a.example/2", 2, { "a.example": 2 }],
  ["1..20 | ForEach-Object { Invoke-WebRequest -Uri https://a.example/$_ }", 20, { "a.example": 20 }],
  ["echo hi", 0, {}],
];

test("requestsOfCommand counts the requests a shell command makes, per host: URLs, ranges, loops, scanners", () => {
  for (const [cmd, total, perHost] of COMMANDS) {
    const r = requestsOfCommand(cmd);
    assert.equal(r.total, total, cmd);
    for (const [h, n] of Object.entries(perHost)) assert.equal(r.perHost[h], n, `${cmd} -> ${h}`);
  }
});

test("the hooks' copies of the request counter agree with the gateway's on the table of commands, and the hook counts a batched command as its requests", () => {
  for (const [cmd] of COMMANDS) {
    const want = requestsOfCommand(cmd);
    assert.deepEqual(claudeCount(cmd), want, `claude hook: ${cmd}`);
    assert.deepEqual(agyCount(cmd), want, `agy hook: ${cmd}`);
  }
  const ledger = join(mkdtempSync(join(tmpdir(), "rate-")), "calls.ndjson");
  const rate = { per_host_per_minute: 3 };
  const batched = "for i in 1 2 3 4 5 6 7 8; do curl -s http://127.0.0.1:9/$i; done";
  const reason = claudeRefusal("shell.network", batched, [], rate, ledger, 1_000);
  assert.match(reason!, /about 8 requests to 127\.0\.0\.1.*allows 3 a minute to any one host/);
  assert.equal(claudeRefusal("shell.network", "curl -s http://127.0.0.1:9/a", [], rate, ledger, 1_000), undefined);
});

import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

test("H16: a burst of hook processes started at the same moment is counted one after the other, so exactly the limit gets through (both hooks)", async () => {
  for (const hook of ["claude-code-mandate-hook.mjs", "antigravity-mandate-hook.mjs"]) {
    const ledger = join(mkdtempSync(join(tmpdir(), "burst-")), "calls.ndjson");
    const url = pathToFileURL(new URL(`../src/adapters/${hook}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")).href;
    const code = `import(${JSON.stringify(url)}).then((m) => { const r = m.rateRefusal("web.read", undefined, ["https://a.example/x"], { per_host_per_minute: 5 }, ${JSON.stringify(ledger)}, 1000); process.stdout.write(r === undefined ? "ok" : "refused"); });`;
    const outs = await Promise.all(Array.from({ length: 14 }, () => new Promise<string>((resolve) => {
      const p = spawn(process.execPath, ["-e", code], { stdio: ["ignore", "pipe", "inherit"] });
      let out = ""; p.stdout.on("data", (d) => (out += d)); p.on("close", () => resolve(out));
    })));
    assert.equal(outs.filter((o) => o === "ok").length, 5, `${hook}: ${outs.join(",")}`);
    assert.equal(outs.filter((o) => o === "refused").length, 9);
    assert.equal(readFileSync(ledger, "utf8").trim().split("\n").length, 5, "one ledger line for each call that went through");
  }
});

// Gap H15: copies of an agent share one allowance.
import { SharedRateLimiter } from "../src/gateway/rate.ts";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("two limiters on one ledger share the count; another ledger is separate", () => {
  const dir = mkdtempSync(join(tmpdir(), "rate-"));
  let now = 1_000_000;
  const a = new SharedRateLimiter(join(dir, "m1.ndjson"), () => now);
  const b = new SharedRateLimiter(join(dir, "m1.ndjson"), () => now);
  const other = new SharedRateLimiter(join(dir, "m2.ndjson"), () => now);
  const rate = { total_per_minute: 4, per_host_per_minute: 3 };
  assert.equal(a.take(["h.example"], rate).ok, true);
  assert.equal(b.take(["h.example"], rate).ok, true);
  assert.equal(a.take(["h.example"], rate).ok, true);
  const v = b.take(["h.example"], rate);
  assert.equal(v.ok, false, "the fourth call to one host, from the other copy, is over the per-host limit of 3");
  assert.match(v.reason ?? "", /h\.example was called 3 times/);
  assert.equal(other.take(["h.example"], rate).ok, true, "another Mandate has its own allowance");
  now += 61_000;
  assert.equal(b.take(["h.example"], rate).ok, true, "a minute later the window has moved on");
});

test("the message names whose allowance it is", () => {
  const dir = mkdtempSync(join(tmpdir(), "rate-"));
  const l = new SharedRateLimiter(join(dir, "f.ndjson"));
  l.take(["a.example"], { total_per_minute: 1 }, "your fleet limit");
  assert.match(l.take(["b.example"], { total_per_minute: 1 }, "your fleet limit").reason ?? "", /your fleet limit allows 1 network calls a minute/);
});

test("copies in separate processes at the same moment: exactly the allowance gets through", () => {
  const dir = mkdtempSync(join(tmpdir(), "rate-"));
  const ledger = join(dir, "shared.ndjson");
  const mod = fileURLToPath(new URL("../src/gateway/rate.ts", import.meta.url));
  const script = `import { SharedRateLimiter } from ${JSON.stringify(pathToFileURL(mod).href)};
const l = new SharedRateLimiter(${JSON.stringify(ledger)}); let ok = 0;
for (let i = 0; i < 10; i++) if (l.take(["h.example"], { total_per_minute: 20 }).ok) ok++;
console.log(ok);`;
  const procs = Array.from({ length: 5 }, () => spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" }));
  const passed = procs.reduce((n, p) => n + Number(p.stdout.trim()), 0);
  assert.equal(procs.every((p) => p.status === 0), true, procs.map((p) => p.stderr).join(""));
  assert.equal(passed, 20, "five copies asking for 10 each get 20 between them, not 50");
});
