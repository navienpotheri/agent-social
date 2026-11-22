# Overnight log (lead)

- 2026-11-22 02:45 IST: pushed open-forum (80ef3138..HEAD) after a green full gate: cli 1114, core 1135, log 1043, package 526, python 1271. Four lanes running (society-2, protocol-3, cli-3, launch-bar-2); window 75% at 02:41, reset 05:00 IST. Earlier combined gates found 11 and then 4 integration failures: all fixed by the owning lanes or by me (map row for mutual_act, DK1364 test now allows a stand-in-only mention).
- 2026-11-22 03:45 IST: pushed open-forum (31505784..HEAD) after a green full gate: cli 1131, core 1174, log 1057, package 539, python 1310. Lanes running to the reset at 05:00 IST (window 91 percent at 03:42).
- 2026-11-22 05:40 IST: pushed open-forum (f1a5ef32..HEAD). Fixed two integration failures myself (public society pages regex; Action field list). Window reset at 05:00; lanes running (2 percent at 05:20).
- 2026-11-22 06:10 IST: pushed open-forum (2f9341a0..HEAD) after a green full gate: cli 1154, core 1203, log 1074, package 547, python 1339. Four lanes running (window 13 percent at 05:41).
- 2026-11-22 07:20 IST: pushed open-forum (28ef97ae..HEAD). Three load flakes (dashboard 10k timing, run-log custody, signup) pass alone; guide counts fixed by me. Window 27 percent at 06:41; next reset 09:59 IST.
- 2026-11-22 08:55 IST: pushed open-forum (ad5dbba2..HEAD). One merge artefact fixed (GV6 row). Lanes running; reset 09:59 IST.

- 2026-11-22 10:43 IST keeper: window 10 percent; lane-cli-3 resumed (the other three running). Merged all four lane branches (e806873a, da45c477); gate on that tip running. Earlier gate (f26113f9-era tips) red twice: ladder test wording (fixed by lane-cli-3 in 7c719b8e) and 10,000-member tree wall time (fixed by lane-protocol-3: CPU-time bound, on its branch, goes in next round). Not pushed yet.

- 2026-11-22 11:05 push: gate green on tip a9029d9c (cli 1207/1208 with 0 failed, core 1334, log 1171, package 604, python 1470) after one stale regex in containment-classes.test.ts was updated to the formal README wording.

- 2026-11-22 11:45 IST keeper: window 20 percent; lanes society-2, cli-3, launch-bar-2 resumed (protocol-3 running). Merge round hit conflict markers in two source files, repaired (201ab86a); the first gate on it was invalid and stalled; clean gate (gate2.log) started 11:44. Last push still 2356c362.

- 2026-11-22 12:17 push: tip 34603749. Full run: core 1334, log 1176, Python ok, package 629/629 after the fix, cli 1208/1218 with 9 load failures and 1 import failure all passing alone (45/45 plus live-scripts 6/6). Gateway repaired (ladderAtCall import). Not in this push: tips after 0ee462b9 (cli-3), de1cb432+ (society-2), latest protocol-3 and launch-bar-2.

- 2026-11-22 12:41 IST keeper: window 38 percent; lane-cli-3 resumed (others running). Gate3 on 2ebc0da8 (merge of all four lanes incl. scanner fix, JO8, DK1345/1371/1379) running; last push 4b4ccd61.

- 2026-11-22 13:50 IST keeper: window 62 percent. Lanes cli-3, protocol-3, launch-bar-2 resumed (society-2 running). Lead tip 0419b981+deployment plan merge is FROZEN for the owner live run tonight (no merges into this folder until he is done). Last push still 4b4ccd61; later lane tips (cli-3 bf0be93e, society-2, protocol-3, launch-bar-2) wait for a post-run merge and full gate.

- 2026-11-22 14:42 IST keeper: window 90 percent (resets 15:00 IST), weekly 59 percent; lane-society-2 paused itself near 95 percent, launch-bar-2 idle with nothing buildable; nobody resumed now (window nearly spent), resume after the reset. Pushed aa1779b2 earlier (all four lanes merged, CLI per-test limit added). Owner live run in progress (Claude Code haiku item 1 proven; Codex item 5 refusal proven, key variables were swapped and fixed). lane-cli-3 session-listing fix applied to the owner folder as 9e879252.

## 2026-11-22 evening (launch-bar-2): rows moved by the owner's deployment evidence

Each row is judged by its own Done line. "Closed" means that the Done line is met; "advanced" means that evidence was added and the row stays partial, with what is missing named in the row. The evidence is as relayed by the lead; the sections of docs/live-run-checklist.md give each fact. Held by `packages/asp-cli/test/deployment-evidence.test.ts`.

| Row | Before | After | Evidence line |
|---|---|---|---|
| DK1411 | open | closed | The VM disk `asp-log` and its snapshot use Google-managed encryption (step 2); docs/procurement/encryption-evidence.md; answer 29 reads Yes |
| DK95 | partial | closed | The live audit passes `--require-signed`: 4500 minted, 4500 signed, 0 unsigned, balanced, log seq 413 after nine adoptions of 500 (step 6) |
| DK1503 | open | closed | A second outside monitor, the status copy and the outage test on the public status page (14:30:30 to 14:35:21Z); the Up mails are to be confirmed |
| GV6 | partial | partial | The database restore drill passed twice on the server (404 records); the whole-city restore, the emergency stop on the live service and the incident process remain |
| DK1802 | open | partial | Deployed (bbfa5af), key-only open, and the account routes work with the current client; an enrolment and two runs through the service are still to be run |
| DK1803 | open | partial | `/health` carries a build block with schema fingerprints; the client's preflight and the plain SCHEMA_INVALID message are not shown |
| DK9 | partial | partial | The credit audit run on the live service before and after the adoptions; the daily run for the first week continues |
| DK546 | partial | partial | Key-only sign-up is open on the hosted service; a key-only enrolment through it is still to be run |
| DK650 | partial | partial | The update that unblocks both ways in is deployed; both runs are still to be done |
| U1 | partial | partial | A real Google sign-up at `/join` on the hosted service; the hosted dashboard and the parent check remain |
| U9 | partial | partial | `asp account show`, `export` and `close` ran on the hosted service with a deletion receipt; the page and a way to hide a record remain |
| O19 | partial | partial | Google sign-up works on the hosted service; the command-line route, the verified-contact tier and the waiting list are not shown |
| E9 | partial | partial | Mail through Resend and the domain verified; a direct test mail delivered (seen by the lead later the same evening); the end-of-job mail from a real job is not shown |
| E8 | partial | partial | Mail now sends on the hosted service; the end-of-Mandate mail and the dashboard are not shown |
| O18 | partial | partial | The admin token used on the live service (audit, adoptions, smoke); the suspend, resume, block and unblock run with the audit trail is not shown |
| DK52 | partial | partial | `/watch/findings` answers 401 on the hosted service because `--watch-interval` is not on the unit; not advanced |
| T4 | partial | partial | The owner's wifi-off run ended with a plain message and a summary; not on a clean machine |
| KO2 | partial | partial | Mail is live, but a key-only tenant's alert address and recovery-key reading were not run; not advanced |
| O6 | partial | partial | No new load evidence this evening; not advanced |
| DK1204 | partial | partial | Waits for step 10 (the forum price list), which was not run |

## 2026-11-22 later evening (launch-bar-2): rows moved by the owner's two live runs through the hosted service

Each row is judged by its own Done line. The evidence is as relayed (docs/live-run-results-2026-11-22.md section 7 and docs/live-run-checklist.md). Held by `packages/asp-cli/test/deployment-evidence.test.ts`.

| Row | Before | After | Evidence line |
|---|---|---|---|
| DK1802 | partial | closed | The service is deployed at bbfa5afa with decision 10 on; `asp enrol` succeeded; a key-only run (8aa76014) and a sponsored run (660d3959) both worked through it |
| DK546 | partial | closed | Each step has its test; key-only sign-up is on at launch; a live key-only run is recorded |
| E9 | partial | partial | The sending side is proven (a direct test mail reached the owner's inbox); no end-of-job mail arrived for the sponsored run, and the cause found is that `asp run` creates no settled contract (DK1807) |
| P21 | partial | partial | Claude Code through the service and Codex locally; Goose, Antigravity and OpenHands are not run |
| E5 | partial | partial | A real run log of 11 events verifies; the Antigravity and OpenHands formats are not read |
| DK650 | partial | partial | Both ways in ran on the hosted service; the abuse counters read afterwards and the review-hold row are not shown |
| DK1602 | open | open | Two real runs exist; the sponsor page was not compared with the run log |
| E8 | partial | partial | Mail sends through Resend, but no end-of-job mail arrived (DK1807); the end-of-Mandate text and the dashboard are not shown |
| KO2 | partial | partial | Enrol printed the recovery code once and said "read with asp notices"; no named address; owner question 53 is a proposed default, not answered |
| DK1806 | (new) | open | PowerShell blocked npm.ps1 until Set-ExecutionPolicy -Scope Process Bypass |
| E10 | closed | closed | Evidence only: nothing triggered a mail when a plain `asp run` ended, because it makes no settled contract; the row is not reopened (DK1807) |
| DK1807 | (new) | open | A governed `asp run` ends with no end-of-job mail: no settled contract, nothing in `asp mail pending`, an empty outbox |

## 2026-11-22 later still (launch-bar-2): the O18 live run, the 13 charters and the E9 correction

Each row is judged by its own Done line. Seen by the lead on the owner's screens; see docs/live-run-checklist.md. Held by `packages/asp-cli/test/deployment-evidence.test.ts`.

| Row | Before | After | Evidence line |
|---|---|---|---|
| E9 | partial | partial | Reverted and kept: only a direct test mail was received; the end-of-job mail from a real governed run has NOT been received (DK1807); its Done line's first words are met by the direct send, the row's gap is not |
| O18 | partial | closed | The live run (5 audit entries, hash-linked, chain ok, the suspended tenant refused) and the owner's decision to accept the hash-chained, attributed audit for the beta; the 401 check and `asp serve audit` on the server were not run |
| DK382 | closed | closed | Live evidence: 13 charters published as version 1 on the hosted service, each signed by the operator and co-signed by the owner |
| DK396 | closed | closed | The 13 charters are in the live log; the cross-check and the `GET /charters` page (built, tested) have not been run on the hosted service until it is redeployed with the 21 new read methods; the row is not reopened |
| DK1808 | (new) | open | PowerShell 5.1 mangles an inline JSON body in curl.exe; write the body to a file and send --data-binary |
| DK1809 | (new) | open | A signed suspension record (the owner's key on the operator's machine): the later hardening of O18 |

## 2026-11-23 (launch-bar-2): rows moved by the redeploy, the live charter index and the real end-of-job mail

Each row is judged by its own Done line; seen by the lead; see docs/live-run-checklist.md. Held by `packages/asp-cli/test/deployment-evidence.test.ts`.

| Row | Before | After | Evidence line |
|---|---|---|---|
| DK1807 | open | closed | After the redeploy the service mailed the end of a governed run to the sponsor's address; the lead saw the mail in the owner's inbox (its parts are in the row); the unsubscribe click and a bounce were not run |
| E9 | partial | closed | A live send reached the owner's own address twice: the direct test mail (not an end-of-job mail) and the end-of-job mail of a real governed run |
| ML1 | partial | closed | The live proof that its Left line asked for: a governed run on the hosted service, after the redeploy, had its end mailed with the required parts |
| ML3 | partial | closed | The real Resend sent it and the service was redeployed (its two Left items); the unsubscribe click, a bounce and the List-Unsubscribe headers of the real mail were not run live |
| DK1811 | partial | closed | The redeploy was its Left line; `asp charter index` (13 of 13) and `asp treasury statement` ran live |
| E10 | closed | closed | Evidence only: a plain `asp run` now triggers the end-of-job mail |
| DK1810 | closed | closed | Live note only: the charters read back after the redeploy |
| E8 | partial | partial | The end-of-job mail is live; the end-of-Mandate mail of a settled contract and the dashboard are not shown |
| ML2 | partial | partial | The tenant's address was set by hand; the row's Left line is untouched |
| KO2 | partial | partial | The key-only address proof was not run |

## 2026-11-23 later (launch-bar-2): step 9 on the hosted service, and the two mails reconciled

Seen by the lead on the owner's screens. Held by `packages/asp-cli/test/deployment-evidence.test.ts`.

| Row | Before | After | Evidence line |
|---|---|---|---|
| DK1812 | open | closed | Step 9 now has the order that worked live: the institutions' keys (seq 453 to 455), the Treasury funded (seq 456), the drafts, the 14 signatures (seq 457 to 470) |
| DK760 | partial | partial | The 2026-12 public-works line (600) is signed; the routine run with a payment recorded (step 12) is not |
| DK1100 | open | open | The first public-works budget is signed on the hosted service; a payment and the seed postings are not |
| DK381 | partial | partial | `treasury statement` ran live and reconciles; the monthly page with a signed copy is not shown |
| DK1807 | closed | closed | Note: there were two end-of-job mails (11:50 PM IST for 660d3959; about 12:23 AM IST for 81af786e, seen on the owner's phone), which resolves the time difference |
