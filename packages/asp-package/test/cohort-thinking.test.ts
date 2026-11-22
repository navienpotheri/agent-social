// The owner's first real run of the engagement loop (2026-11-22): agent-03 ended after 33 seconds with `HTTP 400: messages.3.content.0: Invalid signature in thinking block. The block is bound to a different conversation`.
// A thinking block is valid only after the exact prefix it was generated after; the history window dropped the oldest exchange and rewrote the opening, so every thinking block that stayed was bound to a prefix that no
// longer existed. The driver now drops the thinking blocks of the history together whenever it changes the history, and if the provider still refuses one it drops them once and asks again; the agent is never ended for it.
// A stand-in provider that signs each thinking block with the whole prefix it follows and refuses a block whose prefix has changed, in the provider's own words. Fake key.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dropThinkingBlocks, runCohort, type DriverEvent, type SocietyToolSet } from "../src/index.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const sign = (system: unknown, tools: unknown, messages: unknown[], thinking: string) => createHash("sha256").update(JSON.stringify([system, tools, messages, thinking])).digest("hex").slice(0, 24);

/** Replies `turns` times with a thinking block and a tool call, then text. `foreignAt`: the nth reply carries a block signed for another conversation. `alwaysRefuse`: every request after the first is refused with the binding error. */
async function provider(o: { turns: number; foreignAt?: number; alwaysRefuse?: boolean }) {
  let n = 0; const refusals: string[] = []; const requests: any[] = [];
  const s = createServer((req, res) => {
    const chunks: Buffer[] = []; req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      if (!/\/v1\/messages$/.test(req.url ?? "")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ input_tokens: 10 })); return; }
      requests.push(body);
      const msgs: any[] = body.messages ?? [];
      // validate every thinking block against the prefix before its message
      for (let i = 0; i < msgs.length; i++) {
        const m = msgs[i];
        if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
        const t = m.content.find((b: any) => b.type === "thinking");
        const bad = t && sign(body.system, body.tools, msgs.slice(0, i), t.thinking) !== t.signature;
        if (bad || (o.alwaysRefuse && msgs.length > 1)) {
          const message = `messages.${i}.content.0: Invalid \`signature\` in \`thinking\` block. The block is bound to a different conversation. Remove the block, or set \`thinking.block_binding\`.`;
          refusals.push(message);
          res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message } })); return;
        }
      }
      n++;
      const thinking = `I think about step ${n}.`;
      const signature = o.foreignAt === n ? "sig-from-another-conversation" : sign(body.system, body.tools, msgs, thinking);
      const content = n > o.turns ? [{ type: "text", text: "done" }] : [{ type: "thinking", thinking, signature }, { type: "tool_use", id: `t${n}`, name: "mcp__society__look", input: { n } }];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: n > o.turns ? "end_turn" : "tool_use", usage: { input_tokens: 500, output_tokens: 50, cache_read_input_tokens: 2000 }, content }));
    });
  });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r)); servers.push(s);
  return { url: `http://127.0.0.1:${(s.address() as { port: number }).port}`, refusals, requests };
}
const toolset = (): SocietyToolSet => ({
  tools: [{ name: "look", description: "Look around.", input_schema: { type: "object", properties: { n: { type: "number" } } }, run: async () => ({ ok: true, text: "you see a plaza and a notice board" }) }],
  system: () => "You are a citizen of a small society.", opening: () => "You arrive.", summary: () => "- looked around",
});
const run = (url: string, economy: Record<string, number | boolean> = {}) => {
  const events: DriverEvent[] = [];
  return runCohort({ agents: ["a"], toolsetFor: () => toolset(), model: "claude-haiku-5-5", keyEnv: "K", env: { K: "sk-ant-FAKE-think-0123456789" }, perAgentUsd: 5, totalUsd: 5, runDir: mkdtempSync(join(tmpdir(), "think-")), upstream: url, signal: new AbortController().signal, economy, limits: { maxTurns: 40, maxTokens: 10_000_000 }, loop: { equivalentCalls: 1000, nearRepeats: 1000 }, onEvent: (e) => events.push(e) }).then((r) => ({ ...r, events }));
};

test("fourteen ticks with a history window of three: the thinking blocks are dropped together at every compaction, the provider never refuses one, and the agent finishes", async () => {
  const p = await provider({ turns: 14 });
  const r = await run(p.url, { historyTurns: 3 });
  assert.equal(r.outcomes[0]!.stopped, "finished", JSON.stringify(r.outcomes[0]));
  assert.deepEqual(p.refusals, [], "no request was refused");
  assert.ok(r.events.filter((e) => e.kind === "thinking_dropped" && e.why === "compaction").length >= 2, "dropped at the compactions (every few turns, not every turn)");
  assert.ok(r.events.filter((e) => e.kind === "thinking_dropped").length <= 4, "and not at every turn");
  assert.equal(r.events.filter((e) => e.kind === "thinking_dropped" && e.why === "provider_400").length, 0, "no retry was needed");
  // between compactions the thinking blocks are sent back exactly as received, in their own turn
  const lastReq = p.requests.at(-1);
  const kept = lastReq.messages.filter((m: any) => m.role === "assistant" && Array.isArray(m.content) && m.content.some((b: any) => b.type === "thinking"));
  assert.ok(kept.length >= 1, "the turns since the last compaction still carry their thinking blocks");
  for (const m of lastReq.messages) if (m.role === "assistant") assert.ok(m.content.length >= 1);
});

test("without a window (the first turns of a life) the thinking blocks go back unchanged with their signatures and are accepted", async () => {
  const p = await provider({ turns: 5 });
  const r = await run(p.url, { historyTurns: 50 });
  assert.equal(r.outcomes[0]!.stopped, "finished");
  assert.deepEqual(p.refusals, []);
  assert.equal(r.events.filter((e) => e.kind === "thinking_dropped").length, 0, "nothing was dropped");
  const lastReq = p.requests.at(-1);
  assert.equal(lastReq.messages.filter((m: any) => m.role === "assistant" && m.content.some((b: any) => b.type === "thinking")).length, 5, "all five turns kept their thinking blocks");
});

test("a block that the provider says belongs to another conversation: the history is sent back once without its thinking blocks, the event is recorded, and the agent is not ended", async () => {
  const p = await provider({ turns: 6, foreignAt: 2 });
  const r = await run(p.url, { historyTurns: 50 });
  assert.equal(r.outcomes[0]!.stopped, "finished", JSON.stringify(r.outcomes[0]));
  assert.equal(p.refusals.length, 1, "the provider refused once");
  assert.match(p.refusals[0]!, /Invalid `signature` in `thinking` block/);
  const drops = r.events.filter((e) => e.kind === "thinking_dropped");
  assert.equal(drops.length, 1);
  assert.equal(drops[0]!.kind === "thinking_dropped" && drops[0]!.why, "provider_400");
  assert.ok(drops[0]!.kind === "thinking_dropped" && drops[0]!.blocks >= 2, "the blocks of the history");
});

test("a refusal that does not go away is not retried for ever: one drop, one more try, then the agent ends with the provider's words", async () => {
  const p = await provider({ turns: 6, alwaysRefuse: true });
  const r = await run(p.url);
  assert.equal(r.outcomes[0]!.stopped, "provider_error");
  assert.match(r.outcomes[0]!.detail ?? "", /thinking/);
  assert.equal(r.events.filter((e) => e.kind === "thinking_dropped").length, 1, "dropped once");
  assert.equal(p.refusals.length, 2, "refused, dropped, refused again, ended");
});

test("dropThinkingBlocks drops thinking and redacted thinking blocks, keeps text and tool calls, leaves an assistant turn that was only thinking with a placeholder, and touches no user message", () => {
  const msgs: { role: "user" | "assistant"; content: unknown }[] = [
    { role: "user", content: "hello" },
    { role: "assistant", content: [{ type: "thinking", thinking: "t", signature: "s" }, { type: "text", text: "hi" }, { type: "tool_use", id: "a", name: "x", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: "ok" }] },
    { role: "assistant", content: [{ type: "redacted_thinking", data: "zzz" }] },
  ];
  assert.equal(dropThinkingBlocks(msgs), 2);
  assert.deepEqual((msgs[1]!.content as { type: string }[]).map((b) => b.type), ["text", "tool_use"]);
  assert.deepEqual(msgs[3]!.content, [{ type: "text", text: "(no text)" }]);
  assert.equal(msgs[0]!.content, "hello");
  assert.equal(dropThinkingBlocks(msgs), 0, "nothing left to drop");
});
