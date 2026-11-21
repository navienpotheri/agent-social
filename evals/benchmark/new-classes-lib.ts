// DK1713: measures the gateway's own rules against the four new bypass classes (evals/benchmark/new-classes-cases.json): the share of attacks caught, with a Wilson 95% interval, the share of harmless
// cases wrongly caught, and the same for the dev and held-out parts. No model and no network: the rules are the injection detector (findInjection) and the gateway's judge. A rate over these cases is not
// a claim about attacks written by someone else.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { findInjection } from "../../packages/asp-package/src/gateway/injection.ts";
import { judge } from "../../packages/asp-package/src/gateway/judge.ts";

export interface Case { id: string; part: "dev" | "held-out"; attack: boolean; text?: string; call?: { name: string; args: Record<string, unknown> } }
export interface Rate { n: number; hit: number; rate: number; lo: number; hi: number }
export interface ClassResult { name: string; attacks: Rate; benign: Rate; dev: Rate; heldOut: Rate; missed: string[]; falsePositives: string[] }

export const CLASSES = ["plot_feed", "tool_result", "exfil_allowed_tools", "split_commands"] as const;
export type ClassName = (typeof CLASSES)[number];
export const LABEL: Record<ClassName, string> = { plot_feed: "injection through plots and feeds", tool_result: "injection in a tool result", exfil_allowed_tools: "exfiltration through allowed tools", split_commands: "a refused command split into allowed pieces" };

/** Wilson score interval for a proportion (95%). */
export function wilson(hit: number, n: number): { lo: number; hi: number } {
  if (n === 0) return { lo: 0, hi: 1 };
  const z = 1.96, p = hit / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
}
const rate = (hit: number, n: number): Rate => ({ n, hit, rate: n ? hit / n : 0, ...wilson(hit, n) });

export function load(): Record<ClassName, { mandate?: { scopes: string[]; hosts?: string[]; root?: string }; cases: Case[] }> {
  return JSON.parse(readFileSync(fileURLToPath(new URL("./new-classes-cases.json", import.meta.url)), "utf8"));
}

/** Does the gateway's rule catch this case: the detector flags the text, or the judge refuses the call. */
export function caught(name: ClassName, c: Case, mandate?: { scopes: string[]; hosts?: string[]; root?: string }): boolean {
  if (c.text !== undefined) return findInjection(c.text).length > 0;
  const j = judge(c.call!, mandate!.scopes, [], undefined, mandate!.hosts, mandate!.root ? { root: mandate!.root } : undefined);
  return !j.allow;
}

export function measure(): ClassResult[] {
  const all = load();
  return CLASSES.map((name) => {
    const { mandate, cases } = all[name];
    const results = cases.map((c) => ({ c, caught: caught(name, c, mandate) }));
    const att = results.filter((r) => r.c.attack), ben = results.filter((r) => !r.c.attack);
    const part = (p: string) => att.filter((r) => r.c.part === p);
    return {
      name, attacks: rate(att.filter((r) => r.caught).length, att.length), benign: rate(ben.filter((r) => r.caught).length, ben.length),
      dev: rate(part("dev").filter((r) => r.caught).length, part("dev").length), heldOut: rate(part("held-out").filter((r) => r.caught).length, part("held-out").length),
      missed: att.filter((r) => !r.caught).map((r) => r.c.id), falsePositives: ben.filter((r) => r.caught).map((r) => r.c.id),
    };
  });
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
export const fmt = (r: Rate) => `${r.hit}/${r.n} = ${pct(r.rate)} (95% interval ${pct(r.lo)} to ${pct(r.hi)})`;
