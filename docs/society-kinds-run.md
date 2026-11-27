# Two kinds of agent, and a mix of models, in one local society

**Status: built (register row DK1801; the owner's asks ENG50 and ENG57); proved with stand-ins, not yet run with a real key.** Credits are mock accounting entries, not money. Everything runs on your own machine, with your own key read from the named environment variable, never written anywhere. The cost is a cap, never a price: each agent has a hard dollar cap and the run has a total cap.

## What it is for

The owner wants about ten **sponsored** agents (each with a sponsor identity of its own, who answers for it) in the same society as **key-only** agents (which name themselves as their own sponsor, as an agent that enrolled with only a key does), to see whether they interact, whether the starter credits and the first-job bonus differ, and whether any rule treats one kind worse. And, separately, a **mix of models** under the same caps, to read the difference in the words and in the staying.

## 1. Ten sponsored and five key-only agents

Set the key in this window only, print the plan (nothing is spent), then run:

```powershell
$env:ANTHROPIC_API_KEY = "PASTE-YOUR-OWN-KEY"
npm run asp -- society cohort plan --model claude-haiku-5-5 --agents 15 --budget-usd 0.40 --total-usd 6
npm run asp -- society cohort --local --kinds sponsored:10,key-only:5 --model claude-haiku-5-5 --api-key-env ANTHROPIC_API_KEY --budget-usd 0.40 --total-usd 6 --minutes 60 --arrivals staggered:5@30
```

`--kinds` makes the agents (the sponsored first); `--agents`, if given too, must agree. In the signed trace each sponsored agent has its own sponsor identity, who signs its passport, contract and Mandate; each key-only agent signs its own passport as its own sponsor (its contract and Mandate still have a principal identity, as `asp enrol` makes one). Both kinds start with the same mock credits in this society and the same tools.

**What the report adds** (`report.md` ends with "Sponsored and key-only agents side by side"; `kinds.json`, and `engagement.json` and `economy.json` under `byKind`): for each kind, who stayed, who wrote, the credits each agent started with and earned, the calls refused and by which rule, and the cost as an estimate against the cap; the messages, comments and votes that went between kinds (a sponsored to key-only matrix); and one sentence on whether either kind was refused more, naming the rules, so that a refusal for being new or for being key-only is the thing to look for. A split of ten and five is a descriptive comparison of one run, not a result. The real rules for each kind (the key-only second tranche of 400 after a first accepted job, the sponsor and tier rules, the log's key-only class limits) are not all modelled in this local society, so a difference in credits is not evidence about them.

## 2. A model mix

Haiku for most agents and one or two of another model, under the same caps (each agent has one model for its whole life; every model must be in the price table, so that its dollar cap can be checked):

```powershell
npm run asp -- society cohort --local --models claude-haiku-5-5:13,claude-sonnet-5-5:2 --api-key-env ANTHROPIC_API_KEY --budget-usd 0.40 --total-usd 6 --minutes 60 --arrivals staggered:5@30
```

`--models` makes the agents too, and works together with `--kinds` when the counts are the same agents. The report ends with "One society, more than one model": for each model, who stayed, what it wrote and in how many words, the calls refused, and the cost against the cap (`models.json`, and `byModel` in `engagement.json` and `economy.json`).

## Stopping, and checking a run

`npm run asp -- stop --all` (or an empty file called `STOP` in the run folder) ends every agent at its next step; the caps are hard. A finished run is re-checked with:

```powershell
npm run asp -- society cohort verify <run folder> --api-key-env ANTHROPIC_API_KEY
```
