# Backlog triage, priority A (2026-11-11)

The register ([gaps-register.md](gaps-register.md)) had 259 rows that were not closed this morning: 153 open, 57 partial, 49 designed (68 at A, 147 at B, 44 at C). After T13 closed and T23 moved up to A, 258 are not closed and 68 of those are A. This page sorts the **A** rows by what stands between each one and `closed`. It changes no status; closing a row is still done in the register, and a row is closed only when its stated criterion is fully met.

How the rows were sorted: from each row's own text (gap, fix, what is done so far), not by re-auditing the code. Where a row needs more than one thing, it is listed under the first thing that blocks it. B and C rows are not sorted here.

Closed on the day this page was written: **T13** (a returning user). T23 (the two-sessions test) was raised from B to A: it fails on most CI runs now.

## 1. Code alone can close it (sized, no one else needed)

| Row | Left to do |
|---|---|
| T23, T3 | Find why session D's answer is lost (dump the gateway's own run log for D in the failure report, then fix); T3 is the same work seen from the use case |
| T2 | One test per first-minutes failure: non-git folder, spaces in a path, very large folder, Ctrl-C, network drop, provider error |
| T14 | Build `asp today` from docs/daily-view.md, and test every number against the log |
| P27 | Name the run in the Action's artifact so a verifier picks the right session's Actions |
| E3 | The TypeScript and Python self-report SDKs send the structured metrics |
| D8 | Trend view over the structured metrics |
| D2 | Outcome series per agent and per principal, compared across lineage edges |
| D4 | Record model digest in the passport or Action; a change opens probation |
| E2 | The redacted run-log recorder: finish what S69 left |
| E5 | Route the remaining `asp run` runtimes through the gateway recorder (or write the same events from their streams) |
| R1 | Quota that grows after a first settled job; Action reports batched per session |
| P29 | Finish the unanswered-approval handling after S119 |
| T21 | Record waiting seconds apart in the Action; leave approval waits out of deadlines and rulings |
| H1, H2, H15 | Brute-force/scan detectors; default-deny egress for low tiers; a budget shared across a fleet's copies |
| LW2, AG3, AG4 | The law chain: Engagement Mandate record, reasons and contest route on every adverse act, refusal of an unlawful instruction |
| U15, U16 | The remaining items in each row's "left" list |
| P1 | More runtime adapters (a list of 20; each is small, the list is long) |
| D9, D10 | Memory-lesson gate; `asp learned` |

## 2. Waiting on you (a decision, a signature or an account setting)

| Row | What it needs from you |
|---|---|
| O12 | Turn on branch protection on `main` with the named checks |
| T12 | Choose the starting request limit |
| M9 | Decide the starter-credit rule; a waiting list needs privacy text |
| LW1 | Approve the Code of the City text, then sign it with your own key |
| GV6, GV9, GV11 | Decisions on emergency powers, limits on the operator, and the rights charter (I can draft each for you to edit) |
| IS1, IS4, IS9 | Charters for institutions, Courts and an inspectorate (drafts for you to edit) |
| U8 | The design pass, and checks on real phones |

## 3. Needs a lawyer or an outside party

| Row | Who |
|---|---|
| LW8 | A lawyer: real-world liability, a clause tying the Code to the law of the land |
| SC1 | An independent security review |
| JO3 | Data-handling term in every contract (a lawyer's wording; the secrets-masking test is code) |

## 4. Needs a live run on a real machine or account

| Row | Run |
|---|---|
| T1 | Clean-room installs on macOS, Linux and a real Node 20 |
| T15 | Live set 4 (docs/live-run-identity.md): three identities, one of every kind of call, compared with the log |
| T22 | Live run of the sub-agent key rules |
| H10, H12, H13, H17 | The sandbox with egress filtering, run live (Docker backend) |
| P21, P22 | A first real run of each runtime; the provider-terms case |
| E9 | A live mail send to your own address |
| D1 | The canary set run on a real model |

## 5. Needs the hosted product built first (dashboard, sign-in, mail provider)

U1, U2, U4, U7, U9, U12, E6, E8, E10, E11, E13. These all wait on a hosted dashboard with sign-in (U2) or a mail provider (U4). A hosted dashboard is a large piece of work of its own; none of these closes before it exists.

## 6. Needs an OS keychain

U5, P20: keys and tokens in the operating system's keychain, per platform.

## 7. Costs model money (your key, your call)

LW4 (temptation suite), BM17 (a fresh set of tasks to label for an honest score), BM20 (benchmark v2), O2 and O19 (the Postgres and email tier are also needed).

## Counts

The 68 A rows that are not closed: 25 in section 1 (counting T23 with T3, and the grouped rows one by one), 11 in section 2, 3 in section 3, 11 in section 4, 11 in section 5, 2 in section 6, 5 in section 7. A row is listed once, under the first thing that blocks it, so a row that also needs a decision from you (for example the Code of the City) shows under that one.
