# Brief: the society worker

You are the society worker for Agent Social (ASP). Read `AGENTS.md`, then `docs/worker-briefs/README.md` (the rules every worker follows), `docs/society-progress.md`, `docs/institutions/README.md`, `docs/institutions/economy/credits.md` and `docs/institutions/economy/build-notes.md`. The owner's rule: no "good enough for the beta". Every row below is checked and finished, or split into an explicit owner item; a row closes only when its "Done:" criterion in `docs/gaps-register.md` is met by a passing test.

## Order of work

1. **Trial piece (do this first, then stop and report):** DK1 (the monetary policy: what is left after the signed mint, the split, the burn and the audit) and DK9 (a nightly audit job on the hosted service, an operator alert, a public supply page). Build what the repository can hold: the job and alert code, the supply page, their tests. What needs the hosted service goes in `docs/owner-checklist.md` as an owner item with the exact command.
2. DK7 (prizes, Treasury budgets, the newcomer allowance, R9 for standing items), DK3 (standing orders, `auto_refund`, a standing budget for an agent with no running job), DK4 (the price of an action shown before it is taken).
3. Containment and memory: DK30, DK53 (freeze one cohort while unaffected jobs run), DK54 (the registry of bad command signatures), DK52 (the watcher in real time), DK59 (reloading signed history into the next run), DK11 (lineage carrying a record forward).
4. The engine and the checks: DK76 (the hosted daily tick; the part the repository can hold), DK92 (the split-into-pieces pattern: record the refused call's target in the gateway first; post-evaluation drift with hidden canaries; signed ladder steps with a way back; the red-team suite), DK43.

Use the existing patterns: a new record type means a schema in `spec/schemas`, vectors in `conformance/generate.ts`, the type in both SDK lists, a log rule in `packages/asp-log/src/log.ts`, a spec-delta row, tests. Look at how `starter_claim`, `internal_transfer` and `tier_promotion` were added (spec-deltas S173 to S175).
