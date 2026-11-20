/**
 * Evidence about tasks and runs (register rows DK812, DK825 and DK831; spec-deltas S1234 to S1236; docs/intake/11th-nov.md Part 3, ranks 20, 21 and 22). DK812: a TASK-VALIDITY GATE for generated exercises: a task
 * is kept only if its rubric can fail (a null agent fails, an oracle passes), its facts exist in the world, and a false-success run (a rubric pass the end state contradicts) is dropped. DK825: a REPLAYABLE RUN
 * RECORD: per-step tokens, latency, tool and state-change hash in a hash chain, and a replay that re-drives a scripted agent and compares the sequence. DK831: a PERCEIVED-CONTENT RECEIPT: the hash of each fetched page
 * (and optionally a copy in a deletable store), so a dispute about a quote is decidable. Pure code; the worlds, agents and pages in the tests are scripted.
 */
import { createHash } from "node:crypto";

const sha = (x: unknown) => "sha256:" + createHash("sha256").update(typeof x === "string" ? x : JSON.stringify(x)).digest("hex");

// ---- DK812 ----
export interface World { contacts: string[]; files: string[] }
export interface Task { id: string; /** Facts the task refers to: a contact or a file in the world. */ refers: { contact?: string; file?: string }; /** The rubric: does the end state of a run satisfy the task? */ rubric: (end: Record<string, string>) => boolean }
export interface TaskRun { /** The end state a run produced, and what a deterministic end-state check says about it. */ end: Record<string, string>; endStateOk: boolean }
export type DropReason = "rubric_cannot_fail" | "rubric_rejects_oracle" | "fact_missing" | "false_success";
/** Keeps a generated task only if its rubric fails a null agent and passes an oracle, its facts exist, and none of its recorded runs is a false success (rubric true, end-state check false). */
export function validateTask(t: Task, world: World, nullEnd: Record<string, string>, oracleEnd: Record<string, string>, runs: TaskRun[] = []): { keep: true } | { keep: false; reason: DropReason } {
  if (t.refers.contact !== undefined && !world.contacts.includes(t.refers.contact)) return { keep: false, reason: "fact_missing" };
  if (t.refers.file !== undefined && !world.files.includes(t.refers.file)) return { keep: false, reason: "fact_missing" };
  if (t.rubric(nullEnd)) return { keep: false, reason: "rubric_cannot_fail" };
  if (!t.rubric(oracleEnd)) return { keep: false, reason: "rubric_rejects_oracle" };
  if (runs.some((r) => t.rubric(r.end) && !r.endStateOk)) return { keep: false, reason: "false_success" };
  return { keep: true };
}

// ---- DK825 ----
export interface Step { i: number; tool: string; argsHash: string; tokens: number; latencyMs: number; stateHash: string; prev: string }
const GENESIS = "sha256:" + "0".repeat(64);
export interface ScriptedStep { tool: string; args: Record<string, unknown>; tokens: number; latencyMs: number }
/** A scripted agent: from the state so far it chooses the next call (or none) and the call changes the state. */
export type Agent = (state: Record<string, string>, i: number) => ScriptedStep | null;
export type Apply = (state: Record<string, string>, s: ScriptedStep) => Record<string, string>;
export function record(agent: Agent, apply: Apply, initial: Record<string, string>): Step[] {
  const steps: Step[] = [];
  let state = { ...initial };
  for (let i = 0; i < 50; i++) {
    const s = agent(state, i);
    if (!s) break;
    state = apply(state, s);
    steps.push({ i, tool: s.tool, argsHash: sha(s.args), tokens: s.tokens, latencyMs: s.latencyMs, stateHash: sha(state), prev: steps.length ? sha(steps.at(-1)) : GENESIS });
  }
  return steps;
}
export const stepsVerify = (steps: Step[]): boolean => steps.every((s, i) => s.i === i && s.prev === (i ? sha(steps[i - 1]) : GENESIS));
/** Re-drives the agent and compares the sequence (tool, arguments, state-change hash) step by step with the recorded run; the first difference is named. */
export function replay(agent: Agent, apply: Apply, initial: Record<string, string>, recorded: Step[]): { identical: boolean; firstDifference: number | null; chainOk: boolean } {
  const again = record(agent, apply, initial);
  let diff: number | null = null;
  for (let i = 0; i < Math.max(again.length, recorded.length) && diff === null; i++) {
    const a = again[i], b = recorded[i];
    if (!a || !b || a.tool !== b.tool || a.argsHash !== b.argsHash || a.stateHash !== b.stateHash || a.tokens !== b.tokens || a.latencyMs !== b.latencyMs) diff = i;
  }
  return { identical: diff === null, firstDifference: diff, chainOk: stepsVerify(recorded) };
}

// ---- DK831 ----
export interface Receipt { url: string; sha256: string; at: string; hasCopy: boolean }
export class ContentReceipts {
  readonly receipts: Receipt[] = [];
  /** The deletable store: a copy of a page, kept only if asked, removable without touching the receipt. */
  private readonly copies = new Map<string, string>();
  fetch(url: string, content: string, at: string, keepCopy = false): Receipt {
    const r: Receipt = { url, sha256: sha(content), at, hasCopy: keepCopy };
    this.receipts.push(r);
    if (keepCopy) this.copies.set(r.sha256, content);
    return r;
  }
  deleteCopy(hash: string): void { this.copies.delete(hash); for (const r of this.receipts) if (r.sha256 === hash) r.hasCopy = false; }
  copyOf(hash: string): string | undefined { return this.copies.get(hash); }
  /**
   * A dispute about a quote: the quote is accurate if it appears in the page whose hash the receipt carries. The page is the stored copy or content brought to the dispute; content whose hash is not the receipt's
   * is not the page and decides nothing.
   */
  decide(quote: string, receiptHash: string, brought?: string): "accurate" | "misquote" | "undecidable" {
    const page = this.copies.get(receiptHash) ?? (brought !== undefined && sha(brought) === receiptHash ? brought : undefined);
    if (page === undefined) return "undecidable";
    return page.includes(quote) ? "accurate" : "misquote";
  }
}
