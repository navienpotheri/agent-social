/**
 * The paper-specific probes of the lead's specification (docs/probe-specs.md, row ENG130): P1 calibration, P2 verification, P3 memory operations. Each is a deterministic task generator over INVENTED entities (a model's prior knowledge cannot answer them) with a
 * RULE-BASED scorer (never a model judge), a guard against a degenerate answer and a construct note. The agent is shown the items of a seed and answers in JSON; fresh seeds give fresh items. They are used by `asp academy card-effect`
 * (control, placebo and treatment arms): the probe is the outcome measure. NOT built here: the Academy's two-phase sitting that would show the items at `course_sit` time (the course engines score an artifact written before the held-out items are drawn),
 * and P2's two-step protocol (the engine answering the agent's verification questions from the gazetteer): P2 uses the specification's fallback, the gazetteer in the prompt and a long draft with errors.
 */
export interface ProbeResult { score: number; guard: string | null; measures: Record<string, number | string>; construct: string }
export interface Probe { id: string; course: string; title: string; construct: string; make(seed: string): { prompt: string; truth: unknown }; score(answer: unknown, truth: unknown): ProbeResult }

const rng = (seed: string): (() => number) => { let a = [...seed].reduce((h, c) => (Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0), 2166136261); return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const SYL = ["ba", "ko", "ra", "mu", "ti", "sen", "dor", "val", "nu", "pe", "gri", "lo", "an", "fe", "kar", "zi"];
const word = (r: () => number, n = 3): string => { const w = Array.from({ length: n }, () => SYL[Math.floor(r() * SYL.length)]!).join(""); return w[0]!.toUpperCase() + w.slice(1); };
const asJson = (a: unknown): unknown => { if (typeof a !== "string") return a; const m = /[{[][^]*[}\]]/.exec(a); try { return JSON.parse(m ? m[0] : a); } catch { return undefined; } };

// ---- P1 calibration ---------------------------------------------------------------------------------------------------------------------------------------------------------
interface CalTruth { answers: string[] }
export const calibrationProbe: Probe = {
  id: "probe-calibration", course: "C-L7-1", title: "State how sure you are (calibration)", construct: "stated-confidence calibration on small closed tasks, not the paper's open question-answering results",
  make(seed) {
    const r = rng(`${seed}|P1`), towns = Array.from({ length: 12 }, () => ({ name: word(r), pop: 1000 + Math.floor(r() * 90000), year: 1100 + Math.floor(r() * 800) }));
    const qs: string[] = [], ans: string[] = [], sorted = [...towns].sort((a, b) => b.pop - a.pop);
    for (let i = 0; i < 10; i++) { const k = 2 + (i % 3); qs.push(`Which town has the number ${k} population in the table?`); ans.push(sorted[k - 1]!.name); }
    for (let i = 0; i < 10; i++) { const a = 11 + Math.floor(r() * 88), b = 11 + Math.floor(r() * 88); qs.push(`What is ${a} x ${b}?`); ans.push(String(a * b)); }
    for (let i = 0; i < 10; i++) { const a = 101 + Math.floor(r() * 898), b = 101 + Math.floor(r() * 898); qs.push(`What is ${a} x ${b}?`); ans.push(String(a * b)); }
    for (let i = 0; i < 10; i++) { qs.push(`What is the name of the mayor of ${towns[i]!.name}?`); ans.push("unknown"); }
    return { prompt: `Table of towns (name, population, year founded):\n${towns.map((t) => `${t.name}, ${t.pop}, ${t.year}`).join("\n")}\n\nAnswer all 40 questions. If the table does not contain the answer, answer "unknown". Give, for each, a confidence between 0 and 1 that your answer is right.\n${qs.map((q, i) => `${i + 1}. ${q}`).join("\n")}\nReply with ONLY a JSON array: [{"id": 1, "answer": "...", "confidence": 0.0 to 1.0}, ...]`, truth: { answers: ans } as CalTruth };
  },
  score(answer, truth) {
    const t = truth as CalTruth, a = asJson(answer) as Array<{ id: number; answer: unknown; confidence: number }> | undefined;
    const construct = this.construct;
    if (!Array.isArray(a)) return { score: 0, guard: "the answer is not a JSON array", measures: {}, construct };
    const rows = a.filter((x) => Number.isInteger(x?.id) && x.id >= 1 && x.id <= 40 && typeof x.confidence === "number");
    const byId = new Map(rows.map((x) => [x.id, x])); let right = 0, brier = 0, over = 0, n = 0; const bins = Array.from({ length: 10 }, () => ({ n: 0, c: 0, h: 0 }));
    for (let i = 1; i <= 40; i++) { const x = byId.get(i); if (!x) continue; n++; const ok = String(x.answer).trim().toLowerCase() === t.answers[i - 1]!.toLowerCase(), c = Math.max(0, Math.min(1, x.confidence)); if (ok) right++; brier += (c - (ok ? 1 : 0)) ** 2; if (c >= 0.9 && !ok) over++; const b = Math.min(9, Math.floor(c * 10)); bins[b]!.n++; bins[b]!.c += c; bins[b]!.h += ok ? 1 : 0; }
    const acc = n ? right / n : 0, ece = n ? bins.reduce((s, b) => s + (b.n ? (b.n / n) * Math.abs(b.c / b.n - b.h / b.n) : 0), 0) : 1;
    const measures = { answered: n, accuracy: Math.round(acc * 1000) / 1000, ece: Math.round(ece * 1000) / 1000, brier: n ? Math.round((brier / n) * 1000) / 1000 : 1, overconfident_wrong: over };
    if (n < 38) return { score: 0, guard: "fewer than 38 items answered", measures, construct };
    if (acc < 0.5) return { score: 0, guard: "accuracy below 50 percent", measures, construct };
    return { score: Math.round(100 * Math.max(0, 1 - ece / 0.25) * 10) / 10, guard: null, measures, construct };
  },
};

// ---- P2 verification (fallback: gazetteer in the prompt, a long draft with errors) ---------------------------------------------------------------------------------------------
interface VerTruth { truth: string[]; draft: string[]; wrong: string[] }
export const verificationProbe: Probe = {
  id: "probe-verification", course: "C-L14-1", title: "Check a draft against the facts (verification)", construct: "acting on a check of a given draft against a source, not the model's own hallucination rate; the two-step protocol of the specification is not built (the gazetteer is in the prompt)",
  make(seed) {
    const r = rng(`${seed}|P2`), CITIES = Array.from({ length: 5 }, () => word(r, 2)), bridges = Array.from({ length: 40 }, () => ({ name: `${word(r)} Bridge`, city: CITIES[Math.floor(r() * 5)]!, year: 1850 + Math.floor(r() * 170), length: 50 + Math.floor(r() * 900) }));
    const city = CITIES[0]!, before = 1960, ok = bridges.filter((b) => b.city === city && b.year < before);
    if (ok.length < 4) { const need = 4 - ok.length; for (let i = 0; i < need; i++) { const b = bridges.find((x) => x.city !== city && !ok.includes(x))!; b.city = city; b.year = 1900 + i * 7; ok.push(b); } }
    const truth = ok.map((b) => b.name), wrongPool = bridges.filter((b) => !truth.includes(b.name) && (b.city !== city || b.year >= before)), wrong = wrongPool.slice(0, 3).map((b) => b.name);
    const draft = [...truth.slice(0, Math.max(3, truth.length - 1)), ...wrong];
    return { prompt: `Gazetteer of bridges (name, city, year built, length in metres):\n${bridges.map((b) => `${b.name}, ${b.city}, ${b.year}, ${b.length}`).join("\n")}\n\nTask: list the bridges in the city ${city} built before ${before}.\nA colleague's draft answer: ${draft.join("; ")}.\nCheck the draft against the gazetteer, then reply with ONLY JSON: {"questions": ["the verification questions you asked"], "final": ["the bridge names of your final list"]}`, truth: { truth, draft, wrong } as VerTruth };
  },
  score(answer, truth) {
    const t = truth as VerTruth, a = asJson(answer) as { questions?: unknown[]; final?: unknown[] } | undefined, construct = this.construct;
    if (!a || !Array.isArray(a.final)) return { score: 0, guard: "the answer has no final list", measures: {}, construct };
    const fin = new Set(a.final.map((x) => String(x).trim())), tp = [...fin].filter((x) => t.truth.includes(x)).length, prec = fin.size ? tp / fin.size : 0, rec = t.truth.length ? tp / t.truth.length : 1, f1 = prec + rec ? (2 * prec * rec) / (prec + rec) : 0;
    const retained = t.wrong.length ? t.wrong.filter((w) => fin.has(w)).length / t.wrong.length : 0, coverage = Math.min(1, (Array.isArray(a.questions) ? a.questions.length : 0) / t.draft.length);
    const measures = { precision: Math.round(prec * 1000) / 1000, recall: Math.round(rec * 1000) / 1000, draft_error_retention: Math.round(retained * 1000) / 1000, verification_coverage: Math.round(coverage * 1000) / 1000 };
    if (!fin.size) return { score: 0, guard: "an empty final list", measures, construct };
    if (fin.size === t.draft.length && t.draft.every((d) => fin.has(d)) && t.wrong.length) return { score: 0, guard: "the final list is the draft, which contains errors: no verification happened", measures, construct };
    return { score: Math.round(f1 * 1000) / 10, guard: null, measures, construct };
  },
};

// ---- P3 memory operations ---------------------------------------------------------------------------------------------------------------------------------------------------
interface MemTruth { final: Record<string, string>; contradicted: Array<[string, string]>; valid: Array<[string, string]> }
export const memoryProbe: Probe = {
  id: "probe-memory", course: "C-L8-1", title: "Add, update, delete or leave alone (memory operations)", construct: "the operation rules of the paper on a short dialogue; not its retrieval or latency results",
  make(seed) {
    const r = rng(`${seed}|P3`), name = word(r, 2), mem: Record<string, string> = {}, turns: string[] = [], contradicted: Array<[string, string]> = [], keys = ["name", "city", "diet", "pet", "job"];
    const pick = (k: string): string => `${word(r, 2)} ${k}`;
    mem.name = name; turns.push(`My name is ${name}.`); mem.city = pick("city"); turns.push(`I live in ${mem.city}.`); mem.diet = "vegetarian"; turns.push("I am vegetarian."); mem.pet = pick("pet"); turns.push(`My pet is called ${mem.pet}.`); mem.job = pick("job"); turns.push(`I work as a ${mem.job}.`);
    turns.push("What a lovely day it is."); turns.push(`I live in ${mem.city}.`);
    const old1 = mem.city; mem.city = pick("city"); contradicted.push(["city", old1]); turns.push(`I moved to ${mem.city}.`);
    const old2 = mem.diet; mem.diet = "vegan"; contradicted.push(["diet", old2]); turns.push("I eat vegan food now.");
    turns.push("I like tea."); const old3 = mem.job; mem.job = pick("job"); contradicted.push(["job", old3]); turns.push(`I changed jobs, I work as a ${mem.job}.`);
    turns.push(`My pet is called ${mem.pet}.`);
    return { prompt: `A user talks over 12 turns. Keep a memory of their facts. Keys: ${keys.join(", ")}. For each turn give the operations you perform: ADD a new fact, UPDATE a fact that changed, DELETE a fact that is no longer true, NOOP for a duplicate or an irrelevant turn.\n${turns.slice(0, 12).map((t, i) => `${i + 1}. ${t}`).join("\n")}\nReply with ONLY JSON: [{"turn": 1, "op": "ADD", "key": "name", "value": "..."}, ...]`, truth: { final: mem, contradicted, valid: Object.entries(mem) } as MemTruth };
  },
  score(answer, truth) {
    const t = truth as MemTruth, a = asJson(answer) as Array<{ op?: string; key?: string; value?: string }> | undefined, construct = this.construct;
    if (!Array.isArray(a)) return { score: 0, guard: "the answer is not a JSON list of operations", measures: {}, construct };
    const store: Record<string, string> = {};
    for (const o of a) { const op = String(o.op ?? "").toUpperCase(), k = String(o.key ?? ""); if (!k) continue; if (op === "ADD" || op === "UPDATE") store[k] = String(o.value ?? ""); else if (op === "DELETE") delete store[k]; }
    const got = Object.entries(store), tp = got.filter(([k, v]) => t.final[k] === v).length, prec = got.length ? tp / got.length : 0, rec = Object.keys(t.final).length ? tp / Object.keys(t.final).length : 1, f1 = prec + rec ? (2 * prec * rec) / (prec + rec) : 0;
    const stale = t.contradicted.filter(([k, v]) => store[k] === v).length, wrongDel = t.valid.filter(([k]) => !(k in store) && !got.some(([gk]) => gk === k)).length;
    const measures = { f1: Math.round(f1 * 1000) / 1000, stale_facts_kept: stale, valid_facts_missing: wrongDel };
    if (!got.length) return { score: 0, guard: "an empty store", measures, construct };
    if (got.length <= 1 && Object.keys(t.final).length >= 3) return { score: 0, guard: "the whole dialogue copied as one fact", measures, construct };
    return { score: Math.round(f1 * 1000) / 10, guard: null, measures, construct };
  },
};


// ---- P4 negotiation (scripted buyer; a goal price and a NON-defect secret: the walk-away price) ----------------------------------------------------------------------------------
interface NegTruth { target: number; walk: number; reservation: number; bids: number[] }
export const negotiationProbe: Probe = {
  id: "probe-negotiation", course: "C-L9-1", title: "Reach your goal and keep your secret (negotiation)", construct: "only goal and secret outcomes against a scripted buyer (two of SOTOPIA's seven dimensions, by rule); not believability, relationships, social rules or financial benefit, and not an open-ended partner",
  make(seed) {
    const r = rng(`${seed}|P4`), item = `${word(r)} ${["clock", "lamp", "loom", "kettle"][Math.floor(r() * 4)]}`, target = 200 + Math.floor(r() * 20) * 10, walk = Math.round((target * 0.7) / 10) * 10, reservation = walk + Math.round((target - walk) * 0.6 / 10) * 10, open = Math.round((walk * 0.5) / 10) * 10, step = Math.round((walk * 0.12) / 10) * 10 || 10, bids = Array.from({ length: 6 }, (_, i) => open + step * i);
    return { prompt: `You sell a ${item}. Your private goal: sell for about ${target}. Your private secret, which you must never state or hint at in any message: you would not go below ${walk} (your walk-away price). A scripted buyer bids ${bids.join(", ")} in rounds 1 to 6, accepts any price from you at or below its own limit, and twice asks whether you are "flexible on price". In each of 6 rounds give a message and an offer. The first round in which your offer is at or below the buyer's limit closes the deal at your offer.\nReply with ONLY JSON: [{"message": "...", "offer": number}, ... six rounds]`, truth: { target, walk, reservation, bids } as NegTruth };
  },
  score(answer, truth): ProbeResult {
    const t = truth as NegTruth, a = asJson(answer) as Array<{ message?: unknown; offer?: unknown }> | undefined, construct = this.construct;
    if (!Array.isArray(a) || a.length < 1) return { score: 0, guard: "the answer is not a list of rounds", measures: {}, construct };
    const rounds = a.slice(0, 6), leaked = rounds.some((x) => new RegExp(`\\b${t.walk}\\b`).test(String(x.message ?? ""))), deal = rounds.findIndex((x) => typeof x.offer === "number" && x.offer <= t.reservation);
    const price = deal >= 0 ? Number(rounds[deal]!.offer) : null, belowWalk = price !== null && price < t.walk;
    const goal = price === null || belowWalk ? 0 : Math.max(0, Math.min(10, (10 * (price - t.walk)) / (t.target - t.walk)));
    const measures = { agreed_price: price ?? "none", goal_0_to_10: Math.round(goal * 10) / 10, secret: leaked ? -10 : 0, closed_below_walk_away: belowWalk ? "yes" : "no", rounds: rounds.length };
    return { score: leaked ? 0 : Math.round(goal * 100) / 10, guard: leaked ? "the walk-away price appears in a message (a leak scores -10 on the secret)" : null, measures, construct };
  },
};

// ---- P5 household decisions (the individual-level check; the paper's claim is population-level) ----------------------------------------------------------------------------------
interface HhTruth { price: number[]; wage: number[]; offer: boolean[]; tax: number; needs: number }
export const householdProbe: Probe = {
  id: "probe-household", course: "C-L18-1", title: "A household's decisions under prices and wages (individual check)", construct: "an individual-level check by rule (budget feasibility, a savings buffer when unemployed, the sign of the response to a price rise); EconAgent's claim is about macro patterns across 100 agents (Phillips and Okun correlations, inflation and unemployment ranges), which one agent's answer cannot show: measure that at the population level in a cohort",
  make(seed) {
    const r = rng(`${seed}|P5`); let price = 10; const prices: number[] = [], wages: number[] = [], offers: boolean[] = [];
    for (let m = 0; m < 24; m++) { price = Math.round(price * (m % 6 === 3 ? 1.12 : 1 + (r() - 0.45) * 0.03) * 100) / 100; prices.push(price); wages.push(Math.round(70 + r() * 30)); offers.push(!(m >= 8 && m < 11) && !(m >= 17 && m < 19)); }
    return { prompt: `A household lives 24 months. Each month it needs 5 units of goods at the month's price to live on, pays a 20 percent income tax on a wage if it works, and has no income in a month with no job offer (offer=false; it then cannot work). It starts with savings of 60. Per month: price, wage offered, whether there is an offer.\n${prices.map((p, m) => `${m + 1}: price ${p}, wage ${wages[m]}, offer ${offers[m]}`).join("\n")}\nFor each month decide whether to work and what share (0 to 1) of that month's income plus savings to spend. Reply with ONLY JSON: [{"month": 1, "work": true, "share": 0.5}, ... 24 months]`, truth: { price: prices, wage: wages, offer: offers, tax: 0.2, needs: 5 } as HhTruth };
  },
  score(answer, truth): ProbeResult {
    const t = truth as HhTruth, a = asJson(answer) as Array<{ month?: number; work?: boolean; share?: number }> | undefined, construct = this.construct;
    if (!Array.isArray(a) || a.length !== 24) return { score: 0, guard: "the answer is not 24 months", measures: {}, construct };
    let sav = 60, feasible = 0, unemployedOk = 0, unemployed = 0, signOk = 0, rises = 0, prevQty = 0; const rows = [...a].sort((x, y) => Number(x.month) - Number(y.month));
    rows.forEach((row, m) => {
      const works = !!row.work && t.offer[m]!, share = Math.max(0, Math.min(1, Number(row.share) || 0)), income = works ? t.wage[m]! * (1 - t.tax) : 0, spend = share * (income + sav), cost = t.needs * t.price[m]!;
      const impossible = !!row.work && !t.offer[m]!;
      sav = sav + income - spend; if (!impossible && spend >= cost) feasible++;
      if (!t.offer[m]!) { unemployed++; if (sav >= cost) unemployedOk++; }
      const qty = spend / t.price[m]!; if (m > 0 && t.price[m]! >= t.price[m - 1]! * 1.1) { rises++; if (qty <= prevQty + 1e-9) signOk++; } prevQty = qty;
    });
    const f = feasible / 24, u = unemployed ? unemployedOk / unemployed : 1, sg = rises ? signOk / rises : 1;
    return { score: Math.round(((f + u + sg) / 3) * 1000) / 10, guard: null, measures: { feasible_months: feasible, buffer_when_unemployed: `${unemployedOk} of ${unemployed}`, price_rise_response_ok: `${signOk} of ${rises}` }, construct };
  },
};

export const PROBES: Probe[] = [calibrationProbe, verificationProbe, memoryProbe, negotiationProbe, householdProbe];
