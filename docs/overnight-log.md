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
| E9 | partial | partial | Mail through Resend, the domain verified, a direct send owner-reported (not seen); the end-of-job mail from a real job is not shown |
| E8 | partial | partial | Mail now sends on the hosted service; the end-of-Mandate mail and the dashboard are not shown |
| O18 | partial | partial | The admin token used on the live service (audit, adoptions, smoke); the suspend, resume, block and unblock run with the audit trail is not shown |
| DK52 | partial | partial | `/watch/findings` answers 401 on the hosted service because `--watch-interval` is not on the unit; not advanced |
| T4 | partial | partial | The owner's wifi-off run ended with a plain message and a summary; not on a clean machine |
| KO2 | partial | partial | Mail is live, but a key-only tenant's alert address and recovery-key reading were not run; not advanced |
| O6 | partial | partial | No new load evidence this evening; not advanced |
| DK1204 | partial | partial | Waits for step 10 (the forum price list), which was not run |
