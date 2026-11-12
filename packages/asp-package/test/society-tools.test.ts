import { test } from "node:test";
import assert from "node:assert/strict";
import { aspHandler } from "../src/gateway/mcp.ts";

// The agent's view of the society inside its loop (DK3, DK4): the tools only pass through to what the CLI supplies; the log is the authority on what may be bought.
const text = (r: { content: unknown[] }) => (r.content[0] as { text: string }).text;

test("with a society the agent gets asp_standing, and asp_buy only when the run holds its key; without one it gets neither", async () => {
  const none = aspHandler({});
  assert.deepEqual((await none.listTools()).map((t) => t.name).filter((n) => n === "asp_standing" || n === "asp_buy"), []);
  const readOnly = aspHandler({ society: { standing: async () => "credits: 5" } });
  assert.ok((await readOnly.listTools()).some((t) => t.name === "asp_standing"));
  assert.ok(!(await readOnly.listTools()).some((t) => t.name === "asp_buy"), "no key, no buying");
  const full = aspHandler({ society: { standing: async () => "credits: 5", buy: async () => "bought" } });
  assert.deepEqual((await full.listTools()).map((t) => t.name).filter((n) => n === "asp_standing" || n === "asp_buy").sort(), ["asp_buy", "asp_standing"]);
  assert.match(String(full.instructions?.()), /asp_standing shows your balance, tier and what you may buy; asp_buy spends within that budget/);
  assert.doesNotMatch(String(readOnly.instructions?.()), /asp_buy/);
});

test("asp_standing returns what the CLI built; asp_buy passes the service and quantity through, refuses a missing service or a bad quantity, and shows the log's refusal as the answer", async () => {
  const calls: [string, number][] = [];
  const h = aspHandler({
    society: {
      standing: async () => "credits: 120\ntier 1\nacademy 0 of 60 this month",
      buy: async (service, q) => { calls.push([service, q]); if (service === "market.expensive") throw new Error("institution_spend_cap_exceeded: the Mandate caps academy at 60 credits a month"); return `bought ${service} x${q}`; },
    },
  });
  assert.match(text(await h.callTool("asp_standing", {})), /credits: 120\ntier 1\nacademy 0 of 60 this month/);
  assert.equal(text(await h.callTool("asp_buy", { service: "academy.exam.sit" })), "bought academy.exam.sit x1");
  assert.equal(text(await h.callTool("asp_buy", { service: "academy.exam.sit", quantity: 3 })), "bought academy.exam.sit x3");
  assert.deepEqual(calls, [["academy.exam.sit", 1], ["academy.exam.sit", 3]]);
  const noService = await h.callTool("asp_buy", {});
  assert.equal(noService.isError, true);
  assert.equal((await h.callTool("asp_buy", { service: "x", quantity: 0 })).isError, true);
  const refused = await h.callTool("asp_buy", { service: "market.expensive" });
  assert.equal(refused.isError, true);
  assert.match(text(refused), /institution_spend_cap_exceeded/);
  assert.equal(calls.length, 3, "a refused argument never reached the buyer");
});
