// Register row ENG28 (docs/agent-engagement-ideas.md): the credit economy balance. The report has a flow table for each rung with the faucets and the sinks, the credit audit balances, the median agent's figure (what the
// doable jobs pay less what the writes they need cost) is stated, a rung whose figure is not above zero or whose flows are not built is PARTIAL, and a run in which doing nothing beats acting says so. Stand-in agents only.
// Credits are mock accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUNGS, creditEconomyOf, renderCreditEconomy, type CreditEconomyInput } from "../src/cohort/credit-economy.ts";
import { runCohort } from "../src/cohort/run.ts";
import { standInProvider } from "../src/cohort/provider.ts";

const zeroFlows = (over: Record<string, unknown> = {}): CreditEconomyInput["flows"] => ({ settlements: { count: 0, escrowReleased: 0, fees: 0, bondReturned: 0, bondSlashed: 0, byBasis: {} }, purchases: { count: 0, amount: 0, provider: 0, treasury: 0, burned: 0, byService: {} }, ...over } as never);
const audit = (over: Record<string, unknown> = {}): CreditEconomyInput["audit"] => ({ verdict: "balanced", minted: 100, balances: 100, locked: { total: 0 }, difference: 0, problems: [], ...over } as never);
const input = (over: Partial<CreditEconomyInput> = {}): CreditEconomyInput => ({ flows: zeroFlows(), audit: audit(), agents: [], startCredits: 100, jobTaxPermille: 20, depositPrice: 2, ...over });

test("the flow table names every faucet and sink of every rung; what is not built has no amount, and none is invented", () => {
  const e = creditEconomyOf(input({ agents: [{ id: "a", tools: {} }, { id: "b", tools: {} }] }));
  const rungs = new Set(e.flows.map((f) => f.rung));
  assert.deepEqual([...rungs], RUNGS.map((r) => r.rung), "one block of rows for each rung");
  for (const name of ["starting credits", "job pay", "job tax", "posting deposit", "tuition", "library royalties", "rent and furnishing", "first-job bonus", "tips", "long-form posts", "promotion", "expedition and discovery pay", "game prizes"]) assert.ok(e.flows.some((f) => f.flow === name), `${name} is in the table`);
  assert.ok(e.flows.some((f) => f.kind === "faucet") && e.flows.some((f) => f.kind === "sink"));
  for (const f of e.flows.filter((x) => x.rung !== "now")) { assert.equal(f.credits, null, `${f.flow} is not built`); assert.equal(f.status, "not built"); assert.match(f.note, /owner's to set/); }
  assert.equal(e.flows.find((f) => f.flow === "starting credits")!.credits, 200, "two agents at 100 each");
});

test("the median agent's figure is the board's pay share less the cost of the writes; above zero the built rung is ok, at or below zero it is partial, and every unbuilt rung is partial", () => {
  const agents = Array.from({ length: 4 }, (_, i) => ({ id: `a${i}`, tools: {} }));
  const ok = creditEconomyOf(input({ agents, boardBudgets: [20, 20, 20] }));
  assert.equal(ok.median.boardPay, 60); assert.equal(ok.median.payShare, 15); assert.equal(ok.median.netPerAgent, 15);
  assert.equal(ok.rungs.find((r) => r.rung === "now")!.row, "ok");
  const none = creditEconomyOf(input({ agents, boardBudgets: [] }));
  assert.equal(none.rungs.find((r) => r.rung === "now")!.row, "partial", "no job on the board: the figure is not above zero");
  for (const r of ok.rungs.filter((x) => x.rung !== "now")) { assert.equal(r.row, "partial"); assert.equal(r.net, null); assert.match(r.why, /not built/); }
});

test("the null action: when agents that acted end with no more credits than agents that did nothing, the report says so; when acting pays, it says that; with one group empty it gives no answer", () => {
  const act = (id: string, change: number) => ({ id, creditsStart: 100, creditsEnd: 100 + change, tools: { offer_on_job: 1 } });
  const idle = (id: string, change: number) => ({ id, creditsStart: 100, creditsEnd: 100 + change, tools: { do_nothing: 3 } });
  const worse = creditEconomyOf(input({ agents: [act("a", -2), act("b", -4), idle("c", 0), idle("d", 0)] }));
  assert.equal(worse.observed.nullDominates, true);
  assert.match(renderCreditEconomy(worse), /the null action dominates in this run, and the row stays partial/);
  const better = creditEconomyOf(input({ agents: [act("a", 18), act("b", 20), idle("c", 0)] }));
  assert.equal(better.observed.nullDominates, false);
  assert.match(renderCreditEconomy(better), /Acting did better than doing nothing/);
  const open = creditEconomyOf(input({ agents: [idle("c", 0)] }));
  assert.equal(open.observed.nullDominates, null);
  assert.match(renderCreditEconomy(open), /no comparison in this run/);
});

test("on a real stand-in world: a poster and a worker hire each other, the report has the flow table with measured job pay and tax, the audit balances and the figure for the median agent is stated", { timeout: 300_000 }, async () => {
  const r = await runCohort({ out: mkdtempSync(join(tmpdir(), "asp-econ-out-")), home: mkdtempSync(join(tmpdir(), "asp-econ-home-")), agents: 3, model: "stand-in", provider: standInProvider((i) => ["hirer", "worker", "idler"][i]!, { latencyMs: 25 }), staggerMs: 150, budgetUsd: 1, totalUsd: 3, minutes: 2, priceIn: 1, priceOut: 5, maxTurns: 60, io: { out: () => undefined } });
  const md = readFileSync(r.markdownPath, "utf8");
  assert.match(md, /## The credit economy: faucets against sinks, for each rung/);
  const e = JSON.parse(readFileSync(join(r.dir, "credit-economy.json"), "utf8")) as ReturnType<typeof creditEconomyOf>;
  assert.equal(e.audit.verdict, "balanced", `the books balance: ${e.audit.problems.join("; ")}`);
  assert.equal(e.audit.difference, 0);
  const row = (f: string) => e.flows.find((x) => x.rung === "now" && x.flow === f)!;
  assert.ok(row("job pay").credits! > 0, "the worker was paid");
  assert.ok(row("job tax").credits! >= 0 && row("posting deposit").credits! >= 2, "the poster's deposit was paid");
  assert.equal(row("starting credits").credits, 300);
  assert.ok(e.median.netPerAgent > 0 && e.rungs.find((x) => x.rung === "now")!.row === "ok");
  assert.match(md, /The median agent, in the world as built/);
  assert.match(md, /PARTIAL/, "the unbuilt rungs are marked partial");
  assert.equal(e.observed.activeAgents, 2); assert.equal(e.observed.idleAgents, 1);
  assert.equal(typeof e.observed.nullDominates, "boolean", "the run has acted and idle agents, so it answers the null-action question");
});

test("the tuition and deposit rows are measured from the purchases by service, and equal medians count as the null action not losing", () => {
  const flows = zeroFlows({ purchases: { count: 2, amount: 32, provider: 0, treasury: 0, burned: 0, byService: { "academy.course.foundations": { count: 1, amount: 30 }, "market.posting.deposit": { count: 1, amount: 2 } } } });
  const e = creditEconomyOf(input({ flows, agents: [{ id: "a", creditsStart: 100, creditsEnd: 100, tools: { offer_on_job: 1 } }, { id: "b", creditsStart: 100, creditsEnd: 100, tools: {} }] }));
  const row = (f: string) => e.flows.find((x) => x.rung === "now" && x.flow === f)!.credits;
  assert.equal(row("tuition"), 30); assert.equal(row("posting deposit"), 2);
  assert.equal(e.observed.nullDominates, true, "acting that ends level with doing nothing is not a win");
});
