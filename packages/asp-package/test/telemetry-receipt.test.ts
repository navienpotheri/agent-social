// Register row DK1378: an erasure request removes the text and keeps the hash, and the tenant is issued a deletion receipt that names what was removed and what stays, can be read again, and does not carry the text.
// Setup after telemetry-routes.test.ts. Fake data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { TelemetryStore, type Tenant } from "@agent-social/asp-log";
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
const person: Tenant = { name: "receipt-tenant", role: "tenant", tokenSha256: "0".repeat(64) };

test("DK1378: erasing everything removes the text, keeps every hash and issues a receipt that names what went and what stays, and carries no text", async () => {
  await withServer(() => person, async (call, store) => {
    const a = await call("POST", "/telemetry/content", { kind: "trajectory", content: "step one: the secret plan of the sponsor" });
    const b = await call("POST", "/telemetry/content", { kind: "message", content: "hello partner, my address is 12 Fake Street" });
    assert.equal(a.status, 201); assert.equal(b.status, 201);
    const del = await call("POST", "/telemetry/delete-all", {});
    assert.equal(del.status, 200);
    assert.equal(del.json.deleted, 2);
    const r = del.json.receipt;
    assert.equal(r.v, "asp.deletion-receipt/v0");
    assert.equal(r.tenant, "receipt-tenant");
    assert.equal(r.at, "2026-11-21T00:00:00Z");
    assert.deepEqual(r.deleted.map((d: { hash: string }) => d.hash).sort(), [a.json.hash, b.json.hash].sort());
    assert.deepEqual(r.deleted.map((d: { kind: string }) => d.kind).sort(), ["message", "trajectory"]);
    assert.match(r.kept, /the hash, the kind and the date/);
    assert.match(r.note, /35 days/);
    const text = JSON.stringify(r);
    assert.ok(!text.includes("secret plan") && !text.includes("Fake Street"), "the receipt never carries the text");
    // The id is the hash of the receipt's own content, so it can be checked.
    const { id, ...body } = r;
    assert.equal(id, `sha256:${createHash("sha256").update(JSON.stringify(body), "utf8").digest("hex")}`);
    // The text is gone and the hashes stay.
    assert.equal(store.get("receipt-tenant", a.json.hash)?.content, undefined);
    const list = (await call("GET", "/telemetry/content")).json.entries as Array<{ hash: string; deletedAt?: string }>;
    assert.equal(list.length, 2);
    assert.ok(list.every((e) => e.deletedAt));
    // The receipt can be read again.
    const again = (await call("GET", "/telemetry/receipts")).json.receipts;
    assert.equal(again.length, 1);
    assert.equal(again[0].id, id);
  });
});

test("DK1378: deleting one item issues a receipt for that item; deleting again, or deleting nothing, issues none", async () => {
  await withServer(() => person, async (call) => {
    const a = await call("POST", "/telemetry/content", { kind: "text", content: "one item to delete" });
    const b = await call("POST", "/telemetry/content", { kind: "text", content: "one item to keep" });
    const one = await call("DELETE", `/telemetry/content/${a.json.hash}`);
    assert.equal(one.status, 200);
    assert.deepEqual(one.json.receipt.deleted.map((d: { hash: string }) => d.hash), [a.json.hash]);
    assert.equal((await call("DELETE", `/telemetry/content/${a.json.hash}`)).status, 404, "already deleted: no second receipt");
    const rest = await call("POST", "/telemetry/delete-all", {});
    assert.deepEqual(rest.json.receipt.deleted.map((d: { hash: string }) => d.hash), [b.json.hash], "delete-all names only what was still there");
    const none = await call("POST", "/telemetry/delete-all", {});
    assert.equal(none.json.deleted, 0);
    assert.equal(none.json.receipt, undefined);
    assert.equal((await call("GET", "/telemetry/receipts")).json.receipts.length, 2);
  });
});

test("DK1378: a machine token cannot delete or read another tenant's receipts, and a young person's tenant has nothing to erase", async () => {
  let t: Tenant = person;
  await withServer(() => t, async (call) => {
    await call("POST", "/telemetry/content", { kind: "text", content: "to be erased by the person only" });
    t = { ...person, machine: "ci" };
    assert.equal((await call("POST", "/telemetry/delete-all", {})).status, 403);
    t = { ...person, name: "other-tenant" };
    assert.deepEqual((await call("GET", "/telemetry/receipts")).json.receipts, [], "receipts are the tenant's own");
    t = { ...person, name: "young-tenant", minor: true };
    const r = await call("POST", "/telemetry/delete-all", {});
    assert.equal(r.json.deleted, 0);
    assert.equal(r.json.receipt, undefined);
  });
});
