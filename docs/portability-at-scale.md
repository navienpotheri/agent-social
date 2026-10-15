# Portability at scale: many runtimes and tools, without an adapter for each

Status: design, 2026-10-15. Asked for by the owner after seeing integration-breadth products list dozens of agents and hundreds of tools. The aim is not to match anyone's connector count; it is that an agent's identity, Mandate, memory and limits go with it to **any** runtime or tool, and that what we claim for each is exactly what a test shows.

## Where we are

Portability today is four hand-written adapters (Claude Code, Codex, Antigravity, OpenHands; `packages/asp-package/src/adapters/`), each with `capture` and `materialize`, plus the gateway, which reaches any agent that can set an OpenAI or Anthropic base URL or an MCP server. Gaps already in the register: only four runtimes have adapters (P1); the Gemini API is not judged (P2, P11); OpenCode fails under the gateway (P10); Aider edits through a text format, so it is observed, not enforced (P12). Writing a new adapter per runtime does not scale and would make claims we cannot back.

## The design in five parts

**1. Three ways to reach a runtime, by cost.** (a) **The gateway**: anything that can point at a base URL. It covers most coding CLIs and costs one row of configuration; enforcement is `gateway_enforced` when the agent uses structured tool calls. (b) **A pre-call hook**: for a runtime that has one (Claude Code, Antigravity); the strongest practical level, `hook_enforced`. (c) **A stream observer**: output is read and violations are detected, not prevented; `runtime_observed`. A runtime is placed on the lowest-cost way that works and is never claimed at a higher level than its test shows.

**2. A declarative runtime descriptor, not a new adapter.** A small data file per runtime: how to detect and launch it, its headless flag, where it reads instructions, skills, MCP configuration and memory (paths and formats), which environment variable points it at a gateway, which hook it supports, and the output parser (if any) for the run log. One generic adapter reads descriptors; code is written only where a runtime has a hook or a stream that needs parsing. Adding a runtime becomes a descriptor plus a conformance run.

**3. A neutral package core.** What an agent carries is runtime-neutral: identity, Mandate, instructions (`AGENTS.md` is the common denominator), skills (the open `SKILL.md` format several runtimes read), MCP servers, memory notes. Each runtime's descriptor says how to lay these out (`CLAUDE.md`, `GEMINI.md`, rules files, a skills folder) and how to read changes back. Every change a runtime makes is a signed lineage edge that records which runtime made it, so an agent that moves keeps its history.

**4. Tools through MCP, with defaults taken from the tool.** Most connectors in the lists people publish (Gmail, Slack, GitHub, Stripe, Notion, Linear, Google Workspace ...) have MCP servers, and the gateway already judges MCP traffic. A Mandate scope per connector, `mcp.<server>.<tool>`, with a default from the tool's own MCP annotations (`readOnlyHint`, `destructiveHint`): read-only tools are allowed, write tools are gated for the person's yes, destructive tools are forbidden unless named. A catalogue of overrides covers connectors whose annotations are missing or wrong. A tool that is not reachable through MCP (a raw HTTP API called by the agent's own code) is covered only by the host and rate limits of the network scope, and the support matrix says so.

**5. A support matrix that is generated, not written.** One row per runtime and per connector family, produced by running the conformance checks: how it is reached (gateway, hook, observer), the highest assurance level the test reached, whether instructions, skills, memory and MCP servers round-trip, whether it can run headless, and the evidence (tested live, by a stand-in, or alpha). "Supported" means a row with evidence; everything else is labelled alpha. This is also the page a developer reads before trusting us with their runtime.

## Order of work

1. The descriptor and the generic adapter, proved by moving two runtimes that already work through the gateway (Codex, Goose) onto it with no behaviour change.
2. Gemini API judgement in the gateway (P2), which unblocks Gemini CLI (P11).
3. OpenCode (P10) and an observed row for Aider (P12), since both are already known.
4. Cursor and Cline as rows: first by what each can be pointed at, then by evidence.
5. MCP annotation defaults and the connector catalogue (part 4).
6. The matrix generator and its page on the site.

Which runtimes come first is the owner's call and should follow what developers at the conference use; my guess, to be corrected, is Claude Code and Codex (done), Gemini CLI, Cursor, Cline and OpenCode.

## What this does not do

It does not build or host connectors, and it does not promise the same depth for every runtime: a hook gives prevention, a base URL gives enforcement of structured calls, an observer gives detection. The point is that the limit travels with the agent and that the claim for each runtime is the true one.

## How it will be tested

Per runtime: a conformance run (a refused call, an allowed call, an approval, a stop, a round trip of instructions, skills, memory and one MCP server) with a stand-in agent in CI and a real one by hand, as in docs/live-run-checklist.md. The matrix is regenerated from those results, and a test fails if it claims a level no check reached.
