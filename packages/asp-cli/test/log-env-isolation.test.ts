import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashToken } from "@agent-social/asp-log";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, ownPort } from "./fixture.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Gap T23: the environment a command reads the log service from belonged to the process, set on entry and put back on exit by every main(). Commands that overlap in one process (the
// two-sessions test, an embedding program) then changed each other's: the first to finish restored an old value under the second, whose background approvals loop then asked a local log and found
// no job. It now belongs to the command and to what the command starts (AsyncLocalStorage).
// This test guards the property for commands that read the login within a step; it also passes on the old code, because those commands were not the ones that failed. The reproduction is the
// two-sessions test (run-concurrent.test.ts), whose approvals loop reads it for minutes.
test("commands that overlap in one process each write as their own tenant, whichever finishes first", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-logenv-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([
    { name: "alpha", role: "tenant", tokenSha256: hashToken("tok-alpha") },
    { name: "bravo", role: "tenant", tokenSha256: hashToken("tok-bravo") },
  ]));
  const port = await ownPort();
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", String(port), "--did-domain", `127.0.0.1:${port}`, "--rate-limit", "0", "--write-limit", "0", "--address-limit", "0"], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise<void>((resolve, reject) => {
      let buf = "";
      server.stdout.on("data", (d) => { buf += d; if (/listening on/.test(buf)) resolve(); });
      server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
      setTimeout(() => reject(new Error(`no start line: ${buf}`)), 20_000);
    });
    const homeFor = (tenant: string, token: string) => {
      const f = makeFixture();
      mkdirSync(f.aspHome, { recursive: true });
      writeFileSync(join(f.aspHome, "config.json"), JSON.stringify({ service: `http://127.0.0.1:${port}`, token, tenant, joinedAt: "2026-10-11T00:00:00Z" }));
      return f;
    };
    const A = homeFor("alpha", "tok-alpha"), B = homeFor("bravo", "tok-bravo");
    // Each command writes an identity to the service as its own tenant, with several awaits (a key, a record, a second look at the log) between its start and its writes.
    const make = async (f: typeof A, name: string, delay: number) => {
      await sleep(delay);
      const out: string[] = [], err: string[] = [];
      const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
      const code = await main(["identity", "new", "--kind", "human", "--name", name, "--no-recovery"], io);
      return { code, text: err.join("\n") + out.join("\n"), name };
    };
    // Twenty overlapping pairs, staggered so that either one finishes first.
    const runs: ReturnType<typeof make>[] = [];
    for (let i = 0; i < 20; i++) {
      runs.push(make(A, `a${i}`, (i * 7) % 23));
      runs.push(make(B, `b${i}`, (i * 11) % 19));
    }
    for (const r of await Promise.all(runs)) assert.equal(r.code, 0, `${r.name}: ${r.text}`);
    // Every identity was written under its own tenant, and none under the other.
    const who = async (f: typeof A) => {
      const out: string[] = [];
      assert.equal(await main(["account", "show"], { out: (l) => out.push(l), err: () => {}, env: { ASP_HOME: f.aspHome }, cwd: f.root } as Io), 0);
      return out.join("\n");
    };
    const a = await who(A), b = await who(B);
    for (let i = 0; i < 20; i++) {
      assert.ok(a.includes(`:u:alpha:a${i}`) && !a.includes(":u:bravo"), `alpha holds its own identity ${i} and not bravo's`);
      assert.ok(b.includes(`:u:bravo:b${i}`) && !b.includes(":u:alpha"), `bravo holds its own identity ${i} and not alpha's`);
    }
  } finally {
    server.kill();
  }
});
