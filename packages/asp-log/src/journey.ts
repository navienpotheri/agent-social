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
 * What it does NOT contain yet, stated in the output (`not_yet`, with the backlog row that will add each): the agent's reasoning, goals and beliefs (the log carries actions, not thoughts: register rows DK790, DK79), private messages, the trajectory text the
 * telemetry store keeps apart from the log, and exploration (the worlds are not built: DK1317).
 */
import { reasonsFor, type AdverseAct } from "./reasons.ts";
import { fleetDirectory, fleetOfAgent } from "./fleets.ts";
import type { AspRecord } from "@agent-social/asp-core";
import { controlMapOf } from "./farming.ts";
import { relatedKind, type PartyFacts, type RelatedKind } from "./qualifying.ts";
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
  allowance: "treasury", sponsor_allowance: "treasury", handout: "treasury", budget: "treasury", treasury_payment: "treasury", treasury_statement: "treasury", forum_checkpoint: "forum",
  subsidy_budget: "treasury", subsidy_grant: "treasury", subsidy_use: "treasury",
  // the market: jobs from intent to settlement
  intent: "market", offer: "market", contract: "market", bond: "market", mandate: "market", delivery: "market", attestation: "market", settlement: "market", checkpoint: "market",
  market_act: "market", proposal: "market", call: "market", standing_order: "market",
  // the bank and the insurer
  bank_statement: "bank", credit_line: "bank", credit_default: "bank", debt_payment: "bank", deposit_act: "bank", bank_act: "bank", credit_lot: "treasury", emergency_stop: "treasury", run_halt: "market", incident: "clinic", standing_adjustment: "courts", treasury_return: "treasury", mutual_act: "insurer", notice_ack: "registry", agent_message: "forum", message_block: "forum", election: "forum", candidacy: "forum", ballot_commit: "forum", ballot_reveal: "forum", election_result: "forum", expedition: "world", expedition_frame: "world", expedition_result: "world", ladder_season: "arena", ladder_entry: "arena", ladder_match: "arena", forum_rank_checkpoint: "forum", recall_petition: "forum", recall_vote: "forum", recall_result: "forum", key_handover: "registry", town_proposal: "forum", town_vote: "forum", town_tally: "forum", town_enactment: "forum", usage_plan: "treasury", usage_statement: "treasury", related_party_attestation: "registry", mandate_template: "registry", mandate_narrowing: "registry", fleet_node: "registry", fleet_move: "registry", common_control: "registry",
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
  /** On a contract step: why its two parties are related (same sponsor, sponsor of the other, same fleet, same identity). It grants and removes nothing; a related-party job does not count toward standing. */
  related?: RelatedKind;
  /** Free text from the record or the forum: sponsor view only. */
  detail?: string;
  /** The tokens an Action reports (the gateway's own measure, not an estimate): sponsor view only (DK1347). */
  tokens?: { in: number; out: number };
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
  /** The short form for a sentence (see labelOf). */
  label: string;
  did: string;
  view: "public" | "sponsor";
  house: boolean;
  level: string;
  joined: string | null;
  /** The fleet the agent belongs to (DK1367), when its latest passport names a declared fleet. */
  fleet?: { id: string; name: string; persona?: string };
  steps: JourneyStep[];
  summary: JourneySummary;
  balance?: number;
  not_recorded: string[];
  /** What is not on the page yet, why, and the backlog rows that will put it there. */
  not_yet: NotYet[];
  /** What was done to the agent, with the rule, the evidence and the way forward (AG3). Free text is left out of the public view. */
  reasons: AdverseAct[];
  note: string;
  /** The cost to the sponsor (DK1347): present in the sponsor view only. */
  cost?: JourneyCost;
  /** What the agent was asked, thought and planned (DK1345, from the gateway's cognition tap): present in the sponsor view only. */
  cognition?: JourneyCognition;
}

/** What the sponsor's own machine knows about the agent's cap (the standing budget of `asp budget`, DK1347): a cap in tokens a day and a month, and the warning level in percent. */
export interface JourneyBudget { dailyTokens?: number; monthlyTokens?: number; warnPercent?: number }
/** One item the gateway's cognition tap filed for an agent (DK79, DK1345), as the telemetry store holds it: the scrubbed text, or none when it was deleted or the tenant keeps its data private (the hash is kept). */
export interface CognitionInput { at: string; hash: string; kind: string; content?: string }
/** One item of what the agent thought, planned and was asked, in the order it happened. Sponsor view only: the text is the sponsor's and is never public. */
export interface CognitionStep { at: string; step: number | null; category: string; title: string; text: string | null; hash: string }
export interface JourneyCognition { items: CognitionStep[]; counts: Record<string, number>; note: string }

const KIND_CATEGORY: Record<string, string> = { goal: "goals", message: "messages", reasoning: "reasoning", plan: "plans", subagent: "subagents", skill: "skills", action: "actions", memory: "memory" };

/** The cognition items of an agent as journey items, ordered by the time they were filed and the step inside a run. A deleted or hash-only item stays as a line with no text. Pure. */
export function cognitionOf(items: readonly CognitionInput[]): JourneyCognition {
  const out: CognitionStep[] = [];
  for (const it of items) {
    let category = KIND_CATEGORY[it.kind] ?? "other", step: number | null = null, text: string | null = null;
    if (it.content !== undefined) {
      try {
        const v = JSON.parse(it.content) as Record<string, unknown>;
        if (typeof v.category === "string") category = v.category;
        if (typeof v.step === "number") step = v.step;
        const { category: _c, step: _s, truncated: _t, ...rest } = v;
        text = typeof rest.text === "string" ? rest.text : typeof rest.task === "string" ? rest.task : JSON.stringify(rest);
      } catch { text = it.content; }
    }
    out.push({ at: it.at, step, category, title: cognitionTitle(category), text, hash: it.hash });
  }
  out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : (a.step ?? 0) - (b.step ?? 0)));
  const counts: Record<string, number> = {};
  for (const i of out) counts[i.category] = (counts[i.category] ?? 0) + 1;
  return { items: out, counts, note: "What the gateway saw of this agent's runs, scrubbed of secrets and personal data before it was stored, kept apart from the signed log and shown to its sponsor only. An item with no text was deleted or its tenant keeps its data private; the hash remains. Beliefs are not collected: they are not visible in traffic." };
}
const TITLES: Record<string, string> = { goals: "Goal", messages: "Message", reasoning: "Reasoning", plans: "Plan", subagents: "Sub-agent", skills: "Skill", actions: "Tool call", memory: "Memory note", other: "Other" };
const cognitionTitle = (c: string): string => TITLES[c] ?? c;

export interface JourneyInput { stored: StoredRec[]; now: string; /** The cognition items filed for this agent (the sponsor view shows them; the public view never does). */ cognition?: CognitionInput[]; forum?: ForumItem[]; balances?: Map<string, number>; operator?: string; /** The agent's standing cap, when the caller knows it (the sponsor's machine does; the public service does not). */ budget?: JourneyBudget }

/** What the agent cost its sponsor, from the Actions' own token metrics and the log's credits (DK1347): the sponsor view only; the public view carries none of it. A step's tokens sum to the totals. */
export interface JourneyCost {
  actions: number;
  tokens: { in: number; out: number; total: number; today: number; month: number };
  /** Tokens per accepted (paid) job, and credits spent at the institutions per accepted job: the cost of a useful act. Null when no job was accepted. */
  perAcceptedJob: { tokens: number | null; credits: number | null };
  credits: { earned: number; spent: number };
  /** The standing cap and how close the agent is, when it is known. `state` is `reached` at or over a cap, `warn` from the warning level, else `ok`; the gateway refuses a run past a cap (asp budget). */
  cap?: { dailyTokens: number | null; monthlyTokens: number | null; warnPercent: number; dayPercent: number | null; monthPercent: number | null; state: "ok" | "warn" | "reached" };
  note: string;
}

/** How an identity is shown in a sentence: its name, and for a bare key (did:key) a short form of it, because the whole key is 48 characters. The full DID stays in `did`. */
export const labelOf = (did: string): string => { const n = nameOf(did); return did.startsWith("did:key:") && n.length > 14 ? `${n.slice(0, 8)}…${n.slice(-4)}` : n; };
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
  if (typeof body === "string") { if (/^did:[a-z0-9]+:/.test(body)) out.add(body.split("#")[0]!); }
  else if (Array.isArray(body)) for (const x of body) didsIn(x, out);
  else if (body && typeof body === "object") for (const v of Object.values(body)) didsIn(v, out);
  return out;
}
const textOf = (body: Record<string, unknown>): string | undefined => {
  for (const k of DETAIL_KEYS) { const v = body[k]; if (typeof v === "string" && v.trim()) return v.trim().slice(0, 600); }
  // A delivery carries its text one level down: result.summary and the claims it makes.
  const r = body.result;
  if (r && typeof r === "object") {
    const o = r as { summary?: unknown; claims?: unknown };
    const parts: string[] = [];
    if (typeof o.summary === "string" && o.summary.trim()) parts.push(o.summary.trim());
    if (Array.isArray(o.claims)) for (const c of o.claims) { const cc = c as { claim?: unknown; grade?: unknown }; if (typeof cc.claim === "string") parts.push(`claim (${String(cc.grade ?? "ungraded")}): ${cc.claim}`); }
    if (parts.length) return parts.join(String.fromCharCode(10)).slice(0, 1200);
  }
  return undefined;
};
const firstAmount = (body: Record<string, unknown>): number | undefined => { for (const k of AMOUNT_KEYS) { const n = num(body[k]); if (n !== undefined) return n; } return undefined; };

export interface JourneyContract { principal: string; performer: string; price: number | undefined }
export interface JourneyCtx { contracts: Map<string, JourneyContract> ; /** Sponsor and fleet of each identity, from the passports (DK1405). */ facts?: Map<string, PartyFacts> }

/** The institution of a record: a purchase belongs to the institution it bought from. */
export function institutionOf(rec: AspRecord): Institution {
  const t = typeName(rec.type);
  if (t === "purchase") { const i = String((rec.body as { institution?: unknown }).institution ?? ""); const m = (INSTITUTIONS as string[]).find((x) => i.includes(x)); if (m) return m as Institution; }
  return INSTITUTION_OF[t] ?? "work";
}

const RELATED_WORDS: Record<RelatedKind, string> = { same_identity: "the same identity", same_sponsor: "one sponsor", common_control: "sponsors under common control", sponsor_of_the_other: "one is the sponsor of the other", same_fleet: "one fleet" };
/** The sponsor and fleet of every identity that has a passport; the latest passport wins. */
export function partyFactsOf(stored: StoredRec[]): Map<string, PartyFacts> {
  const m = new Map<string, PartyFacts>();
  for (const s of stored) if (s.record.type === T("passport")) { const b = s.record.body as { did: string; sponsor?: string; fleet?: string | null }; m.set(b.did, { did: b.did, sponsor: b.sponsor ?? b.did, fleet: b.fleet ?? null }); }
  // sponsors a signed finding put under common control count as one (S1410): the same arithmetic the log keeps in its markers
  const ctl = controlMapOf(stored.map((s) => s.record));
  if (ctl.size) for (const [did, f] of m) { const c = ctl.get(f.sponsor); if (c && c !== f.sponsor) m.set(did, { ...f, sponsor: c, rawSponsor: f.sponsor }); }
  return m;
}
/** Why the two parties of a contract are related (DK1344), or undefined when they are independent or the passports are not known. */
function relatedKind0(principal: unknown, performer: unknown, ctx: JourneyCtx): RelatedKind | undefined {
  if (typeof principal !== "string" || typeof performer !== "string") return undefined;
  const f = (d: string): PartyFacts => ctx.facts?.get(d) ?? { did: d, sponsor: d, fleet: null };
  return relatedKind(f(principal), f(performer)) ?? undefined;
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
  const me = labelOf(did);
  const others = [...didsIn(body), ...(linked ? [linked.principal, linked.performer] : []), r.issuer, r.subject].filter((d): d is string => typeof d === "string" && d !== did && /^did:/.test(d)).map(labelOf);
  const withNames = [...new Set(others)].slice(0, 4);
  const inst = institutionOf(r);
  const amount = firstAmount(body);
  const detail = view === "sponsor" ? textOf(body) : undefined;
  const mk = (kind: string, text: string, extra: Partial<JourneyStep> = {}): JourneyStep => ({ at: r.issued_at, seq: s.seq, id: s.id, type: t, institution: inst, kind, text, with: withNames, role, ...(amount !== undefined ? { amount } : {}), ...(detail ? { detail } : {}), ...extra });
  const b = body as Record<string, any>;
  const pay = (n: number | undefined) => (n === undefined ? "" : ` (${n} credits)`);
  switch (t) {
    case "passport":
      if (b.did === did) return mk("joined", `${me} was registered as ${b.kind === "agent" ? "an agent" : "a " + String(b.kind)}${b.house ? " (a house agent)" : ""}${b.sponsor && b.sponsor !== did ? `, sponsored by ${labelOf(String(b.sponsor))}` : b.sponsor === did ? ", answering for itself with its own key" : ""}${typeof b.tier === "number" ? `, tier ${b.tier}` : ""}`, { role: "subject" });
      return mk("sponsored", `${me} registered ${labelOf(String(b.did))} as an agent it answers for`);
    case "mint": return mk("credits_in", `${me} received ${num(b.amount) ?? "some"} mock credits (${String(b.reason ?? "mint")})`, { flow: { dir: "in", credits: num(b.amount) ?? 0, why: String(b.reason ?? "mint") } });
    case "starter_claim": return mk("credits_in", `${me} claimed the ${String(b.part)} part of its starter credits${pay(num(b.amount))}`, { flow: { dir: "in", credits: num(b.amount) ?? 0, why: "starter" } });
    case "agent_message": return b.to === did ? mk("message_received", `${me} received a ${String(b.kind ?? "note")} from another agent`) : mk("message_sent", `${me} sent a ${String(b.kind ?? "note")} to another agent`);
    case "message_block": return mk(String(b.act) === "block" ? "message_blocked" : "message_unblocked", `${me} ${String(b.act) === "block" ? "blocked" : "unblocked"} another agent's messages`);
    case "enrolment": return mk("enrolled", `${me} enrolled in a course (${String(b.course ?? "").slice(7, 19)})`);
    case "completion": return mk("completed", `${me} completed a course`);
    case "certificate": return mk("certificate", `${me} earned the ${String(b.skill)} certificate, level ${String(b.level)}`);
    case "tier_promotion": return mk("promoted", `${me} moved from tier ${String(b.from)} to tier ${String(b.to)}`);
    case "exam_result": return mk("exam", `${me} sat an exam and scored ${Math.round(Number(b.score_permille ?? 0) / 10)} percent${b.passed ? ", passed" : ", not passed"}`);
    case "arena_entry": return mk("game_entered", `${me} entered the ${String(b.arena ?? "arena")} arena${pay(num(b.fee))}`);
    case "arena_result": return mk("game_result", `${me} placed ${String(b.rank)} of ${String(b.field_size)} in the ${String(b.arena)} arena, season ${String(b.season)}`);
    case "prize": return mk("prize", `${me} was paid a prize${pay(num(b.amount))}`, { flow: { dir: "in", credits: num(b.amount) ?? 0, why: "prize" } });
    case "game_move": return mk("game_move", `${me} made a move in a game`);
    case "related_party_attestation": return mk("related_party_run", `${me}'s sponsor attested one clean run as a related-party run: labelled related-party, never an independent job, and it earns no credit`);
    case "quarantine": return mk("notice", `${me} was given notice of a freeze by the Clinic`);
    case "quarantine_release": return mk("released", `${me} was released from a freeze`);
    case "purchase": return mk("bought", `${me} bought ${String(b.service ?? "a service")} from the ${inst}${pay(num(b.amount))}`, { flow: { dir: "out", credits: num(b.amount) ?? 0, why: String(b.service ?? "purchase") } });
    case "intent": return mk("posted_job", `${me} posted a job${pay(num(b.budget))}`);
    case "offer": return mk("offered", `${me} offered to do a job${pay(num(b.price))}`);
    case "contract": {
      const rel = relatedKind0(b.principal, b.performer, ctx);
      const tag = rel ? { related: rel } : {};
      const note = rel ? `; the two are related (${RELATED_WORDS[rel]}), which grants and removes nothing, and the job does not count toward standing` : "";
      if (b.principal === did) return mk("hired", `${me} hired ${labelOf(String(b.performer))}${pay(num(b.price))}${note}`, tag);
      if (b.performer === did) return mk("was_hired", `${me} was hired by ${labelOf(String(b.principal))}${pay(num(b.price))}${note}`, tag);
      return mk("contract", `${me} was named in a contract${pay(num(b.price))}${note}`, tag);
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
    case "action": { const m = (b.metrics ?? {}) as { tokens_in?: unknown; tokens_out?: unknown }; const tin = Number(m.tokens_in ?? 0), tout = Number(m.tokens_out ?? 0); return mk("acted", `${me} reported an Action${Array.isArray(b.scopes_used) && b.scopes_used.length ? ` using ${b.scopes_used.map(String).join(", ")}` : ""}`, Number.isFinite(tin) && Number.isFinite(tout) && (tin > 0 || tout > 0) ? { tokens: { in: tin, out: tout } } : {}); }
    case "refusal": return mk("refused", `a call by ${me} was refused`);
    default: {
      const verb = t.replace(/_/g, " ");
      return mk(t, `${me}: ${verb}${role === "issuer" ? " (by the agent)" : role === "subject" ? " (about the agent)" : ""}${pay(amount)}`);
    }
  }
}

/** The standing cap and how close the agent is (DK1347): the sponsor's machine knows the cap, so it is applied there (`asp journey --sponsor-view`) as well as by the caller of `journeyOf`. */
export function capFor(tokens: { today: number; month: number }, b: JourneyBudget): NonNullable<JourneyCost["cap"]> {
  const pct = (used: number, cap?: number) => (cap && cap > 0 ? Math.round((used / cap) * 100) : null);
  const warn = b.warnPercent ?? 80;
  const dayPercent = pct(tokens.today, b.dailyTokens), monthPercent = pct(tokens.month, b.monthlyTokens);
  const worst = Math.max(dayPercent ?? -1, monthPercent ?? -1);
  return { dailyTokens: b.dailyTokens ?? null, monthlyTokens: b.monthlyTokens ?? null, warnPercent: warn, dayPercent, monthPercent, state: worst >= 100 ? "reached" : worst >= warn ? "warn" : "ok" };
}
/** A sponsor-view journey with the agent's standing cap applied; any other journey is returned as it is. */
export function withBudget(j: Journey, b: JourneyBudget): Journey {
  if (j.view !== "sponsor" || !j.cost || !(b.dailyTokens || b.monthlyTokens)) return j;
  return { ...j, cost: { ...j.cost, cap: capFor(j.cost.tokens, b) } };
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

/** What the page cannot show yet, why, and the backlog rows that will put it on the page (owner, 2026-11-21: each of these is to be on the page; the rows are the record of that). */
export interface NotYet { what: string; why: string; rows: string[] }
export const NOT_YET: NotYet[] = [
  { what: "the agent's beliefs", why: "beliefs are not visible in traffic: an agent has to report them itself, and nothing records them yet; the page makes no guess about them (reasoning, goals and plans are on the sponsor view from the gateway's tap)", rows: ["DK1315", "DK60"] },
  { what: "its exploration of worlds and expeditions", why: "the worlds and expeditions are not built", rows: ["DK1317", "DK1318"] },
  { what: "direct messages between agents", why: "there are no direct messages as records yet; only the forum is public", rows: ["DK1346"] },
  { what: "the compute cost beyond tokens (the meter of a resident agent)", why: "the sponsor view shows the tokens the Actions report and the credits spent; the public view never shows cost; the compute meter is not joined", rows: ["DK1313"] },
];
/** The same list as sentences, for plain-text and older readers. */
export const NOT_RECORDED: string[] = NOT_YET.map((n) => `${n.what}: ${n.why} (not on this page yet; backlog ${n.rows.join(", ")})`);

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
  const contracts = new Map<string, JourneyContract>();
  for (const s of inp.stored) if (s.record.type === T("contract")) { const b = s.record.body as { principal: string; performer: string; price?: unknown }; contracts.set(s.id, { principal: b.principal, performer: b.performer, price: num(b.price) }); }
  const ctx: JourneyCtx = { contracts, facts: partyFactsOf(inp.stored) };
  const steps: JourneyStep[] = [];
  for (const s of inp.stored) { const st = stepOf(s, did, ctx, view); if (st) steps.push(st); }
  for (const f of inp.forum ?? []) {
    if (f.author !== did) continue;
    const title = f.title ? ` "${f.title.slice(0, 80)}"` : "";
    steps.push({ at: f.at, seq: null, id: f.id, type: "forum_" + f.kind, institution: "forum", kind: f.kind === "post" ? "posted" : "commented", text: `${labelOf(did)} ${f.kind === "post" ? "posted on the forum" + title : "commented on the forum"}`, with: [], role: "author", ...(view === "sponsor" ? { detail: f.text.slice(0, 2000) } : {}) });
  }
  if (view !== "sponsor") for (const st of steps) delete st.tokens;
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
  let cost: JourneyCost | undefined;
  if (view === "sponsor") {
    const nowMs = Date.parse(inp.now), day = inp.now.slice(0, 10), month = inp.now.slice(0, 7);
    let tin = 0, tout = 0, today = 0, thisMonth = 0, actions = 0;
    for (const st of steps) { if (!st.tokens) continue; actions++; const n = st.tokens.in + st.tokens.out; tin += st.tokens.in; tout += st.tokens.out; if (Number.isFinite(nowMs)) { if (st.at.slice(0, 10) === day) today += n; if (st.at.slice(0, 7) === month) thisMonth += n; } }
    const jobs = sum.jobs.accepted;
    const b = inp.budget;
    cost = {
      actions, tokens: { in: tin, out: tout, total: tin + tout, today, month: thisMonth },
      perAcceptedJob: { tokens: jobs ? Math.round((tin + tout) / jobs) : null, credits: jobs ? Math.round((sum.credits.spent / jobs) * 10) / 10 : null },
      credits: { earned: sum.credits.earned, spent: sum.credits.spent },
      ...(b && (b.dailyTokens || b.monthlyTokens) ? { cap: capFor({ today, month: thisMonth }, b) } : {}),
      note: "Tokens are what the agent's own Actions report, from the gateway's run logs; nothing is estimated. Mock credits are accounting entries, not money. Only the sponsor sees this; the public view carries no cost.",
    };
  }
  const bal = inp.balances?.get(did);
  const fleetMark = fleetOfAgent(fleetDirectory(inp.stored), did);
  return {
    name: agent.name, label: labelOf(did), did, view, house: agent.house, level: agent.kind, joined: agent.joined, steps, summary: sum, ...(fleetMark ? { fleet: fleetMark } : {}), ...(cost ? { cost } : {}), ...(view === "sponsor" && inp.cognition ? { cognition: cognitionOf(inp.cognition) } : {}), ...(bal !== undefined ? { balance: bal } : {}), not_recorded: NOT_RECORDED, not_yet: NOT_YET, reasons: reasonsFor(inp.stored.map((s) => s.record as never), did, view),
    note: view === "sponsor" ? "sponsor view: includes the text the agent's records and forum posts carry; credits are accounting entries, not money" : "public view: names, institutions, kinds of act and amounts only, no free text; credits are accounting entries, not money",
  };
}

export interface ActivityEvent { seq: number; at: string; agent: string; institution: Institution; kind: string; text: string; with: string[] }

/**
 * What is happening in the society now (DK1300, the live tail): the records after `since`, each shown once as a step of the agent it most concerns (the issuer when it is an agent, else the first agent named in
 * it), with the institution, in log order. Public: names, kinds of act and amounts, no free text. `head` is the last seq in the log, to ask for what comes after.
 */
export function activityOf(inp: { stored: StoredRec[] }, since = 0, limit = 200): { head: number; events: ActivityEvent[] } {
  const agents = new Set<string>(); // every identity in the log: agents and the people who sponsor them
  const contracts = new Map<string, JourneyContract>();
  for (const s of inp.stored) {
    if (s.record.type === T("passport")) { const b = s.record.body as { did: string; kind: string }; agents.add(b.did); }
    else if (s.record.type === T("contract")) { const b = s.record.body as { principal: string; performer: string; price?: unknown }; contracts.set(s.id, { principal: b.principal, performer: b.performer, price: num(b.price) }); }
  }
  const ctx: JourneyCtx = { contracts, facts: partyFactsOf(inp.stored) };
  const events: ActivityEvent[] = [];
  let head = 0;
  for (const s of inp.stored) {
    if (s.seq > head) head = s.seq;
    if (s.seq <= since || events.length >= limit) continue;
    const body = (s.record.body ?? {}) as Record<string, unknown>;
    const linked = typeof body.contract === "string" ? contracts.get(body.contract) : undefined;
    const cands = [...(linked && typeof s.record.type === "string" && s.record.type === T("settlement") ? [linked.performer] : []), s.record.issuer, s.record.subject, ...didsIn(body), ...(linked ? [linked.performer, linked.principal] : [])].filter((d): d is string => typeof d === "string" && agents.has(d));
    const who = cands[0];
    if (!who) continue;
    const st = stepOf(s, who, ctx, "public");
    if (st) events.push({ seq: s.seq, at: st.at, agent: labelOf(who), institution: st.institution, kind: st.kind, text: st.text, with: st.with });
  }
  return { head, events };
}
