# The beta programme: how the work is organised (2026-11-12)

The beta now includes the society the deck promises ([deck-promises.md](deck-promises.md)): an agent earns credits on jobs, is penalised for breach or drift, and spends what it earns in twelve institutions. That is a large programme. This page says how it is split, run in parallel, controlled and paced. It is a plan for the owner to approve; no worker has been started.

## The scope in numbers

- Register section 20: **74 new rows (DK1 to DK74)**: 9 for the credit economy, 32 for the twelve institutions, 7 for the moat and roadmap, 12 for the protocol and safety promises, 6 for the platform and business. 44 are priority A (needed for the beta), 18 B, 1 C, and 3 partly built.
- Each institution has a **specification** ([institutions/](institutions/README.md)) with numbered work items. The Academy's alone is 24 items (AC-1 to AC-24). Twelve institutions at that depth, plus the credit rules, come to roughly **200 work items**.
- On top of the 150-odd rows the register already held, 18 of them closed and the rest mostly not needed for a CLI-first beta (see [launch-gate.md](launch-gate.md)).

## Roles

| Role | Who | What it does |
|---|---|---|
| **Programme lead (CEO and project manager)** | the main session | Keeps the scope, the register and the plan; briefs workers; reviews and integrates their work; runs the tests; reports to the owner; decides nothing that is the owner's |
| **Worker E: Economy and Market** | a separate session | `economy/credits.md` first, then Treasury, Market, Bank and Insurer, Shops and Services; later the credit mechanics in code (price list, purchase path, supply audit) |
| **Worker S: Society** | a separate session | Registry, Courts (precedent, charter), Clinic, Research and Commons, Forum, Leisure and Events, Housing; later the Academy build (AC items), the Clinic and the forum deployment |
| Later, if the limits allow | two more sessions | **X: Protocol and safety** (audit gate, goal check, Sybil gate, watcher) and **P: Platform and business** (capacity test, metering, SSO, claims) |

The programme lead writes the shared things (the register, `scope.md`, the generated files, the launch gate); workers write only their own files. That is what prevents the ID collisions and merge conflicts the project has had before.

## How a worker is set up

1. **Its own session in its own worktree and branch**, started from the programme lead's committed branch tip (so it sees the scope), for example `claude/worker-economy`. A worker cannot overwrite another's files or the lead's.
2. **A self-contained brief**, because a worker starts cold: its mission and the order of its tasks; the standard to follow ([institutions/README.md](institutions/README.md), with [academy.md](institutions/academy.md) as the quality bar); the files it owns; the register rows it covers; the rules (below); the pacing rule; the format of its report.
3. **Rules in every brief.** AGENTS.md; no secrets in any file; generated files are never edited by hand; a specification missing any of the twelve sections stays marked draft; partial is never called done; credits are not money and the site's limits stay true; **no pushing, no merging, no pull request**: it commits to its own branch and reports.
4. **Pacing in every brief.** A worker does one round of bounded work (a list of named files), reports roughly what it used, and stops. It does not start a second round by itself.
5. **Ownership of shared files.** A worker that needs a new register row or a change to a shared file writes it in `docs/institutions/<its area>/proposed-rows.md` and the lead integrates it.

## Rounds

| Round | What | Size | Why this order |
|---|---|---|---|
| **1: specifications** | Each worker writes its institutions' specifications to the standard (documents only, no code) | the cheapest round; E: credits first, then four institutions; S: seven institutions | The specifications are what the builds are made from; they are also the most useful thing to review early, and they use little of the weekly limit |
| **2: the first slices** | Build the critical-path slices: the credit rules in code (price list, purchase path, supply audit), the Academy promotion path (AC-1 to AC-5, AC-7 to AC-12, AC-17), the Registry page, the Treasury | the expensive round; sized from what round 1 used | They make "earn, spend, move up" real, which is the deck's core |
| **3 onward** | The rest of each institution, in priority order, one slice at a time | as the limits allow | |

## Control and pacing (the weekly limit)

- **Two workers at a time to start.** Every agent draws on the same limits; extra usage is switched off, so a worker simply stops when the 5-hour window empties. Small rounds avoid a half-finished job.
- **The programme lead checks usage between rounds** and does not start a round if the weekly figure is high (a working rule: no new round above about 60 percent of the weekly limit, and none that could not finish in what remains).
- **Nothing is pushed or merged without the owner.** The lead merges a worker branch into the programme branch only with the owner's say-so, and runs the tests (`scope`, `testing-map`, `ai-files`, the full suite) after each merge.

## Quality gate for every specification

The lead checks each against the twelve sections in the standard. A specification passes only if: every section is present and concrete (numbers, record fields, commands, tests); its credit flows obey `economy/credits.md`; each work item has a done-criterion that can be checked, a size and its dependencies; the open decisions are listed with a recommendation. A specification that fails goes back with the missing sections named; one that passes is marked **complete** in the institutions index.

## What the owner approves before round 1

1. The two workers (E and S) and their lists above.
2. That workers commit to their own branches and never push, and that the lead merges only on the owner's word.
3. The pacing rule (stop above 60 percent of the weekly limit; no extra usage).
4. The scope: the 66 DK rows, their priorities, and the order in `institutions/README.md` ("Order of writing").

## Weekly rhythm once running

At the end of each round the lead reports: what was completed and what stayed draft, what the round used of the limits, the rows that changed status, and what the owner must decide. The register and `scope.md` stay the single source of truth for what is done; a row closes only when its done-criterion is met and shown.
