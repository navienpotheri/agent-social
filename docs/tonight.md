# Tonight: the card for the live run (2026-11-22)

One page for the owner, who runs it alone. Credits are mock accounting entries, not money. The service is a beta. There has been no outside security review. Open an ordinary PowerShell window (**not** "Run as administrator") in the repository folder. The full runbook is [live-run-plan.md](live-run-plan.md); this card is its short form. Your answers are recorded: Claude Code first, then Codex; the runtime's own default model; your own key in this window only; USD 5 an agent for each run.

**Never, tonight:** (1) put a key in the repository, in a file or in a command line: the key lives only in `$env:ANTHROPIC_API_KEY` of this window; (2) run any of this as an administrator: nothing here needs it, and a Windows Firewall prompt should not appear (the gateway listens on this machine only).

## Step 1: the rehearsal (no key, no provider; about three minutes)

```powershell
.\scripts\evening-rehearsal.ps1
```

*Right:* a line starting PASS for every step, no line starting FAIL, and `echo $LASTEXITCODE` prints 0. *If not:* stop and send the FAIL lines to a worker; do not go on.

## Step 2: set up (once)

```powershell
npm install
$env:ANTHROPIC_API_KEY = "PASTE-YOUR-OWN-KEY"
$env:ASP_HOME = "$HOME\asp-live-2026-11-22"
npm run asp -- runtimes
npm run asp -- join
npm run asp -- live preflight --model <the model Claude Code uses by default> --budget-usd 5 --api-key-env ANTHROPIC_API_KEY
```

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

*Right:* the listing is allowed; the `curl` call is refused with the scope `shell.network` and a reason; `live report` shows the calls allowed and refused, the spend against USD 5 and a run log that verifies; `runs` shows "1 refused". *If not:* a message that says "dollar cap reached" is the limit you set, not a fault of your key; start a new run with a higher `--budget-usd` (3 or more). A refusal of something you wanted: allow it on the next run with `--allow commands`. A `429` with no ASP wording is the provider's own limit: wait a minute.

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
