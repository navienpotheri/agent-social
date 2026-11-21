import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashToken } from "@agent-social/asp-log";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, ownPort } from "./fixture.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

// UC-262, gap U1: after signing in again on /join/recover, asp join --recover saves the new token without it ever being an argument.
test("asp join --recover replaces the saved token with a new one the service accepts, and leaves the saved login alone when it does not or when there is none", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-recover-e2e-"));
  const tokens = join(dir, "tokens.json");
  // The service already holds the new token's hash: signing in again on the page is covered in packages/asp-log/test/recover.test.ts.
  writeFileSync(tokens, JSON.stringify([{ name: "rec", role: "tenant", tokenSha256: hashToken("tok-new") }]));
  const port = await ownPort();
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", String(port), "--did-domain", `127.0.0.1:${port}`, "--rate-limit", "0", "--write-limit", "0", "--address-limit", "0"], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise<void>((resolve, reject) => {
      let buf = "";
      server.stdout.on("data", (d) => { buf += d; if (/listening on/.test(buf)) resolve(); });
      server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
      setTimeout(() => reject(new Error(`no start line: ${buf}`)), 20_000);
    });
    const f = makeFixture();
    mkdirSync(f.aspHome, { recursive: true });
    const service = `http://127.0.0.1:${port}`;
    const configPath = join(f.aspHome, "config.json");
    const call = async (args: string[], env: Record<string, string> = {}) => {
      const out: string[] = [], err: string[] = [];
      const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ...env }, cwd: f.root };
      const code = await main(args, io);
      return { code, out: out.join("\n"), err: err.join("\n") };
    };

    // No saved login: nothing to replace.
    const none = await call(["join", "--recover"], { ASP_NEW_TOKEN: "tok-new" });
    assert.equal(none.code, 2);
    assert.match(none.err, /there is none here/);

    // A saved login whose token is the lost one (the service no longer knows it).
    const saved = { service, token: "tok-lost", tenant: "rec", joinedAt: "2026-10-11T00:00:00Z", identities: { me: "did:web:x:u:rec", agent: "did:web:x:a:rec:a", bank: "did:web:x:u:rec:bank" } };
    writeFileSync(configPath, JSON.stringify(saved));

    // No new token given: it says where to get one and how to hand it over, and changes nothing.
    const ask = await call(["join", "--recover"]);
    assert.equal(ask.code, 2);
    assert.match(ask.err, new RegExp(`${service.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/join/recover`));
    assert.match(ask.err, /read -rs ASP_NEW_TOKEN/);
    assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")), saved);

    // A token the service does not accept: refused, the saved login is unchanged.
    const bad = await call(["join", "--recover"], { ASP_NEW_TOKEN: "tok-wrong" });
    assert.equal(bad.code, 1);
    assert.match(bad.err, /the service did not accept that token/);
    assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")), saved);

    // The new token: saved, with everything else as it was.
    const good = await call(["join", "--recover"], { ASP_NEW_TOKEN: "tok-new" });
    assert.equal(good.code, 0, good.err);
    assert.match(good.out, /now uses the new token; the old one no longer works/);
    assert.match(good.out, /Machine tokens .* were revoked with it/);
    assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")), { ...saved, token: "tok-new" });
    assert.ok(!good.out.includes("tok-new") && !good.err.includes("tok-new"), "the token is never printed");
    // And the saved login works: asp account show reads the account with it.
    assert.equal((await call(["account", "show"])).code, 0);
  } finally {
    server.kill();
  }
});
