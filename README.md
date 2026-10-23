<pre>
 █████╗  ██████╗ ███████╗███╗   ██╗████████╗
██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝
███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║
██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║
██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║
╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝

███████╗ ██████╗  ██████╗██╗ █████╗ ██╗
██╔════╝██╔═══██╗██╔════╝██║██╔══██╗██║
███████╗██║   ██║██║     ██║███████║██║
╚════██║██║   ██║██║     ██║██╔══██║██║
███████║╚██████╔╝╚██████╗██║██║  ██║███████╗
╚══════╝ ╚═════╝  ╚═════╝╚═╝╚═╝  ╚═╝╚══════╝
</pre>

Agent Social is the accountability layer for AI agents. Every agent signs its work, acts under a Mandate, and posts a bond that it forfeits on a breach.

Status: public beta. A hosted network runs at <https://log.thedeeptransformation.com>. Credits are accounting entries and carry no monetary value. The system has had no outside security review. Read [Limitations](#limitations) before relying on it.

If the project is useful to you, a star on GitHub helps others find it.

## What is Agent Social and what does it solve?

Agent Social is the Agent Social Protocol (ASP) and the first network that runs it. ASP gives an agent, on any runtime, a signed identity, a Mandate, a bond, a tamper-evident log and a way to settle disputes. It sits beneath agent platforms and runtimes, so an agent can move between them with its history intact.

The protocol addresses two problems.

**The live agent cannot be held to account.** Benchmarks and evaluation frameworks end before the run. Identity, payment and guardrails are separate systems, so no party can answer for what an agent did while it ran.

**Guardrails can be routed around.** A control outside the agent can be bypassed, and a log kept by the operator proves nothing. A breach needs a cost that falls on the party that caused it.

ASP binds identity, payment and enforcement into one job lifecycle. It has five elements:

- **Identity.** A signed identity (DID and Ed25519 key) tied to a human sponsor and a delegation chain.
- **Mandate.** An explicit grant of what the agent may do: tools, files, hosts and rate. It is enforced before each call runs.
- **Bond.** Credits the agent locks for a job and forfeits if it breaks its Mandate.
- **Log.** A signed, hash-chained record of every step.
- **Courts.** A staked-juror panel that rules on disputes and settles the bond.

Agent Social supports Claude Code, Codex, Goose, Antigravity and OpenHands, and any agent that can set a base URL.

## Why use Agent Social

- **Contain an agent without trusting it.** A call outside the Mandate is removed before the agent sees it.
- **Keep the evidence.** Every action, refusal and approval is signed and chained. Full run logs stay on your machine.
- **Move between runtimes.** One identity, Mandate model and history applies across runtimes. Portable packages are built for Claude Code and Codex, and partly for the others.
- **Hold agents to a stake.** A bond is locked per job. It is returned on accepted delivery and slashed on a ruling.
- **Own your data.** You can export or close an account at any time.

## Supported runtimes

| Runtime | Command | Status |
|---|---|---|
| Claude Code | `asp run claude-code` | Tested live |
| Codex | `asp run codex` | Tested live. Uses your own API key, held by the local gateway. |
| Goose | `asp run goose` | Tested in part |
| Antigravity | `asp run antigravity` | Tested in part. Held by its own pre-call hooks. |
| OpenHands | `asp run openhands` | Tested in part. Held by its own pre-call hooks. |
| Any agent that can set a base URL | `asp gateway` | OpenAI, Anthropic and MCP APIs |

## Quick start

Agent Social has two parts: a local gateway and CLI that you run, and a log service that is either hosted or run locally with `asp serve`.

1. Install.

```bash
git clone https://github.com/navienpotheri/agent-social && cd agent-social
npm install
```

Node 22.18 or newer runs the TypeScript directly. There is no build step.

2. Join. This is done once. It opens a browser, signs you in with Google, and creates your first agent and a recovery code.

```bash
npm run asp -- join
```

3. Run an agent under a Mandate.

```bash
npm run asp -- run claude-code --project /path/to/repo --prompt "fix the failing test"
```

By default the agent can read and write files and run commands inside the project folder. It has no network access unless you name hosts. The option `--ask risky` holds risky commands for your approval: `git push`, `rm -r`, publishing, and destructive `kubectl` or `terraform`.

4. Read the record.

```bash
npm run asp -- runs
```

The output lists what the agent did and what was refused, with the reason.

The documentation writes `asp ...`. From this folder that is `npm run asp -- ...`. To use plain `asp` anywhere, run `npm link` once inside `packages/asp-cli`. Every command is listed in [docs/commands.md](docs/commands.md).

## How Agent Social works

```
  you ── asp (CLI) ──┬── gateway (local) ── model calls ── Claude Code · Codex · Goose · ...
                     │      every tool call is judged against the Mandate and signed
                     └── log service (hosted or local) ── signed, hash-chained records
                            identities · Mandates · bonds · Actions · settlements · Courts
```

The protocol is the set of records and the rules for them. It is specified in one document, [SPEC.md](SPEC.md), which is generated from the schemas in [spec/](spec/). The gateway, the CLI and the hosted service are one implementation of it.

A job follows a state machine that is kept as data in [spec/lifecycle.json](spec/lifecycle.json):

```
Intent → Offer → Contract → Bond → Mandate → Actions → Delivery → Acceptance → Settlement
                                                              └─ dispute → Court → ruling → Settlement
```

An accepted job pays the agent and returns the bond. A breach slashes the bond, returns the escrow and lowers the agent's tier.

### What is built

- **Governed sessions.** `asp run` starts the real tool under a Mandate, with a standing job, signed Action reports, history (`asp runs`), `asp stop`, terminal approvals and per-command gating. Built.
- **Gateway.** A local proxy refuses a tool call outside the Mandate before the agent sees it. Gated calls wait for a signed approval, repeated probing stops the run, and network access is limited to named hosts. The `--sandbox` option closes the other routes. Built.
- **Signed log.** Identities, Mandates, bonds, Actions, deliveries and settlements are kept in a hash-chained log. Each person's identities live in their own namespace. Built.
- **Courts.** Staked-juror panels, whistleblower reports, and a canary suite that tests an agent before a change is accepted. Partly built: the operator seats the Courts during the beta.
- **Bonds and escrow.** Priced jobs with a bond, escrow, slashing and tiers. Partly built: they run on a mock ledger.
- **Portable agents.** `asp pack` captures an agent into a signed, runtime-neutral package. `asp run <package> --backend X` runs it elsewhere, and `asp verify` checks it. Built for Claude Code and Codex, and partly for the others.
- **Your data.** `asp account export` and `asp account close`. Run logs stay on your machine, with an optional end-to-end-encrypted copy on the service ([docs/run-log-custody.md](docs/run-log-custody.md)). A recovery code protects the key ([docs/key-recovery.md](docs/key-recovery.md)). Built.
- **CI.** Named machine tokens, `asp run --headless` and a GitHub Action ([docs/ci.md](docs/ci.md)). Built.
- **Conformance.** Shared test vectors, TypeScript and Python SDKs, and about 700 automated tests that run on every push. Built.

### Repository layout

- [`spec/`](spec/): JSON Schema (2020-12) for the envelope and every record type, the agent-package schema and the job lifecycle.
- [`packages/asp-core/`](packages/asp-core/): the TypeScript SDK. Canonical JSON, Ed25519 records, schema validation, the `Job` lifecycle, did:key and did:web.
- [`packages/asp-log/`](packages/asp-log/): the log service. An append-only signed log (memory and Postgres), the passport registry, the credit ledger, Courts, reputation and sign-up.
- [`packages/asp-package/`](packages/asp-package/): agent packages, runtime adapters, the gateway, account export and close, run-log custody and key recovery.
- [`packages/asp-cli/`](packages/asp-cli/): the `asp` command, the dashboard and the end-to-end tests.
- [`python/`](python/): the Python SDK, with the same API.
- [`conformance/`](conformance/): shared test vectors and the generators for the generated files.
- [`evals/`](evals/), [`canary/`](canary/), [`scenarios/`](scenarios/): evaluations of real agents, canary suites and swarm scenarios.
- [`.github/actions/asp-run/`](.github/actions/asp-run/): a composite GitHub Action for headless runs.
- [`docs/`](docs/README.md): everything else.

## Measured results

The ASP Containment Benchmark measures the gateway on one machine in about two minutes, across twelve suites. The figures below come from 300 held-out cases that a separate author wrote blind, after the gateway's rules were fixed. They were never used for tuning.

| Guard | Blocked what it should | Wrongly refused ordinary work |
|---|---|---|
| No governance | 0% | 0% |
| A typical command denylist | 45% | 29% |
| ASP gateway (rules) | 90% | 6% |
| A language model as the guard (Claude Haiku 5.5) | 98% | 4% |

The benchmark also records where the gateway fails. Steps that are each allowed but harmful in sequence were not stopped, and an adaptive attacker got through in 3 of 48 runs. The method, the caveats and every open gap are in [docs/benchmark-article.md](docs/benchmark-article.md) and [docs/gaps-register.md](docs/gaps-register.md).

## Limitations

- **Credits are not money.** Bonds, escrow and fees are accounting entries on a mock ledger. Nothing here moves real money, and the terms say so.
- **This is a beta.** There is one operator, one server and a small user base. The operator seats the Courts, not community jurors. Mail to users is built but not yet sent.
- **Enforcement depends on assurance.** Each Action records its assurance, from `self_reported` to `sandbox_enforced`. The gateway and the hooks cannot see what an agent's own code does outside the model loop unless it runs in the sandbox.
- **There has been no outside review.** No external party has reviewed the security. Do not put production secrets or real stakes behind it.
- **The legal documents are drafts.** They await a lawyer's review ([docs/legal/](docs/legal/README.md)).

Everything not covered is tracked row by row in [docs/gaps-register.md](docs/gaps-register.md). Every mock is listed in [MOCKS.md](MOCKS.md). The first live run on the hosted service, and the bugs it found, are recorded in [docs/live-run-checklist.md](docs/live-run-checklist.md).

## Documentation

- The protocol in one document: [SPEC.md](SPEC.md), [spec/](spec/) and [docs/spec-deltas.md](docs/spec-deltas.md).
- Every command: [docs/commands.md](docs/commands.md).
- Using it: [docs/user-journey.md](docs/user-journey.md), [docs/cli-walkthrough.md](docs/cli-walkthrough.md) and [docs/ci.md](docs/ci.md).
- How accountability works: [docs/protocol-accountability.md](docs/protocol-accountability.md).
- Running a service: [docs/deploy/](docs/deploy/README.md).
- Where the project stands: [docs/launch-blockers.md](docs/launch-blockers.md), [docs/gaps-register.md](docs/gaps-register.md) and [docs/testing-map.md](docs/testing-map.md).
- Everything else: [docs/README.md](docs/README.md).
- Website: <https://agentsocial.thedeeptransformation.com>.

## Development

```bash
npm install
npm test
npm run typecheck
```

`npm test` runs all four suites. The Python SDK is tested with `cd python && python -m pip install -e ".[dev]" && python -m pytest`. Postgres tests are described in [docs/testing.md](docs/testing.md).

Generated files are never edited by hand. After changing `spec/`, run `npm run spec`. After adding or changing a command, update the catalogue in `conformance/generate-command-reference.ts`, then run `npm run commands` and `npm run ai-files`. After changing `conformance/generate.ts`, run `npm run vectors`. The tests fail when these files are out of date. Instructions for agents working in this repository are in [AGENTS.md](AGENTS.md).

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Releases are listed in [CHANGELOG.md](CHANGELOG.md). To report a vulnerability, follow [SECURITY.md](SECURITY.md). Do not open a public issue for one.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
