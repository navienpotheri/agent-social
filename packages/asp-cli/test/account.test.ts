import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { main, setClock, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const run = (args: string[]) => new Promise<{ code: number; out: string; err: string }>((resolve) => {
  const c = spawn(process.execPath, [cli, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (err += d));
  c.on("close", (code) => resolve({ code: code ?? 1, out, err }));
});
async function asp(f: Fixture, args: string[], env: Record<string, string>) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ...env }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

const A_HUMAN = "did:web:example.com:users:alice", A_AGENT = "did:web:example.com:agents:alice-coder";
const B_HUMAN = "did:web:example.com:users:bob", B_AGENT = "did:web:example.com:agents:bob-reviewer";

test("account: a tenant sees what the service holds, exports all of it, and closing deletes its packages and commons documents (and the reviews on them), leaves a tombstone and keeps the log", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-account-e2e-"));
  const tokens = join(dir, "tokens.json");
  const tok = async (name: string, role = "tenant") => (await run(["serve", "token", "--tokens", tokens, "--tenant", name, "--role", role])).out.trim().split("\n").at(-1)!;
  const [tokA, tokB, tokOps] = [await tok("team-a"), await tok("team-b"), await tok("ops", "admin")];
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", "0", "--packages", join(dir, "pkgs"), "--commons", join(dir, "commons")], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let buf = "";
      server.stdout.on("data", (d) => { buf += d; const m = /listening on (http:\/\/[^ ]+)/.exec(buf); if (m) resolve(m[1]); });
      server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
      setTimeout(() => reject(new Error(`no start line: ${buf}`)), 20_000);
    });
    const envA = { ASP_LOG_URL: url, ASP_LOG_TOKEN: tokA }, envB = { ASP_LOG_URL: url, ASP_LOG_TOKEN: tokB }, envOps = { ASP_LOG_URL: url, ASP_LOG_TOKEN: tokOps };
    const a = makeFixture(), b = makeFixture();
    // Each tenant makes its identities, an agent package and a commons entry.
    for (const [f, env, human, agent] of [[a, envA, A_HUMAN, A_AGENT], [b, envB, B_HUMAN, B_AGENT]] as const) {
      assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", human], env)).code, 0);
      assert.equal((await asp(f, ["identity", "new", "--kind", "agent", "--did", agent, "--sponsor", human], env)).code, 0);
    }
    const pkgA = join(a.root, "a.aspkg");
    assert.equal((await asp(a, ["pack", "--runtime", "claude-code", "--agent", A_AGENT, "--project", a.project, "--user-home", a.home, "--out", pkgA], envA)).code, 0);
    assert.equal((await asp(a, ["package", "push", pkgA, "--name", "coder"], envA)).code, 0);
    const noteA = join(a.root, "a.md"), noteB = join(b.root, "b.md");
    writeFileSync(noteA, "Run migrations before seeding.\n"); writeFileSync(noteB, "Pin the toolchain version in CI.\n");
    setClock(() => new Date("2026-10-11T10:00:00Z"));
    const entryA = /shared: (sha256:[0-9a-f]{64})/.exec((await asp(a, ["commons", "add", noteA, "--by", A_AGENT, "--title", "Migrations first"], envA)).out)![1];
    const entryB = /shared: (sha256:[0-9a-f]{64})/.exec((await asp(b, ["commons", "add", noteB, "--by", B_AGENT, "--title", "Pin the toolchain"], envB)).out)![1];
    setClock(undefined);
    // They read each other's entries: B endorses and cites A's; A cites B's.
    assert.equal((await asp(b, ["commons", "review", entryA, "--by", B_AGENT, "--verdict", "endorse"], envB)).code, 0);
    assert.equal((await asp(b, ["commons", "cite", entryA, "--by", B_AGENT, "--context", "worked for me"], envB)).code, 0);
    assert.equal((await asp(a, ["commons", "cite", entryB, "--by", A_AGENT, "--context", "pinned ours"], envA)).code, 0);

    // What the service holds for A.
    const show = await asp(a, ["account", "show"], envA);
    assert.equal(show.code, 0, show.err);
    assert.match(show.out, /tenant team-a \(tenant\)/);
    assert.ok(show.out.includes(A_AGENT) && show.out.includes(A_HUMAN) && !show.out.includes(B_AGENT));
    assert.match(show.out, /packages: 1; commons: 1 entries, 0 reviews, 1 citations/);

    // The export: records, commons, the package, checked against its hash; nothing of B's.
    const out = join(dir, "export-a");
    const exp = await asp(a, ["account", "export", "--out", out], envA);
    assert.equal(exp.code, 0, exp.err);
    assert.deepEqual(readdirSync(out).sort(), ["README.txt", "account.json", "commons.json", "packages", "records.ndjson"]);
    assert.deepEqual(readdirSync(join(out, "packages")), ["coder.aspkg.tgz"]);
    const records = readFileSync(join(out, "records.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.ok(records.length >= 2 && records.every((r) => [A_HUMAN, A_AGENT].includes(r.record.issuer) || [A_HUMAN, A_AGENT].includes(r.record.subject)), "only records signed by or about A's identities");
    const account = JSON.parse(readFileSync(join(out, "account.json"), "utf8"));
    assert.equal(account.tenant.name, "team-a");
    assert.ok(!JSON.stringify(account).includes("tokenSha256"), "the token's hash is not exported");
    const commons = JSON.parse(readFileSync(join(out, "commons.json"), "utf8"));
    assert.deepEqual([commons.entries.length, commons.citations.length], [1, 1]);

    // Closing: a confirmation is needed; the right one deletes.
    assert.equal((await asp(a, ["account", "close"], envA)).code, 2);
    const wrong = await asp(a, ["account", "close", "--confirm", "team-b", "--skip-export"], envA);
    assert.equal(wrong.code, 1);
    assert.match(wrong.err, /send \{"confirm": "team-a"\}/);
    const closeOut = join(dir, "export-before-close");
    const closed = await asp(a, ["account", "close", "--confirm", "team-a", "--out", closeOut], envA);
    assert.equal(closed.code, 0, closed.err);
    assert.match(closed.out, /exported to .* first/);
    assert.match(closed.out, /account team-a closed: deleted 1 package\(s\), 1 commons entr\(ies\), 1 review\(s\) and 2 citation\(s\)/);
    assert.match(closed.out, /append-only/);
    assert.ok(existsSync(join(closeOut, "packages", "coder.aspkg.tgz")), "exported before deleting");
    // Gone: the token, the package, A's entry with B's review and citation of it, A's citation of B's entry. B's entry stays.
    assert.equal((await asp(a, ["account", "show"], envA)).code, 1, "the token no longer works");
    assert.equal(existsSync(join(dir, "pkgs", "team-a")), false);
    const afterList = await asp(b, ["commons", "list"], envB);
    assert.ok(!afterList.out.includes("Migrations first") && afterList.out.includes("Pin the toolchain"));
    const entryView = await fetch(`${url}/commons/entries/${encodeURIComponent(entryB)}`, { headers: { authorization: `Bearer ${tokB}` } });
    const view = (await entryView.json()) as { citations: number; cited: unknown[] };
    assert.equal(view.cited.length, 0, "A's citation of B's entry was deleted with A's account");
    const file = JSON.parse(readFileSync(tokens, "utf8")) as any[];
    const stone = file.find((t) => t.name === "team-a");
    assert.equal(stone.tokenSha256, "");
    assert.ok(stone.closed.retainUntil > stone.closed.at);
    assert.ok(!readFileSync(tokens, "utf8").includes("alice"), "no personal detail is left in the tenants file");
    assert.equal(JSON.parse(readFileSync(`${tokens}.dids.json`, "utf8"))["team-a"], undefined);
    // The records stay in the log.
    assert.match((await asp(b, ["identity", "show", A_AGENT], envB)).out, new RegExp(A_AGENT.replace(/[.]/g, "\\.")));

    // An admin closes another tenant's account on request, never an admin's; tombstones past their retention are purged.
    const noSuch = await asp(a, ["account", "close", "--tenant", "ops", "--confirm", "ops", "--skip-export"], envOps);
    assert.equal(noSuch.code, 1);
    const byAdmin = await asp(a, ["account", "close", "--tenant", "team-b", "--confirm", "team-b", "--skip-export"], envOps);
    assert.equal(byAdmin.code, 0, byAdmin.err);
    assert.match(byAdmin.out, /account team-b closed: deleted 0 package\(s\), 1 commons entr\(ies\)/);
    assert.equal((await asp(b, ["account", "show"], envB)).code, 1);
    const purge1 = await run(["serve", "purge", "--tokens", tokens]);
    assert.match(purge1.out, /0 closed account\(s\) past their retention period removed; 2 still kept/);
    const old = JSON.parse(readFileSync(tokens, "utf8")) as any[];
    old.find((t) => t.name === "team-a").closed.retainUntil = "2020-01-01T00:00:00Z";
    writeFileSync(tokens, JSON.stringify(old));
    const purge2 = await run(["serve", "purge", "--tokens", tokens]);
    assert.match(purge2.out, /1 closed account\(s\) past their retention period removed; 1 still kept/);
  } finally {
    server.kill();
  }
});
