// DK211: `asp gateway --ladder-file <path>` applies the ladder step the operator or the watcher wrote for the agent, at the agent's next call: no file is no step, quarantine refuses a shell call with the step named,
// an unreadable file is read as tighten (which holds the call, and with no way to ask refuses it), and lifting the file lets the next run through. Fake agent and provider; fake keys.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const ALICE = "did:web:example.com:users:alice";
const CODER = "did:web:example.com:agents:coder";
const BANK = "did:web:example.com:bank";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };

async function runningContract(f: Fixture) {
  await ok(f, ["identity", "new", "--kind", "human", "--did", ALICE]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Fix the flaky test"]);
  await ok(f, ["identity", "new", "--kind", "human", "--did", BANK]);
  await ok(f, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await ok(f, ["credits", "grant", "--to", CODER, "--amount", "200"]);
  const intent = /^intent (\S+)/.exec((await ok(f, ["market", "intent", "--by", ALICE, "--purpose", "Fix it", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z"])).out)![1];
  const offer = /^offer (\S+)/.exec((await ok(f, ["market", "offer", "--by", CODER, "--intent", intent, "--price", "1000", "--plan", "fix", "--eta", "2026-11-01T00:00:00Z"])).out)![1];
  const contract = /^contract (\S+):/.exec((await ok(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1];
  await ok(f, ["market", "bond", "--contract", contract, "--backer", CODER, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
  await ok(f, ["market", "mandate", "--contract", contract, "--principal", ALICE, "--performer", CODER, "--scopes", "repo.read", "--scopes", "shell.exec"]);
  return contract;
}

/** A model provider whose every reply asks to run a shell command. */
async function provider() {
  const server = createServer(async (req, res) => {
    for await (const _ of req) { /* drain */ }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "c1", object: "chat.completion", created: 1, model: "m", usage: { prompt_tokens: 7, completion_tokens: 3 }, choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "a", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: "node build.js" }) } }] } }] }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
}

/** The agent asks once and prints what came back: the number of tool calls, or the refusal text. */
const AGENT = `
const r = await fetch(process.env.OPENAI_BASE_URL + "/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer x" }, body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "go" }] }) });
const m = (await r.json()).choices[0].message;
import("node:fs").then((fs) => fs.writeFileSync("agent-out.txt", m.tool_calls ? "TOOL_CALLS " + m.tool_calls.length : "TEXT " + m.content));
`;
/** One run: the agent writes what it got back to a file, which is read here. */
const gw = async (f: Fixture, contract: string, upstream: string, extra: string[]) => {
  rmSync(join(f.root, "agent-out.txt"), { force: true });
  const r = await run(f, contract, upstream, extra);
  let said = ""; try { said = readFileSync(join(f.root, "agent-out.txt"), "utf8"); } catch { /* the agent did not get to write */ }
  return { ...r, out: said };
};
const run = (f: Fixture, contract: string, upstream: string, extra: string[]) => asp(f, ["gateway", "--contract", contract, "--by", CODER, "--openai-upstream", upstream, ...extra, "--", process.execPath, "--input-type=module", "-e", AGENT]);

test("DK211: --ladder-file: no file is no step; quarantine refuses the shell call with the step named; an unreadable file is tighten and, with no way to ask, refuses it; a lifted file lets the call through", async () => {
  const f = makeFixture();
  const contract = await runningContract(f);
  const upstream = await provider();
  const file = join(f.root, "ladder.json");
  const none = await gw(f, contract, upstream, ["--ladder-file", file]);
  assert.equal(none.code, 0, none.err);
  assert.match(none.out, /TOOL_CALLS 1/, "no file: the call goes through");
  writeFileSync(file, JSON.stringify({ step: "quarantine", why: "found by the watcher" }));
  const q = await gw(f, contract, upstream, ["--ladder-file", file]);
  assert.match(q.out, /TEXT .*stands on the ladder at "quarantine"/, q.out + q.err);
  writeFileSync(file, '{"step": "quar');
  const bad = await gw(f, contract, upstream, ["--ladder-file", file]);
  assert.match(bad.out, /TEXT .*ladder at "tighten".*(cannot ask for it|approval)/, "an unreadable file is read as tighten: " + bad.out);
  writeFileSync(file, JSON.stringify({ step: "none" }));
  const lifted = await gw(f, contract, upstream, ["--ladder-file", file]);
  assert.match(lifted.out, /TOOL_CALLS 1/, "lifted: the call goes through");
  const without = await gw(f, contract, upstream, []);
  assert.match(without.out, /TOOL_CALLS 1/, "without the flag the ladder is not consulted");
});
