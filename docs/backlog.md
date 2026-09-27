# Backlog

Known gaps, grouped by area. Mocks to replace before Stage 2 are in [../MOCKS.md](../MOCKS.md).

## Job lifecycle
- Principal-mode silence counting as acceptance (`review_deadline` is already in the Intent schema)
- Escalation, panel fees and appeals
- Subcontract nesting
- Checking a Mandate against the agent's tier limits

## Registry
- ~~Revoking a node before it expires, and revoking a person's nodes when its keys rotate~~ — done: a second Node record chained onto the first (`prev` = its id) is an update; setting `expires` at or before `issued_at` revokes it immediately (`revokedAt` is set, so the key becomes entirely unresolvable, not merely expired). Dropping a passport key now also revokes every one of that person's live node keys, since the delegations were made under a key that's being retired.
- Requiring node keys whenever the actor is a node (a person's own key can still sign for its node) — left as is; tightening this could break legitimate recovery (a person acting as its own node when a delegated key is lost), so it needs a decision, not just a change.
- Fleet-level (template) reputation — needs AgentRank/Attestations infrastructure; Stage 2.

## Packages and `asp run`
- Canary checks in `verify` (a runtime move should pass the canary suite on the new runtime) — blocked on the Academy/canary suite existing at all; Stage 2.
- Enforcing probation — D2 is decided (7 days; force `self_modification` to `principal_approves`) and the registry now tracks each DID's current probation window (`EventLog.probation(did)`). Still blocked on a self-modification pathway existing at all to enforce it on — there is none yet.
- ~~Packages as a single archive file~~ — done: `asp pack --out foo.aspkg.tgz` (or `.tar.gz`) produces one gzipped tar file; `verify`, `run` and `orchestrate` all accept either a directory or an archive, extracting to a temp directory and (for `run`/`orchestrate`, only after a successful write-back) re-packing it in place.
- Subagent memory (`.claude/agent-memory`) is captured into the package but not wired into runs. Claude Code only reads it from `.claude/agent-memory/` inside the actual project directory, not from an added directory — wiring it in would mean writing into the target project, which breaks the "run never writes into the project" guarantee. Left undone rather than building a fragile workaround.

## Codex (reported at run time)
- Path-scoped rules are in the prompt with their globs; Codex has no per-file rule loading
- Permission rules are stated, not enforced; Codex enforces only its sandbox and approval policy
- Hooks aren't carried; Codex runs only hooks the user has reviewed and trusted
- Execpolicy `.rules` files are carried in the package but not loaded
- A model packed from another runtime isn't used unless `--model` is given

## OpenHands (reported at run time)
- Its sessions aren't indexed into the package's experience: OpenHands' own conversation store (`~/.openhands/conversations/<id>/base_state.json` and its `ConversationMetadata`) records no working directory or project association at all, unlike Claude Code (nests conversations under a directory named for the project) and Codex (`session_meta.cwd` in every rollout). There's no reliable way to tell which of a user's past OpenHands sessions belong to a given project, so indexing them would mean guessing (wrong) or scanning event content for file paths (fragile and expensive). Sessions `asp run`/`orchestrate` start themselves are already isolated per run (`OPENHANDS_CONVERSATIONS_DIR` points at the run folder), so this only affects capturing a project's pre-existing history.
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
