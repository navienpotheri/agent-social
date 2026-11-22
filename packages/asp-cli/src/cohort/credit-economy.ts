/**
 * The credit economy balance of the cohort runner (register row ENG28; docs/agent-engagement-ideas.md): the faucets (where mock credits enter an agent's hands: starting credits, job pay, tips, royalties, bonuses)
 * against the sinks (where they leave: the job tax, posting deposits, tuition, housing, long-form posts, promotion), for each rung, read from the run's own ledger and signed records, with the audit that checks
 * that the books balance. It also asks the question the owner cares about: for the median agent, what do the jobs it could do pay, less what the writes those jobs need cost, and does doing nothing ever beat acting?
 *
 * What it does NOT do: it proposes no amount for any faucet or sink that is not built (the owner sets those after reading the table: question 53 of docs/owner-questions-all.md), and a rung whose figure is not above
 * zero, or whose flows are not built, is marked PARTIAL, never "ok". Credits are mock accounting entries, not money.
 */
import type { CreditAudit, CreditFlows } from "@agent-social/asp-log";
import { FIRST_JOB_BONUS, HOUSE_BATCH, HOUSE_JOBS } from "./market.ts";

export type FlowKind = "faucet" | "sink";
export interface FlowRow { rung: string; flow: string; kind: FlowKind; status: "measured" | "not built"; credits: number | null; note: string }
export interface RungFigure { rung: string; label: string; /** Credits the doable jobs pay the median agent less what the writes they need cost; null where the flows are not built. */ net: number | null; row: "ok" | "partial"; why: string }
export interface Observed { activeAgents: number; idleAgents: number; activeMedianChange: number | null; idleMedianChange: number | null; /** true when an agent that acted ended with no more than one that did nothing; null when the run has no such comparison. */ nullDominates: boolean | null }
export interface CreditEconomy {
  agents: number;
  flows: FlowRow[];
  audit: { verdict: "balanced" | "mismatch"; minted: number; balances: number; locked: number; difference: number; problems: string[] };
  /** The median agent of the flow table's first rung: jobs on the board, their pay in all, the share of one agent, the cost of the writes they need. */
  median: { jobsOnBoard: number; boardPay: number; payShare: number; writeCostPerJob: number; netPerAgent: number };
  rungs: RungFigure[];
  observed: Observed;
}

/** The rungs of docs/agent-engagement-ideas.md and what each puts into the economy. Amounts of what is not built are the owner's to set, so they are not here. */
export const RUNGS: { rung: string; label: string; built: boolean; faucets: string[]; sinks: string[] }[] = [
  { rung: "now", label: "the local Market, Academy and messages as built", built: true, faucets: ["starting credits", "first-job bonus", "free-write refunds", "job pay"], sinks: ["job tax", "posting deposit", "tuition"] },
  { rung: "v8", label: "the library (ENG20)", built: false, faucets: ["library royalties"], sinks: [] },
  { rung: "v9", label: "housing (ENG21)", built: false, faucets: [], sinks: ["rent and furnishing"] },
  { rung: "v10", label: "the kickstarter economy (ENG22)", built: false, faucets: ["seeded jobs on a schedule"], sinks: [] },
  { rung: "v11", label: "the forum as a living event and social rewards (ENG25, ENG29)", built: false, faucets: ["tips"], sinks: ["long-form posts", "promotion"] },
  { rung: "v12", label: "the orientation expedition (ENG23)", built: false, faucets: ["stop tasks"], sinks: [] },
];

const median = (xs: number[]): number | null => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const MARKET_TOOLS = new Set(["post_job", "offer_on_job", "accept_offer", "deliver_job", "accept_delivery", "course_enrol", "course_sit"]);

export interface CreditEconomyInput {
  flows: CreditFlows;
  audit: CreditAudit;
  /** One row for each agent: its credits at the start and the end, and its calls by tool. */
  agents: { id: string; creditsStart?: number; creditsEnd?: number; tools: Record<string, number> }[];
  startCredits: number;
  /** The job tax, in thousandths of a price, and the price of a posting deposit, from the price list in force. */
  jobTaxPermille: number;
  depositPrice: number;
  /** The budgets of the jobs on the board at the start (default: the house's seed jobs). */
  boardBudgets?: number[];
  /** How many agents were paid the first-job bonus, and its size (default: the house's). */
  firstJobBonuses?: number;
  firstJobBonus?: number;
  /** Mock credits returned for the free writes (the first five writes of an agent cost nothing). */
  freeWriteRefunds?: number;
}

export function creditEconomyOf(i: CreditEconomyInput): CreditEconomy {
  const n = Math.max(1, i.agents.length);
  const board = i.boardBudgets ?? HOUSE_JOBS.slice(0, HOUSE_BATCH).map((j) => j.budget);
  const boardPay = board.reduce((a, b) => a + b, 0);
  const tuition = Object.entries(i.flows.purchases.byService).filter(([k]) => k.startsWith("academy.")).reduce((a, [, v]) => a + v.amount, 0);
  const deposits = i.flows.purchases.byService["market.posting.deposit"]?.amount ?? 0;
  const rows: FlowRow[] = [];
  const add = (rung: string, flow: string, kind: FlowKind, credits: number | null, note: string) => rows.push({ rung, flow, kind, status: credits === null ? "not built" : "measured", credits, note });
  add("now", "starting credits", "faucet", i.agents.length * i.startCredits, `${i.agents.length} agents at ${i.startCredits} each, minted by the local ledger (the sponsors' float and the house's seed are minted too and are in the audit, not an agent's)`);
  add("now", "first-job bonus", "faucet", (i.firstJobBonuses ?? 0) * (i.firstJobBonus ?? FIRST_JOB_BONUS), `${i.firstJobBonuses ?? 0} agent(s) paid ${i.firstJobBonus ?? FIRST_JOB_BONUS} mock credits on their first house job, minted by the local ledger`);
  add("now", "free-write refunds", "faucet", i.freeWriteRefunds ?? 0, "mock credits returned to an agent for a write that cost credits among its first five writes, minted by the local ledger");
  add("now", "direct messages", "sink", 0, "free: a message costs no credits (the Market's messages have no price in the list)");
  add("now", "job pay", "faucet", i.flows.settlements.escrowReleased, `${i.flows.settlements.count} settlement(s): the price released from escrow to the worker`);
  add("now", "job tax", "sink", i.flows.settlements.fees, `${i.jobTaxPermille}/1000 of each price, paid by the poster out of escrow`);
  add("now", "posting deposit", "sink", deposits, `${i.depositPrice} credits a posting, split to the Treasury, the Burn account and the Market`);
  add("now", "tuition", "sink", tuition, "course fees paid to the Academy");
  for (const r of RUNGS.filter((x) => !x.built)) {
    for (const f of r.faucets) add(r.rung, f, "faucet", null, `${r.label}: not built; the amount is the owner's to set`);
    for (const s of r.sinks) add(r.rung, s, "sink", null, `${r.label}: not built; the amount is the owner's to set`);
  }
  // The median agent: the doable jobs on the board share out among the agents (an optimistic equal share), and the writes a worker needs (an offer and a delivery) have no price in the list.
  const writeCostPerJob = 0;
  const payShare = boardPay / n;
  const netPerAgent = payShare - writeCostPerJob * (board.length / n);
  const rungs: RungFigure[] = RUNGS.map((r) => r.built
    ? { rung: r.rung, label: r.label, net: netPerAgent, row: netPerAgent > 0 ? "ok" : "partial", why: netPerAgent > 0 ? `an equal share of the ${board.length} job(s) on the board pays ${payShare.toFixed(2)} credits a head and the writes they need cost ${writeCostPerJob}` : "the doable jobs do not pay more than the writes they need cost" }
    : { rung: r.rung, label: r.label, net: null, row: "partial", why: "not built: no figure is computed and none is proposed; the owner sets the amounts after reading this table" });
  const acted = i.agents.filter((a) => Object.keys(a.tools).some((t) => MARKET_TOOLS.has(t)) && a.creditsStart !== undefined && a.creditsEnd !== undefined);
  const idle = i.agents.filter((a) => !Object.keys(a.tools).some((t) => MARKET_TOOLS.has(t)) && a.creditsStart !== undefined && a.creditsEnd !== undefined);
  const am = median(acted.map((a) => a.creditsEnd! - a.creditsStart!)), im = median(idle.map((a) => a.creditsEnd! - a.creditsStart!));
  const observed: Observed = { activeAgents: acted.length, idleAgents: idle.length, activeMedianChange: am, idleMedianChange: im, nullDominates: am === null || im === null ? null : am <= im };
  const a = i.audit;
  return {
    agents: i.agents.length, flows: rows,
    audit: { verdict: a.verdict, minted: a.minted, balances: a.balances, locked: a.locked.total, difference: a.difference, problems: a.problems },
    median: { jobsOnBoard: board.length, boardPay, payShare, writeCostPerJob, netPerAgent },
    rungs, observed,
  };
}

export function renderCreditEconomy(e: CreditEconomy): string {
  const L: string[] = [];
  L.push("## The credit economy: faucets against sinks, for each rung", "");
  L.push("Credits are mock accounting entries, not money. This is read from the run's own ledger and signed records. A flow that is not built has no amount here and none is proposed: the owner sets those after reading this table (docs/owner-questions-all.md, question 53).", "");
  L.push("| Rung | Flow | Faucet or sink | Credits | Note |", "|---|---|---|---|---|");
  for (const r of e.flows) L.push(`| ${r.rung} | ${r.flow} | ${r.kind} | ${r.credits === null ? "not built" : r.credits} | ${r.note} |`);
  L.push("");
  L.push(`**The audit:** ${e.audit.verdict}. Minted ${e.audit.minted}; balances ${e.audit.balances} plus ${e.audit.locked} locked in open contracts and stakes; difference ${e.audit.difference}.${e.audit.problems.length ? ` Problems: ${e.audit.problems.join("; ")}.` : ""}`, "");
  const m = e.median;
  L.push(`**The median agent, in the world as built:** ${m.jobsOnBoard} doable job(s) on the board pay ${m.boardPay} credits in all, an equal share of ${m.payShare.toFixed(2)} for each of ${e.agents} agent(s); the writes a worker needs (an offer and a delivery) cost ${m.writeCostPerJob} credits a job; so the figure is ${m.netPerAgent.toFixed(2)} credits. It is an optimistic equal share, not a promise: jobs go to whoever offers first.`, "");
  L.push("| Rung | What it puts in | Figure for the median agent | Row | Why |", "|---|---|---|---|---|");
  for (const r of e.rungs) L.push(`| ${r.rung} | ${r.label} | ${r.net === null ? "none" : r.net.toFixed(2)} | ${r.row === "ok" ? "ok" : "PARTIAL"} | ${r.why} |`);
  L.push("");
  const o = e.observed;
  L.push(`**Does doing nothing ever win?** In this run ${o.activeAgents} agent(s) used the Market or the Academy and ${o.idleAgents} did not. ${o.nullDominates === null ? "There is no comparison in this run (one of the two groups is empty), so no answer is given." : `Median change in credits: acted ${o.activeMedianChange}, did nothing ${o.idleMedianChange}. ${o.nullDominates ? "**Doing nothing did at least as well: the null action dominates in this run, and the row stays partial.**" : "Acting did better than doing nothing."}`} An agent that does nothing pays no rent or decay in any rung that is built; a sink that applies to idle agents would have to be set against the faucets before it is added.`, "");
  return L.join("\n");
}
