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
