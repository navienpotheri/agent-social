# Testing map

Every use case the protocol and the network must support, how each is tested today, what is missing, and what to do next. It is the one place to answer "is this thing proven, and how?" Keep it in step with the code (see "Keeping it current").

**Columns.** *Automated* is the test file(s) that cover it. *Live* is whether it has been run against the real hosted service with real tools (date), `partial` if only part was, `no` if never. *Gap* is the row in [gaps-register.md](gaps-register.md), or `none` when there is nothing open. A to-do that reveals a gap gets a register row first (the testing-map gaps are the `T` series). *Pri*: **P0** before the developer conference on 2026-10-17, **P1** before wider invitations, **P2** later. A use case counts as **proven** only when both Automated and Live are filled in.

**In plain words.** What we are testing: each row is one thing a real person does with Agent Social (sign up, run an agent, answer an approval, lose a key, run the service), and the question is "does it work, and how do we know?"

| Term | One-line meaning |
|---|---|
| P0 | On the common path (the section at the top) and must work before the conference on 2026-10-17: most developers hit it in their first 15 minutes |
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

## The common path (read this first)

The rest of this map is long. **What decides whether the conference goes well is a short path every user walks, in this order, and the failures that hit most people on it.** P0 means a row on this path. Everything else is P1 (before wider invitations) or P2 (later), however interesting its failure. A failure that hits one user in a hundred does not go ahead of one that hits one in three.

| Node | What every user does here | The failures that hit most users | Rows |
|---|---|---|---|
| N0 Discover | Finds the site or README, decides whether to try it | The page does not say plainly what works and what does not; no way to judge before installing; broken on a phone | UC-110, UC-112, UC-120 |
| N1 Install | Clones, `npm install`, runs `asp` | The wrong Node version; a missing tool (Python, git); a different shell (PowerShell, cmd, Git Bash, zsh); **macOS and Linux have never been tried by hand** | UC-01, UC-02, UC-226, UC-227 |
| N2 Join | `asp join`: browser, Google, the login comes back | No browser (SSH); the connection drops; sign-up closed or capped; the service is down | UC-04, UC-124, UC-140 |
| N3 Tool and key | Has Claude Code or Codex installed and signed in, or sets an API key | The tool is not installed or not on the path; a wrong or expired key; a rate limit | UC-03, UC-11, UC-18 |
| N4 First run | `asp run` with a prompt in a real folder | A path with spaces; a folder that is not git; the first call refused for a reason the person does not understand | UC-10, UC-16 |
| N5 Refusal and approval | Sees something refused, or held for a yes, and answers | "It refused something I need" with no way forward; typing the answer in the wrong place; the approval is not noticed | UC-137, UC-22, UC-23, UC-15 |
| N6 See the result | `asp runs`, the session summary, and at the end of the day a view of the whole day | Cannot tell what happened or whether it was recorded; after a day there is no one place that says what the agents did, what was refused, what it cost and whether anything went wrong | UC-30, UC-228 |
| N7 Stop | Ctrl-C, or `asp stop`, mid-session | Leaves a session "running", a held approval, a process behind | UC-17, UC-31, UC-220 |
| N8 Lose the connection | Wifi drops, a venue's network, the laptop sleeps | A bare error; a lost answer; a refused call that should have waited | UC-35, UC-39, UC-140 |
| N9 Get unstuck | `asp help`, `asp`, error messages | An error that does not say what to do | UC-06, UC-179 |
| N10 Come back | Runs it again tomorrow or next week | The standing job (7 days) has expired; the login is stale; the code was updated | UC-225 |

**Rule for new rows:** a use case is P0 only if it sits on a node above and its failure would hit most users there. Otherwise it is P1 or P2.

| ID | Use case | Automated | Live | Gap | To-do | Pri |
|---|---|---|---|---|---|---|
| UC-225 | Coming back after a day or a week: the standing job has expired (7 days), the saved login still works, and `asp run` says plainly what it did (a new job) | none | no | T13 | Run `asp run` after the job's expiry (move the clock in a test); check `asp status` and the message; `git pull` and run again | P0 |
| UC-228 | **The day's view:** after a day of agents running, the person sees the day in a few tables (sessions, what was done by scope, what was refused and why with the fix, approvals asked and answered, tokens and time, problems and whether everything was recorded), designed in docs/daily-view.md and checked against what really happened | none | no | T14 | Decide the open points in docs/daily-view.md; build `asp today` from the session index and the run logs; reconcile every number with the log; read the owner's real day with it | P0 |
| UC-226 | Install and first run on macOS and on Linux, by hand, from a clean clone: `npm install`, `asp`, `asp join`, `asp run` | evals/smoke-first-minutes.mjs | partial 10-14 (by CI with stand-ins for the model and Claude Code: a fresh checkout, install, help, a question, a refused local session with how to allow it, the history and `npm link` then `asp help`, on Ubuntu and macOS; no person has done the run on a Mac or Ubuntu, and the Google sign-in and a real agent are not part of it) | T1 | Do it on a Mac (most conference developers) and on Ubuntu; time it against the 15-minute bar | P0 |
| UC-227 | The README's commands work in each common shell: PowerShell, cmd, Git Bash, zsh, bash (quoting, paths, `export` versus `$env:`) | none | partial 10-14 (Git Bash on Windows from a clean clone, start to finish by hand; by CI with stand-ins the first-minutes checks pass in bash on Ubuntu, macOS and Windows, zsh on macOS and PowerShell on Windows; cmd only by hand and only for setup, status and a quoted question) | T1 | Try cmd, zsh and bash; give each shell its form of the setup lines | P0 |

## 1. Install and first run (the first 15 minutes)

| ID | Use case | Automated | Live | Gap | To-do | Pri |
|---|---|---|---|---|---|---|
| UC-01 | Clone, `npm install`, `asp` shows the home screen (Windows) | packages/asp-cli/test/discover.test.ts | yes 10-12 (clean clone, 8 s install) | U16 | Repeat on macOS and Linux (CI runs tests on Linux and Windows only) | P0 |
| UC-02 | An old Node gets a clear message, not "Unknown file extension .ts" | evals/smoke-first-minutes.mjs | partial 10-14 (by CI on Node 20: one clear sentence and no `Unknown file extension`; not on a person's own machine) | T1 | Run once on a real Node 20 | P0 |
| UC-03 | A tool that is not installed says which tool and how to install it | packages/asp-cli/test/run-session.test.ts | yes 10-12 (Claude Code) | P21 | Same for Codex, Goose, Antigravity, OpenHands; test in an automated case | P0 |
| UC-04 | `asp join` end to end: browser sign-up, token back to the command, recovery code first | packages/asp-cli/test/join.test.ts, packages/asp-cli/test/join-edges.test.ts | yes 10-12 (the normal path, real service and Google); partial 10-13 for the edges (stand-ins: service down, no browser, connection drops while waiting, the wait runs out) | P23 | Join once for real from a machine with no browser (over SSH), opening the printed address on a phone; a real wifi drop while signing up | P0 |
| UC-05 | Joining twice with the same Google account (credits refused, join still completes) | packages/asp-cli/test/join.test.ts | yes 10-12 | P23 | none | P1 |
| UC-06 | `asp status`, `asp help`, `asp ask`, `asp.yaml` give a newcomer the next step | packages/asp-cli/test/discover.test.ts | partial 10-14 (help, status and its next-step lines, and the join and ask messages read on a clean clone; not watched by someone who has never seen the tool) | U16 | Watch a person who has not seen the tool use only `asp` and `asp help` | P0 |

## 2. Governed sessions, per runtime

| ID | Use case | Automated | Live | Gap | To-do | Pri |
|---|---|---|---|---|---|---|
| UC-10 | Claude Code session: allowed calls run, a call outside the Mandate is removed before the agent sees it | packages/asp-cli/test/run-session.test.ts | yes 10-12 | P22 | none | P0 |
| UC-11 | Codex session with the person's own API key (held by the gateway) | packages/asp-cli/test/run-runtimes.test.ts | yes 10-14 (real Codex 0.157.1 on Windows with an OpenRouter key and the free nvidia/nemotron-3-super-120b-a12b model: `ls` ran, a fetch was refused before it ran with the how-to-allow hint, 3 calls judged and 1 refused, credits line shown; not tried with an OpenAI key) | P21 | Try it once with an OpenAI key; a Codex run on macOS or Linux | P0 |
| UC-12 | Goose session, same | packages/asp-cli/test/run-runtimes.test.ts | no | P21 | Run live | P1 |
| UC-13 | Antigravity session, held by its own hook | packages/asp-package/test/antigravity.test.ts | partial 10-14 (real agy signed in on Windows: the session finished, the web fetch was refused by the runtime before it ran and counted, credits line shown; but headless agy denied the agent's own shell command, so it could not list the files, and about thirty lines of raw JSON events were printed) | P21 | Run it again live to see the readable output; the how-to-allow hint has no host when the runtime refused the call (asp never saw it); a run with ASP_ANTIGRAVITY_ARGS=--dangerously-skip-permissions | P1 |
| UC-14 | OpenHands session (inside WSL on Windows) | packages/asp-cli/test/run-hooked.test.ts | no | P21 | Run with the real OpenHands | P1 |
| UC-250 | A developer or a procurer asks "which runtimes does this actually hold to the rules, and how do you know": `asp runtimes` shows each runtime, how it is reached, the level it reaches, and the evidence (live, partial or only a stand-in) | packages/asp-cli/test/runtimes-cmd.test.ts | partial 10-15 (the command and its data, by tests; the evidence column is filled from the live runs in this map) | P1 | Generate the matrix from conformance runs instead of a hand-kept descriptor; rows for Gemini CLI, Cursor, Cline and OpenCode as they are tried; a page on the site | P1 |
| UC-15 | Interactive session (no prompt) in Claude Code | packages/asp-cli/test/run-interrupt.test.ts | yes 10-13 (the owner, by hand in Git Bash: theme screen, a prompt, a command held, approved from a second window, the tool's own permission prompt, `/exit`; the summary said finished) | U15 | none (the approval wording is fixed in S128; Claude Code retries a held call after a few minutes, which looks like a network problem) | P0 |
| UC-16 | A session in a non-git folder, a folder with spaces, a very large folder | evals/smoke-first-minutes.mjs | partial 10-14 (live: no git, spaces in the path (10-13); a path with spaces and non-ASCII characters and a folder of 5,000 files, through Codex, both ran to a finished summary and the 5,000 were counted correctly; by CI with stand-ins: a project path with spaces and non-ASCII characters on Ubuntu, macOS and Windows. Not tried: a repository of 100,000 files or several GB) | T2 | A repository of 100,000 files or several GB | P0 |
| UC-17 | Ctrl-C in the middle of a session leaves a consistent state | packages/asp-cli/test/run-interrupt.test.ts | yes 10-13 (Claude Code, a 90-second command running) | T2 | none (found two defects, fixed in S123: the session stayed `running?` for ever and the agent's command lived on) | P0 |
| UC-18 | Model provider errors (rate limit, bad key, outage) are reported plainly | packages/asp-cli/test/run-provider-errors.test.ts | partial 10-13 (a wrong key against the real Anthropic API: named live and in the summary, run stopped after three refusals; 402, 429, 5xx and a provider that is down by a stub; Codex with a wrong OpenRouter key, 10-14: openrouter.ai's 401 named once in plain words, the run stopped after three refusals with exit 1 and a full summary) | T2 | A 429 and an outage from a real provider; Goose with a wrong OpenRouter key | P0 |

## 3. Mandate, gating and approvals

| ID | Use case | Automated | Live | Gap | To-do | Pri |
|---|---|---|---|---|---|---|
| UC-20 | Network is refused unless hosts are named | packages/asp-cli/test/gateway.test.ts | yes 10-12 | H2 | none | P1 |
| UC-21 | `--ask risky` holds risky commands, lets harmless ones through | packages/asp-package/test/commands.test.ts, packages/asp-cli/test/run-ask-match.test.ts | yes 10-12 | U15 | Try on real work for a day to see how noisy it is | P1 |
| UC-22 | An approval answered at the prompt (y, n, a) | packages/asp-cli/test/run-approvals.test.ts | yes 10-12 | U15 | Check the prompt on macOS and in Windows Terminal | P0 |
| UC-23 | An approval answered from another window (`asp approvals approve`) | packages/asp-cli/test/run-approvals.test.ts | yes 10-13 (real Claude Code, interactive and two terminals) | U15 | none | P0 |
| UC-24 | Nobody answers: refused after the wait; stops asking after two | packages/asp-package/test/gateway.test.ts | yes 10-12 (retry loop found and fixed) | P29 | The same limit for the hook runtimes; a note to the person when approvals pile up | P1 |
| UC-25 | A shell command classed as a file write cannot walk past the shell gate | packages/asp-cli/test/run-ask-match.test.ts | yes 10-12 | P26 | none | P1 |
| UC-26 | A test run is told from other commands | packages/asp-package/test/test-run-scope.test.ts | yes 10-12 | P25 | A list of real commands from real sessions to check the classifier against | P1 |
| UC-27 | A script that runs a risky command inside a file is not seen | none | no | H10 | State it as a limit in the alpha guide; sandbox is the answer | P1 |
| UC-28 | Repeated blocked attempts stop the run | packages/asp-cli/test/compliance.test.ts | no | H1 | Try live with a probing prompt | P1 |

## 4. History, stop, standing jobs, agents

| ID | Use case | Automated | Live | Gap | To-do | Pri |
|---|---|---|---|---|---|---|
| UC-30 | `asp runs`, `asp runs <id>` show what happened, with the session's own run log | packages/asp-cli/test/run-history.test.ts | yes 10-12 | P24 | none | P0 |
| UC-31 | `asp stop` ends a running session | packages/asp-cli/test/run-history.test.ts | yes 10-12 | R1 | Stop a session that is waiting at an approval (done once by hand 10-12; not automated) | P0 |
| UC-32 | A standing job is reused, and replaced when it expires or the permissions change | packages/asp-cli/test/run-history.test.ts | partial 10-12 | R1 | Test expiry within ten minutes of the end; test a changed Mandate | P1 |
| UC-33 | Record quota: a long session does not use up the tenant's records | packages/asp-cli/test/gateway.test.ts | partial 10-12 (after the fix about half a record per tool call; 64 records for 76 calls over 2.2 h) | R1 | Measure a multi-hour continuous session (UC-37) | P1 |
| UC-34 | A second agent (`asp agent add/list/use`) | packages/asp-cli/test/agent-cmd.test.ts | yes 10-12 | P19 | none | P1 |
| UC-35 | Laptop sleeps or the network drops mid-session | packages/asp-cli/test/run-network-drop.test.ts | partial 10-14 (by the real wifi: turned off for about 30 seconds while an approval was held; the answer typed with the wifi off was kept, sent and recorded when it came back, the session finished with exit 0 and the approved command ran; also by stand-ins: the service made unreachable and restarted while an approval was held and while a session ended; the provider cutting the connection mid-answer. Not yet: the wifi off at the end of a session, a lid closed for a minute, the commands status and account show with the wifi off) | T2 | The owner turns the real wifi off for 30 seconds at the end of a session, closes the lid for a minute during a session, and runs status and account show with the wifi off | P0 |
| UC-36 | Work spread over hours (a live driver, not part of npm test): nine stages of a real task, ten-minute idle gaps, one standing job, the service watched throughout | evals/long-horizon.mjs | yes 10-12 (2.2 h, 9 stages, 76 tool calls, 0 crashes) | R1 | Repeat after the redeploy; add a gap longer than the standing job's refresh window | P1 |
| UC-37 | One session that runs continuously for hours (many hundreds of calls) | none | no | R1 | Run one; measure records, memory and the Mandate expiring mid-run | P1 |
| UC-38 | Dissect a long-horizon run in depth: what the agent did and why, record by record, run against run | evals/long-horizon-report.mjs | partial 10-12 (first report run on the 2.2 h run) | R1 | The analysis backlog below | P1 |
| UC-39 | A demo with no wifi and no account: `asp run <runtime> --local` shows a governed session and a refusal, with records only on this machine | packages/asp-cli/test/run-local.test.ts | yes 10-13 (against a dead service) | T4 | Try it on a clean machine, with the real Claude Code, before the 17th | P0 |

## 5. Run logs, custody and disclosure

| ID | Use case | Automated | Live | Gap | To-do | Pri |
|---|---|---|---|---|---|---|
| UC-40 | A session's run log is redacted and hash-chained | packages/asp-package/test/runlog.test.ts, packages/asp-package/test/redact.test.ts | yes 10-12 | E6 | Local encryption at rest | P1 |
| UC-41 | Seal a log to the service; the service cannot read it | packages/asp-package/test/runlog-vault.test.ts, packages/asp-cli/test/runlog-custody.test.ts | yes 10-12 | E16 | Open on a second machine after restoring the identity from the recovery code | P1 |
| UC-42 | Disclose a sealed log to a juror with a signed reason; the juror opens it | packages/asp-cli/test/runlog-custody.test.ts | yes 10-12 (as another agent of the same tenant) | E16 | Disclose across two tenants, and to the operator's court identity | P1 |
| UC-43 | Verify a log against the Actions that committed to it | packages/asp-cli/test/runlog-run.test.ts | partial 10-12 | P27 | Name the run in the Action's artifact so a standing job verifies cleanly | P1 |

## 6. Account, data and recovery

| ID | Use case | Automated | Live | Gap | To-do | Pri |
|---|---|---|---|---|---|---|
| UC-50 | Export an account (records, packages, sealed logs) | packages/asp-cli/test/account.test.ts | yes 10-12 | U9 | Check what a person sees in the files | P1 |
| UC-51 | Close an account; its token and personal data are deleted, records stay | packages/asp-cli/test/account.test.ts | yes 10-12 (first test tenant) | U9 | none | P1 |
| UC-52 | Lose the key and recover with the recovery code | packages/asp-cli/test/key-recovery.test.ts | no | U5 | Do it live: delete a key on purpose and recover | P1 |
| UC-53 | An agent's key lost, recovered by its sponsor | packages/asp-cli/test/key-recovery.test.ts | no | U5 | Do it live | P1 |
| UC-54 | Encrypted key backup and restore on a second machine | packages/asp-package/test/recovery.test.ts | no | U5 | Do it live | P1 |

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
| UC-71 | The lifecycle accepts and refuses the right records | packages/asp-core/test/conformance.test.ts | n/a | none | none | P1 |
| UC-72 | SPEC.md matches the schemas | packages/asp-core/test/spec-doc.test.ts | n/a | none | none | P1 |
| UC-73 | A malformed, oversized or hostile record is refused by the service | packages/asp-cli/test/log-service-limits.test.ts | partial | H14 | A fuzz pass over the record endpoints | P1 |
| UC-74 | Identities in a tenant's own namespace; a passport outside it is refused | packages/asp-cli/test/namespace.test.ts | yes 10-12 | P19 | none | P1 |

## 9. CI, headless and packages

| ID | Use case | Automated | Live | Gap | To-do | Pri |
|---|---|---|---|---|---|---|
| UC-80 | Headless run with a machine token and the agent's encrypted key | packages/asp-cli/test/run-headless.test.ts | no | P22 | Run the GitHub Action with a real Anthropic key on a real runner | P1 |
| UC-81 | Machine tokens: create, list, revoke, expire | packages/asp-cli/test/token-cmd.test.ts | no | P22 | Do it live | P1 |
| UC-82 | Pack an agent from one runtime and run it on another | packages/asp-cli/test/cli.test.ts | partial | P1 | Do it live between Claude Code and Codex | P1 |

## 10. The service: operations and abuse

| ID | Use case | Automated | Live | Gap | To-do | Pri |
|---|---|---|---|---|---|---|
| UC-90 | Redeploy with the setup script; Google sign-up stays on | none | yes 10-12 (found: a plain re-run turned sign-up off, fixed) | O19 | Redeploy again with all of today's fixes and re-run the live pass | P1 |
| UC-91 | Sign-up limits and caps hold; a flood of sign-ups is slowed | packages/asp-cli/test/signup.test.ts | no | O2 | Decide to close sign-up until invited (operator setting) | P1 |
| UC-92 | Per-tenant record and rate limits hold; a noisy tenant cannot starve others | packages/asp-cli/test/log-service-limits.test.ts | no | H15 | A load and abuse test | P1 |
| UC-93 | One command suspends everything and sign-up | none | no | O11 | Build and test it | P1 |
| UC-94 | An alert reaches the operator's phone when the service is down | none | no | O12 | Set up and test | P1 |
| UC-95 | A backup is restored once, on purpose | none | no | O12 | Do the restore drill | P1 |
| UC-96 | Mail on job end and alerts (dry-run today) | packages/asp-cli/test/mail-service.test.ts | no | E9 | A real send needs the operator's mail key and approval | P1 |

## 11. Security

| ID | Use case | Automated | Live | Gap | To-do | Pri |
|---|---|---|---|---|---|---|
| UC-100 | The service never sees a provider key or sign-in | packages/asp-cli/test/gateway.test.ts | partial | P22 | Check the live request logs and the sealed vault for key material | P1 |
| UC-101 | Secrets in a command or output never reach the log, the mail or the terminal | packages/asp-package/test/redact.test.ts | partial | E4 | Try odd secret shapes | P1 |
| UC-102 | A cloned repo's `asp.yaml` cannot grant itself the network | packages/asp-cli/test/discover.test.ts | no | U16 | none | P1 |
| UC-103 | One tenant cannot read or change another's data | packages/asp-cli/test/package-service.test.ts, packages/asp-cli/test/runlog-custody.test.ts | partial | H14 | A pass over every route with two tenants | P1 |
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
| UC-121 | Judge it before installing: read the limits, see a working demo without installing anything | none | no | U6 | Record a 90-second demo; a plain "what is real, what is not" page on the website | P1 |
| UC-122 | Read the terms and the privacy notice before signing up; the version accepted is recorded | packages/asp-cli/test/signup.test.ts | partial 10-12 | O19 | A lawyer's read; what happens when the version changes | P1 |
| UC-123 | Understand what is permanent (signed records stay) and what is deleted on close | packages/asp-cli/test/account.test.ts | partial 10-12 | U9 | One plain page "what happens to my data", linked from sign-up | P1 |
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
| UC-136 | Allow named hosts (`--allow-network`); only those work | packages/asp-cli/test/gateway.test.ts | partial 10-12 (refusal only) | H2 | Run a session that reaches an allowed host live | P1 |
| UC-137 | "It refused something I need": the refusal says how to allow it | packages/asp-cli/test/run-local.test.ts | partial 10-14 (a refused shell command and a refused web fetch each end with the exact way to allow it, checked live on a clean clone; a refusal for any other scope has no hint) | U6 | Add the how-to-allow hint for the other refusal kinds (a scope the Mandate lacks, a host); a test for the web fetch case | P0 |
| UC-138 | Two sessions at once for one agent (two terminals) | packages/asp-cli/test/run-concurrent.test.ts | yes 10-13 (two real Claude Code sessions, approvals answered one after the other; polling slowed to fit the service's 120 requests a minute) | T12 | Decide the per-tenant request limit (T12); the standing job's session count can still lose an update when two sessions start in the same moment | P1 |
| UC-139 | The standing job expires after seven days; the next run makes a new one without fuss | packages/asp-cli/test/run-history.test.ts | no | R1 | Test the expiry boundary | P1 |
| UC-140 | The service is down, or there is no network: every command says so plainly and what still works | packages/asp-cli/test/run-local.test.ts | partial 10-14 (by the real wifi: with it off, `status` said the service was not reachable and showed what it knew from this machine, `account show` gave one plain sentence naming what still works, and `runs` listed the sessions; also a dead service address. Not yet: `run` with the wifi off from the start) | T4 | Run `asp run` with the wifi off from the start (it should say plainly what to do, and `--local` should work) | P0 |
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

## 23. Three perspectives: the agent, the principal, the work

Every row above is written from a person's side. A protocol for agents also has to be checked from the **agent's** side and from the side of **the work itself**, and the principal's view of both. Each row names its perspective: **[agent]**, **[principal]**, **[work]**. These rows are mostly untested; they are the list of what to examine after the first-15-minutes bar is met.

| ID | Use case | Automated | Live | Gap | To-do | Pri |
|---|---|---|---|---|---|---|
| UC-200 | [agent] What the agent itself sees: its Mandate, what it may do, and a refusal that explains itself so the agent can adapt instead of looping | packages/asp-cli/test/run-session.test.ts | partial 10-12 (Claude Code only) | T10 | Read a real session from the agent's side (the refusal text, the retries); try a weak model; check the agent can find its own Mandate | P1 |
| UC-201 | [agent] An agent under the protocol keeps a stable identity across sessions, machines and runtimes | packages/asp-cli/test/memory.test.ts | no | T10 | Move one agent between two runtimes and two machines; check the lineage | P1 |
| UC-202 | [agent] Data logging: what is recorded about each session (calls, refusals, results) and how it is represented to a reader | packages/asp-cli/test/run-session.test.ts | partial 10-12 | E7 | Decide what a reader needs; tool results are left out of the log today; define the representation and a reader | P1 |
| UC-203 | [agent] Continual learning: what the agent learns in a run is carried, signed, merged and offered to the next run | packages/asp-cli/test/memory.test.ts | partial 10-12 (Claude Code write-back) | D9 | Show a lesson going in and coming out across two live runs; verify a lesson before it enters memory | P1 |
| UC-204 | [agent] The agent is told what it learned and what was forgotten (memory loss is detected) | none | no | D3 | Detect and report memory loss; show the principal what was learned (D10) | P2 |
| UC-205 | [agent] Agent drift: behaviour changes after a memory update or a runtime or model swap, and the change is noticed | packages/asp-cli/test/canary.test.ts | no | D1 | Run the canary set before and after a change live; compare an outcome series across a lineage edge (D2) | P1 |
| UC-206 | [agent] The model that actually ran is recorded, so a change of weights behind a name shows up | none | no | D4 | Record the model identifier the provider reports in each run | P2 |
| UC-207 | [agent] An agent is manipulated (prompt injection, goal hijacking) and the Mandate still holds | packages/asp-cli/test/compliance.test.ts | no | D6 | Run an injection scenario live; the Mandate bounds actions but nothing detects the hijack | P1 |
| UC-208 | [agent] Whistleblowers: an agent or a person reports another agent's violation, and it is checked and ruled on | packages/asp-cli/test/report.test.ts | no | H3 | Replay the shared-task shortcut scenario (docs/backlog.md) with the operator's court; third parties have no way to report | P1 |
| UC-209 | [agent] Cheating: an agent games its checker or hides a failure, and the log shows it | none | no | D7 | Design the check (reasoning-trace and outcome checks); an adversarial run | P2 |
| UC-210 | [agent] Two agents of one principal work together under separate Mandates without widening each other's | packages/asp-cli/test/run-session.test.ts | no | T3 | Run a pair live (also UC-138: two sessions at once) | P1 |
| UC-211 | [principal] What the agent did on my behalf, in words I can read, without opening a log | packages/asp-cli/test/run-session.test.ts | partial 10-12 (`asp runs`) | E8 | The end-of-job summary and a reader for the run log | P1 |
| UC-212 | [principal] Am I being told when an agent drifts, fails or is refused, without having to look | none | no | U7 | Alerts outside the CLI; define what is worth an alert | P1 |
| UC-213 | [principal] Quality, cost and time of my agents over weeks, not one session | none | no | D8 | A trend view per agent | P2 |
| UC-214 | [principal] I can stop, pause or roll back an agent mid-work, and know what state it left | packages/asp-cli/test/run-session.test.ts | partial 10-13 | T2 | Ctrl-C test (UC-17); pause and rollback are not built (D13) | P1 |
| UC-215 | [work] What the agent produced, and which Mandate, run and model produced it, can be traced from the result back | none | no | T11 | Attach the run and the Mandate to the work (a commit trailer or a sidecar) and verify it from the result | P1 |
| UC-216 | [work] The work is checked against what was asked (an outcome check), not only against what the agent was allowed to do | packages/asp-cli/test/eval.test.ts | no | T9 | Run outcome verification live | P1 |
| UC-217 | [work] Work done by several agents or in parallel nodes is merged and its parts stay attributable | none | no | T9 | Run a fleet live | P2 |
| UC-218 | [work] A third party who receives the work can verify where it came from without trusting the producer | packages/asp-cli/test/witness.test.ts | n/a | T11 | A one-command verify for a recipient (also UC-195) | P1 |

| UC-229 | [principal] The same view over a week: trends in sessions, refusals, failures, tokens and time, per agent | none | no | T14 | After the day's view: a weekly roll-up and a way to see an agent getting better or worse (D2, D8) | P1 |
| UC-230 | [work] The day's view says what was produced as well as what was done: files changed, results delivered, with the run that made them | none | no | T14 | Add the changed files per session (from the run log) to the day's table; tie to UC-215 | P1 |

| UC-231 | [agent] Identity: the principal, each agent and each subagent have their own unique address and key; no two share either; a subagent (a node) has its own short-lived key and names its parent and its end time | none | no | T15 | Live set 4 (docs/live-run-identity.md): make a principal, an agent and a subagent; check addresses, keys and the node record; try to make two share a key | P1 |
| UC-232 | [agent] Every tool call and function call (built-in tools, shell commands, MCP tools, the model's own tool-use blocks, a subagent's calls) is in the run log under the right identity, in the Action's scopes used when allowed, and recorded as blocked when refused, with no secret in it | packages/asp-cli/test/run-session.test.ts | partial 10-13 (built-in tools and shell commands, one real session each; no MCP, no subagent) | T15 | Live set 4, part B: one of each kind, then compare the run log with the Action | P1 |
| UC-233 | [agent] Skills and memory: a skill added or removed is a signed lineage edge, listed in the package manifest; a skill used but not in the manifest is caught | packages/asp-cli/test/memory.test.ts | no | T15 | Live set 4, part C | P1 |
| UC-234 | [principal] From any logged call the principal can read which identity made it, under which Mandate, when, and whether it was allowed | none | partial 10-13 (`asp runs <id>` and `asp run-log show <id>` for a session) | T15 | Live set 4, part D; for a subagent's call too | P1 |

| UC-235 | [principal] Running your own agent needs no credits: an account with zero credits runs sessions under a Mandate, and the standing job's bond and escrow are 0 | packages/asp-cli/test/run-session.test.ts | yes 10-13 (`navien-livetest`: 0 credits, 13 sessions, the job's records show escrow 0 and bond 0) | T16 | none | P1 |
| UC-236 | [principal] When the tenant's record quota is full (about a thousand sessions on a new account) a session still runs and finishes, says plainly that the record could not be kept and why (the quota), exits as a success when the agent's work succeeded, and keeps the unsent record to send once there is room | packages/asp-cli/test/run-quota-full.test.ts | partial 10-13 (a real log service process with a record quota of 14: the sessions after it was full ran, exited 0, named the cause, kept their reports, `asp status` warned before and after, and the next session after the limit was raised sent them by itself; not on the hosted service, which has 2,000) | T16 | Try it on the hosted service with a test tenant given a small quota | P1 |
| UC-237 | [principal] Everything except the intent is automatic when an agent works for someone: the principal says what they want, and the offer, contract, escrow, Mandate, bond, delivery check, acceptance and settlement happen without further steps from them (only an approval they asked for, or one the policy cannot decide, reaches them) | none | no | T17 | Design the automatic flow (docs/market-automation.md); build the first piece: an intent that finds or is given a performer and runs the contract steps itself | P1 |

| UC-238 | [principal] Credits are automatic: no credit command is ever needed. Escrow comes from the intent's budget, the bond from the performer's standing (or its owner's standing policy), settlement from the passed check; an agent with too few credits is given lower-risk work, never shut out | none | no | T18 | Build with the automatic hire flow (docs/market-automation.md); test an agent with 0 credits, 20 and 1,000 | P1 |
| UC-239 | [agent] Credits tie to continual learning: a shared lesson stakes a small amount, a lesson cited by successful runs earns its author credits, a lesson that regresses is slashed, and a verified improvement lowers the agent's required bond | none | no | T18 | Design is in docs/credits-and-reputation.md; build the stake and the citation reward on the commons first | P2 |
| UC-240 | [agent] A rank for agents and for runtimes, computed by anyone from the signed records (a weighted PageRank over accepted deliveries, citations, verifications, sponsorships and negative edges), resistant to a ring of colluding accounts, and used for tier, offer order and runtime choice | none | no | T18 | A simulated market with honest, careless and colluding agents; then the real log; needs the model digest recorded (D4) | P2 |
| UC-241 | [agent] A long-horizon job keeps its history when its standing job expires and is renewed, resumes after a failure partway instead of restarting, and is checked for drift at each stage | packages/asp-cli/test/memory.test.ts | partial 10-12 (one real 2.2-hour run, nine stages; no renewal, no resume, no stage drift check) | T19 | Docs/horizons.md lists the gaps; start with renewal (a job that expires mid-work) and resume | P1 |

| UC-242 | [agent] How a coding agent is selected, open-source or enterprise: the choice weighs whether the Mandate can be enforced on it (assurance level), where the data may go, its reliability for the task, its metered cost in credits, and the organisation's policy; low credits move the choice to a cheaper runtime and never refuse the run | packages/asp-cli/test/run-runtimes.test.ts | no | T20 | Extend the model matrix to record assurance, reliability, tokens and metered credits per runtime and model; then the selection rule (docs/runtime-selection.md) | P1 |
| UC-243 | [principal] Every run has a credit budget and a metered use, including a person's own agent (a generous default nobody notices); the metering rate is recorded with the Action; credits never buy model calls; **credits are shown in every session's summary as one line, and in full on request** (`asp credits`) | packages/asp-cli/test/run-quota-full.test.ts, packages/asp-cli/test/compliance.test.ts, packages/asp-cli/test/credit-ledger.test.ts | partial 10-13 (the summary line for a standing-job session and for a run under a contract; `asp credits` on the live account; the budget and metered use are not built) | T20 | Record the runtime, model digest and metering rate in the Action; show the metered use in the session summary and the day's view | P1 |
| UC-244 | [principal] The credits of a job, by entity, can be watched during a run and add up at every step: escrow, bond, the court-fee reserve, the performer's earnings, the jurors' pay; nothing created or lost | packages/asp-cli/test/credit-ledger.test.ts | yes 10-13 for a whole job (the hosted service, `navien-live`: 400/600, then 360/580 with 40 and 20 locked, then 360/640; the log verified, 276 records); not yet for a rejected job with the court, or for the long job under a contract | T20 | Act 3 (the court) and act 5 (the long job) of docs/live-run-market.md | P1 |
| UC-245 | [principal] An accepted job pays the agreed price and returns the bond with no amounts typed (found in the rehearsal: it paid nothing) | packages/asp-cli/test/credit-ledger.test.ts | yes 10-13 (a local log) | none | none | P1 |
| UC-246 | [agent] Under a contract, a shell command that only looks (ls, cat, grep, git status) is a read, not a strike: the hook and the shared classifier agree, and a gate on shell commands still holds every shell call | packages/asp-package/test/mandate-hook.test.ts | yes 10-13 (found live: Claude Code's `ls -la` was blocked as shell.exec under a read-only Mandate and counted as strike 1 of 3; fixed, S134) | none | none | P0 |

| UC-247 | [principal] On a long job with approvals, the credits behave: an approval moves no credit (escrow and bond stay locked), the time the agent spends waiting for a person is not held against it (not in its working time, not against the deadline, not grounds for fault), and the log shows how long each approval waited | none | no | T21 | Record waiting seconds apart from working seconds in the Action's metrics; keep approval waits out of the contract's deadline and out of a ruling's reasons; run a gated long job and read the credits | P1 |
| UC-248 | [principal] A gate on a job under a contract asks only about risky commands (deleting, pushing, anything outside the project, the network) and remembers "always" for an exact command, as the personal gateway path does, so an hour of work is a few questions and not dozens | packages/asp-cli/test/gates.test.ts | partial (by the fake runtime: risky held, ordinary unasked, an "always" command not asked) | T21 | A real gated hour under a contract; a way to say "always" from the contract path's approval | P0 |
| UC-249 | [principal] Sub-agents cannot game the identity rules: a helper works only under a short-lived, revocable node key tied to this job's Mandate; a node without the Mandate, one bound to another contract, a long-lived separate agent signing on the job, or one past its end time is refused by the log; revoking it stops it at once | packages/asp-log/test/registry.test.ts | partial (by tests: expiry, no identity records, revocation; not on the hosted service) | T22 | Add the rules in T22 with a spec-delta row and vectors in both SDKs; then a live orchestrate run that tries each bypass and checks the log refuses it | P0 |

**Perspective index.** Agent: UC-200 to UC-210, UC-231 to UC-233, UC-239 to UC-242. Principal: UC-211 to UC-214, UC-234 to UC-238, UC-243 to UC-245, UC-247, UC-248, Agent also UC-246, and the earlier rows of sections 13 to 21. Work: UC-215 to UC-218, UC-230. The day's view, for all three: UC-228, UC-229.

## 24. Where a failure sits on the flow

Each thing found or fixed is placed on the flow: the **stage** a session is in and the **action** of the person or the agent at that moment. This is how the interruption cases are enumerated, so that a fix for one cell does not leave its neighbours unexamined. Rows with a UC id are in the tables above or below; "done" cells name the test.

| Stage of a session | Action (who) | What must hold | Status |
|---|---|---|---|
| Starting (Mandate being made, tool launching) | Ctrl-C (person) | no half-made job or stray stop file; the next run starts clean | UC-219, untested |
| Agent working, no command running | Ctrl-C (person) | the session is recorded as stopped; the job stays usable | done: UC-17 |
| Agent running a long command (a build, a script) | Ctrl-C (person) | the command is ended with the session, not left running | done: UC-17 (Windows tree kill) |
| A call held for approval | Ctrl-C, terminal closed, SIGTERM (person) | the session is stopped, the held call is refused, the Checkpoint is closed, nothing is left waiting | done: UC-220 (all three signals; live for Ctrl-C) |
| A call held for approval | no answer in time (person away) | expiry settles it; the agent is told once | done: UC-23, UC-25 (S118 to S121) |
| Any | Ctrl-C twice | leaves at once, records the end | done: UC-17 (second press path, by code; not exercised live) |
| Any | terminal closed or hung up (SIGHUP) | same as Ctrl-C | UC-221, by code, not exercised |
| Any | process killed outright, power cut, crash | the session reads as interrupted, not running | done: UC-17 (`asp runs` says interrupted) |
| Any | a second terminal starts a session for the same agent | the job and the one-open-Checkpoint rule hold | UC-138, untested |
| Hooked runtime (Antigravity, OpenHands) | Ctrl-C (person) | the same, through the package path | UC-222, untested |
| Interactive session | terminal closed or SIGTERM | the session is stopped | done: UC-223 (SIGHUP by test; tab close live) |
| Interactive session (no prompt) | Ctrl-C (person) | Ctrl-C belongs to the tool (it usually means "cancel this answer"); the session must not end by accident; it ends when the tool does | done: UC-223 (S125; live only at the first-run screen) |
| Agent (its own code) | the agent starts a process that outlives it | that process is ended with the session | UC-224, Windows only so far (taskkill); macOS and Linux rely on the terminal's process group |

| ID | Use case | Automated | Live | Gap | To-do | Pri |
|---|---|---|---|---|---|---|
| UC-219 | Ctrl-C while the session is still starting (before the tool launches) leaves no half-made state | none | no | T2 | Interrupt at each step of the start; check the standing job and the stop file | P1 |
| UC-220 | Ctrl-C while a call is held for approval closes the Checkpoint | packages/asp-cli/test/run-interrupt-approval.test.ts | yes 10-13 (Claude Code, a command held at the prompt) | T2 | none (found three defects, fixed in S124; the held call and the open Checkpoint are closed when the session is) | P0 |
| UC-221 | Closing the terminal window ends the session the same way | none | no | T2 | Try on Windows (closing the tab) and Linux | P1 |
| UC-222 | Ctrl-C of a hooked runtime session (Antigravity, OpenHands) | none | no | T2 | Run with the real runtime | P1 |
| UC-223 | Ctrl-C in an interactive session does not end the whole session by accident | packages/asp-cli/test/run-interrupt.test.ts | yes 10-13 (real Claude Code: Ctrl-C at the tool's own permission prompt closed only that prompt and the session carried on; two Ctrl-Cs at the first-run screen were the tool's; closing the tab left it `interrupted`) | T2 | none | P1 |
| UC-224 | A process the agent started is ended with the session on macOS and Linux | none | no | T1 | Test on both; kill the process group if the terminal does not | P1 |

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

**Last step, once every P0 row above is done or consciously deferred: a full live rehearsal of the flow.** One clean run, on a clean machine and the hosted service, as a developer would do it: clone, `asp`, `asp join`, `asp run` with a prompt, an approval answered from a second window, Ctrl-C, `asp runs`, an agent added, a recovery, `asp account export`. Time it against the 15-minute bar, write what went wrong in docs/live-run-checklist.md, and fix it before the conference (2026-10-17). Do it again after any fix.

The P0 rows above, in the order to do them: redeploy (UC-90) and re-run the live pass; Codex, headless Action and key recovery live (UC-11, 80, 52, 54); the first-use failures (UC-02, 04, 16, 17, 35); the service's safety basics (UC-91, 93, 94, 103); then the demo and wording (UC-110, 112).

## Keeping it current

- A change that adds, removes or changes a use case updates its row in the same commit. A bug found live gets a new row or changes an existing one, and a row in the gaps register.
- When something is run live, put the date in **Live** and say what was faked.
- `packages/asp-cli/test/testing-map.test.ts` fails when a row names a test file or a gap that does not exist, uses a priority that is not P0, P1 or P2, names a gap that is not a row of the register, or repeats an ID.
- **The common path comes first** (the section at the top): P0 is only what sits on it. A row for a failure that hits few users is P1 or P2.
- **Order of work.** Rows on a direct flow come first: the **user flow** (a person installs, joins, runs, approves, stops, leaves), the **agent flow** (what the agent sees and does under a Mandate) and the **work flow** (what is produced and whether it can be traced). Operator, implementer and long-term rows follow. When two rows tie, the one nearer the start of a person's first 15 minutes goes first. `python evals/interrupt-matrix.mjs` runs every automated interruption case in one go.
- Every bug found or fixed is placed on the flow (section 24): which stage of the session, and which action of the person or the agent. Fill in its neighbouring cells as rows, not only the one that was hit.
- Review the P0 list at the start of each working day until the conference.
- An Excel view (a summary driven by formulas, the use cases with filters, the gaps register, the analysis backlog) is made by `python evals/testing-map-to-xlsx.py out.xlsx`. The markdown stays the source of truth; regenerate the workbook when the map changes.
