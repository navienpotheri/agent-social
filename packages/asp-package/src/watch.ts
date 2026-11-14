/**
 * The contagion watcher (docs/stage-3-plan.md M3): reads the public log's Action records and looks for a
 * technique spreading between independent agents, the way the DeepMind swarm exploit did.
 *
 * Two patterns, both computed only from what Actions already carry:
 *  - same-input: one tool-call input fingerprint (artifacts[].sha256, never the content) reported by several
 *    DIFFERENT agents inside a time window, where the Action also used a risky scope. Copies of one agent doing
 *    the same harmless thing (reading the same file) are ignored unless `all` is set.
 *  - same-probe: the same scope refused by the pre-call hook (blocked_attempts) for several different agents inside
 *    a time window: many agents independently trying the same thing the Mandate forbids.
 * A finding is a lead for a report, not a verdict.
 */

export interface WatchAction {
  id: string;
  issuer: string;
  contract: string;
  issuedAt: string;
  scopesUsed: string[];
  blocked: { scope: string; count: number; targets?: string[] }[];
  /** What the calls that ran were aimed at (host:, path:, cmd: tokens; DK92). */
  targets?: string[];
  artifacts: { uri: string; sha256: string }[];
}

export interface Cluster {
  kind: "same-input" | "same-probe" | "repeat-probe";
  /** The fingerprint (uri#sha256) or the blocked scope. */
  key: string;
  issuers: string[];
  contracts: string[];
  firstAt: string;
  lastAt: string;
  scopes: string[];
}

/** Scopes where a shared input is worth a look; reading and editing files, or running tests, are routine. */
const RISKY = (s: string) => ["shell.exec", "shell.network", "repo.push", "pr.merge", "pr.open"].includes(s) || s.startsWith("mcp.") || s.startsWith("tool.");

/** How many refusals of one scope to one agent inside the window make a finding about that agent alone (BM10). */
export const REPEAT_REFUSALS = 5;
const refusals = (a: WatchAction, scope: string) => a.blocked.filter((b) => b.scope === scope).reduce((n, b) => n + b.count, 0);

export function findContagion(actions: WatchAction[], opts: { minAgents?: number; windowMs?: number; all?: boolean; minRepeats?: number } = {}): Cluster[] {
  const minAgents = opts.minAgents ?? 3;
  const windowMs = opts.windowMs ?? 10 * 60_000;
  const minRepeats = opts.minRepeats ?? REPEAT_REFUSALS;
  const groups = new Map<string, { kind: Cluster["kind"]; key: string; items: { a: WatchAction; scopes: string[] }[] }>();
  const add = (kind: Cluster["kind"], key: string, a: WatchAction, scopes: string[]) => {
    const id = `${kind}|${key}`;
    if (!groups.has(id)) groups.set(id, { kind, key, items: [] });
    groups.get(id)!.items.push({ a, scopes });
  };
  for (const a of actions) {
    const risky = a.scopesUsed.some(RISKY);
    if (risky || opts.all) for (const f of a.artifacts) add("same-input", `${f.uri}#${f.sha256}`, a, a.scopesUsed);
    for (const b of a.blocked) add("same-probe", b.scope, a, [b.scope]);
  }
  const out: Cluster[] = [];
  for (const g of groups.values()) {
    const items = g.items.sort((x, y) => Date.parse(x.a.issuedAt) - Date.parse(y.a.issuedAt));
    // Best window: the one holding the most distinct issuers.
    let best: typeof items = [];
    let bestIssuers = 0;
    for (let lo = 0, hi = 0; hi < items.length; hi++) {
      while (Date.parse(items[hi].a.issuedAt) - Date.parse(items[lo].a.issuedAt) > windowMs) lo++;
      const slice = items.slice(lo, hi + 1);
      const n = new Set(slice.map((i) => i.a.issuer)).size;
      if (n > bestIssuers) { bestIssuers = n; best = slice; }
    }
    if (bestIssuers < minAgents) {
      // One agent is a cohort of one (BM10): the same scope refused to it again and again inside the window is an exploiter that keeps trying, and the watcher said nothing about it at the default of three agents.
      if (g.kind === "same-probe") {
        for (const who of new Set(items.map((i) => i.a.issuer))) {
          const mine = items.filter((i) => i.a.issuer === who);
          let hit: typeof mine = [];
          for (let lo = 0, hi = 0, n = 0; hi < mine.length; hi++) {
            n += refusals(mine[hi].a, g.key);
            while (Date.parse(mine[hi].a.issuedAt) - Date.parse(mine[lo].a.issuedAt) > windowMs) { n -= refusals(mine[lo].a, g.key); lo++; }
            if (n >= minRepeats && mine.slice(lo, hi + 1).length >= hit.length) hit = mine.slice(lo, hi + 1);
          }
          if (hit.length) out.push({ kind: "repeat-probe", key: g.key, issuers: [who], contracts: [...new Set(hit.map((i) => i.a.contract))].sort(), firstAt: hit[0].a.issuedAt, lastAt: hit.at(-1)!.a.issuedAt, scopes: [g.key] });
        }
      }
      continue;
    }
    out.push({
      kind: g.kind, key: g.key,
      issuers: [...new Set(best.map((i) => i.a.issuer))].sort(),
      contracts: [...new Set(best.map((i) => i.a.contract))].sort(),
      firstAt: best[0].a.issuedAt, lastAt: best.at(-1)!.a.issuedAt,
      scopes: [...new Set(best.flatMap((i) => i.scopes))].sort(),
    });
  }
  return out.sort((x, y) => y.issuers.length - x.issuers.length || x.key.localeCompare(y.key));
}
