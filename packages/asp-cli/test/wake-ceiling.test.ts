import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

async function runningContract(f: Fixture, scopes: string[], extra: string[] = []) {
  await ok(f, ["identity", "new", "--kind", "human", "--did", ALICE]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Fix the flaky test"]);
  await ok(f, ["identity", "new", "--kind", "human", "--did", BANK]);
  await ok(f, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await ok(f, ["credits", "grant", "--to", CODER, "--amount", "200"]);
  const intent = /^intent (\S+)/.exec((await ok(f, ["market", "intent", "--by", ALICE, "--purpose", "Fix it", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z"])).out)![1];
  const offer = /^offer (\S+)/.exec((await ok(f, ["market", "offer", "--by", CODER, "--intent", intent, "--price", "1000", "--plan", "fix", "--eta", "2026-11-01T00:00:00Z"])).out)![1];
  const contract = /^contract (\S+):/.exec((await ok(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1];
  await ok(f, ["market", "bond", "--contract", contract, "--backer", CODER, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
  await ok(f, ["market", "mandate", "--contract", contract, "--principal", ALICE, "--performer", CODER, ...scopes.flatMap((s) => ["--scopes", s]), ...extra]);
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


test("DK8 done: an agent woken again and again stops at its daily token ceiling, with a refusal that names the ceiling; the next day it runs again", async () => {
  const f = makeFixture();
  const contract = await runningContract(f, ["repo.read"]);
  const upstream = await provider();
  const results: { code: number; err: string }[] = [];
  for (let i = 0; i < 4; i++) results.push(await asp(f, ["gateway", "--contract", contract, "--by", CODER, "--openai-upstream", upstream, "--daily-tokens", "25", "--woken-by", "did:web:example.com:agents:pinger", "--", process.execPath, "--input-type=module", "-e", AGENT]));
  // Each run spends 10 tokens: three wakes run (10, 20, 30: the third starts with 5 left and is capped), the fourth is refused.
  assert.deepEqual(results.slice(0, 3).map((r) => r.code), [0, 0, 0], "the first three wakes run");
  assert.notEqual(results[3].code, 0, "the fourth wake does not run");
  assert.match(results[3].err, /daily token ceiling for did:web:example\.com:agents:coder is 25 and \d+ are spent today/);
  assert.match(results[3].err, /woken by did:web:example\.com:agents:pinger/);
  assert.match(results[3].err, /raise it with --daily-tokens/);
  // The report says who woke whom and which ceiling stopped it.
  const report = await ok(f, ["wakes", "--agent", CODER]);
  assert.match(report.out, /3 wake\(s\), \d+ tokens, 1 refused \(daily_tokens\); woken by did:web:example\.com:agents:pinger x3/);
});

test("CY14: a daily wake ceiling and a per-sender ceiling refuse a wake with the ceiling named, one sender cannot use up another's wakes, and the report shows who woke whom", async () => {
  const f = makeFixture();
  const contract = await runningContract(f, ["repo.read"]);
  const upstream = await provider();
  const run = (sender: string, extra: string[]) => asp(f, ["gateway", "--contract", contract, "--by", CODER, "--openai-upstream", upstream, "--woken-by", sender, ...extra, "--", process.execPath, "--input-type=module", "-e", AGENT]);
  const A = "did:web:example.com:agents:chatty", B = "did:web:example.com:users:alice";
  assert.equal((await run(A, ["--sender-wakes", "2", "--daily-wakes", "4"])).code, 0);
  assert.equal((await run(A, ["--sender-wakes", "2", "--daily-wakes", "4"])).code, 0);
  const third = await run(A, ["--sender-wakes", "2", "--daily-wakes", "4"]);
  assert.notEqual(third.code, 0);
  assert.match(third.err, /did:web:example\.com:agents:chatty has woken .* 2 times today.*ceiling for one sender \(2\).*other senders are not affected/);
  assert.equal((await run(B, ["--sender-wakes", "2", "--daily-wakes", "4"])).code, 0, "another sender is not affected by the first one's count");
  assert.equal((await run(B, ["--sender-wakes", "2", "--daily-wakes", "4"])).code, 0);
  const fifth = await run(B, ["--sender-wakes", "2", "--daily-wakes", "4"]);
  assert.notEqual(fifth.code, 0);
  assert.match(fifth.err, /daily wake ceiling for did:web:example\.com:agents:coder is 4 and it has been woken 4 times today/);
  const report = (await ok(f, ["wakes"])).out;
  assert.match(report, /4 wake\(s\), \d+ tokens, 2 refused \(sender_wakes, daily_wakes\); woken by did:web:example\.com:agents:chatty x2, did:web:example\.com:users:alice x2/);
  assert.equal((await asp(f, ["gateway", "--contract", contract, "--by", CODER, "--openai-upstream", upstream, "--daily-wakes", "0", "--", process.execPath, "-e", "0"])).code, 2, "a ceiling is a whole number, at least 1");
});
