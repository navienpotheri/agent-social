// DK1362: limits by plan and by tenant, and the batched append route, through the real service. Fake tokens and keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BATCH_MAX, Limits, PLANS, batchLimit, effectiveLimits, hashToken } from "@agent-social/asp-log";
import { LocalLog, RemoteLog } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

test("a tenant's own figure beats its plan's, and its plan's beats the default; a batch is at most a quarter of a minute's writes and never more than 200", () => {
  assert.deepEqual(effectiveLimits({}), {});
  assert.equal(effectiveLimits({ plan: "enterprise" }).writeLimitPerMinute, 12_000);
  assert.equal(effectiveLimits({ plan: "enterprise", writeLimitPerMinute: 500 }).writeLimitPerMinute, 500);
  assert.equal(effectiveLimits({ plan: "team" }).recordQuota, PLANS.team.recordQuota);
  assert.equal(effectiveLimits({ plan: "enterprise" }).recordQuota, 0, "no limit, billed by use");
  assert.equal(effectiveLimits({ plan: "nonsense" }).rateLimitPerMinute, undefined);
  assert.deepEqual([batchLimit(4), batchLimit(120), batchLimit(12_000), batchLimit(0), BATCH_MAX], [1, 30, 200, 200, 200], "0 is no limit");
});

test("the write allowance pays for each record of a batch at once, a tenant's own rate applies, and a batch larger than the allowance is refused whole", () => {
  let t = 0;
  const l = new Limits({ appendPerMinute: 120, now: () => t });
  assert.equal(l.checkWrite("a", undefined, 30).ok, true, "a batch of 30 uses the whole burst of a 120-a-minute tenant");
  assert.equal(l.checkWrite("a", undefined, 1).ok, false, "and the next write waits");
  assert.equal(l.checkWrite("a", undefined, 31).why?.includes("more than this tenant's write allowance can pay for at once"), true);
  t += 15_000;                                                    // a quarter of a minute gives back 30
  assert.equal(l.checkWrite("a", undefined, 30).ok, true);
  const fast = new Limits({ appendPerMinute: 120, now: () => t });
  assert.equal(fast.checkWrite("big", 12_000, 200).ok, true, "a tenant on a 12,000-a-minute plan sends 200 at once");
  assert.equal(fast.checkWrite("big", 12_000, 200).ok, true);
});

test("the service: a batch is appended in order through the same checks, stops at the first record refused, is limited by the tenant's plan, and the operator command sets and shows a plan", async () => {
  // some valid signed records: six people's passports from a local log
  const src = makeFixture();
  const run = async (args: string[]) => { const out: string[] = [], err: string[] = []; const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: src.aspHome }, cwd: src.root }; const code = await main(args, io); assert.equal(code, 0, err.join("\n")); };
  for (let i = 0; i < 6; i++) await run(["identity", "new", "--kind", "human", "--did", `did:web:example.com:users:p${i}`, "--no-recovery"]);
  const records = (await (await LocalLog.open(src.aspHome)).log.since(0, 100)).map((s) => s.record);
  assert.ok(records.length >= 6);

  const dir = mkdtempSync(join(tmpdir(), "asp-fleet-limits-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([
    { name: "acme", role: "tenant", tokenSha256: hashToken("tok-acme"), plan: "starter" },
    { name: "tiny", role: "tenant", tokenSha256: hashToken("tok-tiny"), writeLimitPerMinute: 4 },
    { name: "ops", role: "admin", tokenSha256: hashToken("tok-ops") },
  ]));
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", "0"], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let buf = "";
      server.stdout.on("data", (d) => { buf += d; const m = /listening on (http:\/\/[^ ]+)/.exec(buf); if (m) resolve(m[1]); });
      server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
      setTimeout(() => reject(new Error(`no start line: ${buf}`)), 20_000);
    });
    const acme = new RemoteLog(url, "tok-acme");
    const ok = await acme.appendBatch(records.slice(0, 6));
    assert.deepEqual([ok.appended, ok.of, ok.stoppedAt], [6, 6, undefined], JSON.stringify(ok.results.find((r) => !r.ok)));
    assert.equal((await acme.log.verify()).ok, true);

    // a bad record in the middle stops the batch there: the ones before it stay
    const more = [];
    for (let i = 6; i < 9; i++) await run(["identity", "new", "--kind", "human", "--did", `did:web:example.com:users:p${i}`, "--no-recovery"]);
    const fresh = (await (await LocalLog.open(src.aspHome)).log.since(0, 100)).map((s) => s.record).slice(records.length);
    more.push(fresh[0], { ...fresh[1], body: { ...(fresh[1].body as object), kind: "agent" } }, fresh[2]);
    const part = await acme.appendBatch(more as never);
    assert.deepEqual([part.appended, part.of, part.stoppedAt], [1, 3, 1]);
    assert.equal(part.results[1].ok, false);
    assert.ok(part.results[1].error?.code, "the refusal says why");

    // the plan's batch limit: a starter tenant (120 writes a minute) sends at most 30
    const tooMany = await fetch(new URL("rpc", url.endsWith("/") ? url : url + "/"), { method: "POST", headers: { authorization: "Bearer tok-acme", "content-type": "application/json" }, body: JSON.stringify({ target: "handle", method: "appendBatch", args: [Array(31).fill(records[0])] }) });
    assert.equal(tooMany.status, 400);
    assert.match(JSON.stringify(await tooMany.json()), /appendBatch takes 1 to 30 records/);
    // a tenant with its own write limit of 4 a minute: a batch of one, then it waits
    const tiny = new RemoteLog(url, "tok-tiny");
    assert.equal((await tiny.appendBatch([records[0]])).of, 1);
    const waits = await fetch(new URL("rpc", url.endsWith("/") ? url : url + "/"), { method: "POST", headers: { authorization: "Bearer tok-tiny", "content-type": "application/json" }, body: JSON.stringify({ target: "handle", method: "appendBatch", args: [[records[1]]] }) });
    assert.equal(waits.status, 429, "the next write waits (the client waits and repeats)");
    assert.match(JSON.stringify(await waits.json()), /writing too fast/);

    // the operator sets and shows a plan; the running service reads it at the next request
    const plan = (args: string[]) => spawnSync(process.execPath, [cli, "serve", "plan", "--tokens", tokens, ...args], { encoding: "utf8" });
    assert.match(plan(["--tenant", "tiny"]).stdout, /tiny: plan none .*writes a minute 4/);
    assert.notEqual(plan(["--tenant", "tiny", "--plan", "gold"]).status, 0);
    const set = plan(["--tenant", "tiny", "--plan", "enterprise", "--write-limit", "0"]);
    assert.equal(set.status, 0, set.stderr);
    assert.match(set.stdout, /tiny is now on enterprise/);
    assert.equal((JSON.parse(readFileSync(tokens, "utf8")) as { name: string; plan?: string }[]).find((t) => t.name === "tiny")!.plan, "enterprise");
    assert.equal((await tiny.appendBatch([records[1], records[2]])).of, 2, "with no write limit of its own to hold it, the tenant sends two at once");
  } finally { server.kill(); }
});
