// DK1474 (S1416): the service counts the reads and writes of each tenant by UTC month, because a read is not in the log; a tenant sees its own month at GET /usage and an operator sees every tenant's; the counts survive a restart. Fake tokens.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { UsageStore, createLogServer, hashToken, type Tenant } from "../src/index.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const listen = async (s: Server) => { await new Promise<void>((r) => s.listen(0, "127.0.0.1", r)); servers.push(s); return `http://127.0.0.1:${(s.address() as { port: number }).port}`; };
const tenants: Tenant[] = [{ name: "ops", role: "admin", tokenSha256: hashToken("op") }, { name: "alpha", role: "tenant", tokenSha256: hashToken("ta") }, { name: "bravo", role: "tenant", tokenSha256: hashToken("tb") }];

test("reads and writes are counted per tenant and month, shown to the tenant and the operator, and kept across a restart", async () => {
  let closing = async () => {};
  const dir = mkdtempSync(join(tmpdir(), "asp-usage-"));
  try {
    const file = join(dir, "usage.json");
    let usage = new UsageStore(file);
    let clock = new Date("2026-11-21T10:00:00Z");
    const handle = { append: async () => ({ id: "x", seq: 1 }), log: { head: async () => ({ seq: 0 }), balance: async () => 0 } } as never;
    const server = createLogServer({ handle, tenants, noAuth: false, usage, now: () => clock });
    const url = await listen(server);
    closing = () => new Promise<void>((r) => { server.close(() => r()); server.closeAllConnections?.(); });
    const rpc = (tok: string, target: string, method: string, args: unknown[] = []) => fetch(`${url}/rpc`, { method: "POST", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: JSON.stringify({ target, method, args }) });
    for (let i = 0; i < 4; i++) await rpc("ta", "log", "head");
    await rpc("ta", "log", "balance", ["did:web:x"]);
    await rpc("tb", "log", "head");
    await rpc("ta", "handle", "append", [{ id: "r" }]).catch(() => undefined);
    clock = new Date("2026-12-02T10:00:00Z");
    await rpc("ta", "log", "head");
    const get = async (tok: string, q = "") => (await (await fetch(`${url}/usage${q}`, { headers: { authorization: `Bearer ${tok}` } })).json()) as { result: Record<string, unknown> };
    assert.deepEqual([(await get("ta", "?month=2026-11")).result.reads, (await get("ta", "?month=2026-11")).result.writes], [5, 1], "alpha: five reads and one write in November");
    assert.equal((await get("ta")).result.month, "2026-12", "the default is the current month");
    assert.equal((await get("ta")).result.reads, 1);
    const all = (await get("op", "?month=2026-11")).result.tenants as Record<string, { reads: number }>;
    assert.deepEqual([all.alpha.reads, all.bravo.reads, all.ops], [5, 1, undefined], "the operator sees every tenant; an operator's own calls are not counted");
    assert.equal((await fetch(`${url}/usage`)).status, 401);
    usage.flush();
    usage = new UsageStore(file);
    assert.equal(usage.month("alpha", "2026-11").reads, 5, "the counts survive a restart");
    usage.remove("alpha");
    assert.equal(usage.month("alpha", "2026-11").reads, 0, "an account that closed leaves no counts");
  } finally { await closing(); void rmSync; }
});

test("a tenant sees the months closed for its own identities, with a recount against the log; another tenant sees none of them; the operator sees all", async () => {
  const owners = { of: (t: string) => (t === "alpha" ? ["did:web:svc:u:alpha"] : []), flush: () => undefined };
  const rows = [{ id: "s1", holder: "did:web:svc:u:alpha", usage_matches_log: true }, { id: "s2", holder: "did:web:svc:u:bravo", usage_matches_log: false }];
  const handle = { append: async () => ({ id: "x", seq: 1 }), log: { usageStatementsOf: async (h?: string[]) => rows.filter((r) => !h || h.includes(r.holder)) } } as never;
  const server = createLogServer({ handle, tenants, noAuth: false, owners: owners as never });
  const url = await listen(server);
  const get = async (tok: string) => (await (await fetch(`${url}/usage/statements`, { headers: { authorization: `Bearer ${tok}` } })).json()) as { result: { id: string }[] };
  assert.deepEqual((await get("ta")).result.map((r) => r.id), ["s1"]);
  assert.deepEqual((await get("tb")).result, []);
  assert.deepEqual((await get("op")).result.map((r) => r.id), ["s1", "s2"]);
  assert.equal((await fetch(`${url}/usage/statements`)).status, 401);
});
