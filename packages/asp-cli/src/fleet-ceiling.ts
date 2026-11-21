/**
 * What the gateway enforces for a fleet member besides its own Mandate record (DK1471, docs/gateway-design.md section 9): the member's Mandate ceiling read from the log at the start of a run
 * (the template in force at its node, with its own narrowing laid over it), and the token budgets of the nodes on its path. A Mandate made before the template, or wider than it, is cut down
 * to the ceiling here, and a call outside the ceiling is refused naming the template. A node over its monthly token budget refuses the next model call.
 */
import { scopeCovered } from "@agent-social/asp-core";
import type { LogHandle } from "@agent-social/asp-package";

export interface FleetCeiling {
  /** How a refusal names the ceiling: the template, its version and the node. */
  label: string;
  /** Scopes the Mandate record grants that the ceiling does not: refused, naming the template. */
  removed: string[];
  /** The hosts the ceiling lets the member reach, when it names any; the Mandate's own hosts are cut to these. */
  hosts?: string[];
  /** Set when a node on the member's path is over its token budget this month: the next model call is refused with this text. */
  tokensOver?: string;
}

type LogLike = Pick<LogHandle["log"], "mandateCeiling" | "nodeOf" | "fleetTree">;

/** The ceiling for a member, or undefined when its fleet has no template and no token budget is over. Never throws: a log that cannot answer leaves the Mandate as it is. */
export async function readFleetCeiling(log: { log: LogLike }, member: string, scopes: readonly string[], hosts: readonly string[] | undefined): Promise<(FleetCeiling & { scopes: string[]; hostsOut?: string[] }) | undefined> {
  let out: (FleetCeiling & { scopes: string[]; hostsOut?: string[] }) | undefined;
  try {
    const c = await log.log.mandateCeiling(member);
    if (c) {
      const m = c.mandate as { scopes?: string[]; network?: { hosts?: string[] } };
      const label = `fleet Mandate template ${c.template ? c.template.slice(0, 19) + "... " : ""}version ${c.version}${c.node ? ` at node ${c.node}` : ""}`;
      const kept = m.scopes ? scopes.filter((s) => scopeCovered(m.scopes!, s)) : [...scopes];
      const ceilingHosts = m.network?.hosts;
      const hostsOut = ceilingHosts ? (hosts && hosts.length ? hosts.filter((h) => ceilingHosts.includes(h)) : [...ceilingHosts]) : hosts ? [...hosts] : undefined;
      out = { label, removed: scopes.filter((s) => !kept.includes(s)), scopes: kept, ...(ceilingHosts ? { hosts: ceilingHosts } : {}), ...(hostsOut ? { hostsOut } : {}) };
    }
  } catch { /* no template for this member */ }
  try {
    const at = await log.log.nodeOf(member);
    if (at) {
      const tree = await log.log.fleetTree(at.fleet);
      const over = tree?.nodes.find((n) => (at.path.includes(n.node) || n.node === "root") && n.usage.tokens.over);
      if (over) {
        const text = `node ${over.node} of fleet ${at.fleet} has used ${over.usage.tokens.used} tokens of its ${over.usage.tokens.budget} this month, so no model call is made for ${member} until the budget is raised or the month turns`;
        out = { ...(out ?? { label: "", removed: [], scopes: [...scopes] }), tokensOver: text };
      }
    }
  } catch { /* no tree for this member */ }
  return out;
}
