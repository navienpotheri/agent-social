import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createGateway, CognitionTap, anthropicEvents, type Gateway } from "../src/index.ts";
import { TelemetryStore, COGNITION_CATEGORIES, categoriesFor, GATEWAY_RUNTIMES, disclosureMarkdown } from "@agent-social/asp-log";

const servers: Server[] = [];
const gateways: Gateway[] = [];
after(async () => { for (const s of servers) s.close(); for (const g of gateways) await g.close(); });

const SECRET = "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const EMAIL = "jane.doe@gmail.com";
const reply = {
  id: "m1", type: "message", role: "assistant", model: "m", stop_reason: "tool_use", usage: { input_tokens: 5, output_tokens: 5 },
  content: [
    { type: "thinking", thinking: `I should plan. My key is ${SECRET}`, signature: "s" },
    { type: "text", text: `Writing to ${EMAIL} soon` },
    { type: "tool_use", id: "t1", name: "TodoWrite", input: { todos: [{ content: "step one", status: "pending" }] } },
    { type: "tool_use", id: "t2", name: "Task", input: { subagent_type: "explorer", description: "look", prompt: "find the file" } },
    { type: "tool_use", id: "t3", name: "Skill", input: { skill: "review" } },
    { type: "tool_use", id: "t4", name: "mcp__asp__asp_memory_write", input: { path: "n.md", content: "remember this" } },
  ],
};
async function run(stream: boolean, tap: CognitionTap) {
  const server = createServer((req, res) => { req.resume(); req.on("end", () => {
    if (stream) { res.writeHead(200, { "content-type": "text/event-stream" }); for (const e of anthropicEvents(reply)) res.write(e); res.end(); } else { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(reply)); }
  }); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r)); servers.push(server);
  const up = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const g = createGateway({ anthropicUpstream: up, scopes: ["repo.read", "tool.task", "mcp.asp.asp_memory_write", "tool.skill"], cognition: tap });
  gateways.push(g);
  const port = await g.listen();
  await (await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "m", stream, max_tokens: 10, messages: [{ role: "user", content: "Fix the bug in a.ts" }] }) })).text();
}

for (const stream of [false, true]) test(`DK79: a gateway run collects the broad set without a switch and scrubs a planted secret and email before storage (stream: ${stream})`, async () => {
  const tap = new CognitionTap({ runtime: "claude-code" });
  await run(stream, tap);
  const sum = tap.summary();
  for (const c of ["goals", "messages", "reasoning", "actions"]) assert.ok(sum.categories[c], `${c} collected`);
  const items = tap.drain();
  const all = items.map((i) => i.content).join("\n");
  assert.ok(!all.includes(SECRET) && !all.includes(EMAIL), "nothing planted survives");
  assert.ok(sum.redactions.secret >= 1 && sum.redactions["email address"] >= 1);
  assert.ok(items.some((i) => i.category === "goals" && i.content.includes("Fix the bug")));
  if (!stream) for (const c of ["plans", "subagents", "skills", "memory"]) assert.ok(sum.categories[c], `${c} collected`);
  // the store: apart from the log, listable, deletable, hash kept
  const store = new TelemetryStore();
  for (const i of items) assert.ok((store.put("local", i.kind, i.content, { at: "2026-11-21T00:00:00Z" }) as { ok: boolean }).ok);
  const listed = store.list("local");
  assert.equal(listed.length, items.length);
  assert.ok(store.deleteAll("local", "2026-11-21T01:00:00Z") === items.length);
  assert.ok(store.list("local").every((e) => e.deletedAt && e.hash));
});

test("DK79: a category the runtime does not expose is not collected", () => {
  const tap = new CognitionTap({ runtime: "generic" });
  tap.observeCall({ name: "TodoWrite", args: { todos: [] }, scope: "x", allowed: true });
  tap.observeReply({ thinking: "secret thoughts" });
  const s = tap.summary();
  assert.equal(s.categories.plans, undefined);
  assert.equal(s.categories.reasoning, undefined);
  assert.equal(s.categories.actions, 1);
});

test("DK79: a young person's tenant: nothing is collected, and a private tenant stores a hash only", () => {
  const off = new CognitionTap({ runtime: "claude-code", enabled: false });
  off.observeRequest({ messages: [{ role: "user", content: "hello" }] });
  off.observeCall({ name: "x", args: {}, scope: "a", allowed: true });
  assert.deepEqual(off.drain(), []);
  assert.equal(off.summary().status, "cognition: off");
  const store = new TelemetryStore();
  assert.equal((store.put("kid", "plan", "{}", { minor: true, at: "t" }) as { ok: boolean }).ok, false);
  const p = store.put("corp", "plan", "{\"a\":1}", { private: true, at: "t" }) as { stored: boolean };
  assert.equal(p.stored, false);
  assert.equal(store.list("corp")[0].hashOnly, true);
});

test("DK79: the disclosure names every category the code collects, and the document is the generated one", () => {
  const collected = new Set(COGNITION_CATEGORIES.filter((c) => c.exposedBy.length).map((c) => c.id));
  const tap = new CognitionTap({ runtime: "claude-code" });
  tap.observeRequest({ messages: [{ role: "user", content: "task" }] });
  tap.observeReply({ text: "t", thinking: "r" });
  for (const [name, args] of [["TodoWrite", {}], ["Task", {}], ["Skill", { skill: "s" }], ["asp_memory_write", { x: 1 }]] as [string, object][]) tap.observeCall({ name, args, scope: "s", allowed: true });
  for (const c of Object.keys(tap.summary().categories)) assert.ok(collected.has(c), `${c} is in the registry`);
  for (const c of collected) assert.ok(Object.keys(tap.summary().categories).includes(c), `${c} is collected by claude-code`);
  const doc = disclosureMarkdown();
  for (const c of COGNITION_CATEGORIES.filter((x) => x.exposedBy.length)) assert.ok(doc.includes(`**${c.title} (content):**`), `${c.id} is disclosed`);
  for (const r of GATEWAY_RUNTIMES) assert.ok(categoriesFor(r).length > 0);
});
