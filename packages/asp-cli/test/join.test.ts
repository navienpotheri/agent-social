import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttp } from "node:http";
import { createServer as createNet } from "node:net";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashToken } from "@agent-social/asp-log";
import { main, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const freePort = () => new Promise<number>((resolve) => { const s = createNet(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); }); });
const until = async (what: string, fn: () => boolean, ms = 15_000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await new Promise((r) => setTimeout(r, 50)); } };

test("asp join: one command signs you up in the browser, the token comes back to the command (never shown), the saved login makes later commands need no export, and the person, agent and credits are set up", async () => {
  // A stand-in for Google.
  const google = createHttp(async (req, res) => {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    res.setHeader("content-type", "application/json");
    if (req.url === "/token") return res.end(JSON.stringify({ access_token: "at-1" }));
    if (req.url === "/userinfo") return res.end(JSON.stringify({ sub: "g-join", email: "Joiner@Example.org", email_verified: true }));
    res.writeHead(404); res.end();
  });
  await new Promise<void>((r) => google.listen(0, "127.0.0.1", r));
  const gUrl = `http://127.0.0.1:${(google.address() as { port: number }).port}`;

  const dir = mkdtempSync(join(tmpdir(), "asp-join-e2e-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([{ name: "ops", role: "admin", tokenSha256: hashToken("tok-ops") }]));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", String(port), "--signup", "--signup-terms-url", `${base}/terms`, "--signup-require-google",
    "--google-client-id", "client-1", "--google-redirect-uri", `${base}/auth/callback`, "--google-auth-url", `${gUrl}/auth`, "--google-token-url", `${gUrl}/token`, "--google-userinfo-url", `${gUrl}/userinfo`, "--did-domain", `127.0.0.1:${port}`],
    { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GOOGLE_CLIENT_SECRET: "the-secret" } });
  try {
    await new Promise<void>((resolve, reject) => {
      let buf = "";
      server.stdout.on("data", (d) => { buf += d; if (/listening on/.test(buf)) resolve(); });
      server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
      setTimeout(() => reject(new Error(`no start line: ${buf}`)), 20_000);
    });
    const f = makeFixture();
    const out: string[] = [], err: string[] = [];
    const env = { ASP_HOME: f.aspHome, ASP_JOIN_POLL_MS: "100" };
    const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env, cwd: f.root };
    const joining = main(["join", "--service", base, "--no-open", "--yes", "--agent-name", "helper"], io);

    // The person's browser: the address the command printed, the form, Google, the callback.
    await until("the sign-up address", () => out.some((l) => l.includes("/join?c=")));
    const address = out.find((l) => l.includes("/join?c="))!.trim();
    assert.match(address, /\/join\?c=[A-Za-z0-9_-]{43}$/);
    const formPage = await (await fetch(address)).text();
    assert.match(formPage, /name="c" value="[A-Za-z0-9_-]{43}"/);
    const c = /name="c" value="([^"]+)"/.exec(formPage)![1];
    const post = await fetch(`${base}/join`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ name: "joiner", accept_terms: "yes", terms_version: "2026-10", declaration: "adult_or_guardian", c }) });
    assert.equal(post.status, 303);
    const state = new URL(post.headers.get("location")!).searchParams.get("state")!;
    const cookie = /asp_join=([0-9a-f]+)/.exec(post.headers.get("set-cookie")!)![1];
    // Before the sign-up is finished, the pickup has nothing; a wrong verifier never finds the token.
    const early = await fetch(`${base}/join/pickup`, { method: "POST", body: JSON.stringify({ verifier: "x".repeat(43) }) });
    assert.equal(early.status, 202);
    const back = await fetch(`${base}/auth/callback?code=ok&state=${encodeURIComponent(state)}`, { headers: { cookie: `asp_join=${cookie}` } });
    assert.equal(back.status, 201);
    const page = await back.text();
    assert.match(page, /Go back to your terminal/);
    assert.ok(!/[A-Za-z0-9_-]{43}/.test(page.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/[A-Za-z]+-[A-Za-z]+/g, "")), "the page does not show a token");

    assert.equal(await joining, 0, err.join("\n"));
    const text = out.join("\n");
    const me = `did:web:127.0.0.1%3A${port}:u:joiner`, agent = `did:web:127.0.0.1%3A${port}:a:joiner:helper`;
    assert.ok(text.includes(`you      ${me}`) && text.includes(`agent    ${agent}`), text);
    assert.match(text, /500 each for you and your agent/);
    assert.match(text, /YOUR RECOVERY CODE[\s\S]*ASP-[0-9A-Z-]+/);
    const cfgPath = join(f.aspHome, "config.json");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    assert.deepEqual([cfg.service, cfg.tenant], [base, "joiner"]);
    assert.ok(!text.includes(cfg.token), "the token is never printed");
    if (process.platform !== "win32") assert.equal(statSync(cfgPath).mode & 0o077, 0, "the login file is private");
    assert.ok(existsSync(join(f.aspHome, "keys")));

    // Later commands need no export: the saved login is used (ASP_LOG_URL and ASP_LOG_TOKEN are not set).
    const later = async (args: string[]) => { const o: string[] = [], e: string[] = []; const code = await main(args, { out: (l) => o.push(l), err: (l) => e.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root }); return { code, out: o.join("\n"), err: e.join("\n") }; };
    const show = await later(["account", "show"]);
    assert.equal(show.code, 0, show.err);
    assert.match(show.out, /tenant joiner \(tenant\), signed up with joiner@example\.org/);
    assert.match(show.out, /starter credits: claimed \(1000\)/);
    assert.ok(show.out.includes(`${agent}: key loss recoverable by its sponsor`) && show.out.includes(`${me}: key loss recoverable with its recovery code`));
    assert.match((await later(["credits", "balance", agent])).out, /500 credits/);
    // Joining again says so; leaving forgets the login and nothing else.
    assert.match((await later(["join", "--service", base])).out, /already joined as joiner/);
    assert.match((await later(["leave"])).out, /forgot the saved login for joiner/);
    assert.equal(existsSync(cfgPath), false);
    assert.ok(existsSync(join(f.aspHome, "keys")));

    // Found in the first live run: a second tenant by the same Google account is refused the starter credits (once per account). That must not stop the join: the recovery
    // code is shown the moment it exists, the login is saved with its identities, and the credits line says why there are none.
    const f2 = makeFixture();
    const out2: string[] = [], err2: string[] = [];
    const joining2 = main(["join", "--service", base, "--no-open", "--yes"], { out: (l) => out2.push(l), err: (l) => err2.push(l), env: { ASP_HOME: f2.aspHome, ASP_JOIN_POLL_MS: "100" }, cwd: f2.root });
    await until("the second sign-up address", () => out2.some((l) => l.includes("/join?c=")));
    const c2 = /name="c" value="([^"]+)"/.exec(await (await fetch(out2.find((l) => l.includes("/join?c="))!.trim())).text())![1];
    const post2 = await fetch(`${base}/join`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ name: "joiner-two", accept_terms: "yes", terms_version: "2026-10", declaration: "adult_or_guardian", c: c2 }) });
    assert.equal(post2.status, 303);
    const state2 = new URL(post2.headers.get("location")!).searchParams.get("state")!;
    const cookie2 = /asp_join=([0-9a-f]+)/.exec(post2.headers.get("set-cookie")!)![1];
    assert.equal((await fetch(`${base}/auth/callback?code=ok&state=${encodeURIComponent(state2)}`, { headers: { cookie: `asp_join=${cookie2}` } })).status, 201);
    assert.equal(await joining2, 0, err2.join("\n"));
    const text2 = out2.join("\n");
    assert.ok(text2.indexOf("YOUR RECOVERY CODE") > 0 && text2.indexOf("YOUR RECOVERY CODE") < text2.indexOf("You are set up on"), "the recovery code comes first");
    assert.match(text2, /credits  none this time: starter credits are given once per Google account, and this one has had them/);
    const cfg2 = JSON.parse(readFileSync(join(f2.aspHome, "config.json"), "utf8"));
    assert.ok(cfg2.identities?.me && cfg2.identities?.agent && cfg2.identities?.bank, "the identities are saved with the login");
  } finally {
    server.kill(); google.close();
  }
});
