// Register row DK1360: a tenant that chose to keep its data private. The status route says so with its own notice, the content route refuses to store and says to keep the text local, nothing is stored, deletion and
// receipts have nothing to do, and an open or personal tenant is unchanged (always on). Setup after telemetry-routes.test.ts. Fake data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { TELEMETRY_NOTICE, TELEMETRY_NOTICE_PRIVATE, TelemetryStore, type Tenant } from "@agent-social/asp-log";
import { telemetryRoutes } from "../src/telemetry-routes.ts";

async function withServer(tenant: () => Tenant, fn: (call: (method: string, path: string, body?: unknown) => Promise<{ status: number; json: any }>, store: TelemetryStore) => Promise<void>) {
  const store = new TelemetryStore();
  const route = telemetryRoutes({ store, now: () => "2026-11-21T00:00:00Z" });
  const server = createServer(async (req, res) => { if (!(await route(req, res, { tenant: tenant() }))) { res.writeHead(404); res.end(); } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    await fn(async (method, path, body) => { const r = await fetch(base + path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: r.status, json: await r.json().catch(() => undefined) }; }, store);
  } finally { server.close(); }
}
const org: Tenant = { name: "org-private", role: "tenant", tokenSha256: "0".repeat(64), dataSharing: "private" };
const open: Tenant = { name: "open-agent", role: "tenant", tokenSha256: "1".repeat(64) };

test("DK1360: a private tenant is told so, with its own notice, and nothing is stored for it", async () => {
  await withServer(() => org, async (call, store) => {
    const st = (await call("GET", "/telemetry")).json;
    assert.equal(st.sharing, "private");
    assert.equal(st.on, false);
    assert.equal(st.stored, 0);
    assert.equal(st.notice, TELEMETRY_NOTICE_PRIVATE);
    assert.match(st.say, /chose to keep its data private/);
    const put = await call("POST", "/telemetry/content", { kind: "trajectory", content: "the organisation's confidential trajectory text" });
    assert.equal(put.status, 409);
    assert.equal(put.json.error.code, "private_tenant_keep_text_local");
    assert.match(put.json.error.message, /only its hash/);
    assert.deepEqual(store.list("org-private"), [], "the shared store holds nothing for the tenant");
    assert.deepEqual((await call("GET", "/telemetry/content")).json.entries, []);
    const del = await call("POST", "/telemetry/delete-all", {});
    assert.equal(del.json.deleted, 0);
    assert.equal(del.json.receipt, undefined);
  });
});

test("DK1360: an open or personal tenant is unchanged: the store is on and not optional", async () => {
  await withServer(() => open, async (call, store) => {
    const st = (await call("GET", "/telemetry")).json;
    assert.equal(st.sharing, "share");
    assert.equal(st.on, true);
    assert.equal(st.notice, TELEMETRY_NOTICE);
    assert.equal((await call("POST", "/telemetry/content", { kind: "message", content: "an open agent's message" })).status, 201);
    assert.equal(store.list("open-agent").length, 1);
    assert.equal((await call("POST", "/telemetry/opt-out", {})).status, 410, "still no off switch");
  });
});

test("DK1360: the notice a private tenant reads says the text stays on its machines, only a hash goes in the log, and no study includes its agents", () => {
  assert.match(TELEMETRY_NOTICE_PRIVATE, /stores no trajectories, messages or free text/);
  assert.match(TELEMETRY_NOTICE_PRIVATE, /stays on your own machines/);
  assert.match(TELEMETRY_NOTICE_PRIVATE, /only a hash of each item goes in the signed log/);
  assert.match(TELEMETRY_NOTICE_PRIVATE, /not part of any study/);
  assert.match(TELEMETRY_NOTICE_PRIVATE, /always on/);
});
