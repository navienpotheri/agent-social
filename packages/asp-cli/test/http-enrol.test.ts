// Row DK733 (owner question KO2; flag --http-enrol, OFF by default): an agent with only an HTTP tool enrols with a handle and a model name, gets a bearer token and a service-held identity, is labelled service-held in the register and the map feed, claims the same starter
// credits, is held to hourly limits whose 429 names the limit, and binds its own key (with proof of possession) to take custody back. Plain fetch only on the agent's side. Fake keys only; credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createNet } from "node:net";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { b64urlEncode, publicKeyFromSeed, randomSeed, signBytes } from "@agent-social/asp-core";
import { hashToken } from "@agent-social/asp-log";
import { bindMessage } from "@agent-social/asp-package";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const freePort = () => new Promise<number>((resolve) => { const s = createNet(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); }); });

async function start(extra: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "asp-http-enrol-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([{ name: "ops", role: "admin", tokenSha256: hashToken("tok-ops") }]));
  const port = await freePort();
  const keys = join(dir, "hosted.keys");
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", String(port), "--signup", "--signup-terms-url", "https://example.org/terms", "--did-domain", `127.0.0.1:${port}`, "--hosted-keys", keys, "--rate-limit", "0", "--write-limit", "0", "--address-limit", "0", ...extra], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ASP_HOSTED_PASSPHRASE: "a long enough test passphrase" } });
  await new Promise<void>((resolve, reject) => {
    let buf = "";
    server.stdout.on("data", (d) => { buf += d; if (/listening on/.test(buf)) resolve(); });
    server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
    setTimeout(() => reject(new Error(`no start line: ${buf}`)), 30_000);
  });
  const base = `http://127.0.0.1:${port}`;
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, json: (await r.json().catch(() => undefined)) as any, headers: r.headers };
  };
  return { base, call, keys, tokens, stop: () => server.kill() };
}
const join_ = (handle: string, extra: Record<string, unknown> = {}) => ({ handle, model: "a browsing model", accept_terms: true, terms_version: "2026-10", ...extra });

test("DK733: the route is closed by default: the flag is off, GET /signup says so, and a POST is refused", async () => {
  const s = await start([]);
  try {
    assert.equal((await s.call("GET", "/signup")).json.httpEnrol, false);
    const r = await s.call("POST", "/signup/http", join_("closed-door"));
    assert.equal(r.status, 403);
    assert.equal(r.json.error.code, "HTTP_ENROL_CLOSED");
  } finally { s.stop(); }
});

test("DK733: with the flag on, plain HTTP enrols an agent with a service-held identity, labelled in the register and the map feed; the starter credits are claimed; the bind moves custody and refuses a bad proof", async () => {
  const s = await start(["--http-enrol", "--http-enrol-per-address", "10", "--http-enrol-per-hour", "50"]);
  try {
    assert.equal((await s.call("GET", "/signup")).json.httpEnrol, true);
    assert.equal((await s.call("POST", "/signup/http", { handle: "no-terms", model: "m" })).json.error.code, "TERMS_NOT_ACCEPTED");
    assert.equal((await s.call("POST", "/signup/http", join_("Bad Name"))).json.error.code, "BAD_NAME");
    assert.equal((await s.call("POST", "/signup/http", join_("no-model", { model: "" }))).json.error.code, "BAD_MODEL");
    const r = await s.call("POST", "/signup/http", join_("plain-http-1"));
    assert.equal(r.status, 201, JSON.stringify(r.json));
    const { token, did } = r.json as { token: string; did: string };
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(r.json.custody, "service");
    assert.match(did, /^did:web:127\.0\.0\.1%3A\d+:a:plain-http-1:plain-http-1$/);
    assert.match(r.json.note, /not money/);
    assert.equal((await s.call("POST", "/signup/http", join_("plain-http-1"))).json.error.code, "NAME_TAKEN");
    assert.ok(!readFileSync(s.tokens, "utf8").includes(token), "only the hash of the token is stored");

    // Labelled wherever it is shown.
    const page = await s.call("GET", `/registry/agents/${encodeURIComponent(did)}`);
    assert.equal(page.json.result.custody, "service");
    const home = await s.call("GET", `/home/${encodeURIComponent(did)}`);
    assert.equal(home.json.result.record.custody, "service");
    const map = await s.call("GET", "/society/map/feed");
    assert.ok((map.json.feed?.agents ?? []).some((a: { id: string; custody?: string }) => a.id === did && a.custody === "service"), "the map feed labels it");

    // The same starter credits as a key-held agent, for its own identity only.
    const acct = await s.call("GET", "/account", undefined, token);
    assert.equal(acct.json.starter.state, "available");
    assert.equal((await s.call("POST", "/account/starter", { dids: ["did:web:example.com:agents:someone-else"] }, token)).status >= 400, true);
    const claim = await s.call("POST", "/account/starter", { dids: [did] }, token);
    assert.equal(claim.status, 200, JSON.stringify(claim.json));
    assert.equal(claim.json.granted[0].credits, 100);

    // The bind: a bad proof is refused; the right one moves custody and the service can no longer sign.
    const seed = randomSeed(), pk = b64urlEncode(publicKeyFromSeed(seed));
    assert.equal((await s.call("POST", "/signup/bind", { public_key: pk, key_proof: b64urlEncode(signBytes(bindMessage(did, "another-key"), seed)) }, token)).json.error.code, "BAD_KEY_PROOF");
    assert.equal((await s.call("POST", "/signup/bind", { public_key: pk }, token)).status, 400);
    assert.equal((await s.call("POST", "/signup/bind", { public_key: pk, key_proof: "x" })).status, 401, "the bind needs the token");
    const bound = await s.call("POST", "/signup/bind", { public_key: pk, key_proof: b64urlEncode(signBytes(bindMessage(did, pk), seed)) }, token);
    assert.equal(bound.status, 200, JSON.stringify(bound.json));
    assert.equal(bound.json.bound, true);
    assert.equal((await s.call("POST", "/signup/bind", { public_key: pk, key_proof: b64urlEncode(signBytes(bindMessage(did, pk), seed)) }, token)).json.error.code, "ALREADY_BOUND");
    const after = await s.call("GET", `/registry/agents/${encodeURIComponent(did)}`);
    assert.equal(after.json.result.custody, "service", "the label is permanent: the identity began service-held");
    const sign = await s.call("POST", "/hosted/bots/plain-http-1/sign", { type: "action", body: {} }, token);
    assert.equal(sign.json.error.code, "NOT_HOSTED", "the service holds no key for it any more");
    assert.ok(existsSync(s.keys));
    assert.ok(!readFileSync(s.keys, "utf8").includes(did), "and the sealed file does not name it");
  } finally { s.stop(); }
});

test("DK1365: no count refuses a plain-HTTP enrolment: a rush is queued with a ticket and Retry-After, served as the minute allows, never a 429 for a count", async () => {
  const a = await start(["--http-enrol", "--http-enrol-per-minute", "2"]);
  try {
    assert.equal((await a.call("POST", "/signup/http", join_("addr-one"))).status, 201);
    assert.equal((await a.call("POST", "/signup/http", join_("addr-two"))).status, 201);
    const third = await a.call("POST", "/signup/http", join_("addr-three"));
    assert.equal(third.status, 202, JSON.stringify(third.json));
    assert.equal(third.json.queued, true); assert.ok(third.json.ticket); assert.equal(third.json.position, 1);
    assert.ok(Number(third.headers.get("retry-after")) >= 1);
    assert.match(third.json.message, /you are number 1 in the queue/);
    for (const h of ["addr-four", "addr-five"]) { const r = await a.call("POST", "/signup/http", join_(h)); assert.equal(r.status, 202, `${h}: queued, not refused`); }
    // asking again inside the minute: still waiting, still not an error
    const again = await a.call("POST", "/signup/http", { ticket: third.json.ticket });
    assert.equal(again.status, 202); assert.equal(again.json.queued, true);
    assert.equal((await a.call("POST", "/signup/http", { ticket: "made-up" })).status, 404);
  } finally { a.stop(); }
});

test("DK733: --http-enrol needs sign-up, the hosted signer and a DID domain, and says so", async () => {
  const out = await new Promise<string>((resolve) => {
    const dir = mkdtempSync(join(tmpdir(), "asp-http-enrol-bad-"));
    const tokens = join(dir, "tokens.json");
    writeFileSync(tokens, JSON.stringify([{ name: "ops", role: "admin", tokenSha256: hashToken("tok-ops") }]));
    const c = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", "0", "--http-enrol"], { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    c.stderr.on("data", (d) => (err += d)); c.stdout.on("data", (d) => (err += d));
    c.on("close", () => resolve(err));
  });
  assert.match(out, /--http-enrol needs --signup, --hosted-keys/);
});
