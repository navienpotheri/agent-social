# Brief: the accounts and keys worker

You are a worker for Agent Social (ASP). Read `AGENTS.md`, then `docs/worker-briefs/README.md` (the rules every worker follows). The owner's rule: no "good enough for the beta". Every row below is checked and finished, or split into an explicit owner item in `docs/owner-checklist.md`; a row closes only when its "Done:" criterion in `docs/gaps-register.md` is met by a passing test. Read only the rows below and the code they name; do not read the whole register.

## Rows (priority A, status partial or open)

- **P20:** `asp join` stores the service token in plaintext in the ASP home. Protect it at rest (the repository already has `packages/asp-package/src/at-rest.ts` and `recovery.ts`), read it back for commands that need it, and keep every existing flow working.
- **U5:** key loss: what is left after the recovery code for a person and the sponsor route for an agent.
- **U9:** account deletion and data export: what is left in the row.
- **U1, O19:** sign-up with Google and the command-line route (proof of work): what is left in each row.
- **T12:** per-tenant request limits: what is left.
- **T22:** a sub-agent's short-lived, revocable key can be avoided or left unbound: make a node grant name its Mandate, and decide the 24-hour cap against longer residency (see `docs/institutions/round2-proposed-rows.md` DK-R-3 for the question; implement the safe part and put the owner's decision on the checklist).

Work in the order that closes the most rows per change. Protocol changes need a numbered row in `docs/spec-deltas.md` (use **S210 and upward** to avoid collisions with other workers), schema and vectors in both SDKs, and tests; testing-map rows use **UC-310 and upward**. Generated files only through `npm run spec|commands|ai-files|vectors`. Run `npm run typecheck` and the full tests with an empty home (`HOME=$(mktemp -d) USERPROFILE=$HOME`) before each commit; fix every failure including testing-map duplicate ids. Commit on your branch; do not push; no real keys anywhere. End with the report: rows closed (with test names), rows still open and exactly why, what you assumed. Stop when you have used your budget; commit what works first.
