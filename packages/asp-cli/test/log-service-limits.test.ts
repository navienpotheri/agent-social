import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { request as httpsRequest } from "node:https";
import type { Server } from "node:http";
import { Limits, createLogServer, hashToken, type Tenant } from "@agent-social/asp-log";
import { LocalLog } from "@agent-social/asp-package";

const TOKEN = "limits-tenant-token";
const OTHER = "limits-other-token";
const tenants: Tenant[] = [
  { name: "team-a", role: "tenant", tokenSha256: hashToken(TOKEN) },
  { name: "team-b", role: "tenant", tokenSha256: hashToken(OTHER) },
  { name: "slow", role: "tenant", tokenSha256: hashToken("slow-token"), rateLimitPerMinute: 4 },
];

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
async function start(opts: Parameters<typeof createLogServer>[0] extends infer O ? Partial<O> : never) {
  const server = createLogServer({ handle: await LocalLog.open(mkdtempSync(join(tmpdir(), "asp-limits-"))), tenants, ...opts } as Parameters<typeof createLogServer>[0]);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
const rpc = (url: string, token: string | undefined, method = "head", target = "log", args: unknown[] = []) =>
  fetch(`${url}/rpc`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ target, method, args }) });

test("Limits: a tenant's bucket refills with time, one tenant does not use another's, writes have their own smaller bucket", () => {
  let t = 1_000_000;
  const l = new Limits({ tenantPerMinute: 60, appendPerMinute: 6, maxInFlight: 0, addressPerMinute: 0, failedAuthMax: 0, now: () => t });
  // A burst of a quarter of the minute's allowance (15), then refused with a wait.
  for (let i = 0; i < 15; i++) assert.equal(l.checkTenant("a").ok, true, `request ${i}`);
  const refused = l.checkTenant("a");
  assert.equal(refused.ok, false);
  assert.equal(refused.retryAfterSec, 1);
  assert.equal(l.checkTenant("b").ok, true, "another tenant is not affected");
  t += 2_000; // two seconds refill two requests
  assert.equal(l.checkTenant("a").ok, true);
  assert.equal(l.checkTenant("a").ok, true);
  assert.equal(l.checkTenant("a").ok, false);
  // Writes: 6 a minute, a burst of 2.
  assert.deepEqual([l.checkWrite("w").ok, l.checkWrite("w").ok, l.checkWrite("w").ok], [true, true, false]);
  // A tenant's own limit replaces the default.
  assert.equal(l.checkTenant("slow", 4).ok, true);
  assert.equal(l.checkTenant("slow", 4).ok, false);
});

test("Limits: in-flight cap, and a lockout after failed sign-ins that ends after the window", () => {
  let t = 5_000_000;
  const l = new Limits({ tenantPerMinute: 0, appendPerMinute: 0, maxInFlight: 2, addressPerMinute: 0, failedAuthMax: 3, failedAuthWindowSec: 60, now: () => t });
  const a = l.enter("x"), b = l.enter("x");
  assert.ok(a && b);
  assert.equal(l.enter("x"), undefined, "the third at once is refused");
  assert.ok(l.enter("y"), "another tenant has its own places");
  a!(); a!(); // leaving twice counts once
  assert.ok(l.enter("x"), "a place is free again");

  for (let i = 0; i < 2; i++) l.authFailed("9.9.9.9");
  assert.equal(l.checkAddress("9.9.9.9").ok, true, "two failures are not a lockout");
  l.authFailed("9.9.9.9");
  const locked = l.checkAddress("9.9.9.9");
  assert.equal(locked.ok, false);
  assert.equal(locked.retryAfterSec, 60);
  assert.equal(l.checkAddress("8.8.8.8").ok, true, "other addresses are not affected");
  t += 61_000;
  assert.equal(l.checkAddress("9.9.9.9").ok, true, "the lockout ended");
});

test("the service answers 429 with Retry-After when a tenant asks too much, and one tenant's flood leaves the other alone", async () => {
  const url = await start({ limits: { tenantPerMinute: 8, appendPerMinute: 0, maxInFlight: 0, addressPerMinute: 0, failedAuthMax: 0 } });
  const statuses: number[] = [];
  for (let i = 0; i < 12; i++) statuses.push((await rpc(url, TOKEN)).status);
  assert.equal(statuses.filter((s) => s === 200).length, 2, "a burst of a quarter of the minute (2), then refused");
  const refused = await rpc(url, TOKEN);
  assert.equal(refused.status, 429);
  assert.ok(Number(refused.headers.get("retry-after")) >= 1);
  const body: any = await refused.json();
  assert.equal(body.error.code, "RATE_LIMITED");
  assert.match(body.error.message, /this tenant is making too many requests/);
  assert.equal((await rpc(url, OTHER)).status, 200, "team-b is not affected by team-a's flood");
  assert.equal((await fetch(`${url}/health`)).status, 200, "health is not behind a token");
});

test("a tenant's own limit replaces the default, and writes are limited separately from reads", async () => {
  const url = await start({ limits: { tenantPerMinute: 1000, appendPerMinute: 4, maxInFlight: 0, addressPerMinute: 0, failedAuthMax: 0 } });
  const slow = []; for (let i = 0; i < 4; i++) slow.push((await rpc(url, "slow-token")).status);
  assert.deepEqual(slow, [200, 429, 429, 429], "the tenant's own 4 a minute: a burst of 1");
  // Writes (append) are limited to 4 a minute, a burst of 1, whatever the general limit: the call is refused before it reaches the log.
  const writes = []; for (let i = 0; i < 3; i++) writes.push((await rpc(url, TOKEN, "importRecords", "handle", [[]])).status);
  assert.equal(writes.filter((s) => s === 429).length, 2);
  assert.equal((await rpc(url, TOKEN, "head")).status, 200, "reads still go through");
});

test("repeated failed sign-ins lock an address out, even for the right token; X-Forwarded-For counts only when the proxy is trusted", async () => {
  const url = await start({ limits: { tenantPerMinute: 0, appendPerMinute: 0, maxInFlight: 0, addressPerMinute: 0, failedAuthMax: 3, failedAuthWindowSec: 120 } });
  for (let i = 0; i < 3; i++) assert.equal((await rpc(url, "wrong-token")).status, 401);
  const locked = await rpc(url, TOKEN);
  assert.equal(locked.status, 429, "locked out, so even the right token waits");
  assert.match(((await locked.json()) as any).error.message, /too many failed sign-ins/);
  assert.ok(Number(locked.headers.get("retry-after")) > 100);

  // Not trusting the proxy header: a client cannot pick another address by sending one.
  const same = await fetch(`${url}/rpc`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}`, "x-forwarded-for": "1.2.3.4" }, body: JSON.stringify({ target: "log", method: "head", args: [] }) });
  assert.equal(same.status, 429);
  // Behind a proxy that is trusted, the address is the one it reports.
  const behind = await start({ trustProxy: true, limits: { tenantPerMinute: 0, appendPerMinute: 0, maxInFlight: 0, addressPerMinute: 0, failedAuthMax: 2, failedAuthWindowSec: 120 } });
  const via = (ip: string, token: string) => fetch(`${behind}/rpc`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-forwarded-for": `${ip}, 10.0.0.1` }, body: JSON.stringify({ target: "log", method: "head", args: [] }) });
  await via("5.5.5.5", "bad"); await via("5.5.5.5", "bad");
  assert.equal((await via("5.5.5.5", TOKEN)).status, 429);
  assert.equal((await via("6.6.6.6", TOKEN)).status, 200, "another client behind the same proxy is fine");
});

test("the client waits out a 429 and repeats the call", async () => {
  const { RemoteLog } = await import("@agent-social/asp-package");
  // 120 a minute: a burst of 30, then one more every half second, so a refused call is told to wait one second.
  const url = await start({ limits: { tenantPerMinute: 120, appendPerMinute: 0, maxInFlight: 0, addressPerMinute: 0, failedAuthMax: 0 } });
  for (let i = 0; i < 200; i++) if ((await rpc(url, TOKEN)).status === 429) break;
  const started = Date.now();
  const head = await new RemoteLog(url, TOKEN).log.head();
  assert.ok(head !== undefined);
  assert.ok(Date.now() - started >= 900, "the call waited for the service's Retry-After and then went through");
});

// ---------- TLS ----------

const opensslOk = (() => { try { execFileSync("openssl", ["version"], { stdio: "ignore" }); return true; } catch { return false; } })();

function selfSigned() {
  const dir = mkdtempSync(join(tmpdir(), "asp-tls-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"), "-days", "2", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" });
  return { dir, cert: join(dir, "cert.pem"), key: join(dir, "key.pem") };
}

test("TLS: the service speaks HTTPS with a certificate, sends HSTS, and a client that does not trust the certificate cannot connect", { skip: !opensslOk && "openssl is not installed" }, async () => {
  const pem = selfSigned();
  const server = createLogServer({ handle: await LocalLog.open(mkdtempSync(join(tmpdir(), "asp-tls-log-"))), tenants, tls: { cert: readFileSync(pem.cert), key: readFileSync(pem.key) } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const port = (server.address() as { port: number }).port;
  const get = (ca?: Buffer) => new Promise<{ status: number; hsts?: string }>((resolve, reject) => {
    const req = httpsRequest({ host: "127.0.0.1", port, path: "/health", method: "GET", ...(ca ? { ca } : {}), servername: "localhost" }, (res) => { res.resume(); res.on("end", () => resolve({ status: res.statusCode!, hsts: String(res.headers["strict-transport-security"] ?? "") })); });
    req.on("error", reject);
    req.end();
  });
  const ok = await get(readFileSync(pem.cert));
  assert.equal(ok.status, 200);
  assert.match(ok.hsts!, /max-age=\d+/);
  await assert.rejects(get(), /self.signed|unable to verify|certificate/i, "without trusting the certificate the connection is refused");
  // Plain HTTP to the TLS port does not work either.
  await assert.rejects(fetch(`http://127.0.0.1:${port}/health`));
});

test("asp serve over TLS end to end: a client that trusts the certificate (NODE_EXTRA_CA_CERTS) uses it; plain HTTP on a network address is refused unless allowed", { skip: !opensslOk && "openssl is not installed" }, async () => {
  const pem = selfSigned();
  const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), "asp-tls-e2e-"));
  const tokens = join(dir, "tokens.json");
  const run = (args: string[], env: NodeJS.ProcessEnv = {}) => new Promise<{ code: number; out: string; err: string }>((resolve) => {
    const c = spawn(process.execPath, [cli, ...args], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (err += d));
    c.on("close", (code) => resolve({ code: code ?? 1, out, err }));
  });
  const tok = await run(["serve", "token", "--tokens", tokens, "--tenant", "team-a"]);
  const token = tok.out.trim().split("\n").at(-1)!;

  // Without TLS, on a network address, it refuses to start.
  const plain = await run(["serve", "--db", `local:${join(dir, "plain")}`, "--tokens", tokens, "--host", "0.0.0.0", "--port", "0"]);
  assert.equal(plain.code, 2);
  assert.match(plain.err, /without TLS the service would send every tenant's token in the clear/);
  const half = await run(["serve", "--db", `local:${join(dir, "half")}`, "--tokens", tokens, "--tls-cert", pem.cert]);
  assert.equal(half.code, 2);

  // With a certificate: starts, says https, and a trusting client works.
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--tls-cert", pem.cert, "--tls-key", pem.key, "--port", "0"], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    const line = await new Promise<string>((resolve, reject) => {
      let buf = "";
      server.stdout.on("data", (d) => { buf += d; const m = /listening on (https:\/\/[^ ]+)/.exec(buf); if (m) resolve(m[1]); });
      server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
      setTimeout(() => reject(new Error(`no start line: ${buf}`)), 20_000);
    });
    const home = mkdtempSync(join(tmpdir(), "asp-tls-client-"));
    const env = { ASP_HOME: home, ASP_LOG_URL: line, ASP_LOG_TOKEN: token };
    const trusted = await run(["identity", "new", "--kind", "human", "--did", "did:web:example.com:users:tls"], { ...env, NODE_EXTRA_CA_CERTS: pem.cert });
    assert.equal(trusted.code, 0, trusted.err + trusted.out);
    const untrusted = await run(["identity", "show", "did:web:example.com:users:tls"], env);
    assert.notEqual(untrusted.code, 0);
    assert.match(untrusted.err, /cannot reach the log service/);
  } finally {
    server.kill();
  }
});
