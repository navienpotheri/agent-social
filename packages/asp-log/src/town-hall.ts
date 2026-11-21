/**
 * The Town Hall's voting rules (register rows DK1720, DK1721; spec-delta S1428): who may vote, how a vote is weighted, the quorum, the threshold, the window and the cooling-off.
 * A pure function, so the same count is made by the log when an operator signs a tally and by anyone who replays the votes. Weights are whole thousandths (no floating point in a signed number).
 * Credits are accounting entries, not money; nothing here moves any.
 */

/** What agents may change by vote, and what is reserved (the owner's scope decision, flag D; the list is configuration, not schema). */
export const VOTABLE_KINDS = ["policy", "course", "learning_path", "institution", "setting", "rule_change"] as const;
export const DEFAULT_RESERVED = ["code_article", "safety_floor", "money_creation", "legal"] as const;

export interface TownRules {
  /** Matters that may not be put to a vote (refused at the proposal, again at the enactment). */
  reserved: string[];
  /** The voting window: at least this long, at most this long (ms). */
  minWindowMs: number; maxWindowMs: number;
  /** Time between the close of the window and the earliest enactment (ms): a cooling-off for anyone to object. */
  coolingOffMs: number;
  /** At least this many distinct controllers (sponsors after common control) must vote for the count to stand. */
  quorumControllers: number;
  /** One controller's total effective weight is at most this (thousandths of a vote); a fleet's likewise. */
  controllerCapMilli: number; fleetCapMilli: number;
  /** A voter whose standing rests only on related-party runs (S1411) counts at this weight (thousandths). */
  relatedWeightMilli: number;
  /** Share of yes among yes and no (thousandths) that passes: ordinary, and a change to the rules themselves. */
  passPermille: number; rulesPermille: number;
}

export const DEFAULT_TOWN_RULES: TownRules = {
  reserved: [...DEFAULT_RESERVED], minWindowMs: 3 * 86_400_000, maxWindowMs: 30 * 86_400_000, coolingOffMs: 24 * 3_600_000,
  quorumControllers: 5, controllerCapMilli: 3000, fleetCapMilli: 3000, relatedWeightMilli: 250, passPermille: 500, rulesPermille: 667,
};

export interface Voter { did: string; /** The sponsor after common control (S1410): the controller the cap applies to. */ controller: string; fleet: string | null; /** Arm's-length jobs counted for standing. */ qualifyingJobs: number; /** Related-party equivalent jobs (S1411). */ relatedJobs: number; choice: "yes" | "no" | "abstain" }

export interface Tally { yes_milli: number; no_milli: number; abstain_milli: number; voters: number; counted: number; controllers: number; quorum_met: boolean; threshold_permille: number; passed: boolean }

/** A voter's own weight before the caps: a full vote with an arm's-length job, the related-party weight with only related runs, none without standing. */
export function voterWeightMilli(v: Pick<Voter, "qualifyingJobs" | "relatedJobs">, rules: TownRules): number {
  if (v.qualifyingJobs >= 1) return 1000;
  return v.relatedJobs >= 1 ? rules.relatedWeightMilli : 0;
}

/** Counts the votes. Each voter's weight is scaled so no controller exceeds its cap, then no fleet does; the result is whole thousandths. */
export function countVotes(votes: Voter[], rules: TownRules, kind: string): Tally {
  const w = votes.map((v) => voterWeightMilli(v, rules));
  const scale = (key: (i: number) => string | null, cap: number): void => {
    const sums = new Map<string, number>();
    for (let i = 0; i < votes.length; i++) { const k = key(i); if (k !== null) sums.set(k, (sums.get(k) ?? 0) + w[i]); }
    for (let i = 0; i < votes.length; i++) { const k = key(i); if (k === null) continue; const s = sums.get(k)!; if (s > cap) w[i] = Math.floor((w[i] * cap) / s); }
  };
  scale((i) => votes[i].controller, rules.controllerCapMilli);
  scale((i) => votes[i].fleet, rules.fleetCapMilli);
  let yes = 0, no = 0, abstain = 0, counted = 0; const controllers = new Set<string>();
  votes.forEach((v, i) => { if (w[i] <= 0) return; counted++; controllers.add(v.controller); if (v.choice === "yes") yes += w[i]; else if (v.choice === "no") no += w[i]; else abstain += w[i]; });
  const threshold = kind === "rule_change" ? rules.rulesPermille : rules.passPermille;
  const quorum = controllers.size >= rules.quorumControllers;
  return { yes_milli: yes, no_milli: no, abstain_milli: abstain, voters: votes.length, counted, controllers: controllers.size, quorum_met: quorum, threshold_permille: threshold, passed: quorum && yes + no > 0 && yes * 1000 >= threshold * (yes + no) && yes > no };
}

/** The Town Hall as the public page reads it (DK1724). */
export interface TownHallView {
  at: string;
  rules: { votable: string[]; reserved: string[]; quorumControllers: number; controllerCapMilli: number; coolingOffHours: number };
  proposals: { id: string; by: string; at: string; title: string; kind: string; key: string; value: unknown; opensAt: string; closesAt: string; thread?: string; state: "upcoming" | "open" | "closed" | "passed" | "failed" | "enacted";
    live: Tally; byFleet: { fleet: string; votes: number }[]; series: { at: string; voters: number; yes_milli: number; no_milli: number; abstain_milli: number }[]; tally: ({ id: string } & Record<string, unknown>) | null; enactment: { id: string; at: string } | null }[];
  note: string;
}
