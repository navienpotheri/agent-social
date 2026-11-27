// The service publishes /society/health without a sign-in (register row DK141): the figure counted from the log at request time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

test("the service answers /society/health without a sign-in: the figure, the quiet alarm on an empty log, JSON on request", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-health-e2e-"));
  const tokens = join(dir, "tokens.json");
  await new Promise<void>((resolve) => { const c = spawn(process.execPath, [cli, "serve", "token", "--tokens", tokens, "--tenant", "ops", "--role", "admin"], { stdio: "ignore" }); c.on("close", () => resolve()); });
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", "0", "--health-days", "7"], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let buf = "";
      server.stdout.on("data", (d) => { buf += d; const m = /listening on (http:\/\/[^ ]+)/.exec(buf); if (m) resolve(m[1]); });
      server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
      setTimeout(() => reject(new Error(`no start line: ${buf}`)), 20_000);
    });
    const page = await fetch(`${url}/society/health`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Society health, the last 7 days: 0 finished job/);
    assert.match(html, /ALARM QUIET/);
    const j = await (await fetch(`${url}/society/health?format=json`)).json() as any;
    assert.equal(j.days, 7);
    assert.equal(j.report.alarms[0].id, "QUIET");
  } finally { server.kill(); }
});
