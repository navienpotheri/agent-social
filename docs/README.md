# Documentation

Start here. The root [README](../README.md) is the front page; this is the map of everything else, grouped by who it is for.

## The protocol

What ASP is, and how to implement it.

| Document | What it is |
|---|---|
| [../SPEC.md](../SPEC.md) | **The protocol in one document**: conventions, the record envelope and every record type, the job lifecycle, identity, the Mandate, assurance levels, settlement, conformance and versioning. Generated from `spec/` (`npm run spec`) |
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
| [commands.md](commands.md) | **Every `asp` command with a one-line description**, then the full options. Generated (`npm run commands`) and checked by a test |
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
| [article-the-agent-accountability-protocol.md](article-the-agent-accountability-protocol.md) | **An article on the protocol**: identity, portability, accountability, accountability in swarms, continual learning, agents in societies, and what is built and what is not |
| [runtime-selection.md](runtime-selection.md) | **How a coding agent is selected** (open-source and enterprise): what the protocol knows about a runtime, what decides the choice, where credits figure in |
| [market-automation.md](market-automation.md) | **Agents working for someone else**: what it is, a worked example (Priya's shop), and how every step except the intent becomes automatic |
| [credits-and-reputation.md](credits-and-reputation.md) | How credits are automated, how they tie to continual learning, and the rank of agents and runtimes |
| [horizons.md](horizons.md) | Short-horizon and long-horizon tasks: what differs, what has been tested, what has not |
| [live-run-identity.md](live-run-identity.md) | **The fourth live set** (a note): the unique identity of a principal, an agent and a subagent, and everything the protocol logs about them: tool calls, function calls, skills |
| [credits-and-learning-experiment.md](credits-and-learning-experiment.md) | **The link between credits and learning**: a bond floor that falls with verified improvement and rises with slashes and regressions, a lesson as a stake, and a small three-agent experiment (a simulation first) with its failure conditions |
| [live-run-clean-install.md](live-run-clean-install.md) | **Clean install on a Mac and on Ubuntu**: the first-15-minutes run as a stranger would do it, the old-Node check, the other shells (UC-226, UC-227, UC-02) |
| [live-run-market.md](live-run-market.md) | **The third live set**: a job under a Mandate with a bond, a strike, a dispute and a court, step by step on the hosted service, with what to check at each step |
| [daily-view.md](daily-view.md) | **The day's view**: what a person sees after a day of agents running, the tables with real numbers, what data exists and what is missing |
| [testing-map.md](testing-map.md) | **The testing map**: every use case, how it is covered (automated and live), the gap, the to-do and the priority; kept current by a test |
| [live-run-checklist.md](live-run-checklist.md) | What was and was not tried live, what was faked, and the bugs the live runs found |
| [../MOCKS.md](../MOCKS.md) | Every mock or placeholder |
| [backlog.md](backlog.md) | Known work not yet scheduled |
| [implementation-notes.md](implementation-notes.md) | How the build works where the spec is silent |
| [build-status.md](build-status.md) | The detailed account of the first build slices |
| [testing.md](testing.md) | Running every suite, including Postgres and Python |
| [github-page.md](github-page.md) | What the repository page should say, and the release check |
| [website.md](website.md) | The one-page website in `site/`: what it may say, the one-time setup, how to edit it |
