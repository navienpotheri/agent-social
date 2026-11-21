/**
 * The lint of a course card for held-out leakage (register row DK1752; docs/institutions/lens-learning-loop.md stage 2). A card is read by learners and by their sponsors: its text must not carry anything from the held-out
 * tasks, and the practice set must not share a distinctive string with them. The engine says which strings are distinctive (`leakTokens`); the held-out seeds of a real sitting are drawn later from an anchor nobody
 * controls, so the lint samples five seeds and says it did. An engine that offers no tokens is listed as NOT linted with that reason: nothing is claimed for it. Pure: a card and an engine in, problems out.
 */
import { createHash } from "node:crypto";
import type { CourseCard } from "./catalogue.ts";
import type { Engine } from "./engines.ts";

export interface LintResult { id: string; linted: boolean; problems: string[]; sampled: number; note?: string }
const TEXT_FIELDS = ["concept", "free_first_lesson", "risks", "kill_switch"] as const;
const text = (c: CourseCard): [string, string][] => [
  ...TEXT_FIELDS.map((f) => [f, String(c[f] ?? "")] as [string, string]),
  ["scorer.description", c.scorer?.description ?? ""], ["artifact.description", c.artifact?.description ?? ""], ["gate.metric", c.gate?.metric ?? ""], ["gate.note", c.gate?.note ?? ""], ["grading.note", c.grading?.note ?? ""],
];
const sample = (id: string, k: number) => Array.from({ length: k }, (_, i) => "sha256:" + createHash("sha256").update(`lint|${id}|${i}`).digest("hex"));

export function lintCard(card: CourseCard, engine: Engine | undefined, samples = 5): LintResult {
  const problems: string[] = [];
  if (!card.paper?.trim()) problems.push("the card names the paper it comes from");
  if (!card.concept?.trim() || card.concept.trim().length < 40) problems.push("the card states its claim in the concept (at least 40 characters)");
  if (!(card.gate?.pass_permille >= 500)) problems.push("the pass mark is at least 500 permille");
  if (!card.gate?.error_bar) problems.push("the gate reports an error bar");
  if (!engine) return { id: card.id, linted: false, problems: [...problems, `no engine ${card.generator?.engine} is registered`], sampled: 0 };
  if (!engine.leakTokens) return { id: card.id, linted: false, problems, sampled: 0, note: `the engine ${engine.id} offers no distinctive tokens of its held-out tasks, so leakage into the card or the practice set is not linted for it` };
  const fields = text(card);
  for (const seed of sample(card.id, samples)) {
    const tokens = engine.leakTokens(seed);
    for (const t of tokens) for (const [name, body] of fields) if (body.includes(t)) problems.push(`${name} carries ${t}, a distinctive string of the held-out tasks of a sampled seed`);
    const practice = JSON.stringify(engine.practice(seed));
    for (const t of tokens) if (practice.includes(t)) problems.push(`the practice set of a sampled seed carries ${t}, which is also in its held-out tasks`);
  }
  return { id: card.id, linted: true, problems: [...new Set(problems)], sampled: samples };
}
