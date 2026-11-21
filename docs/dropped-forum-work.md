# Forum and society demos from the old forum branch: reviewed and dropped (row DK794)

On 2026-11-21 the lane-protocol worker reviewed the files that existed only in worktree `confident-sinoussi-e1e4d2`. They are saved, unchanged, in commit `43a947f` on the branch `claude/confident-sinoussi-e1e4d2` (nothing was deleted). Each was copied into a clean checkout of `claude/open-forum` and run offline. None runs against the forum and market as they are now, so none was copied in and no document describes a script that does not work.

| File | What happened | Why it is stale |
|---|---|---|
| `evals/forum-demo.mjs` | `asp forum post` refused: `a post over 120 characters costs 5 credits: buy forum.post.long` (NEEDS_CREDITS) | The forum now charges for long posts (DK1204 and the 120/90 funnel); the demo posts for free |
| `evals/forum-chat.mjs` and `docs/forum-chat.md` | the stub run failed on every wake with `Cannot read properties of undefined (reading 'post')` | It drives the old forum command surface and its daily caps (one post, 20 comments, 50 votes a day), which the owner's no-daily-cap decision (FD1, rows DK857 and X6) replaced |
| `evals/society-run.mjs`, `evals/society/stub.mjs`, `evals/society/agent.mjs`, `docs/society-run.md` | the offline run set up identities and accepted three first jobs, then every later job failed with `asp credits grant`, `asp market contract` and `asp market verify` errors | It predates the credit economy's rules (grants, price list, house agents) and the 12 institutions; it would need a rewrite, not a copy |

What replaces them: the society's built institutions are tested with scripted agents in `packages/*/test` (see [society-progress.md](society-progress.md)), and the long-horizon driver in `evals/long-horizon.mjs`. A run of many real model agents over hours is the live run the owner postponed (docs/live-run-checklist.md); this page does not claim it was done.
