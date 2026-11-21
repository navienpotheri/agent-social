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

- `sit-course` (session local_44b65671, branch refs/heads/claude/sit-course-ffd576, worktree `../sit-course-ffd576`): FINISHED, reported 2026-11-21. Commits `3ae170c` (DK1342: `asp academy lens sit`, service routes, six front-door tools, tests), `3db2bc7` (DK1344: the `self_hire` rule, S1300, related-party label, both SDKs, vectors) and `4e64208` (it merged the lead branch). Its own full gate was green (core 692, log 692, package 414, cli 766 of 767 with none failing, Python 815) before that merge; after the merge only the docs tests were re-run. Both rows are PARTIAL (DK1342 needs a live run with a real model agent and DK1400, the publishing of a lens course into a real log; DK1344 needs DK1405, the journey view showing the related-party label). New rows DK1400-1405. NOT merged into the lead branch: the owner has to say yes (record it here as the line `MERGE-APPROVED: sit-course`). After the merge: full gate, then push.

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

MERGE-APPROVED: sit-course (owner said yes on 2026-11-21)

## Update 2026-11-21 (after the owner said yes to the merge)

- `claude/sit-course-ffd576` is MERGED into the lead branch (merge commit 22a323d). Conflicts resolved: the register, scope and testing-map tables (the worker's DK1342 and DK1344 rows kept, mine kept elsewhere), `packages/asp-cli/src/cli.ts` (the public route list: the worker's line with the journey routes first) and the generated site files (regenerated). Generated files regenerated with spec, vectors, commands, ai-files; typecheck clean.
- Also on the lead branch, not pushed: the journey view (DK1300 closed, DK1345 open), the page box 'Not on this page yet' with the backlog row for each gap, rows DK1346 (direct messages) and DK1347 (sponsor token cost).
- The full gate on the merged tree was started in the background; its result is recorded below when read. Push to claude/open-forum only if every suite is green (the 23:30 task does this, or the lead on the owner's go).

## PUSHED 2026-11-21: claude/open-forum is now 22bb971

The lead branch (with the journey view DK1300, the sit-course merge DK1342 and DK1344, the not-on-this-page box, DK1345 to DK1348, the live-run logs and the audit notes) went to GitHub as a fast-forward of claude/open-forum (672320f to 22bb971), after the full gate on the merged tree: core 692 of 692, log 692 of 692, package 418 of 418, command line 784 of 785 with none failing, Python 815, typecheck clean. The row added after the gate (DK1348) is docs only; the doc tests and the typecheck passed on it.

Still local and not pushed: this note itself; the saved branches in section 3 (each needs a merge or drop decision, DK797); the two worktrees `sit-course-ffd576` and the lead's (their commits are on open-forum now). The deck branch claude/mystifying-sinoussi-fe1ea3 was pushed on 2026-11-21 (0b23f1e) with the owner's yes. The scheduled push task agent-social-push-later is no longer needed and is disabled.

## PUSHED 2026-11-21 (second push): claude/open-forum is now 29f359c

The launch-bar worker's first block (the launch bar DK1312 drafted, DK1405 and DK1303 closed) was merged into the lead branch (no conflicts) and pushed as a fast-forward (22bb971 to 29f359c) after the full gate: core 692 of 692, log 694 of 694, package 418 of 418, command line 791 of 792 with none failing, Python 815, typecheck clean. The worker continues on its own branch (claude/launch-bar-c53fce) with the next rows; each of its reports is merged, gated and pushed the same way.
