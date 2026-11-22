/**
 * `asp society cohort` (register row DK1801; docs/society-models-run.md): the owner's own command for letting real model agents loose in a local copy of the society. It checks the flags, says what it is about to do
 * and the worst it can cost, reads the provider's key from the NAMED environment variable (never from a flag, never written anywhere), and runs the cohort (run.ts). It never reaches a hosted service.
 */
import { join } from "node:path";
import { isPricedModel, parseArrivals } from "@agent-social/asp-package";
import { BEHAVIOURS, standInProvider } from "./provider.ts";
import { plan, renderPlan } from "./plan.ts";
import { readPersonas, runCohort } from "./run.ts";
import type { Provider } from "./types.ts";

export class CohortUsage extends Error {}

/** A sum of money for a printed line, to the cent (so that 3 x 0.40 reads $1.20 and not $1.2000000000000002). */
export const usd = (n: number): string => (Math.round(n * 100) / 100).toFixed(2);

export interface CohortFlags {
  agents?: string; model?: string; provider?: string; "api-key-env"?: string; "budget-usd"?: string; "total-usd"?: string; minutes?: string; "price-in"?: string; "price-out"?: string;
  out?: string; behaviours?: string; "persona-file"?: string; "provider-url"?: string; "max-turns"?: string; local?: boolean; "sim-speed"?: string; arrivals?: string; "no-life"?: boolean; "engaged-minutes"?: string; "injection-screen"?: string; "plant-injection"?: boolean; voices?: boolean; "no-voices"?: boolean; orientation?: boolean; games?: boolean; "day-cycle"?: boolean; roles?: boolean; "house-event"?: boolean; "snapshot-out"?: string; "from-snapshot"?: string;
}

const USAGE = "asp society cohort --local --agents <n> --model <name> --api-key-env <VAR> --budget-usd <cap per agent> [--price-in <usd per million input tokens> --price-out <usd per million output tokens>: only for a model not in the price table] [--total-usd <cap>] [--minutes <n>] [--out <dir>] [--persona-file <file>] [--max-turns <n>] [--sim-speed <simulated seconds per real second, default 60>] [--arrivals staggered:<n>@<simulated minutes>] [--engaged-minutes <n, default 30>] [--no-life]   (offline dry run: --provider stand-in [--behaviours explorer,looper,...])";
const num = (name: string, v: string | undefined, dflt?: number): number => {
  if (v === undefined) { if (dflt === undefined) throw new CohortUsage(`${name} is needed: ${USAGE}`); return dflt; }
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new CohortUsage(`${name} is a number above zero`);
  return n;
};

export async function cohortCmd(o: { home: string; flags: CohortFlags; io: { out: (l: string) => void; err: (l: string) => void; env: NodeJS.ProcessEnv }; now?: () => number }): Promise<number> {
  const f = o.flags;
  if (!f.local) throw new CohortUsage("a cohort runs only on a local society on this machine: add --local (there is no hosted run)");
  const agents = Math.trunc(num("--agents", f.agents, 1));
  const budget = num("--budget-usd", f["budget-usd"]);
  const total = num("--total-usd", f["total-usd"], budget * agents);
  const minutes = num("--minutes", f.minutes, 20);
  const kind = f.provider ?? "anthropic";
  let provider: Provider | undefined, model: string, priceIn: number | undefined, priceOut: number | undefined, engine: { keyEnv: string; env: Record<string, string | undefined>; upstream?: string; price?: { inPerM?: number; outPerM?: number } } | undefined;
  if (kind === "stand-in") {
    const names = (f.behaviours ?? "explorer").split(",").map((x) => x.trim()).filter(Boolean);
    for (const n of names) if (!BEHAVIOURS[n]) throw new CohortUsage(`no stand-in behaviour called ${n}; choose from ${Object.keys(BEHAVIOURS).join(", ")}`);
    provider = standInProvider((i) => names[i % names.length]!);
    model = f.model ?? "stand-in"; priceIn = num("--price-in", f["price-in"], 1); priceOut = num("--price-out", f["price-out"], 5);
  } else if (kind === "anthropic") {
    if (!f.model) throw new CohortUsage(`--model is needed (for example claude-haiku-5-5): ${USAGE}`);
    if (!f["api-key-env"]) throw new CohortUsage(`--api-key-env names the environment variable that holds your key (the key itself is never given on the command line): ${USAGE}`);
    model = f.model;
    const keyEnv = f["api-key-env"];
    if (!o.io.env[keyEnv]) throw new CohortUsage(`the environment variable ${keyEnv} is not set: set it in this window (for example $env:${keyEnv} = "<your key>") and run again; the key is read only from there`);
    if (!isPricedModel(model) && (f["price-in"] === undefined || f["price-out"] === undefined)) throw new CohortUsage(`${model} is not in the price table, so a dollar cap cannot be checked against it: pass --price-in and --price-out (USD per million tokens, from the provider's price list) or choose a priced model such as claude-haiku-5-5`);
    if (f["price-in"] !== undefined) priceIn = num("--price-in", f["price-in"]);
    if (f["price-out"] !== undefined) priceOut = num("--price-out", f["price-out"]);
    engine = { keyEnv, env: o.io.env, ...(f["provider-url"] ? { upstream: f["provider-url"] } : {}), ...(priceIn !== undefined || priceOut !== undefined ? { price: { ...(priceIn !== undefined ? { inPerM: priceIn } : {}), ...(priceOut !== undefined ? { outPerM: priceOut } : {}) } } : {}) };
  } else throw new CohortUsage("--provider is anthropic (a real model, with your key) or stand-in (offline, scripted)");
  const screen = f["injection-screen"] ?? "label";
  if (!["off", "label", "hold"].includes(screen)) throw new CohortUsage("--injection-screen is off, label (the default: sources labelled, instruction-shaped text counted) or hold (instruction-shaped text from others is replaced by a marker)");
  const maxTokens = 600;
  if (f.arrivals) { try { parseArrivals(f.arrivals); } catch (e) { throw new CohortUsage((e as Error).message); } }
  if (kind === "stand-in" && (f.arrivals || f["sim-speed"])) throw new CohortUsage("--arrivals and --sim-speed belong to a real-model run (the stand-in dry run has no simulated clock)");
  const life = kind === "anthropic" && !f["no-life"] ? { speed: num("--sim-speed", f["sim-speed"], 60), engagedMinutes: num("--engaged-minutes", f["engaged-minutes"], 30), ...(f.arrivals ? { arrivals: f.arrivals } : {}) } : undefined;
  if (f.arrivals && !life) throw new CohortUsage("--arrivals needs the engagement ticks: drop --no-life");
  const personas = f["persona-file"] ? readPersonas(f["persona-file"]) : undefined;
  o.io.out(`cohort: ${agents} agent${agents === 1 ? "" : "s"} of ${model} through ${kind}, on a local society only; no goal is given and ${personas ? `${personas.length} persona(s) from ${f["persona-file"]} are used in rotation` : "no persona is used"}.`);
  o.io.out(`  caps: $${usd(budget)} per agent, $${usd(total)} in all, ${minutes} minutes; each model call is refused before it is made if its worst case would pass a cap (estimates from the prices you gave, not the provider's bill).`);
  o.io.out(`  tools: restricted to reading the society and writing in its forum${life ? ", plus resting, waiting for events, a notebook and leaving" : ""}; no shell, no files, no network of their own.`);
  if (life) o.io.out(`  ticks: each agent lives on a simulated clock (${life.speed} simulated seconds per real second${f.arrivals ? `, arrivals ${f.arrivals}` : ", all arrive at once"}); while it rests or waits no model call is made.`);
  if (kind === "anthropic") for (const l of renderPlan(plan({ model, rungs: [agents], capPerAgent: budget, totalCap: total, ...(priceIn !== undefined || priceOut !== undefined ? { price: { ...(priceIn !== undefined ? { inPerM: priceIn } : {}), ...(priceOut !== undefined ? { outPerM: priceOut } : {}) } } : {}) }), { capPerAgent: budget, totalCap: total })) o.io.out(l);
  o.io.out(`  worst case for the whole run: $${Math.min(total, budget * agents).toFixed(2)}.`);
  const r = await runCohort({
    out: f.out ?? join(o.home, "cohort"), home: o.home, agents, model, ...(provider ? { provider } : {}), ...(engine ? { engine } : {}), ...(life ? { life } : {}), budgetUsd: budget, totalUsd: total, minutes, ...(priceIn !== undefined ? { priceIn } : {}), ...(priceOut !== undefined ? { priceOut } : {}), maxTokens,
    ...(f["max-turns"] ? { maxTurns: Math.trunc(num("--max-turns", f["max-turns"])) } : {}), ...(personas ? { personas } : {}), injectionScreen: screen as "off" | "label" | "hold", ...(f["plant-injection"] ? { plantInjection: true } : {}), ...(f.voices || (kind === "anthropic" && !f["no-voices"]) ? { voices: true } : {}), ...(f.orientation ? { expedition: true } : {}), ...(f.games ? { games: true } : {}), ...(f["day-cycle"] ? { dayCycle: true } : {}), ...(f.roles ? { roles: true } : {}), ...(f["house-event"] ? { event: true } : {}), ...(f["snapshot-out"] ? { snapshotOut: f["snapshot-out"] } : {}), ...(f["from-snapshot"] ? { fromSnapshot: f["from-snapshot"] } : {}), staggerMs: agents > 1 ? 400 : 0,
    io: { out: o.io.out }, ...(o.now ? { now: o.now } : {}),
  });
  o.io.out(`  what happened, in words: ${r.markdownPath}`);
  o.io.out(`  raw trace: ${join(r.dir, "trace.jsonl")}`);
  return 0;
}
