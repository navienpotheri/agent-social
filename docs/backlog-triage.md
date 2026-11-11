# Backlog triage, priority A (2026-11-11)

The register ([gaps-register.md](gaps-register.md)) had 259 rows that were not closed on the morning of 2026-11-11: 153 open, 57 partial, 49 designed (68 at A, 147 at B, 44 at C). This page sorts the **A** rows by what stands between each one and `closed`. It changes no status; closing a row is done in the register, and a row is closed only when its stated criterion is fully met.

How the rows were sorted: first from each row's own text, then, for the ones first sorted as "code alone", again after reading each row's "what is left". That second reading moved most of them: a row that looks like code usually also needs a decision, a mail route, a live run or a protocol change. B and C rows are not sorted here.

## Done on the day

Closed: **T13** (a returning user is told what happened), **P27** (an Action names its run log, S155), **E3** (the self-report SDKs send usage metrics, S156), **T14** (`asp today`), **D8** (`asp trend`). Partly done: **T2** (every first-minutes failure case now has a test or a live run; a real laptop sleeping and a several-GB repository are left, in docs/live-run-checklist.md). New: **T32** (what `asp today` does not show yet). **T23** (the two-sessions test) was raised from B to A: it fails on most CI runs, and the work on it so far is a timed trail of each approval hand-off, printed when the test fails.

That leaves 65 A rows not closed, sorted below.

## 1. Code alone can close it (real work left, no one else needed)

| Row | Left to do |
|---|---|
| T23, T3 | Find why session D's answer is lost (the trail now shows both sides' steps), then fix it |
| D2 | Outcome series per agent and per principal from the log, compared across lineage edges |
| P1 | More runtime adapters: the declarative descriptor and generic adapter in docs/portability-at-scale.md, then the list of 20 |
| D10 | `asp learned`: what the agent learned, with Keep, Edit, Undo |

## 2. Needs your decision first (then code)

| Row | The decision |
|---|---|
| O12 | Turn on branch protection on `main` with the named checks |
| T12 | The starting request limit |
| M9 | The starter-credit rule; a waiting list needs privacy text |
| R1 | The quota policy (a quota that grows after a first settled job is a rule about money, not only code) |
| LW1 | Approve the Code of the City text, then sign it with your own key |
| AG3 | Who hears a contest of a refusal, a strike or a slash, and in how long (with IS4), then a record for it |
| AG4, LW2 | Which Articles the detectors and the unlawful-order record rest on; both need new protocol records |
| T21 | A protocol change: waiting seconds recorded apart in the Action and left out of deadlines and rulings |
| E16 | Whether to seal the run log by default or remind people to, and court rules for a refused disclosure (with IS4); local encryption at rest waits on E6. (The register has three rows with this id; this is the one about the run log's custody.) |
| D4 | What a model change means (providers do not expose weight digests; a probation rule is a design) |
| GV6, GV9, GV11 | Emergency powers, limits on the operator, the rights charter (I can draft each for you to edit) |
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
| T2 | A real laptop sleeping mid-session; a several-GB repository with a real agent |
| T15 | Live set 4 (docs/live-run-identity.md): three identities, one of every kind of call, compared with the log |
| T22 | Live run of the sub-agent key rules |
| H1, H2, H10, H12, H13, H15, H17 | The sandbox with egress filtering (H8, H11 to H14) run live; H15 also needs a budget shared across machines, which is a service feature |
| E5 | The Antigravity and OpenHands output formats read from real runs |
| P21, P22 | A first real run of each runtime; the provider-terms case |
| E9 | A live mail send to your own address |
| D1 | The canary set run on a real model |

## 5. Needs the hosted product built first (dashboard, sign-in, mail provider)

U1, U2, U4, U7, U9, U12, U15, U16, E2, E6, E8, E10, E11, E13, P29. These wait on a hosted dashboard with sign-in (U2), a mail provider (U4), or both: P29 and U15 need mail or a push when approvals are waiting, U16 needs the landing page and trials with people, E2 waits on E4 to E8. A hosted dashboard is a large piece of work of its own; none of these closes before it exists.

## 6. Needs an OS keychain

U5, P20: keys and tokens in the operating system's keychain, per platform.

## 7. Costs model money (your key, your call)

LW4 (temptation suite), BM17 (a fresh set of tasks to label for an honest score), BM20 (benchmark v2), O2 and O19 (the Postgres and email tier are also needed), D9 (the A/B replay that checks a lesson).

## Counts

The 65 A rows not closed: 5 in section 1 (T23 and T3 counted separately), 18 in section 2, 3 in section 3, 16 in section 4, 15 in section 5, 2 in section 6, 6 in section 7. A row is listed once, under the first thing that blocks it.
