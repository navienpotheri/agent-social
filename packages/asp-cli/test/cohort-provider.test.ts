// Row DK1801: the Anthropic provider of the cohort runner against a local stand-in that speaks the Messages API: the key is read only from the named environment variable and sent only as a header, the tools sent are
// exactly the restricted set (no shell, no file), tokens are read from the reply's usage, and the key reaches no file of the run and no error text, even when the service echoes it back. No real key, no outside network.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { anthropicProvider } from "../src/cohort/provider.ts";
import { runCohort } from "../src/cohort/run.ts";
import { TOOLS, toolNames } from "../src/cohort/tools.ts";

const SECRET = "sk-test-NOT-A-REAL-KEY-0123456789abcdef";
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });

async function standIn(handler: (body: any, headers: Record<string, string | string[] | undefined>, n: number) => { status: number; json: unknown }) {
  const seen: Array<{ body: any; headers: Record<string, string | string[] | undefined> }> = [];
  const s = createServer(async (req, res) => {
    let b = ""; for await (const c of req) b += c;
    const body = JSON.parse(b || "{}");
    seen.push({ body, headers: req.headers });
    const r = handler(body, req.headers, seen.length);
    res.writeHead(r.status, { "content-type": "application/json" }); res.end(JSON.stringify(r.json));
  });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r)); servers.push(s);
  return { url: `http://127.0.0.1:${(s.address() as { port: number }).port}`, seen };
}
const filesUnder = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? filesUnder(p) : [p]; });

test("DK1801: the provider needs the named variable, sends the key as a header only, and offers the model exactly the restricted tool set", async () => {
  assert.throws(() => anthropicProvider({ model: "m", keyEnv: "COHORT_KEY", env: {} }), /COHORT_KEY is not set/);
  const sa = await standIn((_b, _h, n) => ({ status: 200, json: { content: n === 1 ? [{ type: "tool_use", id: "t1", name: "look_charters", input: {} }] : [{ type: "tool_use", id: "t2", name: "stop_exploring", input: { why: "done" } }], usage: { input_tokens: 1200, output_tokens: 80 }, stop_reason: "tool_use" } }));
  const p = anthropicProvider({ model: "claude-haiku-5-5", keyEnv: "COHORT_KEY", env: { COHORT_KEY: SECRET }, baseUrl: sa.url });
  const out = mkdtempSync(join(tmpdir(), "asp-cohort-key-")), home = mkdtempSync(join(tmpdir(), "asp-cohort-keyhome-"));
  const r = await runCohort({ out, home, agents: 1, model: "claude-haiku-5-5", provider: p, budgetUsd: 0.4, totalUsd: 0.4, minutes: 2, priceIn: 1, priceOut: 5, io: { out: () => undefined } });
  assert.equal(sa.seen.length, 2);
  const first = sa.seen[0];
  assert.equal(first.headers["x-api-key"], SECRET, "the key is sent as the x-api-key header");
  assert.equal(first.headers["anthropic-version"], "2023-06-01");
  for (const [h, v] of Object.entries(first.headers)) if (h !== "x-api-key") assert.ok(!String(v).includes(SECRET), `the key is in the ${h} header too`);
  assert.equal(first.body.model, "claude-haiku-5-5");
  assert.deepEqual(first.body.tools.map((t: { name: string }) => t.name), toolNames(), "exactly the restricted set");
  for (const banned of ["bash", "shell", "read_file", "write_file", "edit", "fetch", "web"]) assert.ok(!first.body.tools.some((t: { name: string }) => t.name.includes(banned)), `no ${banned} tool`);
  assert.ok(!JSON.stringify(first.body).includes(SECRET), "the key is not in the request body");
  assert.equal(r.report.perAgent[0].inputTokens, 2400, "tokens come from the reply's usage");
  assert.equal(r.report.perAgent[0].endReason, "stopped_exploring");
  assert.equal(r.report.perAgent[0].statedTurns, 0, "this stand-in reply carries no text");
  // the key is in no file the run wrote
  for (const f of filesUnder(out)) assert.ok(!readFileSync(f).includes(SECRET), `${f} does not hold the key`);
  for (const f of filesUnder(home)) assert.ok(!readFileSync(f).includes(SECRET), `${f} does not hold the key`);
});

test("DK1801: a service that echoes the key back in an error does not get it into the trace or the report", async () => {
  const sa = await standIn((_b, h) => ({ status: 401, json: { error: { message: `invalid x-api-key: ${String(h["x-api-key"])}` } } }));
  const out = mkdtempSync(join(tmpdir(), "asp-cohort-key2-")), home = mkdtempSync(join(tmpdir(), "asp-cohort-key2home-"));
  const p = anthropicProvider({ model: "m", keyEnv: "K", env: { K: SECRET }, baseUrl: sa.url });
  const r = await runCohort({ out, home, agents: 1, model: "m", provider: p, budgetUsd: 1, totalUsd: 1, minutes: 1, priceIn: 1, priceOut: 1, io: { out: () => undefined } });
  assert.match(r.report.perAgent[0].endReason, /^model_error: the model service answered 401/);
  assert.match(r.report.perAgent[0].endReason, /\[key\]/, "the key was scrubbed");
  for (const f of filesUnder(out)) assert.ok(!readFileSync(f).includes(SECRET), `${f} does not hold the key`);
  const net = anthropicProvider({ model: "m", keyEnv: "K", env: { K: SECRET }, baseUrl: "http://127.0.0.1:1" });
  await assert.rejects(() => net.complete({ system: "s", messages: [{ role: "user", content: "x" }], tools: TOOLS, maxTokens: 10 }), (e: Error) => !e.message.includes(SECRET));
});
