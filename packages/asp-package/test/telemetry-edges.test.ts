// The telemetry store's edges and the data-sharing route (register rows DK651, DK1303 and DK1360; found loose by a mutation check): the size and count limits at their exact values, a stored file that no longer matches its hash
// gives no content, a deleted entry gives no content, a private tenant stores the hash only, and the sharing choice is a person's and one of two words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TELEMETRY_MAX_ITEM_BYTES, TELEMETRY_MAX_ITEMS, TelemetryStore, telemetryHash, type Tenant } from "@agent-social/asp-log";
import { telemetryRoutes } from "../src/telemetry-routes.ts";

const at = "2026-11-19T00:00:00Z";

test("an item may be exactly the limit and not a byte more; a tenant may hold exactly the limit of items and not one more", () => {
  const s = new TelemetryStore();
  const full = "x".repeat(TELEMETRY_MAX_ITEM_BYTES);
  assert.equal(s.put("edge-tenant", "text", full, { at }).ok, true, "exactly the limit");
  const over = s.put("edge-tenant", "text", full + "y", { at });
  assert.deepEqual([over.ok, !over.ok && over.status], [false, 413], "one byte over");
  const t = new TelemetryStore();
  for (let i = 0; i < TELEMETRY_MAX_ITEMS; i++) t.put("full-tenant", "text", `item ${i}`, { at });
  const one = t.put("full-tenant", "text", "one more", { at });
  assert.deepEqual([one.ok, !one.ok && one.status], [false, 429], "the limit is a count of items");
  assert.equal(t.put("full-tenant", "text", "item 0", { at }).ok, true, "an item already held is not a new one");
});

test("a stored file that no longer matches its hash gives no content; a deleted entry gives none; a private tenant stores the hash only", () => {
  const dir = mkdtempSync(join(tmpdir(), "tel-"));
  const s = new TelemetryStore(dir);
  const put = s.put("dir-tenant", "text", "the real text", { at });
  assert.ok(put.ok);
  const hash = (put as { hash: string }).hash;
  assert.equal(s.get("dir-tenant", hash)?.content, "the real text");
  const file = join(dir, "dir-tenant", "content", readdirSync(join(dir, "dir-tenant", "content"))[0]);
  writeFileSync(file, "tampered");
  assert.equal(s.get("dir-tenant", hash)?.content, undefined, "a file that does not hash to its name is not shown as that content");
  const mem = new TelemetryStore();
  const p2 = mem.put("mem-tenant", "text", "to delete", { at }) as { hash: string };
  mem.deleteWithReceipt("mem-tenant", at, [p2.hash]);
  const got = mem.get("mem-tenant", p2.hash);
  assert.ok(got && got.content === undefined && got.entry.deletedAt, "the entry says it was deleted and shows no text");
  const priv = mem.put("priv-tenant", "text", "keep this private", { at, private: true });
  assert.deepEqual([priv.ok, priv.ok && priv.stored, priv.ok && priv.hash], [true, false, telemetryHash("keep this private")]);
  assert.equal(mem.get("priv-tenant", telemetryHash("keep this private"))?.content, undefined, "no text is kept");
  assert.equal(mem.list("priv-tenant")[0].hashOnly, true);
});

test("the data-sharing choice is a person's and one of share or private", async () => {
  const store = new TelemetryStore();
  let tenant: Tenant = { name: "share-tenant", role: "tenant", tokenSha256: "0".repeat(64) };
  const updates: unknown[] = [];
  const route = telemetryRoutes({ store, now: () => at, updateTenant: (n: string, p: unknown) => { updates.push([n, p]); } } as never);
  const server = createServer(async (req, res) => { if (!(await route(req, res, { tenant }))) { res.writeHead(404); res.end(); } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const post = async (b: unknown) => { const r = await fetch(base + "/telemetry/sharing", { method: "POST", body: JSON.stringify(b) }); return r.status; };
    assert.equal(await post({ choice: "whatever" }), 400, "one of two words");
    assert.equal(await post({ choice: "private" }), 200);
    assert.equal(updates.length, 1, "only the valid choice was recorded");
    tenant = { ...tenant, machine: true } as unknown as Tenant;
    assert.equal(await post({ choice: "private" }), 403, "a machine token cannot change it");
    assert.equal(updates.length, 1);
  } finally { server.close(); }
});
