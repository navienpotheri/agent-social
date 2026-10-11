import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createNet } from "node:net";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashToken } from "@agent-social/asp-log";
import { main } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const freePort = () => new Promise<number>((resolve) => { const s = createNet(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); }); });

test("machine tokens: made from your own login, shown once, usable by a job to read the account and write, refused anything that takes the account apart, revocable at once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-token-e2e-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([{ name: "owner", role: "tenant", tokenSha256: hashToken("tok-owner"), signup: { at: "2026-10-11T00:00:00Z", addressHash: "x", termsVersion: "v1", google: { sub: "g", email: "o@example.org" } } }]));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", String(port), "--did-domain", `127.0.0.1:${port}`], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise<void>((resolve, reject) => {
      let buf = "";
      server.stdout.on("data", (d) => { buf += d; if (/listening on/.test(buf)) resolve(); });
      server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
      setTimeout(() => reject(new Error(`no start line: ${buf}`)), 20_000);
    });
    const f = makeFixture();
    const call = async (args: string[], token: string) => { const out: string[] = [], err: string[] = []; const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ASP_LOG_URL: base, ASP_LOG_TOKEN: token }, cwd: f.root }); return { code, out: out.join("\n"), err: err.join("\n") }; };

    assert.match((await call(["token", "list"], "tok-owner")).out, /no machine tokens/);
    assert.equal((await call(["token", "create", "Bad Name"], "tok-owner")).code, 1);
    assert.equal((await call(["token", "create", "ci", "--days", "400"], "tok-owner")).code, 1);
    const made = await call(["token", "create", "ci", "--days", "30"], "tok-owner");
    assert.equal(made.code, 0, made.err);
    assert.match(made.out, /machine token ci, valid until \d{4}-\d\d-\d\d; shown once/);
    const machine = made.out.split("\n")[1];
    assert.match(machine, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(!readFileSync(tokens, "utf8").includes(machine), "only a hash is kept");
    assert.equal((await call(["token", "create", "ci"], "tok-owner")).code, 1, "the name is taken");
    assert.match((await call(["token", "list"], "tok-owner")).out, /ci\s+until \d{4}-\d\d-\d\d/);

    // The job's token: it can read the account and write records.
    assert.equal((await call(["account", "show"], machine)).code, 0);
    const me = `did:web:127.0.0.1%3A${port}:u:owner`;
    assert.equal((await call(["identity", "new", "--kind", "human", "--me", "--no-recovery"], machine)).code, 0, "records can be written");
    assert.match((await call(["account", "show"], machine)).out, new RegExp(me.replace(/[.%]/g, "\\$&")));
    // ... but not take the account apart.
    for (const args of [["token", "list"], ["token", "create", "more"], ["account", "starter", "--did", me], ["account", "export", "--out", join(dir, "x")], ["account", "close", "--confirm", "owner", "--skip-export"]]) {
      const r = await call(args, machine);
      assert.equal(r.code, 1, args.join(" "));
      assert.match(r.err, /the machine token ci can read the account and write records; this needs your own token/, args.join(" "));
    }
    // Revoked: it stops working at once, and the person's own token still does.
    assert.match((await call(["token", "revoke", "ci"], "tok-owner")).out, /revoked ci/);
    assert.equal((await call(["account", "show"], machine)).code, 1);
    assert.equal((await call(["account", "show"], "tok-owner")).code, 0);
    assert.match((await call(["token", "list"], "tok-owner")).out, /ci\s+revoked \d{4}-\d\d-\d\d/);
    assert.equal((await call(["token", "revoke", "ci"], "tok-owner")).code, 1, "already revoked");
  } finally {
    server.kill();
  }
});
