/**
 * The credit ledger watch: where every credit is, by entity, at a moment, and whether the total still adds up. It reads only what the CLI already prints (`asp credits balance`, `asp market show`,
 * `asp market juror show`), so the same code watches a local log, the hosted service, or a test. Credits are accounting entries, not money; the token estimate is a metering figure and pays no provider.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface Entity { name: string; did: string }
export type Runner = (args: string[]) => Promise<{ code: number; out: string; err: string }>;

export interface Snapshot {
  at: string;
  label: string;
  /** Free balance of each entity. */
  balances: Record<string, number>;
  /** Credits a juror has staked (locked, not free). */
  stakes: Record<string, number>;
  /** Locked in the escrow and bond of jobs that are not settled yet. */
  escrow: number;
  bond: number;
  /** Everything counted: free balances + stakes + escrow + bond. */
  total: number;
  /** granted - total: what the protocol itself holds (the court-fee reserve of an open job); 0 once every job is settled. null when the grand total is not known. */
  held: number | null;
}

const NUM = /(-?\d+)\s+credits?/;

export async function snapshot(run: Runner, o: { entities: Entity[]; jurors?: Entity[]; contracts?: string[]; granted?: number; label?: string }): Promise<Snapshot> {
  const balances: Record<string, number> = {};
  for (const e of [...o.entities, ...(o.jurors ?? [])]) {
    const r = await run(["credits", "balance", e.did]);
    const n = Number(NUM.exec(r.out)?.[1]);
    balances[e.name] = Number.isFinite(n) ? n : NaN;
  }
  const stakes: Record<string, number> = {};
  for (const j of o.jurors ?? []) {
    const r = await run(["market", "juror", "show", j.did]);
    stakes[j.name] = Number(/staked (\d+) credits?/.exec(r.out)?.[1] ?? 0);
  }
  let escrow = 0, bond = 0;
  for (const c of o.contracts ?? []) {
    const r = await run(["market", "show", c]);
    const m = /escrow: (\d+) locked from \S+, (\d+) bond from \S+, settled: (true|false)/.exec(r.out);
    if (m && m[3] === "false") { escrow += Number(m[1]); bond += Number(m[2]); }
  }
  const free = Object.values(balances).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  const total = free + Object.values(stakes).reduce((a, b) => a + b, 0) + escrow + bond;
  return { at: new Date().toISOString(), label: o.label ?? "", balances, stakes, escrow, bond, total, held: o.granted === undefined ? null : o.granted - total };
}

/** What each entity gained or lost between two snapshots (free balance plus stake). */
export function deltas(a: Snapshot, b: Snapshot): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of new Set([...Object.keys(a.balances), ...Object.keys(b.balances)])) out[k] = (b.balances[k] ?? 0) + (b.stakes[k] ?? 0) - ((a.balances[k] ?? 0) + (a.stakes[k] ?? 0));
  return out;
}

/** Does it add up? Nothing is created or lost: the only credits not in a balance, a stake or a lock are the protocol's court-fee reserve of an open job. */
export function conservation(s: Snapshot, openJobs = 0): { ok: boolean; note: string } {
  if (s.held === null) return { ok: true, note: "grand total not given, so not checked" };
  if (s.held < 0) return { ok: false, note: `${-s.held} credit(s) more than were granted: credits were created` };
  if (openJobs === 0 && s.held !== 0) return { ok: false, note: `${s.held} credit(s) are unaccounted for with every job settled` };
  return { ok: true, note: s.held === 0 ? "every credit is accounted for" : `${s.held} held by the protocol (court-fee reserve of an open job)` };
}

/** A plain table: one row per snapshot, one column per entity, with locked credits, the protocol's hold and the total. */
export function formatTable(snaps: Snapshot[], names: string[]): string {
  const head = ["step", ...names, "escrow", "bond", "held", "total"];
  const rows = snaps.map((s) => [s.label, ...names.map((n) => `${s.balances[n] ?? 0}${s.stakes[n] ? `+${s.stakes[n]}s` : ""}`), String(s.escrow), String(s.bond), s.held === null ? "?" : String(s.held), String(s.total)]);
  const width = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (r: string[]) => r.map((c, i) => c.padEnd(width[i])).join("  ").trimEnd();
  return [line(head), line(width.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
}

/**
 * Tokens the sessions of an ASP home used since a time, from its session index, and the estimate in credits at a rate per thousand tokens. This is a **metering figure only**: credits do not pay
 * a model provider (docs/provider-terms.md, rule 5), so it says what a run cost, not what was charged.
 */
export function meteredUse(home: string, since: string, creditsPerThousandTokens = 1): { sessions: number; tokens: number; estimate: number } {
  const file = join(home, "runs.ndjson");
  if (!existsSync(file)) return { sessions: 0, tokens: 0, estimate: 0 };
  let sessions = 0, tokens = 0;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as { t: string; at: string; tokens?: number };
      if (r.t === "end" && r.at >= since) { sessions++; tokens += r.tokens ?? 0; }
    } catch { /* a half-written line */ }
  }
  return { sessions, tokens, estimate: Math.round((tokens / 1000) * creditsPerThousandTokens * 100) / 100 };
}
