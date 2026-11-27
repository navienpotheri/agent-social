// DK1384: an organisation that leaves takes its records, run logs and agent keys with it, in the log's own format; the export verifies, replays into a fresh log, and closing signs a closure certificate.
// Real commands on real local logs (the second is a fresh log standing for a fresh service). Fake keys; mock credits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { b64urlDecode, verifyBytes } from "@agent-social/asp-core";
import { spawn } from "node:child_process";
import { hashToken } from "@agent-social/asp-log";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const ORG = "did:web:acme.example:org", OTHER = "did:web:other.example:org";
const FLEET = `${ORG}:fleets:coders`;
async function asp(f: Fixture, args: string[], extraEnv: Record<string, string> = {}) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ...extraEnv }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };

async function acme() {
  const f = makeFixture();
  for (const d of [ORG, OTHER]) await ok(f, ["identity", "new", "--kind", "human", "--did", d, "--no-recovery"]);
  await ok(f, ["fleet", "declare", "--org", ORG, "--name", "Coders", "--purpose", "ship code"]);
  for (const n of ["a1", "a2", "a3"]) await ok(f, ["identity", "new", "--kind", "agent", "--did", `did:web:acme.example:agents:${n}`, "--sponsor", ORG, "--fleet", FLEET, "--purpose", "Work"]);
  writeFileSync(join(f.root, "t.json"), JSON.stringify({ purpose: "Work", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 10, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "memory", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2040-01-01T00:00:00Z", revocable: true }));
  await ok(f, ["fleet", "template", "set", "--did", FLEET, "--file", join(f.root, "t.json")]);
  // a run log on this machine for one of the agents
  const run = join(f.aspHome, "runs", "gateway-test-1");
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, "run-log.ndjson"), JSON.stringify({ kind: "run_start", data: { agent: "did:web:acme.example:agents:a1", scopes: ["repo.read"] } }) + "\n");
  return f;
}

test("export takes the organisation's records and its agents', not another organisation's; the run logs and, when asked, the keys; it verifies and a tampered export is refused", async () => {
  const f = await acme();
  const out = join(f.root, "export");
  const r = await ok(f, ["offboard", "export", "--org", ORG, "--out", out, "--keys"]);
  assert.match(r.out, /exported \d+ records of 4 identities \(did:web:acme\.example:org and the agents it sponsors\).*1 run log.*4 keys handed over/);
  const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
  assert.deepEqual([manifest.organisation, manifest.identities.length, manifest.run_logs, manifest.keys_handed_over], [ORG, 4, 1, 4]);
  const recs = readFileSync(join(out, "records.ndjson"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(recs.length, manifest.records);
  assert.ok(recs.every((x: { record: { issuer: string } }) => x.record.issuer.startsWith("did:web:acme.example")), "nothing of another organisation");
  assert.ok(recs.some((x: { record: { type: string } }) => x.record.type === "asp.mandate_template/v0.2"), "the Mandate template is in it");
  assert.equal(JSON.parse(readFileSync(join(out, "mandates.json"), "utf8")).length, 1);
  assert.equal(readdirSync(join(out, "keys")).length, 4);
  assert.equal(readdirSync(join(out, "runlogs")).length, 1);
  assert.match((await ok(f, ["offboard", "verify", "--from", out])).out, /export verified: \d+ records/);
  // without --keys no key leaves
  const plain = join(f.root, "plain");
  assert.match((await ok(f, ["offboard", "export", "--org", ORG, "--out", plain])).out, /no keys \(add --keys to hand them over\)/);
  assert.equal(existsSync(join(plain, "keys")), false);
  // a record altered after the export is caught
  const lines = readFileSync(join(out, "records.ndjson"), "utf8").split("\n").filter(Boolean);
  const bad = JSON.parse(lines[1]); bad.record.body = { ...bad.record.body, name: "tampered", purpose: "tampered" };
  lines[1] = JSON.stringify(bad);
  writeFileSync(join(out, "records.ndjson"), lines.join("\n") + "\n");
  const v = await asp(f, ["offboard", "verify", "--from", out]);
  assert.equal(v.code, 1);
  assert.match(v.out, /export NOT verified/);
  assert.notEqual((await asp(f, ["offboard", "export", "--org", "did:web:nobody.example:org", "--out", join(f.root, "x")])).code, 0);
});

test("the export replays into a fresh log: the organisation, its fleet, its template and its agents are all there with the same ids; replaying again adds nothing", async () => {
  const f = await acme();
  const out = join(f.root, "export");
  await ok(f, ["offboard", "export", "--org", ORG, "--out", out]);
  const fresh = makeFixture();
  const r = await ok(fresh, ["offboard", "import", "--from", out]);
  const n = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")).records;
  assert.match(r.out, new RegExp(`imported ${n} of ${n} records`));
  const show = await ok(fresh, ["fleet", "show", FLEET]);
  assert.match(show.out, /members 3/);
  assert.match((await ok(fresh, ["fleet", "template", "show", FLEET])).out, /version 1/);
  assert.match((await ok(fresh, ["log", "verify"])).out, /log ok/);
  const again = await ok(fresh, ["offboard", "import", "--from", out]);
  assert.doesNotMatch(again.out, new RegExp(`imported ${n} of ${n}`), "nothing is added twice");
});

test("close needs the organisation's own confirmation and a verified export, closes the fleets and signs a closure certificate that verifies", async () => {
  const f = await acme();
  const out = join(f.root, "export");
  await ok(f, ["offboard", "export", "--org", ORG, "--out", out]);
  assert.notEqual((await asp(f, ["offboard", "close", "--from", out, "--org", ORG])).code, 0, "a yes is needed");
  const r = await ok(f, ["offboard", "close", "--from", out, "--org", ORG, "--confirm", ORG]);
  assert.match(r.out, /closed: 1 fleet closed to new members; closure certificate signed/);
  const cert = JSON.parse(readFileSync(join(out, "closure-certificate.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
  assert.deepEqual([cert.organisation, cert.records_exported, cert.root, cert.fleets_closed, cert.identities], [ORG, manifest.records, manifest.root, 1, 4]);
  assert.match(cert.retention, /retention-and-erasure\.md/);
  const { sig, kid, ...body } = cert;
  const orgPass = readFileSync(join(out, "records.ndjson"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).record).find((x: any) => x.type === "asp.passport/v0.2" && x.body?.did === ORG);
  const key = orgPass.body.keys.find((k: { id: string }) => k.id === kid) ?? orgPass.body.keys[0];
  assert.equal(verifyBytes(b64urlDecode(sig), new TextEncoder().encode(JSON.stringify(body)), b64urlDecode(key.public_key)), true, "the certificate is signed by the organisation's key");
  assert.match((await ok(f, ["fleet", "show", FLEET])).out, /\[closed to new members\]/);
  assert.notEqual((await asp(f, ["identity", "new", "--kind", "agent", "--did", "did:web:acme.example:agents:late", "--sponsor", ORG, "--fleet", FLEET, "--purpose", "Late"])).code, 0, "no new member after closing");
  // an export of another organisation is not closed by this one
  const other = join(f.root, "other");
  await ok(f, ["offboard", "export", "--org", OTHER, "--out", other]);
  assert.notEqual((await asp(f, ["offboard", "close", "--from", other, "--org", ORG, "--confirm", ORG])).code, 0);
});

test("DK1384: an agent's package goes in the export when it is named, a refused package stops the export, and another organisation's agent cannot be packed", async () => {
  const f = await acme();
  const A1 = "did:web:acme.example:agents:a1";
  const out = join(f.root, "export");
  const r = await ok(f, ["offboard", "export", "--org", ORG, "--out", out, "--pack", `${A1}=claude-code:${f.project}`]);
  assert.match(r.out, /exported \d+ records/);
  const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
  assert.equal(manifest.packages.length, 1);
  assert.equal(manifest.packages[0].did, A1);
  const folder = join(out, manifest.packages[0].folder);
  assert.ok(readdirSync(folder).length > 0, "the package is in the export");
  assert.match(readdirSync(folder).join(" "), /manifest|asp\.json|harness|memory/i);
  assert.notEqual((await asp(f, ["offboard", "export", "--org", ORG, "--out", join(f.root, "x1"), "--pack", `did:web:other.example:agents:z=claude-code:${f.project}`])).code, 0, "only the organisation's own agents");
  assert.notEqual((await asp(f, ["offboard", "export", "--org", ORG, "--out", join(f.root, "x2"), "--pack", "not-a-spec"])).code, 0);
  assert.notEqual((await asp(f, ["offboard", "export", "--org", ORG, "--out", join(f.root, "x3"), "--pack", `${A1}=no-such-runtime:${f.project}`])).code, 0, "a package that cannot be made stops the export");
});

test("DK1384: the export replays over HTTP into a fresh service, which re-verifies every record, and the organisation's fleet and agents are there", async () => {
  const f = await acme();
  const out = join(f.root, "export");
  await ok(f, ["offboard", "export", "--org", ORG, "--out", out]);
  const dir = mkdtempSync(join(tmpdir(), "asp-offboard-http-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([{ name: "newhome", role: "tenant", tokenSha256: hashToken("tok-new") }]));
  const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", "0"], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let buf = "";
      server.stdout.on("data", (d) => { buf += d; const m = /listening on (http:\/\/[^ ]+)/.exec(buf); if (m) resolve(m[1]); });
      server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
      setTimeout(() => reject(new Error(`no start line: ${buf}`)), 20_000);
    });
    const home = makeFixture();
    const env = { ASP_LOG_URL: url, ASP_LOG_TOKEN: "tok-new" };
    const r = await asp(home, ["offboard", "import", "--from", out], env);
    assert.equal(r.code, 0, r.err);
    const n = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")).records;
    assert.match(r.out, new RegExp(`imported ${n} of ${n} records`));
    assert.match((await asp(home, ["fleet", "show", FLEET], env)).out, /members 3/);
    assert.match((await asp(home, ["log", "verify"], env)).out, /log ok/);
    // a changed record is refused by the service even if the file's own check were skipped: the export itself is checked first
    const lines = readFileSync(join(out, "records.ndjson"), "utf8").split("\n").filter(Boolean);
    const bad = JSON.parse(lines[1]); bad.record.body = { ...bad.record.body, purpose: "changed" }; lines[1] = JSON.stringify(bad);
    writeFileSync(join(out, "records.ndjson"), lines.join("\n") + "\n");
    assert.notEqual((await asp(home, ["offboard", "import", "--from", out], env)).code, 0);
  } finally { server.kill(); }
});
