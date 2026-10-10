/**
 * The data behind the dashboard (gap U2, U3, U6, U7): what the signed log says about agents, jobs, approvals, alerts and where the credits went,
 * shaped for a screen. Everything here is read from the log (and, for a job, the run log); nothing is stored, so the screen can always be checked
 * against `asp market show`, `asp log verify` and the records themselves.
 */
import { PLATFORM_DID } from "@agent-social/asp-log";
import { collectMandateFacts, findAlerts, type MailAlert, type MailLog, type MandateFacts } from "./mail.ts";
import type { RunEvent } from "./gateway/runlog.ts";

interface Stored { id: string; seq: number; record: { type: string; issuer: string; subject?: string | null; issued_at: string; body: any } }

/** The part of an EventLog the dashboard reads. */
export interface DashboardLog extends MailLog {
  head(): Promise<{ seq: number; logHash: string }>;
  balance(did: string): Promise<number>;
  escrow(contract: string): Promise<{ escrowPayer: string; escrowLocked: number; backer: string; bondLocked: number; settled: boolean } | undefined>;
  mints(): Promise<{ did: string; amount: number }[]>;
  reputationOf(did: string): Promise<{ tier: number; slashCount: number; strikes: number } | undefined | null>;
  report(id: string): Promise<{ status: string } | undefined | null>;
  passport(did: string): Promise<{ did: string; sponsor: string | null; fleet: string | null } | undefined | null>;
  keys(did: string): Promise<{ kid: string; kind: string; revokedAt: string | null; expiresAt: string | null }[]>;
  fleet(did: string): Promise<{ did: string; org: string; name: string } | undefined | null>;
  probation(did: string): Promise<{ did: string; until: string; setBy: string } | undefined | null>;
  chainInfo(contract: string): Promise<{ state: string | null; snapshot?: { openCheckpoint?: string; openCheckpointExpires?: string; principal?: string; performer?: string } | null } | undefined | null>;
}

const short = (id: string) => (id.length > 24 ? `${id.slice(0, 19)}...` : id);
const typeOf = (s: Stored) => s.record.type.replace(/^asp\./, "").replace(/\/v0\.2$/, "");

export interface HomeView {
  head: { seq: number; logHash: string };
  agents: { did: string; sponsor?: string; tier?: number; strikes?: number; credits: number; jobs: number; running: number; blocked: number }[];
  people: { did: string; credits: number }[];
  jobs: { id: string; purpose: string; principal: string; performer: string; state: string; price?: number; unit?: string; blocked: number; actions: number; lastAt: string; hasMandate: boolean }[];
  counts: { records: number; jobs: number; running: number; settled: number; waiting: number; alerts: number };
}

async function everything(log: DashboardLog): Promise<Stored[]> { return log.since(0, 1_000_000); }

export async function dashboardHome(log: DashboardLog): Promise<HomeView> {
  const all = await everything(log);
  const passports = new Map<string, Stored>();
  for (const s of all) if (s.record.type === "asp.passport/v0.2") passports.set(s.record.body.did, s);
  const contracts = all.filter((s) => s.record.type === "asp.contract/v0.2");
  const blockedBy = new Map<string, number>(), actionsBy = new Map<string, number>(), lastBy = new Map<string, string>();
  for (const s of all) {
    const b = s.record.body;
    if (s.record.type === "asp.action/v0.2") {
      actionsBy.set(b.contract, (actionsBy.get(b.contract) ?? 0) + 1);
      blockedBy.set(b.contract, (blockedBy.get(b.contract) ?? 0) + (b.blocked_attempts ?? []).reduce((n: number, x: any) => n + x.count, 0));
    }
    const c = s.record.type === "asp.action/v0.2" ? b.contract : undefined;
    if (c) lastBy.set(c, s.record.issued_at);
  }
  const mandateOf = new Set(all.filter((s) => s.record.type === "asp.mandate/v0.2").map((s) => s.record.body.contract));
  const jobs: HomeView["jobs"] = [];
  for (const c of contracts) {
    const b = c.record.body;
    const info = await log.chainInfo(c.id);
    jobs.push({
      id: c.id, purpose: b.purpose, principal: b.principal, performer: b.performer, state: info?.state ?? "unknown", ...(b.price ? { price: b.price.value, unit: b.price.unit } : {}),
      blocked: blockedBy.get(c.id) ?? 0, actions: actionsBy.get(c.id) ?? 0, lastAt: lastBy.get(c.id) ?? c.record.issued_at, hasMandate: mandateOf.has(c.id),
    });
  }
  jobs.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  const agents: HomeView["agents"] = [];
  const people: HomeView["people"] = [];
  for (const [did, p] of passports) {
    const kind = p.record.body.kind;
    const credits = await log.balance(did);
    if (kind === "agent") {
      const rep = await log.reputationOf(did);
      const mine = jobs.filter((j) => j.performer === did);
      agents.push({ did, ...(p.record.body.sponsor ? { sponsor: p.record.body.sponsor } : {}), ...(rep ? { tier: rep.tier, strikes: rep.strikes } : {}), credits, jobs: mine.length, running: mine.filter((j) => j.state === "Running" || j.state === "Checkpoint").length, blocked: mine.reduce((n, j) => n + j.blocked, 0) });
    } else people.push({ did, credits });
  }
  const alerts = await findAlerts(log);
  return {
    head: await log.head(), agents, people, jobs,
    counts: {
      records: all.length, jobs: jobs.length, running: jobs.filter((j) => j.state === "Running" || j.state === "Checkpoint").length, settled: jobs.filter((j) => j.state === "Settled").length,
      waiting: jobs.filter((j) => j.state === "Checkpoint").length, alerts: alerts.length,
    },
  };
}

export interface JobView {
  facts: MandateFacts;
  chain: { seq: number; id: string; kind: string; issuer: string; at: string; note?: string }[];
  money: { escrowPayer: string; escrowLocked: number; backer: string; bondLocked: number; settled: boolean } | null;
  flows: FlowEntry[];
  openCheckpoint?: { id: string; question: string; proposed?: string; expires?: string; principal: string };
  actions: { id: string; at: string; scopes: string[]; blocked: { scope: string; count: number }[]; late: boolean; assurance?: string; tokens?: number }[];
  runLog?: { path: string; ok: boolean; problem?: string; events: number; head: string; shown: RunEvent[]; truncated: number };
}

export interface FlowEntry { at: string; seq: number; kind: "bond" | "settlement"; contract: string; lines: { label: string; from?: string; to?: string; amount: number; unit: string }[] }

function flowsOf(all: Stored[], onlyContract?: string): FlowEntry[] {
  const out: FlowEntry[] = [];
  const principalOf = new Map<string, { principal: string; performer: string; bank: string }>();
  for (const s of all) if (s.record.type === "asp.contract/v0.2") principalOf.set(s.id, { principal: s.record.body.principal, performer: s.record.body.performer, bank: s.record.body.bank });
  for (const s of all) {
    const b = s.record.body;
    if (s.record.type === "asp.bond/v0.2" && (!onlyContract || b.contract === onlyContract)) {
      out.push({ at: s.record.issued_at, seq: s.seq, kind: "bond", contract: b.contract, lines: [
        { label: "escrow locked", from: b.escrow.payer, amount: b.escrow.amount.value, unit: b.escrow.amount.unit },
        { label: "bond locked", from: b.backer, amount: b.amount.value, unit: b.amount.unit },
      ] });
    }
    if (s.record.type === "asp.settlement/v0.2" && (!onlyContract || b.contract === onlyContract)) {
      const p = principalOf.get(b.contract);
      const u = b.escrow_released?.unit ?? "credit";
      const lines: FlowEntry["lines"] = [];
      if (b.escrow_released?.value) lines.push({ label: "escrow paid out", to: p?.performer, amount: b.escrow_released.value, unit: u });
      if (b.bond_returned?.value) lines.push({ label: "bond returned", to: p?.performer, amount: b.bond_returned.value, unit: u });
      if (b.bond_slashed?.value) lines.push({ label: "bond slashed", from: p?.performer, to: p?.principal, amount: b.bond_slashed.value, unit: u });
      if (b.fees?.value) lines.push({ label: "fees", to: PLATFORM_DID, amount: b.fees.value, unit: u });
      out.push({ at: s.record.issued_at, seq: s.seq, kind: "settlement", contract: b.contract, lines });
    }
  }
  return out;
}

/** One job: its facts (the same ones the mail uses), its chain, the money it holds, its Actions and, when given, its run log. */
export async function dashboardJob(log: DashboardLog, contract: string, runLog?: { path: string; ok: boolean; problem?: string; events: RunEvent[]; head: { events: number; hash: string } }, maxEvents = 300): Promise<JobView | undefined> {
  const facts = await collectMandateFacts(log, contract);
  if (!facts) return undefined;
  const all = await everything(log);
  const chain = (await log.chain(contract)).map((s) => ({
    seq: s.seq, id: s.id, kind: typeOf(s as Stored) === "attestation" ? String(s.record.body.kind ?? "attestation").replace(/_/g, " ") : typeOf(s as Stored), issuer: s.record.issuer, at: s.record.issued_at,
    ...(typeOf(s as Stored) === "checkpoint" ? { note: s.record.body.question } : typeOf(s as Stored) === "settlement" ? { note: s.record.body.basis } : typeOf(s as Stored) === "attestation" && s.record.body.verdict ? { note: s.record.body.verdict } : {}),
  }));
  const info = await log.chainInfo(contract);
  const open = info?.snapshot?.openCheckpoint;
  let openCheckpoint: JobView["openCheckpoint"];
  if (info?.state === "Checkpoint" && open) {
    const cp = all.find((s) => s.id === open);
    if (cp) openCheckpoint = { id: cp.id, question: cp.record.body.question, ...(cp.record.body.proposed_action ? { proposed: cp.record.body.proposed_action } : {}), ...(cp.record.body.expires ? { expires: cp.record.body.expires } : {}), principal: facts.contract.principal };
  }
  const actions = all.filter((s) => s.record.type === "asp.action/v0.2" && s.record.body.contract === contract).map((s) => ({
    id: s.id, at: s.record.issued_at, scopes: s.record.body.scopes_used ?? [], blocked: s.record.body.blocked_attempts ?? [], late: !!s.record.body.late,
    ...(s.record.body.assurance ? { assurance: s.record.body.assurance } : {}), ...(s.record.body.metrics ? { tokens: (s.record.body.metrics.tokens_in ?? 0) + (s.record.body.metrics.tokens_out ?? 0) } : {}),
  }));
  return {
    facts, chain, money: (await log.escrow(contract)) ?? null, flows: flowsOf(all, contract), ...(openCheckpoint ? { openCheckpoint } : {}), actions,
    ...(runLog ? { runLog: { path: runLog.path, ok: runLog.ok, ...(runLog.problem ? { problem: runLog.problem } : {}), events: runLog.head.events, head: runLog.head.hash, shown: runLog.events.slice(-maxEvents), truncated: Math.max(0, runLog.events.length - maxEvents) } } : {}),
  };
}

export interface AgentView {
  did: string;
  kind: string;
  purpose?: string;
  declaredTier?: number;
  shape?: Record<string, unknown>;
  earningsSplitPermille?: number;
  sponsor?: string;
  sponsored: { did: string; kind: string; tier?: number }[];
  fleet?: { name: string; org: string; copies: string[] };
  /** The agent this one was copied from (a fork edge in its passport), and the copies made from it. */
  copiedFrom?: string;
  copies: string[];
  credits: number;
  tier?: number;
  strikes?: number;
  slashCount?: number;
  probation?: { until: string; active: boolean; setBy: string };
  keys: { id: string; kind: string; revoked: boolean; revokedAt?: string; expiresAt?: string }[];
  versions: { id: string; at: string; keys: number }[];
  lineage: { id: string; at: string; edge: string; layer?: string; description?: string; reverts?: string; probationUntil?: string; gates: { id: string; verdict?: string; scorePercent?: number; skill?: string }[] }[];
  record: { asPerformer: number; settled: number; accepted: number; revoked: number; slashed: number; paid: number; blocked: number; scopesUsed: string[]; scopesBlocked: string[]; models: string[]; tokens: number; lateReports: number };
  jobs: { id: string; purpose: string; role: "performer" | "principal"; counterparty: string; state: string; blocked: number; at: string }[];
  reports: { id: string; contract: string; purpose: string; status: string; reasons: string[]; at: string }[];
}

/** One person's page: who they are, their keys and lineage, and what they have done. Agents and humans both. */
export async function dashboardAgent(log: DashboardLog, did: string): Promise<AgentView | undefined> {
  const passport = await log.passport(did);
  const all = await everything(log);
  const versions = all.filter((s) => s.record.type === "asp.passport/v0.2" && s.record.body.did === did);
  if (!passport && !versions.length) return undefined;
  const latest = versions.at(-1)?.record.body ?? {};
  const rep = await log.reputationOf(did);
  const probation = await log.probation(did);
  const keyRows = await log.keys(did);
  const byId = new Map(all.map((s) => [s.id, s]));

  const lineage = all.filter((s) => s.record.type === "asp.lineage/v0.2" && s.record.body.child === did).map((s) => {
    const b = s.record.body;
    return {
      id: s.id, at: s.record.issued_at, edge: b.edge as string, ...(b.change?.layer ? { layer: b.change.layer as string } : {}), ...(b.change?.description ? { description: b.change.description as string } : {}),
      ...(b.change?.reverts ? { reverts: b.change.reverts as string } : {}), ...(b.probation_until ? { probationUntil: b.probation_until as string } : {}),
      gates: ((b.change?.gates as string[] | undefined) ?? []).map((g) => {
        const c = byId.get(g)?.record.body;
        return { id: g, ...(c?.verdict ? { verdict: c.verdict as string } : {}), ...(typeof c?.score === "number" ? { scorePercent: Math.round(c.score / 10) } : {}), ...(c?.skill ? { skill: String(c.skill) } : {}) };
      }),
    };
  });

  const contracts = all.filter((s) => s.record.type === "asp.contract/v0.2" && (s.record.body.performer === did || s.record.body.principal === did));
  const purposeOf = new Map(contracts.map((c) => [c.id, c.record.body.purpose as string]));
  const jobs: AgentView["jobs"] = [];
  const rec: AgentView["record"] = { asPerformer: 0, settled: 0, accepted: 0, revoked: 0, slashed: 0, paid: 0, blocked: 0, scopesUsed: [], scopesBlocked: [], models: [], tokens: 0, lateReports: 0 };
  const used = new Set<string>(), blockedScopes = new Set<string>(), models = new Set<string>();
  for (const c of contracts) {
    const b = c.record.body;
    const role = b.performer === did ? "performer" : "principal";
    const info = await log.chainInfo(c.id);
    let blocked = 0;
    for (const a of all) {
      if (a.record.type !== "asp.action/v0.2" || a.record.body.contract !== c.id) continue;
      for (const x of a.record.body.blocked_attempts ?? []) { blocked += x.count; blockedScopes.add(x.scope); }
      if (role === "performer") {
        for (const s of a.record.body.scopes_used ?? []) used.add(s);
        for (const m of a.record.body.metrics?.models ?? []) models.add(m.name);
        rec.tokens += (a.record.body.metrics?.tokens_in ?? 0) + (a.record.body.metrics?.tokens_out ?? 0);
        if (a.record.body.late) rec.lateReports++;
      }
    }
    jobs.push({ id: c.id, purpose: b.purpose, role, counterparty: role === "performer" ? b.principal : b.performer, state: info?.state ?? "unknown", blocked, at: c.record.issued_at });
    if (role === "performer") {
      rec.asPerformer++;
      rec.blocked += blocked;
      const st = all.find((s) => s.record.type === "asp.settlement/v0.2" && s.record.body.contract === c.id);
      if (st) {
        rec.settled++;
        if (st.record.body.basis === "accepted" || st.record.body.basis === "silence" || st.record.body.basis === "ruling") rec.accepted += st.record.body.basis === "ruling" && (st.record.body.bond_slashed?.value ?? 0) > 0 ? 0 : 1;
        if (st.record.body.basis === "revoked") rec.revoked++;
        rec.slashed += st.record.body.bond_slashed?.value ?? 0;
        rec.paid += st.record.body.escrow_released?.value ?? 0;
      }
    }
  }
  rec.scopesUsed = [...used].sort(); rec.scopesBlocked = [...blockedScopes].sort(); rec.models = [...models].sort();
  jobs.sort((a, b) => b.at.localeCompare(a.at));

  const reports: AgentView["reports"] = [];
  for (const s of all) {
    if (s.record.type !== "asp.attestation/v0.2" || s.record.body.kind !== "report") continue;
    const contract = all.find((c) => c.id === s.record.body.about);
    if (!contract || contract.record.body.performer !== did) continue;
    const row = await log.report(s.id);
    reports.push({ id: s.id, contract: contract.id, purpose: contract.record.body.purpose, status: row?.status ?? "open", reasons: s.record.body.reasons ?? [], at: s.record.issued_at });
  }

  const sponsored: AgentView["sponsored"] = [];
  for (const p of all.filter((s) => s.record.type === "asp.passport/v0.2" && s.record.body.sponsor === did)) {
    if (sponsored.some((x) => x.did === p.record.body.did)) continue;
    const r = await log.reputationOf(p.record.body.did);
    sponsored.push({ did: p.record.body.did, kind: p.record.body.kind, ...(r ? { tier: r.tier } : {}) });
  }

  let fleet: AgentView["fleet"];
  if (passport?.fleet) {
    const fl = await log.fleet(passport.fleet);
    const copies = all.filter((s) => s.record.type === "asp.passport/v0.2" && s.record.body.fleet === passport.fleet).map((s) => s.record.body.did as string);
    if (fl) fleet = { name: fl.name, org: fl.org, copies: [...new Set(copies)].filter((d) => d !== did) };
  }

  // `asp identity copy` records where a copy came from only in the copy's purpose text ("... (independent copy of <did>)"), not as a signed edge (gaps register P15),
  // so that text is what the page reads.
  const COPY_OF = /\(independent copy of (did:[^\s)]+)\)/;
  const forkParent = COPY_OF.exec(String(latest.purpose ?? ""))?.[1];
  const copies = [...new Set(all.filter((x) => x.record.type === "asp.passport/v0.2" && COPY_OF.exec(String(x.record.body.purpose ?? ""))?.[1] === did).map((x) => x.record.body.did as string))];
  return {
    ...(forkParent ? { copiedFrom: forkParent } : {}), copies,
    did, kind: latest.kind ?? "human", ...(latest.purpose ? { purpose: latest.purpose } : {}), ...(typeof latest.tier === "number" ? { declaredTier: latest.tier } : {}), ...(latest.shape ? { shape: latest.shape } : {}),
    ...(latest.earnings_split ? { earningsSplitPermille: latest.earnings_split.agent_permille } : {}),
    ...(passport?.sponsor ? { sponsor: passport.sponsor } : latest.sponsor ? { sponsor: latest.sponsor } : {}), sponsored, ...(fleet ? { fleet } : {}),
    credits: await log.balance(did), ...(rep ? { tier: rep.tier, strikes: rep.strikes, slashCount: rep.slashCount } : {}),
    ...(probation ? { probation: { until: probation.until, active: Date.parse(probation.until) > Date.now(), setBy: probation.setBy } } : {}),
    keys: keyRows.map((k) => ({ id: k.kid, kind: k.kind, revoked: !!k.revokedAt, ...(k.revokedAt ? { revokedAt: k.revokedAt } : {}), ...(k.expiresAt ? { expiresAt: k.expiresAt } : {}) })),
    versions: versions.map((s) => ({ id: s.id, at: s.record.issued_at, keys: (s.record.body.keys ?? []).length })),
    lineage, record: rec, jobs, reports,
  };
}

export interface InboxView { waiting: { contract: string; purpose: string; performer: string; principal: string; checkpoint: string; question: string; proposed?: string; expires?: string; asked: string }[] }

/** Calls waiting for the principal's answer. */
export async function dashboardInbox(log: DashboardLog): Promise<InboxView> {
  const all = await everything(log);
  const waiting: InboxView["waiting"] = [];
  for (const c of all.filter((s) => s.record.type === "asp.contract/v0.2")) {
    const info = await log.chainInfo(c.id);
    if (info?.state !== "Checkpoint" || !info.snapshot?.openCheckpoint) continue;
    const cp = all.find((s) => s.id === info.snapshot!.openCheckpoint);
    if (!cp) continue;
    waiting.push({ contract: c.id, purpose: c.record.body.purpose, performer: c.record.body.performer, principal: c.record.body.principal, checkpoint: cp.id, question: cp.record.body.question,
      ...(cp.record.body.proposed_action ? { proposed: cp.record.body.proposed_action } : {}), ...(cp.record.body.expires ? { expires: cp.record.body.expires } : {}), asked: cp.record.issued_at });
  }
  waiting.sort((a, b) => b.asked.localeCompare(a.asked));
  return { waiting };
}

export interface AlertsView { alerts: (MailAlert & { purpose: string })[]; blocked: { at: string; contract: string; purpose: string; agent: string; scope: string; count: number }[] }

/** A kill, an upheld report, an expired Mandate, and the most recent blocked attempts. */
export async function dashboardAlerts(log: DashboardLog, recentBlocked = 30): Promise<AlertsView> {
  const all = await everything(log);
  const purposeOf = new Map(all.filter((s) => s.record.type === "asp.contract/v0.2").map((s) => [s.id, s.record.body.purpose as string]));
  const alerts = (await findAlerts(log)).map((a) => ({ ...a, purpose: purposeOf.get(a.contract) ?? "" })).sort((a, b) => b.at.localeCompare(a.at));
  const blocked: AlertsView["blocked"] = [];
  for (const s of all.filter((x) => x.record.type === "asp.action/v0.2").reverse()) {
    for (const x of s.record.body.blocked_attempts ?? []) {
      blocked.push({ at: s.record.issued_at, contract: s.record.body.contract, purpose: purposeOf.get(s.record.body.contract) ?? "", agent: s.record.issuer, scope: x.scope, count: x.count });
    }
    if (blocked.length >= recentBlocked) break;
  }
  return { alerts, blocked };
}

export interface MoneyView {
  unit: string;
  minted: number;
  accounts: { did: string; balance: number; minted: number }[];
  locked: { contract: string; purpose: string; escrow: number; bond: number; payer: string; backer: string }[];
  totals: { balances: number; lockedEscrow: number; lockedBond: number };
  conserved: boolean;
  difference: number;
  feed: (FlowEntry & { purpose: string })[];
}

/** Where every credit is, and the check that none appeared or vanished: minted = balances + what is locked in unsettled jobs. */
export async function dashboardMoney(log: DashboardLog): Promise<MoneyView> {
  const all = await everything(log);
  const dids = new Set<string>([PLATFORM_DID]);
  for (const s of all) {
    if (s.record.type === "asp.passport/v0.2") dids.add(s.record.body.did);
    if (s.record.type === "asp.contract/v0.2") for (const k of ["principal", "performer", "bank"]) if (s.record.body[k]) dids.add(s.record.body[k]);
  }
  const mints = await log.mints();
  for (const m of mints) dids.add(m.did);
  const mintOf = new Map(mints.map((m) => [m.did, m.amount]));
  const accounts: MoneyView["accounts"] = [];
  for (const did of dids) accounts.push({ did, balance: await log.balance(did), minted: mintOf.get(did) ?? 0 });
  accounts.sort((a, b) => b.balance - a.balance);
  const purposeOf = new Map(all.filter((s) => s.record.type === "asp.contract/v0.2").map((s) => [s.id, s.record.body.purpose as string]));
  const locked: MoneyView["locked"] = [];
  for (const c of purposeOf.keys()) {
    const e = await log.escrow(c);
    if (e && !e.settled && (e.escrowLocked || e.bondLocked)) locked.push({ contract: c, purpose: purposeOf.get(c) ?? "", escrow: e.escrowLocked, bond: e.bondLocked, payer: e.escrowPayer, backer: e.backer });
  }
  const balances = accounts.reduce((n, a) => n + a.balance, 0);
  const lockedEscrow = locked.reduce((n, l) => n + l.escrow, 0);
  const lockedBond = locked.reduce((n, l) => n + l.bond, 0);
  const minted = mints.reduce((n, m) => n + m.amount, 0);
  const difference = minted - (balances + lockedEscrow + lockedBond);
  return {
    unit: "credit", minted, accounts, locked, totals: { balances, lockedEscrow, lockedBond }, conserved: difference === 0, difference,
    feed: flowsOf(all).map((f) => ({ ...f, purpose: purposeOf.get(f.contract) ?? "" })).sort((a, b) => b.seq - a.seq).slice(0, 60),
  };
}
