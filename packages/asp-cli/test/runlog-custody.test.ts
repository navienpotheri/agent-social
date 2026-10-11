import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RunRecorder } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";
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
const ALICE = "did:web:example.com:users:alice", JUROR = "did:web:example.com:court:j1", BOB = "did:web:example.com:users:bob";
const CONTRACT = "sha256:" + "ab".repeat(32);

test("run-log custody: a log is sealed on the machine, the service holds ciphertext only, the owner opens it again, discloses it to a juror with a signed reason, and closing the account deletes it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-custody-e2e-"));
  const tokens = join(dir, "tokens.json");
  const tok = async (name: string, role = "tenant") => (await run(["serve", "token", "--tokens", tokens, "--tenant", name, "--role", role])).out.trim().split("\n").at(-1)!;
  const [tokA, tokB, tokOps] = [await tok("team-a"), await tok("team-b"), await tok("ops", "admin")];
  const vault = join(dir, "runlogs");
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", "0", "--runlogs", vault], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let buf = "";
      server.stdout.on("data", (d) => { buf += d; const m = /listening on (http:\/\/[^ ]+)/.exec(buf); if (m) resolve(m[1]); });
      server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
      setTimeout(() => reject(new Error(`no start line: ${buf}`)), 20_000);
    });
    const envA = { ASP_LOG_URL: url, ASP_LOG_TOKEN: tokA }, envB = { ASP_LOG_URL: url, ASP_LOG_TOKEN: tokB }, envOps = { ASP_LOG_URL: url, ASP_LOG_TOKEN: tokOps };
    const a = makeFixture(), b = makeFixture(), court = makeFixture();
    assert.equal((await asp(a, ["identity", "new", "--kind", "human", "--did", ALICE], envA)).code, 0);
    assert.equal((await asp(b, ["identity", "new", "--kind", "human", "--did", BOB], envB)).code, 0);
    // The juror is an identity on the operator's side, with its key on the court's machine.
    assert.equal((await asp(court, ["identity", "new", "--kind", "human", "--did", JUROR], envOps)).code, 0);

    // A run log with something in it we can look for.
    const file = join(a.root, "run-log.ndjson");
    const rec = new RunRecorder(file);
    rec.event("run_start", { contract: CONTRACT, agent: "did:web:example.com:agents:alice-coder", scopes: ["shell.exec"] });
    rec.event("tool_call", { tool: "bash", scope: "shell.exec", allowed: true, input: "npm run build --secret-sauce-flag" });
    rec.event("run_end", { exit_code: 0 });

    const kept = await asp(a, ["run-log", "keep", file, "--as", ALICE], envA);
    assert.equal(kept.code, 0, kept.err);
    assert.match(kept.out, /kept sha256:ab[0-9a-f:]+\.[0-9a-f]{12}: 3 event\(s\).*sealed to 2 key\(s\)/);
    const id = /kept (\S+):/.exec(kept.out)![1];
    assert.match((await asp(a, ["run-log", "keep", file, "--as", ALICE], envA)).out, /already kept/);
    const list = await asp(a, ["run-log", "kept"], envA);
    assert.match(list.out, new RegExp(`${id.replace(/[.:]/g, "\\$&")}.*2 key`));
    // The service holds ciphertext: nothing readable in what it stored.
    const stored = readdirSync(join(vault, "team-a"));
    assert.equal(stored.length, 1);
    const raw = readFileSync(join(vault, "team-a", stored[0]), "utf8");
    assert.ok(!raw.includes("secret-sauce-flag") && !raw.includes("npm run build"), "the stored file does not hold the log");
    // Another tenant sees none of it and cannot reach it.
    assert.match((await asp(b, ["run-log", "kept"], envB)).out, /0 sealed run log/);
    const peek = await asp(b, ["run-log", "fetch", "--id", id, "--tenant", "team-a"], envB);
    assert.equal(peek.code, 1);
    assert.match(peek.err, /only an admin/);
    assert.equal((await asp(b, ["run-log", "fetch", "--id", id], envB)).code, 1);

    // Back on this machine, the owner fetches it and opens it: the same bytes.
    const fetched = await asp(a, ["run-log", "fetch", "--id", id, "--out", join(a.root, "mine.sealed.json")], envA);
    assert.equal(fetched.code, 0, fetched.err);
    const opened = await asp(a, ["run-log", "open", join(a.root, "mine.sealed.json"), "--as", ALICE, "--out", join(a.root, "mine.ndjson")], envA);
    assert.equal(opened.code, 0, opened.out + opened.err);
    assert.match(opened.out, /run log verifies: 3 event\(s\)/);
    assert.equal(readFileSync(join(a.root, "mine.ndjson"), "utf8"), readFileSync(file, "utf8"));
    // Someone else's key does not open it.
    assert.equal((await asp(court, ["run-log", "open", join(a.root, "mine.sealed.json"), "--as", JUROR, "--out", join(court.root, "x.ndjson")], envOps)).code, 1);

    // A disclosure needs a reason; with one, the juror (and only the juror) can open it, and the signature checks.
    assert.equal((await asp(a, ["run-log", "disclose", "--id", id, "--to", JUROR, "--as", ALICE], envA)).code, 2);
    const disc = await asp(a, ["run-log", "disclose", "--id", id, "--to", JUROR, "--reason", "dispute D-1 over the build job", "--as", ALICE, "--upload", "--out", join(a.root, "d.json")], envA);
    assert.equal(disc.code, 0, disc.err);
    assert.match(disc.out, /signed, reason: dispute D-1/);
    // The operator's court gets the sealed file from the service (an admin may read, not open) and the juror opens it.
    const pulled = await asp(court, ["run-log", "fetch", "--id", id, "--tenant", "team-a", "--out", join(court.root, "pulled.json")], envOps);
    assert.equal(pulled.code, 0, pulled.err);
    const jopen = await asp(court, ["run-log", "open", join(court.root, "pulled.json"), "--as", JUROR, "--out", join(court.root, "juror.ndjson")], envOps);
    assert.equal(jopen.code, 0, jopen.out + jopen.err);
    assert.match(jopen.out, /disclosed .* by did:web:example.com:users:alice to did:web:example.com:court:j1: dispute D-1/);
    assert.ok(!/PROBLEM/.test(jopen.out), jopen.out);
    assert.equal(readFileSync(join(court.root, "juror.ndjson"), "utf8"), readFileSync(file, "utf8"));
    // A disclosed copy cannot be swapped for a different log under the same job.
    rec.event("tool_call", { tool: "bash", scope: "shell.exec", allowed: true, input: "later" });
    const swap = await asp(a, ["run-log", "keep", file, "--as", ALICE], envA);
    // Same first event, same id, but the log grew: a different file, and the sealed copy was already disclosed, so it is refused.
    assert.equal(swap.code, 1);
    assert.match(swap.err, /already disclosed/);

    // Export includes the sealed file; closing deletes it.
    const outDir = join(a.root, "export");
    const ex = await asp(a, ["account", "export", "--out", outDir], envA);
    assert.equal(ex.code, 0, ex.err);
    assert.equal(readdirSync(join(outDir, "runlogs")).length, 1);
    const closed = await asp(a, ["account", "close", "--confirm", "team-a", "--skip-export"], envA);
    assert.equal(closed.code, 0, closed.err);
    assert.ok(!existsSync(join(vault, "team-a")), "the sealed logs are deleted with the account");
  } finally { server.kill(); rmSync(dir, { recursive: true, force: true }); }
});
