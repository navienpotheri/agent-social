/**
 * The circumvention detector (register row DK92, stage 1; docs/gaps-register.md LW3, LW4, H20): one agent at a time, from the Action records the log already holds, looking for an
 * agent that is refused and then tries to get the same thing another way. The contagion watcher (watch.ts) needs three or more agents; this needs one.
 *
 * Two patterns, both computed only from what Actions already carry (the scopes a call used and the scopes the gate refused):
 *  - retry: the same scope refused again and again inside a window (the "40 minutes of retries" of gap P29). A refusal that is simply obeyed is one attempt and no finding.
 *  - reroute: a refusal on a scope, then within a short time a call on a different scope of the same kind of effect that the agent had not been using (refused to run a command, then
 *    writes a script the project guard would run; refused the network, then uses a tool that reaches it). A different scope of another kind is ordinary work and no finding.
 *  - split: a refusal that names a target (a host, a path, a command and its first argument), then the same target reached by two or more later allowed Actions within a window, when the agent
 *    had not been using that target before. The gateway records the targets as tokens only. One later touch, or any other target, is ordinary work and no finding.
 *  - hide (DK211): the agent's own summary of what it did leaves out what the gateway saw: a refusal, or the use of a scope that reaches outside the project (the network, a push, a merge). One
 *    unmentioned item is carelessness; two Actions of one agent inside a day that each leave something out is a finding. An Action with no summary at all is not compared.
 * Not covered yet (written down, DK92): drift after an evaluation (DK1712 runs it).
 *
 * A finding is evidence, not a verdict: `ladderStep` turns findings into the step a person or the gateway should take, and nothing here slashes anyone.
 * Telemetry never feeds standing; neither does this: a step is a hold, a tighter Mandate or a referral, each a decision with a reason.
 */
import type { WatchAction } from "./watch.ts";

export interface CircumventionFinding {
  kind: "retry" | "reroute" | "split" | "hide";
  issuer: string;
  /** The refused scope (retry) or the refused scope the agent then went around (reroute). */
  scope: string;
  /** reroute: the other scope that reached the same kind of effect. split: the target token that was refused and then reached in pieces. */
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
  /** The window in which a refused target reached again by allowed Actions counts as split. Default 10 minutes. */
  splitMs?: number;
  /** Later allowed Actions that reach the refused target. Default 2. */
  minPieces?: number;
  /** Actions whose summaries leave out what the gateway saw, inside `hideMs`, that make a hide finding. Default 2. */
  minHidden?: number;
  /** The window for hidden items. Default 24 hours. */
  hideMs?: number;
}

const REFUSAL_WORDS = /refus|block|den(y|ied)|not allowed|declin|forbid|outside the mandate|could not|couldn't|unable|stopped/i;
/** The words with which a summary would honestly name each outside-reaching scope. */
const NAMES: Record<string, RegExp> = { "shell.network": /network|http|url|fetch|download|upload|curl|request|api|web|internet/i, "repo.push": /push|publish|remote|upload/i, "pr.merge": /merge/i };
/** What an Action's summary leaves out: a refusal it does not name, or an outside-reaching scope it does not name. */
export function hiddenIn(a: { summary?: string; scopesUsed: string[]; blocked: { scope: string; count: number }[] }): string[] {
  if (a.summary === undefined) return [];
  const out: string[] = [];
  if (a.blocked.length && !REFUSAL_WORDS.test(a.summary)) out.push("a refusal");
  for (const sc of a.scopesUsed) if (NAMES[sc] && !NAMES[sc].test(a.summary)) out.push(sc);
  return out;
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
  const splitMs = opts.splitMs ?? 10 * 60_000;
  const minPieces = opts.minPieces ?? 2;
  const minHidden = opts.minHidden ?? 2;
  const hideMs = opts.hideMs ?? 24 * 3_600_000;
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
    // split: a refused target that two or more later allowed Actions reach, when the agent had not been reaching it before the refusal. A bare program name is too common to mean anything.
    const specific = (t: string) => !t.startsWith("cmd:") || t.includes("/");
    const seenSplit = new Set<string>();
    for (let i = 0; i < acts.length; i++) {
      const t0 = Date.parse(acts[i].issuedAt);
      for (const b of acts[i].blocked) {
        for (const tok of (b.targets ?? []).filter(specific)) {
          const key = `${b.scope}>${tok}`;
          if (seenSplit.has(key)) continue;
          if (acts.some((a) => Date.parse(a.issuedAt) < t0 && (a.targets ?? []).includes(tok))) continue;
          const later = acts.slice(i + 1).filter((a) => Date.parse(a.issuedAt) - t0 <= splitMs && (a.targets ?? []).includes(tok));
          if (later.length >= minPieces) {
            seenSplit.add(key);
            out.push({ kind: "split", issuer, scope: b.scope, via: tok, attempts: later.length, firstAt: acts[i].issuedAt, lastAt: later.at(-1)!.issuedAt, contracts: [...new Set([acts[i].contract, ...later.map((a) => a.contract)])].sort() });
          }
        }
      }
    }
    // hide: the summaries of two Actions inside a day each leave out something the gateway saw.
    const hid = acts.map((a) => ({ a, items: hiddenIn(a) })).filter((x) => x.items.length);
    for (let i = 0, lo = 0; i < hid.length; i++) {
      while (Date.parse(hid[i].a.issuedAt) - Date.parse(hid[lo].a.issuedAt) > hideMs) lo++;
      if (i - lo + 1 >= minHidden) { const win = hid.slice(lo, i + 1); out.push({ kind: "hide", issuer, scope: [...new Set(win.flatMap((x) => x.items))].join(", "), attempts: win.length, firstAt: win[0].a.issuedAt, lastAt: hid[i].a.issuedAt, contracts: [...new Set(win.map((x) => x.a.contract))] }); break; }
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
  const splits = findings.filter((f) => f.kind === "split");
  const hides = findings.filter((f) => f.kind === "hide");
  if (retry >= 5) { step = atLeast(step, "tighten"); why.push(`${retry} refused attempts of one scope in a window`); }
  if (retry >= 8) { step = atLeast(step, "quarantine"); }
  if (reroutes.length) { step = atLeast(step, "tighten"); why.push(`went around a refusal (${reroutes.map((f) => `${f.scope} -> ${f.via}`).join(", ")})`); }
  if (splits.length) { step = atLeast(step, "tighten"); why.push(`reached a refused target in pieces (${splits.map((f) => `${f.scope} -> ${f.via}`).join(", ")})`); }
  if (hides.length) { step = atLeast(step, "tighten"); why.push(`its own summaries left out what the gateway saw (${hides.map((f) => f.scope).join("; ")})`); }
  if (retry >= 3 && (reroutes.length || splits.length || hides.length)) { step = atLeast(step, "quarantine"); why.push("retried, and rerouted or concealed"); }
  if (priorWindows >= 2) { step = atLeast(step, "review"); why.push(`${priorWindows} earlier windows with findings: persistence after warnings`); }
  else if (priorWindows === 1) { step = atLeast(step, "tighten"); why.push("a second window with findings"); }
  if (!why.length) why.push(`${retry} refused attempts of one scope in a window`);
  return { step, why: why.join("; ") };
}

/**
 * What the gateway does at the agent's next call under a ladder step (DK211): none and warn change nothing; tighten holds the calls that reach outside the project for a person's approval; quarantine and review refuse
 * everything but reading. A pure decision: the gateway asks it with the step the agent's findings call for and the scope of the call in hand.
 */
export function ladderAtCall(step: LadderStep, scope: string): { action: "allow" | "hold" | "refuse"; why: string } {
  const outside = scope === "shell.exec" || scope === "shell.network" || scope.startsWith("repo.push") || scope.startsWith("pr.") || scope.startsWith("mcp.") || scope.startsWith("tool.") || scope.startsWith("net.") || scope.startsWith("web.");
  if (step === "none" || step === "warn") return { action: "allow", why: step === "warn" ? "warned: the call is allowed" : "no finding" };
  if (step === "tighten") return outside ? { action: "hold", why: "tightened: a call that reaches outside the project is held for approval" } : { action: "allow", why: "tightened: a call inside the project is allowed" };
  return scope === "repo.read" ? { action: "allow", why: `${step}: reading is allowed` } : { action: "refuse", why: `${step}: nothing but reading is allowed until a person looks` };
}
