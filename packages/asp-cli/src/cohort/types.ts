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
  /** The desert crossing for groups of three (desert.ts), when the run has it; `agents` is how many agents the run has. */
  desert?: import("./desert.ts").Desert;
  agents?: number;
  /** Batch G2: groups of three are assigned by agent number (groups.ts). */
  groupsOfThree?: boolean;
  /** Phase A organisations: a simulation ledger beside the log (orgs.ts), when the run has `--orgs`. */
  orgs?: import("./orgs.ts").OrgLedger;
  /** The longer introduction is in the agents' cached system text, so the short list at the first look is not repeated. */
  longIntro?: boolean;
  /** The games of the local society (games.ts), when the run has them. */
  games?: import("./games.ts").GameHall;
  /** Whether the two true lines about learning and about more to find are shown in the first observation (ENG69); only when the run has markers or the tour. Undefined or true: shown. */
  hintLines?: boolean;
  /** Fold a repeated identical read into one line (diagnosis fix 3); on unless `--no-fold`. */
  foldRepeats?: boolean;
  /** What an agent has used of its own allowance, in USD, and the cap (DK1313); set by the runner from the trace. */
  budgetOf?: (handle: string) => { usedUsd: number; capUsd: number };
  /** The repository pilot (ENG104): a copy of a few files for each agent and the grades; present only with --repo-jobs. */
  repoPilot?: import("./repo-pilot.ts").RepoPilot;
  /** The Town Hall that runs by itself (ENG113): house roles and a clock; present only when the run starts it. */
  townAuto?: import("./town-auto.ts").TownAuto;
  /** Read-only copies of real documents for the repository tasks (ENG84 c); present only with --hard-jobs. */
  repoDocs?: Record<string, { title: string; text: string }>;
  /** Lesson cards through the gate (ENG102, minimal ENG80): present only when the run has them. */
  lessons?: import("./lessons.ts").LessonShelf;
  /** The cohort-only relaxed-limits setting (ENG89): off unless `--relax-limits`. */
  relaxLimits?: boolean;
  /** The house field guide to the most common refusals, and which newcomers are offered it (field-guide.ts); absent: none. */
  fieldGuide?: { guide: import("./field-guide.ts").Guide; offered: (agentN: number) => boolean };
  /** The tool groups this run offers (tools.ts: expedition, games, town, library); undefined: all of them. */
  groups?: ReadonlySet<string>;
  /** The tips of the Finds thread that other agents cited (finds.ts). */
  tips?: import("./finds.ts").Tips;
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
  | { t: "battery"; at: string; agent: string; job: string; firstTry: boolean; access: boolean }
  | { t: "seen"; at: string; agent: string; turn: number; via: string; kind: string; hash: string; text: string }
  | { t: "regression_check"; at: string; agent: string; kind: string; method: string; verdict: string; reasons: string[]; gate: string; applied: boolean; note: string; hash: string; signature?: string }
  | { t: "course_notebook"; at: string; agent: string; course: string; action: "added" | "skipped"; hash: string }
  | { t: "lesson_notebook"; at: string; agent: string; id: string; hash: string; action: "added" | "skipped" }
  | { t: "start"; at: string; run: string; model: string; provider: string; agents: number; /** Whether identity-derived voices were offered to the agents (voice.ts). */ voices?: boolean; /** The tool groups on in this run and the size of the tool list in characters with them, with the core only and with every group (ENG66). */ hintLines?: boolean; toolGroups?: string[]; toolChars?: number; toolCharsCore?: number; toolCharsAll?: number; capUsdPerAgent: number; capUsdTotal: number; minutes: number; persona?: string; /** The names of the tools the agents were offered. */ tools?: string[]; /** The SHA-256 of the briefing (the system prompt) every agent got. */ briefingSha256?: string }  | { t: "writeback"; at: string; agent: string; tool: string; rule: string; action: "added" | "updated" | "skipped" }  | { t: "writeback_total"; at: string; agent: string; notes: number; shownChars: number }  | { t: "agent"; at: string; agent: string; did: string; handle: string; persona?: string; kind?: "sponsored" | "key-only"; model?: string; arm?: "writeback" | "control"; /** ENG75: "access" or "control" in the access experiment. */ access?: "access" | "control" }  | { t: "signal"; at: string; agent: string; kind: "plans" | "memory" | "rules" | "modes" | "predictions" | "beliefs" | "worldmodel"; turn: number; id: string; /** Whole numbers only (ENG71): never text. */ n: Record<string, number> }  | { t: "accredited"; at: string; agent: string; course?: string }  | { t: "model"; at: string; agent: string; turn: number; input: number; output: number; cacheRead?: number; cacheWrite?: number; usd: number; text?: string; /** ENG70: the provider's returned snapshot, a hash of its response id, a hash of the tool definitions sent, the size of the thinking returned. */ snapshot?: string; idHash?: string; toolsHash?: string; thinkingBlocks?: number; thinkingChars?: number }  | { t: "provenance"; at: string; model: string; settings: Record<string, string | number> }  | { t: "provenance_change"; at: string; agent: string; turn: number; what: "model_snapshot" | "tool_definition" | "tool_added" | "tool_removed"; name: string; from?: string; to?: string }  | { t: "tool"; at: string; agent: string; turn: number; tool: string; input: Record<string, unknown>; ok: boolean; refused?: string; chars: number; institution: string; scope: string; writes: boolean; /** The checker's verdict on the result, where the tool has one (outcomes.ts); absent: not measurable. */ outcome?: "pass" | "fail"; target?: string; targetAuthor?: string; injectionSeen?: boolean; injectionWritten?: boolean; /** A short account of what a read returned (counts only), so the report can say what the agent saw. */ seen?: string; /** Invitations in the first observation of the agent. */ invitations?: number; /** Steps of the first quest done after this call. */ quest?: number; /** Expedition stops the agent has done, set when a stop is newly done. */ expedition?: number; /** A thing found by looking closely or reading a rumour. */ discovery?: string; screen?: import("./injection.ts").ScreenNote; copied?: number; plant?: "seen" | "held" | "followed"; ms: number }
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
