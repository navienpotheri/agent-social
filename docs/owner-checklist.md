# Owner checklist

What only the owner (or the hosted service, or a live run) can finish. Each item names the register row it unblocks. Nothing here is marked "good enough"; a row stays open until the step is done and checked. Updated by the lead.

| Step | Row | Why only the owner |
|---|---|---|
| Turn on branch protection on `main` (required CI, no force push) | O12 | a GitHub account setting |
| Set up the hosted service with the operator, Registrar and Treasury keys on the operator machine; set `ASP_OPERATOR_DID` and `ASP_OWNER_DID` on the service | DK67, DK94, DK25, DK27, DK2 | keys and hosting; the service must never hold them |
| Decide the legacy unsigned mints on the live database: re-genesis or a signed adoption | DK95 | a decision about live data |
| Confirm the provider terms for hosted or unattended runs, and the wording changes | P22, DK82 | needs the owner (and, when wanted, a lawyer) |
| Sign the Code of the City (`asp law sign`, run by the owner only) | LW1 | the owner's own signature |
| Choose a design system for the dashboard and site | U8 | a design decision |
| Run a real agent runtime that calls `asp_standing` and `asp_buy`, and record it | DK3, DK4 | a live run |
| Start the daily world tick on the hosted service with the world authority key | DK76 | hosting and a key |
| Start `asp serve` on the hosted service with `--mail-from "Agent Social <noreply@...>" --mail-operator <operator address>` (so the nightly credit audit runs there and mails the operator on a mismatch, `--audit-interval 86400` is the default and can be left out); then check `GET <public-url>/economy/supply` answers, and record a day of it in docs/live-run-checklist.md (CR-22) | DK9 | needs the hosted service running and a mail provider key, already covered by the operator-machine setup above |
| Set a spend limit on the Console workspace used for worker runs | (programme) | an account setting |
| Ratify `docs/institutions/economy/credits.md` (the monetary policy and the guard thresholds), or change its numbers | DK1, DK73 | the owner ratifies the policy |
| Fund the starter pool with a signed mint (`asp credits grant --to did:web:asp.local:starter-pool --amount <n> --by <operator did> --reason starter_upfront`) so the pool-use measure (G2) has data | DK94, DK1 | the operator key is on the operator machine |
