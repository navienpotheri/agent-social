/**
 * The weekly handout's plan read from the log (register row DK545; spec-delta S951): who was active in an ISO week, what each holds, the Treasury's handout budget left, and the plan `planHandout` makes of it.
 * Read-only and deterministic: the same log gives the same plan. The CLI prints it and signs from it; the public page shows it. Credits are accounting entries, not money.
 */
import type { AspRecord } from "@agent-social/asp-core";
import { DEFAULT_HANDOUT, planHandout, type HandoutAgent, type HandoutPlan } from "./handout-plan.ts";
export class HandoutUsage extends Error {}
import type { EventLog } from "./log.ts";

const NOT_ACTS = new Set(["asp.passport/v0.2", "asp.starter_claim/v0.2", "asp.allowance/v0.2", "asp.handout/v0.2", "asp.mint/v0.2", "asp.budget/v0.2", "asp.treasury_payment/v0.2", "asp.prize/v0.2", "asp.receipt/v0.2", "asp.certificate/v0.2"]);

/** Monday 00:00 UTC of an ISO week, in milliseconds. */
export function isoWeekStart(week: string): number {
  const m = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 53) throw new HandoutUsage("--week must look like 2026-W47");
  const jan4 = Date.UTC(Number(m[1]), 0, 4);
  return jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * 86_400_000 + (Number(m[2]) - 1) * 7 * 86_400_000;
}
export function isoWeekOf(ms: number): string {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7;
  const thursday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * 86_400_000 + 3 * 86_400_000;
  const year = new Date(thursday).getUTCFullYear();
  const week = Math.floor((thursday - isoWeekStart(`${year}-W01`)) / (7 * 86_400_000)) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}


export async function handoutPlanFromLog(log: EventLog, week: string, o: { budget?: string; amount?: number } = {}): Promise<{ plan: HandoutPlan; line?: { id: string; amount: number; paid: number }; sponsors: Map<string, string | undefined>; to: number }> {
  const from = isoWeekStart(week), to = from + 7 * 86_400_000;
  const passports = ((await log.recordsOfTypes(["passport"])) as AspRecord[]).map((r) => r.body as { did: string; kind: string; sponsor?: string; house?: boolean }).filter((b) => b.kind === "agent");
  const latest = new Map(passports.map((b) => [b.did, b]));
  const days = new Map<string, string[]>();
  for (const r of ((await log.recordsBetween(from, to, new Set(latest.keys()))) as AspRecord[]).filter((x) => !NOT_ACTS.has(x.type))) {
    const list = days.get(r.issuer) ?? []; list.push(r.issued_at.slice(0, 10)); days.set(r.issuer, list);
  }
  const agents: HandoutAgent[] = [];
  for (const [did, p] of latest) {
    const rep = await log.reputationOf(did);
    agents.push({ did, level: p.sponsor ? "sponsored" : "key_only", address: p.sponsor ?? did, balance: await log.balance(did), actDays: days.get(did) ?? [], eligible: (rep?.tier ?? 1) > 0, house: !!p.house });
  }
  const led = await log.treasuryLedger();
  const month = new Date(to - 1).toISOString().slice(0, 7);
  const line = led.budgets.find((b: { id: string; purpose: string; period: string }) => (o.budget ? b.id === o.budget || b.id.slice(7).startsWith(o.budget) : b.purpose === "handout" && b.period === month));
  const amount = o.amount ?? DEFAULT_HANDOUT.amount;
  if (!Number.isInteger(amount) || amount < 1) throw new HandoutUsage("--amount must be a whole number of credits, 1 or more");
  const plan = planHandout(week, agents, line ? line.amount - line.paid : 0, { amount, levelCap: { sponsored: amount, key_only: amount }, addressCap: 2 * amount });
  return { plan, ...(line ? { line: { id: line.id, amount: line.amount, paid: line.paid } } : {}), sponsors: new Map([...latest].map(([d, p]) => [d, p.sponsor])), to };
}
