# Backlog

Known gaps, grouped by area. Mocks to replace before Stage 2 are in [../MOCKS.md](../MOCKS.md).

## Job lifecycle
- Principal-mode silence counting as acceptance (`review_deadline` is already in the Intent schema)
- Escalation, panel fees and appeals
- Subcontract nesting
- Checking a Mandate against the agent's tier limits

## Registry
- Revoking a node before it expires, and revoking a person's nodes when its keys rotate
- Requiring node keys whenever the actor is a node (a person's own key can still sign for its node)
- Fleet-level (template) reputation

## Packages and `asp run`
- Canary checks in `verify` (a runtime move should pass the canary suite on the new runtime)
- Enforcing probation
- Packages as a single archive file
- Subagent memory (`.claude/agent-memory`) is carried but not wired into runs

## Codex (reported at run time)
- Path-scoped rules are in the prompt with their globs; Codex has no per-file rule loading
- Permission rules are stated, not enforced; Codex enforces only its sandbox and approval policy
- Hooks aren't carried; Codex runs only hooks the user has reviewed and trusted
- Execpolicy `.rules` files are carried in the package but not loaded
- A model packed from another runtime isn't used unless `--model` is given

## OpenHands (reported at run time)
- Its sessions aren't indexed into the package's experience yet
- Path-scoped rules are on-demand skills naming their globs; OpenHands has no path triggers
- Permission rules are stated, not enforced; headless OpenHands auto-approves every action, with the WSL user's full permissions
- Hook events OpenHands lacks are dropped


## Stage 2 / hosted network
- Multi-tenant hosting: today `~/.asp` is single-user, single-machine — one local keystore, one local event log, no auth layer. A hosted network needs per-tenant auth boundaries, data isolation between orgs, rate limits and billing separation. The registry's data model (many persons/orgs/fleets in one log, sponsor-based isolation rules) already supports this; the deployment and auth layer around it does not exist yet.

## Orchestrator (`asp orchestrate`)
- Consolidation is a plain merge (line-union for MEMORY.md, side-by-side keep for conflicting files) — no LLM judge resolves contradictions or dedupes near-duplicate lessons the way the spec's "consolidation step" ultimately should
- No Mandate/Contract wraps a fleet run yet (see MOCKS.md #12), so `nodes.max_parallel` isn't enforced by the registry, only by the CLI's own `--max-parallel`
- Node grants aren't revoked early if a node's task is abandoned; they simply expire
- No retry or backoff for a failed node; a failed task is just reported and excluded from consolidation
