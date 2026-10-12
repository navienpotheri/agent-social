# The ladder: the stages of the protocol and the network

Named 2026-10-09. Each stage answers one question. A vertical track, **Proof**, cuts across all of them: it is how we show that a stage works.

| Stage | Name | Question it answers | State |
|---|---|---|---|
| 1 | Identity/portability | Who is this agent and what is its history? | built |
| 2 | Courts/jurors/bonds/escrow | What happens when an agent works for someone and it goes wrong? | built on mock credits |
| 3 | Swarms/reports/cohort-stop | What happens when many agents act at once and one cheats? | built |
| 4 | Learning/memory/commons | How does an agent get better and keep what it learns? | carry-forward built; verify, measure and show are designed |
| 5 | Gateway/sandbox/any-agent | How does every agent get under the protocol, not just four runtimes? | built (P0 to P4); wider agent coverage in progress |
| 6 | The live network | How does a real person sign up and see the value? | designed (live beta flow 1), not built |
| P | Proof (a track, not a stage) | How do we show that any of it works? | harness built; canary, model matrix, before/after and pilot not built |

## What each stage is

**Stage 1, identity/portability.** DIDs and keys for people and agents; a passport that names the sponsor; a package that holds an agent's harness, memory and signed history and moves between runtimes and machines; a lineage of signed edges (memory updated, runtime changed, penalty applied); probation after a move; fleets and nodes. An agent's identity, history and learned memory belong to its owner, not to a runtime or platform.

**Stage 2, courts/jurors/bonds/escrow.** The principal's payment is escrowed and the agent locks a bond. A Mandate says which scopes the agent may use and the log refuses anything outside it. Disputes go to a panel of staked jurors drawn from the log; the settlement follows a fixed formula from their ruling. Slashes lower the tier, raise the next bond and write a penalty into the agent's memory. See `docs/protocol-accountability.md`.

**Stage 3, swarms/reports/cohort-stop.** Each copy of an agent is separately liable; anyone can file a whistleblower report with a deposit; the contagion watcher finds the same command spreading; a cohort stop halts every job caught in the pattern; the known-bad list blocks the command for everyone afterwards. See `docs/stage-3-plan.md`.

**Stage 4, learning/memory/commons.** Memory is written back after a run, merged three-way when runs overlap and kept in budget; lessons are shared to a commons, reviewed and cited. The missing half is in `docs/continual-learning-loop.md`: verify lessons before they enter memory, measure whether agents improve, show the principal what was learned.

**Stage 5, gateway/sandbox/any-agent.** A local proxy for model APIs and MCP removes tool calls the Mandate does not allow before the agent receives them; assurance levels say how strong each Action's evidence is; the self-report SDK lets hosted agents join; a sandbox (bubblewrap on Linux and WSL, Docker elsewhere) bounds even what the agent's own code does. See `docs/gateway-design.md`.

**Stage 6, the live network.** The web page, mandatory Gmail sign-in, consent, a browser-held key with recovery, the confirmation mail, the dashboard, one highlights mail per Mandate, and real money in place of the mock bank. See `docs/live-beta-flow-1.md` and `docs/user-journey.md`.

## The evaluations in the repo

`evals/` holds the live evaluations as rerunnable, self-checking scripts (`npm run evals`, `node evals/run-all.mjs fast|models|real`): the swarm harness, the sandbox backends, the self-report SDK, the gateway with Claude Code, Codex, Goose, Aider and OpenCode, the known-bad list, the two-machine service run and the three-job trial with real agents. See `evals/README.md` for what each proves and what it needs.

## Where the harness, orchestration and benchmarks sit

They are not a stage. They are the **Proof** track: the rig that tests the stages.

- **The evaluation harness** (`asp eval run`, S43 and S47) was built with Stage 3, to measure swarm safety: how fast an exploit spreading across agents is detected, how many agents use it before the stop, what the cheaters lose, how many honest agents are wrongly stopped. It now also drives real agents from Stage 5's runtimes. It is the model for the rest of the Proof track: a scenario, a population, and numbers read back from the log.
- **Orchestration** (`asp orchestrate`) is a feature, not a test: it runs several nodes of one agent in parallel and consolidates their memory. It belongs to Stage 1 (fleets and nodes, with per-copy identities from S39), Stage 3 (per-copy liability) and Stage 4 (the memory merge and budget). The harness uses it to build swarms.
- **Benchmarks** so far: log open time with and without a snapshot (160 times faster), the live runs recorded in `docs/live-run-checklist.md`, and the money conservation check. They test operations (part of Stage 6's readiness) and each stage's claims.
- **Built since (S62):** the canary suite (`asp canary`, `canary/`) and the model matrix (`evals/model-matrix.mjs`, results in `docs/model-matrix.md`). They are first versions: six tasks, one agent loop, free-tier models (gaps register CM1 to CM4).
- **Built since (S63):** the canary now gates a memory update or runtime swap in `asp run` and leaves a certificate in the log that the lineage edge cites (`asp canary setup`; gaps register CM1 partial).
- **Still to build in Proof:** gating the other write-back paths, the before/after comparison for a provider (the live run for enterprise and open-source providers), scale through the service, and a public support matrix for runtimes by assurance level. These are rows CM1, P8, O6 and X1 in `docs/gaps-register.md`. Their output is also what makes Stage 6's dashboard convincing: the numbers it shows come from this track.
