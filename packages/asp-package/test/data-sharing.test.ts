// DK1360: an organisation chooses whether its data is shared. A tenant that keeps its data private never has text in the shared store (only the hash, which the signed log may carry), is left out of every
// study, and sees the choice; the always-on rule is unchanged for a tenant that shares (the default). Fake values only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TelemetryStore, telemetryHash, type Tenant } from "@agent-social/asp-log";
import { telemetryRoutes } from "../src/telemetry-routes.ts";

const SECRET = "the quarterly plan: acquire the competitor in March";
const base: Tenant = { name: "acme", role: "tenant", tokenSha256: "0".repeat(64) };

async function withService(dir: string | undefined, fn: (call: (as: Tenant, method: string, path: string, body?: unknown) => Promise<{ status: number; json: any }>, state: { tenant: Tenant }, store: TelemetryStore) => Promise<void>) {
  const store = new TelemetryStore(dir);
  const state = { tenant: { ...base } as Tenant };
  const route = telemetryRoutes({ store, now: () => "2026-11-21T10:00:00Z", updateTenant: (_n, patch) => { state.tenant = { ...state.tenant, ...patch }; } });
  let current: Tenant = state.tenant;
  const server = createServer(async (req, res) => { if (!(await route(req, res, { tenant: current }))) { res.writeHead(404); res.end(); } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    await fn(async (as, method, path, body) => { current = { ...state.tenant, ...as, ...(as.dataSharing ? {} : { dataSharing: state.tenant.dataSharing }) }; const r = await fetch(url + path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: r.status, json: await r.json() }; }, state, store);
  } finally { server.close(); }
}

test("the choice is shown with the options and the terms, defaults to share, is changed only by a person (not a machine token), and refuses anything else", async () => {
  await withService(undefined, async (call, state) => {
    const shown = await call(base, "GET", "/telemetry/sharing");
    assert.equal(shown.json.choice, "share");
    assert.match(shown.json.options.private, /never stored here/);
    assert.match(shown.json.terms, /dpa-draft\.md section 3/);
    assert.equal((await call({ ...base, machine: true } as Tenant, "POST", "/telemetry/sharing", { choice: "private" })).status, 403, "a machine token cannot change it");
    assert.equal((await call(base, "POST", "/telemetry/sharing", { choice: "maybe" })).status, 400);
    const set = await call(base, "POST", "/telemetry/sharing", { choice: "private" });
    assert.equal(set.status, 200);
    assert.deepEqual(state.tenant.dataSharing, { choice: "private", at: "2026-11-21T10:00:00Z" }, "recorded in the tenant");
    assert.equal((await call(state.tenant, "GET", "/telemetry")).json.sharing, "private", "the status shows it");
  });
});

test("a private tenant's text is never in the store: only the hash, which is the hash of the text; a sharing tenant's text is stored as before", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-sharing-"));
  await withService(dir, async (call, state, store) => {
    const shared = await call(base, "POST", "/telemetry/content", { kind: "trajectory", content: "a shared note" });
    assert.deepEqual([shared.status, shared.json.stored], [201, true]);
    await call(base, "POST", "/telemetry/sharing", { choice: "private" });
    const put = await call(state.tenant, "POST", "/telemetry/content", { kind: "trajectory", content: SECRET });
    assert.equal(put.status, 200);
    assert.deepEqual([put.json.stored, put.json.private], [false, true]);
    assert.equal(put.json.hash, telemetryHash(SECRET), "the hash the signed log may carry is the hash of the text");
    // nothing on disk holds the text, and the store cannot return it
    const files = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)]));
    for (const f of files(dir)) assert.ok(!readFileSync(f, "utf8").includes(SECRET), `${f} does not hold the text`);
    assert.equal(existsSync(join(dir, "acme", "content", `${telemetryHash(SECRET).slice(7)}.txt`)), false);
    assert.equal(store.get("acme", telemetryHash(SECRET))?.content, undefined);
    assert.ok(store.list("acme").some((e) => e.hash === telemetryHash(SECRET) && e.hashOnly), "the hash is listed");
    const got = await call(state.tenant, "GET", `/telemetry/content/${telemetryHash(SECRET)}`);
    assert.equal(got.json.content, undefined);
  });
});

test("a study reads only the text of tenants that share: a private tenant and a young person's are left out", () => {
  const store = new TelemetryStore();
  const at = "2026-11-21T10:00:00Z";
  store.put("open-one", "text", "open text", { at });
  store.put("acme", "text", "acme text before choosing", { at });
  store.put("acme", "text", SECRET, { private: true, at });
  store.put("kid-one", "text", "kid text", { at });
  const tenants = [{ name: "open-one" }, { name: "acme", dataSharing: { choice: "private" } }, { name: "kid-one", minor: true }];
  const study = store.studySet(tenants);
  assert.deepEqual(study.map((s) => s.tenant), ["open-one"], "only the tenant that shares");
  assert.equal(store.studySet([{ name: "acme" }]).length, 1, "were acme to share, only its stored text (not the hash-only entry) would count");
  assert.ok(!JSON.stringify(study).includes(telemetryHash(SECRET)), "the private hash is not in a study");
});
