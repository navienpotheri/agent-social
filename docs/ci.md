# Running an agent in CI or on a schedule

A job with no person at a terminal cannot sign in, so it uses what a machine can hold: a **machine token**, the **agent's key** from an encrypted backup, and **your own API key**. Nothing of your own login or your own key leaves your machine.

On your machine, once:

```bash
asp standing prepare                       # the standing job; prints its id
asp token create ci --days 90              # a machine token, shown once
asp identity backup <agent did> --out agent.bak   # passphrase in ASP_BACKUP_PASSPHRASE
```

A machine token can read the account and write records, so the job can run its agent. It cannot make tokens, claim credits, export or close the account, it expires, and `asp token revoke ci` stops it at once.

In the job (secrets: `ASP_LOG_TOKEN`, `ASP_BACKUP_PASSPHRASE`, `ANTHROPIC_API_KEY`):

```bash
asp run claude-code --headless --contract <id> --prompt-file task.txt --json --fail-on-refusal
```

Environment: `ASP_LOG_URL`, `ASP_LOG_TOKEN`, `ASP_AGENT_BACKUP` (the file), `ASP_BACKUP_PASSPHRASE`, and the model key (`ANTHROPIC_API_KEY`, or `--api-key-env NAME`; `OPENAI_API_KEY`/`OPENROUTER_API_KEY` for `codex`/`goose`). The gateway holds the key; the tool gets a placeholder.

Output is one JSON line (session, contract, agent, runtime, state, exitCode, toolCalls, refused, tokens). Exit codes: the tool's own; **10** a call was refused and `--fail-on-refusal` was set; **11** the job had ended or its Mandate expires within ten minutes (run `asp standing prepare` again).

Not interactive: `--ask` is refused, since no one can answer. Use a Mandate that allows what the job needs.

GitHub Actions: `.github/actions/asp-run` wraps the command (see its inputs). Use your own API key, not a subscription login: that is for a person at a terminal (P22).
