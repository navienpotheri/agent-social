import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { UsageStore, createLogServer, hashToken, type Tenant } from "@agent-social/asp-log";
import { LocalLog } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });

function client(url: string, token: string) {
  const home = mkdtempSync(join(tmpdir(), "asp-admin-client-"));
  return async (args: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home, ASP_LOG_URL: url, ASP_LOG_TOKEN: token }, cwd: home };
    const code = await main(args, io);
    return { code, out: out.join("\n"), err: err.join("\n") };
  };
}
const did = (n: number) => `did:web:example.com:users:u${n}`;
const newIdentity = (c: ReturnType<typeof client>, n: number) => c(["identity", "new", "--kind", "human", "--did", did(n)]);

test("UsageStore keeps counts across a restart", () => {
  const path = join(mkdtempSync(join(tmpdir(), "asp-usage-")), "usage.json");
  const a = new UsageStore(path);
  a.add("team-a", 2, 900);
  a.add("team-a", 1, 100);
  a.flush();
  assert.deepEqual(new UsageStore(path).get("team-a"), { records: 3, bytes: 1000 });
  assert.deepEqual(new UsageStore(path).get("nobody"), { records: 0, bytes: 0 });
  assert.deepEqual(new UsageStore(join(tmpdir(), "does-not-exist-usage.json")).all(), {});
});

test("a tenant's quota stops its writes once used; its own quota replaces the default, admins have none, and usage is counted", async () => {
  const tenants: Tenant[] = [
    { name: "small", role: "tenant", tokenSha256: hashToken("small-token") },
    { name: "own", role: "tenant", tokenSha256: hashToken("own-token"), recordQuota: 1 },
    { name: "big", role: "tenant", tokenSha256: hashToken("big-token"), recordQuota: 0 },
    { name: "ops", role: "admin", tokenSha256: hashToken("ops-token") },
  ];
  const usage = new UsageStore();
  const server = createLogServer({ handle: await LocalLog.open(mkdtempSync(join(tmpdir(), "asp-quota-"))), tenants, usage, defaultRecordQuota: 2 });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  const small = client(url, "small-token");
  assert.equal((await newIdentity(small, 1)).code, 0);
  assert.equal((await newIdentity(small, 2)).code, 0);
  const over = await newIdentity(small, 3);
  assert.equal(over.code, 1);
  assert.match(over.err, /this tenant has used its quota of 2 records \(2 written\)/);
  assert.match(over.err, /QUOTA_EXCEEDED/);
  assert.doesNotMatch(over.err, /set ASP_LOG_TOKEN/, "a quota is not a token problem");
  assert.deepEqual([usage.get("small").records, usage.get("small").bytes > 100], [2, true]);
  // Reads are not counted or refused.
  assert.equal((await small(["identity", "show", did(1)])).code, 0);

  const own = client(url, "own-token");
  assert.equal((await newIdentity(own, 11)).code, 0);
  assert.equal((await newIdentity(own, 12)).code, 1, "its own quota of 1 replaces the default of 2");
  const big = client(url, "big-token");
  for (const n of [21, 22, 23, 24]) assert.equal((await newIdentity(big, n)).code, 0, "0 means no limit");
  const ops = client(url, "ops-token");
  for (const n of [31, 32, 33]) assert.equal((await newIdentity(ops, n)).code, 0, "an admin has no quota");
  assert.equal(usage.get("big").records, 4);
});

test("a byte quota counts the size of what is written", async () => {
  const usage = new UsageStore();
  const server = createLogServer({ handle: await LocalLog.open(mkdtempSync(join(tmpdir(), "asp-bytes-"))), tenants: [{ name: "t", role: "tenant", tokenSha256: hashToken("t-token") }], usage, defaultByteQuota: 200 });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const c = client(`http://127.0.0.1:${(server.address() as { port: number }).port}`, "t-token");
  const r = await newIdentity(c, 1);
  assert.equal(r.code, 1);
  assert.match(r.err, /quota of 200 bytes of records/);
  assert.equal(usage.get("t").records, 0, "a refused write is not counted");
});

// ---------- an operator at work on a running service ----------

test("asp serve: suspend, block and usage take effect on a running service without a restart", async () => {
  const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), "asp-admin-e2e-"));
  const tokens = join(dir, "tokens.json");
  const run = (args: string[]) => new Promise<{ code: number; out: string; err: string }>((resolve) => {
    const c = spawn(process.execPath, [cli, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (err += d));
    c.on("close", (code) => resolve({ code: code ?? 1, out, err }));
  });
  const token = (await run(["serve", "token", "--tokens", tokens, "--tenant", "team-a", "--record-quota", "50"])).out.trim().split("\n").at(-1)!;
  await run(["serve", "token", "--tokens", tokens, "--tenant", "ops", "--role", "admin"]);

  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", "0"], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let buf = "";
      server.stdout.on("data", (d) => { buf += d; const m = /listening on (http:\/\/[^ ]+)/.exec(buf); if (m) resolve(m[1]); });
      server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
      setTimeout(() => reject(new Error(`no start line: ${buf}`)), 20_000);
    });
    const c = client(url, token);
    assert.equal((await newIdentity(c, 1)).code, 0);

    // Suspend: the next request is refused, with the reason; resume: it works again. No restart.
    const susp = await run(["serve", "suspend", "--tokens", tokens, "--tenant", "team-a", "--reason", "abusive traffic"]);
    assert.match(susp.out, /team-a is suspended: abusive traffic/);
    const refused = await c(["identity", "show", did(1)]);
    assert.equal(refused.code, 1);
    assert.match(refused.err, /this tenant is suspended: abusive traffic/);
    assert.match(refused.err, /SUSPENDED/);
    assert.match((await run(["serve", "usage", "--tokens", tokens])).out, /team-a .*SUSPENDED: abusive traffic/);
    await run(["serve", "resume", "--tokens", tokens, "--tenant", "team-a"]);
    assert.equal((await c(["identity", "show", did(1)])).code, 0);

    // Block this machine's address, then lift it.
    const blk = await run(["serve", "block", "--tokens", tokens, "--address", "127.0.0.1", "--minutes", "5", "--reason", "test"]);
    assert.match(blk.out, /127\.0\.0\.1 is blocked for 5 minute/);
    const blockedTry = await c(["identity", "show", did(1)]);
    assert.equal(blockedTry.code, 1);
    assert.match(blockedTry.err, /this address is blocked by the operator/);
    await run(["serve", "unblock", "--tokens", tokens, "--address", "127.0.0.1"]);
    assert.equal((await c(["identity", "show", did(1)])).code, 0);

    // A new tenant is picked up without a restart.
    const fresh = (await run(["serve", "token", "--tokens", tokens, "--tenant", "team-b"])).out.trim().split("\n").at(-1)!;
    assert.equal((await client(url, fresh)(["identity", "show", did(1)])).code, 0);

    // Usage: the service counts and keeps it (written within a second).
    await new Promise((r) => setTimeout(r, 1500));
    const usage = await run(["serve", "usage", "--tokens", tokens]);
    assert.match(usage.out, /team-a +tenant +1 \/ 50 records/);
    assert.match(usage.out, /ops +admin +0 \/ no limit records/);
    assert.match(usage.out, /2 tenant\(s\); 0 blocked address\(es\)|3 tenant\(s\); 0 blocked address\(es\)/);
    assert.ok(existsSync(`${tokens}.usage.json`));
    assert.equal(JSON.parse(readFileSync(`${tokens}.usage.json`, "utf8"))["team-a"].records, 1);
  } finally {
    server.kill();
  }
});
