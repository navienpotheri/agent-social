# Handoff: run the society swarm for real (8-hour runs)

Written 2026-10-21. Repo: Agent Social (ASP), worktree `C:\Users\Navie\agent-social\.claude\worktrees\mystifying-sinoussi-fe1ea3`. Read AGENTS.md and docs/society-run.md first. A sibling chat is building an agent forum (see HANDOFF-agent-forum.md); the swarm's answers will later be posted there. Don't touch forum work here.

## Goal

The user wants to experience how agent swarms interact over long durations, and the swarm is to be their go-to for problem solving. They chose: scripted-orchestrated but **real open-weight model agents via OpenRouter**, **open web search**, **overnight (8h+) runs, several of them**, **~$10 spend cap per run**. Agents must stay abreast of the web.

## What exists (uncommitted, in the worktree above)

- `evals/society-run.mjs` (driver), `evals/society/agent.mjs` (the agent tool loop: web_search via DuckDuckGo HTML, web_fetch, read_notes, write_note, bash as a trap, finish), `evals/society/stub.mjs` (stand-in model and web), `docs/society-run.md`, gaps-register row T27, docs/README.md index line.
- Driver: starts `asp serve local:<out>/db --no-auth` as one shared log; creates clients, a verifier, 3 jurors, N agents with personas (honest, careless, reckless); each agent loops: intent, offer, contract, bond, mandate (web.read, repo.read, repo.write, tool.read_notes, tool.write_note, plus a named-host allowlist), gateway run of the agent, deliver cited claims, deterministic verify (claim confirmed only if the cited page was really fetched), accept or reject, panel draw, ruling, settle with bond slashed. Careless agents get slashed to tier 0 and are retired ("out"). Notes go to a shared commons file; `--problems <file>` is a live-editable queue. Outputs: status.txt (every minute), events.ndjson, answers.jsonl, notes.jsonl, work/*.gateway.txt, report.md. Resumable with the same `--out`.
- Offline smoke test passes: `node evals/society-run.mjs --stub --hours 0.03 --agents 5 --gap-minutes 0.03 --problems <file> --out <dir>` (about 2 minutes).

## Not done

- No real run yet. Needs the user's OpenRouter key file path (never print or commit a key) and their answer on a 30-minute trial (about $1) before 8 hours.
- Open web is a wide host allowlist, not true open web: the log refuses a network scope without named hosts below tier 3. Earning tier 3 is not built into the run.
- Grading checks citations were really read, not that answers are right.
- Careless agents retire permanently, so a long run shrinks; decide whether to change the persona mix or add replacements.
- Spend is estimated from token counts at assumed prices (`--price-in/--price-out`); verify against OpenRouter's bill. Verify the model id `openai/gpt-oss-120b` (default) exists and its price before the trial; first real calls may reveal tool-call format problems in agent.mjs or gateway handling.
- DuckDuckGo HTML search may rate-limit or change; consider a fallback.
- Files are uncommitted. Commit/push only if the user asks (new branch).
- Watch for the gateway's token cap (`--token-cap`, default 80000 per job) and 25-minute job timeout.

## Pitfalls

- Windows tool layer unescapes `\n` in Python heredocs: use the Edit tool for JS strings.
- No `pkill` in Git Bash: use PowerShell `Get-CimInstance Win32_Process` + `Stop-Process`.
- Never run `node conformance/generate-ai-files.ts --check` (it rewrites files).
- Tests leak the user's joined ASP account unless run with clean HOME/USERPROFILE/APPDATA/LOCALAPPDATA.
- Provider terms: use an API key (OpenRouter), never a Claude subscription login, for all-day agents (docs/provider-terms.md, P22).

## First steps

1. Read docs/society-run.md, evals/society-run.mjs, evals/society/agent.mjs.
2. Ask the user for the key file path and the trial decision; write a first problems file with them.
3. Run the 30-minute trial (`--hours 0.5 --agents 6 --max-spend 1`), read status/report/gateway files, fix what breaks, then run the 8-hour runs with a spend cap, and report results honestly (what is a result, what is only a smoke).
