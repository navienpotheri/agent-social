// DK1360 through the real service and command: an organisation sees the choice, keeps its data private, and `asp account show` says so; its text is not stored, only its hash. Fake tokens only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashToken, telemetryHash } from "@agent-social/asp-log";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
async function asp(f: Fixture, args: string[], env: Record<string, string>) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ...env }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const TEXT = "confidential: the merger closes on Friday";

test("an organisation keeps its data private: the command shows and records the choice, the account says so, and the text it sends is hashed and not stored", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-sharing-e2e-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([{ name: "acme", role: "tenant", tokenSha256: hashToken("tok-acme"), createdAt: "2026-11-01T00:00:00Z" }]));
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", "0"], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let buf = "";
      server.stdout.on("data", (d) => { buf += d; const m = /listening on (http:\/\/[^ ]+)/.exec(buf); if (m) resolve(m[1]); });
      server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
      setTimeout(() => reject(new Error(`no start line: ${buf}`)), 20_000);
    });
    const f = makeFixture();
    const env = { ASP_LOG_URL: url, ASP_LOG_TOKEN: "tok-acme" };
    const before = await asp(f, ["account", "data-sharing"], env);
    assert.equal(before.code, 0, before.err);
    assert.match(before.out, /data sharing: share/);
    assert.match(before.out, /private: Your text is never stored here/);
    assert.match((await asp(f, ["account", "show"], env)).out, /data sharing: share \(as for every open agent/);
    assert.equal((await asp(f, ["account", "data-sharing", "--choice", "maybe"], env)).code, 2);
    const set = await asp(f, ["account", "data-sharing", "--choice", "private"], env);
    assert.equal(set.code, 0, set.err);
    assert.match(set.out, /data sharing: private/);
    assert.match(set.out, /only hashes are stored for this tenant/);
    assert.match((await asp(f, ["account", "show"], env)).out, /data sharing: private \(only hashes are stored for you; your agents are not used in studies\)/);
    // The text it sends is hashed and not stored; the hash is the one the signed log may carry.
    const res = await fetch(new URL("telemetry/content", url.endsWith("/") ? url : url + "/"), { method: "POST", headers: { authorization: "Bearer tok-acme", "content-type": "application/json" }, body: JSON.stringify({ kind: "message", content: TEXT }) });
    const j = await res.json() as { ok: boolean; hash: string; stored: boolean; private?: boolean };
    assert.deepEqual([j.ok, j.stored, j.private, j.hash], [true, false, true, telemetryHash(TEXT)]);
    const store = `${tokens}.telemetry`;
    const files = (d: string): string[] => (existsSync(d) ? readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)])) : []);
    for (const file of files(store)) assert.ok(!readFileSync(file, "utf8").includes(TEXT), `${file} does not hold the text`);
    // the choice is in the tenant file
    assert.deepEqual((JSON.parse(readFileSync(tokens, "utf8")) as any[])[0].dataSharing.choice, "private");
  } finally { server.kill(); }
});
