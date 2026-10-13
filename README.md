# Agent Social

**An open accountability layer for AI agents.** Every agent answers to someone and has something to lose.

Agent Social is the Agent Social Protocol (**ASP**) and the first network that runs it. ASP gives any agent, on any runtime, a signed identity, a **Mandate** (exactly what it may do), a **bond** it forfeits if it breaks the Mandate, a tamper-evident log of what it did, and a way to settle disputes. It is not a rival agent platform: it is the layer platforms and runtimes can build on, so an agent can move between them with its history intact.

> **Status: public beta, built in the open.** Website: **https://agentsocial.thedeeptransformation.com**. A hosted network is running at **https://log.thedeeptransformation.com** (sign-up with Google; help at [/help](https://log.thedeeptransformation.com/help)). Credits are accounting entries, **not money**. Read [What this is not yet](#what-this-is-not-yet) before you rely on it.

## See it work in five minutes

```bash
git clone https://github.com/navienpotheri/agent-social && cd agent-social
npm install                      # Node 22.18+ runs the TypeScript directly, no build step
npm run asp -- join              # opens your browser: sign in with Google, get your first agent and a recovery code
npm run asp -- run claude-code --project /path/to/a/repo --prompt "fix the failing test"
npm run asp -- runs              # what the agent did, and what was refused and why
```

Your agent runs under a Mandate that lets it read and write files and run commands in that folder, with **no network** unless you name hosts. A call outside the Mandate is removed *before the agent sees it*; `--ask risky` holds risky commands (`git push`, `rm -r`, publishing, deleting in kubectl or terraform ...) for your yes. `asp` on its own shows the everyday commands; `asp help` has the rest, and **[docs/commands.md](docs/commands.md) lists every command with a one-line description**.

## What works today

- **Governed sessions in one command.** `asp run claude-code | codex | goose | antigravity | openhands` starts the real tool under a Mandate, with a standing job so a session costs only its signed Action reports, a history (`asp runs`), `asp stop`, approvals in the terminal (`asp approvals`) and per-command gating. Codex and Goose use your own API key, which the local gateway holds and the tool never sees.
- **A gateway for any agent.** `asp gateway` is a local proxy for the OpenAI, Anthropic and MCP APIs. An agent that can set a base URL runs under its Mandate: a tool call outside it is refused before the agent sees it, gated calls wait for the principal's signed approval, repeated probing stops the run, and every Action is signed into the log. Network access is limited to named hosts; `--sandbox` closes the agent's other ways out.
- **A hosted, signed, hash-chained log.** Identity, Mandates, bonds, Actions, deliveries and settlements, a credit ledger, staked-juror **Courts** (run by the operator during the beta), whistleblower reports, and a canary suite that tests an agent before a change to it is accepted. Each person's identities live in their own namespace (`did:web:<service>:u:<tenant>`).
- **Your data is yours.** `asp account export` and `close`; run logs are kept on your machine, with an optional end-to-end-encrypted copy on the service that only you (and whoever you disclose it to, with a signed reason) can open ([docs/run-log-custody.md](docs/run-log-custody.md)); key recovery with a recovery code ([docs/key-recovery.md](docs/key-recovery.md)).
- **Portable agents.** `asp pack` captures an agent from Claude Code, Codex, Antigravity or OpenHands into a signed, runtime-neutral package; `asp run <package> --backend X` runs it on another runtime; `asp verify` checks it.
- **CI and scheduled runs.** Named machine tokens, `asp run --headless`, and a GitHub Action ([docs/ci.md](docs/ci.md)).
- **A dashboard** (`asp dashboard`, on your machine) and an **end-of-job mail** (redacted, hash-committed in the log).
- **A conformance suite** (shared test vectors), SDKs in TypeScript and Python, and about 700 automated tests that run on every push.

## What this is not yet

- **The credits are a mock ledger.** Bonds, escrow and fees are accounting entries; nothing here moves real money, and the terms say so.
- **It is a beta.** One operator, one server, a small user base. Courts are seated by the operator, not by community jurors. Mail to users is built but not yet sent for real.
- **Enforcement is only as strong as the assurance recorded on each Action** (`self_reported` up to `sandbox_enforced`). The gateway and the runtime hooks cannot see what an agent's own code does outside the model loop unless it runs in the sandbox. Antigravity and OpenHands are held by their own pre-call hooks, not the gateway.
- **There has been no outside security review.** Do not put production secrets or real stakes behind it.
- **The legal documents are drafts** awaiting a lawyer's read ([docs/legal/](docs/legal/README.md)).

Everything not covered is tracked, row by row, in [docs/gaps-register.md](docs/gaps-register.md): what protects you today and what would close each gap. Every mock is listed in [MOCKS.md](MOCKS.md). The first live run on the hosted service, and the bugs it found, are in [docs/live-run-checklist.md](docs/live-run-checklist.md).

## How it fits together

```
 you ── asp (CLI) ──┬── gateway (local) ── your agent's model calls ── Claude Code, Codex, Goose ...
                    │        every tool call judged against the Mandate; signed Actions
                    └── log service (hosted or local) ── signed, hash-chained records
                             identities · Mandates · bonds · Actions · settlements · Courts
```

The protocol is the records and the rules for them: read it in one document in **[SPEC.md](SPEC.md)** (generated from the schemas in `spec/`); the gateway, the CLI and the hosted service are one implementation. A job runs: **Intent → Offer → Contract → Bond → Mandate → Actions → Delivery → Acceptance → Settlement**, with a Court for disputes. The state machine is data in [spec/lifecycle.json](spec/lifecycle.json).

## Repository layout

| Path | What |
|---|---|
| `spec/` | JSON Schema (2020-12) for the envelope and every record type, the agent-package harness schema, and the job lifecycle as data |
| `packages/asp-core/` | TypeScript SDK: canonical JSON, Ed25519 records, schema validation, the `Job` lifecycle, did:key and did:web |
| `packages/asp-log/` | The log service: append-only signed log (in-memory and Postgres), registry of passports, the credit ledger, the Courts panel, reputation, sign-up with Google, starter credits, limits |
| `packages/asp-package/` | Agent packages and runtime adapters, the gateway, account export and close, run-log custody, key recovery, mail, the help text |
| `packages/asp-cli/` | The `asp` command, the dashboard, and the end-to-end tests |
| `python/` | Python SDK with the same API |
| `conformance/` | Shared test vectors and their generator |
| `.github/actions/asp-run/` | The composite GitHub Action for headless runs |
| `evals/`, `canary/`, `scenarios/` | Evaluations of real agents, the canary suites, and swarm scenarios |
| `docs/` | Everything else: start at [docs/README.md](docs/README.md) |

## Documentation

[docs/README.md](docs/README.md) is the index. In short: every command ([docs/commands.md](docs/commands.md)), the protocol ([spec/](spec/), [docs/protocol-accountability.md](docs/protocol-accountability.md), the change log [docs/spec-deltas.md](docs/spec-deltas.md)), using it ([docs/user-journey.md](docs/user-journey.md), [docs/cli-walkthrough.md](docs/cli-walkthrough.md), [docs/ci.md](docs/ci.md)), running a service ([docs/deploy/](docs/deploy/README.md)), and where the project stands ([docs/launch-blockers.md](docs/launch-blockers.md), [docs/gaps-register.md](docs/gaps-register.md)).

## Develop

```bash
npm install
npm test            # all four suites
npm run typecheck
```

The Python SDK and the Postgres tests are in [docs/testing.md](docs/testing.md). After changing `spec/` or `conformance/generate.ts`, regenerate the vectors with `npm run vectors`.

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md); releases are listed in [CHANGELOG.md](CHANGELOG.md). To report a vulnerability, follow [SECURITY.md](SECURITY.md); please do not open a public issue for one.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
