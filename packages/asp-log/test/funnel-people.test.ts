// Row U10 (spec-delta S1451): the beta funnel of a person (the join page, the form, the account, the first write by one of their agents, a return) is measured on a running service, by source, with counts only.
// A scripted person stops at each step and moves exactly the matching counter once. Google is a stand-in; fake tokens only.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { FUNNEL_PERSON_STEPS, FunnelTap, GoogleSignIn, Signup, createLogServer, type Tenant } from "../src/index.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const listen = async (s: Server) => { await new Promise<void>((r) => s.listen(0, "127.0.0.1", r)); servers.push(s); return `http://127.0.0.1:${(s.address() as { port: number }).port}`; };

async function fakeGoogle(people: Record<string, { sub: string; email: string; email_verified: boolean }>) {
  const s = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    res.setHeader("content-type", "application/json");
    if (req.url === "/token") {
      const code = new URLSearchParams(Buffer.concat(chunks).toString("utf8")).get("code") ?? "";
      if (!people[code]) { res.writeHead(400); return res.end(JSON.stringify({ error: "invalid_grant" })); }
      return res.end(JSON.stringify({ access_token: `at-${code}`, token_type: "Bearer" }));
    }
    if (req.url === "/userinfo") {
      const who = people[String(req.headers.authorization ?? "").replace("Bearer at-", "")];
      if (!who) { res.writeHead(401); return res.end("{}"); }
      return res.end(JSON.stringify(who));
    }
    res.writeHead(404); res.end();
  });
  return listen(s);
}

const counts = (tap: FunnelTap) => FUNNEL_PERSON_STEPS.map((s) => tap.person.count(s));
const from = (ip: string, extra: Record<string, string> = {}) => ({ "x-forwarded-for": ip, ...extra });
const form = (ip: string, fields: Record<string, string>) => ({ method: "POST", headers: from(ip, { "content-type": "application/x-www-form-urlencoded" }), body: new URLSearchParams(fields), redirect: "manual" as const });
const GOOD = { accept_terms: "yes", terms_version: "v1", declaration: "adult_or_guardian" };

async function setup() {
  let now = Date.now();
  const tap = new FunnelTap({ now: () => new Date(now), trustProxy: true });
  const g = await fakeGoogle({ "code-a": { sub: "g-a", email: "a@example.org", email_verified: true }, "code-b": { sub: "g-b", email: "b@example.org", email_verified: true } });
  const tenants: Tenant[] = [{ name: "ops", role: "admin", tokenSha256: "0".repeat(64) }];
  const signup = new Signup({ tenants: () => tenants, add: (t) => { tenants.push(t); }, termsVersion: "v1", termsUrl: "https://example.org/terms", difficulty: 8, secret: Buffer.alloc(32, 7) });
  const google = new GoogleSignIn({ clientId: "client-1", clientSecret: "the-secret", redirectUri: "https://svc.example/auth/callback", authUrl: `${g}/auth`, tokenUrl: `${g}/token`, userinfoUrl: `${g}/userinfo` });
  const handle = { append: async () => ({ id: "x", seq: 1 }), log: {} } as never;
  const server = createLogServer({ handle, tenants, signup, google, publicUrl: "https://svc.example", noAuth: false, trustProxy: true, funnel: tap });
  const url = await listen(server);
  return { tap, url, advance: (ms: number) => { now += ms; } };
}
async function signUp(url: string, ip: string, name: string, code: string, src = ""): Promise<string> {
  const post = await fetch(`${url}/join`, form(ip, { ...GOOD, name }));
  const cookie = /asp_join=([0-9a-f]+)/.exec(post.headers.get("set-cookie")!)![1];
  const state = new URL(post.headers.get("location")!).searchParams.get("state")!;
  const back = await fetch(`${url}/auth/callback?code=${code}&state=${encodeURIComponent(state)}${src}`, { headers: from(ip, { cookie: `asp_join=${cookie}` }) });
  assert.equal(back.status, 201);
  return /id="token">([A-Za-z0-9_-]{43})</.exec(await back.text())![1];
}

test("a scripted person stops at each step and moves exactly the matching counter once, by source", async () => {
  const { tap, url, advance } = await setup();
  assert.deepEqual(counts(tap), [0, 0, 0, 0, 0]);
  // views the join page twice (one visitor), with a source
  await fetch(`${url}/join?src=search-ad`, { headers: from("192.0.2.1") });
  await fetch(`${url}/join?src=search-ad`, { headers: from("192.0.2.1") });
  assert.deepEqual(counts(tap), [1, 0, 0, 0, 0]);
  // a person who looks and leaves
  await fetch(`${url}/join`, { headers: from("192.0.2.2") });
  assert.deepEqual(counts(tap), [2, 0, 0, 0, 0]);
  // a form refused (terms not accepted) is not a submission
  const refused = await fetch(`${url}/join`, form("192.0.2.1", { name: "person-one", accept_terms: "no", terms_version: "v1", declaration: "adult_or_guardian" }));
  assert.equal(refused.status, 400);
  assert.deepEqual(counts(tap), [2, 0, 0, 0, 0]);
  // submits, then finishes Google
  const post = await fetch(`${url}/join`, form("192.0.2.1", { ...GOOD, name: "person-one" }));
  assert.equal(post.status, 303);
  assert.deepEqual(counts(tap), [2, 1, 0, 0, 0]);
  const cookie = /asp_join=([0-9a-f]+)/.exec(post.headers.get("set-cookie")!)![1];
  const state = new URL(post.headers.get("location")!).searchParams.get("state")!;
  const back = await fetch(`${url}/auth/callback?code=code-a&state=${encodeURIComponent(state)}`, { headers: from("192.0.2.1", { cookie: `asp_join=${cookie}` }) });
  assert.equal(back.status, 201);
  const token = /id="token">([A-Za-z0-9_-]{43})</.exec(await back.text())![1];
  assert.deepEqual(counts(tap), [2, 1, 1, 0, 0]);
  // an agent of theirs writes: the first act, once
  const act = () => fetch(`${url}/rpc`, { method: "POST", headers: from("192.0.2.1", { authorization: `Bearer ${token}`, "content-type": "application/json" }), body: JSON.stringify({ target: "handle", method: "append", args: [{ type: "x" }] }) });
  await act(); await act();
  assert.deepEqual(counts(tap), [2, 1, 1, 1, 0]);
  // a return on a later day, once
  advance(2 * 86_400_000);
  await act(); await act();
  assert.deepEqual(counts(tap), [2, 1, 1, 1, 1]);
  // the source the visitor came with is kept to the end; the other visitor is `direct`
  assert.equal(tap.person.count("returned", "search-ad"), 1);
  assert.equal(tap.person.count("join_page_viewed", "direct"), 1);
  // the public view carries the people's drop-off with counts only
  const raw = await (await fetch(`${url}/society/funnel`)).text().catch(() => "");
  assert.ok(!raw.includes("192.0.2.") && !raw.includes("example.org") && !raw.includes("person-one") && !raw.includes(token));
  const v = tap.view();
  assert.deepEqual(v.people.steps.map((r) => r.step), [...FUNNEL_PERSON_STEPS]);
  assert.deepEqual(v.people.steps.map((r) => r.visitors), [2, 1, 1, 1, 1]);
  assert.deepEqual(v.people.worst, { step: "join_submitted", lost: 1 });
  assert.ok(!JSON.stringify(v).includes("192.0.2.") && !JSON.stringify(v).includes("person-one"));
});

test("a second person from a different source is counted for that source only, and a failed Google sign-in is not an account", async () => {
  const { tap, url } = await setup();
  await fetch(`${url}/join?src=newsletter`, { headers: from("192.0.2.11") });
  await signUp(url, "192.0.2.11", "person-two", "code-b");
  assert.equal(tap.person.count("signed_up", "newsletter"), 1);
  assert.equal(tap.person.count("signed_up", "direct"), 0);
  // Google says no: the form was submitted but there is no account
  const post = await fetch(`${url}/join`, form("192.0.2.12", { ...GOOD, name: "person-three" }));
  const cookie = /asp_join=([0-9a-f]+)/.exec(post.headers.get("set-cookie")!)![1];
  const state = new URL(post.headers.get("location")!).searchParams.get("state")!;
  const back = await fetch(`${url}/auth/callback?code=nope&state=${encodeURIComponent(state)}`, { headers: from("192.0.2.12", { cookie: `asp_join=${cookie}` }) });
  assert.ok(back.status >= 400);
  assert.equal(tap.person.count("join_submitted"), 2);
  assert.equal(tap.person.count("signed_up"), 1);
});
