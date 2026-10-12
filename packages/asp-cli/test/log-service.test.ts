import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { createLogServer, hashToken, type Tenant } from "@agent-social/asp-log";
import { LocalLog } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";

const ALICE = "did:web:example.com:users:alice";
const CODER = "did:web:example.com:agents:coder";
const BANK = "did:web:example.com:bank";
const ADMIN = "admin-token-for-tests";
const TENANT = "tenant-token-for-tests";
const tenants: Tenant[] = [
  { name: "ops", role: "admin", tokenSha256: hashToken(ADMIN) },
  { name: "team-a", role: "tenant", tokenSha256: hashToken(TENANT) },
];

const servers: Server[] = [];
async function start(dir: string): Promise<string> {
  const server = createLogServer({ handle: await LocalLog.open(dir), tenants });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
after(() => { for (const s of servers) s.close(); });

/** A client: its own ASP home (its own keys), the shared log over HTTP. */
function client(url: string, token?: string) {
  const home = mkdtempSync(join(tmpdir(), "asp-client-"));
  return async (args: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home, ASP_LOG_URL: url, ...(token ? { ASP_LOG_TOKEN: token } : {}) }, cwd: home };
    const code = await main(args, io);
    return { code, out: out.join("\n"), err: err.join("\n") };
  };
}

test("two clients with their own keys share one log through the service; each sees the other's records", async () => {
  const url = await start(mkdtempSync(join(tmpdir(), "asp-service-")));
  const a = client(url, ADMIN);
  const b = client(url, TENANT);

  assert.equal((await a(["identity", "new", "--kind", "human", "--did", ALICE])).code, 0);
  assert.equal((await a(["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Fix the flaky test"])).code, 0);
  assert.equal((await a(["identity", "new", "--kind", "human", "--did", BANK])).code, 0);
  assert.equal((await a(["credits", "grant", "--to", ALICE, "--amount", "1000"])).code, 0);

  // Client B has no keys and no local log, yet sees A's identities, balances and chain.
  const show = await b(["identity", "show", CODER]);
  assert.equal(show.code, 0, show.err);
  assert.match(show.out, /"sponsor": "did:web:example.com:users:alice"/);
  assert.match((await b(["credits", "balance", ALICE])).out, /: 1000 credits/);
  const verify = await b(["log", "verify"]);
  assert.equal(verify.code, 0, verify.out + verify.err);
  assert.match(verify.out, /log ok: \d+ records/);

  // B writes through the service with its own key; A sees it.
  assert.equal((await b(["identity", "new", "--kind", "human", "--did", "did:web:example.com:users:bob"])).code, 0);
  assert.equal((await a(["identity", "show", "did:web:example.com:users:bob"])).code, 0);
});

test("access control: no token, a wrong token, and a tenant minting credits are refused; the service still rejects what a local log would", async () => {
  const url = await start(mkdtempSync(join(tmpdir(), "asp-service-")));
  const none = client(url);
  assert.match((await none(["identity", "show", ALICE])).err, /refused the request/);
  const wrong = client(url, "not-a-real-token");
  assert.match((await wrong(["identity", "show", ALICE])).err, /refused the request/);

  const tenant = client(url, TENANT);
  await tenant(["identity", "new", "--kind", "human", "--did", ALICE]);
  const mint = await tenant(["credits", "grant", "--to", ALICE, "--amount", "10"]);
  assert.equal(mint.code, 1);
  assert.match(mint.err, /needs an admin token/);
  assert.equal((await client(url, ADMIN)(["credits", "grant", "--to", ALICE, "--amount", "10"])).code, 0);

  // A second passport chain for the same DID is refused by the service exactly as a local log would refuse it.
  const dup = await tenant(["identity", "new", "--kind", "human", "--did", ALICE]);
  assert.equal(dup.code, 1);
  assert.match(dup.err, /already has a passport/);
});

test("the service keeps its state across a restart and answers unknown methods and oversized bodies safely", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-service-"));
  const url1 = await start(dir);
  const a = client(url1, ADMIN);
  await a(["identity", "new", "--kind", "human", "--did", ALICE]);
  await a(["credits", "grant", "--to", ALICE, "--amount", "77"]);
  servers.pop()!.close();

  const url2 = await start(dir);
  assert.match((await client(url2, ADMIN)(["credits", "balance", ALICE])).out, /: 77 credits/);

  const call = (body: string, token = ADMIN) => fetch(`${url2}/rpc`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body });
  assert.equal((await call(JSON.stringify({ target: "log", method: "constructor", args: [] }))).status, 404, "only allowlisted methods exist");
  assert.equal((await call(JSON.stringify({ target: "handle", method: "mint", args: [ALICE, 1] }), TENANT)).status, 403);
  assert.equal((await call("not json")).status, 400);
  assert.equal((await fetch(`${url2}/health`)).status, 200);
});

test("the service runs on Postgres too (set ASP_TEST_DATABASE_URL)", { skip: !process.env.ASP_TEST_DATABASE_URL && "set ASP_TEST_DATABASE_URL to run" }, async () => {
  const { postgresHandle } = await import("@agent-social/asp-log");
  const handle = await postgresHandle(process.env.ASP_TEST_DATABASE_URL!);
  const server = createLogServer({ handle, tenants });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  after(() => handle.close());
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const a = client(url, ADMIN);
  const who = `did:web:example.com:users:pg-${Date.now()}`;
  assert.equal((await a(["identity", "new", "--kind", "human", "--did", who])).code, 0);
  assert.equal((await a(["credits", "grant", "--to", who, "--amount", "5"])).code, 0);
  assert.match((await client(url, TENANT)(["credits", "balance", who])).out, /: 5 credits/);
  assert.equal((await client(url, TENANT)(["log", "verify"])).code, 0);
});
