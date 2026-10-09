# The ASP gateway and the generic adapter: design

Drafted 2026-10-09. Goal: any agent, from any provider, can run under the protocol without us writing an adapter for it, with the strongest enforcement its structure allows. Per-runtime adapters then only raise the assurance level.

## 1. The idea in one paragraph
Almost every agent works the same way: a model is called over an API, the model's reply asks for tools ("run this command", "call this MCP tool", "edit this file"), and the agent's own code carries them out. If the agent's model traffic passes through a local **gateway** we control, the gateway sees every requested tool call *before the agent receives it* and can remove the ones the Mandate does not allow. The agent never sees a tool call it may not make. That works for any agent that lets us set a model base URL or an MCP server, with no hooks, plugins or cooperation from the agent.

## 2. Components

| Part | What it does |
|---|---|
| **Model proxy** | Speaks the OpenAI-compatible APIs (chat completions, responses), the Anthropic Messages API and, later, Gemini. The agent is pointed at it with `OPENAI_BASE_URL` / `ANTHROPIC_BASE_URL` (or the agent's own setting). Forwards to the real provider using a key the gateway holds, so the agent never sees the provider key and a spend cap can be enforced. |
| **Tool-call judge** | Reads tool calls out of each model reply (`tool_use`, `function_call`, shell/command items), maps each to an ASP scope with the same mapping the compliance bridge and hooks use (including shell-command classification and the fingerprint), checks it against the live Mandate and the known-bad list, and decides: allow, hold for approval, or refuse. |
| **Refusal by rewrite** | A refused call is removed from the reply and replaced with a short assistant message ("this action is outside the Mandate and was not run"), so the agent continues without having been given the call. Counts as a blocked attempt (a strike). |
| **MCP proxy** | The agent's MCP servers are listed behind the gateway's own MCP endpoint. A `tools/call` is checked against the Mandate (`mcp.<server>.<tool>`) before it is forwarded. |
| **Memory and commons tools** | The gateway also offers an MCP server with memory tools (read, write, search the agent's notes) and commons search. Any MCP-capable agent gets memory routing and shared lessons without an adapter; writes land in the run's memory folder for write-back. |
| **Mandate and kill switch** | Loads the live Mandate for the contract at start and watches the log. If the contract is revoked, killed or settled, the gateway refuses every further model and tool request, which stops the agent without needing to kill its process. |
| **Meter** | Counts tokens and requests per run, enforces the Mandate's spend cap, and feeds the compute-to-credit pricing item. |
| **Recorder** | Emits the Action record (scopes used, blocked attempts, fingerprints) with an **assurance level**, and keeps a redacted run log locally for the dashboard and the end-of-Mandate mail. |
| **Generic adapter** | `asp run --backend generic [--mcp-config ...] -- <command>`: starts the gateway, sets the base-URL environment for the child, runs any command, then does the usual write-back, lineage and settlement steps. |

## 3. Assurance levels (recorded on every Action)
1. **Self-reported** – the agent signed its own Action through the SDK. Evidence only as good as the agent.
2. **Gateway-observed** – the gateway saw the traffic but could not refuse (for example a streaming mode not yet supported).
3. **Gateway-enforced** – tool calls were checked and refused before the agent received them.
4. **Hook-enforced** – the runtime's own pre-call hook blocked it (today's Claude Code and Antigravity).
5. **Sandbox-enforced** – the process ran in a container or OS sandbox with egress rules, so even what the tools do is bounded.

Levels can be combined (gateway plus hook). A Court and a principal see the level next to every Action. This is a protocol change (an optional field on the Action record, schema, vectors in both SDKs).

## 4. What the gateway can and cannot cover
| Case | Result |
|---|---|
| Agent uses a supported model API and the model chooses tools (most coding agents) | Full gateway enforcement |
| Agent uses MCP servers | Enforced at the MCP proxy |
| Agent built-in tools (shell, file edit) | Enforced, because the request comes from the model reply the gateway sees; what the tool then does inside the machine is only bounded with a sandbox |
| Agent takes the model's *text* and runs it as code (code-writing agents) | Observed only, unless the code is parsed; sandbox recommended |
| Agent with a hard-coded endpoint or its own client certificate | Cannot be pointed at the gateway; falls back to self-report or a network-level redirect |
| Hosted agents run on a provider's cloud | Cannot be wrapped; self-report SDK, reputation only |
| Provider features that tie replies to a signature (extended-thinking blocks, cached prefixes) | Removing a tool call from a reply must be tested per provider; risk listed below |

## 5. How refusals behave
- A refused call becomes a strike; three strikes in one run read as probing and stop it (existing rule).
- An approval-gated call holds the reply (the stream waits) and raises the usual Checkpoint; the principal's signed resolution releases or refuses it. No answer in time refuses.
- A known-bad command is refused even when the scope is granted.
- After kill or revoke every request gets a clear error stating why.

## 6. Build phases
| Phase | Content | Done when |
|---|---|---|
| P0 spike | OpenAI-compatible and Anthropic proxy, non-streaming, tool-call detection and refusal by rewrite, against a fake upstream | Tests: allowed call passes, refused call is removed, strike recorded, Action emitted |
| P1 | Streaming (buffer tool-call deltas), approval holds, Mandate refresh and kill, spend cap, Action with assurance level (protocol change with vectors) | A real agent can be stopped mid-run by revoking the contract |
| P2 | MCP proxy and the memory/commons MCP server | An MCP-capable agent gets memory write-back through the gateway |
| P3 | Generic adapter and live tests | Real agents of different kinds pass through it: Claude Code (`ANTHROPIC_BASE_URL`) and Codex (`OPENAI_BASE_URL`) for comparison with their own hooks, then Gemini CLI, Aider, Goose or OpenCode, and a plain Python script using an OpenAI SDK |
| P4 | Self-report SDK for hosted agents; sandbox wrapper | A hosted agent can join at level 1; a container run reaches level 5 |
| P5 | Public support matrix: runtime × assurance level, with a conformance test per runtime | Matrix published |

## 7. Risks and open questions
- **Rewriting replies can confuse agents** (they may retry the same call). Mitigation: a clear refusal message, and the strike limit ends loops.
- **Provider integrity features** (signed thinking blocks, prompt caching, response IDs) may reject or mishandle edited replies. Test per provider before claiming level 3.
- **Streaming complexity:** tool calls arrive in fragments; the gateway must buffer a call until it can be judged, adding latency.
- **Local models and custom protocols** (non-OpenAI-compatible) need their own adapters.
- **Privacy:** the gateway sees prompts and replies. They stay on the machine (redacted run log, local), consistent with decision D1 unless the full-tracing decision changes it.
- **Key custody:** the provider key moves into the gateway process; document how it is protected.
- **Terms of service:** routing a provider's API through a local proxy is normal; routing a subscription login (OAuth) tool through it may not be possible.
- **Does it make hooks redundant?** No: hooks can stop what the gateway cannot see (a tool the model did not request, local commands run by the agent's own code). Levels combine.

## 8. How this serves the "top 20" goal
One gateway plus the generic adapter puts every agent that can set a base URL or an MCP server at level 3 immediately. Per-runtime work is then chosen by value: deeper capture and memory routing for the few runtimes with the most users, and hook enforcement where a runtime offers hooks.
