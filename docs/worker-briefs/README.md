# Worker briefs and the API-billed runner

How the two workers are run when usage is billed per token on the owner's own API key, not on the subscription limits. The lead (an interactive session) merges, checks reports and closes register rows; workers never push and never merge.

## Rules every worker follows

- Read `AGENTS.md` first. Generated files are never edited by hand (`npm run spec|commands|ai-files|vectors`). A protocol change needs a numbered row in `docs/spec-deltas.md`, schema and vectors in both SDKs, and tests.
- A register row (`docs/gaps-register.md`, status exactly `open`, `designed`, `partial` or `closed`; never delete a row; mirror in `docs/scope.md`) closes **only** when its stated "Done:" criterion is fully met by a test that passes. Anything that cannot be met from this repository (the hosted service, a live run, an account setting, a wording or design decision for the owner) is split into a new row and listed in `docs/owner-checklist.md`; it is not marked "good enough". Partial never counts as done.
- Keep `docs/testing-map.md` and `docs/society-progress.md` current for what you touch.
- No token, key, recovery code or API key in a commit, a test, a log or a report. Tests use fake keys. Never run `asp law sign`.
- Run `npm run typecheck` and `npm test` (with an empty `HOME` so the tests do not read a real `~/.asp`: `HOME=$(mktemp -d) USERPROFILE=$HOME npm test`) before each commit. Commit in small steps on your own branch. Do not push.
- End with a report: what works (with the test names), which rows you closed and which stay open and exactly why, what you assumed.
- Credits are accounting entries, not money; the service is a beta; no outside security review has happened. Keep the website and README claims true.

## The two workers

| Worker | Brief | Area |
|---|---|---|
| society | [society.md](society.md) | the credit economy, containment, memory and history, the circumvention stages (DK rows) |
| product | [product.md](product.md) | sign-in, mail, dashboard, run logs, runtimes, hardening (U, E, O, P, T, H, D rows) |

They touch different files. If a change must touch a shared file (`cli.ts`, `log.ts`, the generated references), keep it minimal and expect a merge by the lead.

## Running one on an API key

The key stays in an environment variable on the owner's machine. It is never typed into a chat, a file in the repository or a command line.

```powershell
# once, in the terminal you will run it from (not saved anywhere):
$env:ANTHROPIC_API_KEY = Read-Host -MaskInput "API key"
# then, from the repository root:
.\scripts\run-worker.ps1 -Name society -Brief docs\worker-briefs\society.md -BudgetUsd 5
```

`scripts/run-worker.ps1` makes a worktree and a branch for the worker, runs `claude -p` there with `--max-budget-usd` as a hard cap for the run, writes the output to `<worktree>\worker.log`, and never prints the key. Set a spend limit on the Console workspace too. Read the cost for the trial run in the Console before raising the budget.
