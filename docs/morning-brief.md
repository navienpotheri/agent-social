# Morning brief, Sunday 22 November 2026

Written by the lead for the owner. Numbers are read from the register, `docs/launch-bar.json` and the gate logs at about 09:00 IST.

## 0. Read first

1. **The gate is green and pushed.** `claude/open-forum` is at `f02e747e`. Last full gate: CLI 1185 of 1187 before one fix (a merge artefact in the GV6 register row, repaired and re-run green), core 1293/1293, log 1150/1150, package 580/580, Python 1429/1429. Nothing red is outstanding.
2. **One incident to know about.** A worker's first clean-checkout test run (about 06:30 to 07:30 IST) ran with this machine's default home, which holds your real `~/.asp` with a saved login from 2026-10-21. Tests that did not isolate their home therefore reached your hosted service. The evidence is five refusals from the service ("not an identity this tenant may create"), so no record was created. `~/.asp` was not modified (checked by file time only; the worker did not read the login). It cannot rule out other read requests during the hour-long run. **What to do:** check the hosted service's access log for requests from this machine in that window; if you want certainty, rotate that saved login. **What changed:** every package's test script now preloads `conformance/test-home.mjs`, which gives each test process a fresh temporary home and removes the service variables, and fails loudly otherwise. A full run with your real home passed with `~/.asp` untouched.
3. **Tonight, the evening of 2026-11-22, is the live run** (the owner moved it forward). Everything for it is ready except your own steps (section 5).

## 1. What was done

Register on the lead branch: **411 rows closed** (priority A 326, B 70, C 7); not closed 504 (open 281, partial 179, designed 44). At the start of yesterday's window 299 were closed, so about **112 rows closed in the last day**; 25 carry today's date in their text.

| Priority | Closed | Partial | Open | Designed |
|---|---|---|---|---|
| A | 326 | 120 | 93 | 5 |
| B | 70 | 32 | 150 | 26 |
| C | 7 | 1 | 38 | 13 |

**Launch bar:** 64 must-close rows (305.2 worker-hours), down from 105 at its peak. Of those, 11 need your decision, 14 a live run, 2 an outside party and 19 an action only you can take. 103 rows are claims to withdraw until built; 331 come after launch. The 25 to 26 November date cannot hold; you pick the date from section 1 of `docs/launch-bar.md`.

**Notable closures since yesterday:** the loop breaker in the gateway (DK1230) and its fleet and near-repeat forms (DK1477, DK1478); the containment regression with four new bypass classes (DK1713); stolen-token detection (DK1717); key rotation (DK1726); the Town Hall voting rules and capture-resistance red team (DK1721); the lens learning loop on simulated learners (DK1750, DK1751, DK1754); the Courts' standing adjustment (DK1730); gateway refusals as contestable records (DK1607) and the reasons agents hear (AG3); the Insurer's conditions (DK402); data sharing, sandbox tenant, offboarding and the starter pool per agent (DK1360, DK1382, DK1384, DK1470); job data handling (JO3) and the signed consent record (US8); the credit structure (DK1349); and the DK1601 dynamic fleet dashboard and HUD, approved by you.

**Built but not closed (stated honestly in each row):** the Town Hall end to end, the four design packs (exploration and expeditions, games and the Arena, forum mechanisms, elections), the inspectorate (records and pages), rent, model trust and drift checks, direct messages, missions, ladders, recalls, and the opt-in gateway halves of roles, irreversible actions and unprompted work.

## 2. Quality work that matters more than the counts

- **Mutation checks of closed rows** (about 150 one-line mutants across about 40 rows by two lanes): every Done line held, but **nine tests were looser than they looked** and have been strengthened. The notable one: 9 of 12 mutants of the farming detector (DK1357) survived the original tests; eight are now killed by a new test. No row was reopened.
- **Real defects found and fixed:** a tool-use block with no name made the gateway answer 502 for a whole reply; the `--budget-usd` estimate ignored prompt-cache tokens (spend would have been badly undercounted) and a cap under USD 2 to 3 can stop at the first call; the budget-stop message read like a key fault; a quoted path with spaces (your OneDrive folders) was wrongly refused on Windows; the keystore crashed on a memory key stored in the wrong folder; five public pages (including the emergency-stop page) returned 404 or 401 on a running service although declared public; a private write changed the memory tree hash so the package stopped verifying.
- **Honesty audits:** the home page listed OpenClaw and Hermes as supported (they are tested with stand-ins only): fixed. Public text no longer implies a sandbox on Windows: on Windows containment is the gateway's reading of calls; the Linux sandbox is live-checked only under WSL. The legal review no longer contradicts itself on whether credits are sold: credits are mock today and will be sold only from the first sale, after your acceptance of risks S1 to S7.
- **A clean-checkout gate** (fresh clone, install, isolated home, on this Windows machine) passed all suites except one load-sensitive timing test, since made robust.

## 3. Pushed and not pushed

Pushed: everything through `f02e747e`. Merged on my branch but not yet in the latest push: one `lane-society-2` commit and two `lane-protocol-3` commits made after my last merge; they go in the next round (gate first). Nothing is held back for a reason other than the gate.

## 4. Lanes and usage

Four lanes are running: `lane-society-2` (society rules and views, now the protocol-sized job rows), `lane-protocol-3` (mutation checks of other lanes' closures, records), `lane-cli-3` (gateway, live-run safety, Windows readiness) and `launch-bar-2` (public text, runbook, document passes). The 5-hour window is at 57%, resetting at 09:59 IST; the keeper restarts the lanes at 10:05. Weekly usage is 45%.

## 5. What waits for you

In order of launch value (details and exact commands in `docs/owner-morning-guide.md`, `docs/owner-sign-kit.md` and `docs/live-run-plan.md`):

1. **Tomorrow evening's live run.** Read `docs/live-run-plan.md`. First step: `.\scripts\evening-rehearsal.ps1` (15 steps pass on a fresh clone; it runs the real claude and real codex against stand-ins and sends no key). Tell me four defaults: runtimes (Claude Code, then Codex; Goose, OpenClaw and Hermes are stand-in only), model and provider (the runtime's own default, your own key in your window only), budget (USD 5 an agent per run; never under 3), who is present. Questions 4 to 7.
2. **Signatures, in this order:** read Code 0.5 and the ten wording questions in `docs/copy-review.md` first (the clause numbering is fixed; substantive points such as Code 3.2 are yours to answer); tell me; workers apply; then sign blocks 4, 1, 3, 2 of the sign kit. **Any edit to a signed file breaks the signature**, so freeze the text before signing. Block 5 only at the first credit sale.
3. **The U8 design choice:** three directions with screenshots in `docs/prototypes/u8` (A dark operations, B light editorial, C warm civic; a mix is possible).
4. **The launch date**, from `docs/launch-bar.md` section 1 (Core bar earliest 2026-11-25, Reduced 2026-11-28, Full 2026-12-26 at one worker; more workers shorten it).
5. **Names:** your successor and the third keyholder (DK421).
6. **Drafts to approve or edit:** the society, learning, place-for-agents, enterprise, games, expeditions and elections pages, the legal review (A1 to A12, the new A12 covers the broad telemetry), Terms section 11.
7. **Your own live actions** (questions 17 to 23): unsigned-mint adoption, operator routes, the Google Cloud encryption check, the forum go-live check, the GitHub Action, the walkthrough person, the two live cases.

**Open owner questions: 30** (A 8, B 8, C 7, D 7 decisions taken by default). Defaults worth a glance: DK440 operator notice 72 hours; `asp run --ask-first` opt-in for the beta; lens kill key is yours; expeditions cost a showcase budget only; key-only forum weight 0; two elected offices; the inspectorate reports only; the Code's articles stay yours; adopt the rights charter at Code 1.0; no property open in the public beta (DK89 and DK91 need a communication paper that you choose); nothing signed by the service on its own (DK162).

## 6. Risks and honest limits

- **No real model has answered through the gateway yet.** Every rehearsal uses stand-in servers (real claude and codex binaries, fake provider). The live run is the first real test of the provider path, of cost behaviour and of the budget cap.
- **Windows containment** is the gateway's reading of calls, not a sandbox.
- **The numbers from the lens loop, the exploration desert, the ladder, forum rank and election simulations** come from simulated learners or scripted agents and prove plumbing, not effect; none is quoted on a public page.
- **Held-out containment numbers are low for words-only detection** (plot and feed injection 38 percent, tool-result injection 25 percent on fresh held-out cases); the structural defences hold what they were built for.
- **Many closures rest on tests that were later found loose** (nine strengthened). More mutation checks are queued; the false-comfort risk is real but shrinking.
- **Duplicated work recurred** (three versions of one rule, id clashes, a merge that dropped register rows); each is fixed, and each lane now has its own id block.
- **No outside security review**, and the site says so. The review request is ready (`docs/security-review-scope.md`); choosing and paying a reviewer is yours.
- **Hosted pieces are untested live:** uptime, backups, encryption at rest, the forum go-live, the status page: the site keeps those claims off.
