import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttp } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { connectionProblem, main, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

const fakeClaude = fileURLToPath(new URL("./fake-claude-gateway.mjs", import.meta.url));

async function asp(home: string, args: string[], env: Record<string, string> = {}) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home, ...env }, cwd: home, raw: (b) => out.push(b.toString("utf8").trimEnd()) } as Io;
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

// Found in preparing for a developer conference: with no wifi, `asp run` was a dead end, and `asp account show` said only "error: fetch failed".
test("a connection failure says so and what still works; a bare 'fetch failed' is never all a person sees", () => {
  const dead = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
  const msg = connectionProblem(dead, "https://log.example.org")!;
  assert.match(msg, /cannot reach the service at https:\/\/log\.example\.org/);
  assert.match(msg, /may be down/);
  assert.match(msg, /asp run --local/);
  assert.match(connectionProblem(Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }))!, /address could not be found/);
  assert.match(connectionProblem(Object.assign(new TypeError("fetch failed"), { cause: { code: "ETIMEDOUT" } }))!, /did not answer in time/);
  assert.match(connectionProblem(new TypeError("fetch failed"))!, /check your connection/);
  assert.equal(connectionProblem(new Error("the passphrase is wrong")), undefined, "other errors are left alone");
});

test("asp run --local: the same governed session with no service and no account, records only on this machine; a saved login that cannot be reached does not matter", async () => {
  const upstream = createHttp(async (req, res) => {
    for await (const _ of req) { /* not inspected */ }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "msg", type: "message", role: "assistant", model: "m", stop_reason: "tool_use", usage: { input_tokens: 3, output_tokens: 2 }, content: [{ type: "text", text: "Fetching." }, { type: "tool_use", id: "tu_1", name: "Bash", input: { command: "curl -s https://example.com" } }] }));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const upUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  try {
    const f = makeFixture();
    const project = join(f.root, "project"); mkdirSync(project, { recursive: true });
    mkdirSync(f.aspHome, { recursive: true });
    // A saved login whose service is dead: the venue with no wifi.
    writeFileSync(join(f.aspHome, "config.json"), JSON.stringify({ service: "http://127.0.0.1:9", token: "t", tenant: "ada", joinedAt: "2026-10-13T00:00:00Z", identities: { me: "did:web:x:u:ada", agent: "did:web:x:a:ada:my-agent", bank: "did:web:x:u:ada:bank" } }));
    const env = { ASP_CLAUDE_BIN: process.execPath, ASP_CLAUDE_SCRIPT: fakeClaude, ASP_RUN_ANTHROPIC_UPSTREAM: upUrl };

    // The hosted run cannot work, and says why.
    const hosted = await asp(f.aspHome, ["run", "claude-code", "--prompt", "x", "--project", project], env);
    assert.equal(hosted.code, 1);
    assert.match(hosted.err, /cannot reach the (log )?service at http:\/\/127\.0\.0\.1:9/);
    const acct = await asp(f.aspHome, ["account", "show"], env);
    assert.match(acct.err, /cannot reach the service at http:\/\/127\.0\.0\.1:9/, "no bare 'fetch failed'");

    // An old ASP_LOG_URL / ASP_LOG_TOKEN left in the shell overrides the saved login: said, by name, with no token printed (found in the owner's walkthrough, where `account export` acted as another account).
    const overridden = await asp(f.aspHome, ["account", "show"], { ASP_LOG_URL: "http://127.0.0.1:1", ASP_LOG_TOKEN: "secret-token-abc" });
    assert.match(overridden.err, /note: ASP_LOG_URL and ASP_LOG_TOKEN are set in this shell and override the login saved for ada, so this command acts as the account they name, not ada\. To use the saved login: unset ASP_LOG_URL ASP_LOG_TOKEN/);
    assert.ok(!(overridden.err + overridden.out).includes("secret-token-abc"), "the token is never printed");
    assert.doesNotMatch((await asp(f.aspHome, ["status"], env)).err, /note: ASP_LOG_URL/, "no note when nothing overrides the saved login");

    // The local run works: a refusal under a Mandate, local identities, local records.
    const local = await asp(f.aspHome, ["run", "claude-code", "--local", "--prompt", "Fetch it", "--project", project], env);
    assert.equal(local.code, 0, local.err + local.out);
    assert.match(local.err, /local mode: made local identities on this machine/);
    assert.match(local.out, /Session summary[\s\S]*finished/);
    assert.match(local.out, /refused\s+Bash -> shell\.network/);
    // A local session has no ledger (no service, no account), so its summary has no credits line; one with a service shows credits in every summary (run-quota-full.test.ts).
    assert.doesNotMatch(local.out + "\n" + local.err, /credit/i, "a local session has nothing to say about credits");
    // A refusal says what to do next, with the host the command used (a newcomer is stuck without it, UC-137).
    assert.match(local.out, /to allow {2}this session has no network\. To let it reach a host, name it:\n {12}asp run claude-code --allow-network example\.com --prompt/);
    assert.ok(!/tool_use:Bash/.test(local.out), "the call never reached the agent");
    const lhome = join(f.aspHome, "local");
    assert.ok(existsSync(join(lhome, "keys")) && existsSync(join(lhome, "local-identities.json")));
    assert.match((await asp(lhome, ["runs"])).out, /claude-code\s+ended\s+1 calls, 1 refused/);
    // The session id that `asp runs` prints opens that session's run log (a person tries exactly that, not a file path).
    const sid = /session\s+([0-9a-f]{8})\s+finished/.exec(local.out)![1];
    const shown = await asp(lhome, ["run-log", "show", sid]);
    assert.equal(shown.code, 0, shown.err);
    assert.match(shown.out, /tool_call\s+REFUSED Bash/i);    // A second local run reuses the identities and the standing job; the hosted login file is untouched.
    const ids1 = readFileSync(join(lhome, "local-identities.json"), "utf8");
    const again = await asp(f.aspHome, ["run", "claude-code", "--local", "--prompt", "Again", "--project", project], env);
    assert.equal(again.code, 0, again.err);
    assert.doesNotMatch(again.err, /made local identities/);
    assert.equal(readFileSync(join(lhome, "local-identities.json"), "utf8"), ids1);
    assert.match(again.err, /standing job, session 2/);
    assert.equal(JSON.parse(readFileSync(join(f.aspHome, "config.json"), "utf8")).service, "http://127.0.0.1:9");
    // Not combined with what needs an account.
    assert.equal((await asp(f.aspHome, ["run", "claude-code", "--local", "--agent", "helper", "--prompt", "x"], env)).code, 2);
    assert.equal((await asp(f.aspHome, ["run", "claude-code", "--local", "--headless", "--contract", "c", "--prompt", "x"], env)).code, 2);
  } finally { upstream.close(); }
});
