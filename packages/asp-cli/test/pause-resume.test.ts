// Row US1: `asp pause` holds every running session at its next call instead of ending it, `asp resume` lets it continue, the run log records the hold, and `asp pause status` says which. The stop switch
// (asp stop --all) is separate and still ends sessions. Fake provider; no real model.
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

async function asp(f: Fixture, args: string[]) {
  const out: string[] = []; const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  return { code: await main(args, io), out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };

test("pause holds the next call until resume; the run log records the hold; status says whether it is paused", async () => {
  const f = makeFixture();
  await ok(f, ["identity", "new", "--kind", "human", "--did", ALICE]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Work"]);
  await ok(f, ["identity", "new", "--kind", "human", "--did", BANK]);
  await ok(f, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await ok(f, ["credits", "grant", "--to", CODER, "--amount", "200"]);
  const intent = /^intent (\S+)/.exec((await ok(f, ["market", "intent", "--by", ALICE, "--purpose", "Pause", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z"])).out)![1];
  const offer = /^offer (\S+)/.exec((await ok(f, ["market", "offer", "--by", CODER, "--intent", intent, "--price", "1000", "--plan", "go", "--eta", "2026-11-01T00:00:00Z"])).out)![1];
  const contract = /^contract (\S+):/.exec((await ok(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1];
  await ok(f, ["market", "bond", "--contract", contract, "--backer", CODER, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
  await ok(f, ["market", "mandate", "--contract", contract, "--principal", ALICE, "--performer", CODER, "--scopes", "repo.read"]);

  assert.match((await ok(f, ["pause", "status"])).out, /not paused/);
  assert.match((await ok(f, ["pause"])).out, /^paused: every running session/);
  assert.match((await ok(f, ["pause", "status"])).out, /paused since /);

  let reached = 0;
  const upstream = createServer(async (req, res) => {
    for await (const _ of req) { /* drain */ }
    reached = Date.now();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "c", object: "chat.completion", created: 1, model: "m", usage: { prompt_tokens: 1, completion_tokens: 1 }, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "ok" } }] }));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  servers.push(upstream);
  const agent = `const r = await fetch(process.env.OPENAI_BASE_URL + "/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer x" }, body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "hi" }] }) }); await r.text();`;
  let resumedAt = 0;
  setTimeout(() => { resumedAt = Date.now(); void asp(f, ["resume"]); }, 1500);
  const run = await asp(f, ["gateway", "--contract", contract, "--by", CODER, "--openai-upstream", `http://127.0.0.1:${(upstream.address() as { port: number }).port}/v1`, "--", process.execPath, "--input-type=module", "-e", agent]);
  assert.equal(run.code, 0, run.err);
  assert.ok(resumedAt > 0 && reached >= resumedAt, "the provider was reached only after the resume");
  assert.equal(existsSync(join(f.aspHome, "paused")), false);
  const dir = join(f.aspHome, "runs");
  const log = readFileSync(join(dir, readdirSync(dir).sort().at(-1)!, "run-log.ndjson"), "utf8");
  assert.match(log, /"kind":"paused"/);
  assert.match(log, /"kind":"resumed"/);
  assert.match((await ok(f, ["pause", "status"])).out, /not paused/);
  assert.match((await ok(f, ["resume"])).out, /nothing was paused/);
});
