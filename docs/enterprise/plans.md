# Plans and pilots (register rows DK1363, DK1368; draft for the owner)

Written 2026-11-21. **No price is named anywhere in this document, on the site or in the README.** The owner sets the numbers; this document says what is planned, what is free, and what must be true before anything is sold. Credits are mock accounting entries, not money, and nothing can be bought today.

## What is free

- **Personal agents and small fleets** are free in the beta. "Small" is up to **25 agents** for now (owner decision, 2026-11-21); the number may change when the cost per agent has been measured, and the owner sets it.
- **Pilots for an enterprise are free during the beta, in writing.** A pilot is a time-boxed trial with one named contact; it ends in a paid contract or ends. The pilot terms are in [../legal/enterprise-terms-draft.md](../legal/enterprise-terms-draft.md): free, no service-level commitment beyond the beta's, either side may stop with notice.

## What is planned (not built, not for sale)

| Plan | For | What it will include | State |
|---|---|---|---|
| Free | A person's agents and small fleets | The open door, the gateway, the Mandate, the log, the local dashboard, the starter credits (mock credits; every agent of a fleet gets its own, DK1356) | Built |
| Team | A team with a fleet | Fleet declaration, enrolment from a manifest and by invitation, the fleet tree with Mandate templates, a live fleet dashboard with caps and a freeze switch, larger limits set by plan | Built (DK1353, DK1354, DK1355, DK1361, DK1372, DK1362 for the limits); the plan itself is not offered until the owner sets prices |
| Enterprise | An organisation | Roles and single sign-on, a private log option, committed capacity with overage, a data-sharing choice, support hours and a status page, audit export | The data-sharing choice (DK1360), an audit export file (DK1374, partial), a sandbox (DK1382) and offboarding (DK1384, partial) are built; roles and single sign-on (DK1359) and provisioning (DK1373) are not; support terms are a draft (DK1380) |

What a plan will meter, once there is a price: an agent that signed at least one act in the month ("active agent"), committed reads and writes a minute, and usage above the commitment. The owner chooses the margin and the free allowance.

## The cost model (what is measured, what is not, and why no price follows)

`evals/load-fleet.ts` (DK1362, [load-test-results-fleet.json](../load-test-results-fleet.json)) measured the signed log alone, in one process on a shared development machine with the in-memory store: about 4.9 ms a write (one process carries about 205 writes a second), 4,888 CPU-seconds per million writes, and 684 bytes a record (0.68 GB per million records before the database's indexes). Metering counts a fleet's usage from the log (`asp meter report`), and a statement is priced from a plan the owner signs (`asp meter statement`).

Not measured, so no price can honestly be set from it: the hosted database (Postgres), the network, several processes, reads, the dashboard's own load, the cost of support, mail and the host itself, and a month of real use. **Owner decision (2026-11-21): measure the cost first; no figure is published until the cost per fleet agent has been measured, and pilots stay free in the beta.** The owner's numbers (the price per active agent, the committed capacity, the margin and the free allowance) wait for a measured month on the hosted service; until then this page names no figure.**

## Before anything is sold (the checks the claims audit enforces)

1. The owner sets the prices and approves the pages (DK1363, DK1368).
2. The terms for the sale are in force and the AI-assisted legal review of prepaid credits, consumer and tax rules has been accepted by the owner in writing (docs/legal-review.md, "Selling credits"; DK1370).
3. Every sentence that says credits are mock or not money is rewritten on the day sales start, and not before (docs/legal/credits-sale-draft.md holds the rewrite).
4. The promises audit (docs/promises-audit.md) passes with the new wording.

Until then the site, README, llms.txt and the terms say: credits are mock accounting entries, nothing can be bought, pilots are free.
