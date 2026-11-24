/**
 * The learning-gain study, step 1 (row ENG129): `asp academy card-effect`. Does reading a course's four card parts make a model write a better answer for the course's own held-out sitting? For each course, three arms on fresh seeds:
 * CONTROL (the task text only), PLACEBO (an unrelated text of the same length before the task) and TREATMENT (the course's four card parts before the task). The model writes the course's artifact as JSON; the course's own engine scores it on held-out seeds
 * the model did not see (`sit`: the same K-run sitting an agent would sit). One table per course: control mean, placebo mean, treatment mean, treatment minus control with a bootstrap 95 percent interval, n. `--headroom` runs only the control arm (the
 * room to improve). A cost line is printed before any call and a dollar cap (`--total-usd`) stops the study. Raw prompts' lengths, answers and scores are written. The key is read from the named environment variable and goes nowhere else.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { priceFor } from "@agent-social/asp-package";
import { ENGINES, engineIds, loadCatalogue, sit, type CourseCard } from "../lens-courses/index.ts";
import { PAPER_COURSES } from "./paper-cards.ts";
import type { Provider } from "./types.ts";

export type Arm = "control" | "placebo" | "treatment";
export interface CardEffectOptions { /** After the arms: the artifact written for course A (treatment arm) is given as memory while the model sits the held-out items of every other course, against the same items without it: does a write-back make the agent worse elsewhere? */ interference?: boolean; provider: Provider; model: string; courses: string[]; n: number; seed: string; totalUsd: number; headroom: boolean; out?: string; maxTokens?: number; price?: { inPerM: number; outPerM: number } }
export interface Sample { /** For the interference arm: the course whose artifact was given as memory. */ from?: string; course: string; arm: Arm | "memory"; i: number; score: number; answer: string; inputTokens: number; outputTokens: number; error?: string }
export interface InterferenceRow { from: string; pairs: number; meanChange: number | null; ci: [number, number] | null; worst: { course: string; change: number } | null }
export interface CourseRow { course: string; title: string; n: number; control: number | null; placebo: number | null; treatment: number | null; diff: number | null; ci: [number, number] | null }

const PLACEBO = "A good loaf starts with flour, water, salt and a little yeast. Mix them until no dry flour is left, cover the bowl and let the dough rest in a warm place until it has doubled. Knead it briefly, shape it, and let it rise a second time before it goes into a hot oven. The crust is done when it is deep brown and the loaf sounds hollow when tapped underneath. Let it cool before slicing, or the crumb will be gummy. ";
const rng = (seed: string): (() => number) => { let a = [...seed].reduce((h, c) => (Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0), 2166136261); return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
/** Bootstrap 95 percent interval of the difference of two means (2,000 resamples, seeded). */
export function bootstrapDiff(a: number[], b: number[], seed: string): [number, number] {
  const r = rng(seed), d: number[] = [];
  for (let k = 0; k < 2000; k++) { const ra = Array.from({ length: a.length }, () => a[Math.floor(r() * a.length)]!), rb = Array.from({ length: b.length }, () => b[Math.floor(r() * b.length)]!); d.push(mean(ra) - mean(rb)); }
  d.sort((x, y) => x - y);
  return [d[Math.floor(0.025 * d.length)]!, d[Math.floor(0.975 * d.length)]!];
}
export const treatmentText = (course: string): string => { const c = PAPER_COURSES.find((x) => x.course === course); return c ? c.parts.map((p) => `Part ${p.n} of ${c.parts.length}: ${p.title}. ${p.digest}`).join("\n\n") : ""; };
export const placeboText = (len: number): string => PLACEBO.repeat(Math.ceil(len / PLACEBO.length)).slice(0, len);

function promptFor(card: CourseCard, practice: unknown, arm: Arm): string {
  const task = `Task: ${card.title}. ${card.concept}\nWrite the answer the course asks for: ${card.artifact.description}.\nThe practice tasks you may study (the graded ones are different):\n${JSON.stringify(practice).slice(0, 6000)}\nReply with ONLY the JSON of your answer, nothing else.`;
  const treat = treatmentText(card.id);
  const pre = arm === "control" ? "" : arm === "treatment" ? `Read this first:\n${treat}\n\n` : `Read this first:\n${placeboText(treat.length)}\n\n`;
  return pre + task;
}
const parseJson = (text: string): unknown => { const m = /[{[][^]*[}\]]/.exec(text); try { return JSON.parse(m ? m[0] : text); } catch { return undefined; } };

export function estimate(o: Pick<CardEffectOptions, "courses" | "n" | "headroom" | "model" | "price" | "maxTokens">): { calls: number; usd: number; line: string } {
  const arms = o.headroom ? 1 : 3, calls = o.courses.length * o.n * arms, p = o.price ?? priceFor(o.model);
  const inTok = 1500 + 900, outTok = o.maxTokens ?? 1500; // a rough bound: the task, the practice set and the card parts in; the answer out
  const usd = calls * ((inTok * p.inPerM + outTok * p.outPerM) / 1_000_000);
  return { calls, usd, line: `${o.courses.length} course${o.courses.length === 1 ? "" : "s"} x ${o.n} samples x ${arms} arm${arms === 1 ? "" : "s"} = ${calls} model calls, at most about $${usd.toFixed(2)} (bound from ~${inTok} tokens in and ${outTok} out per call, ${p.inPerM}/${p.outPerM} USD per million tokens)` };
}

export async function runCardEffect(o: CardEffectOptions, say: (s: string) => void): Promise<{ rows: CourseRow[]; samples: Sample[]; spent: number; interference: InterferenceRow[] }> {
  const cat = loadCatalogue(engineIds()).courses, byId = new Map(cat.map((c) => [c.id, c]));
  const est = estimate(o);
  say(`Cost: ${est.line}. Cap $${o.totalUsd.toFixed(2)}.`);
  if (est.usd > o.totalUsd) say(`The bound is over the cap: the study stops when the cap is reached, so some samples will be missing.`);
  const arms: Arm[] = o.headroom ? ["control"] : ["control", "placebo", "treatment"], samples: Sample[] = [];
  const p = o.price ?? priceFor(o.model);
  let spent = 0, stopped = false;
  for (const course of o.courses) {
    const card = byId.get(course); if (!card || !ENGINES[card.generator.engine]) { say(`${course}: no such built course; skipped.`); continue; }
    for (let i = 0; i < o.n && !stopped; i++) for (const arm of arms) {
      if (spent >= o.totalUsd) { stopped = true; say(`The dollar cap ($${o.totalUsd.toFixed(2)}) was reached: the study stops here.`); break; }
      const practice = ENGINES[card.generator.engine]!.practice(`card-effect|${o.seed}|${course}|${i}`);
      let answer = "", err: string | undefined, inT = 0, outT = 0, score = 0;
      try {
        const r = await o.provider.complete({ system: "You are taking a short course check. Follow the instruction exactly.", messages: [{ role: "user", content: promptFor(card, practice, arm) }], tools: [], maxTokens: o.maxTokens ?? 1500 });
        answer = r.blocks.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n"); inT = r.usage.input; outT = r.usage.output;
        spent += (inT * p.inPerM + outT * p.outPerM) / 1_000_000;
        const artifact = parseJson(answer);
        score = artifact === undefined ? 0 : sit(card, artifact, `card-effect-${arm}-${i}`, 1, `card-effect|${o.seed}|${course}|${i}`).mean_permille / 10;
      } catch (e) { err = (e as Error).message.slice(0, 200); }
      samples.push({ course, arm, i, score, answer: answer.slice(0, 4000), inputTokens: inT, outputTokens: outT, ...(err ? { error: err } : {}) });
    }
  }
  // Interference: the artifact a model wrote for course A (after the cards) is memory for the held-out items of the other courses
  const interference: InterferenceRow[] = [];
  if (o.interference && !stopped) {
    const fromArm: Arm = o.headroom ? "control" : "treatment";
    for (const A of o.courses) {
      const diffs: number[] = []; let worst: { course: string; change: number } | null = null;
      for (const B of o.courses) {
        if (B === A || stopped) continue;
        const cardB = byId.get(B); if (!cardB || !ENGINES[cardB.generator.engine]) continue;
        for (let i = 0; i < o.n; i++) {
          const a = samples.find((s) => s.course === A && s.arm === fromArm && s.i === i && !s.error), base = samples.find((s) => s.course === B && s.arm === "control" && s.i === i && !s.error);
          const art = a ? parseJson(a.answer) : undefined; if (art === undefined || !base) continue;
          if (spent >= o.totalUsd) { stopped = true; say(`The dollar cap ($${o.totalUsd.toFixed(2)}) was reached: the study stops here.`); break; }
          const practice = ENGINES[cardB.generator.engine]!.practice(`card-effect|${o.seed}|${B}|${i}`);
          let answer = "", score = 0, err: string | undefined, inT = 0, outT = 0;
          try {
            const r = await o.provider.complete({ system: "You are taking a short course check. Follow the instruction exactly.", messages: [{ role: "user", content: `Memory you kept from an earlier course (${A}):\n${JSON.stringify(art).slice(0, 1500)}\n\n` + promptFor(cardB, practice, "control") }], tools: [], maxTokens: o.maxTokens ?? 1500 });
            answer = r.blocks.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n"); inT = r.usage.input; outT = r.usage.output; spent += (inT * p.inPerM + outT * p.outPerM) / 1_000_000;
            const artifact = parseJson(answer); score = artifact === undefined ? 0 : sit(cardB, artifact, `card-effect-memory-${A}-${i}`, 1, `card-effect|${o.seed}|${B}|${i}`).mean_permille / 10;
          } catch (e) { err = (e as Error).message.slice(0, 200); }
          samples.push({ from: A, course: B, arm: "memory", i, score, answer: answer.slice(0, 4000), inputTokens: inT, outputTokens: outT, ...(err ? { error: err } : {}) });
          if (!err) { const ch = score - base.score; diffs.push(ch); if (!worst || ch < worst.change) worst = { course: B, change: ch }; }
        }
      }
      interference.push({ from: A, pairs: diffs.length, meanChange: diffs.length ? mean(diffs) : null, ci: diffs.length ? bootstrapDiff(diffs, diffs.map(() => 0), `${o.seed}|int|${A}`) : null, worst });
    }
  }
  const rows: CourseRow[] = [];
  for (const course of o.courses) {
    const card = byId.get(course); if (!card) continue;
    const of = (a: Arm): number[] => samples.filter((s) => s.course === course && s.arm === a && !s.error).map((s) => s.score);
    const c = of("control"), pl = of("placebo"), tr = of("treatment");
    rows.push({ course, title: card.title, n: c.length, control: c.length ? mean(c) : null, placebo: pl.length ? mean(pl) : null, treatment: tr.length ? mean(tr) : null, diff: c.length && tr.length ? mean(tr) - mean(c) : null, ci: c.length && tr.length ? bootstrapDiff(tr, c, `${o.seed}|${course}`) : null });
  }
  if (o.out) {
    mkdirSync(o.out, { recursive: true });
    writeFileSync(join(o.out, "card-effect-samples.json"), JSON.stringify({ model: o.model, seed: o.seed, samples }, null, 2) + "\n");
    writeFileSync(join(o.out, "card-effect.md"), renderRows(rows, o, spent) + renderInterference(interference));
  }
  return { rows, samples, spent, interference };
}
export function renderInterference(rows: InterferenceRow[]): string {
  if (!rows.length) return "";
  const L = ["", "## Interference: does the memory written for course A make the model worse on the other courses?", "", "Mean change in the sitting score (percent) on the held-out items of the other courses when the artifact written for course A is given as memory, against the same items without it; bootstrap 95 percent interval of the mean change; the worst single course.", "", "| Memory from | Pairs | Mean change (95% interval) | Worst course |", "|---|---|---|---|"];
  for (const r of rows) L.push(`| ${r.from} | ${r.pairs} | ${r.meanChange === null ? "n/a" : `${r.meanChange >= 0 ? "+" : ""}${r.meanChange.toFixed(1)} (${r.ci![0].toFixed(1)} to ${r.ci![1].toFixed(1)})`} | ${r.worst ? `${r.worst.course} ${r.worst.change >= 0 ? "+" : ""}${r.worst.change.toFixed(1)}` : "n/a"} |`);
  return L.join("\n") + "\n";
}
const f1 = (x: number | null): string => (x === null ? "n/a" : x.toFixed(1));
export function renderRows(rows: CourseRow[], o: Pick<CardEffectOptions, "model" | "n" | "seed" | "headroom">, spent: number): string {
  const L = [`# Card effect: model ${o.model}, n ${o.n} per arm, seed ${o.seed}${o.headroom ? " (headroom: control arm only)" : ""}`, "", "Scores are the course's own sitting score in percent on fresh held-out seeds. Treatment minus control has a bootstrap 95 percent interval (2,000 resamples). One run; the interval is the spread of this run, not a claim about other models.", "", "| Course | n | Control | Placebo | Treatment | Treatment minus control (95% interval) |", "|---|---|---|---|---|---|"];
  for (const r of rows) L.push(`| ${r.course} ${r.title} | ${r.n} | ${f1(r.control)} | ${f1(r.placebo)} | ${f1(r.treatment)} | ${r.diff === null ? "n/a" : `${r.diff >= 0 ? "+" : ""}${r.diff.toFixed(1)} (${r.ci![0].toFixed(1)} to ${r.ci![1].toFixed(1)})`} |`);
  L.push("", `Spent about $${spent.toFixed(2)} by the token counts the service returned.`);
  return L.join("\n") + "\n";
}
