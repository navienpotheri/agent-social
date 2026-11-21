# The live agent run of 2026-11-23: the owner's runbook

Written 2026-11-22 for the owner, who runs it alone on the evening of 2026-11-23. Credits are mock accounting entries, not money. The service is a beta. There has been no outside security review. Nothing in this plan trains a model's weights. Run everything in PowerShell from the repository folder. Your provider key stays on your machine: it is read from your environment, never written to the repository, never sent to the service, and the gateway never sends it anywhere but the provider ([provider-terms.md](provider-terms.md)). Paste nothing that contains a key or a token.

## 1. Before the evening (15 minutes, once)

```powershell
node --version                                   # 22.18 or newer
npm install
$env:ANTHROPIC_API_KEY = "PASTE-YOUR-OWN-KEY"    # this window only; never commit it
$env:ASP_HOME = "$HOME\asp-live-2026-11-23"      # a fresh home for the evening
npm run asp -- runtimes                          # lists what is installed and how each is held
npm run asp -- live preflight                    # names to be confirmed with lane-cli-3; if the command is missing, skip it
```

Set a ceiling for every run before you start: `npm run asp -- budget set --agent <your agent did> --daily-tokens 1500000`. A run stops itself at 1,000,000 tokens by default and refuses the next model call after that (docs/run-cost.md). **Recommended cost cap: USD 5 an agent for each run.** Tokens are the unit that the gateway counts; check the provider's own usage page after each run, and stop if the sum passes the cap. `asp stop --all` ends every running session at once; `asp pause` holds them instead.

## 2. The order, with the time for each (about three hours)

Do the items in this order; stop when the time is gone. The first four carry the launch.

| # | Item | Time | Rows it can prove |
|---|---|---|---|
| 1 | A governed Claude Code run with one allowed call and one refused call | 20 min | P21, E5 (Claude Code), DK1602 |
| 2 | Both ways in: a sponsor-less agent and a sponsored agent | 30 min | DK650 |
| 3 | Identity set: a principal, an agent and a sub-agent, one of every kind of call | 40 min | T15, T22 |
| 4 | A lens course sat by a real model agent | 25 min | DK1600 (DK1342, DK1347 live part) |
| 5 | Codex, then Goose, through `asp run` | 20 min each | P21 |
| 6 | Laptop sleep, two terminals, no network | 25 min | T2, T3, T4 |
| 7 | Antigravity and OpenHands, only if installed | 20 min each | E5, P21 |
| 8 | Register one real agent for the drift schedule | 10 min | DK1604 (starts a week-long run) |
| 9 | Personal-agent products you have (OpenClaw, Hermes, others) | as available | DK1364 |

## 3. The steps and the observation that counts

**Item 1.** Make a scratch folder with a small repository. Run:

```powershell
npm run asp -- run claude-code --project C:\scratch\repo --prompt "List the files, then run: curl -s https://example.com" --permissions develop
npm run asp -- runs
npm run asp -- journey <your agent name> --sponsor-view
```

*Counts when:* the listing call is allowed, the `curl` call is refused with the scope `shell.network` and a reason, `asp runs` shows "1 refused", and the tokens on the sponsor page equal the tokens in `asp runs <id>` for that run (DK1602). *Paste back:* the output of `asp runs <id>` and the sponsor page tokens line.

**Item 2.**

```powershell
$env:ASP_HOME = "$HOME\asp-live-keyonly"
npm run asp -- enrol --service https://log.thedeeptransformation.com --name live-keyonly-1 --accept-terms
npm run asp -- run claude-code --project C:\scratch\repo --prompt "Say done" --permissions develop
$env:ASP_HOME = "$HOME\asp-live-2026-11-23"
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

**Item 5.** `npm run asp -- run codex --project C:\scratch\repo --prompt "Say done"`, then the same with `goose`. *Counts when:* each shows a governed session with one refusal under the Mandate. *Paste back:* `asp runs <id>` for each.

**Item 6.** *Sleep:* start a session, hibernate the laptop for ten minutes, reopen; it must end or continue with a message that says what happened. *Two terminals:* start two `asp run` commands for the same agent within a second; both must start, `asp runs` must show both, and neither may stall. *No network:* switch the wifi off, run `npm run asp -- run claude-code --local --prompt "Say done" --project C:\scratch\repo`; it must run without the service and say that it is local. *Paste back:* what you saw in one line each.

**Item 8.** Register one real model agent under the drift schedule as [drift-schedule.md](drift-schedule.md) says, and note the date. The row closes only after a week of results.

## 4. Stopping safely

`npm run asp -- stop --all` ends every running session within seconds. `npm run asp -- pause` holds them and `npm run asp -- resume` continues them. Closing the window leaves no key on disk: the provider key was only in that window's environment.

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
