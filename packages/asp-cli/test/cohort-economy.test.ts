// ENG15 in the command: `asp society cohort plan` prints the expected and the worst-case dollars of each rung before anything is spent, a real run prints the plan for its own size, and the report says what the run
// cost the person who pays: median tokens a tick, the cache share, tokens per useful action, cost per engaged hour. A stand-in provider that reports cache tokens. Fake key.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";
import { economyOf, renderEconomy } from "../src/cohort/economy.ts";
import { plan, staticPrefixTokens } from "../src/cohort/plan.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
async function asp(args: string[]) {
  const home = mkdtempSync(join(tmpdir(), "asp-eco-home-"));
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home, ECO_KEY: "sk-ant-api03-FAKE-eco-0123456789abcdef" }, cwd: home };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

test("the planner prints, for each rung, the expected dollars (with the cache and without) and the worst case (the cap, never more than the total), with its assumptions; an unpriced model is said to be", async () => {
  const r = await asp(["society", "cohort", "plan", "--model", "claude-haiku-5-5", "--agents", "1,3,15", "--budget-usd", "0.40", "--total-usd", "6"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /\s1 agent :? ?expected about \$\d+\.\d\d \(about \$\d+\.\d\d without the cache\), worst case \$0\.40/);
  assert.match(r.out, /\s3 agents: expected about .*worst case \$1\.20/);
  assert.match(r.out, /15 agents: expected about .*worst case \$6\.00/);
  assert.match(r.out, /the static prefix \(briefing and tools\) is [\d,]+ tokens; with the cache it is written once at 1\.25x and read at 0\.1x/);
  const nums = [...r.out.matchAll(/expected about \$(\d+\.\d\d) \(about \$(\d+\.\d\d) without the cache\)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.equal(nums.length, 3);
  assert.ok(nums.every(([withCache, without]) => withCache < without), "the cache is worth something in every rung");
  const capped = await asp(["society", "cohort", "plan", "--model", "claude-haiku-5-5", "--agents", "15", "--budget-usd", "0.40", "--total-usd", "5"]);
  assert.match(capped.out, /15 agents: expected about .*worst case \$5\.00/, "the worst case never passes the run's total cap");
  const short = await asp(["society", "cohort", "plan", "--model", "claude-haiku-5-5", "--agents", "1", "--budget-usd", "5", "--ticks", "10"]);
  const long = await asp(["society", "cohort", "plan", "--model", "claude-haiku-5-5", "--agents", "1", "--budget-usd", "5"]);
  const first = (t: string) => Number(/expected about \$(\d+\.\d\d)/.exec(t)![1]);
  assert.ok(first(long.out) > first(short.out) * 2, "the default is many more ticks than ten");
  assert.match(long.out, /40 ticks an agent/);
  const unpriced = await asp(["society", "cohort", "plan", "--model", "brand-new", "--agents", "1", "--budget-usd", "0.4"]);
  assert.match(unpriced.out, /brand-new is not in the price table/);
  assert.equal((await asp(["society", "cohort", "plan", "--budget-usd", "0.4"])).code, 2);
  assert.ok(staticPrefixTokens() > 500, "the prefix is measured from the real tool list and briefing");
  const p = plan({ model: "claude-haiku-5-5", rungs: [15], capPerAgent: 0.0001 });
  assert.ok(p.rungs[0]!.expectedUsd <= 15 * 0.0001 + 1e-9, "the expected figure never passes the cap an agent has");
});

test("a real run prints the plan of its own size, and the report says what it cost: ticks, cache share, billed-equivalent tokens, tokens per useful action", { timeout: 120_000 }, async () => {
  let n = 0;
  const s: Server = createServer((req, res) => {
    const chunks: Buffer[] = []; req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (!/\/v1\/messages$/.test(req.url ?? "")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ input_tokens: 10 })); return; }
      const k = ++n;
      const content = k === 1 ? [{ type: "tool_use", id: "a", name: "mcp__society__forum_post", input: { title: "Hi", text: "Hello there." } }] : k === 2 ? [{ type: "tool_use", id: "b", name: "mcp__society__look_charters", input: {} }] : [{ type: "tool_use", id: "c", name: "mcp__society__leave", input: { reason: "done" } }];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "tool_use", usage: k === 1 ? { input_tokens: 400, output_tokens: 50, cache_creation_input_tokens: 2000 } : { input_tokens: 300, output_tokens: 50, cache_read_input_tokens: 2000 }, content }));
    });
  });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r)); servers.push(s);
  const url = `http://127.0.0.1:${(s.address() as { port: number }).port}`;
  const out = mkdtempSync(join(tmpdir(), "asp-eco-out-"));
  const r = await asp(["society", "cohort", "--local", "--agents", "1", "--model", "claude-haiku-5-5", "--api-key-env", "ECO_KEY", "--budget-usd", "0.40", "--provider-url", url, "--out", out]);
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /plan \(per rung; the cap is \$0\.4 an agent, \$0\.4 in all\)/);
  const dir = join(out, readdirSync(out).find((d) => d.startsWith("cohort-"))!);
  const md = readFileSync(join(dir, "report.md"), "utf8");
  assert.match(md, /## What it cost the person who pays \(token economy\)/);
  assert.match(md, /\*\*Ticks \(model calls\):\*\* 3;/);
  assert.match(md, /\*\*Cache:\*\* 57% of the input tokens came from the provider's cache/);
  const eco = JSON.parse(readFileSync(join(dir, "economy.json"), "utf8")) as { calls: number; usefulActions: number; billedTokensPerUsefulAction: number; cacheHitShare: number; medianInputPerCall: number };
  assert.equal(eco.calls, 3);
  assert.equal(eco.usefulActions, 1, "one post went through");
  assert.ok(eco.billedTokensPerUsefulAction > 0 && eco.medianInputPerCall === 2300);
  assert.ok(Math.abs(eco.cacheHitShare - 4000 / 7000) < 1e-9);
  assert.equal((await asp(["society", "cohort", "verify", dir])).code, 0);
});

test("the economy of a trace: median input per tick, the largest, the cache share, billed-equivalent tokens (writes at 1.25, reads at 0.1) and the cost per engaged hour", () => {
  const at = (m: number) => new Date(Date.UTC(2026, 10, 22, 10, m)).toISOString();
  const ev = [
    { t: "agent", at: at(0), agent: "a", did: "d", handle: "a" },
    { t: "model", at: at(0), agent: "a", turn: 1, input: 100, output: 10, cacheWrite: 1000, usd: 0.01 },
    { t: "tool", at: at(1), agent: "a", turn: 1, tool: "forum_post", input: {}, ok: true, chars: 1, institution: "forum", scope: "s", writes: true, ms: 1 },
    { t: "model", at: at(30), agent: "a", turn: 2, input: 200, output: 20, cacheRead: 1000, usd: 0.005 },
    { t: "tool", at: at(30), agent: "a", turn: 2, tool: "look_map", input: {}, ok: true, chars: 1, institution: "map", scope: "s", writes: false, ms: 1 },
    { t: "end", at: at(60), agent: "a", reason: "left: x", turns: 2, usd: 0.015 },
  ] as never[];
  const r = economyOf(ev);
  assert.equal(r.calls, 2);
  assert.equal(r.medianInputPerCall, Math.round((1100 + 1200) / 2));
  assert.equal(r.maxInputPerCall, 1200);
  assert.equal(r.billedEquivalentTokens, Math.round(100 + 10 + 1000 * 1.25 + 200 + 20 + 1000 * 0.1));
  assert.equal(r.usefulActions, 1);
  assert.ok(Math.abs(r.cacheHitShare - 1000 / 2300) < 1e-9);
  assert.equal(r.engagedHours, 1);
  assert.equal(r.usdPerEngagedHour, 0.015);
  assert.match(renderEconomy(r), /\$0\.0150 an agent-hour/);
});
