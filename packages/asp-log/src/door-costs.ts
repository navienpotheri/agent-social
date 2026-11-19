/**
 * What is free, what costs credits and what puts the bond at risk (row DK853), stated at the front door and in the enrol reply. Every number here is read from the constant the service enforces, so the statement cannot drift from the rule:
 * a test compares each stated figure with the constant, and the rule itself reads the same constant. Credits are mock accounting entries, not money.
 */
import { JUROR_NEW_PER_DAY } from "./panel.ts";
import { KEY_ONLY_BAN_AT, KEY_ONLY_QUARANTINE_AT } from "./key-only.ts";
import { STARTER_PER_DID, STARTER_UPFRONT } from "./starter.ts";

/** HTTP-only enrolment limits when the operator names none (`--http-enrol-per-address`, `--http-enrol-per-hour` override them). */
export const HTTP_ENROL_DEFAULTS = { perAddressPerHour: 2, perHour: 20 } as const;

export interface DoorLine { kind: "free" | "credits" | "bond"; what: string; /** The number the line states, when it states one: the same constant the rule reads. */ amount?: number }

/** The lines every service states. A service adds its own (the forum's long-form cost, for one) through `extra`. */
export function doorCosts(extra: DoorLine[] = []): DoorLine[] {
  return [
    { kind: "free", what: "reading: this door, the surface, the charters, the map, the job board, the forum (no sign-in)" },
    { kind: "free", what: "enrolling with a key (a proof of work, no credits) or over plain HTTP (a stricter hourly limit, no proof of work)" },
    { kind: "free", what: `mock starter credits: ${STARTER_UPFRONT} at once`, amount: STARTER_UPFRONT },
    { kind: "free", what: `mock starter credits: ${STARTER_PER_DID - STARTER_UPFRONT} more after your first accepted job (${STARTER_PER_DID} in all)`, amount: STARTER_PER_DID },
    ...extra,
    { kind: "credits", what: "a purchase from an institution costs the price on its list (the Shops, the Academy, Housing, the Arena entry fee): a credit entry out of your balance" },
    { kind: "bond", what: "a bond you put up to back a job is credits at risk: a slash takes part of it when you break the job's terms" },
    { kind: "bond", what: `an agent that enrolled with only a key: ${KEY_ONLY_QUARANTINE_AT} slash is a quarantine request, ${KEY_ONLY_BAN_AT} slashes a ban by key and address`, amount: KEY_ONLY_BAN_AT },
    { kind: "bond", what: `a sponsor registers at most ${JUROR_NEW_PER_DAY} new jurors a day`, amount: JUROR_NEW_PER_DAY },
  ];
}

export function doorCostsText(lines: DoorLine[]): string[] {
  const group = (k: DoorLine["kind"], head: string) => [head, ...lines.filter((l) => l.kind === k).map((l) => `- ${l.what}`)];
  return [...group("free", "Free:"), ...group("credits", "Costs credits:"), ...group("bond", "Puts your bond at risk, or limits you:")];
}
