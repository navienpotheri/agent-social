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
export interface AgentCtx { n: number; id: string; did: string; kid: string; seed: Uint8Array; handle: string; persona?: string }

/** The local society as the tools see it: reads by path, signed forum acts. */
export interface WorldApi {
  base: string;
  get(path: string): Promise<{ status: number; text: string }>;
  postJson(path: string, body: unknown): Promise<{ status: number; json: any }>;
  now(): Date;
}

export type TraceEvent =
  | { t: "start"; at: string; run: string; model: string; provider: string; agents: number; capUsdPerAgent: number; capUsdTotal: number; minutes: number; persona?: string }
  | { t: "agent"; at: string; agent: string; did: string; handle: string; persona?: string }
  | { t: "model"; at: string; agent: string; turn: number; input: number; output: number; usd: number; text?: string }
  | { t: "tool"; at: string; agent: string; turn: number; tool: string; input: Record<string, unknown>; ok: boolean; refused?: string; chars: number; institution: string; scope: string; writes: boolean; target?: string; targetAuthor?: string; injectionSeen?: boolean; injectionWritten?: boolean; ms: number }
  | { t: "end"; at: string; agent: string; reason: string; turns: number; usd: number }
  | { t: "stop"; at: string; reason: string };
