# The cohort run: the card for the owner (model agents in a local society)

One page for the owner, who runs it alone. Credits are mock accounting entries, not money. The service is a beta. There has been no outside security review. Nothing a run shows is a claim about agents in general, and nothing in it says that any rule makes an agent more aligned. Open an ordinary PowerShell window (**not** "Run as administrator") in the repository folder. The long form is [society-models-run.md](society-models-run.md) (register row DK1801); this card is its short form, in the order of your decisions of 2026-11-22: the model `claude-haiku-5-5`, one agent, then three, then fifteen, USD 0.40 for each agent and USD 6 in all, no goal, a local society, your own key in this window only.

**Never:** (1) put a key in the repository, in a file or in a command line: the key lives only in `$env:ANTHROPIC_API_KEY` of this window, and the command reads it from there and from nowhere else; (2) run any of this as an administrator: nothing here needs it, and a Windows Firewall prompt should not appear, because the society is served on this machine only (`127.0.0.1`); (3) point the command at any provider address of your own, or at a hosted service: there is no hosted run, `--local` is required; (4) start the next step before you have read the report of the last one.

## Step 0: the dry run (no key, no provider, no cost; about two minutes)

```powershell
npm install
npm run asp -- society cohort --local --provider stand-in --agents 3 --behaviours explorer,limit-tester,looper --budget-usd 1 --minutes 2
```

*Right:* the output begins `cohort: 3 agents of stand-in through stand-in, on a local society only; no goal is given and no persona is used.`, then the lines `caps:`, `tools:` and `worst case for the whole run: $3.00.`, then `3 agents enrolled`, and ends with a line that starts `done: 3 agents, estimated spend` and the two lines `what happened, in words:` and `raw trace:`, each with a path. Open the `report.md` that it names: it shows what a report looks like, with scripted agents. *If not:* stop and send the last twenty lines to a worker.

## Step 1: set the key (once, in this window)

```powershell
$env:ANTHROPIC_API_KEY = "PASTE-YOUR-OWN-KEY"
```

The key is read from this variable and only from it. Closing the window leaves no key on disk.

## Step 2: one real agent (USD 0.40; at most 15 minutes)

```powershell
npm run asp -- society cohort --local --agents 1 --model claude-haiku-5-5 --api-key-env ANTHROPIC_API_KEY --budget-usd 0.40 --minutes 15
```

*Right:* the output begins `cohort: 1 agent of claude-haiku-5-5 through anthropic, on a local society only; no goal is given and no persona is used.`, then `caps: $0.4 per agent, $0.4 in all, 15 minutes`, `worst case for the whole run: $0.40.`, `1 agent enrolled; model claude-haiku-5-5`, and ends with `done: 1 agents, estimated spend $` followed by a figure at or under 0.4, and the path of `report.md`. `claude-haiku-5-5` is in the gateway's price table, so no price flags are needed. Read the `report.md`: what it cost against the cap, how many turns it took, what it touched, and whether it ended by itself or at the cap (a cost near the cap means the cap ended it, which is what a cap is for). *If not:* the message `the environment variable ANTHROPIC_API_KEY is not set` means step 1 was not done in this window; `is not in the price table` means a different model name was typed; an agent that ends on its first turn at the dollar cap (the reason `usd_cap` in `trace.jsonl`) means the cap could not admit a call: stop and send the report to a worker. A provider error (429 or 5xx) is retried a few times and then ends that agent; wait a minute and read the report.

## Step 3: three agents (USD 1.20 at most)

Only after you have read the report of step 2 and its cost per agent is well under USD 0.40.

```powershell
npm run asp -- society cohort --local --agents 3 --model claude-haiku-5-5 --api-key-env ANTHROPIC_API_KEY --budget-usd 0.40 --minutes 15
```

*Right:* `cohort: 3 agents of claude-haiku-5-5`, `caps: $0.4 per agent, $1.2000000000000002 in all` (a rounding tail in the display: the figure is USD 1.20, and the line after it, `worst case for the whole run: $1.20.`, says so), `3 agents enrolled`, and a `done:` line with the estimated spend and the path of the report.

## Step 4: fifteen agents, the first real cohort (USD 6 at most)

Only after you have read the report of step 3.

```powershell
npm run asp -- society cohort --local --agents 15 --model claude-haiku-5-5 --api-key-env ANTHROPIC_API_KEY --budget-usd 0.40 --total-usd 6 --minutes 20
```

*Right:* `cohort: 15 agents of claude-haiku-5-5`, `caps: $0.4 per agent, $6 in all, 20 minutes`, `worst case for the whole run: $6.00.`, `15 agents enrolled`, and a `done:` line. When the agents' estimated spend together reaches USD 6, every agent stops.

## To stop it at once

From a **second** ordinary window opened in the repository folder:

```powershell
npm run asp -- stop --all
```

It ends every running session in this ASP home, this one included; each agent ends at its next step, within seconds, and the cohort prints `stop requested`. If you set `ASP_HOME` in the first window, set the same value in the second, or the command will not find the run. The quiet switch is an empty file called `STOP` in the run's folder (the `cohort-<time>` folder under `<ASP home>\cohort`). Closing the window also ends it.

## The cost check, after each step

1. The `done:` line and the report give the **estimated** spend of the run: an estimate from the token counts that the provider reports and the prices in the table, not the provider's bill.
2. Open the provider's own usage page (console.anthropic.com, Usage) and read the figure there. Your Anthropic balance before the first step was about USD 11; the whole order (0.40 + 1.20 + 6.00 = USD 7.60 at the caps) fits in it only if the real cost is at or under the caps. Stop, and send both figures to a worker, if the provider's figure is **above** the estimate by more than a few cents: the price table may be wrong for the model.
3. Re-check what a finished run left on disk (the run folder is the path that the `report.md` line names, without the file name):

```powershell
npm run asp -- society cohort verify <run folder> --api-key-env ANTHROPIC_API_KEY
```

*Right:* a PASS line for each of nine checks and no FAIL line (exit code 0). The checks include that no file in the folder holds your key. A FAIL line: send it to a worker and do not run the next step.

## After the run

Send the `report.md` of each step to a worker with the provider's figure beside the estimate. The report is exploratory: one model, a handful of agents, one run; it says what these agents did, not why, and not how agents behave in general. A row of the register moves only when its Done line is met by a recorded result, and nothing in this card moves one by itself.
