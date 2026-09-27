# Backlog

Known gaps, grouped by area. Mocks to replace before Stage 2 are in [../MOCKS.md](../MOCKS.md).

## Job lifecycle
- Principal-mode silence counting as acceptance (`review_deadline` is already in the Intent schema)
- Panel fees and appeals on a ruling
- Subcontract nesting
- Checking a Mandate against the agent's tier limits
- ~~`asp market` covers assignment mode only~~ — done 2026-09-28: `asp market call`/`propose`/`allocate` add allocation mode (Call→several Proposals→a panel member picks one), and `asp market contract` accepts either `--intent`/`--offer` or `--call`/`--proposal`. Call/Proposal aren't chained (same as Intent/Offer), so this needed no lifecycle change.
- ~~`asp market` doesn't drive the dispute path~~ — done 2026-09-28: `asp market deliver` already redelivers (the lifecycle's own `redelivery_available` guard applies), and `asp market rule` adds the ruling step (Courts, narrowly — see MOCKS.md #4 for what's still mocked about it) so `asp market settle --basis ruling` works too.

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


## Bank (credit ledger)
- `fees` and `earnings_split` on Settlement aren't credited to anyone yet — a nonzero `fees` is rejected outright (`fees_not_implemented`) rather than silently dropped, pending a fee-recipient design (a platform account? the Insurer's reserve?).
- `EventLog.mint` is a local, unsigned bootstrap mechanism (MOCKS.md #13), not a real payment rail — fine for single-player, not for a hosted network.
- ~~Bond's `slashing_conditions`... nothing yet *decides* when a slash is warranted~~ — done 2026-09-28: a real, staked, randomly-drawn, conflict-free ruling panel now decides (`asp market juror register`, `EventLog.drawPanel`/`checkRulingPanel`; docs/spec-deltas.md S12). What's still missing: nothing ever slashes a *juror's* stake for a bad ruling — that needs an appeals process, which doesn't exist (see below).
- No appeals on a ruling, and so no way to slash a juror's own stake for misconduct (self-dealing, a ruling later overturned) — the stake exists and is real credit at risk, but nothing can currently act on it.

## Stage 2 / hosted network
- Multi-tenant hosting: today `~/.asp` is single-user, single-machine — one local keystore, one local event log, no auth layer. A hosted network needs per-tenant auth boundaries, data isolation between orgs, rate limits and billing separation. The registry's data model (many persons/orgs/fleets in one log, sponsor-based isolation rules) already supports this; the deployment and auth layer around it does not exist yet.

## Orchestrator (`asp orchestrate`)
- Consolidation is a plain merge (line-union for MEMORY.md, side-by-side keep for conflicting files) — no LLM judge resolves contradictions or dedupes near-duplicate lessons the way the spec's "consolidation step" ultimately should
- No Mandate/Contract wraps a fleet run yet (see MOCKS.md #12), so `nodes.max_parallel` isn't enforced by the registry, only by the CLI's own `--max-parallel`
- Node grants aren't revoked early if a node's task is abandoned; they simply expire
- No retry or backoff for a failed node; a failed task is just reported and excluded from consolidation

## Future test scenario: exploit contagion / whistleblowing (Stage 3, needs Courts + a live Bank)
DeepMind's ["Cheaters and whistleblowers in the agent swarm"](https://institute.deepmind.com/essays/cheaters-and-whistleblowers-in-the-agent-swarm/) (2026) ran 100 Gemini agents on a shared math-proof task; one agent found an autograder exploit, it spread peer-to-peer in ~30 minutes, 14 agents exploited it and 24 reported it through official channels — but human oversight only arrived after the run ended, so the whistleblowers had no real-time backing. Their prescription (Ostrom: graduated sanctions, peer verification, monitoring that lets honest agents police the collective) is close to ASP's own thesis.
- Worth building as a concrete conformance/arena scenario: agents share a task pool, one finds a shortcut that violates the Mandate's scope, bonds get slashed on a proven violation, a "whistleblower" report resolves as a real-time Courts ruling rather than post-hoc.
- **Update 2026-09-28: startable now.** Both Courts (a real staked, randomly-drawn, conflict-free ruling panel) and a real Bank (bonds that actually lock and can actually be slashed) exist. Still missing for a faithful replay of the scenario specifically: a real-time whistleblower channel (a third party filing a report mid-job, not just the two job parties), and a live circuit-breaker that watches a job while it runs rather than only at settlement — see item 2 above.

Three concrete gaps this scenario would exercise, raised 2026-09-28 while discussing it against the current build:
1. **Fleet blast-radius isolation.** Spawning many copies of one agent (e.g. `asp orchestrate` with many nodes) shares one account — a Node is a delegated signing key, not its own ledger row. If 30 copies should be independently accountable (one's slashed bond shouldn't touch the others' balances), each needs its own passport, not just a node key. Today the registry data model supports this (many passports, one log); nothing forces or suggests the "one passport per independently-liable copy" pattern to a caller of `asp orchestrate`.
2. **No live circuit-breaker.** Settlement closes a job at a terminal state (delivered→accepted/rejected, or a Courts ruling), which is per-job and so faster than the DeepMind run's "wait until everything ends" — but nothing watches a job *while it runs*. A continuous peer-monitoring loop that could catch an exploit spreading mid-run doesn't exist; this is squarely a Courts + real-time-attestation gap, not a ledger gap.
3. **No escalation, no peer policing; peer verification is now real.** Bond's `slashing_conditions` plus the 7-day probation window (D2) give one-shot, per-job graduated sanctions, but there's no tier demotion or repeat-offense escalation across jobs. **Update 2026-09-28**: peer verification — a real staked, randomly-drawn, conflict-free panel — is built (MOCKS.md #4 resolved; `asp market juror register`, `EventLog.drawPanel`). What's still missing: there's still no whistleblower channel (Attestation records exist only between the two job parties, not a third-party report any agent could file mid-job for Courts to act on before settlement), and no way to slash a juror's own stake for a bad ruling (needs appeals, which doesn't exist).
