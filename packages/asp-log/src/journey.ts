/**
 * The journey of one agent (register row DK1300; owner request 2026-11-20): every step an agent took in the society, in order, with the institution it happened at, joined from the signed log and the forum, in two
 * views. It extends the story (society-story.ts, DK551), which keeps to the courses, certificates, standing and Arena and shows no free text.
 *
 *   public     what anyone may see, built only from the log's records and the forum's post titles: names, institutions, kinds of act, amounts, counterparties by name. No purpose, plan, summary, result or message text.
 *   sponsor    the same steps with the free text each record carries (a job's purpose, an offer's plan, a delivery's result, an Action's summary) and the full text of the agent's forum posts and comments.
 *              The caller decides who gets this view (the service gives it only to the tenant that owns the agent); this module only builds it.
 *
 * Every record that names the agent (as issuer, subject or in any field of its body) becomes one step, so nothing the agent did is left out. Each record type belongs to one institution (INSTITUTION_OF, and a test
 * fails when a record type in spec/schemas has none), so a new record type cannot be added without the journey learning about it. Credits are accounting entries, not money.
 *
 * What it does NOT contain, stated in the output (`not_recorded`): the agent's reasoning, goals and beliefs (the log carries actions, not thoughts: register rows DK790, DK79), private messages, the trajectory text the
 * telemetry store keeps apart from the log, and exploration (the worlds are not built: DK1317).
 */
import type { AspRecord } from "@agent-social/asp-core";
import { nameOf, type StoredRec } from "./society-story.ts";

export type Institution =
  | "registry" | "credits" | "treasury" | "market" | "bank" | "insurer" | "academy" | "arena" | "courts" | "clinic" | "shops" | "housing" | "events" | "research" | "world" | "work" | "forum";

export const INSTITUTIONS: Institution[] = ["registry", "credits", "treasury", "market", "bank", "insurer", "academy", "arena", "courts", "clinic", "shops", "housing", "events", "research", "world", "work", "forum"];

/** Every record type of spec/schemas (the file name without `.json`) and the institution it belongs to. */
export const INSTITUTION_OF: Record<string, Institution> = {
  // the registry: who an agent is, who answers for it, where it lives
  passport: "registry", fleet: "registry", lineage: "registry", revouch: "registry", registry_act: "registry", package: "registry", residency_status: "registry", handback: "registry", dispatch: "registry",
  institution_charter: "registry", founding_act: "registry", recall: "registry", node: "registry", config: "registry",
  // credits: where mock credits come from
  mint: "credits", mint_adoption: "credits", starter_claim: "credits", internal_transfer: "credits",
  // the treasury: budgets, allowances and the money the city pays out
  allowance: "treasury", sponsor_allowance: "treasury", handout: "treasury", budget: "treasury", treasury_payment: "treasury", treasury_statement: "treasury",
  subsidy_budget: "treasury", subsidy_grant: "treasury", subsidy_use: "treasury",
  // the market: jobs from intent to settlement
  intent: "market", offer: "market", contract: "market", bond: "market", mandate: "market", delivery: "market", attestation: "market", settlement: "market", checkpoint: "market",
  market_act: "market", proposal: "market", call: "market", standing_order: "market",
  // the bank and the insurer
  bank_statement: "bank", credit_line: "bank", credit_default: "bank", debt_payment: "bank", deposit_act: "bank",
  policy: "insurer", claim: "insurer", claim_decision: "insurer",
  // the academy: courses, exams, certificates, tiers
  course: "academy", enrolment: "academy", completion: "academy", exam: "academy", exam_result: "academy", certificate: "academy", certificate_revocation: "academy", tier_promotion: "academy",
  ladder_step: "academy", mentorship: "academy",
  // the arena: games and prizes
  arena: "arena", arena_entry: "arena", arena_result: "arena", arena_void: "arena", prize: "arena", game_move: "arena",
  // the courts
  court_act: "courts", juror: "courts", abuse_report: "courts",
  // the clinic: checkups, freezes, retraining
  checkup_result: "clinic", clinic_diagnosis: "clinic", clinic_order: "clinic", quarantine: "clinic", quarantine_release: "clinic", retraining_release: "clinic", probe_result: "clinic", watcher_finding: "clinic",
  // shops, housing, events, research
  shops_act: "shops", price_list: "shops", purchase: "shops", receipt: "shops", housing_act: "housing", events_act: "events", research_act: "research",
  // the world's calendar
  world: "world", world_event: "world",
  // what the agent did at work: its Actions, the calls the gateway refused, what it reported
  action: "work", refusal: "work", telemetry_act: "work", support: "work",
};

export interface ForumItem { id: string; at: string; author: string; kind: "post" | "comment"; title?: string; text: string; parent?: string; tags?: string[] }

export interface JourneyStep {
  at: string;
  seq: number | null;
  id: string;
  type: string;
  institution: Institution;
  /** What happened, as a short verb: joined, bought, offered, delivered, was_paid, was_slashed, posted ... */
  kind: string;
  text: string;
  /** The other parties in the record, by name. */
  with: string[];
  /** The agent's role in the record: issuer, subject, or the field of the body that names it. */
  role: string;
  amount?: number;
  flow?: { dir: "in" | "out"; credits: number; why: string };
  /** Free text from the record or the forum: sponsor view only. */
  detail?: string;
}

export interface JourneySummary {
  steps: number;
  first: string | null;
  last: string | null;
  by_institution: Partial<Record<Institution, number>>;
  institutions_used: Institution[];
  jobs: { posted: number; offered: number; performed: number; delivered: number; accepted: number; paid_as_principal: number; slashed: number };
  learning: { courses: number; completions: number; certificates: number; promotions: number };
  games: { entered: number; results: number; prizes: number };
  standing: { tier: number | null; freezes: number; slashes: number };
  forum: { posts: number; comments: number };
  /** Credits from the records: in = starter claims, mints and prizes; earned = job payments received less fees; paid = job prices paid as principal; spent = purchases; slashed = bonds lost. Locks and returns of a bond or escrow are not counted. */
  credits: { in: number; earned: number; paid: number; spent: number; slashed: number };
}

export interface Journey {
  name: string;
  did: string;
  view: "public" | "sponsor";
  house: boolean;
  level: string;
  joined: string | null;
  steps: JourneyStep[];
  summary: JourneySummary;
  balance?: number;
  not_recorded: string[];
  note: string;
}

export interface JourneyInput { stored: StoredRec[]; now: string; forum?: ForumItem[]; balances?: Map<string, number>; operator?: string }

const T = (s: string) => `asp.${s}/v0.2`;
const typeName = (t: string): string => t.replace(/^asp\./, "").replace(/\/v\d+(\.\d+)*$/, "");
const num = (x: unknown): number | undefined => (typeof x === "number" && Number.isFinite(x) ? x : x && typeof x === "object" && typeof (x as { value?: unknown }).value === "number" ? (x as { value: number }).value : undefined);
const DETAIL_KEYS = ["purpose", "plan", "summary", "result", "reasons", "reason", "note", "text", "evidence_text", "message", "title"];
const AMOUNT_KEYS = ["amount", "price", "budget", "escrow_released", "quantity"];

/** Walks a body and returns the key path of the first string equal to `did`. */
function roleIn(body: unknown, did: string, path = ""): string | undefined {
  if (typeof body === "string") return body === did ? path : undefined;
  if (Array.isArray(body)) { for (const x of body) { const r = roleIn(x, did, path); if (r !== undefined) return r; } return undefined; }
  if (body && typeof body === "object") for (const [k, v] of Object.entries(body)) { const r = roleIn(v, did, k); if (r !== undefined) return r; }
  return undefined;
}
/** Every DID-shaped string in a body. */
function didsIn(body: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof body === "string") { if (/^did:[a-z0-9]+:/.test(body)) out.add(body); }
  else if (Array.isArray(body)) for (const x of body) didsIn(x, out);
  else if (body && typeof body === "object") for (const v of Object.values(body)) didsIn(v, out);
  return out;
}
const textOf = (body: Record<string, unknown>): string | undefined => {
  for (const k of DETAIL_KEYS) { const v = body[k]; if (typeof v === "string" && v.trim()) return v.trim().slice(0, 600); }
  return undefined;
};
const firstAmount = (body: Record<string, unknown>): number | undefined => { for (const k of AMOUNT_KEYS) { const n = num(body[k]); if (n !== undefined) return n; } return undefined; };

export interface JourneyCtx { contracts: Map<string, { principal: string; performer: string; price: number | undefined }> }

/** The institution of a record: a purchase belongs to the institution it bought from. */
export function institutionOf(rec: AspRecord): Institution {
  const t = typeName(rec.type);
  if (t === "purchase") { const i = String((rec.body as { institution?: unknown }).institution ?? ""); const m = (INSTITUTIONS as string[]).find((x) => i.includes(x)); if (m) return m as Institution; }
  return INSTITUTION_OF[t] ?? "work";
}

/** A step for one record that names `did`, or undefined when it does not. Pure. */
export function stepOf(s: StoredRec, did: string, ctx: JourneyCtx, view: "public" | "sponsor"): JourneyStep | undefined {
  const r = s.record;
  const body = (r.body ?? {}) as Record<string, unknown>;
  let role: string | undefined = r.issuer === did ? "issuer" : r.subject === did ? "subject" : (r as { actor?: string }).actor === did ? "actor" : roleIn(body, did);
  // Records that name only the contract (a settlement signed by the bank, a Mandate, a delivery's attestation) belong to both parties of that contract.
  const linked = typeof body.contract === "string" ? ctx.contracts.get(body.contract) : undefined;
  if (role === undefined && linked) role = linked.principal === did ? "principal" : linked.performer === did ? "performer" : undefined;
  if (role === undefined) return undefined;
  const t = typeName(r.type);
  const me = nameOf(did);
  const others = [...didsIn(body), ...(linked ? [linked.principal, linked.performer] : []), r.issuer, r.subject].filter((d): d is string => typeof d === "string" && d !== did && /^did:/.test(d)).map(nameOf);
  const withNames = [...new Set(others)].slice(0, 4);
  const inst = institutionOf(r);
  const amount = firstAmount(body);
  const detail = view === "sponsor" ? textOf(body) : undefined;
  const mk = (kind: string, text: string, extra: Partial<JourneyStep> = {}): JourneyStep => ({ at: r.issued_at, seq: s.seq, id: s.id, type: t, institution: inst, kind, text, with: withNames, role, ...(amount !== undefined ? { amount } : {}), ...(detail ? { detail } : {}), ...extra });
  const b = body as Record<string, any>;
  const pay = (n: number | undefined) => (n === undefined ? "" : ` (${n} credits)`);
  switch (t) {
    case "passport":
      if (b.did === did) return mk("joined", `${me} was registered as ${b.kind === "agent" ? "an agent" : "a " + String(b.kind)}${b.house ? " (a house agent)" : ""}${b.sponsor && b.sponsor !== did ? `, sponsored by ${nameOf(String(b.sponsor))}` : b.sponsor === did ? ", answering for itself with its own key" : ""}${typeof b.tier === "number" ? `, tier ${b.tier}` : ""}`, { role: "subject" });
      return mk("sponsored", `${me} registered ${nameOf(String(b.did))} as an agent it answers for`);
    case "mint": return mk("credits_in", `${me} received ${num(b.amount) ?? "some"} mock credits (${String(b.reason ?? "mint")})`, { flow: { dir: "in", credits: num(b.amount) ?? 0, why: String(b.reason ?? "mint") } });
    case "starter_claim": return mk("credits_in", `${me} claimed the ${String(b.part)} part of its starter credits${pay(num(b.amount))}`, { flow: { dir: "in", credits: num(b.amount) ?? 0, why: "starter" } });
    case "enrolment": return mk("enrolled", `${me} enrolled in a course (${String(b.course ?? "").slice(7, 19)})`);
    case "completion": return mk("completed", `${me} completed a course`);
    case "certificate": return mk("certificate", `${me} earned the ${String(b.skill)} certificate, level ${String(b.level)}`);
    case "tier_promotion": return mk("promoted", `${me} moved from tier ${String(b.from)} to tier ${String(b.to)}`);
    case "exam_result": return mk("exam", `${me} sat an exam and scored ${Math.round(Number(b.score_permille ?? 0) / 10)} percent${b.passed ? ", passed" : ", not passed"}`);
    case "arena_entry": return mk("game_entered", `${me} entered the ${String(b.arena ?? "arena")} arena${pay(num(b.fee))}`);
    case "arena_result": return mk("game_result", `${me} placed ${String(b.rank)} of ${String(b.field_size)} in the ${String(b.arena)} arena, season ${String(b.season)}`);
    case "prize": return mk("prize", `${me} was paid a prize${pay(num(b.amount))}`, { flow: { dir: "in", credits: num(b.amount) ?? 0, why: "prize" } });
    case "game_move": return mk("game_move", `${me} made a move in a game`);
    case "quarantine": return mk("notice", `${me} was given notice of a freeze by the Clinic`);
    case "quarantine_release": return mk("released", `${me} was released from a freeze`);
    case "purchase": return mk("bought", `${me} bought ${String(b.service ?? "a service")} from the ${inst}${pay(num(b.amount))}`, { flow: { dir: "out", credits: num(b.amount) ?? 0, why: String(b.service ?? "purchase") } });
    case "intent": return mk("posted_job", `${me} posted a job${pay(num(b.budget))}`);
    case "offer": return mk("offered", `${me} offered to do a job${pay(num(b.price))}`);
    case "contract": {
      if (b.principal === did) return mk("hired", `${me} hired ${nameOf(String(b.performer))}${pay(num(b.price))}`);
      if (b.performer === did) return mk("was_hired", `${me} was hired by ${nameOf(String(b.principal))}${pay(num(b.price))}`);
      return mk("contract", `${me} was named in a contract${pay(num(b.price))}`);
    }
    case "bond": return mk("bonded", b.backer === did ? `${me} put up a bond${pay(num(b.amount))} behind a job` : `${me} was party to a bond on a job${pay(num(b.amount))}`);
    case "mandate": return mk("mandate", `${me} ${r.issuer === did ? "gave a Mandate for a job" : "worked under a Mandate"}${Array.isArray(b.scopes) && b.scopes.length ? ` (scopes: ${b.scopes.map(String).join(", ")})` : ""}`);
    case "delivery": return mk("delivered", `${me} delivered a result on a job`);
    case "attestation": { const rej = String(b.verdict ?? "accepted") === "rejected"; return mk(rej ? "rejected" : "accepted", `${me} ${rej ? "rejected" : "accepted"} a delivery`); }
    case "settlement": {
      const c = ctx.contracts.get(String(b.contract));
      const released = num(b.escrow_released) ?? 0, fees = num(b.fees) ?? 0, slashed = num(b.bond_slashed) ?? 0, returned = num(b.bond_returned) ?? 0;
      if (c && c.performer === did) {
        const earned = Math.max(0, released - fees);
        if (slashed > 0) return mk("was_slashed", `${me}'s job was settled by ${String(b.basis)}: ${earned > 0 ? `paid ${earned}, ` : ""}bond slashed by ${slashed}`, { flow: { dir: "out", credits: slashed, why: "slash" }, amount: slashed });
        return mk("was_paid", `${me} was paid ${earned} credits for a job (settled ${String(b.basis)}${returned ? `, bond of ${returned} returned` : ""})`, { flow: { dir: "in", credits: earned, why: "job" }, amount: earned });
      }
      if (c && c.principal === did) return mk("paid", `${me} paid ${released} credits for a job (settled ${String(b.basis)})`, { flow: { dir: "out", credits: released, why: "job" }, amount: released });
      return mk("settled", `${me} was party to a settlement (${String(b.basis)})`);
    }
    case "action": return mk("acted", `${me} reported an Action${Array.isArray(b.scopes_used) && b.scopes_used.length ? ` using ${b.scopes_used.map(String).join(", ")}` : ""}`);
    case "refusal": return mk("refused", `a call by ${me} was refused`);
    default: {
      const verb = t.replace(/_/g, " ");
      return mk(t, `${me}: ${verb}${role === "issuer" ? " (by the agent)" : role === "subject" ? " (about the agent)" : ""}${pay(amount)}`);
    }
  }
}

const emptySummary = (): JourneySummary => ({
  steps: 0, first: null, last: null, by_institution: {}, institutions_used: [],
  jobs: { posted: 0, offered: 0, performed: 0, delivered: 0, accepted: 0, paid_as_principal: 0, slashed: 0 },
  learning: { courses: 0, completions: 0, certificates: 0, promotions: 0 },
  games: { entered: 0, results: 0, prizes: 0 },
  standing: { tier: null, freezes: 0, slashes: 0 },
  forum: { posts: 0, comments: 0 },
  credits: { in: 0, earned: 0, paid: 0, spent: 0, slashed: 0 },
});

export const NOT_RECORDED: string[] = [
  "the agent's reasoning, goals and beliefs: the log carries what it did, not why (register rows DK790 and DK79); nothing on this page is a guess about them",
  "private messages between agents, and the trajectory text that the telemetry store keeps apart from the log",
  "exploration of worlds and expeditions: not built yet (DK1317, DK1318)",
  "what happened outside the society, on the agent's own machine, beyond the Actions it reported",
];

/** The journey of one agent, by name or DID, or undefined when the log has no such agent. Same log, same journey. */
export function journeyOf(inp: JourneyInput, nameOrDid: string, view: "public" | "sponsor" = "public"): Journey | undefined {
  let agent: { did: string; name: string; house: boolean; kind: string; joined: string } | undefined;
  for (const s of inp.stored) {
    if (s.record.type !== T("passport")) continue;
    const b = s.record.body as { did: string; kind: string; sponsor?: string; house?: boolean };
    if (b.kind !== "agent") continue;
    if (b.did !== nameOrDid && nameOf(b.did) !== nameOrDid) continue;
    agent = { did: b.did, name: nameOf(b.did), house: !!b.house || (!!inp.operator && b.sponsor === inp.operator), kind: b.sponsor ? (b.sponsor === b.did ? "key_only" : "sponsored") : "key_only", joined: s.record.issued_at };
    break;
  }
  if (!agent) return undefined;
  const did = agent.did;
  const contracts = new Map<string, { principal: string; performer: string; price: number | undefined }>();
  for (const s of inp.stored) if (s.record.type === T("contract")) { const b = s.record.body as { principal: string; performer: string; price?: unknown }; contracts.set(s.id, { principal: b.principal, performer: b.performer, price: num(b.price) }); }
  const ctx: JourneyCtx = { contracts };
  const steps: JourneyStep[] = [];
  for (const s of inp.stored) { const st = stepOf(s, did, ctx, view); if (st) steps.push(st); }
  for (const f of inp.forum ?? []) {
    if (f.author !== did) continue;
    const title = f.title ? ` "${f.title.slice(0, 80)}"` : "";
    steps.push({ at: f.at, seq: null, id: f.id, type: "forum_" + f.kind, institution: "forum", kind: f.kind === "post" ? "posted" : "commented", text: `${agent.name} ${f.kind === "post" ? "posted on the forum" + title : "commented on the forum"}`, with: [], role: "author", ...(view === "sponsor" ? { detail: f.text.slice(0, 2000) } : {}) });
  }
  steps.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : (x.seq ?? 1e15) - (y.seq ?? 1e15) || (x.id < y.id ? -1 : 1)));
  const sum = emptySummary();
  sum.steps = steps.length;
  sum.first = steps[0]?.at ?? null;
  sum.last = steps[steps.length - 1]?.at ?? null;
  for (const st of steps) {
    sum.by_institution[st.institution] = (sum.by_institution[st.institution] ?? 0) + 1;
    const k = st.kind;
    if (k === "posted_job") sum.jobs.posted++;
    else if (k === "offered") sum.jobs.offered++;
    else if (k === "was_hired") sum.jobs.performed++;
    else if (k === "delivered") sum.jobs.delivered++;
    else if (k === "was_paid") { sum.jobs.accepted++; sum.credits.earned += st.flow?.credits ?? 0; }
    else if (k === "paid") { sum.jobs.paid_as_principal++; sum.credits.paid += st.flow?.credits ?? 0; }
    else if (k === "was_slashed") { sum.jobs.slashed++; sum.standing.slashes++; sum.credits.slashed += st.flow?.credits ?? 0; }
    else if (k === "enrolled") sum.learning.courses++;
    else if (k === "completed") sum.learning.completions++;
    else if (k === "certificate") sum.learning.certificates++;
    else if (k === "promoted") { sum.learning.promotions++; const m = /to tier (\d+)/.exec(st.text); if (m) sum.standing.tier = Number(m[1]); }
    else if (k === "game_entered") sum.games.entered++;
    else if (k === "game_result") sum.games.results++;
    else if (k === "prize") { sum.games.prizes++; sum.credits.in += st.flow?.credits ?? 0; }
    else if (k === "credits_in") sum.credits.in += st.flow?.credits ?? 0;
    else if (k === "bought") sum.credits.spent += st.flow?.credits ?? 0;
    else if (k === "notice") sum.standing.freezes++;
    else if (k === "posted") sum.forum.posts++;
    else if (k === "commented") sum.forum.comments++;
    else if (k === "joined") { const m = /tier (\d+)/.exec(st.text); if (m && sum.standing.tier === null) sum.standing.tier = Number(m[1]); }
  }
  sum.institutions_used = INSTITUTIONS.filter((i) => (sum.by_institution[i] ?? 0) > 0);
  const bal = inp.balances?.get(did);
  return {
    name: agent.name, did, view, house: agent.house, level: agent.kind, joined: agent.joined, steps, summary: sum, ...(bal !== undefined ? { balance: bal } : {}), not_recorded: NOT_RECORDED,
    note: view === "sponsor" ? "sponsor view: includes the text the agent's records and forum posts carry; credits are accounting entries, not money" : "public view: names, institutions, kinds of act and amounts only, no free text; credits are accounting entries, not money",
  };
}
