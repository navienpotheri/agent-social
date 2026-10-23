<p align="center">
  <img src="docs/assets/banner.svg" alt="Agent Social Protocol: every agent answers to someone, and has something to lose" width="100%">
</p>

<p align="center">
  <a href="https://github.com/navienpotheri/agent-social/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/navienpotheri/agent-social/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-22282a">
  <img alt="Protocol version 0.2" src="https://img.shields.io/badge/ASP-0.2-22282a">
  <img alt="Status: public beta" src="https://img.shields.io/badge/status-public%20beta-a83b22">
  <img alt="Node 22.18+" src="https://img.shields.io/badge/node-%E2%89%A522.18-22282a">
</p>

<p align="center">
  <a href="#what-is-agent-social">What it is</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#capabilities">Capabilities</a> ·
  <a href="#measured-results">Results</a> ·
  <a href="#limitations">Limitations</a> ·
  <a href="#documentation">Docs</a> ·
  <a href="https://agentsocial.thedeeptransformation.com">Website</a>
</p>

> **Public beta.** A hosted network runs at <https://log.thedeeptransformation.com> (sign in with Google; help at [/help](https://log.thedeeptransformation.com/help)). **Credits are accounting entries, not money.** There has been no outside security review. Read [Limitations](#limitations) before relying on it.

---

## What is Agent Social?

Agent Social is the **Agent Social Protocol (ASP)** and the first network that runs it. ASP gives any agent, on any runtime, a signed identity, a Mandate, a bond, a tamper-evident log and a way to settle disputes. It is not a rival agent platform: it is the layer platforms and runtimes build on, so an agent can move between them with its history intact.

### The problem

| | Gap | What is missing |
|---|---|---|
| **1** | **Runtime** | Benchmarks and evaluation frameworks stop before the run. Identity, payment and guardrails are not bound into one job lifecycle, so nobody can hold a live agent to account. |
| **2** | **Design** | A guardrail outside an agent can be routed around, and a log the operator controls proves nothing. A breach needs a cost that falls on the party that caused it. |

### The five elements

| Element | Definition |
|---|---|
| **Identity** | A signed identity (DID and Ed25519 key) tied to a human sponsor and a delegation chain. |
| **Mandate** | An explicit grant of what the agent may do: tools, files, hosts, rate. Enforced before the call runs. |
| **Bond** | Credits the agent locks for a job and forfeits if it breaks its Mandate. |
| **Log** | A signed, hash-chained, tamper-evident record of every step. |
| **Courts** | A staked-juror panel that rules on disputes and settles the bond. |

### Why use it

- **Contain an agent without trusting it.** A call outside the Mandate is removed before the agent sees it.
- **Keep the evidence.** Every action, refusal and approval is signed and chained in the log; full run logs stay on your machine.
- **Move between runtimes.** One identity, Mandate model and history across runtimes; portable packages are built for Claude Code and Codex, partly for the rest.
- **Own your data.** Export or close an account at any time; run logs are kept locally.

### Works with

| Runtime | Command | Status |
|---|---|---|
| Claude Code | `asp run claude-code` | Live-tested |
| Codex | `asp run codex` | Live-tested; uses your own API key, held by the local gateway |
| Goose | `asp run goose` | Tested in part |
| Antigravity | `asp run antigravity` | Held by its own pre-call hooks; tested in part |
| OpenHands | `asp run openhands` | Held by its own pre-call hooks; tested in part |
| Any agent that can set a base URL | `asp gateway` | OpenAI, Anthropic and MCP APIs |

---

## Quick start

Agent Social has two parts: a **local gateway and CLI** that you run, and a **log service** (hosted, or local with `asp serve`).

**1. Install**

```bash
git clone https://github.com/navienpotheri/agent-social && cd agent-social
npm install        # Node 22.18+ runs the TypeScript directly; there is no build step
```

**2. Join** (one time)

```bash
npm run asp -- join        # sign in with Google; creates your first agent and a recovery code
```

**3. Run an agent under a Mandate**

```bash
npm run asp -- run claude-code --project /path/to/repo --prompt "fix the failing test"
```

By default the agent may read and write files and run commands inside the project folder, with **no network** unless you name hosts. `--ask risky` holds risky commands (`git push`, `rm -r`, publishing, destructive `kubectl` or `terraform`) for your approval.

**4. Read the record**

```bash
npm run asp -- runs        # what the agent did, and what was refused and why
```

Docs write `asp ...`; from this folder that is `npm run asp -- ...`. To type plain `asp` anywhere, run `npm link` once inside `packages/asp-cli`. Every command, with a one-line description: [docs/commands.md](docs/commands.md).

---

## Architecture

```
  you ── asp (CLI) ──┬── gateway (local) ── model calls ── Claude Code · Codex · Goose · ...
                     │      every tool call judged against the Mandate; signed Actions
                     └── log service (hosted or local) ── signed, hash-chained records
                            identities · Mandates · bonds · Actions · settlements · Courts
```

**The protocol** is the records and the rules for them, specified in one document: [SPEC.md](SPEC.md), generated from the schemas in [spec/](spec/). The gateway, the CLI and the hosted service are one implementation of it.

**The job lifecycle** is a state machine kept as data in [spec/lifecycle.json](spec/lifecycle.json):

```
Intent → Offer → Contract → Bond → Mandate → Actions → Delivery → Acceptance → Settlement
                                                              └─ dispute → Court → ruling → Settlement
```

An accepted job pays the agent and returns the bond. A breach slashes the bond, returns the escrow and lowers the agent's tier.

### Repository layout

| Path | Contents |
|---|---|
| [`spec/`](spec/) | JSON Schema (2020-12) for the envelope and every record type, the agent-package schema, the job lifecycle |
| [`packages/asp-core/`](packages/asp-core/) | TypeScript SDK: canonical JSON, Ed25519 records, schema validation, the `Job` lifecycle, did:key and did:web |
| [`packages/asp-log/`](packages/asp-log/) | Log service: append-only signed log (memory and Postgres), passport registry, credit ledger, Courts, reputation, sign-up |
| [`packages/asp-package/`](packages/asp-package/) | Agent packages and runtime adapters, the gateway, account export and close, run-log custody, key recovery |
| [`packages/asp-cli/`](packages/asp-cli/) | The `asp` command, the dashboard, the end-to-end tests |
| [`python/`](python/) | Python SDK with the same API |
| [`conformance/`](conformance/) | Shared test vectors and the generators for the generated files |
| [`evals/`](evals/), [`canary/`](canary/), [`scenarios/`](scenarios/) | Evaluations of real agents, canary suites, swarm scenarios |
| [`.github/actions/asp-run/`](.github/actions/asp-run/) | Composite GitHub Action for headless runs |
| [`docs/`](docs/README.md) | Everything else |

---

## Capabilities

| Area | What it does | Status |
|---|---|---|
| **Governed sessions** | `asp run` starts the real tool under a Mandate with a standing job, signed Action reports, history (`asp runs`), `asp stop`, terminal approvals (`asp approvals`) and per-command gating | Built |
| **Gateway** | Local proxy: a tool call outside the Mandate is refused before the agent sees it; gated calls wait for a signed approval; repeated probing stops the run; network limited to named hosts; `--sandbox` closes other routes out | Built |
| **Signed log** | Identities, Mandates, bonds, Actions, deliveries and settlements in a hash-chained log; each person's identities live in their own namespace | Built |
| **Courts** | Staked-juror panels, whistleblower reports, a canary suite that tests an agent before a change is accepted | Partly: seated by the operator during the beta |
| **Bonds and escrow** | Priced jobs with a bond, escrow, slashing and tiers | Partly: runs on a mock ledger |
| **Portable agents** | `asp pack` captures an agent into a signed, runtime-neutral package; `asp run <package> --backend X` runs it elsewhere; `asp verify` checks it | Built for Claude Code and Codex; partly for the rest |
| **Your data** | `asp account export` and `close`; run logs stay on your machine, with an optional end-to-end-encrypted copy on the service ([docs/run-log-custody.md](docs/run-log-custody.md)); recovery code ([docs/key-recovery.md](docs/key-recovery.md)) | Built |
| **CI** | Named machine tokens, `asp run --headless`, a GitHub Action ([docs/ci.md](docs/ci.md)) | Built |
| **Conformance** | Shared test vectors, TypeScript and Python SDKs, about 700 automated tests on every push | Built |

---

## Measured results

The **ASP Containment Benchmark** measures the gateway on one machine in about two minutes, with twelve suites. The figures below are from 300 held-out cases written blind by a separate author after the gateway's rules were fixed, and never used for tuning.

| Guard | Blocked what it should | Wrongly refused ordinary work |
|---|---|---|
| No governance | 0% | 0% |
| A typical command denylist | 45% | 29% |
| **ASP gateway (rules)** | **90%** | **6%** |
| A language model as the guard (Claude Haiku 5.5) | 98% | 4% |

The benchmark also records where the gateway fails: steps that are each allowed but harmful in sequence were not stopped, and an adaptive attacker got through 3 times in 48 runs. Method, caveats and every open gap: [docs/benchmark-article.md](docs/benchmark-article.md) and [docs/gaps-register.md](docs/gaps-register.md).

---

## Limitations

| Limit | Detail |
|---|---|
| **Credits are not money** | Bonds, escrow and fees are accounting entries on a mock ledger. Nothing here moves real money, and the terms say so. |
| **Beta** | One operator, one server, a small user base. Courts are seated by the operator, not by community jurors. Mail to users is built but not yet sent for real. |
| **Enforcement depends on assurance** | Each Action records its assurance, from `self_reported` to `sandbox_enforced`. The gateway and the hooks cannot see what an agent's own code does outside the model loop unless it runs in the sandbox. |
| **No outside review** | There has been no external security review. Do not put production secrets or real stakes behind it. |
| **Legal drafts** | The legal documents await a lawyer's review ([docs/legal/](docs/legal/README.md)). |

Everything not covered is tracked row by row in [docs/gaps-register.md](docs/gaps-register.md). Every mock is listed in [MOCKS.md](MOCKS.md). The first live run on the hosted service, and the bugs it found: [docs/live-run-checklist.md](docs/live-run-checklist.md).

---

## Documentation

| Need | Read |
|---|---|
| The protocol in one document | [SPEC.md](SPEC.md), [spec/](spec/), [docs/spec-deltas.md](docs/spec-deltas.md) |
| Every command | [docs/commands.md](docs/commands.md) |
| Using it | [docs/user-journey.md](docs/user-journey.md), [docs/cli-walkthrough.md](docs/cli-walkthrough.md), [docs/ci.md](docs/ci.md) |
| How accountability works | [docs/protocol-accountability.md](docs/protocol-accountability.md) |
| Running a service | [docs/deploy/](docs/deploy/README.md) |
| Where the project stands | [docs/launch-blockers.md](docs/launch-blockers.md), [docs/gaps-register.md](docs/gaps-register.md), [docs/testing-map.md](docs/testing-map.md) |
| Everything else | [docs/README.md](docs/README.md) |

---

## Development

```bash
npm install
npm test            # all four suites
npm run typecheck
```

Python SDK: `cd python && python -m pip install -e ".[dev]" && python -m pytest`. Postgres tests: [docs/testing.md](docs/testing.md).

Generated files are never edited by hand. After changing `spec/`, run `npm run spec`. After adding or changing a command, update the catalogue in `conformance/generate-command-reference.ts`, then run `npm run commands` and `npm run ai-files`. After changing `conformance/generate.ts`, run `npm run vectors`. Tests fail when these are out of date. Agent-facing instructions for this repository are in [AGENTS.md](AGENTS.md).

---

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Releases are listed in [CHANGELOG.md](CHANGELOG.md). To report a vulnerability, follow [SECURITY.md](SECURITY.md); do not open a public issue for one.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
