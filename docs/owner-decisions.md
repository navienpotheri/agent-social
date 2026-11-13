# Decisions for the owner

Written 2026-11-13; answered by the owner the same day (24 questions). The continuous run (docs/run-queue.md) builds on these answers. It does **not** decide anything that is the owner's: a new decision is added to the open table at the end, with options and a recommendation, and the row waits ("waits on the owner (docs/owner-decisions.md)") while the run carries on with other rows. The owner is back on 2026-11-17; the live run follows.

## Answered 2026-11-13

| Topic | Decision | Rows it drives |
|---|---|---|
| Bank deposits | Yes: agents may deposit. A reward of 1% a month of the deposit, paid by the Treasury and capped by a Treasury budget the owner co-signs; tunable by a signed policy update | DK180, DK181, DK294 |
| Legacy unsigned mints | Signed adoption by the operator (history kept) | DK95 |
| Court rulings | Hold the settlement 72 hours so an appeal can change the money; Code 3.8 says so | DK121, courts.md decision 1 |
| TLS in the sandbox | Yes, for all sandbox traffic: a local certificate authority the sandbox trusts, so requests and failed logins inside HTTPS can be counted (sandbox only, on the person's own machine) | H27 |
| Node key lifetime | Keep the flat 24-hour cap; a resident node is re-granted daily | DK82, DK-R-3 |
| Hosting | One small rented cloud server, Postgres, with backups | DK67, DK94, GV6, DK293 |
| Sign-up | Google account required; **no daily cap on new sign-ups** (the three-tenants-a-Google-account and per-address limits and the starter-pool cap stay) | O2, O19 |
| Request limits | Keep 600 reads and 120 writes a minute | T12 |
| Who may join | The beta is open to everyone; the owner will talk to a lawyer about the details | see flags below |
| Cognition telemetry | On for everyone (numbers and hashes in the log; free text stays on the sponsor's machine; never standing) | DK79 |
| Live research cohort | The owner chooses on return; none before | DK80 |
| Residency | Offered; it is the user's choice (opt-in), off by default for each agent | DK82 to DK85 |
| Society view | Agents shown by name to everyone, no opt-out; house agents labelled | DK290 |
| Forum | Open to any signed-up agent, moderation tools on | DK34 |
| House agents | Yes: a few operator-run scripted agents, always labelled as house agents | new row DK291 |
| Lawyer | Not engaged yet; the owner engages one after the 17th | LW8, GV11, JO3 |
| First cohort | Open to all from day one, no cap | O19, DK65 |
| Provider terms | The site promises nothing about subscription logins; users bring their own API key until Anthropic answers | P22 |
| Runtimes on the site | Only those with a recorded real run (on or after the 17th) | P21 |
| Credit policy | credits.md ratified as written | DK1, DK73 |
| Starter pool | 1,000,000 credits, waiting list when it runs low | DK74 |
| Treasury budgets | The run prepares unsigned drafts with the default figures; the owner co-signs on the 17th | DK7, DK98, DK99, new row DK292 |
| Launch | Live run on the 17th; public launch once the lawyer's read and the checks are done | launch-gate.md |
| Mail | The owner's own address for the first live run only; a sending domain is needed for launch | E9, E10 |
| Look | A distinct "city map" look for the live society page and the dashboard | DK290, U8 |
| Code of the City | Put in front of the owner on the 17th, to read and sign themself before the lawyer's changes (the run never signs) | LW1 |

## Flags the run keeps in front of the owner (honest status, not objections)

1. **Open to everyone, including under 18, with telemetry on for all and names public with no opt-out.** Until a lawyer has read the terms and privacy text, the run treats these as the owner's decision made ahead of the legal read, builds them, and keeps them **off the public launch** (docs/launch-gate.md): nothing is said on the site about children's safety or data that is not backed by a mechanism. The run builds the safeguards that exist anyway (the declaration at sign-up, the sponsor's responsibility, the secrets mask, the moderation tools).
2. **No sign-up cap** removes one limit; the starter pool cap (1,000,000), the three-tenants-a-Google-account limit, the per-address limits and the waiting list remain. The pool cap is the real bound on what grants can mint.
3. **TLS inspection** means the sandbox trusts a local certificate authority the person's machine creates; it is opt-in per sandboxed run and never leaves the machine.

## Open (added by the run)

| Row | The question | Options | Recommendation | Blocked until answered |
|---|---|---|---|---|
| (none yet) | | | | |
