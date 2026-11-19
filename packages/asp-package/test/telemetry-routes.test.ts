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
    assert.match(st.json.say, /ON \(the default\)/);
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

test("DK651: one step turns it off and an honoured off stores nothing; off with delete clears; a machine token cannot change the choice", async () => {
  let t: Tenant = person;
  await withServer(() => t, async (call) => {
    await call("POST", "/telemetry/content", { kind: "message", content: "hi" });
    const off = await call("POST", "/telemetry/opt-out", {});
    assert.equal(off.json.on, false);
    assert.equal((await call("POST", "/telemetry/content", { kind: "message", content: "again" })).status, 409);
    assert.match((await call("GET", "/telemetry")).json.say, /OFF/);
    t = { ...person, machine: "ci" };
    assert.equal((await call("POST", "/telemetry/opt-in", {})).status, 403);
    assert.equal((await call("POST", "/telemetry/delete-all", {})).status, 403);
    t = person;
    const cleared = await call("POST", "/telemetry/opt-out", { delete: true });
    assert.equal(cleared.json.deleted, 1);
    assert.equal((await call("POST", "/telemetry/opt-in", {})).json.on, true);
    assert.equal((await call("POST", "/telemetry/content", { kind: "message", content: "back on" })).status, 201);
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
