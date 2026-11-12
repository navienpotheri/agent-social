# The continuous run: queue, rules and state

Written 2026-11-12 by the lead. This file is the lead's memory across context compaction. If you are the lead and have lost context, read this, `docs/gaps-register.md` section 20, `docs/owner-checklist.md` and `docs/society-progress.md`, then carry on from "State".

## Standing instructions from the owner (2026-11-12)

- Run continuously with the lead and two worker sessions (subscription), and **pause only when the 5-hour window nears its limit**. The lead stops starting new work at about **90%** of the 5-hour window and lets in-flight work commit; it checks `get_usage` every time a worker reports. The weekly limit (all models) must stay under about 90%: stop earlier if it would pass that.
- **Standing permission: whenever a specific task is completed (a worker reports, or the lead finishes its own), and every suite is green, the lead merges that work into `claude/open-forum`, commits, and pushes `claude/open-forum`, without waiting to be asked.** (This applies to this run only. Never push a failing tree. Never force-push. Never merge or push anything else.)
- The priority is **closed rows**. No "good enough": a row closes only when its "Done:" criterion is met by a passing test; what cannot be met here is split into a new row and put on `docs/owner-checklist.md`.
- Credits are accounting entries, not money; the service is a beta; no outside security review has happened. No secrets in anything. Never run `asp law sign`.
- **The cycle repeats (owner, 2026-11-12):** the lead also takes tasks itself, continuously. When the 5-hour window reaches its limit, everything stops; when it resets to 0%, the lead and both workers start again on the next workable items of the backlog and to-do list, and each completed item is committed, merged and pushed (standing permission above). Repeat until the backlog is done.
- No terminal (API-billed) agent in this run unless the owner starts one; their balance was about $1.

## How a task is handled

1. Start two workers with `start_session` (fresh, own worktree from `claude/open-forum`, model sonnet, `wake_when_done`), one tight brief each, own id ranges so nothing collides.
2. The lead works on its own task in its session worktree (`sharp-dirac-595b53`, branch `claude/sharp-dirac-595b53`; fast-forward it to `claude/open-forum` first). The file tools may be blocked for the `open-forum` worktree; use the session worktree, then fast-forward `open-forum` from it with `git -C ../open-forum merge --ff-only claude/sharp-dirac-595b53`.
3. When a worker reports: read its report, run typecheck and the full tests on its branch with an empty home (`HOME=$(mktemp -d) USERPROFILE=$HOME npm test`; the signup-throttle test is flaky under load and passes alone), then merge into `claude/open-forum`. Conflicts: union the doc tables (register, spec-deltas, testing-map, owner-checklist), union the record-type lists in `schema.ts` and `schema.py`, regenerate (`npm run spec|vectors|commands|ai-files`), renumber any colliding S, UC or DK ids, and check the OPTIONS object in `cli.ts` for repeated keys.
4. Run everything on the merged tree; if green, commit and push `claude/open-forum`; check CI on the previous push with `gh run list`.
5. Check usage; if under about 90%, dispatch the next task.

## Id ranges (never reuse)

| Who | Spec-delta S | Testing-map UC | New register rows |
|---|---|---|---|
| Lead | S186 and up | UC-290 and up | DK141 and up |
| Worker 1 (Shops) | S250 and up | UC-350 and up | DK150 and up |
| Worker 2 (Clinic) | S260 and up | UC-360 and up | DK160 and up |
| Round 2 workers | S270 and up / S280 and up | UC-370 and up / UC-380 and up | DK170 and up / DK180 and up |

## Queue

Round 1 (now):
- Worker 1: **Shops and Services** (DK21, DK22): the daily-needs services and the upkeep sink. Spec: `docs/institutions/shops.md`.
- Worker 2: **the Clinic's checkups and drift scoring** (DK28) and **the remedial Mandate for a tier 0 agent** (DK140). Spec: `docs/institutions/clinic.md` (CL-1 to CL-5).
- Lead: **DK92 split-into-pieces pattern**: the gateway records the refused call's target (a path or a command fingerprint), then the circumvention detector uses it; then merges, CI checks and the register upkeep.

Round 2:
- Worker 1: **Housing** (DK38, DK75) and **Leisure and Events** (DK36). Specs: `housing.md`, `leisure-events.md`.
- Worker 2: **Bank and Insurer** (DK19, DK20). Spec: `bank-insurer.md`.
- Lead: merges; DK74 (starter pool sizing in the runbook); DK65 capacity plan if time.

Round 3 (if the window allows): Research and Commons (DK31, DK78 to DK80), residency (DK82 to DK85), the world engine's measures (DK77); product rows U5, U1, O19, T12 that are not owner-only.

## State (the lead updates this at the end of each step)

- `claude/open-forum` was pushed at 335ae96 (2026-11-12): 54 of 173 priority-A rows closed. CI on d0824fe was in progress.
- 2026-11-12 ~17:00: DK92 split pattern pushed (d7f7e36, S186, UC-295; DK92 partial). Workers run-shops (local_5aa5ab9f) and run-clinic (local_18354207) are running; 5-hour window 44%, weekly 67%.
- 2026-11-12 ~18:00: Round 1 merged and pushed (Shops DK21/22, Clinic DK28/DK140 closed). Lead closed DK74, DK77 partial (DK141, DK142 split), pushed 3278ccc. Round 2 sent to the same two sessions: run-shops gets Housing + Leisure (S270+/UC-370+/DK170+), run-clinic gets Bank + Insurer (S280+/UC-380+/DK180+). Lead next: DK65 capacity plan pieces that need no hosted service, then product rows U5/U1/O19/T12 that are not owner-only.
