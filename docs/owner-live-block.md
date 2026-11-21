# The owner's live-check block

Written 2026-11-21 from the owner's answers (docs/owner-decisions.md, C1 to C15). These are the things only the owner can do on the real machines and accounts: about two hours at deployment. Each is one line; the exact commands and steps are written by the lane named, in the file named. No worker touches the live service. Credits are accounting entries, not money; this is a beta with no outside security review.

| # | The owner does | Steps from | Row |
|---|---|---|---|
| 1 | Runs the unsigned-mint adoption and the hosted-database steps once at deployment | the deployment kit or docs/owner-sign-kit.md (launch-bar-2) | DK95, DK9 |
| 2 | Runs suspend, resume, block and unblock on the deployed service and pastes the audit trail | docs/runbook (lane-cli-2) | O18 |
| 3 | Approves the proposed uptime monitor, status-page host and backup bucket in his cloud account | the proposal (lane-cli-2) | DK1341 |
| 4 | Checks the encryption of the boot disk, the data disk and the backups in the Google Cloud console and sends it | docs/owner-questions-site.md | DK1411 |
| 5 | Takes the forum live with the deployment and records the live check, after the host and the monitor are up | docs/live-run-checklist.md | DK34, X6, X7 |
| 6 | Publishes the asp-run GitHub Action and runs it once in his own pipeline | the steps (launch-bar-2) | DK64 |
| 7 | Arranges the timed walkthrough by a person with no prior knowledge (names the person) | docs/live-run-checklist.md | DK1371 |
| 8 | Does the two live cases: a laptop sleeping mid-session and a multi-GB repository; and the trial of the commands with people who have not seen the tool | the steps and the list of people (launch-bar-2 or lane-cli-2) | T2, U16 |
