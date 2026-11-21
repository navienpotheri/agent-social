// Row DK1211 (spec-delta S1450): the funnel counters are wired to the real front door. On a running service a scripted agent that stops at each step moves exactly the matching counter once, the counts are by
// source, the public view holds counts only (no address, key, token or name), a step that cannot be counted never fails the request, and the counts survive a restart. Fake keys; no real traffic.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { b64urlEncode, publicKeyFromSeed, randomSeed, signBytes } from "@agent-social/asp-core";
import { FUNNEL_STEPS, FunnelTap, KeyOnlyBans, Signup, createLogServer, frontDoorRoutes, keyProofMessage, solveChallenge, type Tenant } from "../src/index.ts";

const servers: Server[] = [];
const dirs: string[] = [];
after(() => { for (const s of servers) s.close(); for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

async function service(tap: FunnelTap | null, opts: { appendThrows?: boolean } = {}) {
  const tenants: Tenant[] = [{ name: "ops", role: "admin", tokenSha256: "0".repeat(64) }];
  const signup = new Signup({ tenants: () => tenants, add: (x) => { tenants.push(x); }, termsVersion: "v1", termsUrl: "https://example.org/terms", difficulty: 8, secret: Buffer.alloc(32, 7), bans: new KeyOnlyBans() });
  const handle = { append: async () => { if (opts.appendThrows) throw new Error("nope"); return { id: "x", seq: 1 }; }, log: {} } as never;
  const publicRoutes = frontDoorRoutes({ keyOnly: () => true, trustProxy: true, ...(tap ? { funnel: tap } : {}) });
  const server = createLogServer({ handle, tenants, signup, publicRoutes, trustProxy: true, noAuth: false, ...(tap ? { funnel: tap } : {}) });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r)); servers.push(server);
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, tenants };
}
const from = (ip: string, extra: Record<string, string> = {}) => ({ "x-forwarded-for": ip, ...extra });
async function enrol(url: string, ip: string, name: string) {
  const ch = (await (await fetch(`${url}/signup/challenge`, { headers: from(ip) })).json()) as { challenge: string; salt: string; difficulty: number };
  const seed = randomSeed();
  const r = await fetch(`${url}/signup/key`, { method: "POST", headers: from(ip, { "content-type": "application/json" }), body: JSON.stringify({ name, accept_terms: true, terms_version: "v1", challenge: ch.challenge, nonce: solveChallenge(ch.salt, ch.difficulty), public_key: b64urlEncode(publicKeyFromSeed(seed)), key_proof: b64urlEncode(signBytes(keyProofMessage(ch.challenge, name), seed)) }) });
  assert.equal(r.status, 201);
  return ((await r.json()) as { token: string }).token;
}
const act = (url: string, ip: string, token: string) => fetch(`${url}/rpc`, { method: "POST", headers: from(ip, { authorization: `Bearer ${token}`, "content-type": "application/json" }), body: JSON.stringify({ target: "handle", method: "append", args: [{ type: "x" }] }) });
const counts = (tap: FunnelTap) => FUNNEL_STEPS.map((s) => tap.funnel.count(s));
const view = async (url: string, q = "") => (await (await fetch(`${url}/society/funnel${q}`)).json()) as { dropOff: { step: string; visitors: number }[]; worstStep: { step: string; lost: number } | null; counts: unknown[]; sources: string[] };

test("a scripted agent that stops at each step moves exactly the matching counter once, on a running service", async () => {
  let now = new Date().toISOString();
  const tap = new FunnelTap({ now: () => now });
  const { url } = await service(tap);
  assert.deepEqual(counts(tap), [0, 0, 0, 0, 0, 0]);
  // 1. reads the start page (twice: still one visitor)
  assert.equal((await fetch(`${url}/society/start?src=llms-txt`, { headers: from("198.51.100.1") })).status, 200);
  await fetch(`${url}/society/start?src=llms-txt`, { headers: from("198.51.100.1") });
  assert.deepEqual(counts(tap), [1, 0, 0, 0, 0, 0]);
  // llms.txt counts too, for another visitor; a route that is not the door does not
  await fetch(`${url}/society/llms.txt?src=mcp-registry`, { headers: from("198.51.100.2") });
  await fetch(`${url}/society/surface`, { headers: from("198.51.100.3") });
  assert.deepEqual(counts(tap), [2, 0, 0, 0, 0, 0]);
  // 2. enrols: counted for the source it arrived with
  const token = await enrol(url, "198.51.100.1", "scripted-one");
  assert.deepEqual(counts(tap), [2, 1, 0, 0, 0, 0]);
  assert.equal(tap.funnel.count("enrolled", "llms-txt"), 1);
  // a refused enrolment moves nothing
  const bad = await fetch(`${url}/signup/key`, { method: "POST", headers: from("198.51.100.9", { "content-type": "application/json" }), body: "{}" });
  assert.ok(bad.status >= 400);
  assert.deepEqual(counts(tap), [2, 1, 0, 0, 0, 0]);
  // 3. a request that does not write is not an act; a write is, once
  await fetch(`${url}/health`, { headers: from("198.51.100.1", { authorization: `Bearer ${token}` }) });
  assert.equal(counts(tap)[2], 0);
  assert.equal((await act(url, "198.51.100.1", token)).status, 200);
  await act(url, "198.51.100.1", token);
  assert.deepEqual(counts(tap), [2, 1, 1, 0, 0, 0]);
  // 4. a request on the enrolment day is not a return; two days later it is, once
  now = new Date(Date.parse(now) + 2 * 86_400_000).toISOString();
  await act(url, "198.51.100.1", token); await act(url, "198.51.100.1", token);
  assert.deepEqual(counts(tap), [2, 1, 1, 0, 0, 1]);
  // the public view: the steps in order, counts only
  const v = await view(url);
  assert.deepEqual(v.dropOff.map((r) => r.step), [...FUNNEL_STEPS]);
  assert.deepEqual(v.dropOff.map((r) => r.visitors), [2, 1, 1, 0, 0, 1]);
  assert.deepEqual(v.worstStep, { step: "enrolled", lost: 1 });
  assert.deepEqual(v.sources, ["llms-txt", "mcp-registry"]);
  assert.equal((await view(url, "?source=mcp-registry")).dropOff[0].visitors, 1);
  const raw = JSON.stringify(v);
  for (const secret of ["198.51.100", token, "scripted-one"]) assert.ok(!raw.includes(secret), `the view holds no ${secret}`);
  assert.equal((await fetch(`${url}/society/funnel`, { method: "POST", headers: from("198.51.100.1") })).status, 405);
});

test("the lesson steps are counted by the course routes' hook, one visitor once, with the source the visitor arrived with", () => {
  const tap = new FunnelTap();
  tap.step("start_page_read", "203.0.113.7", "mcp-registry");
  tap.step("free_lesson_started", "203.0.113.7"); tap.step("free_lesson_started", "203.0.113.7");
  tap.step("free_lesson_passed", "203.0.113.7");
  assert.deepEqual(counts(tap), [1, 0, 0, 1, 1, 0]);
  assert.equal(tap.funnel.count("free_lesson_passed", "mcp-registry"), 1);
  tap.step("free_lesson_started", "203.0.113.8");
  assert.equal(tap.funnel.count("free_lesson_started", "direct"), 1, "no source is the label direct");
});

test("a source that is text, not a label, is not stored; a refused write is not an act; a service without a tap behaves as before", async () => {
  const tap = new FunnelTap();
  const { url } = await service(tap, { appendThrows: true });
  await fetch(`${url}/society/start?src=${encodeURIComponent("Alice <a@b.c> secret")}`, { headers: from("198.51.100.5") });
  assert.deepEqual(tap.funnel.sources(), ["direct"]);
  const token = await enrol(url, "198.51.100.5", "writer-fails");
  const r = (await (await act(url, "198.51.100.5", token)).json()) as { ok: boolean };
  assert.equal(r.ok, false);
  assert.equal(counts(tap)[2], 0, "a write the log refused is not a first act");
  const plain = await service(null);
  assert.equal((await fetch(`${plain.url}/society/start`)).status, 200);
  assert.notEqual((await fetch(`${plain.url}/society/funnel`)).status, 200, "no funnel is served unless the service keeps one");
});

test("the counts survive a restart in a file that holds hashes only, and a damaged file starts empty", () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-funnel-")); dirs.push(dir);
  const file = join(dir, "tokens.funnel.json");
  const a = new FunnelTap({ file });
  a.step("start_page_read", "203.0.113.50", "llms-txt"); a.step("enrolled", "203.0.113.50");
  a.flush();
  assert.ok(!readFileSync(file, "utf8").includes("203.0.113.50"), "the file has no address");
  const b = new FunnelTap({ file });
  assert.deepEqual(counts(b), [1, 1, 0, 0, 0, 0]);
  assert.equal(b.step("start_page_read", "203.0.113.50", "llms-txt"), false, "still one visitor after the restart");
  const bad = join(dir, "bad.json");
  writeFileSync(bad, "{not json");
  assert.deepEqual(counts(new FunnelTap({ file: bad })), [0, 0, 0, 0, 0, 0]);
  writeFileSync(bad, JSON.stringify({ "nonsense|x": ["zz"], "enrolled|Bad Source": ["0123456789abcdef"], "enrolled|ok": ["0123456789abcdef", "<script>"] }));
  assert.deepEqual(counts(new FunnelTap({ file: bad })), [0, 1, 0, 0, 0, 0], "only a known step, a valid source and a 16-hex hash are read");
  assert.equal(existsSync(`${file}.tmp`), false);
});
