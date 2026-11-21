// Row DK651: the telemetry store's routes for a tenant: plain status, one-step opt-out, content in and out, deletion that keeps the hash, a machine token that cannot change the choice, and a young person's tenant that stores nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { TelemetryStore, type Tenant } from "@agent-social/asp-log";
import { telemetryRoutes } from "../src/telemetry-routes.ts";

async function withServer(tenant: () => Tenant, fn: (call: (method: string, path: string, body?: unknown) => Promise<{ status: number; json: any }>) => Promise<void>) {
  const store = new TelemetryStore();
  const route = telemetryRoutes({ store, now: () => "2026-11-19T00:00:00Z" });
  const server = createServer(async (req, res) => { if (!(await route(req, res, { tenant: tenant() }))) { res.writeHead(404); res.end(); } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    await fn(async (method, path, body) => { const r = await fetch(base + path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: r.status, json: await r.json().catch(() => undefined) }; });
  } finally { server.close(); }
}
const person: Tenant = { name: "route-tenant", role: "tenant", tokenSha256: "0".repeat(64) };

test("DK651: status says in plain words that it is on; content goes in, comes back, and deleting keeps the hash", async () => {
  await withServer(() => person, async (call) => {
    const st = await call("GET", "/telemetry");
    assert.equal(st.json.on, true);
    assert.match(st.json.say, /Telemetry is ON/);
    assert.match(st.json.notice, /separate store/);
    const put = await call("POST", "/telemetry/content", { kind: "trajectory", content: "did the thing" });
    assert.equal(put.status, 201);
    const hash = put.json.hash as string;
    assert.equal((await call("GET", `/telemetry/content/${hash}`)).json.content, "did the thing");
    assert.ok(!JSON.stringify((await call("GET", "/telemetry/content")).json).includes("did the thing"), "the list never shows the text");
    const del = await call("DELETE", `/telemetry/content/${hash}`);
    assert.equal(del.status, 200);
    const after = await call("GET", `/telemetry/content/${hash}`);
    assert.equal(after.json.deleted, "2026-11-19T00:00:00Z");
    assert.equal(after.json.hash, hash, "the hash is kept");
    assert.equal(after.json.content, undefined);
  });
});

test("DK1303: the opt-out route is gone: it refuses with the reason, collection stays on, deletion still works, a machine token cannot delete", async () => {
  let t: Tenant = person;
  await withServer(() => t, async (call) => {
    assert.equal((await call("POST", "/telemetry/content", { kind: "message", content: "hi" })).status, 201);
    for (const path of ["/telemetry/opt-out", "/telemetry/opt-in"]) {
      const r = await call("POST", path, { delete: true });
      assert.equal(r.status, 410);
      assert.equal(r.json.error.code, "TELEMETRY_NOT_OPTIONAL");
      assert.match(r.json.error.message, /not optional/);
    }
    assert.equal((await call("POST", "/telemetry/content", { kind: "message", content: "again" })).status, 201, "still collecting after the refused opt-out");
    const status = (await call("GET", "/telemetry")).json;
    assert.equal(status.on, true);
    assert.equal(status.off, undefined);
    assert.match(status.say, /not optional/);
    assert.match(status.notice, /not optional/);
    t = { ...person, machine: "ci" };
    assert.equal((await call("POST", "/telemetry/delete-all", {})).status, 403);
    t = person;
    assert.equal((await call("POST", "/telemetry/delete-all", {})).status, 200, "deletion on request still works until counsel decides (flag 1)");
  });
});

test("DK651: a tenant held for a young person stores nothing and is told so", async () => {
  await withServer(() => ({ ...person, minor: true }), async (call) => {
    assert.match((await call("GET", "/telemetry")).json.say, /young person/);
    const r = await call("POST", "/telemetry/content", { kind: "text", content: "anything" });
    assert.equal(r.status, 403);
    assert.equal(r.json.error.code, "minor_tenant_no_telemetry");
  });
});
