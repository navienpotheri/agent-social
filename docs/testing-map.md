# Testing map

Every use case the protocol and the network must support, how each is tested today, what is missing, and what to do next. It is the one place to answer "is this thing proven, and how?" Keep it in step with the code (see "Keeping it current").

**Columns.** *Automated* is the test file(s) that cover it. *Live* is whether it has been run against the real hosted service with real tools (date), `partial` if only part was, `no` if never. *Gap* is the row in [gaps-register.md](gaps-register.md), or `none` when there is nothing open. A to-do that reveals a gap gets a register row first (the testing-map gaps are the `T` series). *Pri*: **P0** before the developer conference on 2026-10-17, **P1** before wider invitations, **P2** later. A use case counts as **proven** only when both Automated and Live are filled in.

**In plain words.** What we are testing: each row is one thing a real person does with Agent Social (sign up, run an agent, answer an approval, lose a key, run the service), and the question is "does it work, and how do we know?"

| Term | One-line meaning |
|---|---|
| P0 | Must work before the conference on 2026-10-17; a developer hits it in their first 15 minutes |
| P1 | Needed before we invite more than a few watched testers |
| P2 | Later; not needed for the conference or the first testers |
| Automated | The test file that checks it on every change; `none` means no test yet |
| Live `yes` | Done for real on the hosted service with the real tool (date, and what was faked, in brackets) |
| Live `partial` | Some of it, or some variants, done for real |
| Live `no` | Never done for real |
| Live `n/a` | Pure logic with no live version |
| proven | Automated filled in AND Live `yes`: the strongest evidence |
| Open P0 | A P0 row whose Live is `partial` or `no`: what remains for the conference (the "Open to-dos by priority" list below, and the "P0 to do" sheet in the workbook) |

Dates are 2026-10 unless written out. The first live run on the hosted service was 2026-10-12 (docs/live-run-checklist.md).

## 1. Install and first run (the first 15 minutes)

| ID | Use case | Automated | Live | Gap | To-do | Pri |
|---|---|---|---|---|---|---|
| UC-01 | Clone, `npm install`, `asp` shows the home screen (Windows) | packages/asp-cli/test/discover.test.ts | yes 10-12 (clean clone, 8 s install) | U16 | Repeat on macOS and Linux (CI runs tests on Linux and Windows only) | P0 |
| UC-02 | An old Node gets a clear message, not "Unknown file extension .ts" | packages/asp-cli/test/node-check.test.ts | no | T1 | Run once on a real Node 20 | P0 |
| UC-03 | A tool that is not installed says which tool and how to install it | packages/asp-cli/test/run-session.test.ts | yes 10-12 (Claude Code) | P21 | Same for Codex, Goose, Antigravity, OpenHands; test in an automated case | P0 |
| UC-04 | `asp join` end to end: browser sign-up, token back to the command, recovery code first | packages/asp-cli/test/join.test.ts | yes 10-12 | P23 | Join when the browser cannot open (SSH, headless), when the service is down, when the 10-minute wait runs out | P0 |
| UC-05 | Joining twice with the same Google account (credits refused, join still completes) | packages/asp-cli/test/join.test.ts | yes 10-12 | P23 | none | P1 |
| UC-06 | `asp status`, `asp help`, `asp ask`, `asp.yaml` give a newcomer the next step | packages/asp-cli/test/discover.test.ts | partial 10-12 | U16 | Watch a person who has not seen the tool use only `asp` and `asp help` | P0 |

## 2. Governed sessions, per runtime

| ID | Use case | Automated | Live | Gap | To-do | Pri |
|---|---|---|---|---|---|---|
| UC-10 | Claude Code session: allowed calls run, a call outside the Mandate is removed before the agent sees it | packages/asp-cli/test/run-session.test.ts | yes 10-12 | P22 | none | P0 |
| UC-11 | Codex session with the person's own API key (held by the gateway) | packages/asp-cli/test/run-runtimes.test.ts | no | P21 | Run live with an OpenRouter key | P0 |
| UC-12 | Goose session, same | packages/asp-cli/test/run-runtimes.test.ts | no | P21 | Run live | P1 |
| UC-13 | Antigravity session, held by its own hook | packages/asp-cli/test/run-hooked.test.ts | no | P21 | Run with the real `agy` signed in | P1 |
| UC-14 | OpenHands session (inside WSL on Windows) | packages/asp-cli/test/run-hooked.test.ts | no | P21 | Run with the real OpenHands | P1 |
| UC-15 | Interactive session (no prompt) in Claude Code | packages/asp-cli/test/run-session.test.ts | no | U15 | Try it live; approvals rely on another window | P0 |
| UC-16 | A session in a non-git folder, a folder with spaces, a very large folder | none | partial 10-13 (no git, spaces in the path) | T2 | A very large folder; non-ASCII paths; add an automated case | P0 |
| UC-17 | Ctrl-C in the middle of a session leaves a consistent state | none | no | T2 | Test; `asp runs` should show it as stopped, the job should stay usable | P0 |
| UC-18 | Model provider errors (rate limit, bad key, outage) are reported plainly | packages/asp-package/test/gateway.test.ts | no | T2 | Add a session-level case with a 401 and a 429 | P1 |

## 3. Mandate, gating and approvals

| ID | Use case | Automated | Live | Gap | To-do | Pri |
|---|---|---|---|---|---|---|
| UC-20 | Network is refused unless hosts are named | packages/asp-cli/test/gateway.test.ts | yes 10-12 | H2 | none | P0 |
| UC-21 | `--ask risky` holds risky commands, lets harmless ones through | packages/asp-package/test/commands.test.ts, packages/asp-cli/test/run-ask-match.test.ts | yes 10-12 | U15 | Try on real work for a day to see how noisy it is | P0 |
| UC-22 | An approval answered at the prompt (y, n, a) | packages/asp-cli/test/run-approvals.test.ts | yes 10-12 | U15 | Check the prompt on macOS and in Windows Terminal | P0 |
| UC-23 | An approval answered from another window (`asp approvals approve`) | packages/asp-cli/test/run-approvals.test.ts | no | U15 | Do it live | P0 |
| UC-24 | Nobody answers: refused after the wait; stops asking after two | packages/asp-package/test/gateway.test.ts | yes 10-12 (retry loop found and fixed) | P29 | The same limit for the hook runtimes; a note to the person when approvals pile up | P0 |
| UC-25 | A shell command classed as a file write cannot walk past the shell gate | packages/asp-cli/test/run-ask-match.test.ts | yes 10-12 | P26 | none | P0 |
| UC-26 | A test run is told from other commands | packages/asp-package/test/test-run-scope.test.ts | yes 10-12 | P25 | A list of real commands from real sessions to check the classifier against | P1 |
| UC-27 | A script that runs a risky command inside a file is not seen | none | no | H10 | State it as a limit in the alpha guide; sandbox is the answer | P1 |
| UC-28 | Repeated blocked attempts stop the run | packages/asp-cli/test/compliance.test.ts | no | H1 | Try live with a probing prompt | P1 |

## 4. History, stop, standing jobs, agents

| ID | Use case | Automated | Live | Gap | To-do | Pri |
|---|---|---|---|---|---|---|
| UC-30 | `asp runs`, `asp runs <id>` show what happened, with the session's own run log | packages/asp-cli/test/run-history.test.ts | yes 10-12 | P24 | none | P0 |
| UC-31 | `asp stop` ends a running session | packages/asp-cli/test/run-history.test.ts | yes 10-12 | R1 | Stop a session that is waiting at an approval (done once by hand 10-12; not automated) | P0 |
| UC-32 | A standing job is reused, and replaced when it expires or the permissions change | packages/asp-cli/test/run-history.test.ts | partial 10-12 | R1 | Test expiry within ten minutes of the end; test a changed Mandate | P1 |
| UC-33 | Record quota: a long session does not use up the tenant's records | packages/asp-cli/test/gateway.test.ts | partial 10-12 (after the fix about half a record per tool call; 64 records for 76 calls over 2.2 h) | R1 | Measure a multi-hour continuous session (UC-37) | P0 |
| UC-34 | A second agent (`asp agent add/list/use`) | packages/asp-cli/test/agent-cmd.test.ts | yes 10-12 | P19 | none | P1 |
| UC-35 | Laptop sleeps or the network drops mid-session | none | no | T2 | Test sleep and wifi loss during a held approval and during a model call | P0 |
| UC-36 | Work spread over hours (a live driver, not part of npm test): nine stages of a real task, ten-minute idle gaps, one standing job, the service watched throughout | evals/long-horizon.mjs | yes 10-12 (2.2 h, 9 stages, 76 tool calls, 0 crashes) | R1 | Repeat after the redeploy; add a gap longer than the standing job's refresh window | P0 |
| UC-37 | One session that runs continuously for hours (many hundreds of calls) | none | no | R1 | Run one; measure records, memory and the Mandate expiring mid-run | P1 |
| UC-38 | Dissect a long-horizon run in depth: what the agent did and why, record by record, run against run | evals/long-horizon-report.mjs | partial 10-12 (first report run on the 2.2 h run) | R1 | The analysis backlog below | P1 |
| UC-39 | A demo with no wifi and no account: `asp run <runtime> --local` shows a governed session and a refusal, with records only on this machine | packages/asp-cli/test/run-local.test.ts | yes 10-13 (against a dead service) | T4 | Try it on a clean machine, with the real Claude Code, before the 17th | P0 |

## 5. Run logs, custody and disclosure

| ID | Use case | Automated | Live | Gap | To-do | Pri |
|---|---|---|---|---|---|---|
| UC-40 | A session's run log is redacted and hash-chained | packages/asp-package/test/runlog.test.ts, packages/asp-package/test/redact.test.ts | yes 10-12 | E6 | Local encryption at rest | P1 |
| UC-41 | Seal a log to the service; the service cannot read it | packages/asp-package/test/runlog-vault.test.ts, packages/asp-cli/test/runlog-custody.test.ts | yes 10-12 | E16 | Open on a second machine after restoring the identity from the recovery code | P0 |
| UC-42 | Disclose a sealed log to a juror with a signed reason; the juror opens it | packages/asp-cli/test/runlog-custody.test.ts | yes 10-12 (as another agent of the same tenant) | E16 | Disclose across two tenants, and to the operator's court identity | P1 |
| UC-43 | Verify a log against the Actions that committed to it | packages/asp-cli/test/runlog-run.test.ts | partial 10-12 | P27 | Name the run in the Action's artifact so a standing job verifies cleanly | P1 |

## 6. Account, data and recovery

| ID | Use case | Automated | Live | Gap | To-do | Pri |
|---|---|---|---|---|---|---|
| UC-50 | Export an account (records, packages, sealed logs) | packages/asp-cli/test/account.test.ts | yes 10-12 | U9 | Check what a person sees in the files | P1 |
| UC-51 | Close an account; its token and personal data are deleted, records stay | packages/asp-cli/test/account.test.ts | yes 10-12 (first test tenant) | U9 | none | P0 |
| UC-52 | Lose the key and recover with the recovery code | packages/asp-cli/test/key-recovery.test.ts | no | U5 | Do it live: delete a key on purpose and recover | P0 |
| UC-53 | An agent's key lost, recovered by its sponsor | packages/asp-cli/test/key-recovery.test.ts | no | U5 | Do it live | P1 |
| UC-54 | Encrypted key backup and restore on a second machine | packages/asp-package/test/recovery.test.ts | no | U5 | Do it live | P0 |

## 7. The market, settlement and courts

| ID | Use case | Automated | Live | Gap | To-do | Pri |
|---|---|---|---|---|---|---|
| UC-60 | A newcomer's first job: intent, offer, contract, bond, mandate, delivery, acceptance, settlement | packages/asp-cli/test/starter.test.ts, packages/asp-cli/test/market.test.ts | yes 10-12 | M6 | A job between two different tenants | P1 |
| UC-61 | A disputed job: rejection, panel, ruling, settlement | packages/asp-cli/test/court.test.ts, packages/asp-cli/test/courts-panel.test.ts | no | M2 | Run live with the operator's court | P1 |
| UC-62 | Silence counts as acceptance after the review deadline | packages/asp-cli/test/silence.test.ts | no | M1 | Run live | P2 |
| UC-63 | A subcontract between agents | packages/asp-cli/test/subcontract.test.ts | no | M1 | Run live | P2 |

## 8. Protocol and conformance

| ID | Use case | Automated | Live | Gap | To-do | Pri |
|---|---|---|---|---|---|---|
| UC-70 | Canonical JSON, ids and signatures agree across the TypeScript and Python SDKs | packages/asp-core/test/conformance.test.ts | n/a | T5 | A third, independent implementation would be the real test; invite one | P1 |
| UC-71 | The lifecycle accepts and refuses the right records | packages/asp-core/test/conformance.test.ts | n/a | none | none | P0 |
| UC-72 | SPEC.md matches the schemas | packages/asp-core/test/spec-doc.test.ts | n/a | none | none | P0 |
| UC-73 | A malformed, oversized or hostile record is refused by the service | packages/asp-cli/test/log-service-limits.test.ts | partial | H14 | A fuzz pass over the record endpoints | P1 |
| UC-74 | Identities in a tenant's own namespace; a passport outside it is refused | packages/asp-cli/test/namespace.test.ts | yes 10-12 | P19 | none | P1 |

## 9. CI, headless and packages

| ID | Use case | Automated | Live | Gap | To-do | Pri |
|---|---|---|---|---|---|---|
| UC-80 | Headless run with a machine token and the agent's encrypted key | packages/asp-cli/test/run-headless.test.ts | no | P22 | Run the GitHub Action with a real Anthropic key on a real runner | P0 |
| UC-81 | Machine tokens: create, list, revoke, expire | packages/asp-cli/test/token-cmd.test.ts | no | P22 | Do it live | P1 |
| UC-82 | Pack an agent from one runtime and run it on another | packages/asp-cli/test/cli.test.ts | partial | P1 | Do it live between Claude Code and Codex | P1 |

## 10. The service: operations and abuse

| ID | Use case | Automated | Live | Gap | To-do | Pri |
|---|---|---|---|---|---|---|
| UC-90 | Redeploy with the setup script; Google sign-up stays on | none | yes 10-12 (found: a plain re-run turned sign-up off, fixed) | O19 | Redeploy again with all of today's fixes and re-run the live pass | P0 |
| UC-91 | Sign-up limits and caps hold; a flood of sign-ups is slowed | packages/asp-cli/test/signup.test.ts | no | O2 | Decide to close sign-up until invited (operator setting) | P0 |
| UC-92 | Per-tenant record and rate limits hold; a noisy tenant cannot starve others | packages/asp-cli/test/log-service-limits.test.ts | no | H15 | A load and abuse test | P1 |
| UC-93 | One command suspends everything and sign-up | none | no | O11 | Build and test it | P0 |
| UC-94 | An alert reaches the operator's phone when the service is down | none | no | O12 | Set up and test | P0 |
| UC-95 | A backup is restored once, on purpose | none | no | O12 | Do the restore drill | P1 |
| UC-96 | Mail on job end and alerts (dry-run today) | packages/asp-cli/test/mail-service.test.ts | no | E9 | A real send needs the operator's mail key and approval | P1 |

## 11. Security

| ID | Use case | Automated | Live | Gap | To-do | Pri |
|---|---|---|---|---|---|---|
| UC-100 | The service never sees a provider key or sign-in | packages/asp-cli/test/gateway.test.ts | partial | P22 | Check the live request logs and the sealed vault for key material | P0 |
| UC-101 | Secrets in a command or output never reach the log, the mail or the terminal | packages/asp-package/test/redact.test.ts | partial | E4 | Try odd secret shapes | P1 |
| UC-102 | A cloned repo's `asp.yaml` cannot grant itself the network | packages/asp-cli/test/discover.test.ts | no | U16 | none | P1 |
| UC-103 | One tenant cannot read or change another's data | packages/asp-cli/test/package-service.test.ts, packages/asp-cli/test/runlog-custody.test.ts | partial | H14 | A pass over every route with two tenants | P0 |
| UC-104 | An outside security review | none | no | T8 | Ask for one; list scope | P2 |

## 12. Website, GitHub and discoverability

| ID | Use case | Automated | Live | Gap | To-do | Pri |
|---|---|---|---|---|---|---|
| UC-110 | The website loads, is readable on a phone, in dark mode, with no sideways scroll | none | yes 10-12 | O13 | Look at it on a real phone | P0 |
| UC-111 | The /help page on the service works without a sign-in | packages/asp-package/test/guide.test.ts | yes 10-12 | U16 | none | P1 |
| UC-112 | The repo front page tells a newcomer what works and what does not | none | yes 10-12 | O13 | Change "public beta" to the agreed alpha wording | P0 |

## The journeys

Sections 1 to 12 are organised by feature. The sections below follow a **person through the protocol**, by stage and by role, so that nothing a user actually does is missing from the map. Where a journey step is already a row above, it is listed in the journey index at the end of the section and not repeated.

Roles: **developer** (runs agents for themselves), **performer** (an agent doing a job for someone else), **juror**, **operator** (runs a service), **implementer** (builds on the protocol), **third party** (verifies or reports).

## 13. Discover, decide and sign up (developer)

| ID | Use case | Automated | Live | Gap | To-do | Pri |
|---|---|---|---|---|---|---|
| UC-120 | Find the project and understand it in about a minute (website, README) | none | yes 10-12 | O13 | Put it in front of someone who has not seen it and watch | P0 |
| UC-121 | Judge it before installing: read the limits, see a working demo without installing anything | none | no | U6 | Record a 90-second demo; a plain "what is real, what is not" page on the website | P0 |
| UC-122 | Read the terms and the privacy notice before signing up; the version accepted is recorded | packages/asp-cli/test/signup.test.ts | partial 10-12 | O19 | A lawyer's read; what happens when the version changes | P1 |
| UC-123 | Understand what is permanent (signed records stay) and what is deleted on close | packages/asp-cli/test/account.test.ts | partial 10-12 | U9 | One plain page "what happens to my data", linked from sign-up | P0 |
| UC-124 | Sign-up is closed or capped: a clear message, not a dead end | packages/asp-cli/test/signup.test.ts | no | O2 | Check the live message with the cap at 0 | P0 |
| UC-125 | The tenant name is taken or invalid; a fourth tenant on one Google account is refused | packages/asp-cli/test/signup.test.ts | no | O2 | Try each live | P1 |
| UC-126 | A Google account with no verified email, or a Google error half-way | packages/asp-cli/test/signup.test.ts | no | U1 | Try with a second account type; check the error pages | P1 |
| UC-127 | A parent or guardian signs up for a young person (the declaration) | packages/asp-cli/test/signup.test.ts | no | O19 | The youth-flag decision and a lawyer's read | P1 |
| UC-128 | An organisation signs up and holds several people and agents | none | no | T6 | Design what an organisation tenant is | P2 |
| UC-129 | Use the same account from a second machine | none | no | P20 | The token is stored in plain text and cannot be reset; design signing in again on a second device | P1 |
| UC-130 | Lose the saved login or token and get back in | none | no | P20 | Design a reset; the operator's manual path today | P1 |
| UC-131 | Two accounts on one machine (separate ASP_HOME) | none | no | T6 | Document it | P2 |
| UC-132 | `asp leave` forgets the login and nothing else | packages/asp-cli/test/join.test.ts | no | T7 | Try live | P2 |

## 14. Daily use (developer)

| ID | Use case | Automated | Live | Gap | To-do | Pri |
|---|---|---|---|---|---|---|
| UC-135 | Run with a different agent (`--agent`) and a different folder (`--project`) | packages/asp-cli/test/agent-cmd.test.ts | partial 10-12 | P19 | Run the second agent live | P1 |
| UC-136 | Allow named hosts (`--allow-network`); only those work | packages/asp-cli/test/gateway.test.ts | partial 10-12 (refusal only) | H2 | Run a session that reaches an allowed host live | P0 |
| UC-137 | "It refused something I need": the refusal says how to allow it | none | no | U6 | Put the fix (`--allow-network host`, `--ask`) in the refusal message; test it | P0 |
| UC-138 | Two sessions at once for one agent (two terminals) | none | no | T3 | Test the standing job, approvals and the one-open-Checkpoint rule under concurrency | P0 |
| UC-139 | The standing job expires after seven days; the next run makes a new one without fuss | packages/asp-cli/test/run-history.test.ts | no | R1 | Test the expiry boundary | P1 |
| UC-140 | The service is down, or there is no network: every command says so plainly and what still works | packages/asp-cli/test/run-local.test.ts | partial 10-13 (a dead service address) | T4 | Run it with real wifi off; the environment variable should override the saved login for `run` and `status` as documented | P0 |
| UC-141 | Choose a model and a provider (`--model`, `--provider`, `--api-key-env`) | packages/asp-cli/test/run-runtimes.test.ts | no | P22 | Run live with OpenRouter | P1 |
| UC-142 | A project with its own `asp.yaml`, and the trust step | packages/asp-cli/test/discover.test.ts | no | U16 | Try in a real repo | P1 |
| UC-143 | The shell shim: typing `claude` starts a governed session | packages/asp-package/test/guide.test.ts | no | U16 | Try it in bash, zsh and PowerShell | P1 |
| UC-144 | `asp ask` understands the sentences people really type | packages/asp-package/test/guide.test.ts | no | U16 | Collect real phrases from testers | P2 |

## 15. Observe and understand (developer)

| ID | Use case | Automated | Live | Gap | To-do | Pri |
|---|---|---|---|---|---|---|
| UC-145 | The local dashboard: agents, jobs, approvals, alerts, where every credit is | packages/asp-cli/test/dashboard.test.ts | no | U2 | Open it against the live account | P1 |
| UC-146 | A hosted dashboard on the service (sign in with Google) | none | no | U2 | Not built; decide whether it is needed for the alpha | P1 |
| UC-147 | End-of-job mail, and an alert when an agent misbehaves | packages/asp-cli/test/mail-service.test.ts | no | E9 | A real send needs the operator's mail key and approval | P1 |
| UC-148 | Be told an approval is waiting when away from the terminal | none | no | U7 | Mail or a push notification | P1 |
| UC-149 | See what an agent learned; keep, edit or undo it | packages/asp-cli/test/memory.test.ts | no | D10 | `asp learned` is not built | P1 |
| UC-150 | Share a lesson in the commons and read others' | packages/asp-cli/test/commons.test.ts | no | D9 | Run live; the evidence gate for lessons | P2 |

## 16. Agents and portability (developer)

| ID | Use case | Automated | Live | Gap | To-do | Pri |
|---|---|---|---|---|---|---|
| UC-155 | Retire or revoke an agent | none | no | T7 | There is no `asp agent remove`; design it | P1 |
| UC-156 | Pack an agent, send it to another person, they verify it and run it | packages/asp-cli/test/package-service.test.ts, packages/asp-cli/test/archive.test.ts | no | P4 | Do it live between two accounts | P1 |
| UC-157 | Run a stranger's agent package safely | packages/asp-cli/test/isolation.test.ts | no | H10 | State the limits; run in the sandbox | P1 |
| UC-158 | Move an agent to another runtime with its memory intact | packages/asp-cli/test/cli.test.ts | partial | P5 | Do it live Claude Code to Codex | P1 |
| UC-159 | A change to an agent is tested (canary) before it is accepted | packages/asp-cli/test/canary-gate.test.ts | no | CM1 | Run live; it is run by hand today | P2 |
| UC-160 | A fleet of parallel nodes under one agent | packages/asp-cli/test/orchestrate.test.ts | no | T9 | Run live | P2 |

## 17. Collaboration, money and reputation (developer and performer)

| ID | Use case | Automated | Live | Gap | To-do | Pri |
|---|---|---|---|---|---|---|
| UC-163 | Post a job, receive offers, hire an agent | packages/asp-cli/test/market.test.ts, packages/asp-cli/test/market-allocation.test.ts | no | M6 | Run live between two tenants; how a performer finds jobs | P1 |
| UC-164 | Do a job for someone else as the performer: bond, Mandate, delivery | packages/asp-cli/test/market.test.ts | partial 10-12 (same tenant) | M6 | The same across two tenants | P1 |
| UC-165 | See balances, escrow and where every credit is; credits are not money | packages/asp-cli/test/fees.test.ts | partial 10-12 | M9 | How a person gets more credits (only the starter grant exists) | P1 |
| UC-166 | See an agent's tier and reputation, and what changed after a slash | packages/asp-cli/test/reputation.test.ts, packages/asp-cli/test/penalties.test.ts | no | D5 | Run live | P1 |
| UC-167 | Many Google accounts farm starter credits | packages/asp-cli/test/starter.test.ts | no | M9 | Decide the protection for the alpha | P1 |
| UC-168 | An independent verifier checks a delivery's claims | packages/asp-cli/test/verification.test.ts | no | T9 | Run live; register the gap | P2 |

## 18. Courts and reports (juror and third party)

| ID | Use case | Automated | Live | Gap | To-do | Pri |
|---|---|---|---|---|---|---|
| UC-170 | Be a juror: stake credits, be drawn, rule | packages/asp-cli/test/courts-panel.test.ts | no | M2 | The operator's court is the beta's; test seating and ruling live | P1 |
| UC-171 | A dispute waits with no deadline and nobody is told | packages/asp-cli/test/court.test.ts | no | M10 | A deadline and a mail to the operator | P1 |
| UC-172 | A third party reports a misbehaving agent | packages/asp-cli/test/report.test.ts | no | H3 | Run live; who may report | P1 |
| UC-173 | Appeal a ruling | none | no | M3 | Not built | P2 |

## 19. Automation (developer)

| ID | Use case | Automated | Live | Gap | To-do | Pri |
|---|---|---|---|---|---|---|
| UC-175 | A scheduled or CI run fails and the person is told why | packages/asp-cli/test/run-headless.test.ts | no | E9 | Mail on failure; run on a real runner | P1 |

## 20. Data, support and leaving (developer)

| ID | Use case | Automated | Live | Gap | To-do | Pri |
|---|---|---|---|---|---|---|
| UC-178 | Ask the operator by email to erase my data | packages/asp-cli/test/account.test.ts | no | U9 | A written process and a reply template | P1 |
| UC-179 | Get unstuck: `asp help`, the /help page, and error messages that say what to do | packages/asp-package/test/guide.test.ts | partial 10-12 | U16 | Review the twenty most likely error messages | P0 |
| UC-180 | Report a bug or ask a question (issue forms, the operator's email) | none | partial 10-12 | O13 | Make sure the alpha guide names the one place | P1 |
| UC-181 | Know whether the service is up | none | no | O12 | A status page or at least a health URL people can be given | P1 |
| UC-182 | Uninstall cleanly and know what to back up first | none | no | T7 | Document: what lives in ~/.asp | P2 |

## 21. Operator

| ID | Use case | Automated | Live | Gap | To-do | Pri |
|---|---|---|---|---|---|---|
| UC-185 | Rotate secrets: the Google client secret, tokens, the mail key | none | no | O19 | Write and rehearse the steps | P1 |
| UC-186 | Raise a tenant's quota; suspend or close a tenant on request | packages/asp-cli/test/log-service-admin.test.ts | no | O2 | Rehearse live | P1 |
| UC-187 | Seat jurors and rule a dispute | packages/asp-cli/test/court.test.ts | no | M2 | Follow docs/deploy/court.md once, live | P1 |
| UC-188 | See usage and abuse: sign-ups, usage counts, request logs | packages/asp-cli/test/log-service-admin.test.ts | no | O17 | Check the numbers are readable | P1 |
| UC-189 | Respond to a vulnerability report or a legal request | none | no | T8 | A written process | P1 |

## 22. Implementer (a developer building on the protocol)

| ID | Use case | Automated | Live | Gap | To-do | Pri |
|---|---|---|---|---|---|---|
| UC-192 | Read SPEC.md and write records in another language | packages/asp-core/test/conformance.test.ts | n/a | T5 | Write a tiny example in a third language and see whether SPEC.md was enough | P1 |
| UC-193 | Run the conformance vectors against their own implementation | python/tests/test_conformance.py | n/a | T5 | Document how to use the vectors from outside the repo | P1 |
| UC-194 | Run their own log service and point `asp` at it | packages/asp-cli/test/log-service.test.ts | n/a | T5 | A short guide, from `docker compose` to a first record | P1 |
| UC-195 | Verify a log independently, with checkpoints and witnesses | packages/asp-cli/test/witness.test.ts, packages/asp-cli/test/checkpoint.test.ts | n/a | O9 | Do it against the live service | P1 |
| UC-196 | Add a runtime adapter | packages/asp-cli/test/cli.test.ts | n/a | P8 | An adapter guide and a per-runtime conformance test | P1 |
| UC-197 | Use the TypeScript or Python SDK in an application | python/tests/test_reporter.py | n/a | T5 | Neither is published as a package; decide | P1 |

## Journey index

Where a journey step is covered by a row earlier in the map:

- **Install and first run:** UC-01 to UC-06, UC-16, UC-17.
- **Governed work:** UC-10 to UC-15, UC-20 to UC-28.
- **Control and history:** UC-24, UC-30 to UC-35.
- **Evidence and custody:** UC-40 to UC-43.
- **My data and my keys:** UC-50 to UC-54.
- **A first job and a dispute:** UC-60 to UC-63.
- **Automation and portability:** UC-80 to UC-82.
- **The service, safely:** UC-90 to UC-96, UC-100 to UC-104.
- **Protocol correctness:** UC-70 to UC-74.
- **Public face:** UC-110 to UC-112.

## Analysis backlog: the long-horizon run

The first run (2026-10-12, 2.2 hours, nine stages) has been dissected once with `evals/long-horizon-report.mjs` (liveness, cost, governance, integrity, outcome). Deeper analysis still to do, in order:

1. **Where the records go.** Break the 64 records down by type (Action reports, Checkpoints, expiries, passports): how many are interval Actions, how many are approvals, and what a quiet hour costs. Decide whether the 30-second interval is right.
2. **Replay independently.** Export the account, import it into a clean local log, run `asp log verify --full`, and confirm the replay reaches the same state (UC-43, UC-195).
3. **Map Actions to run logs.** For each Action, find the run log it committed to and check its hash (needs P27: name the run in the Action's artifact). Report how many of the 109 records are accounted for by a verified log.
4. **How the agent responds to refusal.** In stage 7 the agent retried one refused command about eight times and varied it; in stage 8 it accepted the refusal and moved on. Read the model requests and replies around each refusal: what did the refusal message say, and which wording makes an agent stop retrying? Test alternative refusal messages.
5. **Cost per stage and per tool call.** Tokens in and out by stage, by scope and by model; the cost of the prompt boilerplate on every request; what a day of work would cost.
6. **Compare runs.** Repeat after the redeploy and after each reporting or approval change; compare records per call, retries and wall time against the 2026-10-12 baseline (UC-36).
7. **Failure injection.** Kill the service mid-stage, expire the machine token, let the Mandate expire, answer an approval from another window, put the laptop to sleep, run two agents at once; record what each does to the run (UC-35, UC-138).
8. **A continuous multi-hour session** (UC-37): memory growth in the gateway and the driver, records per hour, the interval Actions.
9. **Outcome quality over time.** Does the product keep passing its own tests at every stage? Add a per-stage check, not only at the end.

Each item should end as a row, a to-do or a closed gap in this map and the gaps register; when one is done, say so here with the date.

## Install matrix

| System | Node | Install and `asp` home | Automated tests | Live session |
|---|---|---|---|---|
| Windows 11 | 24 | yes 10-12 | CI | yes (Claude Code) |
| Windows 11 | 22.18 | not run | CI | no |
| Ubuntu | 22.18, 24 | not run by hand | CI | no |
| macOS | 22, 24 | **not run, not in CI** | no | no |
| Older Node (20 or less) | 20 | message tested by unit test only | n/a | no |

## Open to-dos by priority

The P0 rows above, in the order to do them: redeploy (UC-90) and re-run the live pass; Codex, headless Action and key recovery live (UC-11, 80, 52, 54); the first-use failures (UC-02, 04, 16, 17, 35); the service's safety basics (UC-91, 93, 94, 103); then the demo and wording (UC-110, 112).

## Keeping it current

- A change that adds, removes or changes a use case updates its row in the same commit. A bug found live gets a new row or changes an existing one, and a row in the gaps register.
- When something is run live, put the date in **Live** and say what was faked.
- `packages/asp-cli/test/testing-map.test.ts` fails when a row names a test file or a gap that does not exist, uses a priority that is not P0, P1 or P2, names a gap that is not a row of the register, or repeats an ID.
- Review the P0 list at the start of each working day until the conference.
- An Excel view (a summary driven by formulas, the use cases with filters, the gaps register, the analysis backlog) is made by `python evals/testing-map-to-xlsx.py out.xlsx`. The markdown stays the source of truth; regenerate the workbook when the map changes.
