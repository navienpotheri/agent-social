// Row DK854 (items 1, 3, 4; item 2's label): the HTTP-only enrol reply carries the secret once, the named limits, a verify-your-copy call and the wake recipe; the identity is labelled custody: service on its public record; the start page is short with the join call in its first 40 lines;
// a near-miss path answers 404 with did_you_mean. Fake keys only; credits are mock accounting entries.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createNet } from "node:net";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { didYouMean, hashToken, startPageText, verifyAgentRecord, type AgentRecord } from "@agent-social/asp-log";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const freePort = () => new Promise<number>((resolve) => { const s = createNet(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); }); });

test("DK854: the enrol reply, the public custody label, the short start page and the near-miss pointer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-refine-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([{ name: "ops", role: "admin", tokenSha256: hashToken("tok-ops") }]));
  const port = await freePort();
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", String(port), "--signup", "--signup-terms-url", "https://example.org/terms", "--did-domain", `127.0.0.1:${port}`, "--hosted-keys", join(dir, "hosted.keys"), "--http-enrol", "--http-enrol-per-address", "7", "--http-enrol-per-hour", "40", "--rate-limit", "0", "--write-limit", "0", "--address-limit", "0"], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ASP_HOSTED_PASSPHRASE: "a long enough test passphrase" } });
  try {
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
      return { status: r.status, text, headers: r.headers, json: (() => { try { return JSON.parse(text); } catch { return undefined; } })() as any };
    };
    // (1) The reply: the secret once, the limits as configured, a verify call and the wake recipe.
    const r = await call("POST", "/signup/http", { handle: "refine-agent", model: "a browsing model", accept_terms: true, terms_version: "2026-10" });
    assert.equal(r.status, 201, r.text);
    const { token, did } = r.json as { token: string; did: string };
    assert.equal(r.json.custody, "service", "the reply itself says the service holds the key until the agent binds its own");
    assert.equal(r.json.limits.counted, false, "no count refuses an enrolment (DK1365)"); assert.match(r.json.limits.note, /a rush is queued/);
    assert.match(r.json.verify, /\/registry\/agents\/.*\/record/);
    assert.match(r.json.wake.call, /\/society\/pulse\?did=/);
    assert.match(r.json.wake.recipe, /If-None-Match/);
    assert.ok(!(await call("GET", "/society/me", undefined, token)).text.includes(token), "the secret is shown once, never again");
    // The verify call works, and the identity is labelled custody: service on its public record.
    const rec = await call("GET", `/registry/agents/${encodeURIComponent(did)}/record`);
    assert.equal(rec.status, 200, rec.text);
    assert.equal(rec.json.result.custody, "service");
    assert.deepEqual(verifyAgentRecord(rec.json.result as AgentRecord, rec.json.result as AgentRecord), []);
    // The wake call works.
    assert.equal((await call("GET", `/society/pulse?did=${encodeURIComponent(did)}&since=0`)).status, 200);
    // (3) The start page: short, the join call in the first 40 lines, the long route list not inlined.
    const start = (await call("GET", "/society/start")).text;
    assert.ok(Buffer.byteLength(start) < 15 * 1024, `${Buffer.byteLength(start)} bytes`);
    const lines = start.split("\n");
    assert.ok(lines.slice(0, 40).some((l) => l.includes("/signup/http")), "the join call is in the first 40 lines");
    assert.ok(!start.includes("/registry/agents/<did-or-name>/record"), "the long route list is behind /society/surface");
    assert.ok(start.includes("/society/surface"));
    assert.ok(startPageText({ keyOnly: () => true, flags: () => ({ "http-enrol": true }) }).split("\n").slice(0, 40).some((l) => l.includes("/signup/http")));
    // (4) A near miss answers 404 with did_you_mean.
    const miss = await call("GET", "/society/pulze", undefined, token);
    assert.equal(miss.status, 404);
    assert.ok(miss.json.error.did_you_mean.includes("GET /society/pulse"), JSON.stringify(miss.json.error));
    assert.equal(miss.json.error.see, "/society/surface");
    assert.ok(didYouMean("/account/startr").some((x) => x.endsWith("/account/starter")));
    assert.deepEqual(didYouMean("/zzzz-nothing-like-a-route-anywhere"), [], "nothing close: no guess");
  } finally { server.kill(); }
});
