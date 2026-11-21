/**
 * The fleet dashboard (register row DK1361; docs/enterprise-fleets.md): what an organisation sees about its own fleet, computed from the log's records and the fleet's controls: the members with tier, slashes, drift index, spend in
 * mock credits and tokens, the caps and the freeze state, the alerts, and an export. A pure function of `stored` (so the same log gives the same page), with a page of members at a time so the response stays small at 10,000 agents.
 * The records read: `passport` (members, declared tier), `tier_promotion`, `purchase` (credits spent), `action` (tokens), `settlement` and `contract` (slashes, work for others), `clinic_diagnosis` (drift). The fleet tree and the roles of an
 * organisation tenant (DK1372, DK1359) are separate rows; until they land the dashboard has one level (the fleet and its members) and one role (the tenant that owns the fleet's organisation). Credits are accounting entries, not money.
 */
import { fleetDirectory, findFleet, type FleetView } from "./fleets.ts";
import type { StoredRec } from "./society-story.ts";

const T = (s: string) => `asp.${s}/v0.2`;
const DAY = 86_400_000;
export const monthOf = (at: string): string => at.slice(0, 7);

export interface CapPair { credits?: number; tokens?: number }
export interface FleetControlState {
  frozen: boolean;
  frozenMembers: string[];
  /** Nodes of the fleet tree that are frozen: every member at the node or under it (DK1372). */
  frozenNodes: string[];
  caps: { fleet: CapPair; members: Record<string, CapPair> };
  audit: { at: string; by: string; act: string; target?: string; detail?: string }[];
}
export const emptyControls = (): FleetControlState => ({ frozen: false, frozenMembers: [], frozenNodes: [], caps: { fleet: {}, members: {} }, audit: [] });

export interface Spend { credits: number; tokens: number }
/** Credits spent (purchases) and tokens (actions) of each issuer in one calendar month, from the records. */
export function spendOf(stored: StoredRec[], month: string): Map<string, Spend> {
  const out = new Map<string, Spend>();
  const add = (did: string, credits: number, tokens: number) => { const s = out.get(did) ?? { credits: 0, tokens: 0 }; s.credits += credits; s.tokens += tokens; out.set(did, s); };
  for (const s of stored) {
    if (monthOf(s.record.issued_at) !== month) continue;
    if (s.record.type === T("purchase")) add(s.record.issuer, Number((s.record.body as { amount?: { value?: number } }).amount?.value ?? 0), 0);
    else if (s.record.type === T("action")) { const m = (s.record.body as { metrics?: { tokens_in?: number; tokens_out?: number } }).metrics; add(s.record.issuer, 0, Number(m?.tokens_in ?? 0) + Number(m?.tokens_out ?? 0)); }
  }
  return out;
}

export interface MemberRow { node: string; persona: string | null; did: string; name: string; tier: number | null; slashes: number; drift: 0 | 1 | 2; credits: number; tokens: number; frozen: boolean; capCredits: number | null; capTokens: number | null; journey: string }
/** One node of the fleet's tree as the dashboard shows it, depth first: its own members, everyone under it, what they spent this month against the node's budget, and whether it is frozen. */
export interface TreeRow { node: string; name: string; kind: string; persona: string | null; parent: string | null; depth: number; owner: string; membersHere: number; membersUnder: number; credits: number; tokens: number; budget: { credits: number | null; tokens: number | null }; overBudget: boolean; frozen: boolean; /** The node's breaker halted runs here (a signed run_halt, reason cycle, fleet_spend or breach): the latest, and how many runs. */ halted: { reason: string; at: string; runs: number } | null }
/** The last days of the fleet, one number a day (DK1601): members so far, credits and tokens spent that day, slashes and drift diagnoses that day. The graphs and their tables are drawn from it. */
export interface FleetSeries { days: string[]; members: number[]; credits: number[]; tokens: number[]; slashes: number[]; drift: number[] }
export interface FleetMix { persona: Record<string, number>; node: Record<string, number>; tier: Record<string, number> }
export const SERIES_DAYS = 30;
export interface Alert { kind: string; level: "info" | "warn" | "critical"; subject: string; text: string }
export interface FleetDashboard {
  ok: true;
  fleet: { id: string; name: string; org: string; purpose: string; members: number; maxMembers: number | null };
  month: string;
  totals: { members: number; frozen: number; slashes: number; drifting: number; credits: number; tokens: number; byTier: Record<string, number>; insideContracts: number; outsideAccepted: number };
  controls: { frozen: boolean; caps: { fleet: CapPair }; capsUsed: { credits: number | null; tokens: number | null } };
  page: { number: number; size: number; pages: number };
  members: MemberRow[];
  /** The fleet tree (DK1372): the root, departments, teams and personas, with the spend of each against its budget. Just the root when the organisation declared no tree. */
  tree: TreeRow[];
  series: FleetSeries;
  mix: FleetMix;
  alerts: Alert[];
  /** The first hour of an organisation that brings a fleet in (DK1371): what is done and what to do next, read from the log. */
  firstHour: { done: number; of: number; items: { step: string; done: boolean; next: string }[] };
  /** What the dashboard does not carry yet, and the rows that will add it. */
  not_yet: string[];
  note: string;
}

export const ROOT_NODE = "root";

/** The first-hour checklist (DK1371) from the log: the fleet declared, a Mandate template signed, members joined, a tree, a spending cap, a first spend. */
function firstHourOf(stored: StoredRec[], f: FleetView, members: number, treeRows: number, credits: number, cap: CapPair): FleetDashboard["firstHour"] {
  const hasTemplate = stored.some((s) => s.record.type === "asp.mandate_template/v0.2" && (s.record.body as { fleet?: string }).fleet === f.id);
  const items = [
    { step: "the fleet is declared", done: true, next: "asp fleet apply --manifest <file> --out <dir>" },
    { step: "a Mandate template is signed", done: hasTemplate, next: "asp fleet template set --did <fleet> --file <mandate.json> (apply signs one for each persona)" },
    { step: "the first agent has joined", done: members >= 1, next: "give an agent its line of invitations.jsonl: asp fleet join --invitation <line> --service <url>" },
    { step: f.maxMembers ? `every agent has joined (${members} of ${f.maxMembers})` : "the planned agents have joined", done: f.maxMembers ? members >= f.maxMembers : members >= 1, next: "asp fleet status --manifest <file> --out <dir>" },
    { step: "departments or teams are declared", done: treeRows > 1, next: "asp fleet node set --did <fleet> --node <id> --kind department --name <text> --owner <did>" },
    { step: "a monthly spending cap is set", done: cap.credits !== undefined, next: "POST /fleet/<fleet>/caps { credits: n } on this dashboard" },
    { step: "the fleet has done its first job", done: credits > 0, next: "an agent posts or takes a job on the Market: asp market intent|offer" },
  ];
  return { done: items.filter((i) => i.done).length, of: items.length, items };
}
const NOT_YET = ["roles for the people of an organisation, single sign-on and provisioning: DK1359", "a token cap enforced at each model call by the gateway (the service refuses a run report past the cap; the gateway's own budget is US2; DK1471)"];

export interface DashboardOptions { month: string; now: string; page?: number; pageSize?: number; /** Every member in one page (the export). */ all?: boolean; controls?: FleetControlState }

const countBy = (xs: string[]): Record<string, number> => { const m: Record<string, number> = {}; for (const x of xs) m[x] = (m[x] ?? 0) + 1; return m; };

export function fleetDashboard(stored: StoredRec[], fleetIdOrName: string, o: DashboardOptions): FleetDashboard | undefined {
  const dir = fleetDirectory(stored);
  const f = findFleet(dir, fleetIdOrName);
  if (!f) return undefined;
  return buildFor(stored, f, o);
}

function buildFor(stored: StoredRec[], f: FleetView, o: DashboardOptions): FleetDashboard {
  const controls = o.controls ?? emptyControls();
  const members = new Set(f.members.map((m) => m.did));
  const frozenSet = new Set(controls.frozenMembers);
  const now = Date.parse(o.now);
  const tier = new Map<string, number>();
  const slashes = new Map<string, number>();
  const drift = new Map<string, { at: number; v: 0 | 1 | 2 }>();
  const nodeOf = new Map<string, string>();
  const personaOf = new Map<string, string>();
  const nodes = new Map<string, { version: number; kind: string; name: string; parent: string | null; owner: string; persona: string | null; budget: { credits: number | null; tokens: number | null } }>();
  const contracts = new Map<string, { principal: string; performer: string }>();
  const accepted = new Map<string, number>(); // outside principal -> accepted jobs for fleet members
  let outsideAccepted = 0;
  for (const s of stored) {
    const r = s.record, b = r.body as Record<string, any>;
if (r.type === T("passport") && members.has(b.did) && b.kind === "agent") { if (b.tier !== undefined && !tier.has(b.did)) tier.set(b.did, Number(b.tier)); if (typeof b.node === "string") nodeOf.set(b.did, b.node); else nodeOf.delete(b.did); if (typeof b.persona === "string") personaOf.set(b.did, b.persona); else personaOf.delete(b.did); }
    else if (r.type === T("fleet_node") && b.fleet === f.id) { const prev = nodes.get(b.node); if (!prev || Number(b.version) >= prev.version) nodes.set(b.node, { version: Number(b.version), kind: b.kind, name: b.name, parent: typeof b.parent === "string" ? b.parent : null, owner: b.owner, persona: typeof b.persona === "string" ? b.persona : null, budget: { credits: b.budget?.credits ?? null, tokens: b.budget?.tokens ?? null } }); }
    else if (r.type === T("fleet_move") && b.fleet === f.id && members.has(b.member)) nodeOf.set(b.member, b.to)
    else if (r.type === T("tier_promotion") && r.subject && members.has(r.subject) && b.to !== undefined) tier.set(r.subject, Number(b.to));
    else if (r.type === T("contract")) contracts.set(s.id, { principal: b.principal, performer: b.performer });
    else if (r.type === T("clinic_diagnosis") && members.has(b.agent)) { const at = Date.parse(r.issued_at); if (now - at <= 30 * DAY && at <= now) { const v = b.severity === "quarantine_recommended" ? 2 : b.severity === "warn" ? 1 : 0; const prev = drift.get(b.agent); if (!prev || at >= prev.at) drift.set(b.agent, { at, v: v as 0 | 1 | 2 }); } }
    else if (r.type === T("settlement")) {
      const c = contracts.get(b.contract);
      if (!c || !members.has(c.performer)) continue;
      if ((b.bond_slashed?.value ?? 0) > 0 && now - Date.parse(r.issued_at) <= 30 * DAY) slashes.set(c.performer, (slashes.get(c.performer) ?? 0) + 1);
      if (b.basis === "accepted" && !members.has(c.principal)) { outsideAccepted++; accepted.set(c.principal, (accepted.get(c.principal) ?? 0) + 1); }
    }
  }
  // the daily series for the graphs
  const endDay = o.now.slice(0, 10);
  const days: string[] = [];
  for (let i = SERIES_DAYS - 1; i >= 0; i--) days.push(new Date(Date.parse(`${endDay}T00:00:00Z`) - i * DAY).toISOString().slice(0, 10));
  const idx = new Map(days.map((d, i) => [d, i]));
  const sCredits = days.map(() => 0), sTokens = days.map(() => 0), sSlashes = days.map(() => 0), sDrift = days.map(() => 0);
  const sMembers = days.map((d) => f.members.filter((m) => m.joined.slice(0, 10) <= d).length);
  for (const st of stored) {
    const r = st.record, i = idx.get(r.issued_at.slice(0, 10));
    if (i === undefined) continue;
    const b = r.body as Record<string, any>;
    if (r.type === T("purchase") && members.has(r.issuer)) sCredits[i]! += Number(b.amount?.value ?? 0);
    else if (r.type === T("action") && members.has(r.issuer)) sTokens[i]! += Number(b.metrics?.tokens_in ?? 0) + Number(b.metrics?.tokens_out ?? 0);
    else if (r.type === T("clinic_diagnosis") && members.has(b.agent)) sDrift[i]!++;
    else if (r.type === T("settlement") && (b.bond_slashed?.value ?? 0) > 0) { const c = contracts.get(b.contract); if (c && members.has(c.performer)) sSlashes[i]!++; }
  }
  const spend = spendOf(stored, o.month);
  const parentOf = (n: string): string | null => nodes.get(n)?.parent ?? null;
  const frozenNodes = new Set(controls.frozenNodes ?? []);
  const nodeFrozen = (n: string): boolean => { for (let at: string | null = n, i = 0; at && i < 16; at = parentOf(at), i++) if (frozenNodes.has(at)) return true; return false; };
  const rows: MemberRow[] = f.members.map((m) => {
    const sp = spend.get(m.did) ?? { credits: 0, tokens: 0 };
    const cap = controls.caps.members[m.did];
    const node = nodeOf.get(m.did) ?? ROOT_NODE;
    return { node, persona: personaOf.get(m.did) ?? null, did: m.did, name: m.name, tier: tier.get(m.did) ?? null, slashes: slashes.get(m.did) ?? 0, drift: drift.get(m.did)?.v ?? 0, credits: sp.credits, tokens: sp.tokens, frozen: controls.frozen || frozenSet.has(m.did) || nodeFrozen(node), capCredits: cap?.credits ?? null, capTokens: cap?.tokens ?? null, journey: `/agent/${encodeURIComponent(m.did)}/journey` };
  });
  const totalsCredits = rows.reduce((n, r) => n + r.credits, 0), totalsTokens = rows.reduce((n, r) => n + r.tokens, 0);
  const byTier: Record<string, number> = {};
  for (const r of rows) { const k = r.tier === null ? "unknown" : String(r.tier); byTier[k] = (byTier[k] ?? 0) + 1; }
  // the tree: members counted at their node and every node above it
  const own = new Map<string, number>(), under = new Map<string, number>(), cr = new Map<string, number>(), tk = new Map<string, number>();
  for (const r of rows) {
    own.set(r.node, (own.get(r.node) ?? 0) + 1);
    for (let at: string | null = r.node, i = 0; at && i < 16; at = parentOf(at), i++) { under.set(at, (under.get(at) ?? 0) + 1); cr.set(at, (cr.get(at) ?? 0) + r.credits); tk.set(at, (tk.get(at) ?? 0) + r.tokens); if (at === ROOT_NODE) break; }
    if (!nodes.has(r.node) && r.node !== ROOT_NODE) { /* a member naming a node the tree lacks sits at the root */ }
  }
  const kids = new Map<string | null, string[]>();
  for (const [id, n] of nodes) { if (id === ROOT_NODE) continue; const k = n.parent ?? ROOT_NODE; (kids.get(k) ?? kids.set(k, []).get(k)!).push(id); }
  for (const list of kids.values()) list.sort((a, b) => ((nodes.get(a)!.name < nodes.get(b)!.name) ? -1 : 1));
  // halted nodes (DK1477): the signed run_halt records of the fleet's members that name a breaker reason, counted by the node they name, else the member's own node
  const halts = new Map<string, { reason: string; at: string; runs: number }>();
  const nodeOfMember = new Map(rows.map((r) => [r.did, r.node]));
  for (const x of stored) {
    if (x.record.type !== "asp.run_halt/v0.2") continue;
    const hb = x.record.body as { agent: string; reason: string; node?: string };
    if (!["cycle", "fleet_spend", "breach"].includes(hb.reason) || !nodeOfMember.has(hb.agent)) continue;
    const at = hb.node ?? nodeOfMember.get(hb.agent)!, cur = halts.get(at);
    halts.set(at, { reason: hb.reason, at: x.record.issued_at, runs: (cur?.runs ?? 0) + 1 });
  }
  const tree: TreeRow[] = [];
  const walk = (id: string, depth: number) => {
    const n = nodes.get(id) ?? { version: 1, kind: "fleet", name: f.name, parent: null, owner: f.org, persona: null, budget: { credits: null, tokens: null } };
    const c = cr.get(id) ?? 0, t = tk.get(id) ?? 0;
    tree.push({ node: id, name: n.name, kind: n.kind, persona: n.persona, parent: n.parent, depth, owner: n.owner, membersHere: own.get(id) ?? 0, membersUnder: under.get(id) ?? 0, credits: c, tokens: t, budget: n.budget, overBudget: (n.budget.credits !== null && c > n.budget.credits) || (n.budget.tokens !== null && t > n.budget.tokens), frozen: controls.frozen || nodeFrozen(id), halted: halts.get(id) ?? null });
    if (depth < 8) for (const k of kids.get(id) ?? []) walk(k, depth + 1);
  };
  walk(ROOT_NODE, 1);
  const capF = controls.caps.fleet;
  const alerts: Alert[] = [];
  if (controls.frozen) alerts.push({ kind: "fleet_frozen", level: "critical", subject: f.name, text: `The fleet ${f.name} is frozen: writes by its agents are refused until it is unfrozen.` });
  for (const t of tree) if (t.halted) alerts.push({ kind: "node_halted", level: "critical", subject: t.name, text: `The ${t.kind} ${t.name} was halted by the fleet breaker (${t.halted.reason.replace("_", " ")}) on ${t.halted.at.slice(0, 10)}: ${t.halted.runs} run(s) were stopped, and the rest of the tree is untouched.` });
  for (const t of tree) if (!controls.frozen && t.node !== ROOT_NODE && frozenNodes.has(t.node)) alerts.push({ kind: "node_frozen", level: "warn", subject: t.name, text: `The ${t.kind} ${t.name} is frozen: its ${t.membersUnder} member${t.membersUnder === 1 ? "" : "s"} cannot write until it is unfrozen.` });
  for (const t of tree) { if (t.budget.credits !== null && t.credits >= t.budget.credits * 0.8) alerts.push({ kind: t.credits > t.budget.credits ? "node_over_budget" : t.credits === t.budget.credits ? "node_budget_reached" : "node_budget_near", level: t.credits >= t.budget.credits ? "critical" : "warn", subject: t.name, text: `${t.name} has used ${t.credits} of its ${t.budget.credits}-credit budget this month.` }); if (t.budget.tokens !== null && t.tokens >= t.budget.tokens) alerts.push({ kind: "node_tokens_reached", level: "critical", subject: t.name, text: `${t.name} has used ${t.tokens} of its ${t.budget.tokens}-token budget this month.` }); }
  for (const r of rows) if (!controls.frozen && r.frozen && !(frozenNodes.size && nodeFrozen(r.node)) ) alerts.push({ kind: "member_frozen", level: "warn", subject: r.name, text: `${r.name} is frozen.` });
  const capAlert = (subject: string, label: string, used: number, cap: number | undefined) => { if (!cap) return; if (used >= cap) alerts.push({ kind: "cap_reached", level: "critical", subject, text: `${subject} has reached its ${label} cap this month (${used} of ${cap}).` }); else if (used >= cap * 0.8) alerts.push({ kind: "cap_near", level: "warn", subject, text: `${subject} has used ${Math.round((used / cap) * 100)}% of its ${label} cap this month (${used} of ${cap}).` }); };
  capAlert(f.name, "credit", totalsCredits, capF.credits); capAlert(f.name, "token", totalsTokens, capF.tokens);
  for (const r of rows) { capAlert(r.name, "credit", r.credits, r.capCredits ?? undefined); capAlert(r.name, "token", r.tokens, r.capTokens ?? undefined); }
  for (const r of rows) {
    if (r.slashes > 0) alerts.push({ kind: "slash", level: "warn", subject: r.name, text: `${r.name} was slashed ${r.slashes} time${r.slashes === 1 ? "" : "s"} in the last 30 days.` });
    if (r.drift > 0) alerts.push({ kind: "drift", level: r.drift === 2 ? "critical" : "warn", subject: r.name, text: `${r.name} shows ${r.drift === 2 ? "drift (the Clinic recommends quarantine)" : "drift (a warning from the Clinic)"} in the last 30 days.` });
  }
  const top = [...accepted.values()].sort((a, b) => b - a)[0] ?? 0;
  if (outsideAccepted >= 5 && top / outsideAccepted >= 0.8) alerts.push({ kind: "concentration", level: "warn", subject: f.name, text: `${Math.round((top / outsideAccepted) * 100)}% of the accepted work for others comes from one principal.` });
  if (f.maxMembers !== null && f.members.length >= f.maxMembers) alerts.push({ kind: "fleet_full", level: "info", subject: f.name, text: `The fleet has reached its member cap of ${f.maxMembers}.` });
  const order = { critical: 0, warn: 1, info: 2 } as const;
  alerts.sort((a, b) => order[a.level] - order[b.level] || (a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0) || (a.kind < b.kind ? -1 : 1));
  const size = o.all ? Math.max(1, rows.length) : Math.min(500, Math.max(1, Math.trunc(o.pageSize ?? 100)));
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const number = Math.min(pages, Math.max(1, Math.trunc(o.page ?? 1)));
  return {
    ok: true,
    fleet: { id: f.id, name: f.name, org: f.org, purpose: f.purpose, members: f.members.length, maxMembers: f.maxMembers },
    month: o.month,
    totals: { members: rows.length, frozen: rows.filter((r) => r.frozen).length, slashes: rows.reduce((n, r) => n + r.slashes, 0), drifting: rows.filter((r) => r.drift > 0).length, credits: totalsCredits, tokens: totalsTokens, byTier, insideContracts: f.inside.contracts, outsideAccepted },
    controls: { frozen: controls.frozen, caps: { fleet: capF }, capsUsed: { credits: capF.credits ? totalsCredits : null, tokens: capF.tokens ? totalsTokens : null } },
    page: { number, size, pages },
    members: rows.slice((number - 1) * size, number * size),
    tree,
    series: { days, members: sMembers, credits: sCredits, tokens: sTokens, slashes: sSlashes, drift: sDrift },
    mix: { persona: countBy(rows.map((r) => r.persona ?? "none")), node: countBy(rows.map((r) => r.node)), tier: byTier },
    alerts, firstHour: firstHourOf(stored, f, rows.length, tree.length, totalsCredits, capF), not_yet: NOT_YET,
    note: "From the log's records and this fleet's controls; credits are accounting entries, not money; this service is a beta.",
  };
}

/** Every member as CSV (an export for the organisation's own tools), one row a member, no free text. */
export function fleetCsv(stored: StoredRec[], fleetIdOrName: string, o: DashboardOptions): string | undefined {
  const d = fleetDashboard(stored, fleetIdOrName, { ...o, page: 1, all: true });
  if (!d) return undefined;
  const all = d.members;
  const q = (x: unknown) => { const t = String(x ?? ""); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  return ["did,name,node,persona,tier,slashes_30d,drift,credits_spent,tokens,frozen,credit_cap,token_cap", ...all.map((r) => [r.did, r.name, r.node, r.persona ?? "", r.tier ?? "", r.slashes, r.drift, r.credits, r.tokens, r.frozen, r.capCredits ?? "", r.capTokens ?? ""].map(q).join(","))].join("\n") + "\n";
}
