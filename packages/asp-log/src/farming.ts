/**
 * Anti-farming (register row DK1357; spec-delta S1410; docs/enterprise-fleets.md): the guards that read the DECLARED structure (sponsor, fleet) miss a farm that spreads itself over many sponsors, so this module reads the
 * BEHAVIOUR in the log and the facts the service holds about sponsors:
 *  - COMMON CONTROL: sponsors that share a key (one public key in the passports of two controllers), a lineage edge, or, from the service, a payment instrument, a verified domain or an address cluster, are one controller;
 *  - a JOB GRAPH over controllers and what it shows: rings (cycles of up to 5 controllers whose work stays inside the set), closed circles (a set of controllers whose accepted jobs are mostly among themselves), wash
 *    trades (the same value going both ways), fan-in (one beneficiary fed by many controllers that trade with nothing else) and a fleet's concentration (most of its counted standing from one outside controller).
 * A finding is a LEAD for the Clinic (a signed `common_control` record, an upheld report, a cohort freeze), never a penalty by itself. Honest fleets are not limited: work inside one sponsor or fleet is already not counted, and a
 * large honest customer base, a popular performer and a loyal client do not match any rule here (measured in the red-team suite: packages/asp-log/test/redteam-farming.test.ts).
 * THRESHOLDS ARE NOT PUBLISHED. They are named here, set within a band by an operator seed (`ASP_FARMING_SEED`; a fixed default for tests), so someone reading this source cannot tune an attack to the production values; the
 * documents give bands only. Pure and deterministic (records in, report out); the service data (payment, domain, address) is passed in because it is not in the log. Credits are accounting entries, not money.
 */
import { createHash } from "node:crypto";
import type { AspRecord } from "@agent-social/asp-core";

const DAY = 86_400_000;
export const FARMING_WINDOW_MS = 90 * DAY;
export const MAX_RING = 5;

/** Facts the hosted service holds about sponsors and the log does not: a value shared by two sponsors links them. Values are opaque (a hash the service made), never the instrument, domain or address itself. */
export interface ExternalFacts { payment?: Record<string, string>; domain?: Record<string, string>; address?: Record<string, string> }
export type ControlBasis = "key_lineage" | "payment" | "domain" | "address";
export interface Cluster { id: string; sponsors: string[]; basis: ControlBasis[] }

export type FindingKind = "common_control" | "ring" | "closed_circle" | "wash" | "fan_in" | "fleet_concentration";
export type Level = "watch" | "likely" | "strong";
export interface FarmingFinding { kind: FindingKind; level: Level; sponsors: string[]; jobs: string[]; why: string }
export interface FarmingReport { at: string; clusters: Cluster[]; findings: FarmingFinding[]; flaggedSponsors: string[]; sponsors: number; jobs: number }

/** The named thresholds, each a base value moved within +-15 % by the operator seed. Their names are public, their values are not. */
export interface Thresholds { internalShare: number; minCircleJobs: number; washRatio: number; washMinJobs: number; fanInFeeders: number; fanInMinJobs: number; fanInExclusive: number; concentration: number; concentrationMinJobs: number; ringEdge: number; likelyMargin: number; strongMargin: number }
const BASE: Thresholds = { internalShare: 0.7, minCircleJobs: 6, washRatio: 0.55, washMinJobs: 4, fanInFeeders: 8, fanInMinJobs: 3, fanInExclusive: 0.8, concentration: 0.6, concentrationMinJobs: 8, ringEdge: 3, likelyMargin: 0.08, strongMargin: 0.2 };
export function thresholdsFor(seed: string = "asp-default-seed"): Thresholds {
  const out = { ...BASE } as Record<string, number>;
  for (const [k, v] of Object.entries(BASE)) {
    const h = createHash("sha256").update(`${seed}|${k}`).digest().readUInt16BE(0) / 65535; // 0..1
    const f = 0.85 + 0.3 * h;
    out[k] = Number.isInteger(v) ? Math.max(1, Math.round(v * f)) : Math.round(v * f * 1000) / 1000;
  }
  return out as unknown as Thresholds;
}

type Rec = Pick<AspRecord, "id" | "type" | "issuer" | "body" | "issued_at">;
interface Job { id: string; from: string; to: string; fromAgent: string; toAgent: string; value: number; at: number }

class Dsu {
  private p = new Map<string, string>();
  find(x: string): string { if (!this.p.has(x)) this.p.set(x, x); let r = x; while (this.p.get(r) !== r) r = this.p.get(r)!; let c = x; while (c !== r) { const n = this.p.get(c)!; this.p.set(c, r); c = n; } return r; }
  union(a: string, b: string): void { const ra = this.find(a), rb = this.find(b); if (ra === rb) return; if (ra < rb) this.p.set(rb, ra); else this.p.set(ra, rb); }
}

/** Common-control clusters over sponsors: the sponsors (or the identities that sponsor nobody) that share a key, a lineage edge or a service fact. Only clusters of two or more are returned; the id is the smallest member. */
export function commonControl(records: Rec[], external: ExternalFacts = {}): { clusters: Cluster[]; controllerOf: (did: string) => string; sponsors: Set<string> } {
  const sponsorOf = new Map<string, string>();
  const keyOwners = new Map<string, Set<string>>();
  const lineage: [string, string][] = [];
  for (const r of records) {
    if (r.type !== "asp.passport/v0.2") continue;
    const b = r.body as { did: string; sponsor?: string; keys?: { public_key: string }[]; lineage?: { edge: string; parent: string }[] };
    sponsorOf.set(b.did, b.sponsor ?? b.did);
    for (const k of b.keys ?? []) { const s = keyOwners.get(k.public_key) ?? new Set(); s.add(b.did); keyOwners.set(k.public_key, s); }
    for (const l of b.lineage ?? []) if (l.edge !== "transfer") lineage.push([b.did, l.parent]);
  }
  const ctl = (d: string) => sponsorOf.get(d) ?? d;
  const dsu = new Dsu();
  const basis = new Map<string, Set<ControlBasis>>();
  const note = (a: string, b: string, why: ControlBasis) => { if (a === b) return; dsu.union(a, b); for (const x of [a, b]) { const s = basis.get(x) ?? new Set(); s.add(why); basis.set(x, s); } };
  for (const owners of keyOwners.values()) { const cs = [...new Set([...owners].map(ctl))]; for (let i = 1; i < cs.length; i++) note(cs[0], cs[i], "key_lineage"); }
  for (const [child, parent] of lineage) note(ctl(child), ctl(parent), "key_lineage");
  for (const [why, table] of [["payment", external.payment], ["domain", external.domain], ["address", external.address]] as const) {
    if (!table) continue;
    const byValue = new Map<string, string[]>();
    for (const [s, v] of Object.entries(table)) byValue.set(v, [...(byValue.get(v) ?? []), ctl(s)]);
    for (const members of byValue.values()) for (let i = 1; i < members.length; i++) note(members[0], members[i], why);
  }
  const groups = new Map<string, Set<string>>();
  for (const s of basis.keys()) { const root = dsu.find(s); const g = groups.get(root) ?? new Set(); g.add(s); groups.set(root, g); }
  const clusters: Cluster[] = [...groups.values()].filter((g) => g.size >= 2).map((g) => {
    const sponsors = [...g].sort();
    return { id: sponsors[0], sponsors, basis: [...new Set(sponsors.flatMap((s) => [...(basis.get(s) ?? [])]))].sort() as ControlBasis[] };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const sponsors = new Set([...sponsorOf.values()]);
  return { clusters, controllerOf: (d) => dsu.find(ctl(d)), sponsors };
}

/** The accepted jobs between controllers in the window: from the contracts and their accepted settlements. */
function jobGraph(records: Rec[], controllerOf: (d: string) => string, from: number, to: number): Job[] {
  const contracts = new Map<string, { principal: string; performer: string; price: number }>();
  for (const r of records) if (r.type === "asp.contract/v0.2") { const b = r.body as { principal: string; performer: string; price?: { value: number } }; contracts.set(r.id, { principal: b.principal, performer: b.performer, price: b.price?.value ?? 0 }); }
  const out: Job[] = [];
  for (const r of records) {
    if (r.type !== "asp.settlement/v0.2") continue;
    const b = r.body as { contract: string; basis: string };
    const c = contracts.get(b.contract);
    const at = Date.parse(r.issued_at);
    if (!c || b.basis !== "accepted" || at < from || at > to) continue;
    const a = controllerOf(c.principal), z = controllerOf(c.performer);
    if (a === z) continue; // work inside one controller never counts, so it is not a farm's gain
    out.push({ id: b.contract, from: a, to: z, fromAgent: c.principal, toAgent: c.performer, value: c.price, at });
  }
  return out.sort((x, y) => x.at - y.at);
}

const levelOf = (excess: number, t: Thresholds): Level | null => (excess < 0 ? null : excess >= t.strongMargin ? "strong" : excess >= t.likelyMargin ? "likely" : "watch");

/** The whole analysis (S1410): clusters, findings and the sponsors a freeze may name (`likely` or `strong`). */
export function analyseFarming(records: Rec[], opts: { at?: string; seed?: string; external?: ExternalFacts } = {}): FarmingReport {
  const t = thresholdsFor(opts.seed);
  const { clusters, controllerOf, sponsors } = commonControl(records, opts.external);
  const at = opts.at ?? records.reduce((m, r) => (r.issued_at > m ? r.issued_at : m), "1970-01-01T00:00:00Z");
  const jobs = jobGraph(records, controllerOf, Date.parse(at) - FARMING_WINDOW_MS, Date.parse(at));
  const findings: FarmingFinding[] = [];

  // common control is itself a finding (the sponsors count as one for independence once a signed record says so)
  for (const c of clusters) findings.push({ kind: "common_control", level: c.sponsors.length >= 5 ? "strong" : c.sponsors.length >= 3 ? "likely" : "watch", sponsors: c.sponsors, jobs: [], why: `${c.sponsors.length} sponsors share ${c.basis.join(", ")}` });

  // how much of each controller's work (in and out) is with whom
  const touch = new Map<string, number>();
  const pair = new Map<string, Job[]>();
  const adj = new Map<string, Set<string>>();
  for (const j of jobs) {
    touch.set(j.from, (touch.get(j.from) ?? 0) + 1); touch.set(j.to, (touch.get(j.to) ?? 0) + 1);
    const k = `${j.from}>${j.to}`; pair.set(k, [...(pair.get(k) ?? []), j]);
    const s = adj.get(j.from) ?? new Set(); s.add(j.to); adj.set(j.from, s);
  }
  const internalShare = (set: Set<string>): { share: number; inside: number; ids: string[] } => {
    let inside = 0, total = 0; const ids: string[] = [];
    for (const j of jobs) { const a = set.has(j.from), b = set.has(j.to); if (a || b) total++; if (a && b) { inside++; ids.push(j.id); } }
    return { share: total ? inside / total : 0, inside, ids };
  };
  const flaggedSets = new Set<string>();
  const addSet = (kind: "ring" | "closed_circle", set: Set<string>, why: string) => {
    const key = [...set].sort().join("|");
    if (flaggedSets.has(key)) return;
    const s = internalShare(set);
    if (s.inside < t.minCircleJobs) return;
    const lv = levelOf(s.share - t.internalShare, t);
    if (!lv) return;
    flaggedSets.add(key);
    findings.push({ kind, level: lv, sponsors: [...set].sort(), jobs: s.ids.slice(0, 50), why: `${why}: ${s.inside} of the ${Math.round(s.inside / s.share)} accepted jobs that touch ${set.size} controllers are among themselves` });
  };

  // rings: simple cycles of 2..5 controllers over the window's edges, judged by how closed the set is
  const nodes = [...adj.keys()].sort();
  const seenCycle = new Set<string>();
  const dfs = (start: string, cur: string, path: string[]) => {
    for (const n of adj.get(cur) ?? []) {
      if (n === start && path.length >= 2) {
        const set = new Set(path); const key = [...set].sort().join("|");
        if (!seenCycle.has(key)) {
          seenCycle.add(key);
          addSet("ring", set, `a ring of ${set.size} controllers that hire each other`);
          // a ring with cover: every hop repeated, whatever else its members do (three or more controllers; two are the wash rule's)
          if (path.length >= 3 && !flaggedSets.has(key)) {
            let minEdge = Infinity;
            for (let i = 0; i < path.length; i++) minEdge = Math.min(minEdge, pair.get(`${path[i]}>${path[(i + 1) % path.length]}`)?.length ?? 0);
            const lv = levelOf((minEdge - t.ringEdge) / t.ringEdge, { ...t, likelyMargin: 0, strongMargin: 0.5 });
            if (lv && lv !== "watch") { flaggedSets.add(key); findings.push({ kind: "ring", level: lv, sponsors: [...set].sort(), jobs: path.flatMap((_, i) => pair.get(`${path[i]}>${path[(i + 1) % path.length]}`)!.map((j) => j.id)).slice(0, 50), why: `a ring of ${set.size} controllers in which each hires the next at least ${minEdge} times, whatever else they do` }); }
          }
        }
      }
      else if (n > start && !path.includes(n) && path.length < MAX_RING) dfs(start, n, [...path, n]);
    }
  };
  for (const s of nodes) dfs(s, s, [s]);

  // closed circles: communities by label propagation over the job graph (sorted order, ties to the smaller label, so every replica finds the same ones), each judged by how closed it is
  const weight = new Map<string, Map<string, number>>();
  for (const j of jobs) for (const [x, y] of [[j.from, j.to], [j.to, j.from]]) { const m = weight.get(x) ?? new Map(); m.set(y, (m.get(y) ?? 0) + 1); weight.set(x, m); }
  const label = new Map<string, string>([...weight.keys()].sort().map((k) => [k, k]));
  for (let round = 0; round < 12; round++) {
    let changed = false;
    for (const x of [...weight.keys()].sort()) {
      const score = new Map<string, number>();
      for (const [y, w] of weight.get(x)!) score.set(label.get(y)!, (score.get(label.get(y)!) ?? 0) + w);
      score.set(label.get(x)!, (score.get(label.get(x)!) ?? 0) + 0.5);
      const best = [...score].sort((p, q) => q[1] - p[1] || (p[0] < q[0] ? -1 : 1))[0][0];
      if (best !== label.get(x)) { label.set(x, best); changed = true; }
    }
    if (!changed) break;
  }
  const comps = new Map<string, Set<string>>();
  for (const [x, l] of label) { const g = comps.get(l) ?? new Set(); g.add(x); comps.set(l, g); }
  for (const g of comps.values()) if (g.size >= 3 && g.size <= 60) addSet("closed_circle", g, `a closed circle of ${g.size} controllers`);

  // wash trades: the same value both ways between two controllers, and a real share of both parties' work
  const done = new Set<string>();
  for (const [k, js] of pair) {
    const [a, b] = k.split(">");
    const back = pair.get(`${b}>${a}`);
    const key = [a, b].sort().join("|");
    if (!back || done.has(key)) continue;
    done.add(key);
    const va = js.reduce((s, j) => s + j.value, 0), vb = back.reduce((s, j) => s + j.value, 0);
    const n = js.length + back.length;
    if (n < t.washMinJobs || Math.max(va, vb) === 0) continue;
    const balance = Math.min(va, vb) / Math.max(va, vb);
    const share = n / Math.min(touch.get(a) ?? n, touch.get(b) ?? n);
    const lv = levelOf(Math.min(balance, share) - t.washRatio, t);
    if (lv) findings.push({ kind: "wash", level: lv, sponsors: [a, b].sort(), jobs: [...js, ...back].map((j) => j.id).slice(0, 50), why: `${a} and ${b} hired each other for ${va} and ${vb} credits (${n} jobs), most of their work` });
  }

  // fan-in: one beneficiary fed by many controllers that trade with almost nothing else
  const feedersOf = new Map<string, Map<string, Job[]>>();
  for (const j of jobs) { const m = feedersOf.get(j.to) ?? new Map(); m.set(j.from, [...(m.get(j.from) ?? []), j]); feedersOf.set(j.to, m); }
  const outCount = new Map<string, number>(), inCount = new Map<string, number>();
  for (const j of jobs) { outCount.set(j.from, (outCount.get(j.from) ?? 0) + 1); inCount.set(j.to, (inCount.get(j.to) ?? 0) + 1); }
  for (const [benef, feeders] of feedersOf) {
    const exclusive: string[] = [];
    for (const [f, js] of feeders) {
      const mine = js.length, all = (outCount.get(f) ?? 0) + (inCount.get(f) ?? 0);
      if (mine >= t.fanInMinJobs && mine / all >= t.fanInExclusive) exclusive.push(f);
    }
    if (exclusive.length < t.fanInFeeders) continue;
    const lv = levelOf((exclusive.length - t.fanInFeeders) / t.fanInFeeders, { ...t, likelyMargin: 0.25, strongMargin: 0.75 });
    if (lv) findings.push({ kind: "fan_in", level: lv, sponsors: [benef, ...exclusive].sort(), jobs: exclusive.flatMap((f) => feeders.get(f)!.map((j) => j.id)).slice(0, 50), why: `${exclusive.length} controllers whose work is almost all for ${benef}` });
  }

  // a fleet's concentration: most of the counted standing of its members from one outside controller
  const fleetOf = new Map<string, string>();
  for (const r of records) if (r.type === "asp.passport/v0.2") { const b = r.body as { did: string; fleet?: string }; if (b.fleet) fleetOf.set(b.did, b.fleet); }
  const byFleet = new Map<string, Job[]>();
  for (const j of jobs) { const f = fleetOf.get(j.toAgent); if (f) byFleet.set(f, [...(byFleet.get(f) ?? []), j]); }
  for (const [fleet, js] of byFleet) {
    if (js.length < t.concentrationMinJobs) continue;
    const by = new Map<string, Job[]>();
    for (const j of js) by.set(j.from, [...(by.get(j.from) ?? []), j]);
    const [top, tj] = [...by].sort((a, b) => b[1].length - a[1].length)[0];
    const lv = levelOf(tj.length / js.length - t.concentration, t);
    if (lv) findings.push({ kind: "fleet_concentration", level: lv, sponsors: [top], jobs: tj.map((j) => j.id).slice(0, 50), why: `${tj.length} of fleet ${fleet}'s ${js.length} accepted jobs are for one outside controller (${top})` });
  }

  const flagged = new Set<string>();
  for (const f of findings) if (f.level !== "watch" && f.kind !== "fleet_concentration") for (const s of f.sponsors) flagged.add(s);
  return { at, clusters, findings, flaggedSponsors: [...flagged].sort(), sponsors: sponsors.size, jobs: jobs.length };
}

/** The sponsors a signed `common_control` finding put under one controller, mapped to the cluster id (the smallest member): the same arithmetic as the log's markers, for readers that have only the records (the journey view). A `lift` removes the sponsors it names. */
export function controlMapOf(records: Pick<AspRecord, "type" | "body">[]): Map<string, string> {
  const canon = new Map<string, string>();
  const members = new Map<string, Set<string>>();
  for (const r of records) {
    if (r.type !== "asp.common_control/v0.2") continue;
    const b = r.body as { sponsors: string[]; lift?: boolean };
    if (b.lift) {
      for (const s of b.sponsors) {
        const c = canon.get(s);
        if (!c) continue;
        const rest = [...(members.get(c) ?? [])].filter((m) => m !== s);
        canon.delete(s); members.delete(c);
        if (rest.length < 2) for (const m of rest) canon.delete(m);
        else { const n = [...rest].sort()[0]; for (const m of rest) canon.set(m, n); members.set(n, new Set(rest)); }
      }
      continue;
    }
    const all = new Set(b.sponsors);
    for (const s of b.sponsors) { const c = canon.get(s); if (c) for (const m of members.get(c) ?? []) all.add(m); }
    const n = [...all].sort()[0];
    for (const m of all) { const old = canon.get(m); if (old && old !== n) members.delete(old); canon.set(m, n); }
    members.set(n, all);
  }
  return canon;
}

/** The Clinic's cohort freeze on the agents of a flagged cluster (S1410): a quarantine body with the 24-hour notice and its reason on record, at most seven days, naming the upheld report. The Clinic signs it; the log applies the usual cohort rules (an upheld report, three distinct sponsors). */
export function farmingFreezeBody(o: { members: string[]; report: string; cluster: string; level: "observe" | "halt"; days: number; at: string; sponsors: number }): { members: string[]; level: "observe" | "halt"; reason: string; until: string; report: string; cluster: string; effective_from: string } {
  const at = Date.parse(o.at);
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
  return { members: [...o.members].sort(), level: o.level, reason: `an upheld report (${o.report}) and a farming finding across ${o.sponsors} sponsor(s) of one cluster`, until: iso(at + o.days * DAY), report: o.report, cluster: `farming:${o.cluster}`, effective_from: iso(at + DAY) };
}
