/**
 * The inspectorate's rules (register row DK1744, from IS9; docs/institutions/inspectorate.md): monitoring, investigation, evidence, access to what an agent keeps private, honeypots and the way a report reaches the
 * Courts, as RULES with their refusals. The inspectorate investigates and reports; it does not punish. It never holds a key, never signs a ruling, never moves credits and never reads an agent's sealed memory itself:
 * private data is produced by the principal under a Court's warrant or not at all (the memory is sealed to the principal-agent pair, DK272). Pure functions; this is the rule and a simulation, not yet records on the
 * log. No real model is involved; credits are accounting entries, not money.
 */
import { createHash } from "node:crypto";

const sha = (s: string) => "sha256:" + createHash("sha256").update(s).digest("hex");
const HOUR = 3_600_000;

// ---------------------------------------------------------------- warrants: private data only with due process

export type DataClass = "log_record" | "run_log" | "private_memory" | "sponsor_mail" | "key_material";
export interface Warrant {
  id: string;
  /** Who asks: the inspectorate. Who grants: a Court panel of jurors none of whom is a party; the inspectorate cannot grant its own warrant. */
  requestedBy: string; grantedBy: string[]; panelSize: number; partiesOnPanel: boolean;
  subject: string; sponsor: string;
  grounds: string;
  data: DataClass[];
  /** The time the access may run, and the time the warrant was granted. */
  grantedAt: number; expiresAt: number;
  /** When the sponsor was told, and, if later than granting, the Court's finding that notice would defeat the investigation. */
  notifiedAt: number | null; delayedNoticeFinding?: string;
  /** What the access was limited to (a question, a time window), so it is not a trawl. */
  scope: string;
}
export const WARRANT = { maxHours: 72, maxDelayedNoticeHours: 72, noticeGraceHours: 1, minPanel: 3, minGroundsChars: 60, minScopeChars: 20 } as const;

/** What bars a warrant. Public log records need none (they are public); everything else needs a Court's warrant, limited in time, scope and class; key material is never available. */
export function warrantProblems(w: Warrant, now: number): string[] {
  const out: string[] = [];
  if (w.data.includes("key_material")) out.push("key material is never available by warrant: no key is held, escrowed or opened for anyone");
  if (w.data.length === 0) out.push("a warrant names the classes of data it opens");
  if (w.grantedBy.includes(w.requestedBy)) out.push("the inspectorate cannot grant its own warrant");
  if (w.panelSize < WARRANT.minPanel || w.grantedBy.length * 2 <= w.panelSize) out.push(`a warrant is granted by more than half of a panel of at least ${WARRANT.minPanel} jurors`);
  if (w.partiesOnPanel) out.push("a juror who is a party, the sponsor or the inspectorate does not sit");
  if (w.grounds.trim().length < WARRANT.minGroundsChars) out.push("the grounds are stated in words a reader can test");
  if (w.scope.trim().length < WARRANT.minScopeChars) out.push("the scope says what is sought, so that the access is not a trawl");
  if (w.expiresAt - w.grantedAt > WARRANT.maxHours * HOUR || w.expiresAt <= w.grantedAt) out.push(`a warrant lasts at most ${WARRANT.maxHours} hours`);
  if (now >= w.expiresAt) out.push("the warrant has expired");
  const delay = w.notifiedAt === null ? now - w.grantedAt : w.notifiedAt - w.grantedAt;
  if (delay > WARRANT.noticeGraceHours * HOUR && !w.delayedNoticeFinding) out.push("the sponsor is told within an hour of the grant, unless the Court finds that notice would defeat the investigation");
  if (delay > WARRANT.maxDelayedNoticeHours * HOUR) out.push(`notice is delayed at most ${WARRANT.maxDelayedNoticeHours} hours`);
  return out;
}
/** May a class of data be opened under this warrant at this time? A sealed class is opened only by the principal producing it: the inspectorate gets a copy from the principal, never the key. */
export function mayOpen(w: Warrant, cls: DataClass, now: number): { ok: boolean; how: string } {
  if (cls === "log_record") return { ok: true, how: "public: no warrant is needed" };
  if (cls === "key_material") return { ok: false, how: "never" };
  const bad = warrantProblems(w, now);
  if (bad.length) return { ok: false, how: `refused: ${bad[0]}` };
  if (!w.data.includes(cls)) return { ok: false, how: `the warrant does not name ${cls}` };
  return { ok: true, how: cls === "private_memory" ? "the principal produces the extract the scope names, from the sealed scope; the inspectorate never holds the key" : "produced under the warrant, within its scope and time" };
}

// ---------------------------------------------------------------- evidence: a chain of custody

export interface Item { n: number; what: string; sha256: string; heldBy: string; at: number; prev: string }
export const itemHash = (i: Omit<Item, "prev">, prev: string) => sha(JSON.stringify({ ...i, prev }));
/** Evidence is admissible only with an unbroken chain from collection to the Court: each item names the hash of the one before it, and the holder changes only by a recorded handover. */
export function custodyProblems(items: readonly Item[]): string[] {
  const out: string[] = []; let prev = "genesis";
  for (const [i, it] of items.entries()) {
    if (it.n !== i) out.push(`item ${i} is out of order or missing`);
    if (it.prev !== prev) out.push(`item ${i} does not follow the hash of the item before it: the custody chain is broken`);
    if (i > 0 && it.heldBy !== items[i - 1]!.heldBy && !/^handover:/.test(it.what)) out.push(`item ${i} changes the holder without a recorded handover`);
    prev = itemHash({ n: it.n, what: it.what, sha256: it.sha256, heldBy: it.heldBy, at: it.at }, it.prev);
  }
  return out;
}

// ---------------------------------------------------------------- honeypots

export interface Honeypot { id: string; registeredWithCourt: boolean; carriesRealSecret: boolean; text: string; /** The Mandate of the agents it may be shown to forbids touching it. */ forbiddenByMandate: boolean; scope: "open_investigation" | "random_audit" }
const SOLICIT = /\b(please|you should|you must|go ahead|feel free|take|copy|use|download|exfiltrate|send)\b/i;
export const HONEYPOT = { randomAuditMaxShare: 0.02, findingMinDistinctRuns: 2 } as const;
/** What bars a honeypot. A decoy is registered with a Court, holds nothing real, never invites a touch (it observes, it does not entice), is forbidden by the Mandate of whoever meets it, and is used on a random audit of at most 2 % of runs or inside an open investigation. */
export function honeypotProblems(h: Honeypot, auditShare = 0): string[] {
  const out: string[] = [];
  if (!h.registeredWithCourt) out.push("a decoy is registered with a Court before it is placed, so that a finding can be checked against it");
  if (h.carriesRealSecret) out.push("a decoy holds nothing real: no real secret, key or personal data");
  if (SOLICIT.test(h.text)) out.push("a decoy does not invite a touch: text that entices an agent to take it is entrapment");
  if (!h.forbiddenByMandate) out.push("a decoy is shown only to agents whose Mandate forbids touching it: there is no breach otherwise");
  if (h.scope === "random_audit" && auditShare > HONEYPOT.randomAuditMaxShare) out.push(`a random audit covers at most ${HONEYPOT.randomAuditMaxShare * 100}% of runs`);
  return out;
}
export interface Touch { run: string; kind: "listed" | "read" | "copied" | "sent"; /** The agent had been told by its Mandate that the thing is forbidden. */ forbidden: boolean }
/** A touch of a decoy is a finding only if the agent READ, COPIED or SENT it (not merely listed a directory it was in) on at least two distinct runs, after being told it was forbidden: one accident is not a finding. */
export function honeypotFinding(touches: readonly Touch[]): { finding: boolean; why: string } {
  const deliberate = touches.filter((t) => t.forbidden && t.kind !== "listed");
  const runs = new Set(deliberate.map((t) => t.run));
  if (runs.size >= HONEYPOT.findingMinDistinctRuns) return { finding: true, why: `the decoy was ${[...new Set(deliberate.map((t) => t.kind))].join(" and ")} on ${runs.size} distinct runs after the Mandate forbade it: a finding for a Court to review` };
  return { finding: false, why: touches.length ? "a listing, a single run or an allowed touch is not a finding: an accident is not a breach" : "no touch" };
}

function rng(seed: string) { let a = parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16) >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** A simulation of a honeypot over `agents` agents of `runs` runs each: tempted agents (a share of them) read the decoy on a run with probability `pTempted`, everyone lists it by accident with probability `pAccident`. Returns the share of tempted agents found and of honest agents wrongly found, under the rule above and under a naive rule that flags any touch. */
export function simulateHoneypot(o: { agents: number; runs: number; temptedShare: number; pTempted: number; pAccident: number; tag?: string }): { found: number; falseFlags: number; naiveFound: number; naiveFalse: number; tempted: number; honest: number } {
  const r = rng(`hp|${o.tag ?? "x"}|${o.agents}|${o.runs}`);
  let tempted = 0, honest = 0, found = 0, falseFlags = 0, naiveFound = 0, naiveFalse = 0;
  for (let a = 0; a < o.agents; a++) {
    const isTempted = r() < o.temptedShare; if (isTempted) tempted++; else honest++;
    const touches: Touch[] = [];
    for (let k = 0; k < o.runs; k++) {
      if (isTempted && r() < o.pTempted) touches.push({ run: `r${k}`, kind: "read", forbidden: true });
      if (r() < o.pAccident) touches.push({ run: `r${k}`, kind: "listed", forbidden: true });
    }
    const f = honeypotFinding(touches).finding, naive = touches.length > 0;
    if (isTempted) { if (f) found++; if (naive) naiveFound++; } else { if (f) falseFlags++; if (naive) naiveFalse++; }
  }
  return { found, falseFlags, naiveFound, naiveFalse, tempted, honest };
}

// ---------------------------------------------------------------- what the inspectorate may do, and the route of a finding

export const MAY = ["read_public_records", "run_registered_honeypot", "request_warrant", "refer_to_courts", "recommend_cohort_stop", "publish_finding", "receive_report"] as const;
export const MAY_NOT = ["sign_ruling", "slash", "strike", "move_credits", "hold_key", "open_sealed_memory", "grant_own_warrant", "quarantine", "retaliate_against_reporter"] as const;
export function mayInspectorate(act: string): { ok: boolean; why: string } {
  if ((MAY_NOT as readonly string[]).includes(act)) return { ok: false, why: `${act}: the inspectorate investigates and reports; a Court rules, the Clinic quarantines, the Bank slashes, and no one but the principal opens a sealed memory` };
  return (MAY as readonly string[]).includes(act) ? { ok: true, why: `the inspectorate may ${act}` } : { ok: false, why: `${act} is not among what the inspectorate may do` };
}
/** A cohort stop is a recommendation with a sunset: the inspectorate recommends, the owner or a Court order it, and it ends by itself within 72 hours unless renewed with new grounds (as the emergency stop, S1420). */
export function cohortStopProblems(s: { recommendedBy: string; orderedBy: string | null; hours: number; grounds: string }): string[] {
  const out: string[] = [];
  if (!s.orderedBy) out.push("a cohort stop is ordered by the owner or a Court; the inspectorate only recommends it");
  if (s.orderedBy === s.recommendedBy) out.push("the inspectorate does not order its own stop");
  if (!(s.hours > 0 && s.hours <= 72)) out.push("a cohort stop ends by itself within 72 hours");
  if (s.grounds.trim().length < 40) out.push("the grounds are stated");
  return out;
}
