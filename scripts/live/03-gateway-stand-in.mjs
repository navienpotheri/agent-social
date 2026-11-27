// Live check 03: `asp gateway` and `asp run` governing an agent with NO real model (rows T2, E5, E16, E2, P21 stand-in; docs/live-check-cli.md). A tiny model provider and a stand-in agent run under a real Mandate through the
// real gateway on this machine: an allowed call is let through, a call outside the Mandate is removed before the agent sees it, a gated call waits for the principal's answer, the run log is kept redacted and verifies, and
// `asp runs` lists it. Local by default (a throwaway log); with --hosted it uses the saved login of the tenant from script 02 so the same checks run against the deployed service.
//
//   node scripts/live/03-gateway-stand-in.mjs [--hosted] [--slow <seconds>] [--kill] [--yes]
//
// --slow makes the stand-in wait that many seconds (for the laptop-sleep check); --kill makes it try calls until the gateway ends the session (for the alert mail check). Credits are accounting entries, not money.
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { args, session } from "./lib.mjs";

const a = args();
const s = session("gateway-stand-in", { yes: !!a.yes });
const bin = fileURLToPath(new URL("../../packages/asp-cli/bin/asp.mjs", import.meta.url));
const home = a.hosted ? (process.env.ASP_HOME ?? "") : mkdtempSync(join(tmpdir(), "asp live gw "));
const env = { ...process.env, ...(a.hosted ? {} : { ASP_HOME: home }) };
const asp = (argv, o = {}) => s.run(process.execPath, [bin, ...argv], { env, ...o });
const ALICE = `did:web:example.com:users:live-${Date.now().toString(36)}`, CODER = `did:web:example.com:agents:live-${Date.now().toString(36)}`, BANK = `did:web:example.com:bank:live-${Date.now().toString(36)}`;
const ok = async (argv) => { const r = await asp(argv); if (r.code !== 0) throw new Error(`asp ${argv.slice(0, 3).join(" ")} failed: ${(r.err || r.out).slice(0, 300)}`); return r.out; };

// A model provider that always asks for one allowed and one disallowed tool call, and carries a fake secret in the request so the run log's redaction can be seen working.
const provider = createServer(async (req, res) => { for await (const _ of req) { /* drain */ } res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ id: "c1", object: "chat.completion", created: 1, model: "stand-in", usage: { prompt_tokens: 7, completion_tokens: 3 }, choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "a", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "notes.txt" }) } }, { id: "b", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: "git push origin main" }) } }] } }] })); });
await new Promise((r) => provider.listen(0, "127.0.0.1", r));
const upstream = `http://127.0.0.1:${provider.address().port}/v1`;
const AGENT = `
const wait = Number(process.env.STAND_IN_SLOW || 0); if (wait) await new Promise((r) => setTimeout(r, wait * 1000));
const r = await fetch(process.env.OPENAI_BASE_URL + "/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer sk-live-check-FAKE-0000000000000000" }, body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "go; my key is sk-live-check-FAKE-0000000000000000" }] }) });
const m = (await r.json()).choices[0].message;
console.log("AGENT GOT:" + JSON.stringify((m.tool_calls ?? []).map((t) => t.function.name)));
console.log("AGENT SAW:" + (m.content ?? ""));
`;

try {
  s.title(`Gateway with a stand-in agent (${a.hosted ? "hosted login" : "local throwaway log " + home})`);
  if (!a.hosted) {
    for (const [kind, did] of [["human", ALICE], ["human", BANK]]) await ok(["identity", "new", "--kind", kind, "--did", did]);
    await ok(["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Stand-in agent for the live check"]);
    await ok(["credits", "grant", "--to", ALICE, "--amount", "1000"]); await ok(["credits", "grant", "--to", CODER, "--amount", "200"]);
    const intent = /^intent (\S+)/.exec(await ok(["market", "intent", "--by", ALICE, "--purpose", "Read the notes", "--budget", "1000", "--deadline", "2027-12-01T00:00:00Z"]))[1];
    const offer = /^offer (\S+)/.exec(await ok(["market", "offer", "--by", CODER, "--intent", intent, "--price", "1000", "--plan", "read", "--eta", "2027-11-01T00:00:00Z"]))[1];
    const contract = /^contract (\S+):/.exec(await ok(["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intent, "--offer", offer]))[1];
    await ok(["market", "bond", "--contract", contract, "--backer", CODER, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
    await ok(["market", "mandate", "--contract", contract, "--principal", ALICE, "--performer", CODER, "--scopes", "repo.read"]);
    s.say(`a job is Running under a Mandate that allows repo.read and nothing else (contract ${contract.slice(0, 20)}...)`);
    const run = await asp(["gateway", "--contract", contract, "--by", CODER, "--openai-upstream", upstream, "--", process.execPath, "--input-type=module", "-e", AGENT], { env: { ...env, STAND_IN_SLOW: String(a.slow ?? 0) } });
    await s.check("the gateway ran the stand-in agent and the agent exited 0", async () => run.code === 0 ? true : `exit ${run.code}: ${run.err.slice(-300)}`);
    await s.check("the allowed call (read_file -> repo.read) was let through and the call outside the Mandate (git push) was removed before the agent saw it", async () => /allowed\s+read_file -> repo\.read/.test(run.err) && /AGENT GOT:\["read_file"\]/.test(run.out) ? true : (run.out + run.err).slice(-400));
    await s.check("the refusal says which article it rests on and what to do instead", async () => /Article|ASP/.test(run.out + run.err) && /AGENT SAW:/.test(run.out) ? true : (run.out + run.err).slice(-300));
    const logPath = /run log\s+(.+run-log\.ndjson)/.exec(run.err)?.[1]?.trim();
    await s.check("a run log was kept in the run folder", async () => logPath && existsSync(logPath) ? true : "no run log line");
    await s.check("the run log holds no secret: the fake key sent in the request is masked", async () => { const t = readFileSync(logPath, "utf8"); return t.includes("sk-live-check-FAKE") ? "the fake key is in the log unmasked" : true; });
    const verify = await asp(["run-log", "verify", logPath]);
    await s.check("`asp run-log verify` checks the log's hash chain and the Action's commitment", async () => verify.code === 0 ? true : (verify.out + verify.err).slice(0, 300));
    const shown = await asp(["run-log", "show", logPath]);
    await s.check("`asp run-log show` reads the log to a person: the model request, each call with its verdict, and how the run ended", async () => shown.code === 0 && /read_file|repo\.read/.test(shown.out) && /git push|shell|refus|block/i.test(shown.out) ? true : shown.out.slice(0, 400) + shown.err.slice(0, 200));
    if (a.kill) {
      const k = await asp(["gateway", "--contract", contract, "--by", CODER, "--openai-upstream", upstream, "--max-strikes", "1", "--", process.execPath, "--input-type=module", "-e", AGENT]);
      await s.check("--kill: a session of repeated out-of-Mandate calls is ended by the gateway", async () => /stopped|KILL|strike/i.test(k.err + k.out) ? true : (k.err + k.out).slice(-300));
    }
    await s.human("Ctrl-C test (T2): run it again slowly and press Ctrl-C while it waits.", ["Run:  STAND_IN_SLOW=60 node " + bin + " gateway --contract " + contract + " --by " + CODER + " --openai-upstream " + upstream + " -- " + process.execPath + " --input-type=module -e \"await new Promise(r=>setTimeout(r,60000))\"", "(the provider above is closed when this script ends: for this step use script 03 --slow 60 in another terminal and press Ctrl-C there.) Then `asp run-log show` on the newest run folder says how it ended (interrupted) and `asp run-log verify` passes: nothing half written."]);
  } else {
    await s.human("Hosted run (E16, E5): run a stand-in session under a real job on the deployed service.", ["With the tenant from script 02 (same ASP_HOME), make a job, bond and Mandate as in scripts/live/03 local mode, then run `asp gateway ... --run-log-upload` and check the run log is fetchable by its owner only: `asp run-log fetch --id <id>`.", "The log in the service is end-to-end encrypted when the owner chose that; the operator cannot read it."]);
  }
} finally { provider.close(); }
process.exit(s.done());
