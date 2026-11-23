/**
 * The closure reader: `asp society cohort closure <run-dir>` reads a finished run folder (trace.jsonl, report.md, refusal-counts.json and kinds.json when they are there) and prints ONE table so that register rows can be closed honestly
 * and fast: row | the close condition in six words | the number measured in this run | the baseline it is compared with | MET, NOT MET or NOT MEASURABLE, with the reason. A row is MET only with its number and only when the number
 * is better than its baseline in the direction the row names; a row whose flag was off, or whose number cannot be read from the folder, or that has no baseline, is NOT MEASURABLE and says why. Nothing here changes a register.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

type Ev = Record<string, unknown> & { t: string };
export interface ClosureRow { row: string; condition: string; measured: string; baseline: string; verdict: "MET" | "NOT MET" | "NOT MEASURABLE"; reason: string }
interface Ctx { events: Ev[]; report: string; refusals: Record<string, number>; agents: number; groups: string[]; tools: Ev[] }

const num = (x: unknown): number => (typeof x === "number" ? x : Number(x) || 0);
const tools = (c: Ctx, name: string, ok?: boolean): Ev[] => c.tools.filter((e) => e.tool === name && (ok === undefined || e.ok === ok));
const agentsOf = (es: Ev[]): number => new Set(es.map((e) => String(e.agent))).size;

interface Def { row: string; condition: string; baseline: string; base: number | null; better: "lower" | "higher"; needs?: string; measure: (c: Ctx) => { n: number; text: string } | null }
const refusalTotal = (c: Ctx): number => Object.values(c.refusals).reduce((a, b) => a + b, 0);

const DEFS: Def[] = [
  { row: "ENG45", condition: "no agent lost to provider error", baseline: "1 of 3 agents ended at 33 s (provider_error)", base: 0.001, better: "lower", measure: (c) => { const n = c.events.filter((e) => e.t === "end" && /provider_error/.test(String(e.reason))).length; return { n: n / Math.max(1, c.agents), text: `${n} of ${c.agents} agents ended with provider_error` }; } },
  { row: "ENG46", condition: "newcomers never refused for being new", baseline: "agent-01 refused 6 times (bond floor and others)", base: 1, better: "lower", measure: (c) => { const n = Object.entries(c.refusals).filter(([k]) => /bond_below_risk_floor/.test(k)).reduce((a, [, v]) => a + v, 0); return { n, text: `${n} refusals for the bond floor` }; } },
  { row: "ENG77", condition: "offers on taken jobs fall", baseline: "21 offers refused in the 25-agent run", base: 21, better: "lower", measure: (c) => { const n = c.tools.filter((e) => e.tool === "offer_on_job" && e.ok === false && e.refused === "market_refused").length; return { n, text: `${n} offers refused (${tools(c, "offer_on_job").length} offers made)` }; } },
  { row: "ENG76", condition: "reply-shape refusals fall", baseline: "11 agents once each (reply shape)", base: 11, better: "lower", measure: (c) => { const n = Object.entries(c.refusals).filter(([k]) => /reply/.test(k)).reduce((a, [, v]) => a + v, 0); return { n, text: `${n} reply-shape refusals` }; } },
  { row: "ENG85", condition: "bad_input share of refusals falls", baseline: "26 of 52 refusals (0.5)", base: 0.5, better: "lower", measure: (c) => { const t = refusalTotal(c); if (!t) return { n: 0, text: "0 of 0 refusals" }; const b = c.refusals["bad_input"] ?? 0; return { n: b / t, text: `${b} of ${t} refusals (${(b / t).toFixed(2)})` }; } },
  { row: "ENG81", condition: "agents write to each other", baseline: "0 messages between agents (22 one-way, to the house)", base: 0, better: "higher", measure: (c) => { const n = tools(c, "send_message", true).filter((e) => !String((e.input as Record<string, unknown>)?.to ?? "").startsWith("house-")).length; return { n, text: `${n} messages from one agent to another` }; } },
  { row: "ENG82", condition: "agents post jobs for each other", baseline: "0 of 25 agents posted a job", base: 0, better: "higher", measure: (c) => { const n = agentsOf(tools(c, "post_job", true)); return { n, text: `${n} of ${c.agents} agents posted a job` }; } },
  { row: "ENG88", condition: "agents look closely at places", baseline: "0 of 25 agents called inspect", base: 0, better: "higher", needs: "expedition", measure: (c) => { const n = agentsOf(tools(c, "inspect", true)); return { n, text: `${n} of ${c.agents} agents called inspect` }; } },
  { row: "ENG53", condition: "agents sit courses", baseline: "2 course_sit calls in the 25-agent run", base: 2, better: "higher", measure: (c) => { const n = tools(c, "course_sit").length; return { n, text: `${n} course_sit calls by ${agentsOf(tools(c, "course_sit"))} agents` }; } },
  { row: "ENG67", condition: "agents answer a field card", baseline: "0 agents answered a card", base: 0, better: "higher", needs: "expedition", measure: (c) => { const n = agentsOf(tools(c, "field_answer", true)); return { n, text: `${n} of ${c.agents} agents answered a card` }; } },
  { row: "ENG80", condition: "lesson cards published and used", baseline: "0 cards (not in the 25-agent run)", base: 0, better: "higher", needs: "lessons", measure: (c) => { const p = tools(c, "lesson_publish", true).length, u = tools(c, "lesson_cite", true).length; return { n: p + u, text: `${p} cards published, ${u} citations` }; } },
  { row: "ENG58", condition: "agents enter a game", baseline: "no baseline in the register", base: null, better: "higher", needs: "games", measure: (c) => { const n = agentsOf(tools(c, "game_enter", true)); return { n, text: `${n} of ${c.agents} agents entered a game` }; } },
  { row: "ENG91", condition: "first moves are spread", baseline: "18 of 25 made the same first four calls (0.72)", base: 0.72, better: "lower", measure: (c) => { const by = new Map<string, string[]>(); for (const e of c.tools) { const l = by.get(String(e.agent)) ?? []; if (l.length < 4) l.push(String(e.tool)); by.set(String(e.agent), l); } const sig = new Map<string, number>(); for (const l of by.values()) if (l.length === 4) { const k = l.join(","); sig.set(k, (sig.get(k) ?? 0) + 1); } const n = [...by.values()].filter((l) => l.length === 4).length; if (!n) return null; const top = Math.max(...sig.values()); return { n: top / n, text: `${top} of ${n} agents made the same first four calls (${(top / n).toFixed(2)})` }; } },
  { row: "ENG90", condition: "the first map result is short", baseline: "3725 characters", base: 3725, better: "lower", measure: (c) => { const firsts = new Map<string, number>(); for (const e of c.tools) if (e.tool === "look_map" && !firsts.has(String(e.agent))) firsts.set(String(e.agent), num(e.chars)); if (!firsts.size) return null; const m = [...firsts.values()].reduce((a, b) => a + b, 0) / firsts.size; return { n: Math.round(m), text: `${Math.round(m)} characters on average over ${firsts.size} agents (with the first-look lines that ride on it)` }; } },
  { row: "ENG113", condition: "Town Hall sessions run by themselves", baseline: "0 sessions (nothing ran it)", base: 0, better: "higher", measure: (c) => { const m = /(\d+) Town Hall sessions? w/.exec(c.report); return m ? { n: Number(m[1]), text: `${m[1]} sessions by the house roles` } : null; } },
  { row: "ENG86", condition: "agents open the field guide", baseline: "no baseline in the register", base: null, better: "higher", measure: (c) => { const m = /(\d+) of (\d+) agents opened the guide/.exec(c.report); return m ? { n: Number(m[1]), text: `${m[1]} of ${m[2]} agents opened the guide` } : null; } },
  { row: "ENG71 / DK1830", condition: "agents write plan, expect, belief lines", baseline: "no baseline in the register", base: null, better: "higher", needs: "signals", measure: (c) => { const n = agentsOf(c.events.filter((e) => e.t === "signal")); return { n, text: `${n} of ${c.agents} agents produced a signal line` }; } },
  { row: "DK1306", condition: "agents use institutions and each other", baseline: "0 jobs settled between agents (25-agent run)", base: 0, better: "higher", measure: (c) => { const n = tools(c, "accept_delivery", true).length; const inst = new Set(c.tools.filter((e) => e.ok && e.institution && e.institution !== "none").map((e) => String(e.institution))).size; return { n, text: `${n} deliveries accepted between agents; ${inst} institutions used` }; } },
  { row: "DK1801", condition: "every agent ends with a reason", baseline: "25 of 25 stayed in the 25-agent run", base: null, better: "higher", measure: (c) => { const n = c.events.filter((e) => e.t === "end").length; return { n, text: `${n} of ${c.agents} agents have an end record` }; } },
];

export function readRun(dir: string): Ctx {
  const read = (f: string): string => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8") : "");
  const events = read("trace.jsonl").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Ev);
  let refusals: Record<string, number> = {};
  try { refusals = (JSON.parse(read("refusal-counts.json") || "{}") as { counts?: Record<string, number> }).counts ?? {}; } catch { /* none */ }
  const start = events.find((e) => e.t === "start") as (Ev & { agents?: number; toolGroups?: string[] }) | undefined;
  return { events, report: read("report.md"), refusals, agents: start?.agents ?? new Set(events.filter((e) => e.t === "agent").map((e) => String(e.agent))).size, groups: start?.toolGroups ?? [], tools: events.filter((e) => e.t === "tool") };
}

export function closureRows(dir: string): ClosureRow[] {
  const c = readRun(dir);
  if (!c.events.length) throw new Error(`no trace.jsonl in ${dir}: give a finished run folder`);
  const flagOn = (needs?: string): boolean => !needs || (needs === "signals" ? c.events.some((e) => e.t === "signal") || /signals/i.test(c.report) : c.groups.includes(needs));
  return DEFS.map((d): ClosureRow => {
    if (!flagOn(d.needs)) return { row: d.row, condition: d.condition, measured: "n/a", baseline: d.baseline, verdict: "NOT MEASURABLE", reason: `the ${d.needs} flag was off in this run (the tool group is not in its start record)` };
    const m = d.measure(c);
    if (!m) return { row: d.row, condition: d.condition, measured: "n/a", baseline: d.baseline, verdict: "NOT MEASURABLE", reason: "the number cannot be read from this folder (no such calls or no such report line)" };
    if (d.base === null) return { row: d.row, condition: d.condition, measured: m.text, baseline: d.baseline, verdict: "NOT MEASURABLE", reason: "the number is measured but the register gives no baseline to compare it with" };
    const ok = d.better === "lower" ? m.n < d.base : m.n > d.base;
    return { row: d.row, condition: d.condition, measured: m.text, baseline: d.baseline, verdict: ok ? "MET" : "NOT MET", reason: ok ? `better than the baseline (${d.better} is better)` : `not better than the baseline (${d.better} is better)` };
  });
}

export function renderClosure(rows: ClosureRow[], dir: string): string {
  const L = [`# Closure reader: ${dir}`, "", "| Row | Close condition | Measured in this run | Baseline | Verdict | Why |", "|---|---|---|---|---|---|"];
  for (const r of rows) L.push(`| ${r.row} | ${r.condition} | ${r.measured} | ${r.baseline} | ${r.verdict} | ${r.reason} |`);
  const c = (v: string): number => rows.filter((r) => r.verdict === v).length;
  L.push("", `${c("MET")} MET, ${c("NOT MET")} NOT MET, ${c("NOT MEASURABLE")} NOT MEASURABLE. MET means the number in this one run is better than the baseline; it is not a claim about an effect (one run has no spread: ENG72), and a row stays partial until the owner and the lead agree. Nothing here changed a register.`);
  return L.join("\n") + "\n";
}

export function closureCmd(dir: string | undefined, io: { out: (l: string) => void }): number {
  if (!dir) { io.out("usage: asp society cohort closure <run folder>"); return 2; }
  try { io.out(renderClosure(closureRows(dir), dir)); return 0; } catch (e) { io.out((e as Error).message); return 2; }
}
