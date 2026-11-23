// Row DK1313: what living in the society costs in tokens, read from the trace: tokens in and out for each agent, per simulated day, the cost for each agent-hour, and the share spent on reading, writing and resting; and one plain
// true line, in what the agent sees, about its own allowance (a fact, never a request; nothing is withheld). Seeded traces; no model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allowanceLine, renderTokenUse, tokenUse } from "../src/cohort/token-use.ts";
import { openItems } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const at = (s: number): string => new Date(Date.UTC(2026, 10, 24, 10, 0, s)).toISOString();
const model = (agent: string, turn: number, s: number, input: number, output: number, usd: number) => ({ t: "model", at: at(s), agent, turn, input, output, cacheWrite: 0, usd });
const tool = (agent: string, turn: number, name: string, writes: boolean) => ({ t: "tool", at: at(0), agent, turn, tool: name, input: {}, ok: true, chars: 1, institution: "x", scope: "x", writes, ms: 0 });

test("tokens in and out, the cost for each agent-hour, per simulated day, and the share by what the turn did", () => {
  const ev = [
    model("a", 1, 0, 1000, 100, 0.01), model("a", 2, 1800, 2000, 100, 0.02), model("a", 3, 3600, 3000, 100, 0.03), model("b", 1, 0, 500, 50, 0.005),
    tool("a", 1, "look_jobs", false), tool("a", 2, "forum_post", true), tool("a", 3, "rest", false),
    { t: "wake", agent: "a", simMs: 2 * 86_400_000, at: at(0) },
  ] as never[];
  const u = tokenUse(ev);
  assert.deepEqual([u.agents, u.turns, u.tokensIn, u.tokensOut, u.usd], [2, 4, 6500, 350, 0.065]);
  assert.equal(u.agentHours, 1, "agent a spans one hour between its first and last turn; b has one turn");
  assert.equal(u.usdPerAgentHour, 0.065);
  assert.equal(u.simDays, 2);
  assert.equal(u.tokensPerSimDay, Math.round(6850 / 2 / 2));
  assert.deepEqual(u.share, { read: 1100, write: 2100, rest: 3100, none: 550 }, "read turn 1, write turn 2, rest turn 3; b has no recorded act");
  const md = renderTokenUse(ev);
  assert.match(md, /^## What living here costs in tokens\n\n4 model turns by 2 agents used 6500 tokens in and 350 out \(\$0\.065\)\. That is \$0\.065 for each agent-hour \(1 agent-hours between each agent's first and last turn\); 1713 tokens for each agent for each simulated day \(2\.00 days on the run's clock\)\. By what the turn did: reading 16%, writing 31%, resting or keeping notes 45%, turns with no recorded act 8%\./);
  assert.match(md, /no rule lowers the cost of a turn \(DK1313's token-saving layer is not built\), and this is one run\./);
  assert.match(renderTokenUse([] as never[]), /No model turns were recorded in this run, so there is nothing to measure\./);
});

test("the line about the allowance is a fact and a number, appears only once something is used, and asks for nothing", async () => {
  assert.equal(allowanceLine(0, 0.4), undefined);
  assert.equal(allowanceLine(0.1, 0.4), "your allowance for this run: about 25% of $0.40 is used (a fact; nothing asks you to stop or to hurry)");
  assert.match(allowanceLine(5, 0.4)!, /about 100% of/, "never more than a hundred");
  assert.doesNotMatch(allowanceLine(0.3, 0.4)!, /you (must|should)|save|hurry up|stop now/i);
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-tok-")) });
  try {
    const a = await w.enrol(0, "agent-01"); await w.api.market!.enrolStandalone(a);
    assert.ok(!(await openItems(w.api, a)).some((x) => /your allowance/.test(x)), "nothing is said when no budget is known");
    w.api.budgetOf = () => ({ usedUsd: 0.1, capUsd: 0.4 });
    assert.equal((await openItems(w.api, a))[0], "your allowance for this run: about 25% of $0.40 is used (a fact; nothing asks you to stop or to hurry)");
    w.api.budgetOf = () => ({ usedUsd: 0, capUsd: 0.4 });
    assert.ok(!(await openItems(w.api, a)).some((x) => /your allowance/.test(x)));
  } finally { await w.close(); }
});
