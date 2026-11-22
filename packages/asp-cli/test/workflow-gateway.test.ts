// Row DK1209 (spec-delta S1607), the gateway half, opt-in: a Mandate that carries a workflow clause makes `asp gateway` check a run that says it is a step (--workflow-step <from>:<to> or ASP_WORKFLOW_STEP) against the
// clause and the job's state before it starts, file the Action with `workflow_step`, and run nothing more once the job is in a terminal state. A Mandate with no clause, or a run that names no step, is unchanged.
// What the gateway cannot know is which step a run is: that is the caller's word. Fake agent and provider; fake keys.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const ALICE = "did:web:example.com:users:alice";
const CODER = "did:web:example.com:agents:coder";
const BANK = "did:web:example.com:bank";
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });

async function asp(f: Fixture, args: string[], env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ...env }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };

async function runningContract(f: Fixture, extra: string[] = []) {
  await ok(f, ["identity", "new", "--kind", "human", "--did", ALICE]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Fix the flaky test"]);
  await ok(f, ["identity", "new", "--kind", "human", "--did", BANK]);
  await ok(f, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await ok(f, ["credits", "grant", "--to", CODER, "--amount", "200"]);
  const intent = /^intent (\S+)/.exec((await ok(f, ["market", "intent", "--by", ALICE, "--purpose", "Fix it", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z"])).out)![1];
  const offer = /^offer (\S+)/.exec((await ok(f, ["market", "offer", "--by", CODER, "--intent", intent, "--price", "1000", "--plan", "fix", "--eta", "2026-11-01T00:00:00Z"])).out)![1];
  const contract = /^contract (\S+):/.exec((await ok(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1];
  await ok(f, ["market", "bond", "--contract", contract, "--backer", CODER, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
  await ok(f, ["market", "mandate", "--contract", contract, "--principal", ALICE, "--performer", CODER, "--scopes", "repo.read", ...extra]);
  return contract;
}

async function provider() {
  const server = createServer(async (req, res) => {
    for await (const _ of req) { /* drain */ }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "c1", object: "chat.completion", created: 1, model: "m", usage: { prompt_tokens: 7, completion_tokens: 3 }, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "ok" } }] }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
}
const AGENT = `const r = await fetch(process.env.OPENAI_BASE_URL + "/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer x" }, body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "go" }] }) }); await r.json();`;
const gw = (f: Fixture, contract: string, upstream: string, extra: string[] = [], env: NodeJS.ProcessEnv = {}) =>
  asp(f, ["gateway", "--contract", contract, "--by", CODER, "--openai-upstream", upstream, ...extra, "--", process.execPath, "--input-type=module", "-e", AGENT], env);

async function actionsOf(f: Fixture) {
  const { openLog } = await import("@agent-social/asp-package");
  const lg = (await openLog(f.aspHome, {})).log;
  return (await lg.recordsOfTypes(["action"])) as unknown as { body: { contract: string; workflow_step?: { from: string; to: string } } }[];
}
const CLAUSE = { states: ["draft", "review", "done"], start: "draft", transitions: [{ from: "draft", to: "review" }, { from: "review", to: "done" }], terminal: ["done"] };

test("a step is checked against the clause and the job's state, the Action reports it, and a terminal state ends the runs", async () => {
  const f = makeFixture();
  const file = join(f.root, "wf.json");
  writeFileSync(file, JSON.stringify(CLAUSE));
  const c = await runningContract(f, ["--workflow", file]);
  const up = await provider();

  const bad = await gw(f, c, up, ["--workflow-step", "draft:done"]);
  assert.notEqual(bad.code, 0);
  assert.match(bad.err, /does not allow the step draft to done.*workflow_bad_transition.*allowed from draft: review/);

  const first = await gw(f, c, up, ["--workflow-step", "draft:review"]);
  assert.equal(first.code, 0, first.err);
  assert.match(first.err, /workflow\s+this run is the step draft to review/);
  const acts = (await actionsOf(f)).filter((a) => a.body.contract === c);
  assert.deepEqual(acts.at(-1)!.body.workflow_step, { from: "draft", to: "review" });

  const again = await gw(f, c, up, [], { ASP_WORKFLOW_STEP: "draft:review" });
  assert.notEqual(again.code, 0);
  assert.match(again.err, /a step from draft, and the job is in the state review.*workflow_wrong_state/);

  const last = await gw(f, c, up, [], { ASP_WORKFLOW_STEP: "review:done" });
  assert.equal(last.code, 0, last.err);
  const after = await gw(f, c, up, []);
  assert.notEqual(after.code, 0);
  assert.match(after.err, /workflow is in a terminal state \(done\)/);
});

test("a run that names no step on a Mandate with a clause is unchanged and files no step; a step on a Mandate with no clause is refused; a bad label is a usage error", async () => {
  const f = makeFixture();
  const file = join(f.root, "wf.json");
  writeFileSync(file, JSON.stringify(CLAUSE));
  const c = await runningContract(f, ["--workflow", file]);
  const up = await provider();
  const plain = await gw(f, c, up);
  assert.equal(plain.code, 0, plain.err);
  assert.ok((await actionsOf(f)).filter((a) => a.body.contract === c).every((a) => a.body.workflow_step === undefined));
  const label = await gw(f, c, up, ["--workflow-step", "Draft:Review"]);
  assert.notEqual(label.code, 0);
  assert.match(label.err, /--workflow-step is <from>:<to>/);

  const g = makeFixture();
  const c2 = await runningContract(g);
  const none = await gw(g, c2, up, ["--workflow-step", "draft:review"]);
  assert.notEqual(none.code, 0);
  assert.match(none.err, /no workflow clause.*workflow_not_in_mandate/);
  const envOnly = await gw(g, c2, up, [], { ASP_WORKFLOW_STEP: "draft:review" });
  assert.equal(envOnly.code, 0, "the environment alone is ignored on a Mandate with no clause: " + envOnly.err);
  assert.match(envOnly.err, /ASP_WORKFLOW_STEP is set and this Mandate has no workflow clause/);
  assert.ok((await actionsOf(g)).filter((x) => x.body.contract === c2).every((x) => x.body.workflow_step === undefined));
  const ok2 = await gw(g, c2, up);
  assert.equal(ok2.code, 0, "no clause, no step: the evening path");
});

test("asp action --workflow-step and --undoes say their value and refuse a malformed one", async () => {
  const f = makeFixture();
  const c = await runningContract(f);
  const badStep = await asp(f, ["market", "action", "--contract", c, "--by", CODER, "--workflow-step", "x"]);
  assert.notEqual(badStep.code, 0);
  assert.match(badStep.err, /--workflow-step is <from>:<to>/);
  const badUndo = await asp(f, ["market", "action", "--contract", c, "--by", CODER, "--undoes", "not-an-id"]);
  assert.notEqual(badUndo.code, 0);
  assert.match(badUndo.err, /--undoes is the record id/);
});

test("DK1227: a Mandate with action classes and a cool-off lets the performer undo a reversible Action with --undoes; the log refuses an undo of an irreversible scope, a second undo, and a Mandate with no cool-off", async () => {
  const f = makeFixture();
  const c = await runningContract(f, ["--scopes", "repo.write", "--irreversible-scopes", "repo.push", "--cool-off-seconds", "3600"]);
  const act = async (scopes: string[], extra: string[] = []) => asp(f, ["market", "action", "--contract", c, "--by", CODER, ...scopes.flatMap((s) => ["--scopes-used", s]), ...extra]);
  const idOf = (r: { out: string }) => /^action (sha256:[0-9a-f]{64})/.exec(r.out)![1];
  const first = await act(["repo.read"]);
  assert.equal(first.code, 0, first.err + first.out);
  const undo = await act(["repo.read"], ["--undoes", idOf(first)]);
  assert.equal(undo.code, 0, undo.err + undo.out);
  const twice = await act(["repo.write"], ["--undoes", idOf(first)]);
  assert.notEqual(twice.code, 0);
  assert.match(twice.err, /undo_done|undone already/);
  // an irreversible scope: the Mandate lists repo.push as irreversible, but the Mandate must grant it to use it; the undo of an Action that used it is refused
  const g = makeFixture();
  const c2 = await runningContract(g, ["--scopes", "repo.push", "--irreversible-scopes", "repo.push", "--cool-off-seconds", "3600"]);
  const act2 = (scopes: string[], extra: string[] = []) => asp(g, ["market", "action", "--contract", c2, "--by", CODER, ...scopes.flatMap((s) => ["--scopes-used", s]), ...extra]);
  const pushed = await act2(["repo.push"]);
  assert.equal(pushed.code, 0, pushed.err + pushed.out);
  const undoPush = await act2(["repo.push"], ["--undoes", idOf(pushed)]);
  assert.notEqual(undoPush.code, 0);
  assert.match(undoPush.err, /undo_irreversible|irreversible scope/);
  // no cool-off on the Mandate: nothing may be undone
  const h = makeFixture();
  const c3 = await runningContract(h);
  const a3 = await asp(h, ["market", "action", "--contract", c3, "--by", CODER, "--scopes-used", "repo.read"]);
  const undo3 = await asp(h, ["market", "action", "--contract", c3, "--by", CODER, "--scopes-used", "repo.read", "--undoes", /^action (sha256:[0-9a-f]{64})/.exec(a3.out)![1]]);
  assert.notEqual(undo3.code, 0);
  assert.match(undo3.err, /undo_not_allowed|no cool-off/);
  // the cool-off bounds are exact: 1 and 604800 seconds are taken, 0 and 604801 are not
  const tryCool = async (secs: string) => {
    const x = makeFixture();
    await ok(x, ["identity", "new", "--kind", "human", "--did", ALICE]);
    await ok(x, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Fix the flaky test"]);
    await ok(x, ["identity", "new", "--kind", "human", "--did", BANK]);
    await ok(x, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
    await ok(x, ["credits", "grant", "--to", CODER, "--amount", "200"]);
    const intent = /^intent (\S+)/.exec((await ok(x, ["market", "intent", "--by", ALICE, "--purpose", "Fix it", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z"])).out)![1];
    const offer = /^offer (\S+)/.exec((await ok(x, ["market", "offer", "--by", CODER, "--intent", intent, "--price", "1000", "--plan", "fix", "--eta", "2026-11-01T00:00:00Z"])).out)![1];
    const contract = /^contract (\S+):/.exec((await ok(x, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1];
    await ok(x, ["market", "bond", "--contract", contract, "--backer", CODER, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
    return asp(x, ["market", "mandate", "--contract", contract, "--principal", ALICE, "--performer", CODER, "--scopes", "repo.read", "--cool-off-seconds", secs]);
  };
  for (const good of ["1", "604800"]) { const r = await tryCool(good); assert.equal(r.code, 0, good + ": " + r.err); }
  for (const bad of ["0", "604801", "abc"]) { const r = await tryCool(bad); assert.notEqual(r.code, 0, bad); assert.match(r.err, /--cool-off-seconds is a whole number of seconds, 1 to 604800/, bad); }
});
