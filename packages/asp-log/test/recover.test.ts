import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { GoogleSignIn, Signup, createLogServer, hashToken, type Tenant } from "../src/index.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const listen = async (s: Server) => { await new Promise<void>((r) => s.listen(0, "127.0.0.1", r)); servers.push(s); return `http://127.0.0.1:${(s.address() as { port: number }).port}`; };

/** A stand-in for Google: the token endpoint answers a known code, the userinfo endpoint says who the access token belongs to. */
async function fakeGoogle(people: Record<string, { sub: string; email: string; email_verified: boolean }>) {
  const seen: { tokenBody?: URLSearchParams } = {};
  const s = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    res.setHeader("content-type", "application/json");
    if (req.url === "/token") {
      seen.tokenBody = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      const code = seen.tokenBody.get("code") ?? "";
      if (!people[code] || seen.tokenBody.get("client_secret") !== "the-secret") { res.writeHead(400); return res.end(JSON.stringify({ error: "invalid_grant" })); }
      return res.end(JSON.stringify({ access_token: `at-${code}`, token_type: "Bearer" }));
    }
    if (req.url === "/userinfo") {
      const who = people[String(req.headers.authorization ?? "").replace("Bearer at-", "")];
      if (!who) { res.writeHead(401); return res.end("{}"); }
      return res.end(JSON.stringify(who));
    }
    res.writeHead(404); res.end();
  });
  const url = await listen(s);
  return { url, seen };
}

async function service(googleUrl: string, over: Record<string, unknown> = {}) {
  const tenants: Tenant[] = [{ name: "ops", role: "admin", tokenSha256: "0".repeat(64) }];
  const signup = new Signup({ tenants: () => tenants, add: (t) => { tenants.push(t); }, rotate: over.noRotate ? undefined : (name, sha, at) => { const t = tenants.find((x) => x.name === name)!; t.tokenSha256 = sha; t.tokenRotatedAt = at; t.machineTokens = (t.machineTokens ?? []).map((m) => (m.revoked ? m : { ...m, revoked: at })); }, termsVersion: "v1", termsUrl: "https://svc.example/terms", difficulty: 0, anonymous: false, joinUrl: "https://svc.example/join", ...over });
  const google = new GoogleSignIn({ clientId: "client-1", clientSecret: "the-secret", redirectUri: "https://svc.example/auth/callback", authUrl: `${googleUrl}/auth`, tokenUrl: `${googleUrl}/token`, userinfoUrl: `${googleUrl}/userinfo` });
  const server = createLogServer({ handle: undefined as never, tenants, signup, google, publicUrl: "https://svc.example", noAuth: false });
  const url = await listen(server);
  return { url, tenants };
}

const form = (fields: Record<string, string>) => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields), redirect: "manual" as const });
const GOOD = { name: "kid-bot", accept_terms: "yes", terms_version: "v1", declaration: "adult_or_guardian" };

/** Signs a tenant up through the browser flow and returns its first token. */
async function signUp(url: string, name: string, code: string): Promise<string> {
  const post = await fetch(`${url}/join`, form({ ...GOOD, name }));
  const cookie = /asp_join=([0-9a-f]+)/.exec(post.headers.get("set-cookie")!)![1];
  const state = new URL(post.headers.get("location")!).searchParams.get("state")!;
  const back = await fetch(`${url}/auth/callback?code=${code}&state=${encodeURIComponent(state)}`, { headers: { cookie: `asp_join=${cookie}` } });
  assert.equal(back.status, 201);
  return /id="token">([A-Za-z0-9_-]{43})</.exec(await back.text())![1];
}
/** Starts a recovery and comes back from Google as `code`. */
async function recover(url: string, code: string, name = "") {
  const post = await fetch(`${url}/join/recover`, form({ name }));
  assert.ok(post.status === 303 || post.status === 400, `recover form answered ${post.status}`);
  if (post.status === 400) return post;
  const cookie = /asp_join=([0-9a-f]+)/.exec(post.headers.get("set-cookie")!)![1];
  const state = new URL(post.headers.get("location")!).searchParams.get("state")!;
  return fetch(`${url}/auth/callback?code=${code}&state=${encodeURIComponent(state)}`, { headers: { cookie: `asp_join=${cookie}` } });
}
const tokenIn = async (r: Response) => /id="token">([A-Za-z0-9_-]{43})</.exec(await r.text())![1];
/** An unknown route: 404 means the token was accepted, 401 that it was not. */
const accepted = async (url: string, token: string) => (await fetch(`${url}/anything`, { headers: { authorization: `Bearer ${token}` } })).status === 404;

// UC-262, gap U1: a person who lost their token signs in with the same Google account and gets a new one.
test("token recovery: the same verified Google account gets a new token, shown once; the old token stops working and so do the machine tokens; the identity records are untouched", async () => {
  const g = await fakeGoogle({ "code-parent": { sub: "g-1", email: "parent@example.org", email_verified: true }, "code-other": { sub: "g-9", email: "stranger@example.org", email_verified: true } });
  const { url, tenants } = await service(g.url);
  assert.match(await (await fetch(`${url}/join`)).text(), /href="\/join\/recover"/, "the sign-up page links to recovery");
  const form1 = await (await fetch(`${url}/join/recover`)).text();
  assert.match(form1, /Lost your token\?/);

  const first = await signUp(url, "kid-bot", "code-parent");
  assert.equal(await accepted(url, first), true);
  const t = tenants.find((x) => x.name === "kid-bot")!;
  t.machineTokens = [{ name: "ci", tokenSha256: hashToken("machine-1"), createdAt: "2026-11-01T00:00:00Z", expiresAt: "2027-02-01T00:00:00Z" }];

  // A stranger's Google account finds nothing, and changes nothing.
  const stranger = await recover(url, "code-other");
  assert.equal(stranger.status, 404);
  assert.match(await stranger.text(), /no tenant was signed up with this Google account/);
  assert.equal(await accepted(url, first), true, "the stranger changed nothing");

  // The owner recovers.
  const back = await recover(url, "code-parent");
  assert.equal(back.status, 200);
  assert.equal(back.headers.get("cache-control"), "no-store");
  const html = await back.text();
  assert.match(html, /A new token for kid-bot/);
  assert.match(html, /shown once/);
  const second = /id="token">([A-Za-z0-9_-]{43})</.exec(html)![1];
  assert.notEqual(second, first);
  assert.equal(await accepted(url, second), true, "the new token works");
  assert.equal(await accepted(url, first), false, "the old token stopped working");
  assert.ok(t.tokenRotatedAt, "when it happened is recorded");
  assert.ok(t.machineTokens![0].revoked, "the machine token was revoked");
  assert.equal(t.signup?.google?.sub, "g-1", "the tenant is still tied to the same account");
  assert.notEqual(t.tokenSha256, second, "only a hash is kept");
});

test("token recovery with several tenants needs the name; a closed tenant, a wrong name and too many tries are refused; and a service without it says so", async () => {
  const g = await fakeGoogle({ "code-parent": { sub: "g-1", email: "parent@example.org", email_verified: true } });
  const { url, tenants } = await service(g.url);
  const a = await signUp(url, "kid-one", "code-parent");
  const b = await signUp(url, "kid-two", "code-parent");
  const ambiguous = await recover(url, "code-parent");
  assert.equal(ambiguous.status, 409);
  assert.match(await ambiguous.text(), /holds 2 tenants \(kid-one, kid-two\): say which one/);
  assert.equal(await accepted(url, a), true);
  assert.equal(await accepted(url, b), true);
  assert.equal((await recover(url, "code-parent", "kid-nope")).status, 404);
  const two = await tokenIn(await recover(url, "code-parent", "kid-two"));
  assert.equal(await accepted(url, two), true);
  assert.equal(await accepted(url, b), false, "kid-two's old token is gone");
  assert.equal(await accepted(url, a), true, "kid-one was not touched");
  // A name that is not a name never reaches Google.
  assert.equal((await recover(url, "code-parent", "Bad Name")).status, 400);
  // A closed tenant cannot be recovered.
  tenants.find((x) => x.name === "kid-one")!.closed = { at: "2026-11-02T00:00:00Z", retainUntil: "2027-02-02T00:00:00Z" };
  assert.equal((await recover(url, "code-parent", "kid-one")).status, 404);
  // Five a day, then no more.
  for (let i = 0; i < 4; i++) assert.equal((await recover(url, "code-parent", "kid-two")).status, 200);
  assert.equal((await recover(url, "code-parent", "kid-two")).status, 429);
});

test("a service that has no token rotation says recovery is not available", async () => {
  const g = await fakeGoogle({ "code-parent": { sub: "g-1", email: "parent@example.org", email_verified: true } });
  const { url } = await service(g.url, { noRotate: true });
  await signUp(url, "kid-bot", "code-parent");
  const r = await recover(url, "code-parent");
  assert.equal(r.status, 404);
  assert.match(await r.text(), /token recovery is not available/);
});
