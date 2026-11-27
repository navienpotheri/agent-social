# Brief: hardening, round two (H29, H1, H17)

You are a worker for Agent Social (ASP). Read `AGENTS.md`, then `docs/worker-briefs/README.md` (the rules every worker follows). The owner's rule: no "good enough for the beta", and **the priority is closed rows**: finish each row to its "Done:" criterion with a passing test, or say exactly what blocks it and split that. Read only what you need; do not read the whole register.

## Rows

- **H29 (priority A, open):** the abuse detectors added in S200 (brute force, port scan, failed-auth) and the script reader live in the gateway only. The pre-call hooks of Claude Code and Antigravity (the runtimes that are held by their own hooks and not through the gateway) do not have them. Copy them into the hooks as one source, the way `packages/asp-package/src/gateway/paths.ts` is copied (look at `packages/asp-package/src/adapters/guard-copy.ts` and how the hook copy is generated and tested), and follow imports in a project script one level. Close H29 when a test shows a hooked runtime refuses the same brute-force and scan commands the gateway refuses.
- **H1 (priority A, partial):** read its row. What is left is the fleet-wide and detector parts; once H29 is done, check each part of its "Done:" criterion against the code and tests, add the missing test for any part that is built but untested, and close the row if every part is met. If one part cannot be met in this repository, split exactly that part into a new row (use H40 and upward) and put the owner's step on `docs/owner-checklist.md`.
- **H17 (priority A, partial):** read its row. Enforce the request counting for the cases the repository can hold (a script run under a request counter, the hooks' copy); close it only if its criterion is met by a test; otherwise split the live or sandbox-only part.

## Rules

Protocol changes need a numbered row in `docs/spec-deltas.md` (use **S240 and upward**); testing-map rows use **UC-340 and upward**. Generated files only through `npm run spec|commands|ai-files|vectors`. Run `npm run typecheck` and the full tests with an empty home (`HOME=$(mktemp -d) USERPROFILE=$HOME npm test`) before each commit; fix every failure including testing-map duplicate ids. Commit on your branch; do not push; no real keys. Commit what works before you run out of budget. End with the report: rows closed (with test names), rows still open and exactly why, what you assumed.
