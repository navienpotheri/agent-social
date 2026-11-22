# The model-backed society cohort: the interface between the driver and the society tools (DK1801)

Status: proposed 2026-11-22 by lane-cli-3 (the driver) for lane-society-2 (the tools and the observation harness). The owner's decisions: model `claude-haiku-5-5`, 15 agents, USD 0.40 for each agent and USD 6 in all, no goal, a local service. Credits are accounting entries, not money; the dollar figures are an estimate from the tokens each reply reports, never a bill; this is a beta with no outside security review; nothing in the run claims that agents become more aligned.

## Who owns what

| | lane-cli-3 (the driver) | lane-society-2 (the tools and the harness) |
|---|---|---|
| Files | `packages/asp-package/src/cohort/driver.ts`, `runner.ts`, their tests | `packages/asp-package/src/cohort/tools.ts` (or wherever the set lives), the harness, the observation output |
| What it does | the loop that talks to the model through a gateway, the limits, the retries, the stop, the cost | the tools an agent may call, what each does in the local society, the system text for each agent, what is recorded |

## The tool set (what society-2 provides)

```ts
export interface SocietyTool {
  /** 1 to 40 characters of a-z 0-9 _ ; the model sees it as `mcp__society__<name>` and the gateway judges the scope `mcp.society.<name>`. */
  name: string;
  /** What it does, in words the model can use. */
  description: string;
  /** A JSON Schema object for the input (type: "object"). */
  input_schema: Record<string, unknown>;
  /** Runs one call for one agent. It must not throw: a failure is { ok: false, text }. `text` is what the model reads next (cut by the driver at maxResultChars). */
  run(args: Record<string, unknown>, ctx: { agent: string; turn: number; now: () => string }): Promise<{ ok: boolean; text: string }>;
}
export interface SocietyToolSet {
  tools: SocietyTool[];
  /** The system text for this agent: who it is, where it is, what it may do. No goal is given (the owner's decision). */
  system(agent: string): string;
  /** The first user message of an agent's loop (what it sees on arrival). */
  opening(agent: string): string;
}
```

Rules the driver relies on:

1. A tool never gets the model's key, the provider's URL, a file path outside the cohort's run folder or any host: the tools act on the local society only.
2. `run` is deterministic given the society's state and the arguments, and bounded in time (the driver gives it 30 seconds, then answers the model `{ ok: false, text: "the tool timed out" }`).
3. The tool names are fixed for the whole run: the gateway's Mandate lists `mcp.society.<name>` for exactly these names, so a tool the model invents is refused by the gateway and never reaches `run`.
4. Everything the harness wants to observe goes through the tool results and the driver's events (below); the driver records nothing about the society itself.

## The driver (what lane-cli-3 provides)

```ts
export interface AgentLimits { usd: number; maxTokens: number; maxTurns: number; wallClockMs: number; maxResultChars: number }
export interface AgentOutcome {
  agent: string; turns: number; toolCalls: number; refused: number;
  tokens: { input: number; output: number }; usd: number;        // from the gateway's own count of the replies' usage
  stopped: "finished" | "usd_cap" | "token_cap" | "max_turns" | "wall_clock" | "stopped" | "provider_error" | "loop_breaker" | "gateway_stopped";
  detail?: string; runLog?: string;
}
export type DriverEvent =
  | { kind: "turn"; agent: string; turn: number; usd: number; tokens: number }
  | { kind: "tool"; agent: string; turn: number; tool: string; ok: boolean; refused: boolean }
  | { kind: "text"; agent: string; turn: number; text: string }          // what the model said (observation only)
  | { kind: "retry"; agent: string; status: number; waitMs: number; attempt: number }
  | { kind: "end"; agent: string; outcome: AgentOutcome };

runAgent(o: { agent: string; toolset: SocietyToolSet; model: string; gatewayUrl: string; limits: AgentLimits; signal: AbortSignal; onEvent?: (e: DriverEvent) => void }): Promise<AgentOutcome>
runCohort(o: { agents: string[]; toolsetFor(agent: string): SocietyToolSet; model: string; keyEnv: string; perAgentUsd: number; totalUsd: number; parallel?: number; limits?: Partial<AgentLimits>; runDir: string; signal: AbortSignal; onEvent?: (e: DriverEvent) => void; upstream?: string }): Promise<{ outcomes: AgentOutcome[]; usd: number; stopped: string }>
```

What `runCohort` does for each agent: starts one gateway in this process (`createGateway`) with the Anthropic key from the environment variable named by `keyEnv` (read once, held in memory, never written, never logged, never in the run log), `usdCap = perAgentUsd`, a token cap, loop limits, the scopes `mcp.society.<name>` for the tool set and nothing else, a run log in `runDir`, and the dollar estimate from the real usage of each reply. The agent loop calls `POST <gateway>/v1/messages` with the tools declared as `mcp__society__<name>`, runs each `tool_use` the gateway let through with `run`, and sends the `tool_result` back. When the cohort's total reaches `totalUsd` every agent stops (`usd_cap`). A 429, a 529 or a 5xx from the provider is retried up to 4 times with the provider's `retry-after` (at most 60 seconds) or 2, 4, 8, 16 seconds; after that the agent stops with `provider_error`. The abort signal stops every loop at its next turn and aborts the call in flight; `asp stop --all` reaches it through the session the command registers.

## What I need from society-2

1. Agree or change the tool interface above (reply by message with the diff you want).
2. The names, descriptions and schemas of the tools, and the system and opening text.
3. Where the observation harness reads from: the `DriverEvent` stream, the tool results, or both.
4. Whether the 15 agents share one local society (one service) and so one `toolsetFor` closure over it (my assumption).

## Honest limits

The stand-in provider is what the tests use: no key, no network. The first real run is the owner's, with a key in an environment variable of the owner's own process. The gateway reads tool calls; it is not a sandbox, and the tools are the only means an agent has.

## What is built (2026-11-22)

`packages/asp-package/src/cohort/driver.ts` (the loop), `runner.ts` (one gateway for each agent, the total cap), `packages/asp-cli/src/cohort-cmd.ts` (`asp cohort run`: the plan, `--yes`, the session for `asp runs` and `asp stop --all`); tests `packages/asp-package/test/cohort-driver.test.ts` and `packages/asp-cli/test/cohort-cmd.test.ts` against a stand-in provider (a toy tool set stands in for the society worker's). Mutation round on the driver: 18 mutants, one equivalent (an abort check that the wall-clock check repeats), the rest killed.

Limits found while building it: the gateway answers a provider's 429 without forwarding the `retry-after` header, so the loop waits 2, 4, 8 and 16 seconds (it reads the header when it is present); a refused call comes back to the model as text beginning `[ASP]` and the loop tells the model its call was not run (the gateway's strikes, 5 here, and the loop breaker stop one that keeps trying); an agent that answers with no tool call has finished.
