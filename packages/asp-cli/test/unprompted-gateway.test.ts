// Row DK1232 (spec-delta S1606), the gateway half: a run that no person's prompt started (a wake, a schedule or a hook) is marked unprompted in the Action it files, and is refused at the start when the Mandate does not
// allow unprompted work; a run with a prompt is untouched. `asp live report` prints the share. Fake agent and provider; fake keys.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync } from "node:fs";
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

/** A model provider whose every reply uses 10 tokens. */
async function provider() {
  const server = createServer(async (req, res) => {
    for await (const _ of req) { /* drain */ }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "c1", object: "chat.completion", created: 1, model: "m", usage: { prompt_tokens: 7, completion_tokens: 3 },
      choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "a", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "notes.txt" }) } }] } }],
    }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
}

const AGENT = `
const r = await fetch(process.env.OPENAI_BASE_URL + "/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer x" }, body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "go" }] }) });
await r.json();
`;
const gw = (f: Fixture, contract: string, upstream: string, extra: string[] = []) =>
  asp(f, ["gateway", "--contract", contract, "--by", CODER, "--openai-upstream", upstream, ...extra, "--", process.execPath, "--input-type=module", "-e", AGENT]);


async function actionsOf(f: Fixture, contract: string) {
  const { openLog } = await import("@agent-social/asp-package");
  const lg = (await openLog(f.aspHome, {})).log;
  return (await lg.recordsOfTypes(["action"])) as unknown as { body: { contract: string; unprompted?: boolean } }[];
}

test("a wake without the Mandate's leave is refused at the start, with the way to allow it; a wake with leave files Actions marked unprompted and the report prints the share", async () => {
  const f = makeFixture();
  const closed = await runningContract(f, ["repo.read"]);
  const upstream = await provider();
  const refused = await gw(f, closed, upstream, ["--woken-by", "did:web:example.com:cron"]);
  assert.notEqual(refused.code, 0);
  assert.match(refused.err, /not started by a person's prompt.*does not allow unprompted work.*--allow-unprompted/);
  assert.equal((await actionsOf(f, closed)).length, 0, "nothing was filed");

  const g = makeFixture();
  const open = await runningContract(g, ["repo.read"], ["--allow-unprompted", "--unprompted-cap", "5"]);
  const ok1 = await gw(g, open, upstream, ["--woken-by", "did:web:example.com:cron"]);
  assert.equal(ok1.code, 0, ok1.err);
  assert.match(ok1.err, /unprompted\s+this run was not started by a person's prompt/);
  const acts = (await actionsOf(g, open)).filter((a) => a.body.contract === open);
  assert.ok(acts.length >= 1 && acts.every((a) => a.body.unprompted === true), "every Action of the wake is marked");
  // a run with a person's prompt (no wake signal) is a prompted Action: not marked
  const prompted = await gw(g, open, upstream);
  assert.equal(prompted.code, 0, prompted.err);
  const all = (await actionsOf(g, open)).filter((a) => a.body.contract === open);
  assert.ok(all.some((a) => a.body.unprompted !== true), "the prompted run's Action carries no flag");
});

test("the run report prints the unprompted share, and says it is self-reported where the caller gives no signal", async () => {
  const { buildReport, printReport } = await import("../src/live-cmd.ts");
  const base = { session: { sid: "s", runtime: "claude-code", agent: "a", me: "m", bank: "b", at: "t", purpose: "p", scopes: [], hosts: [], contract: "c" } };
  const lines: string[] = [];
  printReport(buildReport({ ...base, unprompted: { actions: 4, unprompted: 1, permille: 250 } }), (l) => lines.push(l));
  assert.ok(lines.some((l) => /unprompted\s+1 of 4 Action\(s\) of the job \(25\.0%\) were not started by a person's prompt.*self-reported/.test(l)), lines.join(" | "));
  const none: string[] = [];
  printReport(buildReport(base), (l) => none.push(l));
  assert.ok(!none.some((l) => /unprompted/.test(l)), "no line when the log gave no share");
});

test("the environment signal ASP_UNPROMPTED=1 counts like a wake, and --allow-unprompted/--unprompted-cap refuse nonsense", async () => {
  const f = makeFixture();
  const contract = await runningContract(f, ["repo.read"], ["--allow-unprompted"]);
  const upstream = await provider();
  const r = await asp(f, ["gateway", "--contract", contract, "--by", CODER, "--openai-upstream", upstream, "--", process.execPath, "--input-type=module", "-e", AGENT], { ASP_UNPROMPTED: "1" });
  assert.equal(r.code, 0, r.err);
  assert.ok((await actionsOf(f, contract)).some((a) => a.body.unprompted === true));
  const bad = await asp(f, ["market", "mandate", "--contract", contract, "--principal", ALICE, "--performer", CODER, "--scopes", "repo.read", "--unprompted-cap", "5"]);
  assert.notEqual(bad.code, 0);
  assert.match(bad.err + bad.out, /--unprompted-cap needs --allow-unprompted/);
});
