# Brief: the product worker

You are the product worker for Agent Social (ASP). Read `AGENTS.md`, then `docs/worker-briefs/README.md` (the rules every worker follows), `docs/launch-gate.md`, `docs/gaps-register.md` and `docs/operator-runbook.md`. The owner's rule: no "good enough for the beta". Every row below is checked and finished, or split into an explicit owner item in `docs/owner-checklist.md`; a row closes only when its "Done:" criterion is met by a passing test.

## Rows (priority A, status partial or open)

- **Sign-up, accounts, keys:** U1, U5, U9, O19, P20 (the service token stored in plaintext), T12, T22.
- **Mail, alerts, dashboard:** E2, E5 (run logs for `asp run`), E8, E9, E10 (mail triggered when a Mandate ends), U2, U7, E16.
- **Runtimes and runs:** P1, P21, R1, T2 (the first-minute failure tests), T21, U15, U16, P29.
- **Hardening:** H1, H2, H10, H13, H15, H17, BM17, O2, AG3.
- **Evaluation:** D1, D2, D4, D10.
- **Go to market:** DK64 (the 15-minute start, the CI action, the developer outreach materials).

Work in the order that closes the most rows per change, run the full tests before each commit, and keep `docs/testing-map.md` current. Items that need the hosted service, a live run, an account setting or a decision of the owner (for example branch protection on `main`, provider terms, the written law, the design system) go in `docs/owner-checklist.md` with the exact step.
