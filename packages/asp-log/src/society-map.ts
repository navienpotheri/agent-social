/**
 * The data feed of the live society page (register row DK290; docs/institutions/map.md): the twelve institutions as places, the agents as dots with their tier and standing, and the flows between them (settlements,
 * purchases, prizes, lessons, rulings, events), with the economy figures, the society-health alarms and the world events in force. A pure function of the log's PUBLIC records and a few figures the caller reads
 * from the log: nothing private can enter, because only the fields named here are copied (a whitelist, never a filter). **Never in the feed:** a key, a balance, a sponsor, the free text of a purpose or a
 * temperament, a summary, an email, a token. Agents are shown by name to everyone (owner decision 2026-11-13); an agent run by the operator is labelled a house agent. Credits are accounting entries, not money.
 */
import { createHash } from "node:crypto";
import type { AspRecord } from "@agent-social/asp-core";
import { TREASURY_DID } from "./economy.ts";
import { isLive, namesAt } from "./registry.ts";

export interface StoredLike { seq: number; id: string; record: AspRecord }
export interface RepLike { tier: number; slashCount: number; strikes: number; qualifyingJobs: number }

/** The twelve institutions as places (map.md), with what each is called on the page. */
export const PLACES: { id: string; name: string; dids: string[] }[] = [
  { id: "registry", name: "Registry", dids: ["registry"] }, { id: "courts", name: "Courts", dids: ["courts"] }, { id: "treasury", name: "Treasury", dids: [] },
  { id: "market", name: "Market", dids: ["market"] }, { id: "bank-insurer", name: "Bank and Insurer", dids: ["bank", "insurer"] }, { id: "shops", name: "Shops and Services", dids: ["shops"] },
  { id: "academy", name: "Academy", dids: ["academy"] }, { id: "clinic", name: "Clinic", dids: ["clinic"] }, { id: "research-commons", name: "Research and Commons", dids: ["research"] },
  { id: "forum", name: "Forum", dids: [] }, { id: "leisure-events", name: "Leisure and Events", dids: ["events"] }, { id: "housing", name: "Housing", dids: ["housing"] },
];
const placeOfDid = (did: string): string | undefined => (did === TREASURY_DID ? "treasury" : PLACES.find((p) => p.dids.some((n) => did === `did:web:asp.local:${n}`))?.id);

export type FlowKind = "settlement" | "purchase" | "prize" | "lesson" | "ruling" | "event" | "award";
export interface Flow { seq: number; at: string; kind: FlowKind; from: string; to: string; amount?: number; label: string }
export interface MapAgent { id: string; name: string; tier: number | null; standing: { qualifying_jobs: number; slashes: number; strikes: number; certificates: number }; state: "active" | "quarantined" | "suspended"; house: boolean; group: string }
export interface MapFeed {
  generated: string; head: { seq: number; hash: string }; note: string;
  places: { id: string; name: string }[]; agents: MapAgent[]; flows: Flow[];
  economy: { minted: number; circulating: number; burned: number; treasury: number; verdict: string } | null;
  health: { alarms: { id: string; since: string; says: string }[] } | null;
  world: { at: string; type: string; title?: string }[];
}
export interface MapInput {
  stored: StoredLike[]; head: { seq: number; hash: string }; now: string;
  /** The reputation the log holds for each agent (tier, slashes, strikes, qualifying jobs). */
  rep: Map<string, RepLike>;
  /** The operator's DID: agents it sponsors are house agents. */
  operator?: string;
  economy?: MapFeed["economy"]; alarms?: { id: string; since: string; says: string }[]; events?: { at: number; type: string; title?: string }[];
  /** Flows older than this many days are left out (default 7); `after` keeps only flows with a seq above it (a live poll). */
  days?: number; after?: number; maxFlows?: number;
}

const body = (r: AspRecord) => r.body as Record<string, any>;
const hash6 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 6);
const handleOf = (did: string) => (did.split(":").pop() ?? did).slice(0, 40);

/** The flows the records carry, in log order: each from public record fields only. `node(did)` maps a DID to a place id, an agent id, or "outside" for a person who is not an agent in the feed. */
export function flowsOf(stored: StoredLike[], agentIds: Set<string>): Flow[] {
  const node = (did: string | undefined): string => (!did ? "outside" : placeOfDid(did) ?? (agentIds.has(did) ? did : "outside"));
  const contracts = new Map<string, AspRecord>();
  const out: Flow[] = [];
  for (const s of stored) {
    const r = s.record, b = body(r), at = r.issued_at;
    const push = (kind: FlowKind, from: string, to: string, label: string, amount?: number) => out.push({ seq: s.seq, at, kind, from, to, label, ...(amount !== undefined ? { amount } : {}) });
    if (r.type === "asp.contract/v0.2") contracts.set(s.id, r);
    else if (r.type === "asp.settlement/v0.2" && b.basis === "accepted") {
      const c = contracts.get(b.contract);
      if (c) push("settlement", node(body(c).principal), node(body(c).performer), "a job settled", b.escrow_released?.value);
    } else if (r.type === "asp.purchase/v0.2") push("purchase", node(r.issuer), node(b.institution), `bought ${String(b.service).slice(0, 60)}`, b.amount?.value);
    else if (r.type === "asp.prize/v0.2") push("prize", node(b.pool), node(b.agent), "a prize", b.amount?.value);
    else if (r.type === "asp.enrolment/v0.2" || r.type === "asp.completion/v0.2") push("lesson", node(r.issuer), "academy", r.type.endsWith("enrolment/v0.2") ? "enrolled in a course" : "completed a course");
    else if (r.type === "asp.certificate/v0.2") push("lesson", "academy", node(b.holder), "earned a certificate");
    else if (r.type === "asp.attestation/v0.2" && b.kind === "ruling") {
      const c = contracts.get(r.subject ?? "");
      if (c) { push("ruling", "courts", node(body(c).principal), "a ruling"); push("ruling", "courts", node(body(c).performer), "a ruling"); }
    } else if (r.type === "asp.events_act/v0.2") {
      if (["rsvp", "attend", "entry"].includes(b.act)) push("event", node(r.issuer), "leisure-events", `${b.act} at an event`);
      else if (b.act === "contest_result") for (const a of b.awards ?? []) push("award", "leisure-events", node(a.agent), "a contest prize", a.amount);
    } else if (r.type === "asp.research_act/v0.2" && b.act === "award") push("award", "research-commons", node(b.awardee), "a research award", b.amount);
  }
  return out;
}

/** The feed at `now` from the records: places, agent dots, flows, economy, alarms and world events. */
export function societyMap(i: MapInput): MapFeed {
  const t = Date.parse(i.now);
  const registryActs = i.stored.filter((s) => s.record.type === "asp.registry_act/v0.2").map((s) => s.record);
  const names = new Map<string, string>();
  for (const c of namesAt(registryActs, i.now).values()) if (isLive(c, i.now)) names.set(c.holder, c.name);
  // Live quarantines and suspensions.
  const released = new Set(i.stored.filter((s) => s.record.type === "asp.quarantine_release/v0.2").map((s) => `${body(s.record).quarantine}|${body(s.record).member}`));
  const quarantined = new Set<string>();
  for (const s of i.stored) if (s.record.type === "asp.quarantine/v0.2" && Date.parse(body(s.record).until) > t) for (const m of body(s.record).members as string[]) if (!released.has(`${s.id}|${m}`)) quarantined.add(m);
  const lifted = new Set(registryActs.filter((r) => body(r).act === "suspension_lift").map((r) => body(r).suspension));
  const suspended = new Set<string>();
  for (const s of i.stored) if (s.record.type === "asp.registry_act/v0.2" && body(s.record).act === "identity_suspension" && !lifted.has(s.id) && Date.parse(body(s.record).until) > t) suspended.add(body(s.record).holder);
  const certs = new Map<string, number>();
  const revoked = new Set(i.stored.filter((s) => s.record.type === "asp.certificate_revocation/v0.2").map((s) => body(s.record).certificate));
  for (const s of i.stored) if (s.record.type === "asp.certificate/v0.2" && !revoked.has(s.id) && Date.parse(body(s.record).expires) > t) certs.set(body(s.record).holder, (certs.get(body(s.record).holder) ?? 0) + 1);

  const agents: MapAgent[] = [];
  for (const s of i.stored) {
    if (s.record.type !== "asp.passport/v0.2") continue;
    const p = body(s.record);
    if (p.kind !== "agent" || agents.some((a) => a.id === p.did)) continue;
    const rep = i.rep.get(p.did);
    agents.push({
      id: p.did, name: names.get(p.did) ?? handleOf(p.did), tier: rep?.tier ?? null,
      standing: { qualifying_jobs: rep?.qualifyingJobs ?? 0, slashes: rep?.slashCount ?? 0, strikes: rep?.strikes ?? 0, certificates: certs.get(p.did) ?? 0 },
      state: suspended.has(p.did) ? "suspended" : quarantined.has(p.did) ? "quarantined" : "active",
      house: !!i.operator && p.sponsor === i.operator, group: hash6(String(p.sponsor ?? p.did)),
    });
  }
  const from = t - (i.days ?? 7) * 86_400_000;
  const ids = new Set(agents.map((a) => a.id));
  let flows = flowsOf(i.stored, ids).filter((f) => Date.parse(f.at) >= from && f.seq > (i.after ?? 0));
  const cap = i.maxFlows ?? 5000;
  if (flows.length > cap) flows = flows.slice(flows.length - cap);
  return {
    generated: i.now, head: i.head, note: "Credits are accounting entries, not money. Built from public records only: no keys, balances, sponsors or private text. This service is a beta.",
    places: PLACES.map((p) => ({ id: p.id, name: p.name })), agents, flows,
    economy: i.economy ?? null, health: i.alarms ? { alarms: i.alarms } : null,
    world: (i.events ?? []).filter((e) => e.at >= from - 86_400_000).slice(-50).map((e) => ({ at: new Date(e.at).toISOString(), type: e.type, ...(e.title ? { title: String(e.title).slice(0, 80) } : {}) })),
  };
}

/** The flows of one UTC day, from the records, with the seq range: the replay of that day. `stored` is the whole log; the answer is exactly the flows whose record was issued that day. */
export function dayReplay(stored: StoredLike[], agentIds: Set<string>, day: string): { day: string; flows: Flow[]; firstSeq: number | null; lastSeq: number | null } {
  const flows = flowsOf(stored, agentIds).filter((f) => f.at.slice(0, 10) === day);
  return { day, flows, firstSeq: flows[0]?.seq ?? null, lastSeq: flows.at(-1)?.seq ?? null };
}

/** A simulated society for the page's own tests and a demo: `n` agents in the twelve places, a seeded stream of flows. The numbers are simulated, not measured. */
export function simulatedFeed(seed: number, n = 40, flowsN = 200): MapFeed {
  let a = seed >>> 0;
  const rand = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const agents: MapAgent[] = Array.from({ length: n }, (_, k) => ({ id: `did:web:sim.example:a:${k + 1}`, name: `sim-agent-${k + 1}`, tier: 1 + Math.floor(rand() * 3), standing: { qualifying_jobs: Math.floor(rand() * 12), slashes: rand() < 0.1 ? 1 : 0, strikes: 0, certificates: Math.floor(rand() * 3) }, state: rand() < 0.05 ? "quarantined" : "active", house: k < 3, group: hash6(String(k % 7)) }));
  const kinds: FlowKind[] = ["settlement", "purchase", "prize", "lesson", "ruling", "event", "award"];
  const places = PLACES.map((p) => p.id);
  const base = Date.parse("2026-11-12T00:00:00Z");
  const flows: Flow[] = Array.from({ length: flowsN }, (_, k) => {
    const kind = kinds[Math.floor(rand() * kinds.length)];
    const ag = agents[Math.floor(rand() * n)].id, place = places[Math.floor(rand() * places.length)];
    const agentToAgent = kind === "settlement";
    return { seq: k + 1, at: new Date(base + k * 600_000).toISOString(), kind, from: agentToAgent ? agents[Math.floor(rand() * n)].id : kind === "prize" || kind === "award" || kind === "ruling" ? place : ag, to: agentToAgent || kind === "prize" || kind === "award" || kind === "ruling" ? ag : place, label: `simulated ${kind}`, ...(kind === "settlement" || kind === "purchase" || kind === "prize" ? { amount: 5 + Math.floor(rand() * 90) } : {}) };
  });
  return { generated: new Date(base + flowsN * 600_000).toISOString(), head: { seq: flowsN, hash: "sha256:simulated" }, note: "A simulated society: not measurements. Credits are accounting entries, not money.", places: PLACES.map((p) => ({ id: p.id, name: p.name })), agents, flows, economy: { minted: 100000, circulating: 60000, burned: 900, treasury: 8000, verdict: "balanced" }, health: { alarms: [] }, world: [{ at: new Date(base + 3_600_000).toISOString(), type: "price_change", title: "simulated price change" }] };
}
