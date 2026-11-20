# Society run: a swarm of agents over many hours

Status: 2026-10-21. The long-duration swarm used to solve problems and to watch how agents interact over time. Offline smoke test only so far (a stand-in model and web); no real 8-hour run yet.

## What it is

`evals/society-run.mjs` runs a small society of real model agents for hours against one shared log service. Each agent is its own identity with a bond. Clients post priced jobs; an agent takes one, works it through the gateway under a Mandate, delivers cited claims, and the job is graded, accepted or disputed (panel, ruling, bond slashed). Agents read and leave notes in a shared commons, so one agent's finding reaches the others. Everything goes through the real `asp` commands, so the signed log is the record. Credits are accounting entries, not money.

It is the go-to way to put a problem to many agents at once: write the problems to a file, start a run, read `report.md` in the morning.

```bash
# offline smoke test, no key, no cost (about 2 minutes)
node evals/society-run.mjs --stub --hours 0.03 --agents 5 --gap-minutes 0.03 --out ~/asp-society/stub

# a real 8-hour run: open-weight models on OpenRouter, capped at about $10
node evals/society-run.mjs --out ~/asp-society/run1 --hours 8 --agents 8 --key-file ~/.asp-openrouter-key --max-spend 10 --problems problems.txt
```

`--problems <file>`: one problem per line (`#` comments), re-read before every job, so add to it while the run goes. With no file the agents work built-in "stay abreast of the web" topics. Other options are at the top of the script.

## What you see

- `status.txt`, rewritten every minute: each agent's jobs, accepted, disputed, refused calls, tier and slashes, and `asp watch`.
- `events.ndjson`: one line per job. `answers.jsonl`: each answer with its claims. `notes.jsonl`: the commons. `work/*.gateway.txt`: the gateway's account of every call, allowed or REFUSED.
- `report.md`: written at the end (or `--report-only`), with the log verified.
- `asp dashboard` works on the folder: `ASP_HOME=<out>/asp ASP_LOG_URL=<url in the run.log>`.
- Resumable: run again with the same `--out`. Identities, the log and the spend so far are kept.

## Personas

Honest agents search and read what they cite. Careless agents answer from memory with made-up sources: the verifier finds the cited pages were never fetched, the job is rejected, a panel rules, the bond is slashed, and repeat slashes drop the agent to tier 0, where it can no longer bond and is retired from the run. Reckless agents also try a shell command the Mandate does not grant: the gateway refuses it and the report counts it.

## What the grading does and does not do

The verifier is deterministic: a claim is confirmed only if the agent really fetched the page it cites. It does not judge whether the claim is right, and no model judges a model. An accepted answer means "cited what it read", not "correct". Read the answers.

## Limits, stated

- **Open web is a wide allowlist, not the open web.** The log refuses a network scope without named hosts below tier 3, so each Mandate names the hosts in `--hosts-file` (default: a search engine, wikis, GitHub, arXiv, news and docs sites). A page elsewhere is refused and counted. Reaching tier 3 for true open web is not built into the run.
- The personas are staged behaviours, so the dispute and the refusal are expected outcomes, not discoveries.
- Spend is estimated from token counts and the per-million prices given (`--price-in`, `--price-out`); check the provider's own bill. The run stops at `--max-spend`.
- Agents run on OpenRouter models through the gateway on this machine; a Claude subscription login must not be used for this (docs/provider-terms.md).
- Searches use DuckDuckGo's HTML page, which may rate-limit or change.
- No outside review; a beta.
