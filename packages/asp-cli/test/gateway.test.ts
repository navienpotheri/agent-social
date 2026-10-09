import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const ALICE = "did:web:example.com:users:alice";
const CODER = "did:web:example.com:agents:coder";
const BANK = "did:web:example.com:bank";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });

async function asp(f: Fixture, args: string[], env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ...env }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };

async function runningContract(f: Fixture, scopes: string[]) {
  await ok(f, ["identity", "new", "--kind", "human", "--did", ALICE]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Fix the flaky test"]);
  await ok(f, ["identity", "new", "--kind", "human", "--did", BANK]);
  await ok(f, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await ok(f, ["credits", "grant", "--to", CODER, "--amount", "200"]);
  const intent = /^intent (\S+)/.exec((await ok(f, ["market", "intent", "--by", ALICE, "--purpose", "Fix it", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z"])).out)![1];
  const offer = /^offer (\S+)/.exec((await ok(f, ["market", "offer", "--by", CODER, "--intent", intent, "--price", "1000", "--plan", "fix", "--eta", "2026-11-01T00:00:00Z"])).out)![1];
  const contract = /^contract (\S+):/.exec((await ok(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1];
  await ok(f, ["market", "bond", "--contract", contract, "--backer", CODER, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
  await ok(f, ["market", "mandate", "--contract", contract, "--principal", ALICE, "--performer", CODER, ...scopes.flatMap((s) => ["--scopes", s])]);
  return contract;
}

/** A model provider that always asks for one allowed and one disallowed tool call. */
async function provider() {
  const server = createServer(async (req, res) => {
    for await (const _ of req) { /* drain */ }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "c1", object: "chat.completion", created: 1, model: "m", usage: { prompt_tokens: 7, completion_tokens: 3 },
      choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [
        { id: "a", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "notes.txt" }) } },
        { id: "b", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: "git push origin main" }) } },
      ] } }],
    }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
}

// A stand-in agent: any program that calls an OpenAI-compatible API at OPENAI_BASE_URL and reports which tool calls it was given.
const AGENT = `
const r = await fetch(process.env.OPENAI_BASE_URL + "/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer x" }, body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "go" }] }) });
const j = await r.json();
const m = j.choices[0].message;
console.log("AGENT GOT:" + JSON.stringify((m.tool_calls ?? []).map((t) => t.function.name)));
console.log("AGENT SAW:" + (m.content ?? ""));
`;

test("asp gateway: any command runs under the Mandate; the disallowed call never reaches it and the Action records the facts", async () => {
  const f = makeFixture();
  const contract = await runningContract(f, ["repo.read"]);
  const upstream = await provider();
  const run = await asp(f, ["gateway", "--contract", contract, "--by", CODER, "--openai-upstream", upstream, "--", process.execPath, "--input-type=module", "-e", AGENT]);
  assert.equal(run.code, 0, run.err);
  assert.match(run.err, /allowed {2}read_file -> repo\.read/);
  assert.match(run.err, /REFUSED {2}bash -> repo\.push: the scope repo\.push is not granted/);
  // The stand-in agent's own output goes straight to the terminal, not through io; the Action in the log is the evidence.
  const verify = await ok(f, ["log", "verify"]);
  assert.match(verify.out, /log ok/);

  // The Action carries what happened: repo.read used, one blocked repo.push attempt.
  const { LocalLog } = await import("@agent-social/asp-package");
  const local = await LocalLog.open(f.aspHome);
  const action = (await local.log.since(0, 500)).filter((x) => x.record.type === "asp.action/v0.2").at(-1)!.record.body as any;
  assert.deepEqual(action.scopes_used, ["repo.read"]);
  assert.deepEqual(action.blocked_attempts, [{ scope: "repo.push", count: 1 }]);
  assert.match(action.summary, /ASP gateway/);
});

test("asp gateway refuses a contract that is not running, and needs an upstream", async () => {
  const f = makeFixture();
  const missing = await asp(f, ["gateway", "--contract", "sha256:" + "0".repeat(64), "--by", CODER, "--openai-upstream", "http://127.0.0.1:1/v1", "--", process.execPath, "-e", "0"]);
  assert.notEqual(missing.code, 0);
  assert.match(missing.err, /not Running|not in the log/);
  const none = await asp(f, ["gateway", "--contract", "x", "--by", CODER, "--", process.execPath, "-e", "0"]);
  assert.equal(none.code, 2);
});
