/**
 * `asp academy regression-check` (R2, R3, R4 measured): does a change to an agent's memory (a lesson, a write-back line) make a model WORSE on the courses it has passed? The battery is run on a model: for each listed course, three sealed canary
 * seeds (the held-out items the sitting would draw, fixed in advance) are answered with the memory in the prompt and scored by the course's own sitting; the calibration probe is added as the calibration part. The battery runs on the baseline
 * memory (empty), on the memory with the change, and on matched PLACEBO changes of the same length, so the noise of the battery is measured. The record is hashed, signed (a run key) and written with the raw answers. A dollar cap and a cost line come first.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { priceFor } from "@agent-social/asp-package";
import { engineIds, loadCatalogue, sit } from "../lens-courses/index.ts";
import { calibrationProbe } from "./probes-spec.ts";
import { formHint, parseJson, placeboText } from "./card-effect.ts";
import { abFork, newSigningKey, signRecord, verifyRecord, type CheckRecord, type PartScore } from "./regression.ts";
import type { Provider } from "./types.ts";

export interface RegressionRunOptions { provider: Provider; model: string; courses: string[]; change: string; placebos: number; n: number; totalUsd: number; out?: string; maxTokens?: number }
export function estimateRun(o: Pick<RegressionRunOptions, "courses" | "placebos" | "n" | "model" | "maxTokens">): { calls: number; usd: number; line: string } {
  const variants = 2 + o.placebos, parts = o.courses.length * o.n + 1, calls = variants * parts, p = priceFor(o.model), usd = calls * ((3500 * p.inPerM + (o.maxTokens ?? 4000) * p.outPerM) / 1_000_000);
  return { calls, usd, line: `${variants} memory variants (baseline, changed, ${o.placebos} placebo) x (${o.courses.length} course${o.courses.length === 1 ? "" : "s"} x ${o.n} sealed items + 1 calibration set) = ${calls} model calls, at most about $${usd.toFixed(2)}` };
}
export async function runRegressionCheck(o: RegressionRunOptions, say: (s: string) => void): Promise<{ record: CheckRecord; verified: boolean; spent: number; raw: Array<{ memory: string; part: string; score: number }> }> {
  const cat = loadCatalogue(engineIds()).courses, est = estimateRun(o), p = priceFor(o.model); let spent = 0;
  say(`Cost: ${est.line}. Cap $${o.totalUsd.toFixed(2)}.`);
  const raw: Array<{ memory: string; part: string; score: number }> = [], cap = o.maxTokens ?? 4000;
  const ask = async (memory: string, body: string): Promise<string> => {
    if (spent >= o.totalUsd) return "";
    const r = await o.provider.complete({ system: "You are taking a short check. Follow the instruction exactly.", messages: [{ role: "user", content: `${memory.trim() ? `Your memory (lines you kept):\n${memory.trim()}\n\n` : ""}${body}` }], tools: [], maxTokens: cap });
    spent += (r.usage.input * p.inPerM + r.usage.output * p.outPerM) / 1_000_000;
    return r.blocks.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
  };
  const battery = async (memory: unknown): Promise<PartScore[]> => {
    const mem = String(memory), parts: PartScore[] = [];
    for (const id of o.courses) {
      const card = cat.find((c) => c.id === id); if (!card) continue; let tot = 0;
      for (let k = 0; k < o.n; k++) {
        const seed = `canary|${id}|${k}`, practice = (await import("../lens-courses/index.ts")).ENGINES[card.generator.engine]!.practice(seed);
        const answer = await ask(mem, `Task: ${card.title}. ${card.concept}\nWrite the answer the course asks for: ${card.artifact.description}.\n${formHint(card)}\nThe practice tasks you may study:\n${JSON.stringify(practice).slice(0, 20000)}\nReply with ONLY the JSON of your answer.`);
        const art = parseJson(answer); tot += art === undefined ? 0 : sit(card, art, `regression-${k}`, 1, seed).mean_permille / 10;
      }
      const score = tot / o.n; parts.push({ id, name: card.title, score }); raw.push({ memory: mem.slice(0, 60), part: id, score });
    }
    const made = calibrationProbe.make("canary|calibration"), ans = await ask(mem, made.prompt), cs = calibrationProbe.score(ans, made.truth).score;
    parts.push({ id: "calibration", name: "calibration (probe)", score: cs }); raw.push({ memory: mem.slice(0, 60), part: "calibration", score: cs });
    return parts;
  };
  const placebos = Array.from({ length: o.placebos }, (_, i) => placeboText(o.change.length + i * 7).slice(i * 11).slice(0, o.change.length));
  const record = await abFork({ agent: "regression-check", state: "", change: { kind: "memory line", text: o.change }, apply: (s, c) => `${String(s)}\n${c}`.trim(), battery, placebos });
  const keys = newSigningKey(), signed = signRecord(record, keys.privateKey), verified = verifyRecord(signed, keys.publicKey);
  if (o.out) { mkdirSync(o.out, { recursive: true }); writeFileSync(join(o.out, "regression-check.json"), JSON.stringify({ record: signed, raw, spent }, null, 2) + "\n"); }
  return { record: signed, verified, spent, raw };
}
export function renderCheck(r: CheckRecord, spent: number): string {
  const L = [`# Regression check: ${r.verdict}`, "", `Change ${r.change.hash.slice(0, 19)}... (${r.change.chars} characters). Scores are percent on sealed canary items; a drop of ${5} points is a flag, two flags or ${10} a regression, and a drop counts only beyond the battery's own noise (the placebo spread).`, "", "| Part | Before | After | Drop | Minimum detectable drop | Beyond noise |", "|---|---|---|---|---|---|"];
  for (const b of r.before) { const a = r.after.find((x) => x.id === b.id)!, f = r.flags.find((x) => x.part === b.id); L.push(`| ${b.id} ${b.name} | ${b.score.toFixed(1)} | ${a.score.toFixed(1)} | ${(b.score - a.score).toFixed(1)} | ${r.min_detectable_drop[b.id] ?? "n/a"} | ${f ? (f.beyond_noise ? "yes" : "no") : "no flag"} |`); }
  L.push("", `Verdict: ${r.verdict}. Spent about $${spent.toFixed(2)}. Record ${r.hash.slice(0, 19)}..., signed with a run key.`);
  return L.join("\n") + "\n";
}
