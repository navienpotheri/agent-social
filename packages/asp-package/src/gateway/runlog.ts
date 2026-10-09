/**
 * The run log (gap E2): what the gateway saw during a run, kept on the machine for the dashboard and the end-of-Mandate mail.
 *
 * One JSON line per event: the model requests and replies (a short, redacted excerpt of the last prompt and of the reply, the model name, the token
 * counts), every tool call with the scope it mapped to and whether it was allowed, the principal's answers to gated calls, and how the run ended.
 * Anything that looks like a secret is masked and long text is cut, so the log can be shown to a person; it is still content (prompts and replies),
 * so it stays in the run folder and never goes to the log service. Lines are hash-chained, so the head hash commits to the whole run log: the
 * Action carries it as an artifact (`asp://run-log/<events>`), and anyone holding the file can check it is complete and unaltered.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { redactSecrets } from "../secrets.ts";

export interface RunEvent { n: number; at: string; kind: string; data: Record<string, unknown>; prev: string; hash: string }

const GENESIS = "sha256:" + "0".repeat(64);
const hashOf = (e: Omit<RunEvent, "hash">) => "sha256:" + createHash("sha256").update(JSON.stringify([e.n, e.at, e.kind, e.data, e.prev])).digest("hex");

export class RunRecorder {
  private prev = GENESIS;
  private n = 0;
  redactions = 0;
  readonly counts: Record<string, number> = {};

  /** `maxText` is the longest excerpt kept of any text (a prompt, a reply, a command). */
  readonly path: string;
  private maxText: number;
  private now: () => string;
  constructor(path: string, maxText = 1200, now: () => string = () => new Date().toISOString()) {
    this.path = path; this.maxText = maxText; this.now = now;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "");
  }

  /** Masks secrets, then cuts. Applied to every string in an event. */
  clip(text: string): string {
    const r = redactSecrets(text);
    this.redactions += r.redacted;
    return r.text.length > this.maxText ? `${r.text.slice(0, this.maxText)}...[+${r.text.length - this.maxText} chars]` : r.text;
  }

  private clean(v: unknown): unknown {
    if (typeof v === "string") return this.clip(v);
    if (Array.isArray(v)) return v.map((x) => this.clean(x));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, this.clean(x)]));
    return v;
  }

  event(kind: string, data: Record<string, unknown> = {}): void {
    const body = { n: ++this.n, at: this.now(), kind, data: this.clean(data) as Record<string, unknown>, prev: this.prev };
    const e: RunEvent = { ...body, hash: hashOf(body) };
    appendFileSync(this.path, JSON.stringify(e) + "\n");
    this.prev = e.hash;
    this.counts[kind] = (this.counts[kind] ?? 0) + 1;
  }

  /** How many events there are and the hash that commits to all of them. */
  head(): { events: number; hash: string } { return { events: this.n, hash: this.prev }; }
}

/** The artifact an Action carries to commit to the run log so far. */
export function runLogArtifact(head: { events: number; hash: string }): { uri: string; sha256: string } {
  return { uri: `asp://run-log/${head.events}`, sha256: head.hash };
}

export interface RunLogCheck { ok: boolean; events: RunEvent[]; problem?: string; head: { events: number; hash: string } }

/** Reads a run log and checks every line's hash and its link to the line before. */
export function readRunLog(path: string): RunLogCheck {
  if (!existsSync(path)) return { ok: false, events: [], problem: `${path} does not exist`, head: { events: 0, hash: GENESIS } };
  const events: RunEvent[] = [];
  let prev = GENESIS;
  for (const [i, line] of readFileSync(path, "utf8").split("\n").entries()) {
    if (!line.trim()) continue;
    let e: RunEvent;
    try { e = JSON.parse(line); } catch { return { ok: false, events, problem: `line ${i + 1} is not JSON`, head: { events: events.length, hash: prev } }; }
    const { hash, ...body } = e;
    if (e.prev !== prev) return { ok: false, events, problem: `event ${e.n} does not follow the one before it`, head: { events: events.length, hash: prev } };
    if (hashOf(body) !== hash) return { ok: false, events, problem: `event ${e.n} was changed (its hash does not match)`, head: { events: events.length, hash: prev } };
    events.push(e);
    prev = hash;
  }
  return { ok: true, events, head: { events: events.length, hash: prev } };
}

/** The hash after the first `count` events of a checked run log, for comparing with what an Action committed to. */
export function hashAfter(events: RunEvent[], count: number): string | undefined {
  if (count === 0) return GENESIS;
  return events[count - 1]?.hash;
}

/** Text of the last user message in a model request body (chat completions, Responses or Anthropic Messages), or "". */
export function lastUserText(body: any): string {
  const textOf = (c: unknown): string => {
    if (typeof c === "string") return c;
    if (Array.isArray(c)) return c.map((p: any) => (typeof p === "string" ? p : typeof p?.text === "string" ? p.text : p?.type === "tool_result" || p?.type === "function_call_output" ? "[tool result]" : "")).filter(Boolean).join(" ");
    return "";
  };
  const items: any[] = Array.isArray(body?.messages) ? body.messages : Array.isArray(body?.input) ? body.input : [];
  if (typeof body?.input === "string") return body.input;
  for (let i = items.length - 1; i >= 0; i--) {
    const m = items[i];
    if (m?.role === "user" || (m?.type === "message" && m?.role === "user")) return textOf(m.content);
    if (m?.role === "tool" || m?.type === "function_call_output") return "[tool result]";
  }
  return "";
}

/** The reply text of a non-streamed response in any of the three shapes. */
export function replyText(reply: any): string {
  const chat = reply?.choices?.[0]?.message?.content;
  if (typeof chat === "string") return chat;
  if (Array.isArray(reply?.content)) return reply.content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("");
  if (Array.isArray(reply?.output)) return reply.output.flatMap((o: any) => (Array.isArray(o?.content) ? o.content : [])).filter((c: any) => c?.type === "output_text").map((c: any) => c.text).join("");
  return "";
}
