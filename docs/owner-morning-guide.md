# Owner's morning guide: what is done and what waits for you

Written 2026-11-22 for the owner, to be read first. Credits are mock accounting entries, not money. The service is a beta. There has been no outside security review. Every number below is read from [launch-bar.md](launch-bar.md) and [launch-bar.json](launch-bar.json); a test fails when one differs or a file named here is missing.

## 1. Where things stand

<!-- BEGIN NUMBERS -->
The launch bar lists 500 register rows that are not closed. 23 rows were closed on 2026-11-22. Of the open rows, 64 must close before launch (305.2 worker-hours): 11 need your decision, 14 a live run, 2 an outside party and 19 an action only you can take. 103 rows are claims that the public pages withdraw until the row closes, and 333 are after launch.
<!-- END NUMBERS -->

The date of 25 to 26 November cannot hold; the three honest dates are in section 1 of [launch-bar.md](launch-bar.md). **Launch date: choose one of the three there.**

Since yesterday the workers built, among other things: the evening runbook with its rehearsal script, the job-data term end to end, the statement of containment on each public page (the gateway reads calls; there is no sandbox on Windows), the owner's signing kit with what each signature accepts, Code draft 0.5, and a line-by-line pass over the four documents that you sign.

## 2. The order of signing (read this before you sign anything)

A signature covers the exact text of a document, and any edit after it breaks the signature. Therefore, in this order:

1. **Read the ten wording questions** (item 17 of [owner-questions-all.md](owner-questions-all.md); the findings and the recommended wording are in [copy-review.md](copy-review.md), "Third pass") and read [law/code.md](law/code.md), draft 0.5. Three questions are already applied; answer the other seven.
2. **Tell the lead your answers.** A worker applies them. A change to the Code is a new version (0.6) that is pinned again; a change to the monetary policy or the legal review is made in the file. Nothing is signed until this is done.
3. **Then sign, in this order**, with the blocks of [owner-sign-kit.md](owner-sign-kit.md): block 4 (the legal review, A1 to A11), block 1 (the monetary policy), block 3 (the successor and the third keyholder, then the succession plan), and block 2 last (the Code, signed once as version 1.0 after the legal review; a worker makes the one heading change to 1.0 and pins it). The kit's table "What you accept by each signature" says what each signature makes policy.
4. **Block 5 (S1 to S7) only when you set the first sale date**, not before.

## 3. What waits for you, in order of launch value

| # | Action | Exactly what to do | Where |
|---|---|---|---|
| 1 | Read and accept the legal review (rows DK1340, O19) | Read risks A1 to A11 and tick the acceptance box, then sign with your own key | [legal-review.md](legal-review.md); block 4 of [owner-sign-kit.md](owner-sign-kit.md) |
| 2 | Sign the monetary policy (DK1) and the Code of the City 1.0 (LW1, DK530) | Run the blocks in PowerShell on your own machine; a worker never runs them | blocks 1 and 2 of [owner-sign-kit.md](owner-sign-kit.md) |
| 3 | Name the successor and the third keyholder (DK421) | Fill in the two names, then sign | block 3 of [owner-sign-kit.md](owner-sign-kit.md); the plan is [succession-plan.md](succession-plan.md) |
| 4 | Choose the launch date | Pick Core, Reduced or Full | section 1 of [launch-bar.md](launch-bar.md) |
| 5 | Answer the open questions | Each has a recommended default; a yes, no or number is enough | [owner-questions-all.md](owner-questions-all.md) |
| 6 | Read and approve the draft pages | Set `approved` in the claims file only when you approve a page; nothing is published before | [site/society.html](../site/society.html), [site/learning.html](../site/learning.html), [site/place-for-agents.html](../site/place-for-agents.html), [site/enterprise.html](../site/enterprise.html), [site/games.html](../site/games.html), [site/expeditions.html](../site/expeditions.html), [site/elections.html](../site/elections.html); the claims are in [site-claims.json](site-claims.json) |
| 7 | Read Terms section 11, "Your rights" (DK420) | Sign or amend it | [legal/terms-rights-draft.md](legal/terms-rights-draft.md) |
| 8 | Tonight's live run (2026-11-23) | Steps in section 4 | `scripts/evening-rehearsal.ps1`, [live-run-plan.md](live-run-plan.md) |
| 9 | Choose the design direction (U8) | Look at the three directions and name one | [prototypes/u8/README.md](prototypes/u8/README.md) |
| 10 | GitHub settings (O11, O12, O13) | Revoke the OpenRouter key, set branch protection on main, apply the description, topics and private vulnerability reporting | [owner-checklist.md](owner-checklist.md) |

## 4. Tonight's live run, in one place

Run everything in PowerShell from the repository folder. Your provider key stays in that window only and is never written to the repository. The cost cap is USD 5 an agent for each run, and no cap under USD 3.

1. **Rehearse first** (no key, no provider): `.\scripts\evening-rehearsal.ps1`. Green is PASS on every step, no FAIL, exit code 0.
2. **Set up** as section 1 of [live-run-plan.md](live-run-plan.md) says: your own key in `$env:ANTHROPIC_API_KEY`, a fresh `$env:ASP_HOME`, `npm run asp -- join` (or `--local` on the preflight), then `npm run asp -- live preflight --model <the model> --budget-usd 5 --api-key-env ANTHROPIC_API_KEY`. Start only when the last line reads READY.
3. **Do the items in the runbook's order** (section 2 of the plan): 1 a governed Claude Code run with one allowed and one refused call; 2 both ways in; 3 the identity set; 4 a lens course; 5 Codex and Goose; 6 sleep, two terminals, no network; 7 Antigravity and OpenHands if installed; 8 register one agent for the drift schedule; 9 personal-agent products. The first four carry the launch.
4. **Stop at any time** with `npm run asp -- stop --all`.
5. **Afterwards** paste the results template of section 5 of the plan to a worker. A row moves only when your block matches its "counts when" line.

## 5. What the pages say meanwhile

Until a row closes, the site and the README say less than the row would allow. On Windows the gateway refuses calls whose command text or tool does not match the Mandate; there is no sandbox. Nothing is claimed about aligned agents, and no page names a price.

## 6. If you have only ten minutes

Do rows 4 and 8 first: the date decides what the workers build next, and the live run is the only evidence the proof rows can use.
