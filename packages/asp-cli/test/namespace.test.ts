import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { b64urlEncode, fetchDidWebKeys, passportKeysNotPublished } from "@agent-social/asp-core";
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
const freePort = () => new Promise<number>((resolve) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); }); });

test("identities in the tenant's namespace: --name and --me make DIDs under the tenant, a foreign did:web is refused, the service publishes DID documents that match the passports, and an admin is not bound", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-namespace-e2e-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([{ name: "team-a", role: "tenant", tokenSha256: hashToken("tok-a") }, { name: "ops", role: "admin", tokenSha256: hashToken("tok-ops") }]));
  const port = await freePort();
  const host = `127.0.0.1:${port}`, enc = `127.0.0.1%3A${port}`;
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", String(port), "--did-domain", host], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise<void>((resolve, reject) => {
      let buf = "";
      server.stdout.on("data", (d) => { buf += d; if (/listening on/.test(buf)) resolve(); });
      server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
      setTimeout(() => reject(new Error(`no start line: ${buf}`)), 20_000);
    });
    const url = `http://${host}`;
    const A = { ASP_LOG_URL: url, ASP_LOG_TOKEN: "tok-a" }, OPS = { ASP_LOG_URL: url, ASP_LOG_TOKEN: "tok-ops" };
    const f = makeFixture();
    const show = await asp(f, ["account", "show"], A);
    assert.ok(show.out.includes(`a person did:web:${enc}:u:team-a`) && show.out.includes(`agents did:web:${enc}:a:team-a:<name>`), show.out);

    // The names the person asks for turn into DIDs under the tenant.
    const me = await asp(f, ["identity", "new", "--kind", "human", "--me"], A);
    assert.equal(me.code, 0, me.err);
    assert.match(me.out, new RegExp(`created human did:web:${enc}:u:team-a\\b`));
    const coder = await asp(f, ["identity", "new", "--kind", "agent", "--name", "coder", "--sponsor", `did:web:${enc}:u:team-a`, "--purpose", "Test"], A);
    assert.equal(coder.code, 0, coder.err);
    assert.match(coder.out, new RegExp(`created agent did:web:${enc}:a:team-a:coder`));
    assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--name", "bank", "--no-recovery"], A)).code, 0);
    assert.equal((await asp(f, ["identity", "new", "--kind", "agent"], A)).code, 2, "an agent needs a name");
    // A did:key is fine; a did:web outside the namespace, even a domain the person owns, is not.
    assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--method", "did:key"], A)).code, 0);
    const foreign = await asp(f, ["identity", "new", "--kind", "human", "--did", "did:web:thedeeptransformation.com:users:alice"], A);
    assert.equal(foreign.code, 1);
    assert.match(foreign.err, /not an identity this tenant may create/);
    assert.match(foreign.err, new RegExp(`a person: did:web:${enc}:u:team-a`));
    const squat = await asp(f, ["identity", "new", "--kind", "human", "--did", `did:web:${enc}:u:ops`], A);
    assert.equal(squat.code, 1, "another account's name cannot be taken");

    // The published DID documents match the passports, so another service can verify the keys.
    const meDid = `did:web:${enc}:u:team-a`;
    const passport = JSON.parse((await asp(f, ["identity", "show", meDid], A)).out).body.keys as { id: string; public_key: string }[];
    assert.deepEqual(passport.map((k) => k.id), [`${meDid}#key-1`, `${meDid}#recovery-1`]);
    const published = (await fetchDidWebKeys(meDid)).map((k) => b64urlEncode(k));
    assert.deepEqual(published, passport.map((k) => k.public_key));
    assert.deepEqual(await passportKeysNotPublished(meDid, passport), [], "identity register elsewhere would accept it");
    assert.equal((await fetchDidWebKeys(`did:web:${enc}:a:team-a:coder`)).length, 1);
    assert.equal((await fetch(`${url}/u/nobody/did.json`)).status, 404);
    assert.equal((await fetch(`${url}/a/team-a/did.json`)).status, 404);
    assert.equal((await fetch(`${url}/u/team-a/did.json`)).headers.get("content-type"), "application/did+json");

    // The operator is not bound: the court's identities live elsewhere.
    const juror = await asp(makeFixture(), ["identity", "new", "--kind", "human", "--did", "did:web:court.example.com:court:juror-1"], OPS);
    assert.equal(juror.code, 0, juror.err);
  } finally {
    server.kill();
  }
});
