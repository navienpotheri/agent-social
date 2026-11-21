/**
 * The categories of what happens inside an agent that a gateway run collects (register row DK79, owner decision of 2026-11-21: broad, always on for open and personal agents; an enterprise may keep its data
 * private, DK1360; nothing for a young person's tenant). This list is data: the tap reads it, the disclosure document is generated from it (docs/cognition-collection.md) and a test compares the document, the
 * registry and the code, so a category cannot be collected without being disclosed. A category is collected only for a runtime that exposes it to the gateway; the others are simply not collected.
 * The gateway sees the traffic between an agent and its model and the tool calls it judges, nothing else: it never sees hidden reasoning, only what the provider returns (a thinking block, a reasoning summary).
 */
import type { TelemetryKind } from "@agent-social/asp-log";

export interface CognitionCategory {
  id: string;
  /** The kind the content is stored under in the telemetry store. */
  kind: TelemetryKind;
  title: string;
  /** What exactly is kept, in plain words. */
  what: string;
  /** Runtimes (names as in `asp runtimes`) whose traffic exposes the category to the gateway. Empty: the gateway collects nothing of it. */
  exposedBy: string[];
  /** Where the content comes from in the traffic. */
  source: string;
  /** Why a category is empty or limited, when it is. */
  limit?: string;
}

/** Runtimes reached through the gateway; a runtime held by its own hook shows the gateway no model traffic. */
/** `generic` is any other agent pointed at the gateway: it exposes the categories every tool-using agent shows. */
export const GATEWAY_RUNTIMES = ["claude-code", "codex", "goose", "openclaw", "hermes", "generic"];
const TOOL_USERS = GATEWAY_RUNTIMES;

export const COGNITION_CATEGORIES: CognitionCategory[] = [
  { id: "goals", kind: "goal", title: "Goals", what: "The task the agent was given: the first user message of a run.", exposedBy: GATEWAY_RUNTIMES, source: "the first model request of a run" },
  { id: "messages", kind: "message", title: "Messages", what: "Each user message the agent receives and each text reply it gives.", exposedBy: GATEWAY_RUNTIMES, source: "model requests and replies" },
  { id: "reasoning", kind: "reasoning", title: "Reasoning traces", what: "A thinking block or reasoning summary that the provider returns.", exposedBy: ["claude-code", "codex"], source: "model replies", limit: "Only what the provider returns: a model that returns no thinking block, or only a summary, yields that and nothing more. Hidden reasoning is never available." },
  { id: "plans", kind: "plan", title: "Plans", what: "The plan or to-do list an agent writes and revises (TodoWrite, update_plan).", exposedBy: ["claude-code", "codex"], source: "tool calls named like a plan tool" },
  { id: "subagents", kind: "subagent", title: "Sub-agent graph", what: "Each call that starts a sub-agent: its type and its instruction.", exposedBy: ["claude-code", "codex", "goose"], source: "tool calls named like a spawn tool" },
  { id: "skills", kind: "skill", title: "Skills", what: "The skill an agent loads, by name and arguments.", exposedBy: ["claude-code"], source: "calls of a skill tool" },
  { id: "actions", kind: "action", title: "Actions", what: "Each tool call the gateway judged: the tool, the scope, whether it was allowed and its arguments.", exposedBy: TOOL_USERS, source: "every judged tool call" },
  { id: "memory", kind: "memory", title: "Memory", what: "The notes an agent writes to its own memory through the memory tool.", exposedBy: TOOL_USERS, source: "calls of a memory-write tool" },
  { id: "beliefs", kind: "text", title: "Beliefs", what: "Nothing: beliefs are not visible in traffic.", exposedBy: [], source: "none", limit: "An agent reports its beliefs itself, as signed probe answers under its consent (the telemetry signal belief_state); the gateway reads none." },
  { id: "profiles", kind: "text", title: "Profiles", what: "Nothing: an agent's profile is held by the service already, and the gateway copies none.", exposedBy: [], source: "none", limit: "The profile is part of the public record, not of this collection." },
];

export const categoryById = (id: string): CognitionCategory | undefined => COGNITION_CATEGORIES.find((c) => c.id === id);
/** The categories the gateway collects for a runtime (those with a source in its traffic). */
export const categoriesFor = (runtime: string): CognitionCategory[] => COGNITION_CATEGORIES.filter((c) => c.exposedBy.includes(runtime));

/** The text of docs/cognition-collection.md, generated from the registry. */
export function cognitionDisclosure(): string {
  const rows = COGNITION_CATEGORIES.map((c) => `| ${c.title} | ${c.what} | ${c.exposedBy.length ? c.exposedBy.join(", ") : "none"} | ${c.limit ?? ""} |`);
  return [
    "# What a run collects from inside an agent",
    "",
    "<!-- Generated from packages/asp-package/src/gateway/cognition-registry.ts by `npm run cognition-disclosure`. Do not edit by hand. -->",
    "",
    "For an open or a personal agent, a run through the gateway keeps a copy of the categories below, in the telemetry store, apart from the signed log. There is no switch for an agent. An organisation may keep its data private (only a hash of each item is kept, the text stays on its machines). Nothing is collected for a young person's tenant.",
    "",
    "Before anything is stored, keys, tokens, card numbers and email addresses are replaced by a marker. The sponsor can list what is stored (`asp telemetry list`) and delete it (`asp telemetry delete --all`); deletion keeps the hash and issues a receipt. The store is never public. No tier, rank, bond or credit reads it. Credits are accounting entries, not money.",
    "",
    "A category is collected only for a runtime whose traffic exposes it; for any other runtime it is not collected.",
    "",
    "| Category | What is kept | Runtimes | Limit |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}
