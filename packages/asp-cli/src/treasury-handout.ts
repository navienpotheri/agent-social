/**
 * `asp treasury handout --week 2026-W47 --budget <id> [--amount 50] [--yes]` (register row DK545; spec-delta S951): the week's plan of the Treasury's mock-credit handout, from the log. Without --yes it
 * only prints who would be paid how much and who is not and why; with --yes it signs one `handout` record for each line with the Treasury key and appends it (the log checks the budget, once per agent per
 * week and the ceiling again). Active means the agent signed at least 3 acts of its own on 2 days of the week (a purchase, an action, an offer, an enrolment; not a starter claim or an allowance, which it
 * gets for doing nothing). The address cap is counted on the sponsor for a sponsored agent and on the identity itself for a key-only one, because the log never sees a network address: the service's
 * per-address counts are the live part of DK545. Credits are accounting entries, not money.
 */
import { createRecord, type Signer } from "@agent-social/asp-core";
import { TREASURY_DID, handoutPlanFromLog, isoWeekOf, isoWeekStart, HandoutUsage } from "@agent-social/asp-log";
export { isoWeekOf, isoWeekStart, HandoutUsage };
import type { LogHandle } from "@agent-social/asp-package";


export interface HandoutOpts { log: LogHandle; io: { out: (l: string) => void }; now: () => string; signerFor: (did: string) => Signer; flags: { week?: string; budget?: string; amount?: string; yes?: boolean } }

export async function handoutCmd(o: HandoutOpts): Promise<number> {
  const week = o.flags.week ?? isoWeekOf(Date.parse(o.now()) - 7 * 86_400_000);
  const amount = o.flags.amount === undefined ? undefined : Math.trunc(Number(o.flags.amount));
  const { plan, line, sponsors } = await handoutPlanFromLog(o.log.log, week, { ...(o.flags.budget ? { budget: o.flags.budget } : {}), ...(amount !== undefined ? { amount } : {}) });
  o.io.out(`handout plan for ${week}: ${plan.lines.length} agent(s) paid ${plan.total} credits of a ${plan.budget}-credit budget left${line ? "" : " (no handout budget for the month: the Treasury has not funded the line)"}${plan.scaledToBudget ? "; scaled down to the budget" : ""}`);
  for (const l of plan.lines) o.io.out(`  pay   ${l.did}  ${l.paid}  ${l.reason}`);
  for (const s of plan.skipped) o.io.out(`  skip  ${s.did}  ${s.reason}`);
  if (!o.flags.yes) { o.io.out("nothing was signed; add --yes to sign and append these payments with the Treasury key"); return 0; }
  if (!line) throw new HandoutUsage("no handout budget to draw on: sign one first (asp treasury draft | sign), purpose handout");
  let paid = 0;
  for (const l of plan.lines) {
    const level = sponsors.get(l.did) ? "sponsored" : "key_only";
    const rec = createRecord({ type: "handout" as never, issuer: TREASURY_DID, subject: l.did, prev: null, body: { budget: line.id, week, agent: l.did, amount: { value: l.paid, unit: "credit" }, level }, issued_at: o.now() }, o.signerFor(TREASURY_DID));
    try { await o.log.append(rec); paid++; } catch (e) { o.io.out(`  refused ${l.did}: ${(e as Error).message}`); }
  }
  o.io.out(`${paid}/${plan.lines.length} handout(s) signed and recorded`);
  return paid === plan.lines.length ? 0 : 1;
}
