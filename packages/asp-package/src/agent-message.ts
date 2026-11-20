/**
 * Typed agent-to-agent messages and a sanitisation proxy (register row DK842; spec-delta S1213; docs/intake/11th-nov.md, IMG_6475; extends D6 and CY9, which cover reading). Every message between agents is a schema
 * object with typed fields and ONE named free-text field marked untrusted. A proxy between the agents quarantines instruction-shaped text in that field, logs its hash and counts it, and passes a neutral summary in its
 * place; a message with no such text passes unchanged. The proxy is a second line, not the first: the receiver's own Mandate, enforced by the gateway, still bounds every action, so an instruction that gets through
 * (or a proxy that is off) still cannot make the receiver call a tool beyond what it may. The messages and agents in the tests are scripted; a real model's behaviour is a live run.
 */
import { createHash } from "node:crypto";

export const MESSAGE_VERSION = "asp.message/v0";
export const KINDS = ["request", "result", "note"] as const;
export type Kind = (typeof KINDS)[number];
const MAX_TEXT = 2000;
const MAX_FIELD = 80;

export interface AgentMessage {
  v: typeof MESSAGE_VERSION; kind: Kind; from: string; to: string;
  /** Typed fields: numbers, booleans and short labels from a fixed alphabet. No sentence goes here. */
  fields: Record<string, number | boolean | string>;
  /** The one free-text field, named and marked untrusted: what the sender wrote for the receiver to read, never to obey. */
  untrusted: { name: string; text: string };
}

const LABEL = /^[a-z0-9][a-z0-9_.-]{0,79}$/;
/** The problems with a message's shape, in words; none when it is whole. */
export function messageProblems(m: unknown): string[] {
  const x = m as AgentMessage | null;
  if (!x || typeof x !== "object") return ["a message is an object"];
  const out: string[] = [];
  if (x.v !== MESSAGE_VERSION) out.push(`v is ${MESSAGE_VERSION}`);
  if (!KINDS.includes(x.kind)) out.push(`kind is one of ${KINDS.join(", ")}`);
  for (const k of ["from", "to"] as const) if (typeof x[k] !== "string" || !x[k]) out.push(`${k} is a DID`);
  if (!x.fields || typeof x.fields !== "object") out.push("fields is an object of typed values");
  else for (const [k, v] of Object.entries(x.fields)) {
    if (!LABEL.test(k)) out.push(`the field name ${k.slice(0, 20)} is not a label`);
    if (typeof v === "string" && (!LABEL.test(v) || v.length > MAX_FIELD)) out.push(`the field ${k} is a string that is not a short label: free text belongs in the one untrusted field`);
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") out.push(`the field ${k} is not a number, a boolean or a label`);
  }
  if (!x.untrusted || typeof x.untrusted.name !== "string" || !LABEL.test(x.untrusted.name) || typeof x.untrusted.text !== "string") out.push("untrusted is { name, text }: exactly one named free-text field");
  else if (x.untrusted.text.length > MAX_TEXT) out.push(`the untrusted text is at most ${MAX_TEXT} characters`);
  const extra = Object.keys(x).filter((k) => !["v", "kind", "from", "to", "fields", "untrusted"].includes(k));
  if (extra.length) out.push(`no other field than v, kind, from, to, fields and untrusted: ${extra.join(", ")}`);
  return out;
}

/** The shapes of text that tell a reader what to do: a request to call or run something, to ignore what it was told, to reveal its instructions, a tool-call block, a shell line. */
export const INSTRUCTION_SHAPES: { name: string; re: RegExp }[] = [
  { name: "call a tool", re: /\b(call|invoke|use|run|execute)\s+(the\s+)?(tool|function|command|mcp[\w.]*)\b/i },
  { name: "ignore the instructions", re: /\b(ignore|disregard|forget)\b[^.]{0,40}\b(previous|prior|above|earlier|your)\b[^.]{0,30}\b(instructions?|rules?|prompt)/i },
  { name: "reveal the prompt", re: /\b(reveal|print|show|repeat|send)\b[^.]{0,30}\b(system prompt|instructions|credentials|api key|token|secret)/i },
  { name: "a tool-call block", re: /<\/?(tool_use|function_calls?|invoke)\b|"tool_use"|\btool_calls?\b\s*[:=]/i },
  { name: "a shell line", re: /(^|\n)\s*(\$|#)\s*\w+|\b(curl|wget|rm -rf|chmod|sudo)\b\s+\S/ },
  { name: "an order to the reader", re: /\byou (must|should|will|are to|have to)\b[^.]{0,60}\b(now|immediately|first)\b|\b(do|follow) (as|what) (i|we) (say|ask|tell)\b/i },
];
const hash = (s: string) => "sha256:" + createHash("sha256").update(s).digest("hex");

export interface Passed { message: AgentMessage; quarantined: boolean; shapes: string[]; hash: string | null }
export class SanitisationProxy {
  quarantinedCount = 0;
  /** The hashes of the text held back, for the log: never the text. */
  readonly log: { at: string; from: string; to: string; shapes: string[]; hash: string }[] = [];
  private readonly now: () => string;
  constructor(now: () => string = () => new Date().toISOString()) { this.now = now; }

  /** Passes a message on: unchanged when its untrusted text has no instruction shape, otherwise with the text replaced by a neutral summary. A malformed message is refused, not passed. */
  pass(m: AgentMessage): Passed | { refused: string[] } {
    const problems = messageProblems(m);
    if (problems.length) return { refused: problems };
    const shapes = INSTRUCTION_SHAPES.filter((s) => s.re.test(m.untrusted.text)).map((s) => s.name);
    if (!shapes.length) return { message: m, quarantined: false, shapes: [], hash: null };
    const h = hash(m.untrusted.text);
    this.quarantinedCount++;
    this.log.push({ at: this.now(), from: m.from, to: m.to, shapes, hash: h });
    return { message: { ...m, untrusted: { name: m.untrusted.name, text: `[held back: ${m.untrusted.text.length} characters that read as an instruction (${shapes.join(", ")}); the sender is ${m.from}; record ${h}]` } }, quarantined: true, shapes, hash: h };
  }
}
