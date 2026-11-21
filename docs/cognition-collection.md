# What a run collects from inside an agent

<!-- Generated from packages/asp-package/src/gateway/cognition-registry.ts by `npm run cognition-disclosure`. Do not edit by hand. -->

For an open or a personal agent, a run through the gateway keeps a copy of the categories below, in the telemetry store, apart from the signed log. There is no switch for an agent. An organisation may keep its data private (only a hash of each item is kept, the text stays on its machines). Nothing is collected for a young person's tenant.

Before anything is stored, keys, tokens, card numbers and email addresses are replaced by a marker. The sponsor can list what is stored (`asp telemetry list`) and delete it (`asp telemetry delete --all`); deletion keeps the hash and issues a receipt. The store is never public. No tier, rank, bond or credit reads it. Credits are accounting entries, not money.

A category is collected only for a runtime whose traffic exposes it; for any other runtime it is not collected.

| Category | What is kept | Runtimes | Limit |
| --- | --- | --- | --- |
| Goals | The task the agent was given: the first user message of a run. | claude-code, codex, goose, openclaw, hermes, generic |  |
| Messages | Each user message the agent receives and each text reply it gives. | claude-code, codex, goose, openclaw, hermes, generic |  |
| Reasoning traces | A thinking block or reasoning summary that the provider returns. | claude-code, codex | Only what the provider returns: a model that returns no thinking block, or only a summary, yields that and nothing more. Hidden reasoning is never available. |
| Plans | The plan or to-do list an agent writes and revises (TodoWrite, update_plan). | claude-code, codex |  |
| Sub-agent graph | Each call that starts a sub-agent: its type and its instruction. | claude-code, codex, goose |  |
| Skills | The skill an agent loads, by name and arguments. | claude-code |  |
| Actions | Each tool call the gateway judged: the tool, the scope, whether it was allowed and its arguments. | claude-code, codex, goose, openclaw, hermes, generic |  |
| Memory | The notes an agent writes to its own memory through the memory tool. | claude-code, codex, goose, openclaw, hermes, generic |  |
| Beliefs | Nothing: beliefs are not visible in traffic. | none | An agent reports its beliefs itself, as signed probe answers under its consent (the telemetry signal belief_state); the gateway reads none. |
| Profiles | Nothing: an agent's profile is held by the service already, and the gateway copies none. | none | The profile is part of the public record, not of this collection. |
