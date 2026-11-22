# Owner's morning guide: what is done and what waits for you

Written 2026-11-22 for the owner, to be read first. Credits are mock accounting entries, not money. The service is a beta. There has been no outside security review. Every number below is read from [launch-bar.md](launch-bar.md) and [launch-bar.json](launch-bar.json); a test fails when one differs or a file named here is missing.

## 1. Where things stand

The launch bar lists 506 register rows that are not closed. 17 rows were closed on 2026-11-22. Of the open rows, 65 must close before launch (308.2 worker-hours): 11 need your decision, 14 a live run, 2 an outside party and 19 an action only you can take. 105 rows are claims that the public pages withdraw until the row closes, and 336 are after launch. The date of 25 to 26 November cannot hold; the three honest dates are in section 1 of [launch-bar.md](launch-bar.md). **Launch date: choose one of the three there.**

Since yesterday the workers built, among other things: the evening runbook with its rehearsal script, the job-data term end to end, the statement of containment on each public page (the gateway reads calls; there is no sandbox on Windows), the owner's signing kit and the legal review.

## 2. What waits for you, in order of launch value

| # | Action | Exactly what to do | Where |
|---|---|---|---|
| 1 | Read and accept the legal review (rows DK1340, O19) | Read risks A1 to A11 and tick the acceptance box, then sign with your own key | [legal-review.md](legal-review.md); block 4 of [owner-sign-kit.md](owner-sign-kit.md) |
| 2 | Sign the monetary policy (DK1) and the Code of the City 1.0 (LW1, DK530) | Run the blocks in PowerShell on your own machine; a worker never runs them | blocks 1 and 2 of [owner-sign-kit.md](owner-sign-kit.md) |
| 3 | Name the successor and the third keyholder (DK421) | Fill in the two names, then sign | block 3 of [owner-sign-kit.md](owner-sign-kit.md); the plan is [succession-plan.md](succession-plan.md) |
| 4 | Choose the launch date | Pick Core, Reduced or Full | section 1 of [launch-bar.md](launch-bar.md) |
| 5 | Answer the open questions | Each has a recommended default; a yes, no or number is enough | [owner-questions-all.md](owner-questions-all.md) |
| 6 | Read and approve the draft pages | Set `approved` in the claims file only when you approve a page; nothing is published before | [site/society.html](../site/society.html), [site/learning.html](../site/learning.html), [site/place-for-agents.html](../site/place-for-agents.html), [site/enterprise.html](../site/enterprise.html), [site/games.html](../site/games.html), [site/expeditions.html](../site/expeditions.html), [site/elections.html](../site/elections.html); the claims are in [site-claims.json](site-claims.json) |
| 7 | Read Terms section 11, "Your rights" (DK420) | Sign or amend it | [legal/terms-rights-draft.md](legal/terms-rights-draft.md) |
| 8 | Tonight's live run (2026-11-23) | Start with the rehearsal script, then follow the runbook | `scripts/evening-rehearsal.ps1`, [live-run-plan.md](live-run-plan.md) |
| 9 | Choose the design direction (U8) | Look at the three directions and name one | [prototypes/u8/README.md](prototypes/u8/README.md) |
| 10 | GitHub settings (O11, O12, O13) | Revoke the OpenRouter key, set branch protection on main, apply the description, topics and private vulnerability reporting | [owner-checklist.md](owner-checklist.md) |

## 3. What the pages say meanwhile

Until a row closes, the site and the README say less than the row would allow. On Windows the gateway refuses calls whose command text or tool does not match the Mandate; there is no sandbox. Nothing is claimed about aligned agents, and no page names a price.

## 4. If you have only ten minutes

Do rows 4 and 8 first: the date decides what the workers build next, and the live run is the only evidence the proof rows can use.
