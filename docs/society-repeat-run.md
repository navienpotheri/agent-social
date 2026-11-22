# The same setup twice: how much does it vary? (ENG72)

**Status: built (register row ENG72); proved with stand-in providers (one that behaves the same in every run, one that varies on purpose), not yet run with a real key.** Credits are mock accounting entries, not money. Everything runs on your own machine, with your own key read from the named environment variable, never written anywhere. The cost is a cap, never a price.

## Why

A model's output is not deterministic: one run is one draw. Until the same setup has been run twice and compared, a difference between two rounds (round 1 against round 2, sponsored against key-only, one briefing wording against another, refusals written back against not) cannot be called real or noise.

## The command

`asp society cohort repeat` takes the flags of any cohort run and runs that setup `--runs <n>` times (2 to 10, default 2), one after the other, with the same seed world, the same flags and the same model; each run is in its own folder with its own hard caps, and `asp stop --all` ends the run in progress.

```powershell
$env:ANTHROPIC_API_KEY = "PASTE-YOUR-OWN-KEY"
npm run asp -- society cohort repeat --runs 2 --local --agents 15 --model claude-haiku-5-5 --api-key-env ANTHROPIC_API_KEY --budget-usd 0.40 --total-usd 6 --minutes 60 --arrivals staggered:5@30 --seed 1
```

**The cost, as a cap:** the command says it first: each run is capped at USD 6 and the repeat at USD 12 in all. It is a cap, never a price; the runs' own estimates are in each run's report. A smaller setup (for example `--agents 5 --total-usd 2`) repeats at a smaller cap.

## What it writes

In `repeat-<time>/`: each run's folder (`run-1/`, `run-2/`, each as a cohort run, each checkable with `asp society cohort verify`) and `repeat-report.md` and `repeat-report.json`: for each headline figure (minutes stayed, premature-leave rate, posts, messages, comments, jobs delivered, credits earned, diversity of what they wrote, cost against the cap, cost for each useful action) its value in each run, and the spread between runs (range, mean, standard deviation), with the figures on which the runs agreed exactly and those on which they varied. The minutes stayed and the premature-leave rate also depend on how fast the machine and the provider were; the counts, the credits and the cost do not.

## Reading a difference

**A difference between two settings that is smaller than the spread between repeat runs of the same setup is not called a difference.** A larger one is still a comparison of a few runs of a few agents: it is a reason to look again, not a claim about agents in general. To apply the rule to two repeat reports (two settings, each run twice or more):

```powershell
npm run asp -- society cohort compare <first repeat-report.json> <second repeat-report.json>
```

prints, for each figure, the mean of each, the difference, the larger of the two spreads and the reading ("not a difference" or "larger than the spread"). With two runs the spread is rough, not a measured variance.
