# Documentation

Start here. The root [README](../README.md) is the front page; this is the map of everything else, grouped by who it is for.

## The protocol

What ASP is, and how to implement it.

| Document | What it is |
|---|---|
| [../spec/](../spec/) | The machine-readable spec: JSON Schemas for the envelope and every record type, the agent-package harness, and `lifecycle.json` (the job state machine as data) |
| [protocol-accountability.md](protocol-accountability.md) | Part 2 of the protocol: Mandate, escrow, bonds, Courts, jurors, slashes and transfers, and why |
| [spec-deltas.md](spec-deltas.md) | The change log of the spec and the build: every change since v0.2, one row each (S1 onward), newest last |
| [gateway-design.md](gateway-design.md) | The gateway and the generic adapter: how a tool call is judged against a Mandate |
| [ladder.md](ladder.md) | The stages of the protocol and the network, and what each adds |
| [stage-3-plan.md](stage-3-plan.md) | Accountability when many agents act at once (planned) |
| [continual-learning-loop.md](continual-learning-loop.md) | How an agent improves after a run, and what the principal gets |
| [../conformance/](../conformance/) | Shared test vectors any implementation can check itself against |

## Using it

For a person running agents.

| Document | What it is |
|---|---|
| [user-journey.md](user-journey.md) | What signing up gives a person and their agents, end to end |
| [live-beta-flow-1.md](live-beta-flow-1.md) | From the web page to a first run |
| [cli-walkthrough.md](cli-walkthrough.md) | The protocol by hand: identities, packages, a job from intent to settlement, a dispute |
| [ci.md](ci.md) | Running an agent in CI or on a schedule, and the GitHub Action |
| [key-recovery.md](key-recovery.md) | If you lose a key |
| [run-log-custody.md](run-log-custody.md) | Where run logs live, who can read them, and how a court is given one |
| [provider-terms.md](provider-terms.md) | Model providers' terms: your keys, your sign-ins, and the gateway |
| [model-matrix.md](model-matrix.md) | Which models call tools reliably under the gateway |

## Running a service

For an operator.

| Document | What it is |
|---|---|
| [deploy/README.md](deploy/README.md) | Deploying the log service: the setup script, Google sign-up, mail, operating it |
| [deploy/court.md](deploy/court.md) | Running the court during the beta |
| [legal/README.md](legal/README.md) | The terms of use and privacy notice (drafts for a lawyer) and what the operator must do |

## Where the project stands

For contributors, reviewers and anyone judging how far along it is.

| Document | What it is |
|---|---|
| [launch-blockers.md](launch-blockers.md) | What stands between the protocol and a public beta, and progress against each item |
| [gaps-register.md](gaps-register.md) | Every gap, with what protects you today and what would close it; rows are never deleted |
| [live-run-checklist.md](live-run-checklist.md) | What was and was not tried live, what was faked, and the bugs the live runs found |
| [../MOCKS.md](../MOCKS.md) | Every mock or placeholder |
| [backlog.md](backlog.md) | Known work not yet scheduled |
| [implementation-notes.md](implementation-notes.md) | How the build works where the spec is silent |
| [build-status.md](build-status.md) | The detailed account of the first build slices |
| [testing.md](testing.md) | Running every suite, including Postgres and Python |
| [github-page.md](github-page.md) | What the repository page should say, and the release check |
