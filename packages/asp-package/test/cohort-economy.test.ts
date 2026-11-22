// ENG15, the token economy of the cohort driver: the static prefix is marked for the provider's cache, the history is bounded (the oldest exchanges go, the agent's own summary stands in), a call whose whole input passes
// the ceiling starts again from the opening and the summary, and on the same scripted run the economical driver sends far fewer billed-equivalent tokens than the version-0 behaviour. A stand-in provider that models the
// cache: the marked prefix is read from the cache after the first call. Also the engine's observation budget and digest, and the boundaries of the wait limits. Fake key.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCohort, DEFAULT_ECONOMY, LEGACY_ECONOMY, Life, SimClock, type DriverEvent, type LifeEvent, type SocietyToolSet } from "../src/index.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
type Seen = { messages: any[]; marked: boolean; systemMarked: boolean; chars: number; prefixChars: number };

/** A provider that counts tokens as 4 characters each, and when the request marks its prefix, reports the prefix (after the first call) as cache reads. */
async function provider(turns: number) {
  const seen: Seen[] = []; let cached = false, reqs = 0;
  const s = createServer((req, res) => {
    const chunks: Buffer[] = []; req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      if (!/\/v1\/messages$/.test(req.url ?? "")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ input_tokens: 10 })); return; }
      const tools = body.tools ?? [];
      const marked = !!tools.at(-1)?.cache_control, systemMarked = Array.isArray(body.system) && !!body.system[0]?.cache_control;
      const prefixChars = JSON.stringify(tools).length + JSON.stringify(body.system).length;
      const chars = JSON.stringify(body).length;
      seen.push({ messages: body.messages, marked, systemMarked, chars, prefixChars });
      const total = Math.ceil(chars / 4), prefix = Math.ceil(prefixChars / 4);
      const usage = marked ? (cached ? { input_tokens: total - prefix, output_tokens: 60, cache_read_input_tokens: prefix } : { input_tokens: total - prefix, output_tokens: 60, cache_creation_input_tokens: prefix }) : { input_tokens: total, output_tokens: 60 };
      if (marked) cached = true;
      const n = ++reqs;
      const content = n >= turns ? [{ type: "text", text: "done" }] : [{ type: "tool_use", id: `t${n}`, name: "mcp__society__big", input: {} }];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: content[0]!.type === "tool_use" ? "tool_use" : "end_turn", usage, content }));
    });
  });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r)); servers.push(s);
  return { url: `http://127.0.0.1:${(s.address() as { port: number }).port}`, seen };
}
const toolset = (): SocietyToolSet => ({
  tools: Array.from({ length: 12 }, (_, i) => ({ name: i === 0 ? "big" : `tool_${i}`, description: "A tool of the society with a description that takes some room. ".repeat(6), input_schema: { type: "object", properties: {} }, run: async () => ({ ok: true, text: "x".repeat(1500) }) })),
  system: () => "You are a citizen. ".repeat(80), opening: () => "You arrive.", summary: () => "- did a thing\n- did another",
});
const run = async (url: string, economy: Partial<typeof DEFAULT_ECONOMY>, events: DriverEvent[] = []) =>
  runCohort({ agents: ["a"], toolsetFor: () => toolset(), model: "claude-haiku-5-5", keyEnv: "K", env: { K: "sk-ant-FAKE-eco-0123456789" }, perAgentUsd: 5, totalUsd: 5, runDir: mkdtempSync(join(tmpdir(), "eco-")), upstream: url, signal: new AbortController().signal, economy, limits: { maxTurns: 40, maxTokens: 10_000_000 }, loop: { equivalentCalls: 1000, nearRepeats: 1000 }, onEvent: (e) => events.push(e) });
const billed = (seen: Seen[]) => { let b = 0, first = true; for (const r of seen) { const total = Math.ceil(r.chars / 4), prefix = Math.ceil(r.prefixChars / 4); b += r.marked ? (total - prefix) + (first ? prefix * 1.25 : prefix * 0.1) : total; first = false; } return b; };

test("the static prefix is marked for the cache (the end of the tools and of the briefing) and the history is bounded to the last exchanges with the summary standing in; version 0 marks nothing and keeps everything", async () => {
  const eco = await provider(16);
  const events: DriverEvent[] = [];
  const r = await run(eco.url, { cache: true, historyTurns: 4 }, events);
  assert.equal(r.outcomes[0]!.stopped, "finished");
  assert.ok(eco.seen.every((s) => s.marked && s.systemMarked), "every request marks the tool list and the briefing");
  assert.ok(Math.max(...eco.seen.map((s) => s.messages.length)) <= 1 + 2 * 4, "never more than the opening and four exchanges");
  assert.ok(events.some((e) => e.kind === "compact" && e.why === "history"));
  const late = eco.seen.at(-1)!.messages[0].content as string;
  assert.match(late, /What you have done so far.*did a thing/s, "the summary stands in for the dropped exchanges");
  const turnEvents = events.filter((e): e is Extract<DriverEvent, { kind: "turn" }> => e.kind === "turn");
  assert.ok(turnEvents.slice(1).every((e) => (e.cacheRead ?? 0) > 0), "the cache reads are counted from the second turn");
  assert.ok((turnEvents[0]!.cacheWrite ?? 0) > 0, "the first turn writes the cache");

  const v0 = await provider(16);
  await run(v0.url, LEGACY_ECONOMY);
  assert.ok(v0.seen.every((s) => !s.marked && !s.systemMarked));
  assert.equal(v0.seen.at(-1)!.messages.length, 1 + 2 * 15, "version 0 sends the whole history");
});

test("on the same scripted run the economical driver sends less than half the billed-equivalent input tokens of version 0", async () => {
  const eco = await provider(30), v0 = await provider(30);
  await run(eco.url, DEFAULT_ECONOMY);
  await run(v0.url, LEGACY_ECONOMY);
  const e = billed(eco.seen), l = billed(v0.seen);
  assert.ok(e < l * 0.5, `economical ${Math.round(e)} against version 0 ${Math.round(l)} billed-equivalent tokens`);
});

test("a call whose whole input passes the per-call ceiling starts the next one again from the opening and the summary", async () => {
  const p = await provider(8);
  const events: DriverEvent[] = [];
  await run(p.url, { cache: true, historyTurns: 50, maxInputPerCall: 500 }, events);
  assert.ok(events.some((e) => e.kind === "compact" && e.why === "ceiling"));
  assert.ok(p.seen.slice(1).every((s) => s.messages.length <= 3), "the history never builds up past the ceiling");
  assert.match(p.seen.at(-1)!.messages[0].content as string, /did a thing/);
});

// ---- the engine's observation budget, digest and wait boundaries ----
function fake() {
  let real = 0;
  const clock = new SimClock({ speed: 1000, now: () => real });
  return { clock, sleep: async (ms: number) => { real += ms; } };
}
const ctx = () => ({ agent: "a", turn: 1, now: () => "t", signal: new AbortController().signal });

test("boundaries: a wait of exactly the minimum and exactly the maximum is allowed, a wait for time alone is allowed, a notebook filled to exactly its cap is accepted", async () => {
  const f = fake();
  const life = new Life({ clock: f.clock, source: { kinds: ["reply"], poll: async () => ({ events: [], cursor: 1 }) }, notebookDir: mkdtempSync(join(tmpdir(), "asp-life-")), sleep: f.sleep, limits: { notebookChars: 20 } });
  const t = (n: string) => life.agent("a").tools().find((x) => x.name === n)!;
  assert.equal(((await t("rest").run({ until: "5m" }, ctx())) as { ok: boolean }).ok, true, "exactly the shortest wait");
  assert.equal(((await t("rest").run({ until: "7d" }, ctx())) as { ok: boolean }).ok, true, "exactly the longest wait");
  assert.equal(((await t("wait_for").run({ events: ["time"], max_wait: "10m" }, ctx())) as { ok: boolean }).ok, true, "time is always an event");
  assert.equal(((await t("notebook_write").run({ text: "x".repeat(20) }, ctx())) as { ok: boolean }).ok, true, "exactly the cap");
});

test("an observation stays inside its character budget however many events there are, drops events first (and counts them), cuts the digest and the summary, and keeps the notebook whole; the digest is refreshed every few wakes, not every tick", async () => {
  const f = fake();
  const raised: LifeEvent[] = Array.from({ length: 60 }, (_, i) => ({ kind: "reply" as const, at: i, text: `someone answered you with a long remark number ${i} `.repeat(8) }));
  let digestCalls = 0;
  const life = new Life({ clock: f.clock, source: { kinds: ["reply"], poll: async (_a, c) => (c ? { events: [], cursor: 1 } : { events: raised, cursor: 1 }) }, notebookDir: mkdtempSync(join(tmpdir(), "asp-life-")), sleep: f.sleep,
    limits: { observationChars: 1200, digestEveryWakes: 3 }, digest: async () => { digestCalls++; return `state ${digestCalls}: ` + "posts and jobs ".repeat(200); } });
  await life.refreshDigest(true);
  const a = life.agent("a");
  for (let i = 0; i < 30; i++) a.noteAction("forum_post", true, "a title that is rather long ".repeat(5));
  const nb = "my notes";
  await a.tools().find((x) => x.name === "notebook_write")!.run({ text: nb }, ctx());
  const r = await a.tools().find((x) => x.name === "wait_for")!.run({ events: ["reply"], max_wait: "1h" }, ctx());
  const body = r.text.slice(0, r.text.indexOf("Your notebook ("));
  assert.ok(body.length <= 1200 + 2, `observation ${body.length} chars`);
  assert.match(r.text, /and \d+ more \(coalesced\)|\[cut to the budget\]/);
  assert.ok(r.text.endsWith(`Your notebook (${nb.length} of 4000 characters):\n${nb}`), "the notebook is whole");
  assert.match(r.text, /The state of the society/);
  assert.ok((a.summaryText() ?? "").length <= 700, "the summary is cut");
  const before = digestCalls;
  await a.tools().find((x) => x.name === "rest")!.run({ until: "10m" }, ctx());
  assert.equal(digestCalls, before, "no refresh on the next wake");
  await a.tools().find((x) => x.name === "rest")!.run({ until: "10m" }, ctx());
  assert.equal(digestCalls, before + 1, "refreshed on the third wake since the last digest");
});
