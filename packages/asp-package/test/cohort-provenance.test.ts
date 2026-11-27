// ENG70, run provenance in the cohort driver: the provider's returned model snapshot and a hash of each response id, a hash of the tool definitions offered at every turn, the size of the thinking returned (counts, never the
// hidden text), and a change of snapshot or of a tool definition named when it happens. A stand-in provider that changes its snapshot after three replies, and a tool whose description changes mid-run. Fake key.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCohort, REQUEST_SETTINGS, sha16, type DriverEvent, type SocietyToolSet } from "../src/index.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const HIDDEN = "SECRET-REASONING-THE-RUN-MUST-NEVER-KEEP";

async function provider(turns: number) {
  let n = 0; const requests: any[] = [];
  const s = createServer((req, res) => {
    const chunks: Buffer[] = []; req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      if (!/\/v1\/messages$/.test(req.url ?? "")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ input_tokens: 10 })); return; }
      requests.push(body); n++;
      const content = n > turns ? [{ type: "text", text: "done" }] : [{ type: "thinking", thinking: `${HIDDEN} ${"x".repeat(n * 10)}`, signature: "sig" }, { type: "tool_use", id: `t${n}`, name: "mcp__society__look", input: { n } }];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: `msg_raw_response_id_${n}`, type: "message", role: "assistant", model: n <= 3 ? "claude-haiku-5-5-20261101" : "claude-haiku-5-5-20261115", stop_reason: n > turns ? "end_turn" : "tool_use", usage: { input_tokens: 500, output_tokens: 50 }, content }));
    });
  });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r)); servers.push(s);
  return { url: `http://127.0.0.1:${(s.address() as { port: number }).port}`, requests };
}
let calls = 0;
const toolset = (): SocietyToolSet => ({
  tools: [
    { name: "look", get description() { return calls >= 4 ? "Look around. (reworded after the fourth call)" : "Look around."; }, input_schema: { type: "object", properties: {} }, run: async () => { calls++; return { ok: true, text: "a plaza" }; } },
    { name: "rest_now", description: "Rest.", input_schema: { type: "object", properties: {} }, run: async () => ({ ok: true, text: "rested" }) },
  ] as never,
  system: () => "You are a citizen.", opening: () => "You arrive.",
});

test("the snapshot, a hash of each response id, a hash of the tool definitions and the size of the thinking are recorded for every turn, and a changed snapshot and a reworded tool are named when they happen", async () => {
  calls = 0;
  const p = await provider(7);
  const events: DriverEvent[] = [];
  const r = await runCohort({ agents: ["a"], toolsetFor: () => toolset(), model: "claude-haiku-5-5", keyEnv: "K", env: { K: "sk-ant-FAKE-prov-0123456789" }, perAgentUsd: 5, totalUsd: 5, runDir: mkdtempSync(join(tmpdir(), "prov-")), upstream: p.url, signal: new AbortController().signal, economy: { historyTurns: 50 }, limits: { maxTurns: 40, maxTokens: 10_000_000 }, loop: { equivalentCalls: 1000, nearRepeats: 1000 }, onEvent: (e) => events.push(e) });
  assert.equal(r.outcomes[0]!.stopped, "finished", JSON.stringify(r.outcomes[0]));
  const turns = events.filter((e): e is Extract<DriverEvent, { kind: "turn" }> => e.kind === "turn");
  assert.equal(turns.length, 8);
  assert.deepEqual([...new Set(turns.map((t) => t.snapshot))], ["claude-haiku-5-5-20261101", "claude-haiku-5-5-20261115"], "both snapshots, in order");
  assert.ok(turns.every((t) => t.idHash && t.idHash.length === 16 && !t.idHash.includes("msg_raw")), "response ids are hashes");
  assert.equal(new Set(turns.map((t) => t.idHash)).size, 8, "a hash for each response");
  assert.ok(!JSON.stringify(events).includes("msg_raw_response_id"), "no raw response id in any event");
  // the thinking: counts only
  assert.deepEqual(turns.slice(0, 7).map((t) => t.thinkingBlocks), [1, 1, 1, 1, 1, 1, 1]);
  assert.equal(turns[0]!.thinkingChars, HIDDEN.length + 1 + 10, "the size of the first thinking, not its text");
  assert.equal(turns[7]!.thinkingBlocks, undefined, "no thinking in the last reply");
  assert.ok(!JSON.stringify(events).includes(HIDDEN), "the hidden text is never kept");
  // the tool definitions: one hash while nothing changes, another after the rewording, and the change is named
  const hashes = turns.map((t) => t.toolsHash);
  assert.ok(hashes.slice(0, 4).every((h) => h === hashes[0]), "the same hash for the first four turns");
  assert.notEqual(hashes[4], hashes[0], "a new hash once the description changed");
  const changes = events.filter((e): e is Extract<DriverEvent, { kind: "provenance_change" }> => e.kind === "provenance_change");
  const tool = changes.find((c) => c.what === "tool_definition")!;
  assert.equal(tool.name, "look"); assert.notEqual(tool.from, tool.to); assert.equal(tool.turn, 5);
  const snap = changes.find((c) => c.what === "model_snapshot")!;
  assert.equal(snap.from, "claude-haiku-5-5-20261101"); assert.equal(snap.to, "claude-haiku-5-5-20261115"); assert.equal(snap.turn, 4, "named on the first reply that carried the new snapshot");
  assert.equal(changes.length, 2, "only those two changes");
  // the request after the change carries the definition as it is now
  assert.equal(p.requests[4].tools.find((t: any) => t.name === "mcp__society__look").description, "Look around. (reworded after the fourth call)");
  assert.equal(p.requests[0].tools.find((t: any) => t.name === "mcp__society__look").description, "Look around.");
  // what the run sends is only max_tokens: the sampling and thinking are the provider's own defaults, and the run says so
  assert.equal(p.requests[0].max_tokens, REQUEST_SETTINGS.max_tokens);
  assert.ok(p.requests[0].temperature === undefined && p.requests[0].thinking === undefined && p.requests[0].top_p === undefined, "no sampling or thinking setting is sent");
  assert.equal(sha16("x").length, 16);
});
