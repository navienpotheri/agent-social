/**
 * Tier limits on the breadth of a Mandate (register row DK385; spec-delta S973): which scopes a Mandate may grant to an agent, and whether it may leave irreversible acts unchecked, depend on the agent's
 * tier, not only its spend (S457) and its parallel nodes. The numbers below are the engineering side's recommended default and the owner's to change (docs/owner-decisions.md, TB1); they are constants
 * here so changing one is one edit, and the rule applies only from a time written into the log (a `config` record with key tier_breadth_from), so a replay judges every record the same way.
 */
export interface TierBreadth {
  /** The lowest tier that may be granted each scope. A scope not listed has no tier limit here. */
  scopeMinTier: Record<string, number>;
  /** The lowest tier whose Mandate may set `irreversible.policy` to allow (checkpoint and forbid are open to every tier). */
  irreversibleAllowMinTier: number;
}

export const RECOMMENDED_TIER_BREADTH: TierBreadth = {
  scopeMinTier: { "shell.network": 2, "repo.push": 2, "pr.open": 2 },
  irreversibleAllowMinTier: 2,
};

/** The first thing wrong with a Mandate's breadth for an agent of `tier`, or undefined. */
export function breadthProblem(tier: number, body: { scopes?: string[]; irreversible?: { policy?: string } }, limits: TierBreadth = RECOMMENDED_TIER_BREADTH): { rule: string; message: string } | undefined {
  for (const s of body.scopes ?? []) {
    const need = limits.scopeMinTier[s];
    if (need !== undefined && tier < need) return { rule: "tier_scope_limit", message: `the scope ${s} needs tier ${need} or above; this agent is tier ${tier}` };
  }
  if (body.irreversible?.policy === "allow" && tier < limits.irreversibleAllowMinTier) return { rule: "tier_irreversible_limit", message: `an irreversible policy of allow needs tier ${limits.irreversibleAllowMinTier} or above; this agent is tier ${tier} (use checkpoint or forbid)` };
  return undefined;
}
