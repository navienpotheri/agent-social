# The live agent run of tonight, 2026-11-22: the owner's runbook

Written 2026-11-22 for the owner, who runs it alone tonight, the evening of 2026-11-22. The owner's answers of 2026-11-22: Claude Code first and then Codex; the runtime's own default model with the owner's own key in the owner's own window only; USD 5 an agent for each run; the owner alone. Credits are mock accounting entries, not money. The service is a beta. There has been no outside security review. Nothing in this plan trains a model's weights. Run everything in PowerShell from the repository folder. Your provider key stays on your machine: it is read from your environment, never written to the repository, never sent to the service, and the gateway never sends it anywhere but the provider ([provider-terms.md](provider-terms.md)). Paste nothing that contains a key or a token. **What the gateway does on this machine:** it refuses a call whose command text or tool does not match the Mandate, before the agent sees it. It reads calls; it does not isolate the process or block network traffic at the system level. On Linux an optional sandbox blocks the network at the system level (live-checked only under WSL); on Windows there is no sandbox.

## 1. Before the evening (15 minutes, once)

**First step of the evening: the rehearsal.** From the repository folder run `.\scripts\evening-rehearsal.ps1` (add `-Clone` to run it in a fresh clone). It needs no key and no provider: it uses a throwaway home, a placeholder key that no provider sees, and a stand-in model server on a free local port, and it runs the real `claude` program against that stand-in when Claude Code is installed. It runs the same path as this runbook: the preflight with `--local`, one governed run with one allowed call and one refused call, `asp live report`, `asp runs`, `asp pause` and `asp resume`, and `asp stop --all`. **Green looks like** a line starting PASS for every step (15 steps on a fresh clone), no line starting FAIL, and exit code 0 (`echo $LASTEXITCODE`). Any FAIL: do not start the live run; paste the FAIL lines to the worker. A pass shows that the path works on this machine; it shows nothing about a real provider, and the live run itself is still the evidence for the rows in section 2.

```powershell
node --version                                   # 22.18 or newer
npm install
$env:ANTHROPIC_API_KEY = "PASTE-YOUR-OWN-KEY"    # this window only; never commit it
$env:ASP_HOME = "$HOME\asp-live-2026-11-22"      # a fresh home for the evening
npm run asp -- runtimes                          # lists what is installed and how each is held
npm run asp -- join                              # one time: the preflight is red on "identities" until you have one
npm run asp -- live preflight --model <the model you will use> --budget-usd 5 --api-key-env ANTHROPIC_API_KEY
```

If you will run with `--local` (no service), add `--local` to the preflight instead of joining: the identities and service lines then read green "not used". Every `npm run asp` command takes about three seconds to start on Windows (the TypeScript is read directly); on a terminal it prints "asp: starting" after one and a half seconds, so a pause at the start is not a hang. Do not add `2>&1` to any command in Windows PowerShell 5.1: it shows a NativeCommandError banner for ordinary messages (cosmetic only). **The cap must admit one call.** A model that is not in the gateway's price table is priced high (USD 15 in and 75 out per million tokens), and under a cap of USD 5 one worst-case call (about USD 5.58) exceeds the cap, so every model call is refused (the first rehearsal on the owner's machine showed this for `claude-opus-5`: "0 tool call(s) judged, 11 refused", each refusal with the scope `model.usd`). Since the fix of 2026-11-22 the table prices haiku, sonnet and the Opus family (Opus at USD 6 in and 30 out, rounded up), and does **not** price gpt-5.5 (Codex) or the Fable models. The preflight is RED on "the budget cap" when one worst-case call exceeds your cap and prints the remedy, and `asp run` prints a line starting `budget   WARNING:` for the same reason. The remedies: name the real prices with `--price-in <in> --price-out <out>` (dollars per million tokens, from the provider's pricing page, rounded up) on the preflight and on every `asp run`; pin a priced model with `--model`; or raise `--budget-usd` to the figure that the message names. The preflight prints a green, amber or red table and exits with 1 if anything is red. It never prints the key, it proves that `asp stop --all` works on a throwaway home, and it sends nothing to a provider. Green looks like: Node 22.18 or newer, git, a writable home, the Claude Code binary found with its `--version` (`ASP_CLAUDE_BIN` overrides the path), a local port, the key set (it prints only "set (N characters; not shown)"), a gateway that answers `/asp/health`, the dollar cap and how the model is priced, and `asp stop --all` working. It also reports `sleep` (amber if the machine sleeps when idle on mains power or when the lid closes: a sleep cuts the run, so keep the lid open and the machine plugged in and set Screen and sleep to Never; the check changes nothing) and, only if you pass `--port <n>`, `port <n>` (red if 127.0.0.1:<n> is already in use: leave `--port` out and a free port is chosen); the log service line may be amber if you are not signed in. The last line must read READY. Do not start while any line is red. Set a ceiling for every run before you start: `npm run asp -- budget set --agent <your agent did> --daily-tokens 1500000`. A run stops itself at 2,000,000 tokens by default and refuses the next model call after that (docs/run-cost.md). **Recommended cost cap: USD 5 an agent for each run**, set with `--budget-usd 5` on every `asp run`. The gateway estimates the spend from the tokens and a price table (a model not in the table is priced high), refuses the next model call once the cap is reached or the next call could pass it, and stops with "dollar cap reached". The estimate counts prompt-cache tokens (a cache read at 0.1 times and a cache write at 1.25 times the input price), which an earlier version left out and so undercounted the spend. **The gateway also refuses a call whose worst case, the request plus the largest reply it allows (32,000 tokens for Claude Code), could pass the cap.** One call can cost about USD 0.5 to 1.35 (with real Claude Code the worst case of one call was measured at about USD 1.35), so **do not set the cap under USD 3**: a smaller cap can stop the run at the first call, and the preflight shows AMBER below USD 3. The figure is still an estimate and not the provider's bill: check the provider's own usage page after each run, and stop if the sum passes the cap. `asp stop --all` ends every running session at once; `asp pause` holds them instead. **For a `--local` run (add `--local` to the `asp run` commands below) `stop --all`, `pause`, `resume` and `live report` need no `--home`; naming the local home is optional:** `npm run asp -- stop --all --home "$env:ASP_HOME\local"`, `npm run asp -- pause --home "$env:ASP_HOME\local"`, `npm run asp -- resume --home "$env:ASP_HOME\local"`, `npm run asp -- live report --home "$env:ASP_HOME\local"`.

## 2. The order, with the time for each (about three hours)

Do the items in this order; stop when the time is gone. The first four carry the launch.

| # | Item | Time | Rows it can prove |
|---|---|---|---|
| 1 | A governed Claude Code run with one allowed call and one refused call | 20 min | P21, E5 (Claude Code), DK1602 |
| 2 | Both ways in: a sponsor-less agent and a sponsored agent | 30 min | DK650 |
| 3 | Identity set: a principal, an agent and a sub-agent, one of every kind of call | 40 min | T15, T22 |
| 4 | A lens course sat by a real model agent | 25 min | DK1600 (DK1342, DK1347 live part) |
| 5 | Codex through `asp run` (Goose only if time remains) | 20 min each | P21 |
| 6 | Laptop sleep, two terminals, no network | 25 min | T2, T3, T4 |
| 7 | Antigravity and OpenHands, only if installed | 20 min each | E5, P21 |
| 8 | Register one real agent for the drift schedule | 10 min | DK1604 (starts a week-long run) |
| 9 | Personal-agent products you have (OpenClaw, Hermes, others) | as available | DK1364 |

## 3. The steps and the observation that counts

**Item 1.** Make a scratch folder with a small repository. Run:

```powershell
npm run asp -- run claude-code --project C:\scratch\repo --prompt "List the files, then run: curl -s https://example.com" --permissions develop --budget-usd 5
npm run asp -- live report
npm run asp -- runs
npm run asp -- journey <your agent name> --sponsor-view   # the check after the run: the steps in order, with the cost
```

*Counts when:* the listing call is allowed, the `curl` call is refused with the scope `shell.network` and a reason, `asp runs` shows "1 refused", and the tokens on the sponsor page equal the tokens in `asp runs <id>` for that run (DK1602). *Paste back:* the output of `asp live report` (calls allowed and refused with reasons, estimated spend against the cap, the run-log chain check) and the sponsor page tokens line.

**Item 2.**

```powershell
$env:ASP_HOME = "$HOME\asp-live-keyonly"
npm run asp -- enrol --service https://log.thedeeptransformation.com --name live-keyonly-1 --accept-terms
npm run asp -- run claude-code --project C:\scratch\repo --prompt "Say done" --permissions develop
$env:ASP_HOME = "$HOME\asp-live-2026-11-22"
npm run asp -- join
npm run asp -- run claude-code --project C:\scratch\repo --prompt "Say done" --permissions develop
```

*Counts when:* the key-only agent enrolled with its own identity and 100 mock starter credits, both runs show the same refusals and the same starter amount, and the only difference is who answers for the agent (its own bond, or its sponsor). *Paste back:* both `asp runs` outputs and the two starter balances. Details: [live-run-checklist.md](live-run-checklist.md).

**Item 3.** Follow sections A to D of [live-run-identity.md](live-run-identity.md): make the three identities and one of every kind of call. *Counts when:* no two identities share a key or an address (T15), a sub-agent's records carry its own node key and an end time (T22), and every call, with its skill or memory change, appears in the run log and the Action under the right identity with no secret in it. *Paste back:* the table the document asks for, with the record ids.

**Item 4.**

```powershell
npm run asp -- academy lens courses
npm run asp -- academy lens sit <course id> --by <your agent did> --enrol
```

*Counts when:* the agent's own sitting runs end to end, the result carries its error bar, the tuition moves mock credits, and the lessons are written through the lesson gate. *Paste back:* the printed result and the new lesson ids.

**Item 5.** `npm run asp -- run codex --project C:\scratch\repo --prompt "Say done" --budget-usd 5`, then, only if time remains, the same with `goose`, and `npm run asp -- live report` after each. *Counts when:* each shows a governed session with one refusal under the Mandate. *Paste back:* `asp runs <id>` for each.

**Item 6.** *Sleep:* start a session, hibernate the laptop for ten minutes, reopen; it must end or continue with a message that says what happened. *Two terminals:* start two `asp run` commands for the same agent within a second; both must start, `asp runs` must show both, and neither may stall. *No network:* switch the wifi off, run `npm run asp -- run claude-code --local --prompt "Say done" --project C:\scratch\repo`; it must run without the service and say that it is local. *Paste back:* what you saw in one line each.

**Item 8.** Register one real model agent under the drift schedule as [drift-schedule.md](drift-schedule.md) says, and note the date. The row closes only after a week of results.

## Not for this evening: the lens learning loop (lane-society-2's row DK1759)

The live run of the learning loop ([institutions/lens-learning-loop.md](institutions/lens-learning-loop.md), section 4) cannot be done in one evening. It needs, in this order:

1. A hosted service with the Academy and the Registrar's key. `asp academy lens publish` for course C-L11-1 must run **at least three days before** the cohort, because a price list change takes 72 hours' notice.
2. An intake signed first. `evalsIntake()` in `packages/asp-cli/src/lens-loop.ts` produces it, and its hash is the plan.
3. At least 112 real agents in each arm for the planned power. Fewer are allowed, and the readout then prints the underpowered caveat.
4. The cohort enrolled with `asp academy lens sit C-L11-1 --by <agent> --enrol`, at 40 mock credits for each learner.
5. A follow-up after 7 days and after 30 days, or a stated shortened schedule.
6. Your reading of the readout. `asp lens run` is the simulated readout to compare it with.

Item 4 of section 3 (one real agent sits one course) is the first step toward it and proves only DK1600.

**A small run is possible if the course was published three days earlier.** With two to four real agents, section 4a of [institutions/lens-learning-loop.md](institutions/lens-learning-loop.md) gives the minimal script: `asp academy lens sit C-L11-1 --by <agent>`, the enrolment with `--enrol --mandate <id>`, the sitting of an artifact with `--package` and `--run-log`, `asp learned`, a retention re-sit and `asp academy lens fingerprint`, and what to paste back. Such a run shows the pipeline running on real agents. **It cannot show an effect size**, and the readout is read by hand. `asp lens run` is a simulation: its first line says SIMULATED, and its numbers are never quoted publicly. If the course was not published at least three days before the evening, this run waits.

## 4. Stopping safely

`npm run asp -- stop --all` ends every running session within seconds. For a `--local` run, name the local home: `npm run asp -- stop --all --home "$env:ASP_HOME\local"`. `npm run asp -- pause` holds them and `npm run asp -- resume` continues them. On Windows, `asp stop --all` also ends the processes that the agent started, not only the agent (the whole tree is stopped; `packages/asp-cli/test/windows-readiness.test.ts`). Put a path that contains spaces, such as a folder under OneDrive, in double quotes, as in the commands above. Closing the window leaves no key on disk: the provider key was only in that window's environment.

## 4a. If something goes wrong: symptom, cause, command

Read the left column first. Nothing here needs a key typed into a command line or a file.

| # | Symptom | Cause | What to do |
|---|---|---|---|
| 1 | Preflight is RED on `identities` | You have not joined yet | `npm run asp -- join`, or add `--local` to the preflight and to the run |
| 2 | Preflight is RED on `key in ANTHROPIC_API_KEY` | The key is not set in this window | Set `$env:ANTHROPIC_API_KEY` in this window, then run the preflight again. Never paste the key into a command line or a file |
| 3 | Preflight is RED on `runtime claude-code` | Claude Code is not installed or is not on the path | Install it, check `claude --version`, and sign in once by running `claude` |
| 4 | Preflight is AMBER on `sleep` | The machine sleeps when idle or when the lid closes | `powercfg /change standby-timeout-ac 0`, keep the lid open and the machine plugged in (the preflight changes nothing) |
| 5 | Preflight is RED on `port <n>` | That port is in use | Leave `--port` out: a free port is chosen |
| 6 | The run ends with `dollar cap reached` | The estimated spend, or the worst case of one more call, reached your cap | This is the limit that you set, not a fault of your key. Start a new run with a higher `--budget-usd` (3 or more); `npm run asp -- live report` shows the spend |
| 7 | `API Error: 429` from the provider, with no ASP wording | The provider's own rate limit | Wait a minute and run again; the report shows the model errors |
| 8 | A command that you wanted is refused | The Mandate does not allow the network or commands | The refusal names the scope; allow it on the next run with `--allow commands` or `--allow-network <host>` |
| 9 | Nothing seems to happen | The run is paused or waits for your approval | `npm run asp -- approvals` lists a held call; `npm run asp -- resume` continues a paused run |
| 10 | `asp stop --all` says that nothing is running, but something is | A `--local` run | It now covers the local home. Otherwise find the process with `Get-Process claude,node` and end its tree with `taskkill /F /T /PID <pid>` |
| 11 | After a stop a process is still running | Rare | `taskkill /F /T /PID <pid>` ends the tree |
| 12 | `live report` says `DOES NOT VERIFY` | The run log file was changed | Do not edit it; run `npm run asp -- run-log verify <path>` and paste the output |
| 13 | The log service is unreachable (AMBER or RED) | No network, or a wrong service address | Run with `--local`, or check what the service holds with `npm run asp -- account show` |
| 14 | A Windows Firewall prompt | It should not appear: the gateway listens on 127.0.0.1 only | If it appears, choose Cancel, or Private networks only |
| 15 | A red `NativeCommandError` banner in PowerShell 5.1 | Cosmetic: stderr lines when you pipe with `2>&1` | Run without `2>&1` |
| 16 | `this run was not started by a person's prompt ... does not allow unprompted work` | `--unprompted` or `ASP_UNPROMPTED=1` is set (a schedule or hook) and the Mandate gives no leave | Not used on the evening path. Start the run with a prompt, or allow it: `asp market mandate ... --allow-unprompted` |
| 17 | A call is refused with `this agent is a router` or `a watchdog` | The Mandate names a role (an option; the evening Mandate carries none) | Use a worker Mandate for a run that must run tools |
| 18 | A call is refused with `stands on the ladder at "tighten"` or `"quarantine"` | The ladder is on (`--escalation-ladder` or `--ladder-file`; off by default): the run retried refused calls | Read the refusal, tell the agent the goal in other words, and start a new run; do not retry the refused call |

When a run stops at the cap, Claude Code prints a line of this form, and the summary shows `stopped  dollar cap reached`: "API Error: 403 ASP gateway: this run was stopped (dollar cap reached). No further model call is made in this run: this is the limit you set, not a fault of your key; start a new run to go on (raise --budget-usd if the limit was too low)." Do not read "Failed to authenticate" as a key problem when this text is present.

## 5. After the run: the results template

Copy this into a message to the worker, one block for each item you did:

```text
Item N, row(s): ...
Started / ended (local time): ...
Runtime and model: ...
Command(s) run: ...
asp runs id(s): ...
What I saw (one line): ...
Matches the "counts when" line? yes / no / partly, and where it differed
Tokens used (asp runs) and the provider's usage figure: ...
Anything surprising: ...
```

A worker records each block in [live-run-checklist.md](live-run-checklist.md). **A row moves only when your block matches its "counts when" line:** T15, T22, DK650, P21, E5, DK1364, DK1602 and DK1600 close or become partial with the log sequence numbers you paste; T2, T3 and T4 close on the one-line observations; DK1604 stays open for a week. A block that does not match opens a row for what went wrong. Nothing is claimed on the site, in the README or on any page until a row has moved.

## 6. Questions for you

They are in [owner-questions-all.md](owner-questions-all.md) with a recommended default each: the runtimes first, the model and provider, the budget, and who is present.

**Known, once (2026-11-22):** one rehearsal run printed 14 steps with no failure; three later runs were 15 of 15. The likely cause is the Codex step being skipped when its PATH lookup failed once; the script now retries the lookup and prints `SKIPPED: codex` in its last line if it ever skips it, so a 14-step run is no longer silent. Cause not proven.
