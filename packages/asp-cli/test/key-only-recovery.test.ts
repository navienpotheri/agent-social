// Register row KO2 (docs/key-only-audit.md): a key-only agent has no sponsor to recover it and no verified address to be told anything at. On a REAL local service: enrolling says so plainly and shows a recovery code
// once; `asp account show` and `asp identity show` say "not recoverable: key-only, no sponsor" instead of "recoverable by its sponsor"; the code restores the same key on another machine and a wrong code restores
// nothing; `asp notices` reads what has happened to the identity from the log (a slash, a quarantine, an upheld report, a halted run). Fake keys only; credits are mock accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashToken } from "@agent-social/asp-log";
import { main, type Io } from "../src/cli.ts";
import { noticesFor } from "../src/notices.ts";
import { makeFixture } from "./fixture.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
function start(args: string[]) {
  const server = spawn(process.execPath, [cli, "serve", ...args], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } });
  let buf = "";
  const ready = new Promise<string>((resolve, reject) => {
    server.stdout.on("data", (d) => { buf += d; const m = /listening on (http:\/\/[^ ]+)/.exec(buf); if (m) resolve(m[1]); });
    server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
    setTimeout(() => reject(new Error(`no start line: ${buf}`)), 30_000);
  });
  return { ready, stop: () => server.kill() };
}

test("KO2: enrolling a key-only agent says what it cannot recover and gives the recovery code once; the account and identity views say 'not recoverable: key-only'; the code restores the key and a wrong one does not", { timeout: 300_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-ko-recovery-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([{ name: "ops", role: "admin", tokenSha256: hashToken("tok-ops") }]));
  const svc = start(["--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", "0", "--signup", "--signup-terms-url", "https://example.org/terms", "--signup-difficulty", "8", "--rate-limit", "0", "--write-limit", "0", "--address-limit", "0"]);
  try {
    const url = await svc.ready;
    const f = makeFixture();
    mkdirSync(f.aspHome, { recursive: true });
    const call = async (args: string[], home = f.aspHome, extra: Record<string, string> = {}) => {
      const out: string[] = [], err: string[] = [];
      const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home, ...extra }, cwd: f.root } as Io);
      return { code, out: out.join("\n"), err: err.join("\n") };
    };
    const enrol = await call(["enrol", "--service", url, "--name", "ko-rec-agent", "--accept-terms"]);
    assert.equal(enrol.code, 0, enrol.err);
    assert.match(enrol.out, /RECOVERY \(read this once\): you have no sponsor and a did:key is its key, so a lost key is a lost identity/);
    const code = /recovery code: ([^\n]+)/.exec(enrol.out)?.[1]?.trim();
    assert.match(code ?? "", /^ASP(-[A-Z0-9]{6}){8,}$/, `a recovery code is shown once: ${code}`);
    assert.match(enrol.out, /TOKEN: your login token is saved .* no Google account to recover it with/);
    assert.match(enrol.out, /NOTICES: nothing is mailed to you .* asp notices/);
    const did = /your identity is (did:key:\S+)/.exec(enrol.out)![1]!;
    // Nothing on this machine holds the code.
    for (const file of readdirSync(f.aspHome, { recursive: true }) as string[]) { const p = join(f.aspHome, file); try { assert.ok(!readFileSync(p, "utf8").includes(code!), `${file} holds the recovery code`); } catch (e) { if ((e as { code?: string }).code === "ERR_ASSERTION") throw e; } }
    // The account view and the identity view
    const account = await call(["account", "show"]);
    assert.match(account.out, /NOT RECOVERABLE: key-only, no sponsor/, account.out);
    assert.doesNotMatch(account.out, /recoverable by its sponsor/);
    const show = await call(["identity", "show", did]);
    assert.match(show.out, /not recoverable: key-only, no sponsor/);
    // Restore on another machine from the code: the same key; a wrong code and a wrong did restore nothing
    const other = mkdtempSync(join(tmpdir(), "asp-ko-recovery-other-"));
    const wrong = await call(["identity", "restore", did], other, { ASP_RECOVERY_CODE: code!.split("-").reverse().join("-") });
    assert.notEqual(wrong.code, 0, "a wrong code restores nothing");
    assert.equal(existsSync(join(other, "keys")) && readdirSync(join(other, "keys")).length > 0, false);
    const ok = await call(["identity", "restore", did], other, { ASP_RECOVERY_CODE: code! });
    assert.equal(ok.code, 0, ok.err + ok.out);
    assert.match(ok.out, /restored the key of did:key:/);
    assert.ok(readdirSync(join(other, "keys")).length >= 1, "the key is on the other machine");
    const again = await call(["identity", "restore", did], other, { ASP_RECOVERY_CODE: code! });
    assert.match(again.out, /already here; left as it is/);
    // Notices from the real log: nothing yet
    const notices = await call(["notices"]);
    assert.equal(notices.code, 0, notices.err);
    assert.match(notices.out, /notices for did:key:.*: 0/);
  } finally { svc.stop(); }
});

test("KO2: asp notices reads a slash, a quarantine, an upheld abuse report and a halted run from the records, for the one identity and no other, oldest first", async () => {
  const me = "did:key:z6MkMe", other = "did:key:z6MkOther";
  const rec = (id: string, type: string, at: string, body: Record<string, unknown>) => ({ id, record: { type, issued_at: at, body } as never });
  const stored = [
    rec("c1", "asp.contract/v0.2", "2026-11-01T00:00:00Z", { performer: me }),
    rec("c2", "asp.contract/v0.2", "2026-11-01T00:00:00Z", { performer: other }),
    rec("s1", "asp.settlement/v0.2", "2026-11-05T00:00:00Z", { contract: "c1", basis: "revoked", bond_slashed: { value: 20 } }),
    rec("s2", "asp.settlement/v0.2", "2026-11-06T00:00:00Z", { contract: "c2", basis: "revoked", bond_slashed: { value: 20 } }),
    rec("s3", "asp.settlement/v0.2", "2026-11-07T00:00:00Z", { contract: "c1", basis: "accepted", bond_slashed: { value: 0 } }),
    rec("q1", "asp.quarantine/v0.2", "2026-11-04T00:00:00Z", { members: [me], level: "halt", until: "2026-11-11T00:00:00Z", reason: "an upheld report" }),
    rec("q2", "asp.quarantine/v0.2", "2026-11-04T00:00:00Z", { members: [other], level: "halt", until: "2026-11-11T00:00:00Z", reason: "not you" }),
    rec("a1", "asp.abuse_report/v0.2", "2026-11-03T00:00:00Z", { accused: me, kind: "network_abuse", description: "scanned our servers" }),
    rec("h1", "asp.run_halt/v0.2", "2026-11-02T00:00:00Z", { agent: me, reason: "equivalent_calls", detail: "Read was called 8 times" }),
  ];
  const list = await noticesFor(stored, me);
  assert.deepEqual(list.map((n) => [n.id, n.kind]), [["h1", "run halted"], ["a1", "abuse report"], ["q1", "quarantine"], ["s1", "bond slashed"]], "mine only, oldest first, a slash only where the bond was slashed");
  assert.deepEqual((await noticesFor(stored, other)).map((n) => n.id), ["q2", "s2"]);
  assert.deepEqual(await noticesFor(stored, "did:key:z6MkNobody"), []);
});
