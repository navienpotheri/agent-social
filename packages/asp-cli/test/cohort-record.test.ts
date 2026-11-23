// Rows UC-2197..: outcomes are recorded, not steered: offer collisions with the tick of each refused offer and of the winning one, deliveries the house check refused (how many, by how many agents, tried again, then passed);
// the first minute is short: the greeter's welcome is a few lines, the map is a list (places one line each, agents summarised and paged), and the free-first-job line is at the board, not in every balance line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collisionReport, deliveryReport, renderCollisions, renderDeliveries } from "../src/cohort/collisions.ts";
import { renderFirstMinute } from "../src/cohort/talk.ts";
import { runTool, stripExtras, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));
const tool = (agent: string, turn: number, at: string, name: string, input: Record<string, unknown>, ok: boolean, chars = 10) => ({ t: "tool", at, agent, turn, tool: name, input, ok, ...(ok ? {} : { refused: "market_refused" }), chars, institution: "market", scope: "write.market", writes: true, ms: 0 });

test("a collision is recorded with the tick of the refused offer and of the winning one", () => {
  const ev = [tool("agent-01", 3, "2026-11-23T11:52:10.000Z", "offer_on_job", { job: "J" }, true), tool("agent-02", 4, "2026-11-23T11:52:12.000Z", "offer_on_job", { job: "J" }, false)] as never[];
  const r = collisionReport(ev, false);
  assert.deepEqual([r.collisions[0]!.tick, r.collisions[0]!.winnerTick], [4, 3]);
  assert.match(renderCollisions(r), /Ticks \(turn numbers of the refused offer, with the winning offer's\): agent-02 t4 \(agent-01 t3\)\./);
});

test("deliveries refused by the house check are their own measure: how many, by how many agents, tried again, then passed", () => {
  const d = (a: string, t: number, ok: boolean, c = "C1") => tool(a, t, `2026-11-23T11:5${t}:00.000Z`, "deliver_job", { contract: c }, ok);
  const ev = [d("agent-01", 1, false), d("agent-01", 2, true), d("agent-02", 3, false, "C2"), d("agent-03", 4, true, "C3")] as never[];
  const r = deliveryReport(ev);
  assert.deepEqual([r.refused, r.agents, r.retried, r.passed, r.delivered], [2, 2, 1, 1, 2]);
  assert.match(renderDeliveries(r), /## Deliveries refused by the house check\n\n2 deliveries were refused by the house check \(by 2 agents\); 1 contract had a delivery tried again, and 1 then passed\. 2 deliveries were accepted in all\./);
});

test("the first minute is short: a compact map (places one line each, agents summarised, paged on request), a short welcome, and the free-first-job line only at the board", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-rec-")) });
  try {
    const hall = w.api.market!;
    const a = await w.enrol(0, "agent-01"); await hall.enrolStandalone(a);
    const call = (name: string, input: Record<string, unknown> = {}) => runTool(w.api, a, all, name, input);
    const map = await call("look_map");
    assert.ok(stripExtras(map.text).length < 900, `${stripExtras(map.text).length} characters (the raw feed was 3,725)`);
    assert.match(map.text, /The map: 12 places \(inspect <id> looks closely at one\)\.\s+- registry: Registry/);
    assert.match(map.text, /Agents: [0-9]+ in all, [0-9]+ of them house programs; [0-9]+ are agents like you\. look_map with page 1 lists them, ten to a page\./);
    assert.match((await call("look_map", { page: 1 })).text, /Agents 1 to [0-9]+:\n- /);
    const welcome = (await hall.inbox(a))[0]!.text ?? "";
    assert.ok(welcome.length < 700, `${welcome.length} characters`);
    assert.match(welcome, /^Welcome, agent-01\. I am the house greeter, a program, not another agent\./);
    assert.doesNotMatch((await call("my_balance")).text.split("\n\n")[0]!, /first job you post is free/);
    assert.match((await call("look_jobs")).text, /The first job you post is free/);
    const ev = [tool("agent-01", 1, "2026-11-23T11:52:10.000Z", "look_map", {}, true, 1800), tool("agent-01", 2, "2026-11-23T11:52:11.000Z", "my_inbox", {}, true), tool("agent-01", 3, "2026-11-23T11:52:12.000Z", "look_jobs", {}, true), tool("agent-01", 4, "2026-11-23T11:52:13.000Z", "my_balance", {}, true)] as never[];
    assert.match(renderFirstMinute(ev), /averaged 1800 characters over 1 agents .*1 of 1 agents that made four calls made the same first four calls/);
  } finally { await w.close(); }
});
