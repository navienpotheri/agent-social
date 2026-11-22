# Tonight: the card for the live run (2026-11-22)

One page for the owner, who runs it alone. Credits are mock accounting entries, not money. The service is a beta. There has been no outside security review. **A fault that hit the first run on a default Windows PowerShell (DK1806):** if a command of this card stops with the message that `npm.ps1` cannot be loaded because running scripts is disabled, run `Set-ExecutionPolicy -Scope Process Bypass` once in that window. It changes nothing for the machine and ends with the window. Open an ordinary PowerShell window (**not** "Run as administrator") in the repository folder. The full runbook is [live-run-plan.md](live-run-plan.md); this card is its short form. Your answers are recorded: Claude Code first, then Codex; the runtime's own default model; your own key in this window only; USD 5 an agent for each run.

**Never, tonight:** (1) put a key in the repository, in a file or in a command line: the key lives only in `$env:ANTHROPIC_API_KEY` of this window; (2) run any of this as an administrator: nothing here needs it, and a Windows Firewall prompt should not appear (the gateway listens on this machine only).

## Step 1: the rehearsal (no key, no provider; about three minutes)

```powershell
.\scripts\evening-rehearsal.ps1
```

*Right:* a line starting PASS for every step (16 with Claude Code and Codex installed), no line starting FAIL, and `echo $LASTEXITCODE` prints 0. One PASS line is information for step 2: it names the model that your Claude Code uses by default and says whether the gateway knows its price. *If not:* stop and send the FAIL lines to a worker; do not go on.

## Step 2: set up (once)

```powershell
npm install
$env:ANTHROPIC_API_KEY = "PASTE-YOUR-OWN-KEY"
$env:ASP_HOME = "$HOME\asp-live-2026-11-22"
npm run asp -- runtimes
npm run asp -- join
npm run asp -- live preflight --model <the model named in the rehearsal's information line> --budget-usd 5 --api-key-env ANTHROPIC_API_KEY
```

**Check that your cap admits one call.** The gateway estimates the spend from a price table, and it refuses a model call whose worst case could pass the cap. A model that is not in the table is priced high (USD 15 in and 75 out per million tokens): one worst-case Claude Code call is then about USD 5.58, which is more than a cap of USD 5, so **every model call would be refused** (the first rehearsal on this machine showed it: "0 tool call(s) judged, 11 refused"). Since the fix of 2026-11-22: haiku, sonnet and the Opus family are in the table (the Opus family at USD 6 in and 30 out, rounded up from the list prices, so one worst-case call is about USD 2.2); gpt-5.5, which Codex uses, and the Fable models are **not**. The preflight now goes **RED** on the line "the budget cap" when one worst-case call exceeds your cap, and prints the remedy; `asp run` prints a line that starts `budget   WARNING:` when it starts with a cap that cannot admit a call. If you see either, do one of: (1) add the real prices of your model, in dollars per million tokens from the provider's own pricing page, rounded up, to the same command: `--price-in <in> --price-out <out>`; (2) pin a model that is in the table with `--model`; (3) raise `--budget-usd` to at least the figure that the message names. A price lower than the real one makes the cap understate the spend, so round up and check the provider's usage page after each run.

*Right:* every command takes about three seconds to start; `runtimes` lists Claude Code and Codex; `join` opens your browser and waits for you; the preflight ends with the line READY and no red line. *If not:* a red `identities` means that you have not joined (run `join`, or add `--local` to the preflight and to every run); a red key line means the key is not set in this window; a red `runtime` line means Claude Code is not installed or not signed in (run `claude --version`, then `claude` once); amber `sleep` means keep the lid open and the machine plugged in. The whole table of symptoms is section 4a of the runbook.

## Step 3: item 1, a governed Claude Code run (about 20 minutes)

Make a scratch repository first (ordinary commands, no key):

```powershell
New-Item -ItemType Directory -Force C:\scratch\repo | Out-Null
```

Then, from the repository folder:

```powershell
npm run asp -- run claude-code --project C:\scratch\repo --prompt "List the files, then run: curl -s https://example.com" --permissions develop --budget-usd 5
npm run asp -- live report
npm run asp -- runs
```

*Right:* the listing is allowed; the `curl` call is refused with the scope `shell.network` and a reason; `live report` shows the calls allowed and refused, the spend against USD 5 and a run log that verifies; `runs` shows "1 refused". *If not:* if every call is refused and the session shows only refusals of "model request" with the scope `model.usd`, the cap cannot admit a call (see step 2: the preflight is RED and `asp run` prints `budget   WARNING:`); a message that says "dollar cap reached" is the limit you set, not a fault of your key; start a new run with a higher `--budget-usd` (3 or more). A refusal of something you wanted: allow it on the next run with `--allow commands`. A `429` with no ASP wording is the provider's own limit: wait a minute.

## Step 4: item 5, Codex (about 20 minutes)

```powershell
npm run asp -- run codex --project C:\scratch\repo --prompt "Say done" --budget-usd 5
npm run asp -- live report
```

*Right:* a governed session with one refusal under the Mandate. Goose and the other items of the runbook only if time remains.

## To stop, to hold, to look at the cost

```powershell
npm run asp -- stop --all
npm run asp -- pause
npm run asp -- resume
npm run asp -- live report
```

`stop --all` ends every running session within seconds (and, on Windows, the processes that the agent started). `pause` holds the next call; `resume` lets it go on. `live report` shows the estimated spend against the cap of each run; the estimate is not the provider's bill, so also look at the provider's own usage page after each run, and stop if the total passes USD 5 an agent. For a `--local` run the same commands work without extra options.

## After the run

Paste the results template of section 5 of the runbook to a worker, one block for each item. A row moves only when your block matches its "counts when" line. Closing the window leaves no key on disk.
