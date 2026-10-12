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
  blocked: { scope: string; count: number }[];
  artifacts: { uri: string; sha256: string }[];
}

export interface Cluster {
  kind: "same-input" | "same-probe";
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

export function findContagion(actions: WatchAction[], opts: { minAgents?: number; windowMs?: number; all?: boolean } = {}): Cluster[] {
  const minAgents = opts.minAgents ?? 3;
  const windowMs = opts.windowMs ?? 10 * 60_000;
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
    if (bestIssuers < minAgents) continue;
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
