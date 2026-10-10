import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { GoogleSignIn, Signup, createLogServer, type Tenant } from "../src/index.ts";

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
  const signup = new Signup({ tenants: () => tenants, add: (t) => { tenants.push(t); }, termsVersion: "v1", termsUrl: "https://svc.example/terms", difficulty: 0, anonymous: false, joinUrl: "https://svc.example/join", ...over });
  const google = new GoogleSignIn({ clientId: "client-1", clientSecret: "the-secret", redirectUri: "https://svc.example/auth/callback", authUrl: `${googleUrl}/auth`, tokenUrl: `${googleUrl}/token`, userinfoUrl: `${googleUrl}/userinfo` });
  const server = createLogServer({ handle: undefined as never, tenants, signup, google, publicUrl: "https://svc.example", noAuth: false });
  const url = await listen(server);
  return { url, tenants };
}

const form = (fields: Record<string, string>) => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields), redirect: "manual" as const });
const GOOD = { name: "kid-bot", accept_terms: "yes", terms_version: "v1", declaration: "adult_or_guardian" };

test("browser sign-up: the form, Google, the callback and a token shown once; the tenant is tied to a verified Google account and the declaration is recorded", async () => {
  const g = await fakeGoogle({ "code-parent": { sub: "g-1", email: "Parent@Example.org", email_verified: true } });
  const { url, tenants } = await service(g.url);
  const page = await fetch(`${url}/join`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Continue with Google/);
  assert.match(html, /parent or legal guardian/);
  assert.match(page.headers.get("content-security-policy")!, /form-action 'self' https:\/\/accounts\.google\.com/);
  // The form sends the person to Google with a signed state and sets the cookie.
  const post = await fetch(`${url}/join`, form(GOOD));
  assert.equal(post.status, 303);
  const loc = new URL(post.headers.get("location")!);
  assert.equal(loc.origin + loc.pathname, `${g.url}/auth`);
  assert.deepEqual([loc.searchParams.get("client_id"), loc.searchParams.get("scope"), loc.searchParams.get("redirect_uri")], ["client-1", "openid email profile", "https://svc.example/auth/callback"]);
  const cookie = /asp_join=([0-9a-f]+)/.exec(post.headers.get("set-cookie")!)![1];
  assert.match(post.headers.get("set-cookie")!, /HttpOnly; SameSite=Lax/);
  const state = loc.searchParams.get("state")!;
  // Google sends the person back with a code.
  const back = await fetch(`${url}/auth/callback?code=code-parent&state=${encodeURIComponent(state)}`, { headers: { cookie: `asp_join=${cookie}` } });
  assert.equal(back.status, 201);
  const done = await back.text();
  const token = /id="token">([A-Za-z0-9_-]{43})</.exec(done)![1];
  assert.match(done, /Welcome, kid-bot/);
  assert.equal(back.headers.get("cache-control"), "no-store");
  assert.equal(g.seen.tokenBody!.get("client_secret"), "the-secret", "the server holds the secret");
  const t = tenants.find((x) => x.name === "kid-bot")!;
  assert.equal(t.role, "tenant");
  assert.notEqual(t.tokenSha256, token);
  assert.deepEqual([t.signup?.google, t.signup?.declaration], [{ sub: "g-1", email: "parent@example.org" }, "adult_or_guardian"]);
  // The state cannot be used twice for another tenant: the name is taken now.
  const again = await fetch(`${url}/auth/callback?code=code-parent&state=${encodeURIComponent(state)}`, { headers: { cookie: `asp_join=${cookie}` } });
  assert.equal(again.status, 409);
});

test("browser sign-up refuses: no terms or declaration, a bad or taken name, a state from another browser, a forged or expired state, an unverified email, Google declining", async () => {
  const g = await fakeGoogle({ "ok": { sub: "g-2", email: "a@example.org", email_verified: true }, "unverified": { sub: "g-3", email: "b@example.org", email_verified: false } });
  const { url } = await service(g.url);
  const bad = async (fields: Record<string, string>) => (await fetch(`${url}/join`, form(fields)));
  assert.equal((await bad({ ...GOOD, accept_terms: "" })).status, 400);
  assert.equal((await bad({ ...GOOD, declaration: "" })).status, 400);
  assert.equal((await bad({ ...GOOD, name: "Bad Name" })).status, 400);
  assert.equal((await bad({ ...GOOD, name: "ops" })).status, 409);
  const start = await fetch(`${url}/join`, form({ ...GOOD, name: "second-bot" }));
  const cookie = /asp_join=([0-9a-f]+)/.exec(start.headers.get("set-cookie")!)![1];
  const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
  const cb = (code: string, st: string, c: string | undefined) => fetch(`${url}/auth/callback?code=${code}&state=${encodeURIComponent(st)}`, { headers: c ? { cookie: `asp_join=${c}` } : {} });
  assert.equal((await cb("ok", state, undefined)).status, 400, "no cookie: not started in this browser");
  assert.equal((await cb("ok", state, "0".repeat(32))).status, 400, "another browser's cookie");
  assert.equal((await cb("ok", state.slice(0, -2) + "xx", cookie)).status, 400, "a forged state");
  assert.equal((await cb("nope", state, cookie)).status, 502, "Google refuses the code");
  const unverified = await cb("unverified", state, cookie);
  assert.equal(unverified.status, 403);
  assert.match(await unverified.text(), /no verified email/);
  const declined = await fetch(`${url}/auth/callback?error=access_denied`, { headers: { cookie: `asp_join=${cookie}` } });
  assert.equal(declined.status, 400);
});

test("browser sign-up limits: three tenants for one Google account, the day's cap, a closed sign-up, and the anonymous route points to /join", async () => {
  const g = await fakeGoogle({ "c": { sub: "g-9", email: "p@example.org", email_verified: true } });
  const { url, tenants } = await service(g.url, { dailyCap: 100, perAddressPerDay: 50 });
  const join = async (name: string) => {
    const start = await fetch(`${url}/join`, form({ ...GOOD, name }));
    const cookie = /asp_join=([0-9a-f]+)/.exec(start.headers.get("set-cookie")!)![1];
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    return fetch(`${url}/auth/callback?code=c&state=${encodeURIComponent(state)}`, { headers: { cookie: `asp_join=${cookie}` } });
  };
  for (const n of ["kid-one", "kid-two", "kid-three"]) assert.equal((await join(n)).status, 201, n);
  const fourth = await join("kid-four");
  assert.equal(fourth.status, 429);
  assert.match(await fourth.text(), /at most 3 tenants/);
  assert.equal(tenants.filter((t) => t.signup?.google?.sub === "g-9").length, 3);
  // The anonymous (proof of work) route is closed when Google is required.
  const anon = await fetch(`${url}/signup`, { method: "POST", body: JSON.stringify({ name: "anon-bot" }) });
  assert.equal(anon.status, 403);
  assert.match(await anon.text(), /GOOGLE_REQUIRED/);
  // A closed sign-up shows a closed page and refuses the form.
  const closed = await service(g.url, { control: () => ({ open: false, reason: "maintenance" }) });
  assert.match(await (await fetch(`${closed.url}/join`)).text(), /Sign-up is closed.*maintenance/s);
  assert.equal((await fetch(`${closed.url}/join`, form(GOOD))).status, 503);
});
