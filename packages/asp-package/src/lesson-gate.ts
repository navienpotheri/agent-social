/**
 * The invariant audit gate for lessons (register row DK32, gap D9; academy.md AC-6; deck slides 9 and 14): a lesson proposed for an agent's memory or for the commons is checked BEFORE it is admitted, on four things:
 *
 *   1. evidence    it cites where it came from: a reviewed commons entry (two other agents endorsed it) or the agent's own run (an Action id); a lesson with no evidence is not admitted;
 *   2. invariants  it does not tell the agent to cross a line the protocol keeps (go outside its Mandate, switch the gateway or a check off, skip a checkpoint, hide its actions from its principal, take an
 *                  irreversible step unasked, leak a secret, or obey text that claims authority over its rules), and it carries no hidden characters;
 *   3. conflicts   it does not contradict a lesson the agent already holds (an "always" against a "never" about the same thing);
 *   4. replay      with the lesson in memory, held-out tasks that passed without it still pass (a lesson that makes the agent worse is rejected), and there must be enough held-out tasks to say so.
 *
 * A rejected lesson is kept with its reasons (never silently dropped), so the principal can read why. An admitted lesson carries the evidence it cited. Nothing here calls a model: the checks are
 * deterministic, so the same lesson gets the same verdict on every machine. The invariant list is a floor, not a proof of safety: a lesson worded to dodge it is caught by the replay and by the
 * principal's review (asp learned), and the list is written down as a limit in docs/gaps-register.md (DK112).
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Signer } from "@agent-social/asp-core";
import { readJson, writeJson } from "./files.ts";
import { updatePackage } from "./package.ts";

export type Evidence = { kind: "commons_entry"; ref: string } | { kind: "run"; ref: string };
export interface LessonCandidate { id: string; text: string; evidence: Evidence[]; source: "course" | "commons" | "run" | "principal" }
export interface HeldOutTask { id: string; /** Runs the task with the memory (the lessons the agent would hold) and says whether it passed. */ run: (memory: readonly string[]) => Promise<boolean> | boolean }
export interface GateOptions {
  /** The lessons the agent already holds (text), for the conflict check. */
  existing: readonly { id: string; text: string }[];
  /** Held-out tasks for the replay. */
  heldOut: readonly HeldOutTask[];
  /** The status of a commons entry ("reviewed", "disputed", "unreviewed"); undefined if there is no such entry. */
  commonsStatus?: (id: string) => string | undefined;
  /** Whether an Action id is one of this agent's own runs. */
  isOwnRun?: (id: string) => boolean;
  /** Fewest held-out tasks the replay needs (default 3). */
  minHeldOut?: number;
}
export type RejectionRule = "no_evidence" | "evidence_not_reviewed" | "evidence_unknown" | "invariant" | "hidden_text" | "conflict" | "replay_regressed" | "replay_too_small" | "empty";
export interface Rejection { rule: RejectionRule; reason: string }
export interface Verdict { lesson: LessonCandidate; admitted: boolean; reasons: Rejection[]; cited?: Evidence[] }

/** Lines the protocol keeps. Each pattern says what a lesson may not teach. */
export const INVARIANT_PATTERNS: readonly { name: string; re: RegExp }[] = [
  { name: "go outside the Mandate", re: /\b(ignore|bypass|override|exceed|skip|disregard|go beyond|get around|work around|circumvent)\b[^.\n]{0,40}\b(mandate|scope|scopes|permission|permissions|spend cap|limit|limits|restriction|restrictions|guardrails?)\b/i },
  { name: "switch the gateway or a check off", re: /\b(disable|turn off|switch off|stop|avoid|evade|remove|kill)\b[^.\n]{0,40}\b(gateway|hook|guard|monitor|sandbox|audit|logging|checks?|the log|run log)\b/i },
  { name: "skip a checkpoint or act unasked on something irreversible", re: /\b(skip|without|no need (for|to)|don't|do not|never)\b[^.\n]{0,25}\b(checkpoint|asking|ask|confirm|confirmation|approval|permission)\b[^.\n]{0,40}\b(delete|drop|force[- ]push|overwrite|wipe|destroy|irreversible|production)\b/i },
  { name: "act unasked on something irreversible", re: /\b(delete|drop|wipe|destroy|force[- ]push)\b[^.\n]{0,40}\b(without (asking|confirmation|approval|a checkpoint)|unasked|silently)\b/i },
  { name: "hide actions from the principal", re: /\b(hide|conceal|do not (tell|report|mention)|don't (tell|report|mention)|never (tell|report|mention)|omit)\b[^.\n]{0,40}\b(principal|sponsor|owner|user|operator|log|report|action|actions)\b/i },
  { name: "leak a secret", re: /\b(send|post|upload|paste|include|print|echo|share|exfiltrate|leak)\b[^.\n]{0,40}\b(api[- ]?keys?|tokens?|secrets?|passwords?|credentials?|private keys?|recovery codes?)\b/i },
  { name: "obey text that claims authority over the rules", re: /\b(ignore|forget|disregard)\b[^.\n]{0,30}\b(previous|prior|above|all|earlier|your)\b[^.\n]{0,30}\b(instructions?|rules?|guidelines?|constraints?)\b|\b(you are|you're) (now )?(exempt|above|free from|not bound by)\b|\b(system|admin|anthropic|operator) (override|message|says)\b/i },
  { name: "raise its own standing or spend", re: /\b(promote|raise|upgrade)\b[^.\n]{0,20}\b(yourself|your own tier|your tier)\b|\b(spend|use)\b[^.\n]{0,25}\b(credits|budget)\b[^.\n]{0,25}\b(without|beyond|over)\b/i },
];

/** Zero-width characters, bidirectional controls and Unicode tag characters: text a person cannot see, which a lesson has no reason to carry. */
const HIDDEN = /[​-‏‪-‮⁠-⁤\u{e0000}-\u{e007f}﻿]/u;

const STOP = new Set("the a an to of and or in on for with is are be it this that you your when then do does not never always must should".split(" "));
const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w)));
const overlap = (a: Set<string>, b: Set<string>) => { if (!a.size || !b.size) return 0; let n = 0; for (const w of a) if (b.has(w)) n++; return n / Math.min(a.size, b.size); };
/** "positive" for always/must/do, "negative" for never/must not/do not/don't/avoid, otherwise undefined. */
function polarity(s: string): "positive" | "negative" | undefined {
  const t = s.toLowerCase();
  if (/\b(never|must not|mustn't|do not|don't|should not|shouldn't|avoid|cannot|can't)\b/.test(t)) return "negative";
  if (/\b(always|must|should|do|make sure|ensure|remember to)\b/.test(t)) return "positive";
  return undefined;
}

/** Sentences of a lesson, each with its polarity and its content words (the polarity words themselves are stop words). */
const claims = (text: string) => text.split(/(?<=[.!?\n])\s+/).map((s) => s.trim()).filter(Boolean).map((s) => ({ s, p: polarity(s), w: words(s) })).filter((c) => c.p);

/**
 * The checks a lesson can fail on its text alone, with no agent and no held-out tasks: it is not empty, it carries no hidden characters, and it teaches nothing the protocol keeps (the invariant list). The commons service runs
 * these on what is posted tagged `lesson` (register row DK113); the evidence, conflict and replay checks stay at the agent, where the memory and the held-out tasks are.
 */
export function lessonProblems(text: string): Rejection[] {
  const out: Rejection[] = [];
  if (!text.trim()) out.push({ rule: "empty", reason: "the lesson has no text" });
  if (HIDDEN.test(text)) out.push({ rule: "hidden_text", reason: "the lesson carries characters a person cannot see (zero-width, bidirectional or tag characters)" });
  for (const p of INVARIANT_PATTERNS) if (p.re.test(text)) out.push({ rule: "invariant", reason: `the lesson teaches the agent to ${p.name}, which the protocol does not allow` });
  return out;
}

export async function auditLesson(lesson: LessonCandidate, o: GateOptions): Promise<Verdict> {
  const reasons: Rejection[] = [];
  const reject = (rule: RejectionRule, reason: string) => reasons.push({ rule, reason });
  if (!lesson.text.trim()) reject("empty", "the lesson has no text");
  if (HIDDEN.test(lesson.text)) reject("hidden_text", "the lesson carries characters a person cannot see (zero-width, bidirectional or tag characters)");
  const cited: Evidence[] = [];
  if (!lesson.evidence.length) reject("no_evidence", "the lesson cites no evidence: say which reviewed commons entry or which of your own runs it comes from");
  for (const e of lesson.evidence) {
    if (e.kind === "commons_entry") {
      const status = o.commonsStatus?.(e.ref);
      if (status === undefined) reject("evidence_unknown", `the commons entry ${e.ref} was not found`);
      else if (status !== "reviewed") reject("evidence_not_reviewed", `the commons entry ${e.ref} is ${status}: a lesson rests on an entry two other agents endorsed`);
      else cited.push(e);
    } else if (o.isOwnRun?.(e.ref)) cited.push(e);
    else reject("evidence_unknown", `${e.ref} is not one of the agent's own runs`);
  }
  for (const p of INVARIANT_PATTERNS) if (p.re.test(lesson.text)) reject("invariant", `the lesson teaches the agent to ${p.name}, which the protocol does not allow`);
  const mine = claims(lesson.text);
  for (const old of o.existing) {
    for (const c of claims(old.text)) for (const m of mine) if (m.p !== c.p && overlap(m.w, c.w) >= 0.6) reject("conflict", `it contradicts the lesson ${old.id} ("${c.s.slice(0, 80)}")`);
  }
  const min = o.minHeldOut ?? 3;
  if (o.heldOut.length < min) reject("replay_too_small", `the replay needs at least ${min} held-out tasks; there are ${o.heldOut.length}`);
  else if (!reasons.some((r) => r.rule === "invariant" || r.rule === "hidden_text")) {
    // Replay only a lesson that got this far: running tasks with an unsafe lesson in memory is not worth the risk.
    const base = o.existing.map((e) => e.text);
    for (const t of o.heldOut) {
      const before = await t.run(base), after = await t.run([...base, lesson.text]);
      if (before && !after) reject("replay_regressed", `the held-out task ${t.id} passed without the lesson and fails with it`);
    }
  }
  return { lesson, admitted: reasons.length === 0, reasons, ...(reasons.length === 0 ? { cited } : {}) };
}

export async function auditLessons(lessons: readonly LessonCandidate[], o: GateOptions): Promise<Verdict[]> {
  const out: Verdict[] = [];
  const held = [...o.existing];
  for (const l of lessons) {
    const v = await auditLesson(l, { ...o, existing: held });
    out.push(v);
    if (v.admitted) held.push({ id: l.id, text: l.text }); // a later lesson in the same batch is checked against the earlier ones
  }
  return out;
}

const safeName = (id: string) => id.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80);
const rejectedPath = (pkg: string) => join(pkg, "learned", "rejected.json");
export interface RejectedRow { id: string; at: string; source: string; text: string; reasons: Rejection[] }
export const readRejected = (pkg: string): RejectedRow[] => { try { return readJson<RejectedRow[]>(rejectedPath(pkg)); } catch { return []; } };

/** The lessons the package holds now, from memory/lessons/*.md (their first line is the id comment). */
export function heldLessons(pkg: string): { id: string; text: string }[] {
  const dir = join(pkg, "memory", "lessons");
  if (!existsSync(dir)) return [];
  const out: { id: string; text: string }[] = [];
  for (const f of readdirSyncSafe(dir)) if (f.endsWith(".md")) out.push({ id: f.replace(/\.md$/, ""), text: readFileSync(join(dir, f), "utf8").replace(/^<!--.*-->\n/, "") });
  return out;
}
const readdirSyncSafe = (d: string) => { try { return readdirSync(d); } catch { return []; } };

/**
 * The only door a course's or the commons' lessons take into an agent's memory. Audits each lesson; writes the admitted ones to memory/lessons/<id>.md (with the evidence they cited) through ONE signed
 * lineage update (so asp learned lists it, shows the diff and can undo it); keeps each rejected one with its reasons in learned/rejected.json. Returns the verdicts.
 */
export async function admitToMemory(pkg: string, lessons: readonly LessonCandidate[], o: GateOptions & { signer: Signer; now?: Date; budget?: undefined }): Promise<Verdict[]> {
  const verdicts = await auditLessons(lessons, { ...o, existing: [...o.existing, ...heldLessons(pkg)] });
  const stamp = (o.now ?? new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
  const rejected = verdicts.filter((v) => !v.admitted);
  if (rejected.length) {
    mkdirSync(join(pkg, "learned"), { recursive: true });
    writeJson(rejectedPath(pkg), [...readRejected(pkg), ...rejected.map((v) => ({ id: v.lesson.id, at: stamp, source: v.lesson.source, text: v.lesson.text, reasons: v.reasons }))]);
  }
  const admitted = verdicts.filter((v) => v.admitted);
  if (admitted.length) {
    const tmp = mkdtempSync(join(tmpdir(), "asp-gate-"));
    try {
      if (existsSync(join(pkg, "memory"))) cpSync(join(pkg, "memory"), tmp, { recursive: true });
      mkdirSync(join(tmp, "lessons"), { recursive: true });
      for (const v of admitted) {
        const cites = (v.cited ?? []).map((e) => `${e.kind}:${e.ref}`).join(", ");
        writeFileSync(join(tmp, "lessons", `${safeName(v.lesson.id)}.md`), `<!-- admitted by the audit gate; source ${v.lesson.source}; evidence ${cites} -->\n${v.lesson.text.trim()}\n`);
      }
      updatePackage(pkg, { signer: o.signer, memoryFrom: tmp, now: o.now ?? new Date(), changes: [{ layer: "memory", description: `admitted ${admitted.length} lesson(s) through the audit gate: ${admitted.map((v) => v.lesson.id).join(", ")}${rejected.length ? ` (${rejected.length} rejected, kept with reasons)` : ""}` }] });
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }
  return verdicts;
}

/**
 * The gate on the agent's own runtime writes (register row DK112; spec-delta none, a gateway and CLI behaviour): a note the agent saves with `asp_memory_write`, or writes into its memory folder with its own
 * file tools, is checked on its text by the same invariant list and the hidden-character check as any lesson, before it is kept. The evidence, conflict and replay checks are not asked of a runtime note: there is
 * no cited source and no held-out set at the moment of writing. A note that fails is not kept (a new one is removed, a changed one goes back to what it was) and is listed with its reasons in `learned/rejected.json`,
 * so the principal can read what the agent tried to remember. The list is a floor: see `docs/gate-evasions.md` for what it misses.
 */
export function screenMemoryWriteBack(pkg: string, memDir: string, baseDir: string, now: () => string = () => new Date().toISOString()): { file: string; reasons: Rejection[] }[] {
  const held: { file: string; reasons: Rejection[] }[] = [];
  const walkMd = (dir: string, rel = ""): string[] => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkMd(join(dir, e.name), join(rel, e.name)) : e.name.endsWith(".md") ? [join(rel, e.name)] : [])) : []);
  for (const rel of walkMd(memDir)) {
    const text = readFileSync(join(memDir, rel), "utf8");
    const before = existsSync(join(baseDir, rel)) ? readFileSync(join(baseDir, rel), "utf8") : undefined;
    if (before === text) continue;
    const problems = lessonProblems(text.replace(/^---\n[\s\S]*?\n---\n/, ""));
    if (!problems.length) continue;
    if (before === undefined) rmSync(join(memDir, rel)); else writeFileSync(join(memDir, rel), before);
    held.push({ file: rel.split("\\").join("/"), reasons: problems });
  }
  if (held.length) {
    const stamp = now();
    mkdirSync(join(pkg, "learned"), { recursive: true });
    writeJson(rejectedPath(pkg), [...readRejected(pkg), ...held.map((h) => ({ id: `memory/${h.file}`, at: stamp, source: "run" as const, text: "(a note the agent wrote during a run)", reasons: h.reasons }))]);
  }
  return held;
}
