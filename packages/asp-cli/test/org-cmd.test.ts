// DK1359, DK1373, DK1374 through the real service and the `asp org` command: an organisation is created, sign-on is configured for a test identity provider, a person signs in, an agent is linked, the person is
// deprovisioned and the agent frozen, and the audit trail is exported as a signed file, verified, tampered with and scheduled. No real identity provider. Fake tokens and keys.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashToken } from "@agent-social/asp-log";
import { LocalLog } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const ORG = "did:web:acme.example:org", FLEET = `${ORG}:fleets:coders`, AGENT = "did:web:acme.example:agents:p1";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
async function asp(f: Fixture, args: string[], env: Record<string, string>) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ...env }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

test("an organisation end to end: sign-on, a person signs in, a linked agent is frozen when the person is deprovisioned, and the audit export is signed, verifies and shows tampering, in one file and on a schedule", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-org-e2e-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([{ name: "acme", role: "tenant", tokenSha256: hashToken("tok-acme") }]));
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", "0"], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let buf = "";
      server.stdout.on("data", (d) => { buf += d; const m = /listening on (http:\/\/[^ ]+)/.exec(buf); if (m) resolve(m[1]); });
      server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
      setTimeout(() => reject(new Error(`no start line: ${buf}`)), 20_000);
    });
    const f = makeFixture();
    const env = { ASP_LOG_URL: url, ASP_LOG_TOKEN: "tok-acme" };
    const ok = async (args: string[], e: Record<string, string> = env) => { const r = await asp(f, args, e); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };

    // the organisation's identity, its fleet and an agent, in the log
    await ok(["identity", "new", "--kind", "human", "--did", ORG, "--no-recovery"]);
    await ok(["fleet", "declare", "--org", ORG, "--name", "Coders", "--purpose", "ship"]);
    await ok(["identity", "new", "--kind", "agent", "--did", AGENT, "--sponsor", ORG, "--fleet", FLEET, "--purpose", "Work"]);

    // create the organisation, configure sign-on for a test identity provider
    assert.match((await ok(["org", "create", "--name", "acme"])).out, /organisation acme created; acme is its owner/);
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const ssoFile = join(f.root, "sso.json");
    writeFileSync(ssoFile, JSON.stringify({ issuer: "https://idp.example", audience: "asp-acme", jwks: { keys: [{ ...(rsa.publicKey.export({ format: "jwk" }) as object), kid: "k1", alg: "RS256" }] }, roleClaim: "groups", roleMap: { "asp-admins": "administrator" }, defaultRole: "member", jit: true }));
    assert.match((await ok(["org", "sso", "set", "--org", "acme", "--file", ssoFile])).out, /sign-on set: oidc https:\/\/idp\.example, just-in-time on, default role member/);
    const idToken = (claims: Record<string, unknown>) => { const head = b64({ alg: "RS256", kid: "k1" }), body = b64({ iss: "https://idp.example", aud: "asp-acme", exp: Math.floor(Date.now() / 1000) + 600, ...claims }); return `${head}.${body}.${createSign("sha256").update(`${head}.${body}`).sign(rsa.privateKey).toString("base64url")}`; };
    const login = async (claims: Record<string, unknown>) => { const r = await fetch(new URL("org/acme/sso/oidc/login", url.endsWith("/") ? url : url + "/"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id_token: idToken(claims) }) }); return { status: r.status, json: await r.json() as any }; };
    const pat = await login({ sub: "pat", email: "pat@acme.example" });
    assert.deepEqual([pat.status, pat.json.role], [200, "member"]);
    const boss = await login({ sub: "boss", groups: ["asp-admins"] });
    assert.equal(boss.json.role, "administrator");

    // a member sees the organisation with their own token and is refused the rest
    assert.match((await ok(["org", "show", "--org", "acme", "--token", pat.json.token])).out, /you are u:pat \(member\)/);
    assert.notEqual((await asp(f, ["org", "members", "--org", "acme", "--token", pat.json.token], env)).code, 0);
    assert.match((await ok(["org", "members", "--org", "acme"])).out, /u:pat +member +active via sso/);
    await ok(["org", "role", "--org", "acme", "--member", "u:pat", "--role", "auditor"]);

    // the person's agent is linked; deprovisioning freezes it
    await ok(["org", "link-agent", "--org", "acme", "--member", "u:pat", "--did", AGENT]);
    const dep = await ok(["org", "deprovision", "--org", "acme", "--member", "u:pat"]);
    assert.match(dep.out, /u:pat deprovisioned: every token ended; 1 agent\(s\) frozen: did:web:acme.example:agents:p1/);
    const controls = JSON.parse(readFileSync(`${tokens}.fleet-controls.json`, "utf8"))[FLEET];
    assert.ok(controls.frozenMembers.includes(AGENT), "the fleet controls hold the agent frozen");
    assert.equal((await login({ sub: "pat" })).json.error.code, "DEPROVISIONED");
    assert.equal((await fetch(new URL("org/acme", url.endsWith("/") ? url : url + "/"), { headers: { authorization: `Bearer ${pat.json.token}` } })).status, 401);

    // the audit trail, then the signed export
    const trail = await ok(["org", "audit", "show", "--org", "acme"]);
    assert.match(trail.out, /org\.create[\s\S]*sso\.configure[\s\S]*member\.provision[\s\S]*login[\s\S]*role\.change[\s\S]*agent\.link[\s\S]*agent\.freeze[\s\S]*member\.deprovision/);
    assert.match(trail.out, /chain verifies/);
    const file = join(f.root, "audit.jsonl");
    const exp = await ok(["org", "audit", "export", "--org", "acme", "--did", ORG, "--out", file]);
    assert.match(exp.out, /audit export: \d+ organisation entries and \d+ log records written/);
    const lines = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(lines[0].kind, "header");
    assert.ok(lines.some((l) => l.kind === "org_audit" && l.entry.action === "login"), "sign-ins are in it");
    for (const t of ["asp.fleet/v0.2", "asp.passport/v0.2"]) assert.ok(lines.some((l) => l.kind === "log_record" && l.record.type === t), `${t} (a fleet and agent record) is in it`);
    assert.equal(lines.at(-1).kind, "signature");
    assert.match((await ok(["org", "audit", "verify", "--file", file])).out, /audit export verified: \d+ entries, \d+ log records, signed by did:web:acme\.example:org#/);
    writeFileSync(file, readFileSync(file, "utf8").replace('"role.change"', '"login"'));
    const bad = await asp(f, ["org", "audit", "verify", "--file", file], env);
    assert.equal(bad.code, 1);
    assert.match(bad.out, /NOT verified: the lines were changed after they were signed/);

    // scheduled: a new file each time, from where the last one stopped
    const sched = join(f.root, "sched");
    const first = await ok(["org", "audit", "export", "--org", "acme", "--did", ORG, "--out", sched, "--every", "1", "--times", "1"]);
    assert.match(first.out, /written to .*audit-000000-00000000\.jsonl/);
    await ok(["org", "role", "--org", "acme", "--member", "u:boss", "--role", "auditor"]);
    const second = await ok(["org", "audit", "export", "--org", "acme", "--did", ORG, "--out", sched, "--every", "1", "--times", "1"]);
    assert.match(second.out, /1 organisation entry and 0 log records/, "only what is new");
    assert.equal(readdirSync(sched).filter((x) => x.endsWith(".jsonl")).length, 2);
    const latest = readdirSync(sched).filter((x) => x.endsWith(".jsonl")).sort().at(-1)!;
    assert.match((await ok(["org", "audit", "verify", "--file", join(sched, latest)])).out, /audit export verified/, "an incremental file verifies on its own");
    assert.equal(existsSync(join(sched, "cursor.json")), true);
    void mkdirSync;
  } finally { server.kill(); }
});

test("an organisation's private log: its records stay in a log of its own, the society witnesses signed checkpoints, refuses a second history at the same point or a foreign signer, and the organisation can check its log against them", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-org-priv-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([{ name: "acme", role: "tenant", tokenSha256: hashToken("tok-acme") }]));
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", "0"], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let buf = "";
      server.stdout.on("data", (d) => { buf += d; const m = /listening on (http:\/\/[^ ]+)/.exec(buf); if (m) resolve(m[1]); });
      server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
      setTimeout(() => reject(new Error(`no start line: ${buf}`)), 20_000);
    });
    const f = makeFixture();
    const env = { ASP_LOG_URL: url, ASP_LOG_TOKEN: "tok-acme" };
    const ok = async (args: string[]) => { const r = await asp(f, args, env); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };
    await ok(["identity", "new", "--kind", "human", "--did", ORG, "--no-recovery"]);       // the organisation's key and passport in the society's log
    await ok(["org", "create", "--name", "acme"]);
    // the private log: a log of its own on another home, with the organisation's records
    const priv = makeFixture(), other = makeFixture();
    const local = (fx: Fixture, names: string[]) => Promise.all(names.map((n) => asp(fx, ["identity", "new", "--kind", "human", "--did", `did:web:private.example:u:${n}`, "--no-recovery"], {}))).then(() => undefined);
    await local(priv, ["a"]); await local(priv, ["b"]); await local(other, ["x"]); await local(other, ["y"]);
    // a checkpoint cannot be published before the private log is declared
    const early = await asp(f, ["org", "checkpoint", "publish", "--org", "acme", "--did", ORG, "--private-log", priv.aspHome], env);
    assert.notEqual(early.code, 0);
    assert.match(early.err, /no private log is declared/);
    await ok(["org", "private-log", "set", "--org", "acme", "--did", ORG]);
    const first = await ok(["org", "checkpoint", "publish", "--org", "acme", "--did", ORG, "--private-log", priv.aspHome]);
    assert.match(first.out, /the society witnessed the private log at seq \d+ .*1 checkpoint\(s\) in all/);
    assert.match((await ok(["org", "checkpoint", "check", "--org", "acme", "--private-log", priv.aspHome])).out, /the private log matches all 1 checkpoint/);
    // the log grows: a later checkpoint is witnessed too, and the old one still matches
    await local(priv, ["c"]);
    assert.match((await ok(["org", "checkpoint", "publish", "--org", "acme", "--did", ORG, "--private-log", priv.aspHome])).out, /2 checkpoint\(s\) in all/);
    assert.match((await ok(["org", "checkpoint", "check", "--org", "acme", "--private-log", priv.aspHome])).out, /matches all 2/);
    // another history at a seq already witnessed is refused: the organisation cannot show two histories
    await local(other, ["z"]);                                                         // a different log that reaches the same count as the private log
    const heads = async (fx: Fixture) => (await (await LocalLog.open(fx.aspHome)).log.head()).seq;
    assert.equal(await heads(other), await heads(priv), "the same seq, a different history");
    const fork = await asp(f, ["org", "checkpoint", "publish", "--org", "acme", "--did", ORG, "--private-log", other.aspHome], env);
    assert.notEqual(fork.code, 0);
    assert.match(fork.err, /a private log cannot show two histories/);
    // the organisation checks its log against the society's checkpoints: a different log does not match
    const mismatch = await asp(f, ["org", "checkpoint", "check", "--org", "acme", "--private-log", other.aspHome], env);
    assert.equal(mismatch.code, 1);
    assert.match(mismatch.out, /do not match: the private log was changed after it was witnessed/);
    // a person without the right role cannot publish; a checkpoint signed by another identity is refused
    const foreign = makeFixture();
    await asp(foreign, ["identity", "new", "--kind", "human", "--did", "did:web:elsewhere.example:org", "--no-recovery"], {});
    const wrong = await asp(foreign, ["org", "checkpoint", "publish", "--org", "acme", "--did", "did:web:elsewhere.example:org", "--private-log", priv.aspHome], env);
    assert.notEqual(wrong.code, 0);
    assert.match(wrong.err, /are signed by did:web:acme\.example:org/);
    assert.match((await ok(["org", "audit", "show", "--org", "acme"])).out, /private_log\.set[\s\S]*checkpoint\.publish[\s\S]*checkpoint\.equivocation/);
  } finally { server.kill(); }
});
