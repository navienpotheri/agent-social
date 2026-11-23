// The conversation cache (the 2026-11-24 run: four agents ended on token_cap at about $0.45 of a $1.50 cap because every turn re-sent the whole history as fresh input). The driver now marks the last block of the last message for
// the provider's cache (a third breakpoint, on a copy: messages is never marked); a stand-in provider models the cache by prefix, and the test proves that (1) the history is read from the cache after the first turns, so fresh input
// falls far below the version without the mark; (2) the gateway's token guard counts a response's input_tokens and output_tokens only, so cache reads and writes are NOT counted against the 200,000-token cap; (3) with the cache off
// nothing is marked; (4) a thinking block is never marked or changed. Fake key.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCohort, DEFAULT_ECONOMY, withHistoryBreakpoint, type DriverEvent, type SocietyToolSet } from "../src/index.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const strip = (v: unknown): string => JSON.stringify(v, (k, x) => (k === "cache_control" ? undefined : x));

/** A provider that models the cache by prefix: tokens are 4 characters; a request is charged fresh input for what is not in the prefix up to the previous request's last mark, which is read from the cache. */
async function provider(turns: number) {
  const reqs: Array<{ fresh: number; read: number; write: number; marks: number }> = [];
  let prevPrefix = "";
  const s = createServer((req, res) => {
    const chunks: Buffer[] = []; req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      if (!/\/v1\/messages$/.test(req.url ?? "")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ input_tokens: 10 })); return; }
      const msgs = body.messages as Array<{ content: unknown }>;
      const marks = JSON.stringify(body).split('"cache_control"').length - 1;
      const lastMarked = msgs.length - 1;
      const head = strip({ s: body.system, t: body.tools });
      const markedPrefix = head + strip(msgs.slice(0, lastMarked + 1));
      const total = Math.ceil((head.length + strip(msgs).length) / 4);
      const read = prevPrefix && markedPrefix.startsWith(prevPrefix) ? Math.ceil(prevPrefix.length / 4) : prevPrefix && strip(msgs).startsWith("") && markedPrefix.startsWith(head) ? Math.ceil(head.length / 4) : 0;
      const write = marks ? Math.max(0, Math.ceil(markedPrefix.length / 4) - read) : 0;
      reqs.push({ fresh: total - read - write, read, write, marks });
      if (marks) prevPrefix = markedPrefix;
      const n = reqs.length;
      const content = n >= turns ? [{ type: "text", text: "done" }] : [{ type: "tool_use", id: `t${n}`, name: "mcp__society__big", input: {} }];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: content[0]!.type === "tool_use" ? "tool_use" : "end_turn", usage: { input_tokens: total - read - write, output_tokens: 60, cache_read_input_tokens: read, cache_creation_input_tokens: write }, content }));
    });
  });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r)); servers.push(s);
  return { url: `http://127.0.0.1:${(s.address() as { port: number }).port}`, reqs };
}
const toolset = (): SocietyToolSet => ({
  tools: Array.from({ length: 6 }, (_, i) => ({ name: i === 0 ? "big" : `tool_${i}`, description: "A tool of the society. ".repeat(10), input_schema: { type: "object", properties: {} }, run: async () => ({ ok: true, text: "y".repeat(3000) }) })),
  system: () => "You are a citizen. ".repeat(40), opening: () => "You arrive.", summary: () => "- did a thing",
});
const run = async (url: string, cache: boolean, events: DriverEvent[] = [], maxTokens = 10_000_000) =>
  runCohort({ agents: ["a"], toolsetFor: () => toolset(), model: "claude-haiku-5-5", keyEnv: "K", env: { K: "sk-ant-FAKE-hist-0123456789" }, perAgentUsd: 50, totalUsd: 50, runDir: mkdtempSync(join(tmpdir(), "hist-")), upstream: url, signal: new AbortController().signal, economy: { ...DEFAULT_ECONOMY, cache, historyTurns: 8 }, limits: { maxTurns: 60, maxTokens }, loop: { equivalentCalls: 1000, nearRepeats: 1000 }, onEvent: (e) => events.push(e) });

test("the last message carries the third mark on a copy only, a thinking block is never marked, and with the cache off nothing is marked", () => {
  const msgs = [{ role: "user" as const, content: "You arrive." }, { role: "assistant" as const, content: [{ type: "tool_use", id: "t1", name: "x", input: {} }] }, { role: "user" as const, content: [{ type: "tool_result", tool_use_id: "t1", content: "r" }] }];
  const marked = withHistoryBreakpoint(msgs, true);
  assert.deepEqual((marked[2]!.content as Array<Record<string, unknown>>)[0]!.cache_control, { type: "ephemeral" });
  assert.equal(JSON.stringify(msgs).includes("cache_control"), false, "the stored history is never marked");
  assert.equal(withHistoryBreakpoint(msgs, false), msgs, "cache off: the same messages, nothing marked");
  const m1 = withHistoryBreakpoint([{ role: "user", content: "hello" }], true);
  assert.equal(m1[0]!.content, "hello", "a plain-text opening is left as it is (a later thinking block is bound to its form)");
  const think = [{ role: "assistant" as const, content: [{ type: "thinking", thinking: "t", signature: "s" }] }];
  assert.equal(JSON.stringify(withHistoryBreakpoint(think, true)).includes("cache_control"), false, "a thinking block is never marked");
});

test("with the history mark the later turns read the history from the cache: fresh input is a fraction of the version without the mark", async () => {
  const on = await provider(30), off = await provider(30);
  await run(on.url, true);
  await run(off.url, false);
  const sum = (r: typeof on.reqs, k: "fresh" | "read"): number => r.reduce((n, x) => n + x[k], 0);
  assert.ok(on.reqs.every((r) => r.marks <= 3), "never more than three marks (the tools, the briefing, the last message)");
  assert.ok(on.reqs.slice(3).some((r) => r.read > r.fresh), "the history is read from the cache");
  assert.ok(sum(on.reqs, "fresh") < sum(off.reqs, "fresh") * 0.6, `fresh input ${sum(on.reqs, "fresh")} with the mark against ${sum(off.reqs, "fresh")} without`);
});

test("the token guard counts input_tokens and output_tokens only: cache reads and writes are not counted against the cap, and the cap still ends an agent whose fresh tokens pass it", async () => {
  const p = await provider(20), events: DriverEvent[] = [];
  const r = await run(p.url, true, events);
  const fresh = p.reqs.reduce((n, x) => n + x.fresh, 0), reads = p.reqs.reduce((n, x) => n + x.read, 0), writes = p.reqs.reduce((n, x) => n + x.write, 0);
  assert.ok(reads > 0 && writes > 0, "the stand-in reported cache reads and writes");
  assert.equal(r.outcomes[0]!.tokens.input, fresh, "the guard's input is the fresh input only");
  assert.equal(r.outcomes[0]!.tokens.output, 60 * 20);
  assert.ok(r.outcomes[0]!.tokens.input + r.outcomes[0]!.tokens.output < fresh + reads, "cache reads are not in it");
  // a cap just above the fresh tokens of the first turns ends the agent as token_cap; the same cap with all tokens counted would have ended it much sooner
  const cap = Math.round((fresh + 60 * 20) / 2);
  const capped = await run((await provider(20)).url, true, [], cap);
  assert.equal(capped.outcomes[0]!.stopped, "token_cap");
  assert.match(capped.outcomes[0]!.detail ?? "", new RegExp(`${cap} tokens`));
});
