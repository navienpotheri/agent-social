import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
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

async function runningContract(f: Fixture) {
  await ok(f, ["identity", "new", "--kind", "human", "--did", ALICE]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Fix the flaky test"]);
  await ok(f, ["identity", "new", "--kind", "human", "--did", BANK]);
  await ok(f, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await ok(f, ["credits", "grant", "--to", CODER, "--amount", "200"]);
  const intent = /^intent (\S+)/.exec((await ok(f, ["market", "intent", "--by", ALICE, "--purpose", "Fix the flaky test", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z"])).out)![1];
  const offer = /^offer (\S+)/.exec((await ok(f, ["market", "offer", "--by", CODER, "--intent", intent, "--price", "1000", "--plan", "fix", "--eta", "2026-11-01T00:00:00Z"])).out)![1];
  const contract = /^contract (\S+):/.exec((await ok(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1];
  await ok(f, ["market", "bond", "--contract", contract, "--backer", CODER, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
  await ok(f, ["market", "mandate", "--contract", contract, "--principal", ALICE, "--performer", CODER, "--scopes", "repo.read", "--scopes", "shell.exec", "--gate", "shell.exec", "--spend-cap", "50"]);
  return contract;
}

async function provider() {
  const server = createServer(async (req, res) => {
    for await (const _ of req) { /* drain */ }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "c1", object: "chat.completion", created: 1, model: "m", usage: { prompt_tokens: 7, completion_tokens: 3 },
      choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: "Reading the notes.", tool_calls: [
        { id: "a", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "notes.txt" }) } },
        { id: "b", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: "git push origin main" }) } },
      ] } }],
    }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
}

const AGENT = `
const r = await fetch(process.env.OPENAI_BASE_URL + "/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer x" }, body: JSON.stringify({ model: "tiny-model", messages: [{ role: "user", content: "read notes.txt" }] }) });
await r.json();
`;

test("asp mail: the end-of-Mandate mail has the highlights from the log and the run log; it is queued once, never sent", async () => {
  const f = makeFixture();
  const contract = await runningContract(f);
  // An approval that was asked for and given.
  await ok(f, ["market", "checkpoint", "--contract", contract, "--by", CODER, "--question", "May I run the migration?", "--summary", "npm run migrate"]);
  await ok(f, ["market", "resolve", "--contract", contract, "--by", ALICE, "--verdict", "approved"]);
  // A run through the gateway: one allowed call, one blocked attempt.
  const upstream = await provider();
  const run = await asp(f, ["gateway", "--contract", contract, "--by", CODER, "--openai-upstream", upstream, "--", process.execPath, "--input-type=module", "-e", AGENT]);
  assert.equal(run.code, 0, run.err);

  // Before it ends: a preview works, queueing does not.
  const early = await ok(f, ["mail", "preview", "--contract", contract]);
  assert.match(early.out, /Your agent's job is still running: Fix the flaky test/);
  const tooSoon = await asp(f, ["mail", "queue", "--contract", contract, "--to", "alice@example.com"]);
  assert.equal(tooSoon.code, 1);
  assert.match(tooSoon.err, /not ended/);
  assert.match((await ok(f, ["mail", "pending"])).out, /0 ended Mandate/);

  await ok(f, ["market", "deliver", "--contract", contract, "--by", CODER, "--summary", "Fixed it"]);
  await ok(f, ["market", "accept", "--contract", contract, "--by", ALICE]);
  await ok(f, ["market", "settle", "--contract", contract, "--bank", BANK, "--basis", "accepted", "--escrow-released", "950", "--bond-returned", "200", "--bond-slashed", "0", "--fees", "50"]);
  assert.match((await ok(f, ["mail", "pending"])).out, /end +Fix the flaky test[\s\S]*1 ended Mandate/);

  const mail = (await ok(f, ["mail", "preview", "--contract", contract])).out;
  assert.match(mail, /Your agent finished: Fix the flaky test/);
  assert.match(mail, /Scopes: repo\.read, shell\.exec\./);
  assert.match(mail, /Needed your approval first \(checkpoint\): shell\.exec\./);
  assert.match(mail, /Spend cap: 50 credit/);
  assert.match(mail, /scopes used: repo\.read/);
  assert.match(mail, /1 model request\(s\), 2 tool call\(s\), 10 tokens/);
  assert.match(mail, /models: tiny-model/);
  assert.match(mail, /1 attempt\(s\) were blocked before they ran: repo\.push x1/);
  assert.match(mail, /First blocked call: bash \(repo\.push\)/);
  assert.match(mail, /May I run the migration\? \(npm run migrate\): approved\./);
  assert.match(mail, /The principal accepted the delivery./);
  assert.match(mail, /Paid to the agent: 950 credit\. Bond returned: 200\. Bond lost: 0\./);
  assert.match(mail, /The run log has \d+ event\(s\) and checks out \(2 tool call\(s\) in it\)/);
  assert.match(mail, /1 of the agent's reports commit to it|\d+ of the agent's reports commit to it/);
  // Highlights only: the prompt and the reply text are in the run log, not in the mail.
  assert.doesNotMatch(mail, /read notes\.txt|Reading the notes/);
  const html = (await ok(f, ["mail", "preview", "--contract", contract, "--html"])).out;
  assert.match(html, /<h1[^>]*>Your agent finished/);

  // Queue it: an .eml, .html and .txt in the outbox, once.
  const q = await ok(f, ["mail", "queue", "--contract", contract, "--to", "alice@example.com"]);
  assert.match(q.out, /not sent/);
  const outbox = join(f.aspHome, "outbox");
  const files = readdirSync(outbox).sort();
  assert.equal(files.length, 3);
  const eml = readFileSync(join(outbox, files.find((x) => x.endsWith(".eml"))!), "utf8");
  assert.match(eml, /^From: Agent Social <noreply@localhost>/);
  assert.match(eml, /\r\nTo: alice@example\.com\r\n/);
  assert.match(eml, /Subject: Your agent finished: Fix the flaky test/);
  assert.match(eml, /Content-Type: multipart\/alternative/);
  assert.match((await ok(f, ["mail", "pending"])).out, /0 ended Mandate/);
  const again = await asp(f, ["mail", "queue", "--contract", contract, "--to", "alice@example.com"]);
  assert.equal(again.code, 1);
  assert.match(again.err, /already mailed/);
  assert.equal((await asp(f, ["mail", "queue", "--contract", contract, "--to", "alice@example.com", "--again"])).code, 0);
  assert.equal(existsSync(join(f.aspHome, "mail-state.json")), true);
});

test("asp mail: a job that was revoked says so, with the pro-rata share, and a run without a run log says that", async () => {
  const f = makeFixture();
  const contract = await runningContract(f);
  await ok(f, ["market", "settle", "--contract", contract, "--bank", BANK, "--basis", "revoked", "--principal", ALICE, "--escrow-released", "0", "--bond-slashed", "0", "--bond-returned", "200", "--pro-rata", "0"]);
  const mail = (await ok(f, ["mail", "preview", "--contract", contract])).out;
  assert.match(mail, /the principal revoked the Mandate/);
  assert.match(mail, /No activity was reported/);
  assert.match(mail, /Nothing was blocked/);
  assert.match(mail, /No run log was kept for this job/);
});

test("asp mail watch: the end mail is queued when a job settles, once, to the address set for the principal; a kill also gets its own alert at once", async () => {
  const f = makeFixture();
  const contract = await runningContract(f);
  // Still running: nothing to mail, no alert.
  assert.match((await ok(f, ["mail", "watch", "--once"])).out, /0 mail\(s\) queued/);
  // The kill switch settles the job as revoked with the whole bond slashed.
  await ok(f, ["market", "settle", "--contract", contract, "--bank", BANK, "--basis", "revoked", "--principal", ALICE, "--escrow-released", "0", "--bond-slashed", "200", "--bond-returned", "0", "--pro-rata", "0"]);
  // No address yet: skipped, and nothing is marked as mailed.
  const noAddress = await ok(f, ["mail", "watch", "--once"]);
  assert.match(noAddress.err, /skipped {2}alert-killed .*no address for did:web:example\.com:users:alice/);
  assert.match(noAddress.out, /0 mail\(s\) queued/);
  assert.equal((await asp(f, ["mail", "address", "set", ALICE, "not-an-address"])).code, 2);
  await ok(f, ["mail", "address", "set", ALICE, "alice@example.com"]);
  assert.match((await ok(f, ["mail", "address", "list"])).out, /alice@example\.com/);
  assert.match((await ok(f, ["mail", "pending"])).out, /alert-killed[\s\S]*end +[\s\S]*1 ended Mandate\(s\) and 1 alert\(s\)/);

  const watched = await ok(f, ["mail", "watch", "--once"]);
  assert.match(watched.out, /2 mail\(s\) queued/);
  const outbox = join(f.aspHome, "outbox");
  const emls = readdirSync(outbox).filter((x) => x.endsWith(".eml")).sort();
  assert.equal(emls.length, 2);
  const alert = readFileSync(join(outbox, emls.find((x) => x.startsWith("alert-killed"))!), "utf8");
  assert.match(alert, /\r\nTo: alice@example\.com\r\n/);
  assert.match(alert, /X-ASP-Alert: killed/);
  assert.match(alert, /Importance: high/);
  assert.match(alert, /Subject: Your agent was stopped by the kill switch: Fix the flaky test/);
  const alertText = readFileSync(join(outbox, emls.find((x) => x.startsWith("alert-killed"))!.replace(".eml", ".txt")), "utf8");
  assert.match(alertText, /200 credit of the agent's bond was slashed and the escrow went back to you/);
  assert.ok(emls.some((x) => x.startsWith("end-")));
  // Again: nothing new.
  assert.match((await ok(f, ["mail", "watch", "--once"])).out, /0 mail\(s\) queued/);
  assert.match((await ok(f, ["mail", "pending"])).out, /0 ended Mandate\(s\) and 0 alert\(s\)/);
});
