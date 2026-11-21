/**
 * The cognition tap of a gateway run (register row DK79). It reads what the gateway already sees (the messages, the model's thinking blocks, each judged tool call) and keeps, per category of the registry
 * and only for a runtime that exposes the category, a scrubbed copy to hand to the telemetry store at the end of the run. Scrubbing (`redactDeep`: keys, tokens, card numbers, email addresses) happens
 * HERE, before anything leaves this object. Nothing is kept for a young person's tenant, and a tap that is `enabled: false` reads nothing. The items are never written to the signed log: the caller stores
 * them in the telemetry store (apart from the log, listable and deletable by the sponsor, never public) and the log may carry only their hashes. Credits are accounting entries, not money.
 */
import { createHash } from "node:crypto";
import { redactDeep } from "./outbound-scan.ts";
import { categoryById, categoriesFor, COGNITION_CATEGORIES } from "./cognition-registry.ts";

export interface CognitionItem { category: string; kind: string; content: string }
export interface CognitionOptions {
  /** The runtime name, as in `asp runtimes`; decides which categories the gateway may collect. */
  runtime: string;
  /** False for a young person's tenant (nothing at all) or when collection does not apply. */
  enabled?: boolean;
  /** The most items kept per run, and the most characters per item. */
  maxItems?: number; maxChars?: number;
  at?: () => string;
}

const PLAN = /^(todowrite|todo_write|update_plan|taskcreate|task_create|taskupdate|task_update|write_todos)$/i;
const SPAWN = /(^|[_.])(task|agent|spawn_agent|subagent|sub_agent|delegate)$/i;
const SKILL = /(^|[_.])skill$/i;
const MEMORY = /memory_(write|save|add|update)|^memory$/i;

export class CognitionTap {
  private items: CognitionItem[] = [];
  private seen = new Set<string>();
  private counts: Record<string, number> = {};
  private redactions: Record<string, number> = {};
  private goalSeen = false;
  private step = 0;
  private readonly on: boolean;
  private readonly allowed: Set<string>;
  private readonly maxItems: number;
  private readonly maxChars: number;
  private readonly o: CognitionOptions;
  constructor(o: CognitionOptions) {
    this.o = o;
    this.on = o.enabled !== false;
    this.allowed = new Set(categoriesFor(o.runtime).map((c) => c.id));
    this.maxItems = o.maxItems ?? 400;
    this.maxChars = o.maxChars ?? 20_000;
  }

  /** The categories this run collects. */
  get categories(): string[] { return this.on ? [...this.allowed] : []; }

  private add(category: string, body: Record<string, unknown>): void {
    if (!this.on || !this.allowed.has(category) || this.items.length >= this.maxItems) return;
    const cat = categoryById(category)!;
    const scrubbed = redactDeep({ category, step: this.step, ...body });
    for (const h of scrubbed.hits) this.redactions[h.kind] = (this.redactions[h.kind] ?? 0) + 1;
    let content = JSON.stringify(scrubbed.value);
    if (content.length > this.maxChars) content = JSON.stringify({ ...(scrubbed.value as object), truncated: true, ...Object.fromEntries(Object.entries(scrubbed.value as Record<string, unknown>).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, Math.floor(this.maxChars / 2)) : v])) }).slice(0, this.maxChars);
    const key = createHash("sha256").update(category + content).digest("hex");
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.items.push({ category, kind: cat.kind, content });
    this.counts[category] = (this.counts[category] ?? 0) + 1;
  }

  /** A model request: the task (once) and the newest user message. `api` is the wire the request used. */
  observeRequest(body: any): void {
    if (!this.on) return;
    const msgs: any[] = Array.isArray(body?.messages) ? body.messages : Array.isArray(body?.input) ? body.input : [];
    const text = (m: any): string => typeof m?.content === "string" ? m.content : Array.isArray(m?.content) ? m.content.filter((b: any) => b?.type === "text" || b?.type === "input_text").map((b: any) => b.text ?? "").join("\n") : "";
    const users = msgs.filter((m) => m?.role === "user" && text(m));
    if (!users.length) return;
    if (!this.goalSeen) { this.goalSeen = true; this.add("goals", { task: text(users[0]) }); }
    this.add("messages", { role: "user", text: text(users[users.length - 1]) });
  }

  /** A model reply: the text, and any thinking or reasoning summary the provider returned. */
  observeReply(o: { text?: string; thinking?: string }): void {
    if (o.text) this.add("messages", { role: "assistant", text: o.text });
    if (o.thinking) this.add("reasoning", { text: o.thinking });
  }

  /** A judged tool call, in order. Arguments are scrubbed like everything else. */
  observeCall(c: { name: string; args: unknown; scope: string; allowed: boolean }): void {
    if (!this.on) return;
    this.step++;
    const args = c.args as Record<string, unknown> | undefined;
    this.add("actions", { tool: c.name, scope: c.scope, allowed: c.allowed, args });
    if (!c.allowed) return;
    if (PLAN.test(c.name)) this.add("plans", { tool: c.name, plan: args });
    else if (SPAWN.test(c.name)) this.add("subagents", { tool: c.name, type: args?.subagent_type ?? args?.agent ?? args?.type, description: args?.description, instruction: args?.prompt ?? args?.instruction ?? args?.task });
    else if (SKILL.test(c.name)) this.add("skills", { skill: args?.skill ?? args?.name, args: args?.args });
    else if (MEMORY.test(c.name)) this.add("memory", { tool: c.name, args });
  }

  summary(): { status: string; categories: Record<string, number>; redactions: Record<string, number> } {
    return { status: this.on ? "cognition: on" : "cognition: off", categories: { ...this.counts }, redactions: { ...this.redactions } };
  }

  /** The scrubbed items, once: the caller hands them to the telemetry store. */
  drain(): CognitionItem[] { const out = this.items; this.items = []; return out; }
}

export const COGNITION_CATEGORY_IDS = COGNITION_CATEGORIES.map((c) => c.id);

/** The thinking blocks (Anthropic) and reasoning summaries (OpenAI Responses) of a reply that is not streamed. */
export function thinkingOf(reply: any): string {
  const parts: string[] = [];
  if (Array.isArray(reply?.content)) for (const b of reply.content) if (b?.type === "thinking" && typeof b.thinking === "string") parts.push(b.thinking);
  if (Array.isArray(reply?.output)) for (const o of reply.output) if (o?.type === "reasoning" && Array.isArray(o.summary)) for (const s of o.summary) if (typeof s?.text === "string") parts.push(s.text);
  return parts.join("\n");
}
