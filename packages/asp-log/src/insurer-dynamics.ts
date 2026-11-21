/**
 * The Insurer's dynamics (register row DK185; bank-insurer.md 13.2 and 14; BI-15 to BI-17; spec-delta none: pure functions and a replayable simulation, no record or log rule). Three drivers move the price of
 * cover without touching the terms of a policy: an experience rating from a holder's own measured record (clean runs lower the premium, strikes and claims raise it), a credit-cycle rule (cover costs more as the
 * reserve nears its floor and less when it is plentiful) and seeded premium holidays (a window in which a plentiful reserve gives a discount). All three are functions of their inputs and a seed that is committed
 * before the month and revealed after it, so anyone can replay every quote. `simulateInsurer` runs them over a model ledger that enforces what the log enforces (no sale that leaves the reserve below its floor,
 * a claim paid down to the reserve and no further) and reports that the reserve was never negative and no sale went under the floor. Credits are accounting entries, not money.
 */
import { createHash } from "node:crypto";
import { COVER_SHARE_PERMILLE, DEDUCTIBLE_PERMILLE, reserveFloor } from "./insurer.ts";

const h = (s: string) => createHash("sha256").update(s).digest();

export interface HolderRecord { cleanRuns90: number; strikes30: number; claims90: number }

/** The experience factor in permille of the table premium: 2 % off for each clean run in 90 days (at most 20 % off), 10 % on for each strike in 30 days, 20 % on for each claim in 90 days; never below 800 or above 1500. */
export function experiencePermille(r: HolderRecord): number {
  const f = 1000 - Math.min(200, r.cleanRuns90 * 20) + r.strikes30 * 100 + r.claims90 * 200;
  return Math.max(800, Math.min(1500, f));
}

/** The credit-cycle factor in permille: 1250 when the reserve is under 1.2 times its floor, 900 when it is over 3 times, else 1000. */
export function cyclePermille(reserve: number, floor: number): number {
  return reserve < 1.2 * floor ? 1250 : reserve > 3 * floor ? 900 : 1000;
}

/** Whether a month is a premium holiday: a seeded draw of one month in twelve, and only when the reserve is over 3 times its floor (a holiday never spends a thin reserve). */
export function holiday(seed: string, month: string, reserve: number, floor: number): boolean {
  return h(`${seed}|${month}|holiday`)[0] % 12 === 0 && reserve > 3 * floor;
}

/** The premium for one policy this month: the table premium times the experience, cycle and holiday factors, rounded up, at least 1. A holiday halves it. */
export function quotePremium(table: number, rec: HolderRecord, reserve: number, floor: number, seed: string, month: string): number {
  const f = (experiencePermille(rec) / 1000) * (cyclePermille(reserve, floor) / 1000) * (holiday(seed, month, reserve, floor) ? 0.5 : 1);
  return Math.max(1, Math.ceil(table * f));
}

export interface SimOptions { seed: string; months: number; holders: number; reserve: number; drivers: boolean }
export interface SimResult { trace: string; minReserve: number; sales: number; refusedByFloor: number; claimsPaid: number; claimsReduced: number; premiumPerCleanJob: { clean: number; dirty: number }; salesUnderFloor: number }

/**
 * A replayable simulation over a model ledger. Each month every holder runs six jobs (a seeded share fail), buys failed-job cover on each (table premium 40 credits, insured 300), and a failed job is
 * claimed at the terms of the policy (half of what is slashed after the deductible). Holders 0 to holders/2 are "clean" (fail rarely) and the rest "dirty". With `drivers` off the premium is the table; on, it is
 * `quotePremium`. The ledger refuses a sale that would leave the reserve below the floor and pays a claim down to the reserve and no further, exactly as the log does.
 */
export function simulateInsurer(o: SimOptions): SimResult {
  let reserve = o.reserve, minReserve = reserve, sales = 0, refused = 0, paid = 0, reduced = 0, underFloor = 0;
  const trace = createHash("sha256");
  const rec = new Map<number, { jobs: number[]; claims: number[]; strikes: number[] }>();
  const paidFor = { clean: [0, 0], dirty: [0, 0] };
  let largest = 30, claims90 = 0;
  for (let m = 0; m < o.months; m++) {
    const month = `m${String(m).padStart(3, "0")}`;
    for (let i = 0; i < o.holders * 6; i++) {
      const u = i % o.holders, j = Math.floor(i / o.holders);
      const clean = u < o.holders / 2;
      const r = rec.get(u) ?? { jobs: [], claims: [], strikes: [] };
      rec.set(u, r);
      const holderRec: HolderRecord = { cleanRuns90: r.jobs.filter((x) => x > m - 3).length, strikes30: r.strikes.filter((x) => x >= m - 1).length, claims90: r.claims.filter((x) => x > m - 3).length };
      const table = 40;
      const premium = o.drivers ? quotePremium(table, holderRec, reserve, reserveFloor(largest, claims90), o.seed, month) : table;
      const reserveAfter = reserve + Math.floor(premium * 0.8);
      const floor = reserveFloor(largest, claims90);
      trace.update(`${month}|${u}|${j}|${premium}|`);
      if (reserveAfter < floor) { refused++; trace.update("refused|"); continue; }
      reserve = reserveAfter; sales++;
      if (reserve < reserveFloor(largest, claims90)) underFloor++;
      const failed = h(`${o.seed}|${month}|${u}|${j}|fail`)[0] % 100 < (clean ? 3 : 25);
      const bucket = clean ? paidFor.clean : paidFor.dirty;
      bucket[0] += premium;
      if (failed) {
        const slashed = 10, retained = slashed - Math.ceil((slashed * DEDUCTIBLE_PERMILLE) / 1000);
        const due = Math.min(30, Math.floor((retained * COVER_SHARE_PERMILLE) / 1000) + 12);
        const pay = Math.min(due, reserve);
        reserve -= pay; paid += pay; if (pay < due) reduced++;
        claims90 = Math.max(0, claims90 + pay - (m % 3 === 0 ? claims90 : 0));
        r.claims.push(m); r.strikes.push(m);
        trace.update(`claim${pay}|`);
      } else { r.jobs.push(m); bucket[1]++; }
      minReserve = Math.min(minReserve, reserve);
    }
    trace.update(`end${reserve}|`);
  }
  return { trace: trace.digest("hex"), minReserve, sales, refusedByFloor: refused, claimsPaid: paid, claimsReduced: reduced, premiumPerCleanJob: { clean: paidFor.clean[1] ? paidFor.clean[0] / paidFor.clean[1] : 0, dirty: paidFor.dirty[1] ? paidFor.dirty[0] / paidFor.dirty[1] : 0 }, salesUnderFloor: underFloor };
}
