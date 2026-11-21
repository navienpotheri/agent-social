// Register row DK1384: an organisation that leaves takes its data and agents with it. A full export (records, packages, a key manifest, the steps), a re-import on a fresh service that checks every signature, and a closure
// certificate when the account is closed. Setup after account.test.ts. Fake DIDs and keys only; credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
async function service(dir: string, tenant: string) {
  const tokens = join(dir, "tokens.json");
  const tok = (await run(["serve", "token", "--tokens", tokens, "--tenant", tenant])).out.trim().split("\n").at(-1)!;
  const server: ChildProcess = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", "0", "--packages", join(dir, "pkgs"), "--commons", join(dir, "commons")], { stdio: ["ignore", "pipe", "pipe"] });
  const url = await new Promise<string>((resolve, reject) => {
    let buf = "";
    server.stdout!.on("data", (d) => { buf += d; const m = /listening on (http:\/\/[^ ]+)/.exec(buf); if (m) resolve(m[1]!); });
    server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
    setTimeout(() => reject(new Error(`no start line: ${buf}`)), 20_000);
  });
  return { url, tok, server };
}

const HUMAN = "did:web:example.com:users:orgco", AGENT1 = "did:web:example.com:agents:orgco-one", AGENT2 = "did:web:example.com:agents:orgco-two";

test("DK1384: an organisation exports everything, imports it into a fresh service that checks every signature, and closes the old account with a closure certificate", { timeout: 300_000 }, async () => {
  const dirA = mkdtempSync(join(tmpdir(), "asp-offboard-a-")), dirB = mkdtempSync(join(tmpdir(), "asp-offboard-b-"));
  const A = await service(dirA, "org-old"), B = await service(dirB, "org-new");
  try {
    const f = makeFixture();
    const envA = { ASP_LOG_URL: A.url, ASP_LOG_TOKEN: A.tok }, envB = { ASP_LOG_URL: B.url, ASP_LOG_TOKEN: B.tok };
    assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", HUMAN], envA)).code, 0);
    for (const a of [AGENT1, AGENT2]) assert.equal((await asp(f, ["identity", "new", "--kind", "agent", "--did", a, "--sponsor", HUMAN], envA)).code, 0);
    const pkg = join(f.root, "p.aspkg");
    assert.equal((await asp(f, ["pack", "--runtime", "claude-code", "--agent", AGENT1, "--project", f.project, "--user-home", f.home, "--out", pkg], envA)).code, 0);
    assert.equal((await asp(f, ["package", "push", pkg, "--name", "coder"], envA)).code, 0);

    // 1. The full export: records, the package, the key manifest and the steps. No key is copied into it.
    const out = join(dirA, "export");
    const exp = await asp(f, ["account", "export", "--out", out], envA);
    assert.equal(exp.code, 0, exp.err);
    assert.ok(readdirSync(out).includes("keys.json") && readdirSync(out).includes("records.ndjson") && readdirSync(join(out, "packages")).includes("coder.aspkg.tgz"));
    const keys = JSON.parse(readFileSync(join(out, "keys.json"), "utf8")) as { v: string; note: string; identities: { did: string; key_on_this_machine: boolean }[] };
    assert.equal(keys.v, "asp.key-handover/v0");
    assert.deepEqual(keys.identities.map((i) => i.did).sort(), [AGENT1, AGENT2, HUMAN].sort());
    assert.ok(keys.identities.every((i) => i.key_on_this_machine), "this machine made the keys");
    assert.match(keys.note, /never held these keys/);
    assert.ok(!readFileSync(join(out, "keys.json"), "utf8").includes("seed"), "no key material in the manifest");
    assert.match(readFileSync(join(out, "README.txt"), "utf8"), /Taking your agents with you/);
    const records = readFileSync(join(out, "records.ndjson"), "utf8").trim().split("\n");
    assert.ok(records.length >= 3);

    // 2. A fresh service: nothing there yet, then the import brings the identities and the package.
    assert.equal((await asp(f, ["account", "show"], envB)).out.includes(AGENT1), false, "the fresh service knows none of them");
    const imp = await asp(f, ["account", "import", "--from", out], envB);
    assert.equal(imp.code, 0, imp.out + imp.err);
    assert.match(imp.out, new RegExp(`imported ${records.length} record\\(s\\) \\(0 already there\\), 1 package\\(s\\) \\(0 already there\\); 0 refused`));
    const shown = (await asp(f, ["account", "show"], envB)).out;
    for (const did of [HUMAN, AGENT1, AGENT2]) assert.ok(shown.includes(did), `${did} is on the new service`);
    assert.match(shown, /packages: 1/);
    // Running it again is harmless: every record is already there.
    const again = await asp(f, ["account", "import", "--from", out], envB);
    assert.equal(again.code, 0, again.out);
    assert.match(again.out, new RegExp(`imported 0 record\\(s\\) \\(${records.length} already there\\), 0 package\\(s\\) \\(1 already there\\); 0 refused`));
    // A tampered record is refused by the new log: the signature no longer holds.
    const bad = join(dirB, "export-bad");
    mkdirSync(bad, { recursive: true });
    for (const n of ["account.json", "records.ndjson"]) writeFileSync(join(bad, n), readFileSync(join(out, n), "utf8"));
    const first = JSON.parse(records[0]!) as { record: { id: string; body: Record<string, unknown> } };
    first.record.body.purpose = "tampered after the export";
    first.record.id = "sha256:" + "0".repeat(64); // a changed record is a new id to a log that already holds the original
    writeFileSync(join(bad, "records.ndjson"), [JSON.stringify(first), ...records.slice(1)].join("\n") + "\n");
    const tampered = await asp(f, ["account", "import", "--from", bad], envB);
    assert.equal(tampered.code, 1);
    assert.match(tampered.out, /1 refused|refused:/);
    // Not an export folder.
    assert.equal((await asp(f, ["account", "import", "--from", dirB], envB)).code, 2);

    // 3. Closing the old account leaves a closure certificate that says what was deleted, what stays and the retention rule.
    const closed = await asp(f, ["account", "close", "--confirm", "org-old", "--skip-export"], envA);
    assert.equal(closed.code, 0, closed.err);
    assert.match(closed.out, /it is also the closure certificate/);
    const path = /deletion receipt saved to (.*?) \(/.exec(closed.out)![1]!;
    const cert = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(cert.certificate, "asp.closure-certificate/v0");
    assert.equal(cert.tenant, "org-old");
    assert.equal(cert.deleted.packages, 1);
    assert.match(cert.retention, /12 months/);
    assert.match(cert.retention, /35 days/);
    const { sha256, ...rest } = cert;
    assert.equal(sha256, createHash("sha256").update(Buffer.from(JSON.stringify(rest), "utf8")).digest("hex"));
    // The agents live on in the new service after the old tenant is gone.
    assert.ok((await asp(f, ["account", "show"], envB)).out.includes(AGENT2));
    assert.equal(existsSync(join(dirA, "pkgs", "org-old")), false);
  } finally { A.server.kill(); B.server.kill(); }
});
