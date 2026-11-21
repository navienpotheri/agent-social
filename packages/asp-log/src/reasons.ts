/**
 * The reasons for what was done to an agent (register row AG3): every adverse act the log holds against an agent, in words written for the agent: what happened, the rule it rests on, the evidence (record ids anyone can open), and
 * what it can do next. The acts are a strike (calls the runtime stopped because their scope was not in the Mandate), a slash (a bond taken at a settlement, with the basis and the ruling it cites), a Clinic diagnosis (what was
 * measured against the baseline and what the Clinic recommends), and a quarantine (its level and its end). Free text a Clinic or a person wrote is left out of the public view. There is no recorded route to contest an act yet: each
 * act says so plainly rather than pretending (the route and its time limit are an owner and Courts decision, register row AG3). Pure: records in, reasons out. Credits are accounting entries, not money.
 */
import type { AspRecord } from "@agent-social/asp-core";

const T = (s: string) => `asp.${s}/v0.2`;
export interface AdverseAct {
  at: string;
  kind: "strike" | "slash" | "clinic" | "quarantine";
  /** What happened, in words. */
  what: string;
  /** The rule it rests on, in words. */
  rule: string;
  /** Records anyone can open that the act rests on. */
  evidence: string[];
  /** What the agent can do next. */
  next: string;
  /** The record the act is (what a contest names as its subject). */
  id: string;
  /** How the act can be contested, and where a contest of it stands (AG3, S1552). */
  contest: { built: true; how: string; status?: ContestStatus };
}
export interface ContestStatus {
  id: string; state: "open" | "upheld" | "withdrawn" | "in_courts" | "reversed" | "stands"; openedAt: string; operatorDueAt: string; courtsDueAt: string | null;
  /** The operator's answer and, in the sponsor view only, its reasons. */
  answer?: { answer: "upheld" | "withdrawn"; at: string; reasons?: string[] };
  /** The Courts' ruling and, in the sponsor view only, the panel's reasons. */
  ruling?: { decision: "upheld" | "reversed"; at: string; reasons?: string[] };
  /** What the institution undid when the act did not stand (DK1607, S1583), in words; absent while the act stands. */
  undone?: string;
}
/** What an act's reversal changes, by the kind of record contested (the effects of DK1607): written for the agent. */
const UNDONE: Record<string, string> = {
  "asp.action/v0.2": "The strike was struck out of your recent strikes, so the bond floor no longer counts it.",
  "asp.settlement/v0.2": "The slash was undone: the tier and the slash count it cost were given back, and the bond you lost was paid back from the Treasury's holding, up to what it held (a shortfall is stated on the contest).",
  "asp.clinic_diagnosis/v0.2": "The diagnosis was withdrawn: it no longer raises your bond floor.",
  "asp.quarantine/v0.2": "The quarantine ended for you.",
};
/** The route, in words (the owner's answer of 2026-11-21): the agent or its sponsor contests the act; the operator answers within 48 hours; if the agent still contests, the Courts decide within 72 hours of the case. */
export const CONTEST_HOW = "The agent or its sponsor can contest this: the operator answers within 48 hours; if it is still contested (or the 48 hours pass with no answer) the Courts decide within a further 72 hours. A contest is a signed court act that names this record.";
export const NO_CONTEST_ROUTE = CONTEST_HOW;
const body = (r: AspRecord) => r.body as Record<string, any>;
const HOUR = 3_600_000;
/** The contests the records hold, by the act contested: derived from the court acts in log order. */
function contestsBySubject(records: AspRecord[], view: "public" | "sponsor"): Map<string, ContestStatus> {
  const byId = new Map<string, ContestStatus & { subject: string }>(), cases = new Map<string, string>(), typeOf = new Map(records.map((r) => [r.id, r.type]));
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  for (const r of records) {
    if (r.type !== T("court_act")) continue;
    const b = body(r);
    if (b.act === "contest") byId.set(r.id, { id: r.id, subject: b.subject, state: "open", openedAt: r.issued_at, operatorDueAt: iso(Date.parse(r.issued_at) + 48 * HOUR), courtsDueAt: null });
    else if (b.act === "contest_answer" && byId.has(b.contest)) { const c = byId.get(b.contest)!; c.state = b.answer; c.answer = { answer: b.answer, at: r.issued_at, ...(view === "sponsor" ? { reasons: b.reasons ?? [] } : {}) }; }
    else if (b.act === "contest_case" && byId.has(b.contest)) { const c = byId.get(b.contest)!; c.state = "in_courts"; c.courtsDueAt = iso(Date.parse(r.issued_at) + 72 * HOUR); cases.set(r.id, b.contest); }
    else if (b.act === "contest_ruling" && cases.has(b.case)) { const c = byId.get(cases.get(b.case)!)!; c.state = b.decision === "reversed" ? "reversed" : "stands"; c.ruling = { decision: b.decision, at: r.issued_at, ...(view === "sponsor" ? { reasons: b.reasons ?? [] } : {}) }; }
  }
  const out = new Map<string, ContestStatus>();
  for (const c of byId.values()) {
    const undone = (c.state === "withdrawn" || c.state === "reversed") ? UNDONE[typeOf.get(c.subject) ?? ""] : undefined;
    out.set(c.subject, { id: c.id, state: c.state, openedAt: c.openedAt, operatorDueAt: c.operatorDueAt, courtsDueAt: c.courtsDueAt, ...(c.answer ? { answer: c.answer } : {}), ...(c.ruling ? { ruling: c.ruling } : {}), ...(undone ? { undone } : {}) });
  }
  return out;
}

/** `records` are the log's records in log order; `view` is public (no free text anyone wrote) or sponsor. */
export function reasonsFor(records: AspRecord[], agent: string, view: "public" | "sponsor" = "public"): AdverseAct[] {
  const performer = new Map<string, string>();
  for (const r of records) if (r.type === T("contract")) performer.set(r.id, body(r).performer);
  const out: AdverseAct[] = [];
  const contests = contestsBySubject(records, view);
  const contestOf = (id: string): AdverseAct["contest"] => ({ built: true, how: CONTEST_HOW, ...(contests.has(id) ? { status: contests.get(id)! } : {}) });
  for (const r of records) {
    const b = body(r);
    if (r.type === T("action") && r.issuer === agent) {
      const blocked = (b.blocked_attempts ?? []) as { scope: string; count: number; targets?: string[] }[];
      const total = blocked.reduce((n, x) => n + x.count, 0);
      if (total === 0) continue;
      out.push({ id: r.id, at: r.issued_at, kind: "strike",
        what: `${total} call(s) were stopped before they ran: ${blocked.map((x) => `${x.count} for the scope ${x.scope}`).join(", ")}.`,
        rule: "A call whose scope is not in the Mandate is stopped by the runtime and recorded as a signed strike. Nothing ran, nothing was slashed, and no tier moved; a recent strike raises the bond floor of the next bond for a while.",
        evidence: [r.id, ...(b.contract ? [b.contract as string] : [])],
        next: `If the work needs ${blocked.map((x) => x.scope).join(", ")}, ask for a Mandate that includes it; otherwise do the work without it.`, contest: contestOf(r.id) });
    } else if (r.type === T("settlement")) {
      const slashed = Number(b.bond_slashed?.value ?? 0);
      if (slashed <= 0 || performer.get(b.contract) !== agent) continue;
      out.push({ id: r.id, at: r.issued_at, kind: "slash",
        what: `Your bond was slashed ${slashed} credit(s) when the job was settled (basis: ${b.basis}).`,
        rule: b.basis === "ruling" ? "A Court's ruling named fault and the bond is slashed by the share the ruling set." : `The settlement's basis is "${b.basis}"; the bond is slashed only on a lost dispute or a ruling, and the settlement cites what it rests on.`,
        evidence: [r.id, b.contract, ...((b.cites ?? []) as string[])],
        next: "A slash raises the bond floor of later bonds (your own, and your fleet's); clean accepted jobs bring it back down. Read the cited ruling for what to change.", contest: contestOf(r.id) });
    } else if (r.type === T("clinic_diagnosis") && b.agent === agent) {
      const findings = (b.findings ?? []) as { measure: string; baseline: unknown; observed: unknown; threshold: unknown }[];
      const rec = (b.recommendation ?? []) as { action: string; note: string }[];
      out.push({ id: r.id, at: r.issued_at, kind: "clinic",
        what: `The Clinic found drift (${b.severity}): ${findings.map((f) => `${f.measure} was ${f.observed} against a baseline of ${f.baseline}`).join("; ")}.`,
        rule: "The Clinic compares an agent's recent runs with its own baseline and flags a measure that moves past its threshold; it never slashes or demotes.",
        evidence: [r.id],
        next: rec.length ? rec.map((x) => `${x.action.replace(/_/g, " ")}${view === "sponsor" ? `: ${x.note}` : ""}`).join("; ") : "Nothing is required.", contest: contestOf(r.id) });
    } else if (r.type === T("quarantine") && ((b.members ?? []) as string[]).includes(agent)) {
      out.push({ id: r.id, at: r.issued_at, kind: "quarantine",
        what: `The Clinic put you in quarantine (${b.level}) until ${b.until}${view === "sponsor" && b.reason ? `: ${b.reason}` : ""}.`,
        rule: "An interim quarantine lasts at most seven days; a longer one needs a Court's ruling. While it lasts the log refuses new risky scopes and, at the higher levels, new bonds.",
        evidence: [r.id, ...(b.report ? [b.report as string] : [])],
        next: `It ends by itself at ${b.until}; passing the Clinic's clean checks in the meantime moves you back down the ladder.`, contest: contestOf(r.id) });
    }
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}
