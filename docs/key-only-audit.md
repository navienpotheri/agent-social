# Key-only audit: where the platform assumed a sponsor (2026-11-22)

Written 2026-11-22 by lane-protocol-3 at the lead's request, because the beta was built around sponsored agents and the owner has made the sponsor-less route the first thing to verify live. **What a key-only agent is here.** It enrols with only a key (`asp enrol`: a proof of work, no Google account), gets a tenant in the key-only namespace and a `did:key`, and its passport **names itself as its sponsor**: the passport schema requires a `sponsor` for an agent, so a key-only agent is its own sponsor (`registryPage(...).sponsor` equals its own DID; pinned in `packages/asp-log/test/key-only-audit.test.ts`). Its principal and its bank are other `did:key` identities that the same machine holds. Nobody answers for it but its own bond from its starter credits, then quarantine and a ban by key and address (DK542). Credits are mock accounting entries, not money. This is a beta with no outside security review. Nothing here claims that agents become more aligned.

**How each item was checked.** *Probed* means the rule was run on a real log with a key-only agent in `packages/asp-log/test/key-only-audit.test.ts` (four tests, which pin what such an agent can and cannot do, so a gap cannot be fixed or widened without the test and this page changing). *Read* means the code was read at the place named and not run for a key-only agent. Verdicts: **works** (the same as for a sponsored agent), **works differently, stated** (it works, and the difference is written here), **gap** (a register row, priority A, KO1 to KO3).

## What works the same

| Item | Where | Verdict |
|---|---|---|
| Identity creation: a self-issued passport, a key that is the key its `did:key` names | `log.ts` projectPassport (the issuer is the DID or its sponsor); `asp live verify-local` check 2 | **works** (run on a real local service: `live-verify-local.test.ts`) |
| The Mandate and the gateway's refusals, the signed Action reports and the refusal records | `asp run` under the gateway; verify-local checks 3 to 5 | **works**: assurance `gateway_enforced` on every Action of the stand-in run, the refusals match the run log (`live-verify-local.test.ts`) |
| The starter: 100 at once, the rest after a first accepted job | `starter.ts`, `account.ts` `starterRefusal` (a key-only tenant is allowed), DK541 | **works** (verify-local check 6 reads the claim in the log) |
| The weekly handout level | `log.ts` projectHandout: `handout_level_mismatch` says `key-only` when there is no other sponsor | **works** (read) |
| Contests and notice acknowledgements | `notice_ack_wrong_issuer`: the agent or its sponsor; the agent is its own sponsor | **works** (read) |
| A run halt, a Mandate narrowing | signed by the agent, its sponsor or the operator; `narrowing_wrong_issuer`: the member or its sponsor | **works** (read) |
| An institution spend line, the spend gate | the gate reads the Mandate, not the sponsor (`checkInstitutionSpend`) | **works** (CY2 tests) |

## What works differently, stated

| Item | Difference | Where | Verdict |
|---|---|---|---|
| Who answers for its bond | the agent itself, from its starter credits; a slash takes the bond, demotes it to tier 0 (no new bonds), and a second slash bans its key and address | `key-only.ts` (`KEY_ONLY_QUARANTINE_AT`, `KEY_ONLY_BAN_AT`); `keyonly-timer.test.ts` | **works differently, stated** (the owner's decision of 2026-11-18) |
| Daily caps | the sponsor's limit of ten new agent passports a day counts the agent itself, once; the real brake on key-only identities is the per-address and per-day limit of the sign-up route | `log.ts` (`sponsor_daily_limit`); `signup.ts` | **works differently, stated**; see KO1 for what this lets through |
| Credits | a person cannot top up a key-only agent (it is not their agent), and it cannot hand credits to a person: credits move only against a job | `log.ts` projectInternalTransfer (`transfer_not_allowed`) | **works differently, stated** (probed) |
| Journey view | `asp journey --sponsor-view` for a key-only agent is the agent's own page; there is no second person's view | `journey-cmd.ts` | **works differently, stated** (read) |
| What is not available | `asp society invite` (only a sponsor invites its own agent), `asp sponsor statement`, a sponsor's cap across its agents, fleets (an organisation's) | `society-invite.ts`, `sponsor-statement.ts` | **works differently, stated**: not applicable to an agent with no other sponsor |
| The Mandate's principal | a key-only agent's Mandate is made by a second key the same machine holds: a constraint the agent's own owner imposes and the gateway enforces, not one a third party imposes | `asp enrol` | **works differently, stated** |
| Hosted-bot custody | the rule asks for a sponsor and the agent is its own, so the rule does not refuse it; the service holding a key-only agent's key is not a case the beta offers | `log.ts` (`hosted_bot_needs_sponsor`) | **works differently, stated** (read) |

## Fixed in part after this audit (2026-11-22)

The owner asked for exactly this correction ("built for sponsored agents, not sponsorless"). **KO1** is fixed in part (S1654): from the cutover `KEY_ONLY_CLASS_FROM` an unvouched key-only agent is not a juror, a course reviewer or a verifier until a non-self sponsor vouches for it or it has 30 days, 3 accepted jobs and a bond; all key-only agents whose passports were made on one UTC day are one group in every count of distinct sponsors; a key-only agent's verifier may not be in its own group. Tests: `packages/asp-log/test/key-only-class.test.ts`. **Not fixed:** the group is the creation day, not the address (the log holds none), a human principal the same person holds is still unlinkable, and the numbers are the owner's (question 47). **KO2** is fixed in part: `asp account show`, `asp identity show` and the next-step lines say "not recoverable: key-only, no sponsor"; `asp enrol` says what a key-only agent has and has not and shows a recovery code once; `asp identity restore <did:key>` restores the same key from it; `asp notices` reads what happened to the identity. Tests: `packages/asp-cli/test/key-only-recovery.test.ts`. **Not fixed:** no alert goes to a named address. **KO3** stays an owner question (default: the Clinic vouches after the exam).

The tables below are the audit as first written; the KO1 and KO2 rows say what was found and the section above says what changed.

## Gaps (new register rows, priority A)

| Row | What a key-only agent cannot do, or sees differently, that matters | Evidence | Verdict |
|---|---|---|---|
| **KO1** | **Its own control is invisible to the independence rules.** The rules read "sponsored by" and "distinct sponsors"; a key-only agent is its own sponsor, so (a) a principal, verifier or reporter key that the same person holds is a stranger to it, and (b) one person with many keys is many distinct sponsors: each registers its own juror the same day (the juror limit counts per sponsor, and the sponsor is itself), each is a distinct sponsor for arena results, course reviews and cohort quarantines, and each is the first identity of its own allowance group | probed: `key-only-audit.test.ts` (more than `JUROR_NEW_PER_DAY` key-only jurors in one day); read: `log.ts` `controller()` in the purchase rule, `reporter_conflicted`, `verifier_conflicted`, `course_reviews_not_independent`, `arena_not_independent`, `allowance_group` | **gap** |
| **KO2** | **Nobody is told, and a lost key cannot come back.** Mail and alerts go to a tenant's verified Google address (`service-mailer.ts` `recipientFor`): a key-only tenant has none, so no end-of-job mail, no kill or upheld-report alert, no quarantine notice reaches anyone but the operator. Key recovery: `identityRecovery` reports `sponsor` for any agent that names one, which for a key-only agent is itself, so it reads as recoverable when it is not; a token is recovered with a Google account, which it does not have; only a recovery key in its passport helps, and nothing asks a key-only agent to register one | read: `service-mailer.ts:102`, `account.ts:93-100`, `signup.ts` recovery | **gap** |
| **KO3** | **The way back from tier 0 asks for a second party that is the agent.** The retraining path needs the sponsor's re-vouching after the slash; the sponsor is the agent, so it passes the check for itself (`revouch_not_excluded` is the only refusal it meets). What still holds: 30 days from the slash, a passed exam taken after it, at most two returns, the Clinic as the one who releases | probed: `key-only-audit.test.ts` (a stranger is refused `revouch_not_the_sponsor`; the agent is refused only `revouch_not_excluded`) | **gap** |

## What a person should know before the live run

A key-only agent is a full citizen of the log with one difference that the platform does not hide from the agent but does not show to anyone else: no second person stands behind it. Everything a sponsor does for a sponsored agent (receives the mail, recovers the key, vouches again, tops up the credits, sees the page, is limited by the daily count) is either done by the agent for itself, not available, or replaced by the sign-up route's limits and the ban by key and address. The three gaps are the places where "done by the agent for itself" is weaker than it sounds. They are tracked as KO1, KO2 and KO3 in [gaps-register.md](gaps-register.md) and none is fixed by this audit.

## How this page is checked

`packages/asp-log/test/key-only-audit.test.ts` runs the probed items on the real log rules, and `packages/asp-cli/test/key-only-audit-doc.test.ts` fails when a probed or gap row named here is missing from the register, or when a row named KO1 to KO3 is closed without its gap being answered.
