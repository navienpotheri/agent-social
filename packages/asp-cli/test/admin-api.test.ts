/**
 * The remote admin interface and its audit trail (register row O18; spec-delta S391): an admin token suspends and resumes a tenant and blocks an address over HTTP, a tenant token cannot, every action (by the API or
 * a local command) is a line in a hash-chained audit trail, and a changed line breaks the chain. Fake tokens only. Credits are accounting entries, not money.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { createLogServer, hashToken, type Tenant } from "@agent-social/asp-log";
import { LocalLog } from "@agent-social/asp-package";
import { AdminAudit, adminRoutes } from "../../asp-package/src/admin-routes.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

async function service() {
  const dir = mkdtempSync(join(tmpdir(), "asp-admin-api-"));
  const tokensFile = join(dir, "tokens.json");
  const tenants: Tenant[] = [{ name: "ops", role: "admin", tokenSha256: hashToken("ops-token") }, { name: "alice", role: "tenant", tokenSha256: hashToken("alice-token") }, { name: "bob", role: "tenant", tokenSha256: hashToken("bob-token") }];
  writeFileSync(tokensFile, JSON.stringify(tenants, null, 2));
  const audit = new AdminAudit(`${tokensFile}.admin-audit.jsonl`);
  let clock = Date.parse("2026-11-14T10:00:00Z");
  const now = () => new Date((clock += 1000)).toISOString().replace(".000Z", "Z");
  const o = { tokensFile, blockedFile: `${tokensFile}.blocked.json`, audit, now };
  const server = createLogServer({ handle: await LocalLog.open(join(dir, "log")), tenants, tenantSource: () => JSON.parse(readFileSync(tokensFile, "utf8")) as Tenant[], extra: adminRoutes(o) });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = (token: string, method: string, path: string, body?: unknown) => fetch(`${url}${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body !== undefined && method !== "GET" ? { body: JSON.stringify(body) } : {}) });
  const head = (token: string) => fetch(`${url}/rpc`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ target: "log", method: "head", args: [] }) });
  return { dir, tokensFile, audit, call, head, url };
}

test("an admin suspends a tenant over HTTP: its next request is refused with the reason, others are untouched, and resuming lets it in again; each step is in the audit trail with who, what and why", async () => {
  const s = await service();
  assert.equal((await s.head("alice-token")).status, 200);
  const r = await s.call("ops-token", "POST", "/admin/tenants/alice/suspend", { reason: "abuse report 17" });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, tenant: "alice", action: "suspend" });
  const refused = await s.head("alice-token");
  assert.equal(refused.status, 403);
  assert.match(JSON.stringify(await refused.json()), /SUSPENDED.*abuse report 17/s);
  assert.equal((await s.head("bob-token")).status, 200, "another tenant is not affected");
  assert.equal((await s.call("ops-token", "POST", "/admin/tenants/alice/resume", {})).status, 200);
  assert.equal((await s.head("alice-token")).status, 200);
  const trail = await (await s.call("ops-token", "GET", "/admin/audit")).json() as { chain: { ok: boolean; entries: number }; entries: { seq: number; by: string; via: string; action: string; target: string; reason?: string }[] };
  assert.deepEqual(trail.chain, { ok: true, entries: 2 });
  assert.deepEqual(trail.entries.map((e) => [e.seq, e.by, e.via, e.action, e.target, e.reason]), [[1, "ops", "api", "suspend", "alice", "abuse report 17"], [2, "ops", "api", "resume", "alice", undefined]]);
});

test("only an admin token reaches the interface; an admin is not suspended by it; an unknown tenant and a bad address are refused; the tenant list never shows a token", async () => {
  const s = await service();
  for (const [m, p] of [["POST", "/admin/tenants/bob/suspend"], ["GET", "/admin/audit"], ["GET", "/admin/tenants"], ["POST", "/admin/addresses/block"]] as const) assert.equal((await s.call("alice-token", m, p, {})).status, 403, `${m} ${p} for a tenant`);
  assert.notEqual((await s.call("nobody-token", "GET", "/admin/audit")).status, 200);
  assert.equal((await s.call("ops-token", "POST", "/admin/tenants/ops/suspend", {})).status, 404, "an admin is not suspended by this interface");
  assert.equal((await s.call("ops-token", "POST", "/admin/tenants/nobody/suspend", {})).status, 404);
  assert.equal((await s.call("ops-token", "POST", "/admin/addresses/block", { address: "not an address" })).status, 400);
  assert.equal((await s.call("ops-token", "POST", "/admin/addresses/block", { address: "203.0.113.7", minutes: -4 })).status, 400);
  const list = await (await s.call("ops-token", "GET", "/admin/tenants")).text();
  assert.equal(/tokenSha256|token/i.test(list.replace(/"tokens?"/g, "")), false, "no token or token hash is listed");
  assert.deepEqual(((JSON.parse(list) as { tenants: { name: string }[] }).tenants).map((t) => t.name), ["ops", "alice", "bob"]);
  assert.equal((await s.call("ops-token", "GET", "/admin/audit").then((r) => r.json()) as { entries: unknown[] }).entries.length, 0, "a refused action is not a line in the trail");
});

test("blocking an address and unblocking it are in the trail, with the minutes, and written to the block list the service reads", async () => {
  const s = await service();
  assert.equal((await s.call("ops-token", "POST", "/admin/addresses/block", { address: "203.0.113.7", minutes: 30, reason: "scanning" })).status, 200);
  const list = JSON.parse(readFileSync(`${s.tokensFile}.blocked.json`, "utf8")) as { address: string; until?: string; reason?: string }[];
  assert.equal(list[0].address, "203.0.113.7");
  assert.ok(list[0].until, "a time-limited block");
  await s.call("ops-token", "POST", "/admin/addresses/unblock", { address: "203.0.113.7" });
  assert.deepEqual(JSON.parse(readFileSync(`${s.tokensFile}.blocked.json`, "utf8")), []);
  const entries = s.audit.read();
  assert.deepEqual(entries.map((e) => [e.action, e.target]), [["block", "203.0.113.7"], ["unblock", "203.0.113.7"]]);
  assert.match(entries[0].reason ?? "", /scanning.*30 minutes/);
});

test("the trail is a chain: changing, removing or inserting a line breaks it and says where", async () => {
  const s = await service();
  for (const a of ["suspend", "resume", "suspend"]) await s.call("ops-token", "POST", `/admin/tenants/bob/${a}`, { reason: `reason ${a}` });
  assert.deepEqual(s.audit.verify(), { ok: true, entries: 3 });
  const path = `${s.tokensFile}.admin-audit.jsonl`;
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  writeFileSync(path, [lines[0], lines[1].replace("reason resume", "nothing happened"), lines[2]].join("\n") + "\n");
  assert.match(s.audit.verify().problem ?? "", /entry 2 was changed/);
  writeFileSync(path, [lines[0], lines[2]].join("\n") + "\n");
  assert.match(s.audit.verify().problem ?? "", /entry 2 is numbered 3|does not follow/);
  writeFileSync(path, lines.join("\n") + "\n");
  assert.equal(s.audit.verify().ok, true, "restored");
});

test("the local commands write the same trail: `asp serve suspend` and `block` are lines (by the operator's local command) and `asp serve audit` prints and verifies it, exit 1 when broken", async () => {
  const s = await service();
  const run = (args: string[]) => new Promise<{ code: number; out: string }>((resolve) => { let out = ""; const c = spawn(process.execPath, [cli, "serve", ...args], { stdio: ["ignore", "pipe", "pipe"] }); c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (out += d)); c.on("close", (code) => resolve({ code: code ?? 1, out })); });
  assert.equal((await run(["suspend", "--tokens", s.tokensFile, "--tenant", "bob", "--reason", "spam"])).code, 0);
  assert.equal((await run(["block", "--tokens", s.tokensFile, "--address", "198.51.100.9", "--minutes", "10"])).code, 0);
  assert.equal((await s.head("bob-token")).status, 403, "the running service picks the local suspension up");
  const a = await run(["audit", "--tokens", s.tokensFile]);
  assert.equal(a.code, 0, a.out);
  assert.match(a.out, /2 entries; the chain is whole/);
  assert.match(a.out, /operator \(local command\) \(local\)\s+suspend bob: spam/);
  const path = `${s.tokensFile}.admin-audit.jsonl`;
  writeFileSync(path, readFileSync(path, "utf8").replace("spam", "kindness"));
  const broken = await run(["audit", "--tokens", s.tokensFile]);
  assert.equal(broken.code, 1);
  assert.match(broken.out, /BROKEN: entry 1 was changed/);
  assert.equal((await run(["suspend", "--tokens", s.tokensFile, "--tenant", "ops"])).code, 1, "an admin is not suspended by the local command either");
});
