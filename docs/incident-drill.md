# The incident drill (register row DK1380; owner decision DK1341)

Written 2026-11-22 for the owner, who is on call. A drill rehearses the incident process on the live host with a made-up incident, so that the first real one is not the first time the steps are run. It uses only commands that exist and touches no real tenant. Credits are mock accounting entries; the service is a beta; there has been no outside security review. The runbook for a real incident is [incident-runbook.md](incident-runbook.md); the service terms the drill tests are in [legal/enterprise-terms-draft.md](legal/enterprise-terms-draft.md): a first reply within 48 hours, an incident write-up within 7 days, a breach notice within 72 hours.

## Before: set up (10 minutes)

On the server, with the shell functions of the runbook (`asp`, `$T`, `$SITE`). Make a test tenant with a name that cannot be mistaken for a customer, for example `drill-2026-11-23`, and a test address of your own for the mail.

## The scenario

A test tenant starts flooding the service (an abusive loop), a status line must say so, a notice must be sent, the tenant must be contained and later released, and a write-up must be published.

| Minute | Step | Command or action | What counts |
|---|---|---|---|
| 0 | Note the time. Open an incident on the status page | `asp monitor incident --incidents <file> --title "Drill: elevated errors" --status investigating --message "This is a drill; no customer is affected."` | The status page shows the incident, and it says drill |
| 5 | Contain the test tenant | `asp serve suspend --tokens $T --tenant drill-2026-11-23 --reason "Drill: abusive loop"` | A request by that tenant is refused with the reason; nothing is deleted |
| 8 | Look at the record of what you did | `asp serve audit --tokens $T` | The suspension is a line in the audit and the chain verifies |
| 10 | Tell the affected contact (your own test address) | a written message: what was found, what was done, what they can still do | The message names no other party and is sent within 48 hours of the report in a real case |
| 15 | Update the incident | `asp monitor incident --incidents <file> --id <incident> --status identified --message "Drill: the cause is a test loop."` | The page shows both updates in order |
| 20 | Release the tenant | `asp serve resume --tokens $T --tenant drill-2026-11-23` | The tenant works again |
| 25 | Resolve the incident | `asp monitor incident --incidents <file> --id <incident> --status resolved --message "Drill finished."` | The page shows resolved |
| 30 | Check the page was never down | `asp monitor status --status-out <status.json>` | It reads operational, and the file is under ten minutes old |

## After: the write-up and the record (within the day)

Write the post-incident note the terms promise (7 days in a real case): what happened, the timeline from the table with the times you really took, what you changed, and what was slow or missing. Put the note and any gap it found in [live-run-checklist.md](live-run-checklist.md) under a heading "Incident drill, <date>", and open a register row for each gap. The row DK1380 moves from "drill not run" to "drill run" only when that note exists with real times.

## What the drill does not test

An outage of the host itself (the monitor and the status page are served by the web server so that they stay up), a breach of personal data (the 72-hour notice is rehearsed by the message step only), and a request from a court (see [security-process.md](security-process.md)).
