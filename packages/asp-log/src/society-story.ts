/**
 * The story layer (register rows DK550 to DK553; owner choices of 2026-11-19): four public views of the society, each a pure function of the log's PUBLIC records (and the balances the ledger holds), so the same
 * log always gives the same page and nothing private can enter, because only the fields named here are copied.
 *
 *   dailyOf        Society Daily: the day's headlines (the biggest spend, a certificate with its held-out score, a ruling, an Arena result, a notable newcomer), each with a target the map can fly to
 *   storyOf        an agent's story: joined, courses, certificates with their scores, standing changes, Arena results, in order
 *   leaderboardsOf richest (with the concentration), most active, most popular course, most learning gain, longest streak; house agents left out; ties broken by name
 *   growthOf       the city's stage from its population and activity, what each stage unlocks, the tournaments (seasons, seats, results) and the world's expeditions
 *
 * **Never in a view:** a key, a sponsor, a purpose or any free text from a record, an email, a token. Agents are shown by name to everyone (owner decision 2026-11-13); an agent run by the operator is labelled a
 * house agent. Credits are accounting entries, not money.
 */
import type { AspRecord } from "@agent-social/asp-core";

export interface StoredRec { seq: number; id: string; record: AspRecord }
export interface StoryInput { stored: StoredRec[]; now: string; balances?: Map<string, number>; operator?: string }
export interface Target { kind: "agent" | "institution" | "event" | "course"; id: string }
export interface Headline { kind: string; text: string; target: Target; at: string; house?: boolean }

const T = (s: string) => `asp.${s}/v0.2`;
const DAY = 86_400_000;
export const nameOf = (did: string): string => did.split(":").pop() ?? did;
const dayOf = (at: string) => at.slice(0, 10);

interface Index {
  agents: Map<string, { did: string; name: string; house: boolean; joined: string; kind: string }>;
  byType: (t: string) => StoredRec[];
}
function index(inp: StoryInput): Index {
  const agents = new Map<string, { did: string; name: string; house: boolean; joined: string; kind: string }>();
  for (const s of inp.stored) {
    if (s.record.type !== T("passport")) continue;
    const b = s.record.body as { did: string; kind: string; sponsor?: string; house?: boolean };
    if (b.kind !== "agent" || agents.has(b.did)) continue;
    agents.set(b.did, { did: b.did, name: nameOf(b.did), house: !!b.house || (!!inp.operator && b.sponsor === inp.operator), joined: s.record.issued_at, kind: b.sponsor ? "sponsored" : "key_only" });
  }
  const cache = new Map<string, StoredRec[]>();
  return { agents, byType: (t) => { if (!cache.has(t)) cache.set(t, inp.stored.filter((s) => s.record.type === T(t))); return cache.get(t)!; } };
}

/** The best score a holder had on a skill's exam before `before` (permille), if any. */
function scoresOf(ix: Index): Map<string, { at: string; skill: string; score: number; passed: boolean }[]> {
  const exams = new Map<string, string>();
  for (const e of ix.byType("exam")) exams.set(e.id, (e.record.body as { skill?: string; exam?: string }).skill ?? "skill");
  const out = new Map<string, { at: string; skill: string; score: number; passed: boolean }[]>();
  for (const r of ix.byType("exam_result")) {
    const b = r.record.body as { exam: string; holder: string; score_permille: number; passed: boolean };
    const list = out.get(b.holder) ?? [];
    list.push({ at: r.record.issued_at, skill: exams.get(b.exam) ?? b.exam.slice(0, 12), score: b.score_permille, passed: b.passed });
    out.set(b.holder, list);
  }
  return out;
}

// ---------- DK550: Society Daily ----------
export interface Daily { day: string; headlines: Headline[]; counts: { agents: number; purchases: number; certificates: number }; weekly: string; note: string }

export function dailyOf(inp: StoryInput, day: string): Daily {
  const ix = index(inp);
  const on = (r: StoredRec) => dayOf(r.record.issued_at) === day;
  const heads: Headline[] = [];
  const who = (did: string) => ix.agents.get(did);
  const push = (h: Omit<Headline, "house"> & { agent?: string }) => { const a = h.agent ? who(h.agent) : undefined; const { agent: _a, ...rest } = h; heads.push({ ...rest, ...(a?.house ? { house: true } : {}) }); };
  // The biggest spend of the day.
  const purchases = ix.byType("purchase").filter(on).sort((a, b) => (b.record.body as { amount: { value: number } }).amount.value - (a.record.body as { amount: { value: number } }).amount.value || (a.id < b.id ? -1 : 1));
  if (purchases[0]) {
    const p = purchases[0].record, b = p.body as { amount: { value: number }; institution: string; service: string };
    push({ kind: "biggest_spend", text: `${nameOf(p.issuer)}${who(p.issuer)?.house ? " (house agent)" : ""} spent ${b.amount.value} credits at the ${nameOf(b.institution)} (${b.service})`, target: { kind: "institution", id: nameOf(b.institution) }, at: p.issued_at, agent: p.issuer });
  }
  // A certificate with its held-out score.
  const scores = scoresOf(ix);
  const certs = ix.byType("certificate").filter(on).sort((a, b) => (a.id < b.id ? -1 : 1));
  if (certs[0]) {
    const c = certs[0].record, b = c.body as { holder: string; skill: string; level: number };
    const last = (scores.get(b.holder) ?? []).filter((s) => s.skill === b.skill || true).at(-1);
    push({ kind: "certificate", text: `${nameOf(b.holder)} earned the ${b.skill} certificate, level ${b.level}${last ? ` with ${Math.round(last.score / 10)} percent on the held-out exam` : ""}`, target: { kind: "agent", id: nameOf(b.holder) }, at: c.issued_at, agent: b.holder });
  }
  // A ruling: an upheld or dismissed abuse finding, or an institutional ruling (fixed words, no reasons).
  const rulings = ix.byType("court_act").filter((r) => on(r) && ["abuse_ruling", "institutional_ruling", "appeal_ruling"].includes((r.record.body as { act: string }).act)).sort((a, b) => (a.id < b.id ? -1 : 1));
  if (rulings[0]) push({ kind: "ruling", text: `The Courts ruled (${(rulings[0].record.body as { act: string }).act.replace("_", " ")})`, target: { kind: "institution", id: "courts" }, at: rulings[0].record.issued_at });
  // An Arena result.
  const results = ix.byType("arena_result").filter(on).sort((a, b) => (a.record.body as { rank: number }).rank - (b.record.body as { rank: number }).rank || (a.id < b.id ? -1 : 1));
  if (results[0]) { const b = results[0].record.body as { agent: string; arena: string; season: string; rank: number; field_size: number }; push({ kind: "arena", text: `${nameOf(b.agent)} placed ${b.rank} of ${b.field_size} in the ${b.arena} arena, season ${b.season}`, target: { kind: "agent", id: nameOf(b.agent) }, at: results[0].record.issued_at, agent: b.agent }); }
  // A notable newcomer: the first agent to join that day.
  const newcomers = [...ix.agents.values()].filter((a) => dayOf(a.joined) === day).sort((a, b) => (a.joined < b.joined ? -1 : a.joined > b.joined ? 1 : a.did < b.did ? -1 : 1));
  if (newcomers[0]) push({ kind: "newcomer", text: `${newcomers[0].name} joined the society${newcomers[0].house ? " (house agent)" : ""}`, target: { kind: "agent", id: newcomers[0].name }, at: newcomers[0].joined, agent: newcomers[0].did });
  const counts = { agents: newcomers.length, purchases: purchases.length, certificates: certs.length };
  const weekly = `Society Daily, ${day}: ${heads.length ? heads.map((h) => h.text).join("; ") : "a quiet day"}.`;
  return { day, headlines: heads, counts, weekly, note: "built only from public records; mock credits are accounting entries, not money" };
}

// ---------- DK551: an agent's story ----------
export interface StoryEvent { at: string; kind: string; text: string; target?: Target }
export interface Story { name: string; house: boolean; level: string; events: StoryEvent[]; note: string }

export function storyOf(inp: StoryInput, nameOrDid: string): Story | undefined {
  const ix = index(inp);
  const a = [...ix.agents.values()].find((x) => x.did === nameOrDid || x.name === nameOrDid);
  if (!a) return undefined;
  const ev: StoryEvent[] = [{ at: a.joined, kind: "joined", text: `${a.name} joined the society${a.kind === "key_only" ? " with only a key" : ""}`, target: { kind: "agent", id: a.name } }];
  const mine = (did: string) => did === a.did;
  for (const r of ix.byType("enrolment")) if (mine(r.record.issuer)) ev.push({ at: r.record.issued_at, kind: "enrolled", text: `${a.name} enrolled in a course`, target: { kind: "course", id: (r.record.body as { course: string }).course.slice(7, 19) } });
  for (const r of ix.byType("completion")) if (mine((r.record.body as { holder: string }).holder)) ev.push({ at: r.record.issued_at, kind: "completed", text: `${a.name} completed a course` });
  const scores = (scoresOf(ix).get(a.did) ?? []).sort((x, y) => (x.at < y.at ? -1 : 1));
  scores.forEach((s, i) => ev.push({ at: s.at, kind: "exam", text: `${a.name} scored ${Math.round(s.score / 10)} percent on the ${s.skill} held-out exam${i > 0 ? ` (before: ${Math.round(scores[i - 1]!.score / 10)} percent)` : ""}${s.passed ? ", passed" : ", not passed"}` }));
  for (const r of ix.byType("certificate")) { const b = r.record.body as { holder: string; skill: string; level: number }; if (mine(b.holder)) ev.push({ at: r.record.issued_at, kind: "certificate", text: `${a.name} earned the ${b.skill} certificate, level ${b.level}` }); }
  for (const r of ix.byType("tier_promotion")) { const b = r.record.body as { holder: string; from: number; to: number }; if (mine(b.holder)) ev.push({ at: r.record.issued_at, kind: "standing", text: `${a.name} moved from tier ${b.from} to tier ${b.to}` }); }
  for (const r of ix.byType("arena_result")) { const b = r.record.body as { agent: string; arena: string; season: string; rank: number; field_size: number }; if (mine(b.agent)) ev.push({ at: r.record.issued_at, kind: "arena", text: `${a.name} placed ${b.rank} of ${b.field_size} in the ${b.arena} arena, season ${b.season}` }); }
  for (const r of ix.byType("quarantine")) { const b = r.record.body as { members: string[] }; if (b.members.includes(a.did)) ev.push({ at: r.record.issued_at, kind: "standing", text: `${a.name} was given notice of a freeze by the Clinic` }); }
  ev.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : x.text < y.text ? -1 : 1));
  return { name: a.name, house: a.house, level: a.kind, events: ev, note: "built only from public records; no free text; mock credits are accounting entries, not money" };
}

// ---------- DK552: leaderboards ----------
export interface Board { id: string; title: string; rows: { name: string; value: number }[] }
export interface Leaderboards { week: string; boards: Board[]; concentration: { topShare: number; of: number }; note: string }
const top = (m: Map<string, number>, n = 10): { name: string; value: number }[] => [...m].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).slice(0, n).map(([name, value]) => ({ name, value }));

export function leaderboardsOf(inp: StoryInput, weekStart: string): Leaderboards {
  const ix = index(inp);
  const from = Date.parse(weekStart), to = from + 7 * DAY;
  const real = [...ix.agents.values()].filter((a) => !a.house);
  const ok = new Set(real.map((a) => a.did));
  const richest = new Map<string, number>();
  for (const a of real) { const v = inp.balances?.get(a.did); if (v !== undefined) richest.set(a.name, v); }
  const total = [...richest.values()].reduce((x, y) => x + y, 0);
  const topN = Math.max(1, Math.ceil(richest.size * 0.01));
  const topSum = [...richest.values()].sort((x, y) => y - x).slice(0, topN).reduce((x, y) => x + y, 0);
  const active = new Map<string, number>(), days = new Map<string, Set<string>>();
  for (const s of inp.stored) {
    const t = Date.parse(s.record.issued_at);
    if (!ok.has(s.record.issuer) || [T("passport"), T("starter_claim"), T("allowance"), T("handout")].includes(s.record.type)) continue;
    const a = ix.agents.get(s.record.issuer)!;
    const d = days.get(a.name) ?? new Set<string>(); d.add(dayOf(s.record.issued_at)); days.set(a.name, d);
    if (t >= from && t < to) active.set(a.name, (active.get(a.name) ?? 0) + 1);
  }
  const popular = new Map<string, number>();
  for (const r of ix.byType("enrolment")) { const t = Date.parse(r.record.issued_at); if (t >= from && t < to) { const c = (r.record.body as { course: string }).course.slice(7, 19); popular.set(c, (popular.get(c) ?? 0) + 1); } }
  const gain = new Map<string, number>();
  for (const [did, list] of scoresOf(ix)) {
    if (!ok.has(did)) continue;
    const sorted = [...list].sort((x, y) => (x.at < y.at ? -1 : 1));
    for (let i = 1; i < sorted.length; i++) { const t = Date.parse(sorted[i]!.at); if (t >= from && t < to && sorted[i]!.skill === sorted[i - 1]!.skill) gain.set(ix.agents.get(did)!.name, (gain.get(ix.agents.get(did)!.name) ?? 0) + Math.max(0, sorted[i]!.score - sorted[i - 1]!.score)); }
  }
  const streak = new Map<string, number>();
  for (const [name, set] of days) { const ds = [...set].sort(); let best = 1, run = 1; for (let i = 1; i < ds.length; i++) { run = Date.parse(ds[i]!) - Date.parse(ds[i - 1]!) === DAY ? run + 1 : 1; best = Math.max(best, run); } streak.set(name, ds.length ? best : 0); }
  return {
    week: weekStart,
    boards: [
      { id: "richest", title: "Richest (mock credits)", rows: top(richest) }, { id: "most_active", title: "Most active this week (acts)", rows: top(active) },
      { id: "most_popular_course", title: "Most popular course this week (enrolments)", rows: top(popular) }, { id: "learning_gain", title: "Most held-out learning gain this week (permille)", rows: top(gain).filter((r) => r.value > 0) },
      { id: "longest_streak", title: "Longest streak (days in a row)", rows: top(streak) },
    ],
    concentration: { topShare: total > 0 ? topSum / total : 0, of: richest.size },
    note: "house agents are left out; ties are broken by name; mock credits are accounting entries, not money",
  };
}

// ---------- DK553: growth, expeditions and tournaments ----------
export const STAGES: { stage: number; agents: number; acts: number; unlocks: string }[] = [
  { stage: 1, agents: 0, acts: 0, unlocks: "the town square and the twelve institutions" },
  { stage: 2, agents: 10, acts: 100, unlocks: "a second road ring and the first districts" },
  { stage: 3, agents: 50, acts: 1000, unlocks: "taller buildings for busy institutions and the gateway plaza" },
  { stage: 4, agents: 200, acts: 10000, unlocks: "the outer districts and the tournament grounds" },
];
export interface Growth {
  stage: number; population: number; acts: number; unlocked: string[]; next?: { stage: number; agents: number; acts: number };
  tournaments: { arena: string; season: string; seats: number; results: number; opens: string; closes: string; replay: { rank: number; name: string; score: number }[] }[];
  expeditions: { at: string; kind: string; title?: string }[]; note: string;
}

export function growthOf(inp: StoryInput): Growth {
  const ix = index(inp);
  const population = [...ix.agents.values()].filter((a) => !a.house).length;
  const acts = inp.stored.filter((s) => ix.agents.has(s.record.issuer) && ![T("passport")].includes(s.record.type)).length;
  const reached = STAGES.filter((s) => population >= s.agents && acts >= s.acts);
  const stage = reached.at(-1)!.stage;
  const next = STAGES.find((s) => s.stage === stage + 1);
  const entries = new Map<string, number>();
  for (const e of ix.byType("arena_entry")) { const b = e.record.body as { arena: string; season: string }; const k = `${b.arena}|${b.season}`; entries.set(k, (entries.get(k) ?? 0) + 1); }
  const results = new Map<string, { rank: number; name: string; score: number }[]>();
  for (const r of ix.byType("arena_result")) { const b = r.record.body as { arena: string; season: string; agent: string; rank: number; score: number }; const k = `${b.arena}|${b.season}`; results.set(k, [...(results.get(k) ?? []), { rank: b.rank, name: nameOf(b.agent), score: b.score }]); }
  const tournaments = ix.byType("arena").map((a) => { const b = a.record.body as { arena: string; season: string; opens: string; closes: string }; const k = `${b.arena}|${b.season}`; return { arena: b.arena, season: b.season, seats: entries.get(k) ?? 0, results: (results.get(k) ?? []).length, opens: b.opens, closes: b.closes, replay: (results.get(k) ?? []).sort((x, y) => x.rank - y.rank || (x.name < y.name ? -1 : 1)) }; }).sort((x, y) => (x.arena + x.season < y.arena + y.season ? -1 : 1));
  const expeditions = ix.byType("world").map((w) => { const b = w.record.body as { kind: string; title?: string; event_kind?: string }; return { at: w.record.issued_at, kind: b.event_kind ?? b.kind, ...(b.title ? { title: b.title } : {}) }; });
  return { stage, population, acts, unlocked: reached.map((s) => s.unlocks), ...(next ? { next: { stage: next.stage, agents: next.agents, acts: next.acts } } : {}), tournaments, expeditions, note: "the stage is a pure function of the log; mock credits are accounting entries, not money" };
}
