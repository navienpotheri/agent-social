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
- 2026-11-12 ~19:00: Round 2 merged and pushed at 52ebbba (Housing DK38/DK75, Leisure DK36, Bank DK19, Insurer DK20 closed; 90 rows closed). Round 3 sent: run-shops gets Research and Commons (DK31, DK78-80; S290+/UC-390+/DK190+), run-clinic gets residency (DK82-85; S300+/UC-400+/DK200+). 5-hour window was 79%, weekly 72%: no new work after about 90%; after the reset, continue the queue (product rows U5/U1/O19/T12, DK65 parts, DK92 stage 2, DK141/DK142).
- 2026-11-13 ~21:00 (after the 5-hour reset): merged and pushed DK31, DK78 (Worker 1), DK83, DK85 (Worker 2), then lead closed DK141 (1c78894). Workers running: run-shops on DK79/DK80, run-clinic on DK82/DK84. **The weekly limit is the binding one now: 79% (resets 2026-11-14 06:00Z).** Stop starting work at about 88% weekly; merge what the workers commit; the next round starts after the weekly reset. Lead queue for then: DK92 stage 2, DK142, DK65 harness, product rows U5/U1/O19/T12.
- 2026-11-13 ~22:00: residency DK82-85 closed; Research DK31, DK78 closed, DK79 and DK80 partial (live runs); all pushed at bf2823e (97 rows closed). Round 4 dispatched: run-clinic on DK92 stage 2 (S310+/UC-410+/DK210+), run-shops on DK142 and the DK65 local harness (S320+/UC-420+/DK220+). Weekly 80%: stop new work at about 88%, merge what is committed, resume after the weekly reset (2026-11-14 06:00Z).
- 2026-11-13 ~23:00: Round 4 merged and pushed at 4f018ec: DK92 stage 2 and the ladder (partial), DK142 and the DK65 local harness and capacity plan (partial). 97 rows closed. Both workers idle. **Paused: weekly 83%, resets 2026-11-14 06:00Z.** After the reset, start Round 5: re-read docs/gaps-register.md for open and partial rows with no owner-only blocker (new rows split off by workers: DK170-179, DK180-186, DK190-193, DK200-201, DK210+, DK220+), product rows U5/U1/O19/T12, and the remaining Round 3 residue. Use the same worker sessions (run-shops, run-clinic) with fresh id ranges (S330+/UC-430+/DK230+ and S340+/UC-440+/DK240+).
- 2026-11-13: **Persistent task created** (owner OK): `agent-social-continuous-run`, local time 05:45, 11:45, 17:45 and 23:45 daily until 2026-11-28, each run a fresh lead session that follows the prompt in the task file (~/.claude/scheduled-tasks/agent-social-continuous-run/SKILL.md): usage gates 85% five-hour and 88% weekly; skips if a lead run is active; merges, tests, pushes `claude/open-forum` when green; dispatches the two workers. First job: the Priority B triage into `docs/backlog-triage.md`. The owner is away over the weekend.
- 2026-11-13: **Owner changed the usage limits:** the 5-hour window and the weekly (all models) window may each be used up to **95%** (replaces the earlier 85%/88% gates of the persistent task and the earlier "about 90%"). The task prompt was updated to match. Near the limit, finish and commit what is in flight; one commit per row.
- 2026-11-13 (owner, later): **Limits now: 5-hour window up to 95%, weekly window only up to 60%** (replaces the line above; the owner needs the rest of the week). The weekly window is at 83%, so no scheduled run does work until it resets (2026-11-14 06:00Z). The owner is away until about 2026-11-16: the run builds everything that does not depend on a decision and lists decisions in docs/owner-decisions.md (it does not decide them). A live run with the owner follows their return. First job after the reset: the backlog triage over every open, partial and designed B and C row (promote what the beta needs to A). New row DK290 (priority A): a live-hosted visualisation of the society. The beta is the owner's top priority.
- 2026-11-13 (owner back on 2026-11-17): the owner answered 24 decisions; they are in docs/owner-decisions.md (read it first). New rows DK291 (house agents), DK292 (Treasury budget drafts), DK293 (hosting setup guide), DK294 (Bank deposits and reward) are Priority A and in the queue. Flags 1 to 3 in that file stay in front of the owner; the public launch waits on the lawyer's read and the live run.
- 2026-11-13 (scheduled run, skipped): weekly window 87% (limit 60%), 5-hour window 35%. No work or dispatch this run; no committed worker output was pending. Next run that passes the gate does the merge check, the backlog triage (docs/backlog-triage.md), then Round 5.
