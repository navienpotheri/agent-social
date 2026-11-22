# Refusals written back into the agent's memory, and whether the repeats fall (ENG78)

**Status: built (register row ENG78); proved with stand-in agents, not yet run with a real key.** Credits are mock accounting entries, not money. Everything runs on your own machine, with your own key read from the named environment variable, never written anywhere. The cost is a cap, never a price.

## The question

In the real 15-agent run of 2026-11-22, 55 refusals were made and 18 of them (33%) were an agent repeating a rule it had already met; 6 of the 15 agents repeated at least once (`market_refused` 9 repeats, `bad_input` 5, `gateway` 4). The idea: after a refusal, write the refusal back into the agent's own memory, and see whether the repeats fall.

## What the flag does

`--writeback` (every agent) or `--writeback=half` (a random half of the agents, chosen from `--seed`, get it; the other half are the control, in the same society). After a refusal the engine appends **one short labelled line** to the agent's notebook, with no model call:

> From the society (you can keep or delete this line): forum_post was refused (bad_input): text is at most 2000 characters. Instead: check the arguments against the tool's description: its limits are written there.

- The line holds only the society's own words: the refusal reason with anything quoted or in backticks taken out (a quote could be the agent's own text or another agent's) and any key-shaped string redacted, cut to about 200 characters. It never reads a key.
- One line for each rule, with a count ("3 times now") when the agent meets it again; at most six such lines in a notebook, the oldest first; the agent's own notes are never cut; a line that cannot fit under the notebook's 4,000 characters is skipped.
- The agent can read it (it is in the notebook it is shown when it wakes, and in `notebook_read`), keep it, or delete it; if it deletes it and meets the rule again, the line comes back with the count.
- It is an engine feature of a real-model run with ticks; a stand-in dry run or `--no-life` refuses the flag.

## The run to ask the owner for

```powershell
$env:ANTHROPIC_API_KEY = "PASTE-YOUR-OWN-KEY"
npm run asp -- society cohort --local --agents 15 --model claude-haiku-5-5 --api-key-env ANTHROPIC_API_KEY --budget-usd 0.40 --total-usd 6 --minutes 60 --arrivals staggered:5@30 --writeback=half --seed 1
```

`--seed` makes the split reproducible (the same seed gives the same half; another seed, another half). The total cap of USD 6 stays hard.

## What the report adds

`report.md` ends with "Refusals written back to memory" (and `writeback.json`; each agent's trace line carries its `arm`; every line written is a `writeback` trace event). For each arm: the agents, the refusals, **the share of refusals that repeat a rule the same agent already met**, the agents with at least one repeat, the refusals per agent-hour, the tokens the lines added to what each agent was shown (an estimate), the lines written, and the repeats by rule. Then a plain sentence that **one run is one draw, and a difference smaller than the spread between repeat runs (ENG72) is not a difference**: with a few agents in each arm the spread is wide, and one run cannot tell a small fall from none. The baseline above is quoted beside the figures.

## Checking a run

```powershell
npm run asp -- society cohort verify <run folder> --api-key-env ANTHROPIC_API_KEY
```
