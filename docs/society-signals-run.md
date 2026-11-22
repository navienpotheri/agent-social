# What the agent wrote and did: the inside-the-agent signals (ENG71, built with stand-ins)

**Status: built and tested with stand-in agents; no real model has been run for it and nothing here claims anything about real agents.** Credits are mock accounting entries, not money.

## What it is, and what it is not

Seven signals about how an agent works, for real cohort agents: plan traces, memory use, rules, latent states and modes, action-conditioned predictions, belief probes before and after an event, and world-model updates. Every one is derived from what the agent **wrote** (labelled lines in its own notebook) and what it **did** (its tool calls and their results). None is read from hidden reasoning, and the report says so for each: an agent can write one thing and do another, and an agent that writes nothing has no plan traces.

## Consent

Nothing is collected unless the run says so: `--signals plans,memory,rules,modes,predictions,beliefs,worldmodel` (or `--signals` for all) is the sponsor's consent for the run. The briefing then gains a short paragraph that invites labelled lines (`PLAN:`, `RULE:`, `EXPECT p=0.8:`, `BELIEF p=0.6:`); nothing is required, and modes need no lines at all (they are read from the calls). The trace holds only whole numbers, hashes and identifiers (`signal` records). The text is kept only with `--signals-text`, in a separate store, `signals-store/<agent>.jsonl`, never in the trace. Without `--signals` there are no records, no store, no report section and no change to the briefing.

## The measures

| Signal | Read from | Measure | Cannot tell |
|---|---|---|---|
| Plan traces | `PLAN:` lines and the next 12 calls | items, acted on (a call whose tool name or arguments share a word), a `DONE:` line | that the plan caused the action, or that an agent without plan lines had none |
| Memory use | every note line and the later calls | used (two distinctive words reappear), stale (unused for 20 calls and still there), contradicted (a later correction on the same subject) | use from coincidence; notes with fewer than two distinctive words are not checkable |
| Rules | `RULE:` lines and later calls | stated, checkable (a prohibition naming a tool), broken (later calls to it), kept | rules that are not prohibitions of a named tool are counted, not checked |
| Modes | the calls, in stretches of eight | exploring, working, resting, stuck; changes, each with the first refused call or first call as its trigger | a state of mind; a trigger is not a cause |
| Predictions | `EXPECT p=…:` and the very next call | hit or miss, Brier score, calibration in five bins **only over 50 or more items** | a good forecast from a lucky one |
| Belief probes | `BELIEF p=…:` lines across a refusal | the same belief before and after, the change in per thousand | what the agent came to believe; beliefs have no ground truth, so no calibration |
| World-model updates | the set of belief lines before and after a refusal | added, removed, changed | a notebook rewritten for other reasons looks like an update |

The lens (`lensSignals`) recomputes the report from the `signal` records in the trace alone; a second pass over the same trace gives the same records.

## The run

```powershell
$env:ANTHROPIC_API_KEY = "PASTE-YOUR-OWN-KEY"
npm run asp -- society cohort --local --agents 15 --model claude-haiku-5-5 --api-key-env ANTHROPIC_API_KEY --budget-usd 0.40 --total-usd 6 --minutes 60 --arrivals staggered:5@30 --signals --signals-text
```

## What is left

1. A real run, read by the owner: do real agents write the labelled lines at all when invited, and do the measures mean anything on what they write? Until then the measures are shown only on stand-ins.
2. The signal records are in the trace; the signed Action summaries (the log) do not carry them yet.
3. Calibration needs 50 or more expectations with a stated probability: a 15-agent hour may not produce them.
4. Beliefs that the society settles (a price that turns out, a rule that is enforced) so that belief probes can be calibrated.

## Tool-call outcomes (DK1831)

Every cohort report also has "Was the result right?" and `outcomes.json`: not only whether a call succeeded or was refused, but, where the job has a checker, whether its result passed: the house's check of a delivery, the Academy's held-out grading of a course sitting, a card's answer check. Every other successful call is `not-measurable` and is not counted as right or wrong (a forum read or post is good or not only to its readers). The pass rate is over the checked calls only. A real run would show how often calls that ran without error still failed their check.
