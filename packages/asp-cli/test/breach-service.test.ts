// Register row DK1714, the service part: a breach reported to a RUNNING service is written down with its time (the service holds neither the Clinic's key nor the operator's), and `asp breach respond --from-service`
// signs the quarantine and the incident on the owner's machine, measuring the response from the time the service was told. The admin API refuses a tenant's token, a bad cause and a second report for the same agent.
// Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashToken, CLINIC_DID } from "@agent-social/asp-log";
import { main, setClock, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
function start(args: string[], env: Record<string, string> = {}) {
  const server = spawn(process.execPath, [cli, "serve", ...args], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } });
  let buf = "";
  const ready = new Promise<string>((resolve, reject) => {
    server.stdout.on("data", (d) => { buf += d; const m = /listening on (http:\/\/[^ ]+)/.exec(buf); if (m) resolve(m[1]); });
    server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
    setTimeout(() => reject(new Error(`no start line: ${buf}`)), 30_000);
  });
  return { ready, out: () => buf, stop: () => server.kill() };
}

test("DK1714: a breach reported to the running service waits for the owner's keys, then one command quarantines the agent, records the incident and clears the report; the API refuses what it should", { timeout: 240_000 }, async () => {
  const f = makeFixture();
  mkdirSync(f.aspHome, { recursive: true });
  let clock = Date.parse("2026-11-22T10:00:00Z");
  setClock(() => new Date(clock));
  const call = async (args: string[], extra: Record<string, string> = {}, expect = 0) => {
    clock += 1000;
    const out: string[] = [], err: string[] = [];
    const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ...extra }, cwd: f.root } as Io);
    assert.equal(code, expect, `${args.join(" ")}: ${err.join(" ") || out.join(" ")}`);
    return out.join("\n");
  };
  const OP = "did:web:example.com:users:bs-operator", P = "did:web:example.com:users:bs-sponsor", A = "did:web:example.com:agents:bs-agent";
  for (const d of [OP, P, CLINIC_DID]) await call(["identity", "new", "--kind", "human", "--did", d]);
  await call(["identity", "new", "--kind", "agent", "--did", A, "--sponsor", P, "--purpose", "work"]);
  setClock(undefined);

  const dir = mkdtempSync(join(tmpdir(), "asp-breach-service-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([{ name: "ops", role: "admin", tokenSha256: hashToken("tok-ops") }, { name: "tenant", role: "tenant", tokenSha256: hashToken("tok-tenant") }]));
  const svc = start(["--db", `local:${f.aspHome}`, "--tokens", tokens, "--port", "0"], { ASP_OPERATOR_DID: OP });
  try {
    const url = await svc.ready;
    const api = (token: string, method: string, path: string, body?: unknown) => fetch(`${url}${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    assert.equal((await api("tok-tenant", "POST", "/admin/breach", { agent: A, cause: "loop", summary: "x" })).status, 403, "a tenant's token is refused");
    assert.equal((await api("tok-ops", "POST", "/admin/breach", { agent: A, cause: "boredom", summary: "x" })).status, 400, "an unknown cause");
    assert.equal((await api("tok-ops", "POST", "/admin/breach", { agent: "nonsense", cause: "loop", summary: "x" })).status, 400, "not a did");
    assert.equal((await api("tok-ops", "POST", "/admin/breach", { agent: A, cause: "loop", summary: "x", fleet: "did:web:f" })).status, 400, "a fleet without a node");
    assert.equal((await call(["breach", "respond", "--from-service", "--by", OP], { ASP_LOG_URL: url, ASP_LOG_TOKEN: "tok-ops" })), "no breach is waiting");
    const rep = await api("tok-ops", "POST", "/admin/breach", { agent: A, cause: "exfiltration", summary: "sent a file to an unknown host" });
    assert.equal(rep.status, 200);
    const reported = (await rep.json()) as { at: string };
    assert.equal((await api("tok-ops", "POST", "/admin/breach", { agent: A, cause: "loop", summary: "again" })).status, 409, "one open report for each agent");
    const pend = (await (await api("tok-ops", "GET", "/admin/breach-pending")).json()) as { pending: { agent: string; cause: string }[] };
    assert.deepEqual(pend.pending.map((p) => [p.agent, p.cause]), [[A, "exfiltration"]]);
    assert.match(readFileSync(`${tokens}.admin-audit.jsonl`, "utf8"), /breach_reported/);

    const out = await call(["breach", "respond", "--from-service", "--by", OP], { ASP_LOG_URL: url, ASP_LOG_TOKEN: "tok-ops" });
    assert.match(out, /ALERT to sponsor/);
    assert.match(out, /ALERT to operator/);
    assert.ok(out.includes(`breach response for ${A} done in `), out);
    assert.ok(out.includes(` s from ${reported.at}: quarantine, alert_sponsor, alert_operator, restitution_opened; incident sha256:`), "the response is measured from the time the service was told");
    assert.equal(((await (await api("tok-ops", "GET", "/admin/breach-pending")).json()) as { pending: unknown[] }).pending.length, 0, "the report is cleared once answered");
    assert.ok(existsSync(`${tokens}.breach-pending.json`));
    assert.match(readFileSync(`${tokens}.admin-audit.jsonl`, "utf8"), /breach_ack/);
  } catch (e) { throw new Error(`${(e as Error).message}\n--- service output ---\n${svc.out()}`); } finally { svc.stop(); }
});
