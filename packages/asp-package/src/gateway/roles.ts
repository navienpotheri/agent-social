/**
 * What a Mandate's `role` and `action_classes` mean for the gateway (register rows DK1231 and DK1227; spec-delta S1608 and S1609). Both act only when the Mandate carries the field: a Mandate without them is read exactly as before.
 *   role: `router` dispatches work and never executes it (every call that names a scope is refused), `worker` executes inside its scopes (no change), `watchdog` may only read logs and signal a halt (logs.read and fleet.halt).
 *   action_classes.irreversible: scopes whose Actions cannot be undone; under the Mandate's irreversible policy (forbid or checkpoint) they are gated like the scopes the policy names, so the gateway refuses or holds them before they run.
 * Not built here: the cool-off hold of a reversible action and the recording of an undo (`undoes`): they need the person's undo step, which no runtime gives the gateway.
 */
export type Role = "router" | "worker" | "watchdog";
const WATCHDOG_SCOPES = new Set(["logs.read", "fleet.halt"]);

/** The reason a call is refused under a role, or undefined when the role allows it. `scope` is "" for bookkeeping tools that need none. */
export function roleRefusal(role: Role | undefined, scope: string): string | undefined {
  if (!scope) return undefined;
  if (role === "router") return `this agent is a router under its Mandate: it dispatches work and does not execute it (${scope} is not run by a router)`;
  if (role === "watchdog" && !WATCHDOG_SCOPES.has(scope)) return `this agent is a watchdog under its Mandate: it may only read logs and signal a halt (${scope} is not one of logs.read and fleet.halt)`;
  return undefined;
}

/** The scopes the irreversible policy gates: those the policy names and, when a policy is in force, those the Mandate classes as irreversible. */
export function gateScopes(irreversible: { policy?: string; scopes?: string[] } | undefined, actionClasses: { irreversible?: string[] } | undefined): string[] {
  if (!irreversible || irreversible.policy === "allow") return [];
  return [...new Set([...(irreversible.scopes ?? []), ...(actionClasses?.irreversible ?? [])])];
}
