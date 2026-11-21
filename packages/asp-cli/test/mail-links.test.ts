import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { Keystore, openLog } from "@agent-social/asp-package";
import { createDashboard } from "../src/dashboard-server.ts";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

// Gap E11: the links in the end-of-Mandate mail. No link is invented: without a dashboard the mail says plainly that the run log is local;
// with one it links to the run page, and the page's run-log route serves the redacted log to the signed-in principal only.
const ALICE = "did:web:example.com:users:alice";
const CODER = "did:web:example.com:agents:coder";
const BANK = "did:web:example.com:bank";
const TOKEN = "mail-links-token";
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });

async function asp(f: Fixture, args: string[]) {
  const out: string[] = []; const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };

test("E11: the mail links to the run page only when there is one; the run-log route needs the token and serves the redacted file", async () => {
  const f = makeFixture();
  await ok(f, ["identity", "new", "--kind", "human", "--did", ALICE]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Work"]);
  await ok(f, ["identity", "new", "--kind", "human", "--did", BANK]);
  await ok(f, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await ok(f, ["credits", "grant", "--to", CODER, "--amount", "200"]);
  const intent = /^intent (\S+)/.exec((await ok(f, ["market", "intent", "--by", ALICE, "--purpose", "Link test", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z"])).out)![1];
  const offer = /^offer (\S+)/.exec((await ok(f, ["market", "offer", "--by", CODER, "--intent", intent, "--price", "1000", "--plan", "go", "--eta", "2026-11-01T00:00:00Z"])).out)![1];
  const contract = /^contract (\S+):/.exec((await ok(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1];
  await ok(f, ["market", "bond", "--contract", contract, "--backer", CODER, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
  await ok(f, ["market", "mandate", "--contract", contract, "--principal", ALICE, "--performer", CODER, "--scopes", "repo.read"]);
  const upstream = createServer(async (req, res) => {
    for await (const _ of req) { /* drain */ }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "c", object: "chat.completion", created: 1, model: "m", usage: { prompt_tokens: 1, completion_tokens: 1 }, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "done" } }] }));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  servers.push(upstream);
  const agent = `const r = await fetch(process.env.OPENAI_BASE_URL + "/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer x" }, body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "hi" }] }) }); await r.json();`;
  const run = await asp(f, ["gateway", "--contract", contract, "--by", CODER, "--openai-upstream", `http://127.0.0.1:${(upstream.address() as { port: number }).port}/v1`, "--", process.execPath, "--input-type=module", "-e", agent]);
  assert.equal(run.code, 0, run.err);
  await ok(f, ["market", "deliver", "--contract", contract, "--by", CODER, "--summary", "ok"]);
  await ok(f, ["market", "accept", "--contract", contract, "--by", ALICE]);
  await ok(f, ["market", "settle", "--contract", contract, "--bank", BANK, "--basis", "accepted", "--escrow-released", "1000", "--bond-returned", "200", "--bond-slashed", "0", "--fees", "0"]);

  // No dashboard address: the mail says the log is local and invents no link.
  const plain = (await ok(f, ["mail", "preview", "--contract", contract])).out;
  const path = /kept only on the machine that ran the job, at (.+?)\. No page is hosted/.exec(plain)?.[1];
  assert.ok(path, plain);
  assert.doesNotMatch(plain, /https?:\/\/|\/run-log|Run page/);
  // With one: the run page address, and the way to the log goes through that page.
  const linked = (await ok(f, ["mail", "preview", "--contract", contract, "--link-base", "http://127.0.0.1:7777/"])).out;
  assert.ok(linked.includes(`Run page: http://127.0.0.1:7777/#/job/${contract}`), linked);
  assert.match(linked, /download button/);
  assert.doesNotMatch(linked, /7777\/run-log|api\/run-log/);

  // The route the run page's download button calls.
  const keys = new Keystore(f.aspHome);
  const dash = createDashboard({ token: TOKEN, openLog: () => openLog(f.aspHome, {}), runLogFor: (c) => (c === contract ? path : undefined), signerFor: (d) => keys.forDid(d), now: () => "2026-11-21T00:00:00Z" });
  await new Promise<void>((r) => dash.listen(0, "127.0.0.1", r));
  servers.push(dash);
  const base = `http://127.0.0.1:${(dash.address() as { port: number }).port}`;
  const get = (q: string, t: string | null = TOKEN) => fetch(`${base}/api/run-log?id=${encodeURIComponent(q)}`, { headers: t ? { "x-dashboard-token": t } : {} });
  assert.equal((await get(contract, null)).status, 401);
  assert.equal((await get("no-such-contract")).status, 404);
  const res = await get(contract);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /ndjson/);
  assert.equal(await res.text(), readFileSync(path!, "utf8"));
  assert.match((await (await fetch(base + "/")).text()), /download the whole run log/);
});
