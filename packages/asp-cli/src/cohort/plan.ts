/**
 * The planner of a cohort run (ENG15): before anything is spent, what each rung of the ladder (one agent, three, fifteen) is expected to cost and the most it can cost, with the assumptions written out. The expected figure
 * comes from the size of the static prefix (the briefing and the tool list, which this build knows exactly), the prompt cache (the first tick writes the prefix at 1.25 times the input price, every later tick reads it at a
 * tenth), and an assumed delta and reply per tick; the worst case is the cap the gateway enforces (a call whose worst case would pass an agent's cap is not made), never more than the run's total cap. Estimates from a
 * price table and token counts, not the provider's bill: the first real agent is what shows how far they are off.
 */
import { isPricedModel, priceFor } from "@agent-social/asp-package";
import { BRIEFING } from "./agent.ts";
import { LIFE_DEFS, TOOLS } from "./tools.ts";

export interface PlanInput {
  model: string;
  price?: { inPerM?: number; outPerM?: number };
  rungs: number[];
  capPerAgent: number;
  totalCap?: number;
  /** Model calls (ticks) one agent is assumed to make. */
  ticksPerAgent?: number;
  /** Tokens of new input each tick adds beyond the cached prefix (the delta observation and the last exchanges). */
  deltaTokens?: number;
  replyTokens?: number;
  cache?: boolean;
}
export interface PlanRung { agents: number; expectedUsd: number; worstUsd: number; noCacheExpectedUsd: number }
export interface Plan { prefixTokens: number; assumptions: string[]; rungs: PlanRung[]; priced: boolean }

export function staticPrefixTokens(): number {
  const defs = [...TOOLS, ...LIFE_DEFS].map((t) => ({ name: `mcp__society__${t.name}`, description: t.description, input_schema: t.input_schema }));
  return Math.ceil((JSON.stringify(defs).length + BRIEFING.length) / 3.5);
}

export function plan(i: PlanInput): Plan {
  const p = { ...priceFor(i.model), ...(i.price?.inPerM !== undefined ? { inPerM: i.price.inPerM } : {}), ...(i.price?.outPerM !== undefined ? { outPerM: i.price.outPerM } : {}) };
  const ticks = i.ticksPerAgent ?? 40, delta = i.deltaTokens ?? 1500, reply = i.replyTokens ?? 150, cache = i.cache ?? true;
  const prefix = staticPrefixTokens();
  const perAgent = (cached: boolean): number => {
    let usd = 0;
    for (let t = 0; t < ticks; t++) {
      const prefixCost = cached ? (t === 0 ? prefix * 1.25 : prefix * 0.1) : prefix;
      usd += ((prefixCost + delta) * p.inPerM + reply * p.outPerM) / 1e6;
    }
    return usd;
  };
  const rungs = i.rungs.map((n) => ({
    agents: n,
    expectedUsd: Math.min(perAgent(cache), i.capPerAgent) * n,
    noCacheExpectedUsd: Math.min(perAgent(false), i.capPerAgent) * n,
    worstUsd: Math.min(i.capPerAgent * n, i.totalCap ?? Infinity),
  }));
  return {
    prefixTokens: prefix, priced: isPricedModel(i.model) || (i.price?.inPerM !== undefined && i.price?.outPerM !== undefined), rungs,
    assumptions: [
      `price ${p.inPerM} in / ${p.outPerM} out USD per million tokens${isPricedModel(i.model) ? " (the gateway's table)" : " (as given; this model is not in the table)"}`,
      `the static prefix (briefing and tools) is ${prefix.toLocaleString("en-US")} tokens; with the cache it is written once at 1.25x and read at 0.1x on the other ticks${cache ? "" : " (cache OFF in this plan)"}`,
      `${ticks} ticks an agent, each adding about ${delta.toLocaleString("en-US")} tokens of new input and ${reply} of output (assumptions: the first real agent shows the true figures)`,
      "the worst case is the dollar cap the gateway enforces, not more than the run's total cap",
    ],
  };
}

export function renderPlan(pl: Plan, o: { capPerAgent: number; totalCap?: number }): string[] {
  const usd = (x: number) => `$${x.toFixed(2)}`;
  return [
    `plan (per rung; the cap is $${o.capPerAgent} an agent${o.totalCap !== undefined ? `, $${o.totalCap} in all` : ""}):`,
    ...pl.rungs.map((r) => `  ${String(r.agents).padStart(3)} agent${r.agents === 1 ? " " : "s"}: expected about ${usd(r.expectedUsd)} (about ${usd(r.noCacheExpectedUsd)} without the cache), worst case ${usd(r.worstUsd)}`),
    ...pl.assumptions.map((a) => `  - ${a}`),
  ];
}

/** `asp society cohort plan --model <m> [--agents 1,3,15] --budget-usd <cap per agent> [--total-usd <cap>] [--ticks <n>] [--price-in <n> --price-out <n>]`: prints the plan and spends nothing. */
export function planCmd(f: { model?: string; agents?: string; "budget-usd"?: string; "total-usd"?: string; ticks?: string; "price-in"?: string; "price-out"?: string }, io: { out: (l: string) => void }): number {
  const num = (name: string, v: string | undefined): number | undefined => { if (v === undefined) return undefined; const n = Number(v); if (!(n > 0)) throw new Error(`${name} is a number above zero`); return n; };
  if (!f.model) throw new Error("--model is needed (for example claude-haiku-5-5)");
  const cap = num("--budget-usd", f["budget-usd"]);
  if (cap === undefined) throw new Error("--budget-usd is needed: the cap for one agent");
  const rungs = (f.agents ?? "1,3,15").split(",").map((x) => Number(x.trim()));
  if (!rungs.length || rungs.some((n) => !Number.isInteger(n) || n < 1 || n > 50)) throw new Error("--agents is a list of whole numbers from 1 to 50, for example 1,3,15");
  const totalCap = num("--total-usd", f["total-usd"]);
  const priceIn = num("--price-in", f["price-in"]), priceOut = num("--price-out", f["price-out"]);
  const ticks = num("--ticks", f.ticks);
  const pl = plan({ model: f.model, rungs, capPerAgent: cap, ...(totalCap !== undefined ? { totalCap } : {}), ...(ticks !== undefined ? { ticksPerAgent: Math.trunc(ticks) } : {}), ...(priceIn !== undefined || priceOut !== undefined ? { price: { ...(priceIn !== undefined ? { inPerM: priceIn } : {}), ...(priceOut !== undefined ? { outPerM: priceOut } : {}) } } : {}) });
  for (const l of renderPlan(pl, { capPerAgent: cap, ...(totalCap !== undefined ? { totalCap } : {}) })) io.out(l);
  if (!pl.priced) io.out(`  note: ${f.model} is not in the price table: pass --price-in and --price-out for a real plan; the figures above use the high default price.`);
  return 0;
}
