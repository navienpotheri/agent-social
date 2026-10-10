import { after, test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { createLogServer, hashToken, type Tenant } from "@agent-social/asp-log";
import { LocalLog, packageRoutes } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const HUMAN = "did:web:example.com:users:navien";
const AGENT = "did:web:example.com:agents:coder";
const TOKEN_A = "token-for-team-a";
const TOKEN_B = "token-for-team-b";
const TOKEN_ADMIN = "token-for-ops";
const TOKEN_TINY = "token-for-tiny";
const tenants: Tenant[] = [
  { name: "team-a", role: "tenant", tokenSha256: hashToken(TOKEN_A) },
  { name: "team-b", role: "tenant", tokenSha256: hashToken(TOKEN_B) },
  { name: "ops", role: "admin", tokenSha256: hashToken(TOKEN_ADMIN) },
  { name: "tiny", role: "tenant", tokenSha256: hashToken(TOKEN_TINY), quotaBytes: 1000 },
];

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
async function start(): Promise<string> {
  const server = createLogServer({ handle: await LocalLog.open(mkdtempSync(join(tmpdir(), "asp-svc-log-"))), tenants, extra: packageRoutes({ root: mkdtempSync(join(tmpdir(), "asp-svc-pkgs-")) }) });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

async function asp(f: Fixture, args: string[], env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ...env }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const fake = (extra: NodeJS.ProcessEnv = {}) => ({
  GITHUB_TOKEN: "t", API_BASE: "x", ASP_CLAUDE_BIN: process.execPath,
  ASP_CLAUDE_SCRIPT: fileURLToPath(new URL("./fake-claude.mjs", import.meta.url)), ...extra,
});
const svc = (url: string, token: string) => ({ ASP_LOG_URL: url, ASP_LOG_TOKEN: token });
const topics = (pkg: string) => readdirSync(join(pkg, "memory", "auto")).filter((n) => n !== "MEMORY.md");

async function packed() {
  const f = makeFixture();
  assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", HUMAN])).code, 0);
  assert.equal((await asp(f, ["identity", "new", "--kind", "agent", "--did", AGENT, "--sponsor", HUMAN])).code, 0);
  const pkg = join(f.root, "a.aspkg");
  const res = await asp(f, ["pack", "--runtime", "claude-code", "--agent", AGENT, "--project", f.project, "--user-home", f.home, "--out", pkg]);
  assert.equal(res.code, 0, res.err);
  return { f, pkg };
}
/** A second machine: the same agent keys in its own ASP home. */
function secondMachine(f: Fixture): Fixture {
  const aspHome = mkdtempSync(join(tmpdir(), "asp-machine-b-"));
  cpSync(f.aspHome, aspHome, { recursive: true });
  return { ...f, aspHome };
}

test("two machines, one agent: a stale push is refused, a merge pull reconciles, nothing is lost", async () => {
  const url = await start();
  const { f, pkg } = await packed();
  const b = secondMachine(f);
  const env = svc(url, TOKEN_A);

  const first = await asp(f, ["package", "push", pkg, "--name", "coder"], env);
  assert.equal(first.code, 0, first.err);
  const list = await asp(f, ["package", "list"], env);
  assert.match(list.out, /team-a: 1 package\(s\)/);

  const pkgB = join(b.root, "b.aspkg");
  assert.equal((await asp(b, ["package", "pull", "coder", "--out", pkgB], env)).code, 0);
  assert.equal((await asp(b, ["verify", pkgB])).code, 0);

  // Machine A learns one thing and pushes; machine B, still on the old copy, learns another.
  assert.equal((await asp(f, ["run", pkg, "--backend", "claude-code", "--project", f.project, "--prompt", "hi"], fake())).code, 0);
  const pushA = await asp(f, ["package", "push", pkg, "--name", "coder"], env);
  assert.equal(pushA.code, 0, pushA.err);
  assert.equal((await asp(b, ["run", pkgB, "--backend", "claude-code", "--project", b.project, "--prompt", "hi"], fake({ FAKE_CLAUDE_LEARN_FILES: "1" }))).code, 0);

  const stale = await asp(b, ["package", "push", pkgB, "--name", "coder"], env);
  assert.notEqual(stale.code, 0, "the push must not overwrite the newer copy");
  assert.match(stale.err, /different copy|already exists/);
  assert.match(stale.err, /asp package pull <name> --out <your package> --merge/);

  const merge = await asp(b, ["package", "pull", "coder", "--out", pkgB, "--merge"], env);
  assert.equal(merge.code, 0, merge.err);
  assert.match(merge.err, /merged into the service's copy/);
  assert.ok(topics(pkgB).includes("refund-race.md") && topics(pkgB).includes("lesson-00.md"), "both lessons survive: " + topics(pkgB).join(","));
  assert.equal((await asp(b, ["verify", pkgB])).code, 0);
  assert.equal((await asp(b, ["package", "push", pkgB, "--name", "coder"], env)).code, 0);

  const fresh = join(f.root, "c.aspkg");
  assert.equal((await asp(f, ["package", "pull", "coder", "--out", fresh], env)).code, 0);
  assert.ok(topics(fresh).includes("refund-race.md") && topics(fresh).includes("lesson-00.md"));
  // Pulling over an existing folder without --merge is refused.
  assert.equal((await asp(f, ["package", "pull", "coder", "--out", fresh], env)).code, 2);
});

test("tenants are isolated; an admin can read but not write another tenant's packages", async () => {
  const url = await start();
  const { f, pkg } = await packed();
  assert.equal((await asp(f, ["package", "push", pkg, "--name", "coder"], svc(url, TOKEN_A))).code, 0);

  const other = await asp(f, ["package", "list"], svc(url, TOKEN_B));
  assert.match(other.out, /team-b: 0 package\(s\)/);
  const miss = await asp(f, ["package", "pull", "coder", "--out", join(f.root, "x.aspkg")], svc(url, TOKEN_B));
  assert.notEqual(miss.code, 0);
  assert.match(miss.err, /no package coder/);
  const sneak = await asp(f, ["package", "list", "--tenant", "team-a"], svc(url, TOKEN_B));
  assert.notEqual(sneak.code, 0, "a tenant cannot name another tenant");

  const viaAdmin = join(f.root, "admin.aspkg");
  assert.equal((await asp(f, ["package", "pull", "coder", "--tenant", "team-a", "--out", viaAdmin], svc(url, TOKEN_ADMIN))).code, 0);
  assert.ok(existsSync(join(viaAdmin, "manifest.json")));
  const write = await asp(f, ["package", "push", pkg, "--name", "other", "--tenant", "team-a"], svc(url, TOKEN_ADMIN));
  assert.notEqual(write.code, 0);

  const noToken = await asp(f, ["package", "list"], { ASP_LOG_URL: url });
  assert.notEqual(noToken.code, 0);
  assert.match(noToken.err, /refused/);
});

test("the service refuses a package that does not verify, one over quota, and a push with no precondition", async () => {
  const url = await start();
  const { f, pkg } = await packed();

  // Memory changed after signing: the manifest hash no longer matches.
  writeFileSync(join(pkg, "memory", "sneaky.md"), "added after the package was signed\n");
  const bad = await asp(f, ["package", "push", pkg, "--name", "coder"], svc(url, TOKEN_A));
  assert.notEqual(bad.code, 0);
  assert.match(bad.err, /does not verify/);
  assert.match((await asp(f, ["package", "list"], svc(url, TOKEN_A))).out, /team-a: 0 package\(s\)/, "nothing was stored");

  const { f: f2, pkg: pkg2 } = await packed();
  const big = await asp(f2, ["package", "push", pkg2, "--name", "coder"], svc(url, TOKEN_TINY));
  assert.notEqual(big.code, 0);
  assert.match(big.err, /storage quota/);

  const raw = await fetch(`${url}/packages/coder`, { method: "PUT", headers: { authorization: `Bearer ${TOKEN_A}` }, body: new Uint8Array([1, 2, 3]) });
  assert.equal(raw.status, 428);
  const junk = await fetch(`${url}/packages/coder`, { method: "PUT", headers: { authorization: `Bearer ${TOKEN_A}`, "if-none-match": "*" }, body: new Uint8Array([1, 2, 3]) });
  assert.equal(junk.status, 422);
  const badName = await fetch(`${url}/packages/..%2Fescape`, { method: "GET", headers: { authorization: `Bearer ${TOKEN_A}` } });
  assert.equal(badName.status, 400);
});
