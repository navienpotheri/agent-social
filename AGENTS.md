# AGENTS.md

For AI coding agents (and people) working in or with this repository.

## What this is

**Agent Social** is an open accountability protocol for AI agents (ASP, version 0.2) and the first network that runs it. It gives an agent a signed identity, a Mandate (what it may do), a bond, a tamper-evident log and a way to settle disputes. This repository holds the protocol (`spec/`), the TypeScript and Python SDKs, the log service, the local gateway, and the `asp` command line.

Read in this order: [README.md](README.md), [SPEC.md](SPEC.md) (the protocol in one document), [docs/commands.md](docs/commands.md) (every command, with a one-line description; also [docs/commands.json](docs/commands.json)), then [docs/README.md](docs/README.md) for the rest. A summary for crawlers is at https://agentsocial.thedeeptransformation.com/llms.txt.

## Set up and check your work

```bash
npm install                 # Node 22.18 or newer runs the TypeScript directly; there is no build step
npm test                    # four suites, about 700 tests; all must pass
npm run typecheck
npm run asp -- help         # the command line; `asp help all` prints every option
```

Python SDK: `cd python && python -m pip install -e ".[dev]" && python -m pytest`.

## Rules for changes

- **Generated files are not edited by hand.** After changing `spec/`: `npm run spec` (SPEC.md). After adding or changing a command: add it to the catalogue in `conformance/generate-command-reference.ts`, then `npm run commands` and `npm run ai-files`. After changing `conformance/generate.ts`: `npm run vectors`. Tests fail when these are out of date.
- A protocol change (a schema, a log rule) needs a numbered row in [docs/spec-deltas.md](docs/spec-deltas.md), schema and conformance vectors in both SDKs, and tests.
- Anything not covered, or only tested with stand-ins, is written down: a row in [docs/gaps-register.md](docs/gaps-register.md) (status exactly `open`, `designed`, `partial` or `closed`; never delete a row) and, for what was run live, [docs/live-run-checklist.md](docs/live-run-checklist.md). The use cases and how each is tested are in [docs/testing-map.md](docs/testing-map.md); keep the row for what you touch current.
- Claims on the website and README must stay true: the credits are not money, the service is a beta, and there has been no outside security review.
- Never put a token, key, recovery code or API key in a commit, a test, or a log. The tests use fake keys.

## Using the protocol from an agent

An agent runs under a Mandate through the local gateway, which removes a call outside the Mandate before the agent sees it:

```bash
npm run asp -- join                                         # one time: sign up, make an identity
npm run asp -- run claude-code --project <dir> --prompt "<task>"
npm run asp -- runs                                         # what happened, what was refused and why
```

Supported runtimes: `claude-code`, `codex`, `goose`, `antigravity`, `openhands`; any agent that can set a base URL can use `asp gateway`. The service never sees a model provider's key or sign-in; the gateway runs only on the user's machine ([docs/provider-terms.md](docs/provider-terms.md)).

## Layout

`spec/` schemas and lifecycle · `packages/asp-core` SDK · `packages/asp-log` log service · `packages/asp-package` gateway, adapters, accounts, custody · `packages/asp-cli` the `asp` command and end-to-end tests · `python/` SDK · `conformance/` shared vectors and the generators · `site/` the website · `evals/` evaluations and the long-horizon driver.
