// The owner's first engagement run: an agent was ended by `HTTP 400 ... Invalid signature in thinking block`, which looked like a choice in the report. In a cohort run: the retry rule (drop the history's thinking blocks once and
// ask again, record it in the trace, never end the agent for it), and the report's rows for an ending by a provider error and for the thinking blocks dropped. Stand-in provider; fake key.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";
import { engagementOf, renderEngagement } from "../src/cohort/engagement.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const P = "mcp__society__";
const sign = (system: unknown, tools: unknown, messages: unknown[], t: string) => createHash("sha256").update(JSON.stringify([system, tools, messages, t])).digest("hex").slice(0, 24);
const BINDING = "messages.3.content.0: Invalid `signature` in `thinking` block. The block is bound to a different conversation. Remove the block, or set `thinking.block_binding`.";

/** mode "foreign": the second reply carries a block signed for another conversation (the provider refuses it once). mode "always": every request after the first is refused. */
async function provider(mode: "foreign" | "always") {
  let n = 0; let refused = 0;
  const s = createServer((req, res) => {
    const chunks: Buffer[] = []; req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      if (!/\/v1\/messages$/.test(req.url ?? "")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ input_tokens: 10 })); return; }
      const msgs: any[] = body.messages ?? [];
      const refuse = mode === "always" ? msgs.length > 1 : msgs.some((m, i) => m.role === "assistant" && Array.isArray(m.content) && m.content.some((b: any) => b.type === "thinking" && b.signature !== sign(body.system, body.tools, msgs.slice(0, i), b.thinking)));
      if (refuse) { refused++; res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: BINDING } })); return; }
      n++;
      const thinking = `step ${n}`;
      const signature = mode === "foreign" && n === 2 ? "sig-of-another-conversation" : sign(body.system, body.tools, msgs, thinking);
      const content = n >= 4 ? [{ type: "thinking", thinking, signature }, { type: "tool_use", id: "z", name: `${P}leave`, input: { reason: "enough" } }] : [{ type: "thinking", thinking, signature }, { type: "tool_use", id: `t${n}`, name: `${P}look_charters`, input: { n } }];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "tool_use", usage: { input_tokens: 600, output_tokens: 40 }, content }));
    });
  });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r)); servers.push(s);
  return { url: `http://127.0.0.1:${(s.address() as { port: number }).port}`, refused: () => refused };
}
async function asp(args: string[]) {
  const home = mkdtempSync(join(tmpdir(), "asp-perr-home-"));
  const out: string[] = [], err: string[] = [];
  const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home, PERR_KEY: "sk-ant-api03-FAKE-perr-0123456789abcdef" }, cwd: home } as Io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const base = (url: string, out: string) => ["society", "cohort", "--local", "--agents", "1", "--model", "claude-haiku-5-5", "--api-key-env", "PERR_KEY", "--budget-usd", "0.40", "--provider-url", url, "--out", out, "--sim-speed", "100000"];
const traceOf = (out: string) => { const d = join(out, readdirSync(out).find((x) => x.startsWith("cohort-"))!); return { dir: d, events: readFileSync(join(d, "trace.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)) as any[] }; };

test("a thinking block that the provider refuses: the run drops the history's thinking blocks once, goes on, records the event, and the report says so; the agent is not ended for it", { timeout: 120_000 }, async () => {
  const p = await provider("foreign");
  const out = mkdtempSync(join(tmpdir(), "asp-perr-out-"));
  const r = await asp(base(p.url, out));
  assert.equal(r.code, 0, r.err + r.out);
  const { dir, events } = traceOf(out);
  assert.equal(p.refused(), 1, "the provider refused once");
  const drops = events.filter((e) => e.t === "thinking_dropped");
  assert.equal(drops.length, 1); assert.equal(drops[0].why, "provider_400"); assert.ok(drops[0].blocks >= 2);
  assert.ok(events.some((e) => e.t === "tool" && e.tool === "leave"), "the agent went on and reached its leave");
  assert.ok(!events.some((e) => e.t === "end" && /provider_error/.test(e.reason)), "it was not ended by the provider's refusal");
  const md = readFileSync(join(dir, "report.md"), "utf8");
  assert.match(md, /Ended by a provider error, not a choice:\*\* 0 of 1 agents/);
  assert.match(md, /Thinking blocks:\*\* the history was sent back without its thinking blocks \d+ time\(s\) at a compaction and 1 time\(s\) after the provider refused one/);
});

test("a refusal that does not go away ends the agent with the provider's words and the report counts it as an ending by a provider error, not a choice", { timeout: 120_000 }, async () => {
  const p = await provider("always");
  const out = mkdtempSync(join(tmpdir(), "asp-perr-out-"));
  const r = await asp(base(p.url, out));
  assert.equal(r.code, 0, r.err + r.out);
  const { dir, events } = traceOf(out);
  const end = events.find((e) => e.t === "end");
  assert.match(end.reason, /^provider_error: HTTP 400: messages\.3\.content\.0: Invalid `signature` in `thinking` block/);
  const md = readFileSync(join(dir, "report.md"), "utf8");
  assert.match(md, /Ended by a provider error, not a choice:\*\* 1 of 1 agents \("HTTP 400: messages\.3\.content\.0: Invalid `signature` in `thinking` block\. The bl/);
});

test("the engagement of a trace: agents ended by a provider error are counted with the first words of the errors, apart from the leaves, and the dropped thinking blocks are counted by cause", () => {
  const ag = (n: string) => ({ t: "agent", at: "2026-11-22T10:00:00Z", agent: n, did: "d", handle: n });
  const end = (n: string, reason: string) => ({ t: "end", at: "2026-11-22T10:00:00Z", agent: n, reason, turns: 3, usd: 0.01 });
  const ev = [ag("a"), ag("b"), ag("c"), ag("d"), end("a", "provider_error: HTTP 400: bad signature"), end("b", "provider_error: HTTP 400: bad signature"), end("c", "provider_error: HTTP 529: overloaded"), end("d", "left: done"),
    { t: "thinking_dropped", at: "x", agent: "a", turn: 1, blocks: 2, why: "compaction" }, { t: "thinking_dropped", at: "x", agent: "b", turn: 2, blocks: 3, why: "provider_400" }, { t: "thinking_dropped", at: "x", agent: "b", turn: 5, blocks: 1, why: "compaction" }] as never[];
  const r = engagementOf(ev, 30);
  assert.equal(r.endedByProviderError.agents, 3);
  assert.deepEqual(r.endedByProviderError.first, ["HTTP 400: bad signature", "HTTP 529: overloaded"]);
  assert.deepEqual(r.thinkingDropped, { compaction: 2, provider_400: 1 });
  assert.match(renderEngagement(r), /Ended by a provider error, not a choice:\*\* 3 of 4 agents \("HTTP 400: bad signature"; "HTTP 529: overloaded"\)/);
});
