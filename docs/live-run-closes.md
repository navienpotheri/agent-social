# What a real-model run can close, and what it must show first

Written 2026-11-22 by lane-protocol-3 at the lead's request, on the owner's instruction: the smoke run, the live run on the evening of 2026-11-23 (items 1 to 9 of [live-run-plan.md](live-run-plan.md), with the owner's own key) and the 15-agent model cohort ([society-models-run.md](society-models-run.md), DK1801) are to be used to **close** priority A and B rows. This page is the note for doing that without claiming a row too early. Credits are mock accounting entries, not money. The service is a beta. There has been no outside security review. Nothing here claims that agents become more aligned.

**The rule.** A row moves only when the evidence named under it is in hand, matches its `Counts when` line (live-run-plan.md, section 3) or its Done line (the register), and the check named under it passes afterwards. If the evidence is missing, the row stays what the last line of its block says. A run that fails opens a row for what went wrong; it never closes the one it was meant to.

**How each block reads.** *Done line* is quoted word for word from [gaps-register.md](gaps-register.md) (a test checks the quote). *Settled by* names the run. *The run must produce* is the exact evidence. *Extract with* is the command that prints it (all are in [commands.md](commands.md)). *Check before closing* is the test or check the lead runs afterwards. *Stays* is the status when the evidence is missing. *Too early if* names the claim that is tempting and wrong.

**Runs.** *Rehearsal* is `.\scripts\evening-rehearsal.ps1` (no key, a stand-in model): it proves the path, never a row that needs a real provider. *Item N* is item N of the evening. *Cohort* is the 15 agents of `claude-haiku-5-5` on a local service (USD 6 in all). Paste back the block of live-run-plan.md section 5 for every item; the worker records it in [live-run-checklist.md](live-run-checklist.md).


## 1. Rows the evening run can settle

### DK1602 — the sponsor page and the run agree on tokens

- **Done line:** "Done: the run recorded in docs/live-run-checklist.md with both figures." (priority A, status `open` in the register today)
- **Settled by:** Item 1 (a governed Claude Code run).
- **The run must produce:** the number of tokens on the sponsor page and the number in `asp runs <id>` for the same run, equal; the `curl` call refused with the scope `shell.network`; `asp runs` showing `1 refused`.
- **Extract with:** `npm run asp -- journey <agent name> --sponsor-view` (the tokens line) and `npm run asp -- runs <id>`; `npm run asp -- live report --json` for the same session.
- **Check before closing:** the two figures are compared by eye and pasted; `npm run asp -- run-log verify <the run log path>` prints a valid chain; `node --test packages/asp-cli/test/journey-cost.test.ts` (the stand-in version) still passes.
- **Stays:** `open` (the register says the run is postponed by the owner until it happens).
- **Too early if:** the figures differ by a rounding and are called equal, or the run was `--local` (a local run has no sponsor page).

### P21 — each runtime started by `asp run` as a governed session

- **Done line:** "`--package` to keep memory; `--sandbox`; a first real run of each" (priority A, status `partial` in the register today)
- **Settled by:** Item 1 (Claude Code), item 5 (Codex, then Goose), item 7 (Antigravity and OpenHands, only if installed).
- **The run must produce:** for each runtime, one session with one refusal under the Mandate: `asp runs <id>` shows the refusal and its scope, and `asp live report` shows calls allowed and refused with reasons and the run-log chain check.
- **Extract with:** `npm run asp -- runs <id>` and `npm run asp -- live report` after each run; `npm run asp -- runtimes` for how the runtime is held.
- **Check before closing:** one `runs <id>` block for each runtime in the checklist; `npm run asp -- run-log verify <path>` for each; the row text is updated to list exactly the runtimes that have a recorded run.
- **Stays:** `partial`, with each runtime that has no recorded run named in the row.
- **Too early if:** it is closed after Claude Code alone; Antigravity and OpenHands are held by the runtime's own pre-call hook and the observation of its output, not by the gateway, so a refusal there proves the hook and not the gateway; a stand-in run is not a real run.

### E5 — a run log for every runtime's session

- **Done line:** "Route those runs through the gateway recorder, or write the same events from the adapters' streams" (priority A, status `partial` in the register today)
- **Settled by:** Item 1 (Claude Code), item 5 (Codex, Goose), item 7.
- **The run must produce:** a run log file `runs/<agent>-<time>/run-log.ndjson` for each session, with its hash chain valid, each call with its input and result, how the session ended, and the Action that commits to it.
- **Extract with:** `npm run asp -- run-log show <log>`, `npm run asp -- run-log verify <log>`, and the chain line of `npm run asp -- live report`.
- **Check before closing:** `run-log verify` is valid for each log; `node --test packages/asp-package/test/runlog.test.ts` still passes; the row text names the runtimes that have a log from a real run.
- **Stays:** `partial`, per runtime.
- **Too early if:** a runtime's log was written only from the scope verdicts the compliance bridge saw (Antigravity, OpenHands) and is described as a full log of its calls and replies.

### DK650 — the sponsor-less route run live

- **Done line:** "Done: the checklist rows run and recorded, the timer test passing, and the owner's decision recorded in docs/owner-decisions.md." (priority A, status `partial` in the register today)
- **Settled by:** Item 2 (a key-only agent and a sponsored agent, side by side).
- **The run must produce:** the key-only agent enrolled with its own identity and 100 mock starter credits; both runs showing the same refusals and the same starter amount; the only difference who answers for the agent.
- **Extract with:** `npm run asp -- enrol --service <url> --name <name> --accept-terms`, `npm run asp -- account show`, `npm run asp -- credits balance <did>`, then `npm run asp -- runs` in each home.
- **Check before closing:** both `asp runs` outputs and both balances pasted; `node --test packages/asp-cli/test/key-only-run.test.ts` (the stand-in version) passes; the log sequence numbers of the enrolment are in the checklist.
- **Stays:** `partial`: the Done line also needs the review timer and the owner's decision in docs/owner-decisions.md, and no evening run exercises a timer that runs in days.
- **Too early if:** it is closed on the strength of the run alone; the timer and the owner's decision are separate halves of the Done line.

### T15 — identities are unique and every call is logged under the right one

- **Done line:** "Live set 4 (docs/live-run-identity.md): make the three identities and one of every kind of call, and compare the run log, the Action and the chain" (priority A, status `open` in the register today)
- **Settled by:** Item 3 (sections A to D of [live-run-identity.md](live-run-identity.md)).
- **The run must produce:** the table that document asks for: a principal, an agent and a sub-agent with three different keys and addresses; each kind of call (a built-in tool, a shell command, a file write, an MCP call, a skill or memory change) found in the run log and in the Action under the right identity; no secret in either.
- **Extract with:** `npm run asp -- journey <name> --json` for each identity, `npm run asp -- run-log show <log>`, `npm run asp -- log verify`.
- **Check before closing:** the three journeys are compared with the table by the worker; `npm run asp -- run-log verify <log>`; a search of the pasted ids and logs for the key material in use (none).
- **Stays:** `open`.
- **Too early if:** two identities share a key or an address and the run is called a pass; a sub-agent call is attributed to its parent and not noticed.

### T22 — a sub-agent's key is short-lived and bound

- **Done line:** "Still open: a helper hired as a separate long-lived identity, and a live orchestrate run that tries each bypass." (priority A, status `partial` in the register today)
- **Settled by:** Item 3 (the node under `asp orchestrate`).
- **The run must produce:** the sub-agent's records carrying its own node key and an end time; the node grant citing the Mandate; the same under the hosted service with `requireNodeMandate` on.
- **Extract with:** `npm run asp -- fleet show` and `npm run asp -- journey <sub-agent>`; the grant record id from the run log.
- **Check before closing:** `node --test packages/asp-log/test/node-requires-mandate.test.ts` (the refusal `node_needs_mandate`) passes; the records are read for the end time.
- **Stays:** `partial`: the register keeps two halves open that no evening run closes, a helper hired as a separate long-lived identity and a live orchestrate run that tries each bypass.
- **Too early if:** the evening's one orchestrate run is called the bypass run.

### DK1600 — a real agent sits a course end to end

- **Done line:** "Done: the run recorded in docs/live-run-checklist.md with the agent's own sitting, its result with the error bar, the tuition moved and the lessons written through the lesson gate." (priority A, status `open` in the register today)
- **Settled by:** Item 4 (`asp academy lens sit <course id> --by <did> --enrol`).
- **The run must produce:** the agent's own sitting printed with its error bar; the tuition moved (the learner's balance before and after); the lessons written through the lesson gate, with their ids.
- **Extract with:** `npm run asp -- academy lens sit <course id> --by <your agent did> --enrol`, `npm run asp -- credits balance <did>` before and after, `npm run asp -- learned`.
- **Check before closing:** the printed result matches the shape of the stand-in run: `node --test packages/asp-cli/test/lens-course-sit.test.ts`; the new lesson ids are in `asp learned`; `npm run asp -- academy lens fingerprint --by <did>` lists the course.
- **Stays:** `open`; DK1342 and DK1347 keep their tested-flow closure and gain the live note.
- **Too early if:** the result has no error bar, or the lessons were written without the gate, or the learner was a scripted executor.

### T2 — the first minutes of a session fail clearly

- **Done line:** "Add and run each case; make each say what happened and what to do." (priority A, status `partial` in the register today)
- **Settled by:** Item 6 (sleep for ten minutes; two terminals; no network).
- **The run must produce:** a session that ends or continues after ten minutes of sleep with a message saying what happened; one line for each case.
- **Extract with:** `npm run asp -- runs` and the message printed at the resume.
- **Check before closing:** the one-line observations pasted; `node --test packages/asp-cli/test/run-interrupt.test.ts packages/asp-cli/test/run-network-drop.test.ts` still pass.
- **Stays:** `partial`: the launch bar names two cases untested, laptop sleep and a multi-gigabyte repository, and the evening covers only sleep.
- **Too early if:** sleep is observed and the large repository is not, and the row is closed.

### T3 — two sessions on one agent are safe

- **Done line:** "Test and fix concurrent sessions and approvals" (priority A, status `partial` in the register today)
- **Settled by:** Item 6 (two `asp run` commands for the same agent within a second).
- **The run must produce:** both sessions start, `asp runs` shows both, neither stalls.
- **Extract with:** `npm run asp -- runs` after the two starts.
- **Check before closing:** the CI job `approvals-debug` (five runs of `run-concurrent.test.ts` on Linux with `ASP_DEBUG_APPROVALS=1`) passes; the claim 'two sessions on one agent are safe' stays off until it does.
- **Stays:** `partial`, as the register says: the one-open-Checkpoint rule across two sessions is the unreliable Linux CI test T23.
- **Too early if:** one good evening on one Windows machine is read as the proof; the register's own condition is a CI pass.

### T4 — no network, no service: a local run

- **Done line:** "**Left:** a real wifi-off run with the real tools on a clean machine." (priority A, status `partial` in the register today)
- **Settled by:** Item 6 (wifi off, `asp run claude-code --local`).
- **The run must produce:** the run starts without the service and says that it is local.
- **Extract with:** `npm run asp -- run claude-code --local --prompt "Say done" --project C:\scratch\repo` and its summary.
- **Check before closing:** the one-line observation pasted; `node --test packages/asp-cli/test/run-local.test.ts` passes.
- **Stays:** `partial` (the register's remaining item is exactly this run, on a clean machine).
- **Too early if:** the machine was not clean (a saved login was present) and the line is not said.

### DK1604 — a real model agent under the drift schedule for a week

- **Done line:** "Done: the run recorded in docs/live-run-checklist.md with the log's sequence numbers and the figures." (priority A, status `open` in the register today)
- **Settled by:** Item 8 (register one real agent; the row closes only after a week of results).
- **The run must produce:** the date and the agent; after seven days the Clinic's drift series for it with announced and unannounced results and the seed revealed with each; the log sequence numbers.
- **Extract with:** `npm run asp -- clinic series --agent <did> --all` and `npm run asp -- clinic probe drift --agent <did>`.
- **Check before closing:** `node --test packages/asp-cli/test/drift-scheduler.test.ts` passes; the revealed seeds are replayed (the draw is in `packages/asp-package/src/drift-scheduler.ts`); the figures are in the checklist.
- **Stays:** `open` until seven days have passed.
- **Too early if:** the registration is read as a result, or a week is closed after one clean day.

### DK1712 — drift detection runs by itself

- **Done line:** "Done: a test in which a seeded drifting agent (good while announced probes run, different in unannounced ones) is flagged by the service without a human running anything;" (priority A, status `partial` in the register today)
- **Settled by:** Item 8 starts it; the cohort supplies inputs only.
- **The run must produce:** a seeded drifting agent flagged without a person running anything (already a stand-in test); on the host, a service process driving the schedule on a timer.
- **Extract with:** `npm run asp -- clinic series --agent <did> --all` over the week of DK1604.
- **Check before closing:** `node --test packages/asp-cli/test/drift-scheduler.test.ts`; the owner's answer to question 31 of [owner-questions-all.md](owner-questions-all.md) (the Clinic's key) recorded.
- **Stays:** `partial`: no service process runs the scheduler on a timer yet, whatever the evening shows.
- **Too early if:** a week of one agent's results is called the scheduler on the service.

### DK1364 — personal-agent runtimes, each with a recorded run

- **Done line:** "Done: for each runtime a test with a stand-in and a recorded real run when the live run with real agents is allowed (until then partial), and the docs and site list only runtimes with a recorded run." (priority A, status `partial` in the register today)
- **Settled by:** Item 9 (as available: OpenClaw, Hermes, others).
- **The run must produce:** for each runtime brought in, a recorded run through the gateway or the self-report SDK, the first-minute instructions that were followed, and the assurance level observed.
- **Extract with:** `npm run asp -- runtimes personal <name>` for the stated level and `npm run asp -- live report` for the run.
- **Check before closing:** `node --test packages/asp-cli/test/personal-agents.test.ts`; the docs and the site are searched for any runtime named without a recorded run (the Done line forbids it).
- **Stays:** `partial`, per runtime.
- **Too early if:** a runtime appears on the site after a stand-in test only, or a hosted agent that cannot be wrapped is listed as wrapped.

### DK79 — all nine telemetry signals from a real agent

- **Done line:** "Done: a simulated society and a real agent each produce all nine signals, a lens (belief recalibration under a world-calendar shock) computes its measures from them reproducibly, and a signal an agent or sponsor has not consented to is never collected." (priority A, status `partial` in the register today)
- **Settled by:** Item 1 and item 4 produce some; the cohort produces the most (15 agents, no goal).
- **The run must produce:** from a real agent, the nine signals listed in `packages/asp-log/src/telemetry-disclosure.ts`, each present or named as absent; no signal the agent or sponsor did not consent to.
- **Extract with:** `npm run asp -- telemetry status`, `npm run asp -- telemetry list`, `npm run asp -- telemetry show --by <agent>`.
- **Check before closing:** `node --test packages/asp-log/test/telemetry-disclosure.test.ts` (nothing claimed without a signal); the signals present are counted against the nine; the lens reproduces its measure from the same input.
- **Stays:** `partial`: a signal with no real record stays unclaimed, as the register already says for skills, goals, messages and profiles.
- **Too early if:** 'all nine' is said after five, or a reasoning trace is claimed where the provider returns only a summary.

### DK241 — the Mandate's telemetry field read by a real run

- **Done line:** "Done: a test in which a gateway run with a Mandate that lists one signal collects exactly that signal and no other, and a run without the field produces `telemetry: off` and no source call; then a live run with a real agent and the owner's consent." (priority A, status `partial` in the register today)
- **Settled by:** Item 1 or the cohort, with the owner's consent recorded.
- **The run must produce:** a run whose Mandate lists one signal collecting exactly that signal; a run without the field printing `telemetry: off`.
- **Extract with:** `npm run asp -- telemetry status` and `npm run asp -- telemetry list` after each run.
- **Check before closing:** the stand-in tests in `packages/asp-package/test` for the Collector pass; the owner's consent is in docs/owner-decisions.md.
- **Stays:** `partial`: it needs the owner's privacy text and consent as well as the run.
- **Too early if:** a run is counted without the consent on record.

### DK1716 — a secret in a tool call is blocked, not sent

- **Done line:** "Done: a test that a planted key in a tool call is blocked or redacted and a record names the kind and holds no value;" (priority A, status `partial` in the register today)
- **Settled by:** Item 1 (add a planted fake key to the prompt of one extra run) or the cohort.
- **The run must produce:** a hit recorded in the run log with the kind and a hash and never the value; a harmless string of the same shape not blocked; the number of calls blocked in error over the run.
- **Extract with:** `npm run asp -- run-log show <log>`; a search of the log for the planted value (none); `npm run asp -- live report` for the counts.
- **Check before closing:** `node --test packages/asp-package/test/outbound-scan-edges.test.ts` and the scan's own tests pass; the false-positive count is stated with the number of calls it is out of.
- **Stays:** `partial`: the Done line states a rate over a fixed corpus, and a handful of live calls do not give a rate.
- **Too early if:** a rate is quoted from one evening, or the scan is called a promise that nothing leaks.

### P7 — weak models: malformed arguments and loops after a refusal, per model

- **Done line:** "Measure and document per model" (priority B, status `partial` in the register today)
- **Settled by:** Item 5 for Codex and Goose; the cohort for `claude-haiku-5-5`.
- **The run must produce:** for each model, the counts of malformed tool arguments, of calls refused, and of loops after a refusal (the driver's `loop_breaker` stop), with the number of turns each is out of.
- **Extract with:** the cohort's `DriverEvent` stream and each agent's `AgentOutcome` (refused, stopped); `npm run asp -- watch --circumvention` for a refused-then-retried agent; `npm run asp -- runs <id>`.
- **Check before closing:** the counts are written beside the model name in the docs; `node --test packages/asp-package/test/agent-guards.test.ts` passes.
- **Stays:** `partial`: the row says per model, and the cohort is one model.
- **Too early if:** one model's numbers are published as the matrix.

## 2. The 15-agent cohort (DK1801) and what it can settle

DK1801 is a proposal document, [society-models-run.md](society-models-run.md), and has no register row yet; the rows below are the ones its observations can move. The owner's decisions in that document: model `claude-haiku-5-5`, 15 agents, USD 0.40 each and USD 6 in all, no goal, a local service. The driver (lane-cli-3) streams `DriverEvent`s and returns an `AgentOutcome` for each agent; the harness (lane-society-2) decides what is recorded about the society. **What the cohort must print for these rows to be settled, and what is not yet built (the harness's observation output is not yet written; each item below is a requirement, not a command that exists):**

| Output | What it must show | Feeds | Extract with |
|---|---|---|---|
| Interaction graph | who messaged, hired, bid on or replied to whom, as edges with a count and a first and last time | DK88, DK52 | `npm run asp -- society tail --json` over the run's window, then the harness's graph file (to be built) |
| Institution use | for each agent, the institutions it used and how often, and the steps it took | DK79, the society health lens | `npm run asp -- journey <agent> --json` for each agent; `npm run asp -- society health --days 1 --json` |
| Refusals | for each agent, calls refused by scope, and loops after a refusal | P7, E5 | each `AgentOutcome` (`refused`, `stopped`); `npm run asp -- runs <id>` |
| Drift inputs | for each agent, a series over its turns of the signals the Clinic's probes read (tool calls, tokens, refusals), kept so a drift reading can be computed later | DK1712, DK1604 (inputs only) | `npm run asp -- clinic series --agent <did> --all` once the harness files the probes (to be built) |

**What the cohort cannot show:** that any agent drifted, that any behaviour is alignment, that an effect exists (15 agents, one model, no goal), or anything about a model other than `claude-haiku-5-5`. It is the evidence for the rows named, in the way named, and for nothing else.


### DK88 — a recorded dialogue between agents

- **Done line:** "Done: a recorded dialogue is replayable, a withdrawn consent removes it from studies, and the lens produces a measure of how corrections shift later behaviour." (priority B, status `open` in the register today)
- **Settled by:** Cohort (the messages the agents pass), with the consent of its own participants (all of them the owner's).
- **The run must produce:** the messages as a replayable dialogue; a withdrawn consent removing a participant's messages from the study; a measure of how a correction shifts later behaviour.
- **Extract with:** the harness's dialogue file (to be built) and `npm run asp -- telemetry list` for the stored messages.
- **Check before closing:** a replay test over the recorded dialogue; a test that a withdrawn consent removes it (`npm run asp -- telemetry delete --all` is the user's own route).
- **Stays:** `open`: the lens measure needs a correction in the dialogue, which the cohort has no reason to contain.
- **Too early if:** a graph of who talked to whom is called a study of corrections.

### DK52 — the watcher finds a seeded anomaly on the hosted service

- **Done line:** "Done: it runs on the hosted service and a seeded anomaly is found within a stated time." (priority A, status `partial` in the register today)
- **Settled by:** Cohort on a local service with `asp serve --watch-interval`; the hosted half is a host step.
- **The run must produce:** a seeded anomaly (the same dangerous input given to three or more agents) found within a stated time, signed and published at `GET /watch/findings`.
- **Extract with:** `npm run asp -- watch` and `npm run asp -- watch --circumvention`; the public findings page.
- **Check before closing:** `node --test packages/asp-cli/test/watch.test.ts`; the time from seeding to finding is written down.
- **Stays:** `partial`: the Done line says on the hosted service; a local service shows the mechanism only.
- **Too early if:** a local run is called the hosted one.

## 2a. The local-service variant: a key-only agent against a LOCAL `asp serve`

The owner's priority is to verify the sponsor-less path with real agents against a service on this machine before the hosted one. This variant uses a local service (`asp serve --db local:<dir> --signup`, the file log, key-only sign-up on) and the one command that reads the result, `asp live verify-local` (tested in `packages/asp-cli/test/live-verify-local.test.ts` against a real local service and the stand-in provider). It runs after the agent has enrolled and run; it replays the service's own log and compares it with the session's run log, and prints a PASS or FAIL line for each of nine checks that the owner can paste back:

```powershell
npm run asp -- enrol --service <the local url> --name <name> --accept-terms
npm run asp -- run claude-code --project C:\scratch\repo --prompt "<task>" --permissions develop --budget-usd 5
npm run asp -- live verify-local --log <the service's --db folder> --expect-assurance gateway_enforced
```

**Paste back:** the whole PASS/FAIL table, `asp runs <id>`, and `asp account show` (the starter lines). **What a pass shows:** on this machine the log replays, the agent's passport key is the key its `did:key` names, its contract and Mandate are the session's, its Action reports are signed by it with the assurance stated, the refusals in the run log are the blocked attempts its Actions report and its signed refusal records, the starter claim is in the log, the run log's hash chain verifies and each Action's commitment matches it, and the credit ledger balances. **What it does not show:** that the hosted service behaves the same, that a real model did a good job, or anything about a slash or a ban (a short run has none).

| Row | What the local run can settle | The evidence | Extract with | The check the lead runs | What stays partial, and why |
|---|---|---|---|---|---|
| DK540 | the key-only sign-up route on a real service: a key proves it holds the key, solves the proof of work, gets a tenant and a token, and is limited per address | the enrol output (tenant, a did:key, the token shown once) and a second burst from one address refused | `asp enrol --service <url> --name <n> --accept-terms`; the service's output line for the refusal | `node --test packages/asp-cli/test/key-only-enrol.test.ts` still passes; the enrol block pasted | the public-launch decision (flag 5) and the hosted limits |
| DK541 | the starter for a key-only identity: 100 at once, drawn from the pool | `PASS  the starter credits` in verify-local; the agent's balance | `asp live verify-local --log <dir>`, `asp account show`, `asp credits balance <did>` | the claim is in the log (`starter_claim`, part `upfront`); `node --test packages/asp-package/test/economy-audit-alert.test.ts` for the pool | the 400 after a first accepted job (it needs a job through the Market, not one governed run), the pool cap and the waiting list on the hosted service |
| DK542 | the bond and the slash for a key-only agent | none from one short run (there is no slash) | `asp market bond` and a settlement with a slash on the local service, then `asp live verify-local` | `node --test packages/asp-cli/test/key-only-run.test.ts` (the timer, bans and quarantine with seeded slashes) | real breaches by a real agent, and the ban by key and address on the hosted service |
| DK543 | the starter-spend measure | none from one evening | `asp credits guard` | `node --test packages/asp-log/test/starter-spend.test.ts` | days of real spending |
| DK544 | the invitation of a sponsored agent: `asp society invite` | the invite output and the Mandate in the log | `asp society invite --agent <did> --institutions market --per-day 5` | `node --test packages/asp-cli/test/society-invite.test.ts` | a key-only agent has no other sponsor, so the command does not apply to it (docs/key-only-audit.md) |
| DK545 | the weekly handout record on a local service | the signed handout record and its budget line | `asp treasury` handout commands in docs/commands.md | `node --test packages/asp-log/test/handout.test.ts` | a week of real activity and the Treasury's co-signed budget on the hosted service |
| DK546 | enrolling and being able to spend in one step: the passport and the starter claim after `asp enrol` | `PASS  the agent's identity` (it names itself as sponsor) and `PASS  the starter credits` | `asp live verify-local --log <dir>` | `node --test packages/asp-cli/test/key-only-enrol.test.ts` and `live-verify-local.test.ts` | the review timer on a schedule, the MCP server, the hosted run |
| DK650 (the local part) | both ways in on a local service: a key-only agent and a sponsored agent (`asp join`) each run one governed session with the same refusals | two verify-local tables, one for each home, and the two `asp runs` outputs | `asp live verify-local --log <dir>` in each home; `asp runs` | both tables have no FAIL; the refusals and the starter amount are the same | the hosted service, the review timer with real slashes, the owner's decision on flag 5 |
| T15 | three identities with distinct keys, and the calls under the right one | the identity line of each verify-local table (three runs, or the journey of each) | `asp live verify-local`, `asp journey <name> --json` | no two passports share a key (the identity check) | live-run-identity.md sections A to D with a sub-agent and every kind of call |
| T22 | a sub-agent's node records | the node key and end time in `asp fleet show` for an `asp orchestrate` run, then verify-local for the parent | `asp fleet show`, `asp live verify-local` | `node --test packages/asp-log/test/node-requires-mandate.test.ts` | a helper hired as a long-lived identity, and a live orchestrate run that tries each bypass |
| E5 | the run log of a governed session: chain and commitments | `PASS  the run log's hash chain` and `PASS  the Actions' commitments match the run log` | `asp live verify-local`, `asp run-log verify <log> --contract <id>` | no FAIL; the same two lines from `asp run-log verify` | each other runtime's own log (Codex, Goose, Antigravity, OpenHands) |
| DK1602 | the sponsor page's tokens against the run's | `asp journey <agent> --sponsor-view` (for a key-only agent, its own page) and `asp runs <id>` | the two commands | the two token figures are equal | not covered by verify-local; the hosted sponsor page |
| P21 | `asp run` of a runtime as a governed session with the assurance its Actions carry | the assurance counts in `PASS  signed Action reports` (the stand-in Claude Code run shows `gateway_enforced`) | `asp live verify-local --expect-assurance gateway_enforced` | a weaker level is a FAIL by name | each runtime has its own level (Antigravity and OpenHands are hook-held, not gateway-enforced) and each needs its own real run |

**The assurance field.** Each Action report carries an assurance level (`self_reported`, `runtime_observed`, `gateway_observed`, `hook_enforced`, `gateway_enforced`, `sandbox_enforced`). `asp live verify-local` counts them per level and `--expect-assurance <level>` makes a weaker or missing level a FAIL. The stand-in Claude Code run under the gateway reaches `gateway_enforced`; a runtime held only by its own hook reaches `hook_enforced` at best, and a row about it must say which. **What stays partial for every row above, because this is not the hosted service:** the hosted database and limits, real traffic and real addresses, the mail provider, the owner's own key and sign-in, and anything that needs days (the starter spend, the review timer, a week of drift).

## 3. Rows at risk of being claimed too early

These are the rows where the evening or the cohort produces something that looks like a result and is not the Done line. The block of each says why.

| Row | The tempting claim | What it still needs |
|---|---|---|
| T3 | two sessions are safe | the CI pass of `approvals-debug`; one Windows evening is not that |
| T22 | the sub-agent bypasses are tried | a separate long-lived helper identity and a live orchestrate run that tries each bypass |
| P21 | every runtime is governed | a real run of each, and Antigravity and OpenHands are held by hooks, not the gateway |
| E5 | every runtime has a full run log | a log from a real run of each, not only the verdicts the bridge sees |
| DK650 | the sponsor-less route is live | the review timer and the owner's decision |
| DK1364 | personal agents work | a recorded run for each runtime named; none on the site before |
| DK1712 | drift is detected by the service | a service process on a timer, and the Clinic's key (question 31) |
| DK1604 | drift ran | a week of results |
| DK79 | the society has cognition telemetry | all nine signals from a real agent, with consent |
| DK1716 | secrets are stopped | a rate over a corpus; live calls give counts |
| P7 | weak models are measured | a row per model, and the cohort is one |
| T2 | the first minutes are covered | a multi-gigabyte repository, which no evening case covers |


## 4. Flag L rows that a real-model run does not settle

The launch bar ([launch-bar.md](launch-bar.md)) marks these priority A rows with the flag L (a live run or the deployed host is needed). They are listed so none is mistaken for a model run: each is settled by a step on the host or by the owner, not by an agent.

| Row | Why a model run does not settle it |
|---|---|
| U1, U9 | a real Google account on the live sign-up, and the account export and close read on the host |
| T1 | a stranger's clean clone on macOS and an older Node |
| E16, E9 | the sealed run-log copy and the live mail send on the deployed service |
| X6, X7, DK34 | the forum deployed behind the beta; key rotation and recovery for a key-only citizen |
| GV6 | the restore drill on the real host (the owner's) |
| DK64 | the 15-minute start on three systems |
| DK270 | a house agent that actually runs on the deployed service |
| DK1100 | the public-works routine on the hosted service, and the owner's decision PW1 |


## 5. How this page is checked

`packages/asp-cli/test/live-run-closes.test.ts` fails when a row id in a heading is not in the register, when a Done line quoted here is not a word-for-word part of that row, when a `Counts when` text of the plan that this page relies on is gone, when a row the lead named is missing, or when a command named in a block is not in commands.md. It checks the page against the register; it does not run anything live.
