// DK1382: a sandbox service on a log of its own. Isolation both ways (a sandbox record never reaches production, a production record never reaches the sandbox, neither service opens the other's log),
// everything marked, free test credits, and a reset that keeps the tenants. Real services, real commands, fake tokens.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer as createNet } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashToken } from "@agent-social/asp-log";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
async function asp(f: Fixture, args: string[], env: Record<string, string>) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ...env }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
function start(dir: string, name: string, extra: string[]) {
  const tokens = join(dir, `${name}-tokens.json`);
  writeFileSync(tokens, JSON.stringify([{ name: "acme", role: "tenant", tokenSha256: hashToken(`tok-${name}`), createdAt: "2026-11-01T00:00:00Z" }, { name: "ops", role: "admin", tokenSha256: hashToken(`ops-${name}`) }]));
  const db = `local:${join(dir, `${name}-log`)}`;
  const server = spawn(process.execPath, [cli, "serve", "--db", db, "--tokens", tokens, ...(extra.includes("--port") ? [] : ["--port", "0"]), ...extra], { stdio: ["ignore", "pipe", "pipe"] });
  const url = new Promise<string>((resolve, reject) => {
    let buf = "";
    server.stdout.on("data", (d) => { buf += d; const m = /listening on (http:\/\/[^ ]+)/.exec(buf); if (m) resolve(m[1]); });
    server.stderr.on("data", (d) => { buf += d; });
    server.on("close", () => reject(new Error(`the service exited: ${buf.slice(0, 400)}`)));
    setTimeout(() => reject(new Error(`no start line: ${buf}`)), 20_000);
  });
  return { server, url, tokens, db, name };
}
const freePort = () => new Promise<number>((resolve) => { const n = createNet(); n.listen(0, "127.0.0.1", () => { const p = (n.address() as { port: number }).port; n.close(() => resolve(p)); }); });
let ME = "";

test("a sandbox is a service of its own: marked everywhere, free test credits, isolated from production in both directions, and reset keeps the tenants", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-sandbox-"));
  const sandPort = await freePort();
  ME = `did:web:127.0.0.1%3A${sandPort}:u:acme:alice`;
  const sand = start(dir, "sand", ["--sandbox", "--port", String(sandPort), "--did-domain", `127.0.0.1:${sandPort}`]);
  const prod = start(dir, "prod", []);
  try {
    const [sandUrl, prodUrl] = [await sand.url, await prod.url];
    assert.match(sandUrl, /http/);
    // marked: the header on every response, the banner on every page, the health answer
    const health = await fetch(new URL("health", sandUrl.endsWith("/") ? sandUrl : sandUrl + "/"));
    assert.equal(health.headers.get("x-asp-environment"), "sandbox");
    const page = await fetch(new URL("charters", sandUrl.endsWith("/") ? sandUrl : sandUrl + "/"), { headers: { accept: "text/html" } });
    assert.equal(page.headers.get("x-asp-environment"), "sandbox");
    assert.match(await page.text(), /SANDBOX: test data on a test log, no real consequences/);
    const prodPage = await fetch(new URL("charters", prodUrl.endsWith("/") ? prodUrl : prodUrl + "/"), { headers: { accept: "text/html" } });
    assert.equal(prodPage.headers.get("x-asp-environment"), null, "production is not marked");
    assert.doesNotMatch(await prodPage.text(), /SANDBOX/);

    // the same person works in both with the same commands
    const fs = makeFixture(), fp = makeFixture();
    const S = { ASP_LOG_URL: sandUrl, ASP_LOG_TOKEN: "tok-sand" }, P = { ASP_LOG_URL: prodUrl, ASP_LOG_TOKEN: "tok-prod" };
    assert.equal((await asp(fs, ["identity", "new", "--kind", "human", "--did", ME, "--no-recovery"], S)).code, 0);
    assert.equal((await asp(fp, ["identity", "new", "--kind", "human", "--did", "did:web:example.com:users:prod-person", "--no-recovery"], P)).code, 0);

    // the journey page of one of the tenant's agents is marked like the rest
    const me = `did:web:127.0.0.1%3A${sandPort}:u:acme`, agent = `did:web:127.0.0.1%3A${sandPort}:a:acme:my-agent`, bank = `did:web:127.0.0.1%3A${sandPort}:u:acme:bank`;
    mkdirSync(fs.aspHome, { recursive: true });
    writeFileSync(join(fs.aspHome, "config.json"), JSON.stringify({ service: sandUrl, token: "tok-sand", tenant: "acme", joinedAt: "2026-11-21T00:00:00Z", identities: { me, agent, bank } }));
    const named = makeFixture();
    mkdirSync(named.aspHome, { recursive: true });
    writeFileSync(join(named.aspHome, "config.json"), JSON.stringify({ service: sandUrl, token: "tok-sand", tenant: "acme", joinedAt: "2026-11-21T00:00:00Z", identities: { me, agent, bank } }));
    const meRes = await asp(named, ["identity", "new", "--kind", "human", "--me", "--no-recovery"], {}); assert.equal(meRes.code, 0, meRes.err);
    assert.equal((await asp(named, ["identity", "new", "--kind", "agent", "--name", "my-agent", "--sponsor", me, "--purpose", "Test"], {})).code, 0);
    const journey = await fetch(new URL("agent/my-agent/journey", sandUrl.endsWith("/") ? sandUrl : sandUrl + "/"), { headers: { accept: "text/html" } });
    assert.equal(journey.status, 200, "a real journey page");
    assert.equal(journey.headers.get("x-asp-environment"), "sandbox");
    assert.match(await journey.text(), /SANDBOX: test data on a test log/);

    // free test credits: capped per request, only for an identity of the tenant
    const call = (url: string, token: string, path: string, body?: unknown) => fetch(new URL(path, url.endsWith("/") ? url : url + "/"), { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }).then(async (r) => ({ status: r.status, json: await r.json() as any }));
    const info = await call(sandUrl, "tok-sand", "sandbox");
    assert.equal(info.json.environment, "sandbox");
    const gift = await call(sandUrl, "tok-sand", "sandbox/credits", { did: ME, amount: 5000 });
    assert.deepEqual([gift.status, gift.json.balance], [200, 5000]);
    assert.match((await asp(fs, ["credits", "balance", ME], S)).out, /5000 credits/);
    assert.equal((await call(sandUrl, "tok-sand", "sandbox/credits", { did: ME, amount: 10_001 })).status, 400, "a request is capped");
    assert.equal((await call(sandUrl, "tok-sand", "sandbox/credits", { did: "did:web:example.com:users:stranger", amount: 10 })).status, 400, "only for an identity of the tenant");
    assert.equal((await call(prodUrl, "tok-prod", "sandbox/credits", { did: "did:web:example.com:users:prod-person", amount: 10 })).status, 404, "production has no free credits");

    // isolation: each log holds only its own records
    const heads = async (f: Fixture, env: Record<string, string>) => (await asp(f, ["log", "export", "--out", join(f.root, "x.ndjson")], env), readFileSync(join(f.root, "x.ndjson"), "utf8"));
    const sandLog = await heads(fs, S), prodLog = await heads(fp, P);
    assert.ok(sandLog.includes("u:acme:alice") && !sandLog.includes("prod-person"), "a production record never reaches the sandbox");
    assert.ok(prodLog.includes("prod-person") && !prodLog.includes("u:acme"), "a sandbox record never reaches production");
    assert.match(readFileSync(join(dir, "sand-log", "ENVIRONMENT"), "utf8"), /sandbox/);

    // the two logs cannot be swapped: neither service opens the other's log
    sand.server.kill(); prod.server.kill();
    await new Promise((r) => setTimeout(r, 800));
    const refuseProd = spawnSync(process.execPath, [cli, "serve", "--db", sand.db, "--tokens", sand.tokens, "--port", "0"], { encoding: "utf8", timeout: 20_000 });
    assert.notEqual(refuseProd.status, 0);
    assert.match(refuseProd.stderr, /is a sandbox log: a production service does not open it/);
    writeFileSync(join(dir, "prod-log", "marker.txt"), "x");
    const refuseSand = spawnSync(process.execPath, [cli, "serve", "--sandbox", "--db", prod.db, "--tokens", prod.tokens, "--port", "0"], { encoding: "utf8", timeout: 20_000 });
    assert.notEqual(refuseSand.status, 0);
    assert.match(refuseSand.stderr, /not marked as a sandbox: a sandbox starts on a new, empty directory/);

    // reset: needs the word, refuses a production log, clears the log and the state, keeps the tenants
    assert.notEqual(spawnSync(process.execPath, [cli, "serve", "reset-sandbox", "--db", sand.db, "--tokens", sand.tokens], { encoding: "utf8" }).status, 0, "it asks for confirmation");
    assert.notEqual(spawnSync(process.execPath, [cli, "serve", "reset-sandbox", "--db", prod.db, "--tokens", prod.tokens, "--confirm", "sandbox"], { encoding: "utf8" }).status, 0, "a production log is never reset");
    assert.ok(readdirSync(join(dir, "prod-log")).length > 0, "production is untouched");
    const reset = spawnSync(process.execPath, [cli, "serve", "reset-sandbox", "--db", sand.db, "--tokens", sand.tokens, "--confirm", "sandbox"], { encoding: "utf8" });
    assert.equal(reset.status, 0, reset.stderr);
    assert.match(reset.stdout, /sandbox reset: \d+ items? cleared/);
    assert.deepEqual(readdirSync(join(dir, "sand-log")), ["ENVIRONMENT"]);
    assert.equal(existsSync(`${sand.tokens}.sandbox-credits.json`), false);
    assert.equal((JSON.parse(readFileSync(sand.tokens, "utf8")) as { name: string }[]).length, 2, "the tenants stay");
    const again = start(dir, "sand", ["--sandbox"]);
    try {
      const url = await again.url;
      const fresh = makeFixture();
      const R = { ASP_LOG_URL: url, ASP_LOG_TOKEN: "tok-sand" };
      assert.equal((await asp(fresh, ["identity", "new", "--kind", "human", "--did", ME, "--no-recovery"], R)).code, 0, "the same token works on the cleared sandbox");
      assert.equal((await call(url, "tok-sand", "sandbox/credits", { did: ME, amount: 10 })).status, 200, "and the credits are free to take again");
    } finally { again.server.kill(); }
  } finally { sand.server.kill(); prod.server.kill(); }
});
