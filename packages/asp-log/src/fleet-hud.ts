/**
 * The operations view of a fleet (register row DK1601, the HUD): what the dense live view and its replay draw, computed from the log's real records and nothing else. For a window of time it returns the groups (the fleet's personas
 * and tree nodes, the "cards"), the nodes of the graph (members, a sample when the fleet is large, plus the few outside parties and institutions they dealt with), the events in order (a record between two nodes with its kind, its
 * value, the group of the member and its flags: a slash, a drift diagnosis, a refusal, work between related parties) with their words, and exact totals for the window, so the picture can be replayed as a run and the totals still hold
 * when the events are sampled. Credits are accounting entries, not money.
 */
import { fleetDirectory, findFleet } from "./fleets.ts";
import type { FleetControlState } from "./fleet-dashboard.ts";
import { emptyControls } from "./fleet-dashboard.ts";
import type { StoredRec } from "./society-story.ts";

const T = (s: string) => `asp.${s}/v0.2`;
export const KIND = { spend: 1, run: 2, job: 3, pay: 4, slash: 5, drift: 6, refusal: 7, join: 8 } as const;
export const FLAG = { slash: 1, drift: 2, refusal: 4, related: 8 } as const;
export interface HudGroup { id: string; kind: "persona" | "node"; name: string; members: number; credits: number; tokens: number; budget: number | null; jobs: { done: number; total: number }; slashes: number; drift: number; refusals: number; related: number; over: boolean; flagged: boolean; spark: number[] }
export interface HudNode { id: number; label: string; group: number; kind: "member" | "outside" | "institution" }
export interface HudEvent { t: number; seq: number; a: number; b: number; k: number; v: number; g: number; f: number; x: string }
export interface FleetHud {
  ok: true; fleet: { id: string; name: string }; from: number; to: number; now: string; head: number;
  groups: HudGroup[]; nodes: HudNode[]; events: HudEvent[]; sampled: boolean; spark: number[];
  totals: { events: number; credits: number; tokens: number; jobsDone: number; jobsTotal: number; slashes: number; drift: number; refusals: number; related: number; flagged: number; latencyMinutes: number | null; members: number; frozen: boolean; cap: { credits: number | null; tokens: number | null } };
  rail: { purpose: string; template: string | null; capCredits: number | null; capTokens: number | null; frozenMembers: number; frozenNodes: string[]; maxMembers: number | null; org: string };
}

const SPARK = 24;
export function fleetHud(stored: StoredRec[], fleet: string, o: { from?: number; to?: number; now: string; controls?: FleetControlState; maxEvents?: number; maxMembers?: number }): FleetHud | undefined {
  const dir = fleetDirectory(stored);
  const f = findFleet(dir, fleet);
  if (!f) return undefined;
  const controls = o.controls ?? emptyControls();
  const to = o.to ?? Date.parse(o.now), from = o.from ?? to - 24 * 3_600_000;
  const maxEvents = o.maxEvents ?? 1200, maxMembers = o.maxMembers ?? 240;
  const byDid = new Map(f.members.map((m) => [m.did, m]));
  const gIndex = new Map<string, number>();
  const groups: HudGroup[] = [];
  const group = (kind: "persona" | "node", name: string): number => {
    const id = `${kind}:${name}`;
    if (!gIndex.has(id)) { gIndex.set(id, groups.length); groups.push({ id, kind, name, members: 0, credits: 0, tokens: 0, budget: null, jobs: { done: 0, total: 0 }, slashes: 0, drift: 0, refusals: 0, related: 0, over: false, flagged: false, spark: new Array(SPARK).fill(0) }); }
    return gIndex.get(id)!;
  };
  const gOf = new Map<string, number>();
  for (const m of f.members) { const g = group(m.persona ? "persona" : "node", m.persona ?? m.node ?? "root"); gOf.set(m.did, g); groups[g]!.members++; }
  const budgets = new Map<string, number>();
  for (const s of stored) if (s.record.type === T("fleet_node") && (s.record.body as { fleet?: string }).fleet === f.id) { const b = s.record.body as { node: string; budget?: { credits?: number } }; if (b.budget?.credits !== undefined) budgets.set(b.node, b.budget.credits); }
  for (const g of groups) if (g.kind === "node" && budgets.has(g.name)) g.budget = budgets.get(g.name)!;
  const span = Math.max(1, to - from), bucket = (t: number) => Math.min(SPARK - 1, Math.max(0, Math.floor(((t - from) / span) * SPARK)));
  // nodes: members (a sample when large), outside parties and institutions as they appear
  const nodeIdx = new Map<string, number>();
  const nodes: HudNode[] = [];
  const node = (key: string, label: string, group: number, kind: HudNode["kind"]): number => { if (!nodeIdx.has(key)) { nodeIdx.set(key, nodes.length); nodes.push({ id: nodes.length, label, group, kind }); } return nodeIdx.get(key)!; };
  const events: (HudEvent & { ka: string; kb: string })[] = [];
  const contracts = new Map<string, { principal: string; performer: string; at: number }>();
  const lat: number[] = [];
  const t = { events: 0, credits: 0, tokens: 0, jobsDone: 0, jobsTotal: 0, slashes: 0, drift: 0, refusals: 0, related: 0 };
  const spark = new Array(SPARK).fill(0);
  let head = 0;
  const label = (did: string): string => byDid.get(did)?.name ?? did.split(":").pop()!.slice(0, 14);
  const add = (at: number, seq: number, a: string, b: string, k: number, v: number, member: string | undefined, flags: number, x: string) => {
    const g = member !== undefined && gOf.has(member) ? gOf.get(member)! : -1;
    t.events++; if (at >= from && at <= to) spark[bucket(at)]++;
    if (g >= 0 && at >= from && at <= to) groups[g]!.spark[bucket(at)]++;
    events.push({ t: at, seq, a: 0, b: 0, ka: a, kb: b, k, v, g, f: flags, x });
  };
  for (const s of stored) {
    if (s.seq > head) head = s.seq;
    const r = s.record, b = r.body as Record<string, any>, at = Date.parse(r.issued_at);
    if (r.type === T("contract")) { contracts.set(s.id, { principal: b.principal, performer: b.performer, at }); continue; }
    const inWin = at >= from && at <= to;
    if (r.type === T("purchase") && byDid.has(r.issuer) && inWin) { const v = Number(b.amount?.value ?? 0), g = gOf.get(r.issuer)!; t.credits += v; groups[g]!.credits += v; add(at, s.seq, r.issuer, String(b.institution ?? "did:web:asp.local:market"), KIND.spend, v, r.issuer, 0, `${label(r.issuer)} bought ${String(b.service ?? "a service")} for ${v} credits`); }
    else if (r.type === T("action") && byDid.has(r.issuer) && inWin) { const v = Number(b.metrics?.tokens_in ?? 0) + Number(b.metrics?.tokens_out ?? 0), g = gOf.get(r.issuer)!; t.tokens += v; groups[g]!.tokens += v; add(at, s.seq, r.issuer, "did:web:asp.local:gateway", KIND.run, v, r.issuer, 0, `${label(r.issuer)} reported a run of ${v} tokens`); }
    else if (r.type === T("refusal") && byDid.has(r.issuer) && inWin) { t.refusals++; groups[gOf.get(r.issuer)!]!.refusals++; add(at, s.seq, r.issuer, "did:web:asp.local:gateway", KIND.refusal, 1, r.issuer, FLAG.refusal, `a call by ${label(r.issuer)} was refused`); }
    else if (r.type === T("clinic_diagnosis") && byDid.has(b.agent) && inWin) { t.drift++; groups[gOf.get(b.agent)!]!.drift++; add(at, s.seq, "did:web:asp.local:clinic", b.agent, KIND.drift, 1, b.agent, FLAG.drift, `${label(b.agent)}: the Clinic found drift (${String(b.severity)})`); }
    else if (r.type === T("settlement")) {
      const c = contracts.get(b.contract);
      if (!c || (!byDid.has(c.performer) && !byDid.has(c.principal))) continue;
      const mem = byDid.has(c.performer) ? c.performer : c.principal;
      const related = byDid.has(c.performer) && byDid.has(c.principal);
      if (byDid.has(c.performer) && inWin) { groups[gOf.get(c.performer)!]!.jobs.total++; t.jobsTotal++; lat.push((at - c.at) / 60_000); }
      if (!inWin) continue;
      if (related) { t.related++; groups[gOf.get(c.performer)!]!.related++; }
      const slashed = (b.bond_slashed?.value ?? 0) > 0, accepted = b.basis === "accepted";
      if (byDid.has(c.performer) && accepted) { groups[gOf.get(c.performer)!]!.jobs.done++; t.jobsDone++; }
      if (slashed && byDid.has(c.performer)) { t.slashes++; groups[gOf.get(c.performer)!]!.slashes++; }
      const v = Number(b.escrow_released?.value ?? 0);
      add(at, s.seq, c.principal, c.performer, slashed ? KIND.slash : KIND.job, slashed ? Number(b.bond_slashed.value) : v, mem, (slashed ? FLAG.slash : 0) | (related ? FLAG.related : 0), slashed ? `${label(c.performer)} was slashed ${b.bond_slashed.value} credits${related ? " (work between related parties)" : ""}` : `${label(c.performer)}'s job for ${label(c.principal)} settled (${String(b.basis)})${related ? "; the two are related" : ""}`);
    }
  }
  for (const g of groups) { g.over = g.budget !== null && g.credits > g.budget; g.flagged = g.slashes + g.drift + g.refusals > 0 || g.over; }
  events.sort((x, y) => x.t - y.t || x.seq - y.seq);
  // a large window is sampled by keeping every event that carries a flag and an even share of the rest
  let kept = events, sampled = false;
  if (events.length > maxEvents) { sampled = true; const flagged = events.filter((e) => e.f), rest = events.filter((e) => !e.f), room = Math.max(0, maxEvents - flagged.length), step = rest.length / Math.max(1, room); kept = [...flagged, ...Array.from({ length: Math.min(room, rest.length) }, (_, i) => rest[Math.floor(i * step)]!)].sort((x, y) => x.t - y.t || x.seq - y.seq); }
  // nodes: keep every outside/institution node, and members named in kept events; add members up to the cap so the graph shows the fleet
  const kindOf = (k: string): HudNode["kind"] => (byDid.has(k) ? "member" : k.startsWith("did:web:asp.local") ? "institution" : "outside");
  const place = (k: string) => node(k, label(k), byDid.has(k) ? gOf.get(k)! : -1, kindOf(k));
  for (const e of kept) { e.a = place(e.ka); e.b = place(e.kb); }
  let shown = nodes.filter((n) => n.kind === "member").length;
  for (const m of f.members) { if (shown >= maxMembers) break; if (!nodeIdx.has(m.did)) { place(m.did); shown++; } }
  const out: HudEvent[] = kept.map(({ ka: _a, kb: _b, ...e }) => e);
  const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
  const med = lat.length ? sorted(lat)[Math.floor(lat.length / 2)]! : null;
  const frozenSet = new Set(controls.frozenMembers);
  const flagged = groups.filter((g) => g.flagged).length;
  return {
    ok: true, fleet: { id: f.id, name: f.name }, from, to, now: o.now, head, groups, nodes, events: out, sampled, spark,
    totals: { ...t, flagged, latencyMinutes: med === null ? null : Math.round(med), members: f.members.length, frozen: controls.frozen, cap: { credits: controls.caps.fleet.credits ?? null, tokens: controls.caps.fleet.tokens ?? null } },
    rail: { purpose: f.purpose, template: f.template ? [f.template.runtime, f.template.model].filter(Boolean).join(" / ") : null, capCredits: controls.caps.fleet.credits ?? null, capTokens: controls.caps.fleet.tokens ?? null, frozenMembers: frozenSet.size, frozenNodes: controls.frozenNodes ?? [], maxMembers: f.maxMembers, org: f.orgName },
  };
}
