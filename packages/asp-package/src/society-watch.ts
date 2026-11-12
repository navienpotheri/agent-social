/**
 * The society watcher (register row DK52; docs/spec-deltas.md S179): the contagion watcher (watch.ts) and the circumvention detector (circumvention.ts), run continuously inside the log service over every
 * agent's Actions, not by hand on one machine. Each pass (`asp serve --watch-interval <seconds>`, default 60) reads the Actions appended since the last pass, keeps a rolling window of them, and looks for
 *  - a technique spreading between three or more independent agents (same-input, same-probe), and
 *  - one agent retrying or going around a refusal.
 * A new finding is signed with the watcher's own key (a key made in the service folder, never the operator's), kept in `<dir>/findings.json`, published at `GET /watch/findings` (public: anyone can verify it with the
 * key shown there) and told to the operator once. A finding is a lead for a person, not a verdict: nothing here slashes, freezes or demotes (the Clinic's cohort freeze is `asp clinic cohort-freeze`, and it needs an upheld report).
 * Stated time: a pattern is found at the first pass after its last Action is in the log, so at most one interval (plus the pass itself) later.
 * Limit, written down in DK52: the window is rebuilt from the whole log on start, which is fine at beta size and not at the size of a society.
 */
import { b64urlDecode, b64urlEncode, canonicalBytes, publicKeyFromSeed, randomSeed, sha256Id, signBytes, verifyBytes, type AspRecord } from "@agent-social/asp-core";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { findCircumvention, ladderStep, type CircumventionFinding, type LadderStep } from "./circumvention.ts";
import { findContagion, type Cluster, type WatchAction } from "./watch.ts";

export const WATCHER_KID = "did:web:asp.local:watcher#key-1";

export interface WatchFinding {
  kind: "contagion" | "circumvention";
  /** The pattern: a cluster (contagion) or the finding (circumvention). */
  detail: Cluster | CircumventionFinding;
  /** circumvention only: the step the evidence calls for (warn, tighten, quarantine, review) and why. */
  step?: LadderStep;
  why?: string;
  /** When this pass noticed it, the time of the newest Action in the pattern, and the log sequence read up to. */
  detectedAt: string;
  latestActionAt: string;
  head: number;
}
export interface SignedFinding { id: string; finding: WatchFinding; kid: string; sig: string }

export interface LogReader { since(after: number, limit: number): Promise<{ seq: number; id: string; record: AspRecord }[]> }

export interface SocietyWatchOptions {
  log: LogReader;
  /** The service folder's own directory for the watcher: findings.json and watcher.key. */
  dir: string;
  now?: () => Date;
  /** Contagion: distinct agents and the window. Defaults 3 and 10 minutes (the same as `asp watch`). */
  minAgents?: number;
  windowMs?: number;
  /** How long an Action stays in the window. Default one hour. */
  lookbackMs?: number;
  /** Told once per new finding. A failure is logged, not fatal. */
  alert?: (f: SignedFinding) => Promise<void> | void;
  say?: (line: string) => void;
}

const signedBytes = (f: WatchFinding) => canonicalBytes({ finding: f });

/** The Action as the watcher reads it. */
export function toWatchAction(id: string, r: AspRecord): WatchAction | undefined {
  if (r.type !== "asp.action/v0.2") return undefined;
  const b = r.body as { contract: string; scopes_used: string[]; blocked_attempts?: { scope: string; count: number }[]; artifacts?: { uri: string; sha256: string }[] };
  return { id, issuer: r.issuer, contract: b.contract, issuedAt: r.issued_at, scopesUsed: b.scopes_used, blocked: b.blocked_attempts ?? [], artifacts: b.artifacts ?? [] };
}

function writeJson(file: string, data: unknown): void {
  writeFileSync(file + ".part", JSON.stringify(data, null, 2) + "\n");
  renameSync(file + ".part", file);
}

export class SocietyWatcher {
  private cursor = 0;
  private window: WatchAction[] = [];
  private findings: SignedFinding[];
  private seen = new Set<string>();
  private readonly seed: Uint8Array;
  private readonly file: string;
  lastPassAt: string | undefined;
  passes = 0;
  private busy = false;

  private readonly o: SocietyWatchOptions;

  constructor(o: SocietyWatchOptions) {
    this.o = o;
    mkdirSync(o.dir, { recursive: true });
    this.file = join(o.dir, "findings.json");
    const keyFile = join(o.dir, "watcher.key");
    if (existsSync(keyFile)) this.seed = b64urlDecode(readFileSync(keyFile, "utf8").trim());
    else { this.seed = randomSeed(); writeFileSync(keyFile, b64urlEncode(this.seed) + "\n", { mode: 0o600 }); }
    this.findings = existsSync(this.file) ? (JSON.parse(readFileSync(this.file, "utf8")) as { findings: SignedFinding[] }).findings : [];
    for (const f of this.findings) this.seen.add(keyOf(f.finding));
  }

  get publicKey(): string { return b64urlEncode(publicKeyFromSeed(this.seed)); }
  list(): SignedFinding[] { return [...this.findings]; }

  /** One pass: read what is new, look at the window, sign and tell what has not been found before. Returns the new findings. */
  async tick(): Promise<SignedFinding[]> {
    if (this.busy) return [];
    this.busy = true;
    try {
      const now = (this.o.now?.() ?? new Date()).getTime();
      let fresh = 0;
      for (;;) {
        const page = await this.o.log.since(this.cursor, 500);
        if (!page.length) break;
        for (const s of page) {
          this.cursor = s.seq;
          const a = toWatchAction(s.id, s.record);
          if (a) { this.window.push(a); fresh++; }
        }
        if (page.length < 500) break;
      }
      const lookback = this.o.lookbackMs ?? 3_600_000;
      this.window = this.window.filter((a) => now - Date.parse(a.issuedAt) <= lookback);
      this.lastPassAt = new Date(now).toISOString();
      this.passes++;
      if (!fresh) return [];
      const out: SignedFinding[] = [];
      const detectedAt = new Date(now).toISOString().replace(/\.\d{3}Z$/, "Z");
      const add = (f: Omit<WatchFinding, "detectedAt" | "head">) => {
        const key = keyOf(f);
        if (this.seen.has(key)) return;
        this.seen.add(key);
        const finding: WatchFinding = { ...f, detectedAt, head: this.cursor };
        const bytes = signedBytes(finding);
        out.push({ id: sha256Id(bytes), finding, kid: WATCHER_KID, sig: b64urlEncode(signBytes(bytes, this.seed)) });
      };
      for (const c of findContagion(this.window, { minAgents: this.o.minAgents ?? 3, windowMs: this.o.windowMs ?? 10 * 60_000 })) add({ kind: "contagion", detail: c, latestActionAt: c.lastAt });
      const circ = findCircumvention(this.window);
      for (const c of circ) {
        const step = ladderStep(circ.filter((x) => x.issuer === c.issuer));
        add({ kind: "circumvention", detail: c, step: step.step, why: step.why, latestActionAt: c.lastAt });
      }
      if (out.length) {
        this.findings.push(...out);
        writeJson(this.file, { findings: this.findings });
        for (const f of out) {
          this.o.say?.(`watch: ${f.finding.kind} finding ${f.id.slice(0, 19)} (${describe(f.finding)})`);
          try { await this.o.alert?.(f); } catch (e) { this.o.say?.(`watch: could not alert the operator: ${(e as Error).message}`); }
        }
      }
      return out;
    } finally { this.busy = false; }
  }

  /** Runs `tick` now and then every `everyMs`. Returns a function that stops it. */
  start(everyMs: number): () => void {
    const run = () => this.tick().catch((e) => this.o.say?.(`watch: a pass failed: ${(e as Error).message}`));
    void run();
    const t = setInterval(run, everyMs);
    t.unref?.();
    return () => clearInterval(t);
  }
}

function keyOf(f: Pick<WatchFinding, "kind" | "detail">): string {
  if (f.kind === "contagion") { const c = f.detail as Cluster; return `contagion|${c.kind}|${c.key}|${c.issuers.join(",")}`; }
  const c = f.detail as CircumventionFinding;
  return `circumvention|${c.kind}|${c.issuer}|${c.scope}|${c.via ?? ""}|${c.lastAt}`;
}

export function describe(f: WatchFinding): string {
  if (f.kind === "contagion") { const c = f.detail as Cluster; return `${c.kind}: ${c.issuers.length} agents, ${c.key}`; }
  const c = f.detail as CircumventionFinding;
  return `${c.kind}: ${c.issuer} on ${c.scope}${c.via ? ` via ${c.via}` : ""}, step ${f.step}`;
}

/** Whether a finding's signature verifies under `publicKey` (b64url): how anyone checks one read from the public page. */
export function verifyFinding(f: SignedFinding, publicKey: string): boolean {
  try {
    const bytes = signedBytes(f.finding);
    return f.id === sha256Id(bytes) && verifyBytes(b64urlDecode(f.sig), bytes, b64urlDecode(publicKey));
  } catch { return false; }
}

/** Public, read-only: GET /watch/findings (newest first, the key to verify with) and GET /watch/status. */
export function watchPublicRoutes(w: SocietyWatcher, opts: { intervalMs: number }) {
  const send = (res: ServerResponse, body: unknown) => { const t = JSON.stringify(body); res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(t) }); res.end(t); };
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    if (req.method !== "GET") return false;
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (path === "/watch/findings") { send(res, { ok: true, kid: WATCHER_KID, publicKey: w.publicKey, findings: w.list().reverse().slice(0, 200) }); return true; }
    if (path === "/watch/status") { send(res, { ok: true, running: true, intervalSeconds: opts.intervalMs / 1000, passes: w.passes, lastPassAt: w.lastPassAt ?? null, findings: w.list().length }); return true; }
    return false;
  };
}
