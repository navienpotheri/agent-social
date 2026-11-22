/**
 * The model cohort runner (register row DK1801; docs/society-models-run.md): shared shapes. Credits are accounting entries, not money. Nothing here reads or writes a key: the one key the runner ever sees is the
 * model provider's, read from a named environment variable by `provider.ts` and put only in the request header.
 */

/** One tool the agents are given, in the shape model providers take, plus the permission it needs and the institution it touches (for the observation report). */
export interface ToolDef {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
  /** The permission the agent's Mandate must grant for this tool (read.*, write.forum, ...). */
  scope: string;
  /** Which part of the society the tool touches, for the report. */
  institution: string;
  /** True for a tool that changes something (a post, a vote); the time to the first one is the time to first action. */
  writes?: boolean;
}

export type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
export interface Msg { role: "user" | "assistant"; content: string | Block[] }
export interface ModelReply { blocks: Block[]; usage: { input: number; output: number }; stop: string }

export interface Provider {
  readonly name: string;
  complete(req: { system: string; messages: Msg[]; tools: ToolDef[]; maxTokens: number; signal?: AbortSignal; /** Which agent of the cohort asks (a scripted provider uses it to pick a behaviour). */ agentIndex?: number }): Promise<ModelReply>;
}

/** The agent as the tools see it: a did:key the runner holds the throwaway key for (the key lives in this process only), its handle in the forum and the persona it was given, if any. */
export interface AgentCtx { n: number; id: string; did: string; kid: string; seed: Uint8Array; handle: string; persona?: string; /** ENG50: "sponsored" (a sponsor identity of its own) or "key-only" (names itself as its sponsor). Absent: no kinds in this run. */ kind?: "sponsored" | "key-only"; /** ENG57: the model of this agent when the run mixes models. */ model?: string }

/** The local society as the tools see it: reads by path, signed forum acts. */
export interface WorldApi {
  base: string;
  get(path: string): Promise<{ status: number; text: string }>;
  postJson(path: string, body: unknown): Promise<{ status: number; json: any }>;
  /** The Market hall of the local society (jobs, offers, contracts, credits); absent in a world with no Market. */
  market?: import("./market.ts").MarketHall;
  /** The day cycle of the local society (day-cycle.ts), when the run has one. */
  dayCycle?: import("./day-cycle.ts").DayCycle;
  /** Roles and the Town Hall of the agents (town.ts), when the run has them. */
  town?: import("./town.ts").TownHall;
  /** The games of the local society (games.ts), when the run has them. */
  games?: import("./games.ts").GameHall;
  /** The tool groups this run offers (tools.ts: expedition, games, town, library); undefined: all of them. */
  groups?: ReadonlySet<string>;
  /** The forum post of the Finds thread (a place to say what you came across), when the run has finds to talk about. */
  findsThread?: string;
  /** Course markers scattered over the map (markers.ts), when the run has them. */
  markers?: import("./markers.ts").Markers;
  /** The orientation expedition and the places to discover (expedition.ts), when the run has them. */
  expedition?: import("./expedition.ts").Expedition;
  /** The text workspaces and the library of the local society (library.ts). */
  library?: import("./library.ts").Library;
  /** The house event of the run, when there is one: the words that identify it in a message and the forum post that holds it. */
  event?: { key: string; post: string };
  now(): Date;
  /** The injection proxy's settings (injection.ts); absent: the default, which labels sources and counts instruction-shaped text. */
  guard?: import("./injection.ts").Guard;
}

export type TraceEvent =
  | { t: "start"; at: string; run: string; model: string; provider: string; agents: number; /** Whether identity-derived voices were offered to the agents (voice.ts). */ voices?: boolean; /** The tool groups on in this run and the size of the tool list in characters with them, with the core only and with every group (ENG66). */ toolGroups?: string[]; toolChars?: number; toolCharsCore?: number; toolCharsAll?: number; capUsdPerAgent: number; capUsdTotal: number; minutes: number; persona?: string; /** The names of the tools the agents were offered. */ tools?: string[]; /** The SHA-256 of the briefing (the system prompt) every agent got. */ briefingSha256?: string }  | { t: "agent"; at: string; agent: string; did: string; handle: string; persona?: string; kind?: "sponsored" | "key-only"; model?: string; arm?: "writeback" | "control" }  | { t: "writeback"; at: string; agent: string; tool: string; rule: string; action: "added" | "updated" | "skipped" }  | { t: "writeback_total"; at: string; agent: string; notes: number; shownChars: number }
  | { t: "model"; at: string; agent: string; turn: number; input: number; output: number; cacheRead?: number; cacheWrite?: number; usd: number; text?: string }
  | { t: "tool"; at: string; agent: string; turn: number; tool: string; input: Record<string, unknown>; ok: boolean; refused?: string; chars: number; institution: string; scope: string; writes: boolean; target?: string; targetAuthor?: string; injectionSeen?: boolean; injectionWritten?: boolean; /** A short account of what a read returned (counts only), so the report can say what the agent saw. */ seen?: string; /** Invitations in the first observation of the agent. */ invitations?: number; /** Steps of the first quest done after this call. */ quest?: number; /** Expedition stops the agent has done, set when a stop is newly done. */ expedition?: number; /** A thing found by looking closely or reading a rumour. */ discovery?: string; screen?: import("./injection.ts").ScreenNote; copied?: number; plant?: "seen" | "held" | "followed"; ms: number }
  | { t: "premature_stop_candidate"; at: string; agent: string; via: "leave" | "text" | "stop_exploring"; text: string; simMs?: number }
  | { t: "thinking_dropped"; at: string; agent: string; turn: number; blocks: number; why: "compaction" | "provider_400" }
  | { t: "wake"; at: string; agent: string; simMs: number; because: string; kinds: string[]; events: number; delayedSimMs: number }
  | { t: "arrival"; at: string; agent: string; simMs: number }
  | { t: "leave"; at: string; agent: string; simMs: number; sinceArrivalMs: number; pending: number; afterCheck: boolean; reason: string }
  | { t: "event"; at: string; key: string; post: string }
  | { t: "plant"; at: string; token: string; post: string; mode: string }
  | { t: "end"; at: string; agent: string; reason: string; turns: number; usd: number }
  | { t: "credits"; at: string; agent: string; when: "start" | "end"; balance: number }
  | { t: "stop"; at: string; reason: string };
