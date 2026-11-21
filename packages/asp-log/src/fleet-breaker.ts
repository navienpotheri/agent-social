/**
 * The fleet-wide runaway breaker (register row DK1477; spec-delta S1423): what one agent's loop breaker (DK1230) cannot see. A whole fleet draining its budget in a spiral is a spend-rate problem at a tree node: the tokens and credits its
 * members used in a short window against the node's monthly budget prorated to that window, times a stated multiple. An agent-to-agent cycle (A hires B hires A) is a cycle in the hires of a window. Both are pure arithmetic over
 * records; the log method turns them into the running contracts to halt, and the halt is a signed `run_halt` (reasons `fleet_spend` and `cycle`). A fleet with no budget at the node has no pace to compare with, so the spend breaker does nothing for it.
 * Credits are accounting entries, not money.
 */
const MONTH_MS = 30 * 86_400_000;

export interface Pace { windowMs: number; multiple: number; budget: { credits?: number; tokens?: number } }
/** What the node may use in the window at `multiple` times its monthly pace (undefined for a resource the node has no budget for). */
export function allowedInWindow(p: Pace): { credits?: number; tokens?: number } {
  const per = (b: number | undefined) => (b === undefined ? undefined : Math.floor((b * p.windowMs * p.multiple) / MONTH_MS));
  return { ...(p.budget.credits !== undefined ? { credits: per(p.budget.credits) } : {}), ...(p.budget.tokens !== undefined ? { tokens: per(p.budget.tokens) } : {}) };
}
/** Whether a window's use trips the breaker: any resource with a budget used more than its allowance. */
export function tripped(used: { credits: number; tokens: number }, allowed: { credits?: number; tokens?: number }): string[] {
  const out: string[] = [];
  if (allowed.tokens !== undefined && used.tokens > allowed.tokens) out.push(`${used.tokens} tokens against ${allowed.tokens} allowed in the window`);
  if (allowed.credits !== undefined && used.credits > allowed.credits) out.push(`${used.credits} credits against ${allowed.credits} allowed in the window`);
  return out;
}

export interface Hire { principal: string; performer: string; at: number; contract: string }
/** Cycles of two to four agents in the hires of a window: each is the list of contracts that close it. A cycle is reported once, from its smallest agent. */
export function hireCycles(hires: Hire[]): { agents: string[]; contracts: string[] }[] {
  const out: { agents: string[]; contracts: string[] }[] = [];
  const by = new Map<string, Hire[]>();
  for (const h of hires) by.set(h.principal, [...(by.get(h.principal) ?? []), h]);
  const seen = new Set<string>();
  const dfs = (start: string, cur: string, path: string[], cs: string[]) => {
    for (const h of by.get(cur) ?? []) {
      if (h.performer === start && path.length >= 2) {
        const key = [...path].sort().join("|");
        if (!seen.has(key)) { seen.add(key); out.push({ agents: [...path], contracts: [...cs, h.contract] }); }
      } else if (h.performer > start && !path.includes(h.performer) && path.length < 4) dfs(start, h.performer, [...path, h.performer], [...cs, h.contract]);
    }
  };
  for (const s of [...by.keys()].sort()) dfs(s, s, [s], []);
  return out;
}
