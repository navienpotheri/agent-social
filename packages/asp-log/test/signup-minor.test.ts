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


/** The browser flow for one person: the form, Google, the callback; returns the tenant made. */
async function signUp(url: string, g: { url: string }, tenants: Tenant[], fields: Record<string, string>, code: string) {
  const post = await fetch(`${url}/join`, form(fields));
  assert.equal(post.status, 303, await post.text());
  const loc = new URL(post.headers.get("location")!);
  const cookie = /asp_join=([0-9a-f]+)/.exec(post.headers.get("set-cookie")!)![1];
  const back = await fetch(`${url}/auth/callback?code=${code}&state=${encodeURIComponent(loc.searchParams.get("state")!)}`, { headers: { cookie: `asp_join=${cookie}` } });
  assert.equal(back.status, 201);
  void g;
  return tenants.find((t) => t.name === fields.name)!;
}

test("SO9: the join form offers the choice that an agent in the tenant is run by someone under 18; choosing it marks the tenant, and not choosing it leaves it unmarked", async () => {
  const g = await fakeGoogle({ "c1": { sub: "g-1", email: "p1@example.org", email_verified: true }, "c2": { sub: "g-2", email: "p2@example.org", email_verified: true }, "c3": { sub: "g-3", email: "p3@example.org", email_verified: true } });
  const { url, tenants } = await service(g.url);
  const html = await (await fetch(`${url}/join`)).text();
  assert.match(html, /name="minor" value="yes"/);
  assert.doesNotMatch(html.match(/<input[^>]*name="minor"[^>]*>/)![0], /required/, "the choice is optional");
  assert.match(html, /someone under 18/);
  const kid = await signUp(url, g, tenants, { ...GOOD, name: "kid-one", minor: "yes" }, "c1");
  assert.equal(kid.minor, true, "marked at sign-up");
  const adult = await signUp(url, g, tenants, { ...GOOD, name: "adult-one" }, "c2");
  assert.equal(adult.minor, undefined, "not marked when not chosen");
  const other = await signUp(url, g, tenants, { ...GOOD, name: "adult-two", minor: "on" }, "c3");
  assert.equal(other.minor, undefined, "only the form's value yes marks it");
});

test("SO9: the sign-up API takes minor true or nothing; any other value makes no tenant", async () => {
  const tenants: Tenant[] = [];
  const su = new Signup({ tenants: () => tenants, add: (t) => { tenants.push(t); }, termsVersion: "v1", difficulty: 0, perGoogleAccount: 10 });
  const body = (name: string, over: Record<string, unknown> = {}) => ({ name, accept_terms: true, terms_version: "v1", declaration: "adult_or_guardian", ...over });
  assert.equal(su.registerVerified("203.0.113.1", body("with-mark", { minor: true }), { sub: "a", email: "a@example.org" }).ok, true);
  assert.equal(tenants.find((t) => t.name === "with-mark")!.minor, true);
  assert.equal(su.registerVerified("203.0.113.2", body("no-mark"), { sub: "b", email: "b@example.org" }).ok, true);
  assert.equal(tenants.find((t) => t.name === "no-mark")!.minor, undefined);
  for (const bad of ["yes", false, 1, null]) {
    const r = su.registerVerified("203.0.113.3", body("bad-mark", { minor: bad }), { sub: "c", email: "c@example.org" });
    assert.equal(r.ok, false);
    assert.equal((r as { error?: { code: string } }).error?.code ?? (r as { code?: string }).code, "BAD_MINOR", `minor ${JSON.stringify(bad)}`);
  }
  assert.equal(tenants.some((t) => t.name === "bad-mark"), false, "no tenant was made");
});
