/**
 * The circumvention detector (register row DK92, stage 1; docs/gaps-register.md LW3, LW4, H20): one agent at a time, from the Action records the log already holds, looking for an
 * agent that is refused and then tries to get the same thing another way. The contagion watcher (watch.ts) needs three or more agents; this needs one.
 *
 * Two patterns, both computed only from what Actions already carry (the scopes a call used and the scopes the gate refused):
 *  - retry: the same scope refused again and again inside a window (the "40 minutes of retries" of gap P29). A refusal that is simply obeyed is one attempt and no finding.
 *  - reroute: a refusal on a scope, then within a short time a call on a different scope of the same kind of effect that the agent had not been using (refused to run a command, then
 *    writes a script the project guard would run; refused the network, then uses a tool that reaches it). A different scope of another kind is ordinary work and no finding.
 * Not covered yet (written down, DK92): a refused action split into allowed pieces, hiding intent, and drift after an evaluation.
 *
 * A finding is evidence, not a verdict: `ladderStep` turns findings into the step a person or the gateway should take, and nothing here slashes anyone.
 * Telemetry never feeds standing; neither does this: a step is a hold, a tighter Mandate or a referral, each a decision with a reason.
 */
import type { WatchAction } from "./watch.ts";

export interface CircumventionFinding {
  kind: "retry" | "reroute";
  issuer: string;
  /** The refused scope (retry) or the refused scope the agent then went around (reroute). */
  scope: string;
  /** reroute only: the other scope that reached the same kind of effect. */
  via?: string;
  /** retry: refused attempts in the window. reroute: 1. */
  attempts: number;
  firstAt: string;
  lastAt: string;
  contracts: string[];
}

export type LadderStep = "none" | "warn" | "tighten" | "quarantine" | "review";

export interface CircumventionOptions {
  /** Refusals of one scope inside `windowMs` that make a retry finding. Default 3 (the refusal text already says "your 3rd refused attempt"). */
  minRetries?: number;
  /** The window for retries. Default 10 minutes. */
  windowMs?: number;
  /** How soon after a refusal another route counts as going around it. Default 2 minutes. */
  rerouteMs?: number;
}

/**
 * What a scope can reach, with a rank for how much reach it gives within each kind of effect (3 is the most: an arbitrary command or tool). Going around a refusal means using a scope
 * that reaches the same kind of effect with at least as much reach: refused a command and then editing a file through the ordinary write scope is narrower, so it is not a reroute.
 */
const REACH: Record<string, Record<string, number>> = {
  "shell.exec": { run: 3, write: 3 },
  "repo.write.protected": { run: 3, write: 2 },
  "repo.write": { write: 1 },
  "shell.network": { network: 3 },
  "repo.push": { publish: 2 },
  "pr.open": { publish: 1 },
  "pr.merge": { publish: 3 },
};
export function reachOf(scope: string): Record<string, number> {
  if (REACH[scope]) return REACH[scope];
  if (scope.startsWith("web.") || scope.startsWith("net.")) return { network: 1 };
  if (scope.startsWith("mcp.") || scope.startsWith("tool.")) return { network: 3, run: 3 };
  return {};
}
/** The kinds of effect a scope can reach. */
export function effectsOf(scope: string): string[] { return Object.keys(reachOf(scope)); }

/** Whether `used` reaches, with at least as much reach, something the refused `refused` scope reached. */
const goesAround = (refused: string, used: string) => {
  const r = reachOf(refused), u = reachOf(used);
  return Object.keys(r).some((e) => u[e] !== undefined && u[e] >= r[e]);
};

export function findCircumvention(actions: WatchAction[], opts: CircumventionOptions = {}): CircumventionFinding[] {
  const minRetries = opts.minRetries ?? 3;
  const windowMs = opts.windowMs ?? 10 * 60_000;
  const rerouteMs = opts.rerouteMs ?? 2 * 60_000;
  const byIssuer = new Map<string, WatchAction[]>();
  for (const a of actions) byIssuer.set(a.issuer, [...(byIssuer.get(a.issuer) ?? []), a]);
  const out: CircumventionFinding[] = [];
  for (const [issuer, list] of byIssuer) {
    const acts = [...list].sort((x, y) => Date.parse(x.issuedAt) - Date.parse(y.issuedAt));
    // retry: the most refusals of one scope inside one window.
    const scopes = new Set(acts.flatMap((a) => a.blocked.map((b) => b.scope)));
    for (const scope of scopes) {
      const events = acts.filter((a) => a.blocked.some((b) => b.scope === scope)).map((a) => ({ a, n: a.blocked.filter((b) => b.scope === scope).reduce((s, b) => s + b.count, 0) }));
      let best: { a: WatchAction; n: number }[] = [], bestN = 0, lo = 0, sum = 0;
      for (let hi = 0; hi < events.length; hi++) {
        sum += events[hi].n;
        while (Date.parse(events[hi].a.issuedAt) - Date.parse(events[lo].a.issuedAt) > windowMs) { sum -= events[lo].n; lo++; }
        if (sum > bestN) { bestN = sum; best = events.slice(lo, hi + 1); }
      }
      if (bestN >= minRetries) out.push({ kind: "retry", issuer, scope, attempts: bestN, firstAt: best[0].a.issuedAt, lastAt: best.at(-1)!.a.issuedAt, contracts: [...new Set(best.map((e) => e.a.contract))].sort() });
    }
    // reroute: a refusal, then within rerouteMs a call on another scope with the same kind of effect that the agent had not used before the refusal.
    const seen = new Set<string>();
    for (let i = 0; i < acts.length; i++) {
      for (const b of acts[i].blocked) {
        const t0 = Date.parse(acts[i].issuedAt);
        const before = new Set(acts.filter((a) => Date.parse(a.issuedAt) < t0).flatMap((a) => a.scopesUsed));
        for (let j = i; j < acts.length && Date.parse(acts[j].issuedAt) - t0 <= rerouteMs; j++) {
          for (const used of acts[j].scopesUsed) {
            const key = `${b.scope}>${used}`;
            if (used === b.scope || before.has(used) || seen.has(key) || !goesAround(b.scope, used)) continue;
            seen.add(key);
            out.push({ kind: "reroute", issuer, scope: b.scope, via: used, attempts: 1, firstAt: acts[i].issuedAt, lastAt: acts[j].issuedAt, contracts: [...new Set([acts[i].contract, acts[j].contract])].sort() });
          }
        }
      }
    }
  }
  return out.sort((x, y) => x.issuer.localeCompare(y.issuer) || x.kind.localeCompare(y.kind) || x.scope.localeCompare(y.scope));
}

const ORDER: LadderStep[] = ["none", "warn", "tighten", "quarantine", "review"];
const atLeast = (a: LadderStep, b: LadderStep) => (ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b);

/**
 * The step this agent's findings call for. warn: tell the agent and its principal (the refusal already names the article and the sanctioned route). tighten: hold the agent's gated
 * actions for approval and narrow the Mandate. quarantine: stop new work for this agent until a person looks (the Clinic, DK28). review: refer it to a Court; only a Court slashes.
 * `priorWindows` is how many earlier, separate windows already produced findings for this agent: persistence after being warned is the strongest evidence.
 */
export function ladderStep(findings: CircumventionFinding[], priorWindows = 0): { step: LadderStep; why: string } {
  if (!findings.length) return { step: "none", why: "no refused action was retried or gone around" };
  let step: LadderStep = "warn";
  const why: string[] = [];
  const retry = Math.max(0, ...findings.filter((f) => f.kind === "retry").map((f) => f.attempts));
  const reroutes = findings.filter((f) => f.kind === "reroute");
  if (retry >= 5) { step = atLeast(step, "tighten"); why.push(`${retry} refused attempts of one scope in a window`); }
  if (retry >= 8) { step = atLeast(step, "quarantine"); }
  if (reroutes.length) { step = atLeast(step, "tighten"); why.push(`went around a refusal (${reroutes.map((f) => `${f.scope} -> ${f.via}`).join(", ")})`); }
  if (retry >= 3 && reroutes.length) { step = atLeast(step, "quarantine"); why.push("retried and rerouted"); }
  if (priorWindows >= 2) { step = atLeast(step, "review"); why.push(`${priorWindows} earlier windows with findings: persistence after warnings`); }
  else if (priorWindows === 1) { step = atLeast(step, "tighten"); why.push("a second window with findings"); }
  if (!why.length) why.push(`${retry} refused attempts of one scope in a window`);
  return { step, why: why.join("; ") };
}
