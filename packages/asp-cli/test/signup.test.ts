import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { main, type Io } from "../src/cli.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const run = (args: string[]) => new Promise<{ code: number; out: string; err: string }>((resolve) => {
  const c = spawn(process.execPath, [cli, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (err += d));
  c.on("close", (code) => resolve({ code: code ?? 1, out, err }));
});
async function asp(args: string[], env: Record<string, string> = {}) {
  const out: string[] = [], err: string[] = [];
  const home = mkdtempSync(join(tmpdir(), "asp-signup-client-"));
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home, ...env }, cwd: home };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

test("asp serve --signup: a stranger signs up with asp signup (terms, proof of work), uses the token; the operator closes sign-up without a restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-signup-e2e-"));
  const tokens = join(dir, "tokens.json");
  await run(["serve", "token", "--tokens", tokens, "--tenant", "ops", "--role", "admin"]);
  // Sign-up needs published terms.
  const noTerms = await run(["serve", "--db", `local:${join(dir, "log0")}`, "--tokens", tokens, "--port", "0", "--signup"]);
  assert.notEqual(noTerms.code, 0);
  assert.match(noTerms.err, /--signup needs --signup-terms-url/);

  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", "0", "--signup", "--signup-terms-url", "https://example.org/terms", "--signup-terms-version", "t1", "--signup-difficulty", "8", "--signup-per-address", "3", "--signup-daily-cap", "50", "--record-quota", "5"], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let buf = "";
      server.stdout.on("data", (d) => { buf += d; const m = /listening on (http:\/\/[^ ]+)/.exec(buf); if (m) resolve(m[1]); });
      server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
      setTimeout(() => reject(new Error(`no start line: ${buf}`)), 20_000);
    });
    // Without accepting the terms nothing is created, and the client says where to read them.
    const noAccept = await asp(["signup", "--service", url, "--name", "first-bot"]);
    assert.equal(noAccept.code, 1);
    assert.match(noAccept.err, /accept its terms \(version t1, at https:\/\/example\.org\/terms\)/);
    // Signing up.
    const up = await asp(["signup", "--service", url, "--name", "first-bot", "--accept-terms", "--contact", "me@example.org"]);
    assert.equal(up.code, 0, up.err);
    const token = up.out.split("\n")[1];
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.match(up.out, /starting limits: 2000 records, 16 MB, 120 requests a minute/);
    const saved = JSON.parse(readFileSync(tokens, "utf8"));
    const mine = saved.find((t: any) => t.name === "first-bot");
    assert.equal(mine.role, "tenant");
    assert.equal(mine.signup.contact, "me@example.org");
    assert.ok(!readFileSync(tokens, "utf8").includes(token), "only the hash is stored");
    // The name is taken; the new token works at once, without a restart.
    const again = await asp(["signup", "--service", url, "--name", "first-bot", "--accept-terms"]);
    assert.equal(again.code, 1);
    assert.match(again.err, /not available/);
    const use = await asp(["identity", "new", "--kind", "human", "--did", "did:web:example.com:users:first"], { ASP_LOG_URL: url, ASP_LOG_TOKEN: token });
    assert.equal(use.code, 0, use.err);
    // Someone else's name can't be guessed into the admin role, and a bad token still fails.
    assert.equal((await asp(["identity", "show", "did:web:example.com:users:first"], { ASP_LOG_URL: url, ASP_LOG_TOKEN: "wrong" })).code, 1);
    // The operator's view and switch.
    const status = await run(["serve", "signups", "--tokens", tokens]);
    assert.match(status.out, /sign-up is open; day's cap the service's default; 1 sign-up\(s\) in the last 24 hours, 1 in all/);
    const closed = await run(["serve", "signup-close", "--tokens", tokens, "--reason", "maintenance"]);
    assert.match(closed.out, /CLOSED: maintenance/);
    const refused = await asp(["signup", "--service", url, "--name", "second-bot", "--accept-terms"]);
    assert.equal(refused.code, 1);
    assert.match(refused.err, /sign-up is not open.*maintenance/);
    assert.match((await run(["serve", "signup-open", "--tokens", tokens])).out, /sign-up is open/);
    assert.equal((await asp(["signup", "--service", url, "--name", "second-bot", "--accept-terms"])).code, 0);
    const cap = await run(["serve", "signup-cap", "--tokens", tokens, "--signup-daily-cap", "2"]);
    assert.match(cap.out, /day's cap 2/);
    const full = await asp(["signup", "--service", url, "--name", "third-bot", "--accept-terms"]);
    assert.equal(full.code, 1);
    assert.match(full.err, /sign-up is not open/, "the day's cap is used up");
  } finally {
    server.kill();
  }
});
