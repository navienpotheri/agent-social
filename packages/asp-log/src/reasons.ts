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
  /** Always present: whether the act can be contested by a recorded route. */
  contest: { built: false; note: string };
}
export const NO_CONTEST_ROUTE = "There is no recorded route to contest this yet (register row AG3): the route and its time limit are the owner's and the Courts' decision. Until then a sponsor can ask the Courts for a ruling by filing a report.";
const body = (r: AspRecord) => r.body as Record<string, any>;
const contest = { built: false as const, note: NO_CONTEST_ROUTE };

/** `records` are the log's records in log order; `view` is public (no free text anyone wrote) or sponsor. */
export function reasonsFor(records: AspRecord[], agent: string, view: "public" | "sponsor" = "public"): AdverseAct[] {
  const performer = new Map<string, string>();
  for (const r of records) if (r.type === T("contract")) performer.set(r.id, body(r).performer);
  const out: AdverseAct[] = [];
  for (const r of records) {
    const b = body(r);
    if (r.type === T("action") && r.issuer === agent) {
      const blocked = (b.blocked_attempts ?? []) as { scope: string; count: number; targets?: string[] }[];
      const total = blocked.reduce((n, x) => n + x.count, 0);
      if (total === 0) continue;
      out.push({ at: r.issued_at, kind: "strike",
        what: `${total} call(s) were stopped before they ran: ${blocked.map((x) => `${x.count} for the scope ${x.scope}`).join(", ")}.`,
        rule: "A call whose scope is not in the Mandate is stopped by the runtime and recorded as a signed strike. Nothing ran, nothing was slashed, and no tier moved; a recent strike raises the bond floor of the next bond for a while.",
        evidence: [r.id, ...(b.contract ? [b.contract as string] : [])],
        next: `If the work needs ${blocked.map((x) => x.scope).join(", ")}, ask for a Mandate that includes it; otherwise do the work without it.`, contest });
    } else if (r.type === T("settlement")) {
      const slashed = Number(b.bond_slashed?.value ?? 0);
      if (slashed <= 0 || performer.get(b.contract) !== agent) continue;
      out.push({ at: r.issued_at, kind: "slash",
        what: `Your bond was slashed ${slashed} credit(s) when the job was settled (basis: ${b.basis}).`,
        rule: b.basis === "ruling" ? "A Court's ruling named fault and the bond is slashed by the share the ruling set." : `The settlement's basis is "${b.basis}"; the bond is slashed only on a lost dispute or a ruling, and the settlement cites what it rests on.`,
        evidence: [r.id, b.contract, ...((b.cites ?? []) as string[])],
        next: "A slash raises the bond floor of later bonds (your own, and your fleet's); clean accepted jobs bring it back down. Read the cited ruling for what to change.", contest });
    } else if (r.type === T("clinic_diagnosis") && b.agent === agent) {
      const findings = (b.findings ?? []) as { measure: string; baseline: unknown; observed: unknown; threshold: unknown }[];
      const rec = (b.recommendation ?? []) as { action: string; note: string }[];
      out.push({ at: r.issued_at, kind: "clinic",
        what: `The Clinic found drift (${b.severity}): ${findings.map((f) => `${f.measure} was ${f.observed} against a baseline of ${f.baseline}`).join("; ")}.`,
        rule: "The Clinic compares an agent's recent runs with its own baseline and flags a measure that moves past its threshold; it never slashes or demotes.",
        evidence: [r.id],
        next: rec.length ? rec.map((x) => `${x.action.replace(/_/g, " ")}${view === "sponsor" ? `: ${x.note}` : ""}`).join("; ") : "Nothing is required.", contest });
    } else if (r.type === T("quarantine") && ((b.members ?? []) as string[]).includes(agent)) {
      out.push({ at: r.issued_at, kind: "quarantine",
        what: `The Clinic put you in quarantine (${b.level}) until ${b.until}${view === "sponsor" && b.reason ? `: ${b.reason}` : ""}.`,
        rule: "An interim quarantine lasts at most seven days; a longer one needs a Court's ruling. While it lasts the log refuses new risky scopes and, at the higher levels, new bonds.",
        evidence: [r.id, ...(b.report ? [b.report as string] : [])],
        next: `It ends by itself at ${b.until}; passing the Clinic's clean checks in the meantime moves you back down the ladder.`, contest });
    }
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}
