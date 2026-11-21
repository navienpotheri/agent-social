# Push queue: everything saved locally and not yet pushed (kept by the lead, updated 2026-11-21)

The owner asked (2026-11-21) to save all work locally and push at a later time, because the working session spends the 5-hour credits. Pushing and the test runs cost little; the work does. Nothing below is lost: each item is committed on a local branch in this repository (`git branch` lists them). Rules that stay: push only `claude/open-forum`, only when every suite is green, never force; any other branch is pushed only with the owner's yes.

## 1. claude/open-forum (the one branch that is pushed)

- Remote and local tip: `672320f` (2026-11-20). Every suite was green when it was pushed.
- Not on it yet: the 6 commits below, all on the lead's branch `claude/sharp-dirac-595b53`. To push them: run the full gate on a quiet machine, then in `../open-forum` run `git merge --ff-only claude/sharp-dirac-595b53` and `git push origin claude/open-forum`.

| Commit | What |
|---|---|
| ad30c5c | audit note: the uncommitted work that was saved |
| 2f31f01 | live run log: market job and scripted course cohort |
| beaf218 | rows DK1342 (an agent cannot sit a course) and DK1343 (duplicate DK76 id) |
| d235d95 | live run log: independent hire, 400 starter credits, a slash, refusals; row DK1344 (self-hire) |
| 01ae197 | DK1300 journey module (packages/asp-log/src/journey.ts) and 11 tests in packages/asp-cli/test/journey.test.ts |
| c92a82f | DK1300 marked partial with what is built and what is not |
| (next commit) | DK1300 closed: the routes, the sponsor access rule, the page, `asp journey`, `asp society tail`, the front-door tools, docs/journey.md, 18 tests, the live check; DK1345 opened |

Last full gate on this branch (before the two DK1300 commits): core 690 of 690, log 685 of 685, package 414 of 414, command line 753 of 755 with one load-related failure (`DK1000: a long comment...` in forum-paid.test.ts; it passes alone) and one not counted, Python 813 passed. The typecheck is clean. The two DK1300 commits added code and tests; the journey tests pass (11 of 11); the full gate must be re-run before the push.

## 2. The worker's branch (running)

- `sit-course` (session local_44b65671, branch `claude/sit-course-ffd576`, worktree `../sit-course-ffd576`): building DK1342 (agents sit a course) then DK1344 (refuse a self-hire). Nothing committed yet at the time of writing (tip `672320f`). It must not push. When it reports, the lead merges, runs the gate and pushes.

## 3. Branches saved locally, each needing a decision (DK797)

| Branch | Saved as | Holds | Plan |
|---|---|---|---|
| claude/confident-sinoussi-e1e4d2 | 43a947f | old forum docs, demos, evals, gateway MCP edits (DK794) | compare each file with the current forum; take what is missing, drop what is superseded, write the reason |
| claude/great-vaughan-976ce6 | d2054cb | docs/society-design.md (DK795) | merge (docs only) |
| claude/worker-society-1112-1030 | b9e6d9b | older economy-supply, guard-monitor, credit-audit edits | compare with open-forum; drop if superseded, with the reason |
| claude/worker-product-1112-1043 | 8fa9260 | a product worker report | merge or archive |
| claude/insurance-design-9ba572 | ac07fe1 (already a commit) | insurance design, 4 files | merge (docs and design) |
| site-prompter-3, site-prompter-5, site-redesign-2 | 69c4f10, bc6a2a8, 7cfac35 and 2fa2aaf | small site edits (teleprompter, The Gap wording) | merge: the owner said yes on 2026-11-21 |
| claude/mystifying-sinoussi-fe1ea3 | 0b23f1e | a16z deck, demo-video scripts, handoff notes | ALREADY PUSHED as its own branch on 2026-11-21 (owner approved; the repository is public) |

Left untracked on disk, not in any commit: large videos and two deck PDFs in the mystifying-sinoussi worktree, a nested `agent-social/` folder there, `worker.log` files, `.claude-test-e.log` in the main folder. The four site worktrees (livewt, prompter-wt3, prompter-wt4, redesign-wt) differ only in line endings.

## 4. Open work in progress by the lead

- DK1300 (journey view): partial. Built: the module and tests. To build: the public and sponsor routes (sponsor view only for the tenant that owns the agent), feeding the forum in, the HTML page, `asp journey`, the front-door tool, a live tail for watching real agents, the live check. Then DK1301 (watch page), DK1302, the launch bar DK1312.
- The live run with real model agents (Academy course, market job, refusals): waits for DK1342.
- Merge conflicts to expect: docs tables (gaps-register, scope, spec-deltas, testing-map, run-queue). Keep both sides, dedupe ids, regenerate with `npm run spec|vectors|commands|ai-files`.

## 5. Local-only services and folders to know about

- No service is running (the local test services on ports 8791 and 8792 were stopped). Throwaway data is in the temp folder only.
- The lead's scratchpad holds the live-run scripts (marketjob.sh, independent_job.sh, slash_job.sh); not part of the repository.
