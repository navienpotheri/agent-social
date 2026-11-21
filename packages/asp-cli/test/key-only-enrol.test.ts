// Rows DK540 and DK547 end to end: `asp enrol` enrols an agent with only a key on a running service, saves its login and key, the front door file is served, and `--no-key-only-signup` closes the route in one flag.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { main, type Io } from "../src/cli.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const run = (args: string[]) => new Promise<{ code: number; out: string }>((resolve) => {
  const c = spawn(process.execPath, [cli, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  let out = ""; c.stdout.on("data", (d) => (out += d));
  c.on("close", (code) => resolve({ code: code ?? 1, out }));
});
async function serve(dir: string, extra: string[]) {
  const tokens = join(dir, "tokens.json");
  if (!existsSync(tokens)) await run(["serve", "token", "--tokens", tokens, "--tenant", "ops", "--role", "admin"]);
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log" + extra.length)}`, "--tokens", tokens, "--port", "0", "--signup", "--signup-terms-url", "https://example.org/terms", "--signup-difficulty", "8", ...extra], { stdio: ["ignore", "pipe", "pipe"] });
  const url = await new Promise<string>((resolve, reject) => {
    let buf = "";
    server.stdout.on("data", (d) => { buf += d; const m = /listening on (http:\/\/[^ ]+)/.exec(buf); if (m) resolve(m[1]); });
    server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
    setTimeout(() => reject(new Error(`no start line: ${buf}`)), 20_000);
  });
  return { url, tokens, stop: () => server.kill() };
}
async function asp(args: string[], extraEnv: Record<string, string> = {}) {
  const out: string[] = [], err: string[] = [];
  const home = extraEnv.ASP_HOME ?? mkdtempSync(join(tmpdir(), "asp-enrol-home-"));
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home, ...extraEnv }, cwd: home };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n"), home };
}

test("DK540 and DK547: asp enrol enrols a key with no person; the login and key are saved; the front door is served; a second use of the name is refused", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-enrol-e2e-"));
  const s = await serve(dir, []);
  try {
    const no = await asp(["enrol", "--service", s.url, "--name", "lone-agent"]);
    assert.equal(no.code, 1);
    assert.match(no.err, /accept its terms/);
    const r = await asp(["enrol", "--service", s.url, "--name", "lone-agent", "--accept-terms"]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /enrolled as lone-agent .* your identity is did:key:z/);
    assert.match(r.out, /identity written to the service/);
    assert.match(r.out, /starter credits/);
    const cfg = JSON.parse(readFileSync(join(r.home, "config.json"), "utf8"));
    assert.equal(cfg.tenant, "lone-agent");
    assert.equal(cfg.identities.agent.startsWith("did:key:z"), true);
    assert.notEqual(cfg.identities.me, cfg.identities.agent);
    assert.notEqual(cfg.identities.bank, cfg.identities.me);
    for (const d of [cfg.identities.me, cfg.identities.agent, cfg.identities.bank]) { const seen = await asp(["identity", "show", d], { ASP_HOME: r.home, ASP_LOG_URL: s.url, ASP_LOG_TOKEN: cfg.token }); assert.equal(seen.code, 0, `${d}: ${seen.err}`); }
    const key = JSON.parse(readFileSync(join(r.home, "enrol-key.json"), "utf8"));
    assert.equal(key.seed, undefined, "the seed lives in the key store, not here");
    assert.match(key.did, /^did:key:z/);
    const tenant = JSON.parse(readFileSync(s.tokens, "utf8")).find((t: { name: string }) => t.name === "lone-agent");
    assert.equal(tenant.signup.keyOnly.did, key.did);
    assert.equal(tenant.signup.google, undefined);
    assert.ok(!readFileSync(s.tokens, "utf8").includes(cfg.token), "only the token's hash is stored");
    const again = await asp(["enrol", "--service", s.url, "--name", "lone-agent", "--accept-terms"]);
    assert.equal(again.code, 1);
    const txt = await (await fetch(`${s.url}/society/llms.txt`)).text();
    assert.match(txt, /POST once to .*\/signup\/key/);
    const tools = (await (await fetch(`${s.url}/society/tools.json`)).json()) as { enrol: { keyOnly: boolean } };
    assert.equal(tools.enrol.keyOnly, true);
  } finally { s.stop(); }
});

test("DK540: --no-key-only-signup closes the route in one flag; the file says so", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-enrol-closed-"));
  const s = await serve(dir, ["--no-key-only-signup"]);
  try {
    const r = await asp(["enrol", "--service", s.url, "--name", "shut-out", "--accept-terms"]);
    assert.equal(r.code, 1);
    assert.match(r.err, /does not take an agent with only a key/);
    assert.match(await (await fetch(`${s.url}/society/llms.txt`)).text(), /closed on this service/);
    const direct = await fetch(`${s.url}/signup/key`, { method: "POST", body: "{}" });
    assert.equal(direct.status, 403);
  } finally { s.stop(); }
});

test("DK651 (TM1): enrolment tells the person plainly about the telemetry store; asp telemetry shows it on, stores content and prints its hash, there is no off switch (DK1303), delete keeps the hash", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-telemetry-e2e-"));
  const s = await serve(dir, []);
  try {
    const r = await asp(["enrol", "--service", s.url, "--name", "tm-agent", "--accept-terms"]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /The service keeps a copy of your agent/);
    assert.match(r.out, /not optional for an agent/);
    const env = { ASP_HOME: r.home };
    assert.match((await asp(["telemetry"], env)).out, /Telemetry is ON/);
    const put = await asp(["telemetry", "put", "--kind", "trajectory", "--text", "read the file, then fixed the bug"], env);
    assert.equal(put.code, 0, put.err);
    const hash = /(sha256:[0-9a-f]{64})/.exec(put.out)![1];
    assert.ok(!readFileSync(join(`${s.tokens}.telemetry`, "tm-agent", "state.json"), "utf8").includes("fixed the bug"), "the text is not in the index");
    const off = await asp(["telemetry", "off"], env);
    assert.notEqual(off.code, 0);
    assert.match(off.err + off.out, /not optional for an agent/);
    const more = await asp(["telemetry", "put", "--kind", "text", "--text", "after asking to turn it off"], env);
    assert.equal(more.code, 0, "collection stays on");
    assert.match((await asp(["telemetry"], env)).out, /Telemetry is ON/);
    const del = await asp(["telemetry", "delete", "--all"], env);
    assert.match(del.out, /2 item\(s\) deleted. The hashes are kept/);
    assert.match(del.out, /deletion receipt sha256:[0-9a-f]{64}/, "an erasure issues a receipt (DK1378)");
    assert.match((await asp(["telemetry", "receipts"], env)).out, /sha256:[0-9a-f]{64}  .*2 item\(s\) deleted/);
    assert.match((await asp(["telemetry", "list"], env)).out, new RegExp(`${hash}.*deleted`));
    assert.notEqual((await asp(["telemetry", "on"], env)).code, 0, "there is no on switch either");
  } finally { s.stop(); }
});
