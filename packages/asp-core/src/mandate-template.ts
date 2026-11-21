/**
 * The Mandate template of a fleet or a persona (register row DK1355; spec-delta S1408): one Mandate the sponsor signs once, from which the Mandate of every member derives, and the test that a member's own change only narrows it.
 * Pure and integer-only, no clock and no store, the same arithmetic in the Python SDK (python/src/asp_core/mandate_template.py) and held to conformance/vectors/mandate-template.json.
 * A Mandate here is the body of an `asp.mandate/v0.2` record without its contract. Credits are accounting entries, not money.
 */

export type MandateLike = Record<string, any>;

const IRREVERSIBLE_STRICTNESS: Record<string, number> = { allow: 0, checkpoint: 1, forbid: 2 };
/** Lower is stricter. */
const SELF_MODIFICATION_LOOSENESS: Record<string, number> = { forbidden: 0, principal_approves: 1, sponsor_approves: 2, mentor_approves: 3, automatic_audited: 4 };

/** A ceiling scope covers a scope when they are equal or the ceiling is `prefix.*` and the scope sits under `prefix.`. */
export const scopeCovered = (ceiling: string[], scope: string): boolean => ceiling.some((c) => c === scope || (c.endsWith(".*") && scope.startsWith(c.slice(0, -1))));

/**
 * The ways a candidate Mandate goes beyond a ceiling: one field name for each (`scopes`, `forbidden_means`, `spend`, `irreversible`, `subcontract`, `nodes`, `learning`, `self_modification`, `checkpoints`, `expires`,
 * `network`, `institution_spend`, `token_budget`, `loop_limits`). Empty means the candidate is within the ceiling: it only narrows it. A field the ceiling does not state limits nothing.
 */
export function mandateViolations(ceiling: MandateLike, m: MandateLike): string[] {
  const out: string[] = [];
  const has = (x: unknown): boolean => x !== undefined && x !== null;
  if (has(ceiling.scopes) && !(m.scopes ?? []).every((s: string) => scopeCovered(ceiling.scopes, s))) out.push("scopes");
  if (has(ceiling.forbidden_means) && !(ceiling.forbidden_means as string[]).every((f) => (m.forbidden_means ?? []).includes(f))) out.push("forbidden_means");
  if (has(ceiling.spend)) {
    const c = ceiling.spend, s: MandateLike = m.spend ?? {};
    if (!(typeof s.cap === "number" && s.cap <= c.cap) || (has(c.per_action_max) && !(typeof s.per_action_max === "number" && s.per_action_max <= c.per_action_max))) out.push("spend");
  }
  if (has(ceiling.irreversible) && (IRREVERSIBLE_STRICTNESS[(m.irreversible as MandateLike | undefined)?.policy] ?? -1) < IRREVERSIBLE_STRICTNESS[ceiling.irreversible.policy]) out.push("irreversible");
  if (has(ceiling.subcontract)) {
    const c = ceiling.subcontract, s: MandateLike = m.subcontract ?? {};
    if ((s.allowed && !c.allowed) || (has(c.max_depth) && s.allowed && !(typeof s.max_depth === "number" && s.max_depth <= c.max_depth))) out.push("subcontract");
  }
  if (has(ceiling.nodes) && !(typeof m.nodes?.max_parallel === "number" && m.nodes.max_parallel <= ceiling.nodes.max_parallel)) out.push("nodes");
  if (has(ceiling.learning)) {
    const c = ceiling.learning, s: MandateLike = m.learning ?? {};
    if ((s.share_to_commons && !c.share_to_commons) || s.scope !== c.scope) out.push("learning");
  }
  if (has(ceiling.self_modification) && !((SELF_MODIFICATION_LOOSENESS[m.self_modification] ?? 99) <= SELF_MODIFICATION_LOOSENESS[ceiling.self_modification])) out.push("self_modification");
  if (has(ceiling.checkpoints) && !(ceiling.checkpoints as string[]).every((k) => (m.checkpoints ?? []).includes(k))) out.push("checkpoints");
  if (has(ceiling.expires) && !(has(m.expires) && Date.parse(m.expires) <= Date.parse(ceiling.expires))) out.push("expires");
  if (has(ceiling.network?.hosts)) {
    const hosts: string[] = m.network?.hosts ?? [];
    if (!hosts.length || !hosts.every((h) => (ceiling.network.hosts as string[]).includes(h))) out.push("network");
  }
  if (has(ceiling.token_budget)) {
    // a token budget only narrows: each limit the ceiling states must be stated, and no higher, by the candidate
    const c = ceiling.token_budget as MandateLike, s: MandateLike = m.token_budget ?? {};
    for (const k of ["per_run", "per_month", "per_day"]) if (has(c[k]) && !(typeof s[k] === "number" && s[k] <= c[k])) { out.push("token_budget"); break; }
  }
  if (has(ceiling.loop_limits)) {
    // loop limits only narrow: every limit the ceiling states must be stated, and no higher, by the candidate
    const c = ceiling.loop_limits as MandateLike, s: MandateLike = m.loop_limits ?? {};
    for (const k of ["equivalent_calls", "depth", "near_repeats"]) if (has(c[k]) && !(typeof s[k] === "number" && s[k] <= c[k])) { out.push("loop_limits"); break; }
  }
  if (has(ceiling.institution_spend)) {
    const lines: { institution: string; cap: { value: number }; period: string }[] = m.institution_spend ?? [];
    const ok = lines.every((l) => (ceiling.institution_spend as typeof lines).some((c) => c.institution === l.institution && c.period === l.period && l.cap.value <= c.cap.value));
    if (!ok) out.push("institution_spend");
  }
  return out;
}

/**
 * The Mandate of a member for a contract (S1408): the template's Mandate with the contract named, and the member's own narrowing laid over it. A narrowing that goes beyond the template is refused (it may only narrow):
 * the error names the fields. The result is always within the template.
 */
export function deriveMandate(template: MandateLike, contract: string, narrowing?: MandateLike | null): { mandate: MandateLike } | { widens: string[] } {
  const base: MandateLike = { ...template, contract };
  if (!narrowing || !Object.keys(narrowing).length) return { mandate: base };
  const candidate: MandateLike = { ...base, ...narrowing, contract };
  const widens = mandateViolations(template, candidate);
  return widens.length ? { widens } : { mandate: candidate };
}
