/**
 * What the live dashboard asks the service for (register row DK1601, the dynamic version): a summary of a fleet over a time range with filters, aggregated on the server so the answer stays small at 10,000 members (the totals,
 * a bucketed series, the mix, and the busiest 50 members, never every member), and the records a fleet's members wrote after a log sequence number (the live ticker). A pure function of the log's records and the fleet's controls,
 * so the same log gives the same answer. Credits are accounting entries, not money.
 */
import { fleetDirectory, findFleet } from "./fleets.ts";
import type { FleetControlState } from "./fleet-dashboard.ts";
import { emptyControls } from "./fleet-dashboard.ts";
import type { StoredRec } from "./society-story.ts";

const T = (s: string) => `asp.${s}/v0.2`;
export type LiveRange = "1h" | "24h" | "7d" | "30d";
export const LIVE_RANGES: Record<LiveRange, { buckets: number; ms: number; label: string }> = {
  "1h": { buckets: 12, ms: 5 * 60_000, label: "5 minutes" }, "24h": { buckets: 24, ms: 3_600_000, label: "hour" }, "7d": { buckets: 14, ms: 43_200_000, label: "12 hours" }, "30d": { buckets: 30, ms: 86_400_000, label: "day" },
};
export interface LiveFilter { persona?: string; node?: string; tier?: number }
export interface LiveMember { did: string; name: string; persona: string | null; node: string; tier: number | null; credits: number; tokens: number; frozen: boolean; journey: string }
export interface FleetLive {
  ok: true; fleet: { id: string; name: string }; range: LiveRange; bucket: string; now: string; head: number;
  filter: LiveFilter; options: { persona: string[]; node: string[]; tier: string[] };
  tiles: { members: number; credits: number; tokens: number; slashes: number; drift: number; frozen: number; records: number };
  series: { labels: string[]; credits: number[]; tokens: number[]; slashes: number[]; drift: number[]; records: number[]; members: number[] };
  mix: { persona: Record<string, number>; tier: Record<string, number>; node: Record<string, number> };
  top: LiveMember[]; shown: number;
}

const stamp = (ms: number, range: LiveRange): string => { const d = new Date(ms).toISOString(); return range === "30d" ? d.slice(0, 10) : range === "7d" ? `${d.slice(5, 10)} ${d.slice(11, 13)}h` : d.slice(11, 16); };

export function fleetLive(stored: StoredRec[], fleet: string, o: { range?: LiveRange; now: string; filter?: LiveFilter; controls?: FleetControlState; top?: number }): FleetLive | undefined {
  const dir = fleetDirectory(stored);
  const f = findFleet(dir, fleet);
  if (!f) return undefined;
  const range: LiveRange = o.range && LIVE_RANGES[o.range] ? o.range : "24h";
  const { buckets, ms } = LIVE_RANGES[range];
  const controls = o.controls ?? emptyControls();
  const now = Date.parse(o.now);
  const endBucket = Math.floor(now / ms) * ms + ms;              // the end of the bucket that holds `now`
  const startMs = endBucket - buckets * ms;
  const filter = o.filter ?? {};
  // the tier of each member, and the tree's parents (for a frozen node)
  const tier = new Map<string, number>();
  const parent = new Map<string, string | null>();
  const mem = new Set(f.members.map((m) => m.did));
  for (const s of stored) {
    const r = s.record, b = r.body as Record<string, any>;
    if (r.type === T("passport") && mem.has(b.did) && b.tier !== undefined && !tier.has(b.did)) tier.set(b.did, Number(b.tier));
    else if (r.type === T("tier_promotion") && r.subject && mem.has(r.subject) && b.to !== undefined) tier.set(r.subject, Number(b.to));
    else if (r.type === T("fleet_node") && b.fleet === f.id) parent.set(b.node, typeof b.parent === "string" ? b.parent : null);
  }
  const frozenNodes = new Set(controls.frozenNodes ?? []), frozenMembers = new Set(controls.frozenMembers);
  const nodeFrozen = (n: string): boolean => { for (let at: string | null = n, i = 0; at && i < 16; at = parent.get(at) ?? null, i++) if (frozenNodes.has(at)) return true; return false; };
  const options = { persona: new Set<string>(), node: new Set<string>(), tier: new Set<string>() };
  const kept = new Map<string, { name: string; persona: string | null; node: string; tier: number | null; joined: string }>();
  for (const m of f.members) {
    const node = m.node ?? "root", t = tier.get(m.did) ?? null;
    options.persona.add(m.persona ?? "none"); options.node.add(node); options.tier.add(String(t ?? "unknown"));
    if (filter.persona !== undefined && (m.persona ?? "none") !== filter.persona) continue;
    if (filter.node !== undefined && node !== filter.node) continue;
    if (filter.tier !== undefined && t !== filter.tier) continue;
    kept.set(m.did, { name: m.name, persona: m.persona, node, tier: t, joined: m.joined });
  }
  const z = () => new Array<number>(buckets).fill(0);
  const credits = z(), tokens = z(), slashes = z(), drift = z(), records = z();
  const at = (iso: string): number => { const t = Date.parse(iso); return t >= startMs && t < endBucket ? Math.floor((t - startMs) / ms) : -1; };
  const per = new Map<string, { credits: number; tokens: number }>();
  const contracts = new Map<string, string>();
  let head = 0;
  for (const s of stored) {
    if (s.seq > head) head = s.seq;
    const r = s.record, b = r.body as Record<string, any>;
    if (r.type === T("contract")) { contracts.set(s.id, b.performer); continue; }
    const who = r.type === T("clinic_diagnosis") ? b.agent : r.type === T("settlement") ? contracts.get(b.contract) : r.issuer;
    if (!who || !kept.has(who)) continue;
    const i = at(r.issued_at);
    if (i < 0) continue;
    if (r.type === T("purchase")) { const v = Number(b.amount?.value ?? 0); credits[i]! += v; const p = per.get(who) ?? { credits: 0, tokens: 0 }; p.credits += v; per.set(who, p); records[i]!++; }
    else if (r.type === T("action")) { const v = Number(b.metrics?.tokens_in ?? 0) + Number(b.metrics?.tokens_out ?? 0); tokens[i]! += v; const p = per.get(who) ?? { credits: 0, tokens: 0 }; p.tokens += v; per.set(who, p); records[i]!++; }
    else if (r.type === T("clinic_diagnosis")) drift[i]!++;
    else if (r.type === T("settlement")) { if ((b.bond_slashed?.value ?? 0) > 0) slashes[i]!++; }
    else records[i]!++;
  }
  const labels = Array.from({ length: buckets }, (_, i) => stamp(startMs + i * ms, range));
  const members = labels.map((_, i) => { const end = startMs + (i + 1) * ms; let n = 0; for (const m of kept.values()) if (Date.parse(m.joined) < end) n++; return n; });
  const mix = { persona: {} as Record<string, number>, tier: {} as Record<string, number>, node: {} as Record<string, number> };
  let frozen = 0;
  const rows: LiveMember[] = [];
  for (const [did, m] of kept) {
    const fz = controls.frozen || frozenMembers.has(did) || nodeFrozen(m.node);
    if (fz) frozen++;
    mix.persona[m.persona ?? "none"] = (mix.persona[m.persona ?? "none"] ?? 0) + 1;
    mix.tier[String(m.tier ?? "unknown")] = (mix.tier[String(m.tier ?? "unknown")] ?? 0) + 1;
    mix.node[m.node] = (mix.node[m.node] ?? 0) + 1;
    const p = per.get(did);
    rows.push({ did, name: m.name, persona: m.persona, node: m.node, tier: m.tier, credits: p?.credits ?? 0, tokens: p?.tokens ?? 0, frozen: fz, journey: `/agent/${encodeURIComponent(did)}/journey` });
  }
  rows.sort((a, b) => b.credits + b.tokens / 100 - (a.credits + a.tokens / 100) || (a.name < b.name ? -1 : 1));
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const sorted = (s: Set<string>) => [...s].sort();
  return {
    ok: true, fleet: { id: f.id, name: f.name }, range, bucket: LIVE_RANGES[range].label, now: o.now, head, filter,
    options: { persona: sorted(options.persona), node: sorted(options.node), tier: sorted(options.tier) },
    tiles: { members: kept.size, credits: sum(credits), tokens: sum(tokens), slashes: sum(slashes), drift: sum(drift), frozen, records: sum(records) },
    series: { labels, credits, tokens, slashes, drift, records, members }, mix, top: rows.slice(0, o.top ?? 50), shown: Math.min(rows.length, o.top ?? 50),
  };
}

export interface LiveEvent { seq: number; at: string; kind: string; who: string; name: string; text: string; journey: string }
/** The records of a fleet's members after a log sequence number, as lines for the ticker, oldest first, at most `limit` (the newest when more). */
export function fleetEvents(stored: StoredRec[], fleet: string, since: number, limit = 40): { head: number; events: LiveEvent[] } | undefined {
  const dir = fleetDirectory(stored);
  const f = findFleet(dir, fleet);
  if (!f) return undefined;
  const names = new Map(f.members.map((m) => [m.did, m.name]));
  const contracts = new Map<string, string>();
  const out: LiveEvent[] = [];
  let head = 0;
  for (const s of stored) {
    if (s.seq > head) head = s.seq;
    const r = s.record, b = r.body as Record<string, any>;
    if (r.type === T("contract")) { contracts.set(s.id, b.performer); continue; }
    if (s.seq <= since) continue;
    const who = r.type === T("clinic_diagnosis") ? b.agent : r.type === T("settlement") ? contracts.get(b.contract) : r.issuer;
    if (!who || !names.has(who)) continue;
    const name = names.get(who)!;
    let kind = "record", text = `${name} wrote a ${r.type.replace(/^asp\./, "").replace(/\/v0\.2$/, "").replace(/_/g, " ")} record`;
    if (r.type === T("purchase")) { kind = "spend"; text = `${name} bought ${String(b.service ?? "a service")} for ${Number(b.amount?.value ?? 0)} credits`; }
    else if (r.type === T("action")) { kind = "run"; text = `${name} reported a run of ${Number(b.metrics?.tokens_in ?? 0) + Number(b.metrics?.tokens_out ?? 0)} tokens`; }
    else if (r.type === T("settlement")) { const slashed = (b.bond_slashed?.value ?? 0) > 0; kind = slashed ? "slash" : "job"; text = slashed ? `${name} was slashed ${b.bond_slashed.value} credits` : `${name}'s job settled (${String(b.basis)})`; }
    else if (r.type === T("clinic_diagnosis")) { kind = "drift"; text = `${name}: the Clinic found drift (${String(b.severity)})`; }
    else if (r.type === T("passport")) { kind = "join"; text = `${name} joined or updated its passport`; }
    else if (r.type === T("fleet_move")) { kind = "move"; text = `${name} moved to ${String(b.to)}`; }
    out.push({ seq: s.seq, at: r.issued_at, kind, who, name, text, journey: `/agent/${encodeURIComponent(who)}/journey` });
  }
  return { head, events: out.slice(-limit) };
}
