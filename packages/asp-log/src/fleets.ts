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
export interface FleetView {
  id: string;
  name: string;
  org: string;
  orgName: string;
  purpose: string;
  declared: string;
  template: { runtime?: string; model?: string } | null;
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
  for (const s of stored) {
    if (s.record.type === T("contract")) { const b = s.record.body as { principal: string; performer: string }; contracts.set(s.id, { principal: b.principal, performer: b.performer }); }
    else if (s.record.type === T("settlement") && (s.record.body as { basis?: string }).basis === "accepted") settledAccepted.add((s.record.body as { contract: string }).contract);
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
