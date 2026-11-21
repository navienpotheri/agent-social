/**
 * Fleets as the society shows them (register row DK1367; docs/enterprise-fleets.md): the fleets declared in the log, their members (the agents whose latest passport names the fleet), the fleet's own public record and the
 * work done inside it. A pure function of the log's public records: a fleet record (`fleet`: did, org, name, purpose, template, member cap) and the passports' `fleet` field; nothing private. Every page that shows an agent
 * asks `fleetOfAgent` for its mark (the fleet's id and name), so the mark is the same everywhere. A persona (a role within a fleet) is not read yet: the fleet records do not carry one until the rows that add it land
 * (DK1353, DK1366); the view says so. Credits are accounting entries, not money.
 */
import type { StoredRec } from "./society-story.ts";

const T = (s: string) => `asp.${s}/v0.2`;
export const fleetNameOf = (did: string): string => did.split(":").pop() ?? did;

export interface FleetMark { id: string; name: string; /** The persona the agent plays in the fleet (its passport's `persona`), when it has one (DK1353, DK1366). */ persona?: string }
export interface FleetMember { did: string; name: string; joined: string; house: boolean; persona: string | null; node: string | null }
/** What one group of agents has done, from the settlements of the log: the record of a fleet, of a persona within it, or of every agent that runs one template. */
export interface GroupRecord { members: number; settled: number; accepted: number; slashes: number; /** Slashes per settled job, in permille; null when nothing has settled. */ slashPermille: number | null }
/** The record of everyone who runs one template (runtime, model, harness and skills), across every fleet that declares it (DK1366). */
export interface TemplateRecord extends GroupRecord { key: string; fleets: number }
export interface PersonaRecord extends GroupRecord { persona: string }

export interface FleetView {
  id: string;
  name: string;
  org: string;
  orgName: string;
  purpose: string;
  declared: string;
  template: { runtime?: string; model?: string } | null;
  /** The record of all agents of this fleet, and of each persona in it. A fleet of copies has one group (no persona); a fleet of different agents has one for each persona. */
  record: GroupRecord;
  personas: PersonaRecord[];
  /** The record of every agent that runs this fleet's template, in this and any other fleet; null when the fleet names no template. Computed from the log, so anyone can recompute it. */
  templateRecord: TemplateRecord | null;
  maxMembers: number | null;
  members: FleetMember[];
  /** Contracts whose principal and performer are both members of this fleet (work inside the fleet), and how many settled accepted. They are related-party work: they never count toward standing (S1300). */
  inside: { contracts: number; accepted: number };
  /** Jobs a member did for a principal outside the fleet that settled accepted,. */
  outside: { accepted: number };
  /** What the view does not carry yet, and the rows that will add it. */
  not_yet: string[];
}

export interface FleetDirectory { fleets: FleetView[]; byAgent: Map<string, FleetMark>; byId: Map<string, FleetView> }

const NOT_YET: string[] = [];

/** Reads the directory from the log's records, in log order. A fleet that was declared twice keeps its latest declaration; an agent whose latest passport names no fleet is in none. */
export function fleetDirectory(stored: StoredRec[]): FleetDirectory {
  const decl = new Map<string, { rec: StoredRec; first: string }>();
  const latestPassport = new Map<string, { fleet?: string; joined: string; house: boolean; persona?: string; node?: string }>();
  const moved = new Map<string, string>();
  const firstSeen = new Map<string, string>();
  for (const s of stored) {
    if (s.record.type === T("fleet")) {
      const b = s.record.body as { did: string };
      const prior = decl.get(b.did);
      decl.set(b.did, { rec: s, first: prior?.first ?? s.record.issued_at });
    } else if (s.record.type === T("passport")) {
      const b = s.record.body as { did: string; kind: string; fleet?: string; house?: boolean; persona?: string; node?: string };
      if (b.kind !== "agent") continue;
      if (!firstSeen.has(b.did)) firstSeen.set(b.did, s.record.issued_at);
      latestPassport.set(b.did, { ...(b.fleet ? { fleet: b.fleet } : {}), joined: firstSeen.get(b.did)!, house: !!b.house, ...(b.persona ? { persona: b.persona } : {}), ...(b.node ? { node: b.node } : {}) });
      moved.delete(b.did);
    } else if (s.record.type === T("fleet_move")) { const b = s.record.body as { member: string; to: string }; moved.set(b.member, b.to); }
  }
  const members = new Map<string, FleetMember[]>();
  const byAgent = new Map<string, FleetMark>();
  for (const [did, p] of latestPassport) {
    if (!p.fleet || !decl.has(p.fleet)) continue;
    const name = (decl.get(p.fleet)!.rec.record.body as { name: string }).name;
    byAgent.set(did, { id: p.fleet, name, ...(p.persona ? { persona: p.persona } : {}) });
    const list = members.get(p.fleet) ?? [];
    list.push({ did, name: fleetNameOf(did), joined: p.joined, house: p.house, persona: p.persona ?? null, node: moved.get(did) ?? p.node ?? null });
    members.set(p.fleet, list);
  }
  // Contracts and settlements, for the work inside and outside each fleet.
  const contracts = new Map<string, { principal: string; performer: string }>();
  const settledAccepted = new Set<string>();
  const perf = new Map<string, { settled: number; accepted: number; slashes: number }>();   // by performer
  for (const s of stored) {
    if (s.record.type === T("contract")) { const b = s.record.body as { principal: string; performer: string }; contracts.set(s.id, { principal: b.principal, performer: b.performer }); }
    else if (s.record.type === T("settlement")) {
      const sb = s.record.body as { basis?: string; contract: string; bond_slashed?: { value?: number } };
      if (sb.basis === "accepted") settledAccepted.add(sb.contract);
      const c = contracts.get(sb.contract);
      if (c) { const p = perf.get(c.performer) ?? { settled: 0, accepted: 0, slashes: 0 }; p.settled++; if (sb.basis === "accepted") p.accepted++; if ((sb.bond_slashed?.value ?? 0) > 0) p.slashes++; perf.set(c.performer, p); }
    }
  }
  const group = (dids: string[]): GroupRecord => {
    let settled = 0, accepted = 0, slashes = 0;
    for (const d of dids) { const p = perf.get(d); if (p) { settled += p.settled; accepted += p.accepted; slashes += p.slashes; } }
    return { members: dids.length, settled, accepted, slashes, slashPermille: settled ? Math.round((slashes / settled) * 1000) : null };
  };
  // Templates: the same runtime, model, harness and skills is the same template, in any fleet.
  const keyOf = (t: unknown): string | null => (t && typeof t === "object" && Object.keys(t as object).length ? JSON.stringify(canon(t)) : null);
  const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, canon(x)])) : v);
  const byTemplate = new Map<string, { fleets: Set<string>; dids: string[] }>();
  for (const [id, d] of decl) {
    const key = keyOf((d.rec.record.body as { template?: unknown }).template);
    if (!key) continue;
    const t = byTemplate.get(key) ?? byTemplate.set(key, { fleets: new Set(), dids: [] }).get(key)!;
    t.fleets.add(id);
    for (const m of members.get(id) ?? []) t.dids.push(m.did);
  }
  const fleets: FleetView[] = [];
  for (const [id, d] of decl) {
    const b = d.rec.record.body as { name: string; org: string; purpose: string; template?: { runtime?: string; model?: string }; max_members?: number };
    const mine = (members.get(id) ?? []).sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
    const set = new Set(mine.map((m) => m.did));
    let insideN = 0, insideOk = 0, outsideOk = 0;
    for (const [cid, c] of contracts) {
      const perf = set.has(c.performer), prin = set.has(c.principal);
      if (perf && prin) { insideN++; if (settledAccepted.has(cid)) insideOk++; }
      else if (perf && settledAccepted.has(cid)) outsideOk++;
    }
    fleets.push({
      id, name: b.name, org: b.org, orgName: fleetNameOf(b.org), purpose: b.purpose, declared: d.first,
      template: b.template ? { ...(b.template.runtime ? { runtime: b.template.runtime } : {}), ...(b.template.model ? { model: b.template.model } : {}) } : null,
      record: group(mine.map((m) => m.did)),
      personas: [...new Set(mine.map((m) => m.persona).filter((x): x is string => !!x))].sort().map((persona) => ({ persona, ...group(mine.filter((m) => m.persona === persona).map((m) => m.did)) })),
      templateRecord: (() => { const key = keyOf((d.rec.record.body as { template?: unknown }).template); const t = key ? byTemplate.get(key) : undefined; return key && t ? { key, fleets: t.fleets.size, ...group(t.dids) } : null; })(),
      maxMembers: b.max_members ?? null, members: mine, inside: { contracts: insideN, accepted: insideOk }, outside: { accepted: outsideOk }, not_yet: NOT_YET,
    });
  }
  fleets.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : x.id < y.id ? -1 : 1));
  return { fleets, byAgent, byId: new Map(fleets.map((f) => [f.id, f])) };
}

/** The fleet a request names: its DID or its name (the first fleet of that name in name order). */
export function findFleet(dir: FleetDirectory, idOrName: string): FleetView | undefined {
  return dir.byId.get(idOrName) ?? dir.fleets.find((f) => f.name === idOrName);
}

/** The fleet mark of an agent, or null. */
export const fleetOfAgent = (dir: FleetDirectory, did: string): FleetMark | null => dir.byAgent.get(did) ?? null;
