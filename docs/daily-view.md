# The day's view: what a person sees after a day of agents running

Status: design, 2026-10-13. Nothing here is built except what is marked "today". The numbers in the examples are real: they are the sessions of one fresh account (`navien-livetest`) during the live walkthrough on 2026-10-13, read from its session index.

## What a person wants to know at the end of a day

1. **What did my agents do?** Which agents ran, on what, and how it ended.
2. **What was stopped, and why?** Refusals, who refused (the Mandate or me), and whether any of it was something I need to allow.
3. **What did I answer?** Approvals asked, answered, ignored.
4. **What did it cost?** Tokens and time (and credits, when an agent works for someone else).
5. **Is anything wrong?** Failures, interrupted sessions, a record that never reached the log, a provider rate limit.
6. **Can I prove it?** That the record exists, is signed, and can be checked by someone else.

Most users will look at one screen once a day. So the first screen answers all six in about fifteen lines; the rest is one step deeper (`asp runs <id>`).

## What the data holds today

| Data | Where | What it gives |
|---|---|---|
| Session index (`runs.ndjson`) | on this machine | Per session: start time, end time, agent, runtime, task, Mandate scopes and hosts, state (ended, stopped, failed, interrupted), calls judged, refusals (scope and reason), tokens, exit code, run log path |
| Run log (`run-log.ndjson`, per session) | on this machine | Per call: time, tool, scope, allowed or refused, reason, gated or not, the command text (secrets masked); model requests and replies with token counts; provider errors; stop reasons |
| Signed Action reports and the standing job's chain | the log service | That the session was recorded, which scopes it used, blocked counts, assurance level |
| Approvals (Checkpoints and their resolutions) | the log service | When one was raised and who resolved it and how |
| `asp dashboard` | local page | Agents, jobs, approvals you can answer, alerts, credits and their check. Not a day's activity |
| End-of-job mail | built, not wired to a trigger | One job at a time |

## The tables

### A. Sessions today (the first screen)

```
Today, 2026-10-13: 10 sessions, 8 calls judged, 4 refused, 9,757 tokens
Ended 8 · stopped 1 · failed 1 · interrupted 0 · not recorded in the log 0

time   agent     task                                      state    calls  refused  tokens  secs
05:28  my-agent  list the files here and say what this …   ended    1      0        1,515   10
05:31  my-agent  run this command: curl -s https://exam…   ended    1      1        1,331   5
05:35  my-agent  run this command: curl -s https://exam…   ended    1      0        1,322   9
05:46  my-agent  run python calc.py and say what it pri…   ended    2      1        1,498   50
05:52  my-agent  run python sleeper.py                     stopped  1      1        1,340   15
05:58  helper    say hello                                 failed   0      0        0       188   ← provider rate limit (HTTP 429)
```

Today the first row of numbers can be computed; "not recorded in the log" and the reason for a failure come from the run log, which is not yet read for this.

### B. What the agents did, by scope

```
scope           allowed  refused  sessions
repo.read       5        0        4
shell.exec      2        1        3        (2 of the 3 asked you first)
shell.network   1        2        3        (allowed only in the job that named example.com)
repo.write      0        0        0
```

Needs: the run log's per-call scope. Today the scope label on a gated refusal was wrong before 2026-10-13 (a command with `2>/dev/null` read as a file write); the table is only as good as those labels.

### C. What was refused, and why (the one a person acts on)

```
time   agent     what was tried                         scope          reason                         fix
05:31  my-agent  curl -s https://example.com            shell.network  not in this job's Mandate      --allow-network example.com
05:34  my-agent  curl -s https://example.com            shell.network  not in this job's Mandate      --allow-network example.com
05:47  my-agent  echo "exit: $?"; find . -iname calc…   shell.exec     you answered no                (your choice)
05:52  my-agent  ls sleeper.py 2>&1; find . -iname …    shell.exec     you answered no (Ctrl-C)       (your choice)
```

The "fix" column is the point: a refusal that repeats is the signal to widen a Mandate on purpose, or to leave it. Repeated identical refusals are collapsed with a count.

### D. Approvals

```
asked 4 · you said yes 2 · you said no 2 · no answer 0 · remembered "always" 1
median time to answer: 9 s   slowest: 41 s
```

Needs: Checkpoint raised and resolution times from the log (the run log has the gate; the timing is in the chain).

### E. Cost and time

```
tokens: my-agent 8,744 · helper 1,013      time with an agent working: 4 min 29 s
model: claude-sonnet-5 (recorded from the provider's reply)
```

Needs: tokens (have), seconds (have), model name (in the run log), credits spent (only when work is done for someone; none yet in a plain session).

### F. Health and evidence

```
problems: 1 failed session (helper, 05:58: the model provider rate limited 9 times in 3 minutes)
recorded: 10 of 10 sessions have a signed Action report in the log
run logs: 10 kept on this machine, 0 sealed on the service (asp run-log keep)
```

Needs: a per-session "recorded or not" flag (today it is only a warning line in that session's summary), and the provider-error summary from the run log.

## Where it appears

| Place | Form | Status |
|---|---|---|
| Terminal: `asp today` (also `asp today --day 2026-10-12`) | Tables A, C, D and the one-line health of F; B, E on `--all` | Not built |
| `asp dashboard` | The same tables as a page, plus the existing agents, jobs, credits | Page exists, tables not built |
| End-of-day mail | A, C and F as text, to the verified address, only if something was refused or failed | Mail exists per job; no day trigger |
| For another person (a parent, a team lead, a court) | The same tables from the signed records only, with no local files | Design only |

## Decisions to make

1. **Day boundary:** the person's local day, or 24 hours back? (Recommend the local day, with `--since 24h` as well.)
2. **How much of a command to show:** the whole command with secrets masked (the run log already does this) or the first line only?
3. **Where the numbers come from when the machine and the service disagree** (a session that ran but whose report never arrived): show both, and say which is which.
4. **What an agent working for someone else adds:** credits earned and spent, bond held, a delivered result with its claims. A separate table (G), once those flows have been walked live.

## How it will be tested

- **Reconciliation:** every number in every table equals a count taken independently from the session index, the run logs and the service's records. A test builds a day of sessions (ended, stopped, failed, interrupted, refused by Mandate, refused by the person, an unsent record) and checks all six questions' answers.
- **The refusal labels:** a gated refusal carries the scope that was gated (checked since 2026-10-13).
- **Live:** read the owner's real day (this one) and check, line by line, that the table says what actually happened.
- **Plain language:** no scope name or state without a sentence a newcomer can read (the table headers carry plain words, scope names stay as the second column).
