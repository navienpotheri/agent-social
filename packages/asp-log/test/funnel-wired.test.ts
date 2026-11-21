// Row DK1211: the funnel counters are wired to the real front door. A scripted agent that stops at each step moves exactly the matching counter once; the view is for an operator only and carries no address, key or token;
// the counters survive a restart. Fake keys only; credits are accounting entries, not money.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { b64urlEncode, publicKeyFromSeed, randomSeed, signBytes } from "@agent-social/asp-core";
import { FunnelTap, Signup, createLogServer, frontDoorRoutes, hashToken, keyProofMessage, solveChallenge, type Tenant } from "../src/index.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const listen = async (s: Server) => { await new Promise<void>((r) => s.listen(0, "127.0.0.1", r)); servers.push(s); return `http://127.0.0.1:${(s.address() as { port: number }).port}`; };
const ADMIN = "admin-token-for-tests";

async function service(over: { file?: string; clock?: { t: number } } = {}) {
  const clock = over.clock ?? { t: Date.now() };
  const tenants: Tenant[] = [{ name: "ops", role: "admin", tokenSha256: hashToken(ADMIN) }];
  const signup = new Signup({ tenants: () => tenants, add: (x) => { tenants.push(x); }, termsVersion: "v1", termsUrl: "https://example.org/terms", difficulty: 8, secret: Buffer.alloc(32, 7) });
  const funnel = new FunnelTap({ trustProxy: true, now: () => new Date(clock.t), ...(over.file ? { file: over.file } : {}) });
  const door = frontDoorRoutes({ keyOnly: () => true, onStep: (st, rq) => funnel.step(st, rq as never) });
  const handle = { log: {}, append: async () => ({ id: "r1" }) };
  const server = createLogServer({ handle: handle as never, tenants, signup, funnel, trustProxy: true, publicRoutes: door });
  const url = await listen(server);
  const from = (ip: string, extra: Record<string, string> = {}) => ({ "x-forwarded-for": ip, ...extra });
  const start = (ip: string, src?: string) => fetch(`${url}/society/start${src ? `?src=${encodeURIComponent(src)}` : ""}`, { headers: from(ip) });
  const enrol = async (ip: string, name: string, src?: string) => {
    const seed = randomSeed();
    const ch = (await (await fetch(`${url}/signup/challenge`, { headers: from(ip) })).json()) as { challenge: string; salt: string; difficulty: number };
    const r = await fetch(`${url}/signup/key`, { method: "POST", headers: from(ip, { "content-type": "application/json", ...(src ? { "x-asp-source": src } : {}) }), body: JSON.stringify({ name, accept_terms: true, terms_version: "v1", challenge: ch.challenge, nonce: solveChallenge(ch.salt, ch.difficulty), public_key: b64urlEncode(publicKeyFromSeed(seed)), key_proof: b64urlEncode(signBytes(keyProofMessage(ch.challenge, name), seed)) }) });
    return (await r.json()) as { ok: boolean; token: string };
  };
  const act = (token: string, ip: string) => fetch(`${url}/rpc`, { method: "POST", headers: from(ip, { authorization: `Bearer ${token}`, "content-type": "application/json" }), body: JSON.stringify({ target: "handle", method: "append", args: [{ type: "asp.test/v0", body: {} }] }) });
  const view = async (token = ADMIN, q = "") => fetch(`${url}/society/funnel${q}`, { headers: { authorization: `Bearer ${token}` } });
  return { url, funnel, tenants, start, enrol, act, view, clock };
}
const counts = (f: FunnelTap, src?: string) => Object.fromEntries(f.funnel.dropOff(src).map((r) => [r.step, r.visitors]));
const zero = { free_lesson_started: 0, free_lesson_passed: 0, returned: 0 };

test("DK1211: a scripted agent that stops at each step moves exactly the matching counter once", async () => {
  const s = await service();
  await s.start("10.0.0.1", "ads-a");
  await s.start("10.0.0.1", "ads-a");
  assert.deepEqual(counts(s.funnel), { start_page_read: 1, enrolled: 0, first_act: 0, ...zero }, "a repeat read is one visitor");
  await s.start("10.0.0.2", "ads-a");
  const b = await s.enrol("10.0.0.2", "agent-b", "ads-a");
  assert.equal(b.ok, true);
  assert.deepEqual(counts(s.funnel), { start_page_read: 2, enrolled: 1, first_act: 0, ...zero });
  await s.start("10.0.0.3");
  const c = await s.enrol("10.0.0.3", "agent-c");
  assert.equal((await s.act(c.token, "10.0.0.3")).status, 200);
  assert.equal((await s.act(c.token, "10.0.0.3")).status, 200);
  assert.deepEqual(counts(s.funnel), { start_page_read: 3, enrolled: 2, first_act: 1, ...zero }, "two acts are one first act");
  assert.deepEqual(counts(s.funnel, "ads-a"), { start_page_read: 2, enrolled: 1, first_act: 0, ...zero }, "the source from the link carries to the enrolment");
  assert.equal(s.funnel.funnel.count("first_act", "direct"), 1, "no source is direct");
  assert.deepEqual(s.funnel.funnel.worstStep(), { step: "enrolled", lost: 1 });
});

test("DK1211: an agent seen on a later day has returned, once, and a failed request counts nothing", async () => {
  const s = await service();
  const a = await s.enrol("10.1.0.1", "agent-r");
  await s.act(a.token, "10.1.0.1");
  assert.equal(s.funnel.funnel.count("returned"), 0, "the day of enrolment is not a return");
  s.clock.t += 2 * 86_400_000;
  await s.act(a.token, "10.1.0.1");
  s.clock.t += 86_400_000;
  await s.act(a.token, "10.1.0.1");
  assert.equal(s.funnel.funnel.count("returned"), 1, "a return counts once, however many days");
  await fetch(`${s.url}/signup/key`, { method: "POST", headers: { "x-forwarded-for": "10.1.0.2", "content-type": "application/json" }, body: JSON.stringify({ name: "no-proof" }) });
  assert.equal(s.funnel.funnel.count("enrolled"), 1, "a refused enrolment is not an enrolment");
  assert.equal((await fetch(`${s.url}/rpc`, { method: "POST", headers: { authorization: "Bearer wrong", "content-type": "application/json", "x-forwarded-for": "10.1.0.3" }, body: "{}" })).status, 401);
  assert.equal(s.funnel.funnel.count("first_act"), 1);
});

test("DK1211: the drop-off view is for an operator, by step and source, as JSON and text, and carries no address, key, name or token", async () => {
  const s = await service();
  await s.start("203.0.113.77", "launch-day");
  const a = await s.enrol("203.0.113.77", "secret-name-agent", "launch-day");
  await s.act(a.token, "203.0.113.77");
  assert.equal((await s.view(a.token)).status, 403, "a tenant's own token is not an operator's");
  assert.equal((await fetch(`${s.url}/society/funnel`)).status, 401, "no token, no view");
  const j = (await (await s.view(ADMIN, "?source=launch-day")).json()) as { steps: { step: string; visitors: number }[]; sources: string[] };
  assert.deepEqual(j.steps.map((r) => r.visitors), [1, 1, 1, 0, 0, 0]);
  assert.deepEqual(j.sources, ["launch-day"]);
  const text = await (await s.view(ADMIN, "?format=text")).text();
  assert.match(text, /free_lesson_started\t0/);
  assert.match(text, /Most lost at: free_lesson_started/);
  for (const body of [JSON.stringify(j), text]) for (const secret of ["203.0.113.77", "secret-name-agent", a.token, ADMIN]) assert.ok(!body.includes(secret), `the view does not carry ${secret.slice(0, 6)}`);
});

test("DK1211: a source that is not a short label is counted as direct, never stored as text", async () => {
  const s = await service();
  await s.start("10.2.0.1", "<script>alert(1)</script>");
  await s.start("10.2.0.2", "A".repeat(40));
  assert.deepEqual(s.funnel.funnel.sources(), ["direct"]);
});

test("DK1211: the counters survive a restart as hashes under a secret salt, and the file holds no address, key or name", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-funnel-"));
  const file = join(dir, "tokens.funnel.json");
  const s1 = await service({ file });
  await s1.start("198.51.100.9", "conf");
  const a = await s1.enrol("198.51.100.9", "persist-agent", "conf");
  s1.funnel.save(true);
  const raw = readFileSync(file, "utf8");
  for (const secret of ["198.51.100.9", "persist-agent", a.token]) assert.ok(!raw.includes(secret));
  const s2 = await service({ file, clock: s1.clock });
  assert.deepEqual(counts(s2.funnel, "conf"), { start_page_read: 1, enrolled: 1, first_act: 0, ...zero });
  await s2.start("198.51.100.9", "conf");
  assert.equal(s2.funnel.funnel.count("start_page_read", "conf"), 1, "the same visitor after a restart is still one visitor that day");
  const bad = join(dir, "bad.json");
  writeFileSync(bad, "{not json");
  assert.equal(new FunnelTap({ file: bad }).funnel.count("enrolled"), 0, "a damaged file starts empty rather than failing the service");
});
