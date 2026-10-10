// Builds an ASP home with enough in it to look at the dashboard: agents, a job that was accepted after a gateway run with a blocked call, a job the kill
// switch stopped, a job waiting for an approval, and one still running. No agent or key is needed: a stand-in model provider answers the gateway.
//
//   node evals/dashboard-demo.mjs [folder]      then      ASP_HOME=<folder>/asp node packages/asp-cli/src/cli.ts dashboard
import { createServer } from "node:http";
import { D, session, workdir } from "./lib/common.mjs";

const dir = process.argv[2] ? process.argv[2].replace(/\\/g, "/") : workdir("dashboard-demo");
const s = await session(dir);
const [ALICE, BANK, DANA] = [D("users:alice"), D("bank"), D("users:dana")];
const [CODER, REVIEWER] = [D("agents:coder"), D("agents:reviewer")];
await s.must(["identity", "new", "--kind", "human", "--did", DANA]);
const { principal } = await s.parties({ principal: ALICE, bank: BANK, agents: [CODER, REVIEWER] });

// A stand-in provider: every model request asks for one read the Mandate allows and one push it does not.
const provider = createServer(async (req, res) => {
  for await (const _ of req) { /* drain */ }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({
    id: "c1", object: "chat.completion", created: 1, model: "demo-model", usage: { prompt_tokens: 412, completion_tokens: 96 },
    choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: "I will read the notes, then publish the fix.", tool_calls: [
      { id: "a", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "notes.txt" }) } },
      { id: "b", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: "git push origin main" }) } },
    ] } }],
  }));
});
await new Promise((r) => provider.listen(0, "127.0.0.1", r));
const upstream = `http://127.0.0.1:${provider.address().port}/v1`;
const AGENT = `
const r = await fetch(process.env.OPENAI_BASE_URL + "/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer x" }, body: JSON.stringify({ model: "demo-model", messages: [{ role: "user", content: "Fix the flaky retry test and push the fix." }] }) });
await r.json();
`;

// 1. Accepted after a run in which one call was blocked before it ran.
const done = await s.job({ principal, bank: BANK, agent: CODER, scopes: ["repo.read"], purpose: "Fix the flaky retry test", price: 600, bond: 150 });
await s.must(["gateway", "--contract", done, "--by", CODER, "--openai-upstream", upstream, "--", process.execPath, "--input-type=module", "-e", AGENT]);
await s.must(["market", "deliver", "--contract", done, "--by", CODER, "--summary", "The retry test no longer flakes; cause was a missing await."]);
await s.must(["market", "accept", "--contract", done, "--by", ALICE]);
await s.must(["market", "settle", "--contract", done, "--bank", BANK, "--basis", "accepted", "--escrow-released", "570", "--bond-returned", "150", "--bond-slashed", "0", "--fees", "30"]);

// 2. Stopped by the kill switch: the bond is forfeited to the principal.
const killed = await s.job({ principal, bank: BANK, agent: REVIEWER, scopes: ["repo.read"], purpose: "Review the payments migration", price: 400, bond: 100 });
await s.must(["market", "action", "--contract", killed, "--by", REVIEWER, "--scopes-used", "repo.read", "--blocked", "shell.exec=3", "--summary", "tried to run the migration itself"]);
await s.must(["market", "settle", "--contract", killed, "--bank", BANK, "--basis", "revoked", "--principal", ALICE, "--escrow-released", "0", "--bond-slashed", "100", "--bond-returned", "0", "--pro-rata", "0"]);

// 3. Waiting for the principal's answer.
const waiting = await s.job({ principal, bank: BANK, agent: CODER, scopes: ["repo.read", "shell.exec"], gates: ["shell.exec"], purpose: "Migrate the orders table", price: 800, bond: 200 });
await s.must(["market", "checkpoint", "--contract", waiting, "--by", CODER, "--question", "May I run the migration against the staging database?", "--summary", "npm run migrate -- --env staging"]);

// 4. Still running, with some activity (a third agent: the one the kill switch stopped is tier 0 now and cannot be bonded again).
const SUMMARISER = D("agents:summariser");
await s.must(["identity", "new", "--kind", "agent", "--did", SUMMARISER, "--sponsor", DANA, "--purpose", "Summarise text for its owner"]);
const running = await s.job({ principal: DANA, bank: BANK, agent: SUMMARISER, scopes: ["repo.read"], purpose: "Summarise this week's support tickets", price: 250, bond: 50 });
await s.must(["market", "action", "--contract", running, "--by", SUMMARISER, "--scopes-used", "repo.read", "--summary", "read 40 tickets"]);
provider.close();
console.log(`\ndemo home: ${s.home}\n  ASP_HOME=${s.home} node packages/asp-cli/src/cli.ts dashboard`);
console.log(`  jobs: accepted ${done.slice(0, 19)}  killed ${killed.slice(0, 19)}  waiting ${waiting.slice(0, 19)}  running ${running.slice(0, 19)}`);
process.exit(0);
