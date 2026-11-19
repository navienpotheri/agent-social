/**
 * `asp treasury handout --week 2026-W47 --budget <id> [--amount 50] [--yes]` (register row DK545; spec-delta S951): the week's plan of the Treasury's mock-credit handout, from the log. Without --yes it
 * only prints who would be paid how much and who is not and why; with --yes it signs one `handout` record for each line with the Treasury key and appends it (the log checks the budget, once per agent per
 * week and the ceiling again). Active means the agent signed at least 3 acts of its own on 2 days of the week (a purchase, an action, an offer, an enrolment; not a starter claim or an allowance, which it
 * gets for doing nothing). The address cap is counted on the sponsor for a sponsored agent and on the identity itself for a key-only one, because the log never sees a network address: the service's
 * per-address counts are the live part of DK545. Credits are accounting entries, not money.
 */
import { createRecord, type AspRecord, type Signer } from "@agent-social/asp-core";
import { DEFAULT_HANDOUT, TREASURY_DID, planHandout, type HandoutAgent } from "@agent-social/asp-log";
import type { LogHandle } from "@agent-social/asp-package";

export class HandoutUsage extends Error {}
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

export interface HandoutOpts { log: LogHandle; io: { out: (l: string) => void }; now: () => string; signerFor: (did: string) => Signer; flags: { week?: string; budget?: string; amount?: string; yes?: boolean } }

export async function handoutCmd(o: HandoutOpts): Promise<number> {
  const week = o.flags.week ?? isoWeekOf(Date.parse(o.now()) - 7 * 86_400_000);
  const from = isoWeekStart(week), to = from + 7 * 86_400_000;
  const log = o.log.log;
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
  const line = led.budgets.find((b: { id: string; purpose: string; period: string }) => (o.flags.budget ? b.id === o.flags.budget || b.id.slice(7).startsWith(o.flags.budget) : b.purpose === "handout" && b.period === month));
  const amount = o.flags.amount === undefined ? DEFAULT_HANDOUT.amount : Math.trunc(Number(o.flags.amount));
  if (!Number.isInteger(amount) || amount < 1) throw new HandoutUsage("--amount must be a whole number of credits, 1 or more");
  const plan = planHandout(week, agents, line ? line.amount - line.paid : 0, { amount, levelCap: { sponsored: amount, key_only: amount }, addressCap: 2 * amount });
  o.io.out(`handout plan for ${week}: ${plan.lines.length} agent(s) paid ${plan.total} credits of a ${plan.budget}-credit budget left${line ? "" : " (no handout budget for the month: the Treasury has not funded the line)"}${plan.scaledToBudget ? "; scaled down to the budget" : ""}`);
  for (const l of plan.lines) o.io.out(`  pay   ${l.did}  ${l.paid}  ${l.reason}`);
  for (const s of plan.skipped) o.io.out(`  skip  ${s.did}  ${s.reason}`);
  if (!o.flags.yes) { o.io.out("nothing was signed; add --yes to sign and append these payments with the Treasury key"); return 0; }
  if (!line) throw new HandoutUsage("no handout budget to draw on: sign one first (asp treasury draft | sign), purpose handout");
  let paid = 0;
  for (const l of plan.lines) {
    const level = latest.get(l.did)!.sponsor ? "sponsored" : "key_only";
    const rec = createRecord({ type: "handout" as never, issuer: TREASURY_DID, subject: l.did, prev: null, body: { budget: line.id, week, agent: l.did, amount: { value: l.paid, unit: "credit" }, level }, issued_at: o.now() }, o.signerFor(TREASURY_DID));
    try { await o.log.append(rec); paid++; } catch (e) { o.io.out(`  refused ${l.did}: ${(e as Error).message}`); }
  }
  o.io.out(`${paid}/${plan.lines.length} handout(s) signed and recorded`);
  return paid === plan.lines.length ? 0 : 1;
}
