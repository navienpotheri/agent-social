// Row DK852: GET /society/me, the short first-minute answer: standing, starter state, credits, usage and one suggested next step that exists, in under 2 KB, with the long form one link away. Over a live service, an agent that enrolled over plain HTTP. Fake keys only; credits are mock accounting entries.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createNet } from "node:net";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashToken, surfaceListing } from "@agent-social/asp-log";
import { ME_MAX_BYTES } from "@agent-social/asp-package";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const freePort = () => new Promise<number>((resolve) => { const s = createNet(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); }); });

async function start() {
  const dir = mkdtempSync(join(tmpdir(), "asp-me-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([{ name: "ops", role: "admin", tokenSha256: hashToken("tok-ops") }]));
  const port = await freePort();
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", String(port), "--signup", "--signup-terms-url", "https://example.org/terms", "--did-domain", `127.0.0.1:${port}`, "--hosted-keys", join(dir, "hosted.keys"), "--http-enrol", "--rate-limit", "0", "--write-limit", "0", "--address-limit", "0"], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ASP_HOSTED_PASSPHRASE: "a long enough test passphrase" } });
  await new Promise<void>((resolve, reject) => {
    let buf = "";
    server.stdout.on("data", (d) => { buf += d; if (/listening on/.test(buf)) resolve(); });
    server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
    setTimeout(() => reject(new Error(`no start line: ${buf}`)), 30_000);
  });
  const base = `http://127.0.0.1:${port}`;
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await r.text();
    return { status: r.status, text, json: (() => { try { return JSON.parse(text); } catch { return undefined; } })() as any };
  };
  return { call, stop: () => server.kill() };
}

test("DK852: the first-minute answer is under 2 KB, names a next step that exists, and points to the long form; the next step follows the agent's state", async () => {
  const s = await start();
  try {
    const joined = await s.call("POST", "/signup/http", { handle: "first-minute", model: "a browsing model", accept_terms: true, terms_version: "2026-10" });
    assert.equal(joined.status, 201, joined.text);
    const { token, did } = joined.json as { token: string; did: string };
    assert.equal((await s.call("GET", "/society/me")).status, 401, "it needs the token");
    const me = await s.call("GET", "/society/me", undefined, token);
    assert.equal(me.status, 200, me.text);
    assert.ok(Buffer.byteLength(me.text) < ME_MAX_BYTES, `${Buffer.byteLength(me.text)} bytes`);
    assert.equal(me.json.did, did);
    assert.equal(me.json.more, "/account", "the long form is one link away");
    assert.match(me.json.note, /not money/);
    // The suggested next step is a route that exists.
    const routes = surfaceListing({}).groups.flatMap((g) => g.routes).map((r) => `${r.method} ${r.path}`);
    assert.equal(me.json.next.call, "POST /account/starter");
    assert.ok(routes.includes(me.json.next.call), "the next step is a listed route");
    assert.equal(me.json.starter.state, "available");
    // After the claim the next step moves on, and it is still a listed route.
    assert.equal((await s.call("POST", "/account/starter", { dids: [did] }, token)).status, 200);
    const after = await s.call("GET", "/society/me", undefined, token);
    assert.ok(Buffer.byteLength(after.text) < ME_MAX_BYTES);
    assert.notEqual(after.json.next.call, "POST /account/starter");
    assert.ok(routes.includes(after.json.next.call), after.json.next.call);
    assert.ok((after.json.credits ?? 0) >= 100, "the upfront credits show");
  } finally { s.stop(); }
});
