# Capacity plan for the three-month beta

**Status (2026-11-12, register row DK65): the plan and a local load test exist; the hosted target is not shown to be met.** The deck promises capacity for 1,000 tenants and 1,000,000 governed agent runs over the beta. This page states what that asks of the log service, from inputs that are either measured (by [evals/load-test.mjs](../evals/load-test.mjs), results in [load-test-results-2026-11-12.md](load-test-results-2026-11-12.md)) or stated as assumptions, and checks the shipped limits and the starter pool against it. The arithmetic is `packages/asp-log/src/capacity.ts`, tested in `packages/asp-log/test/capacity.test.ts`. Credits are accounting entries, not money.

## Inputs

| Input | Value | Where it comes from |
|---|---|---|
| tenants | 1,000 | the deck's target |
| governed runs | 1,000,000 over 92 days | the deck's target |
| records a governed run writes | about 2 (an Action a stretch of the run) | assumption: the gateway files one Action per stretch |
| records a marketed job writes | about 10 (intent, offer, contract, bond, mandate, action, delivery, acceptance, settlement) | the protocol's job lifecycle |
| bytes a record on disk | **673** | measured: 16,100 records took 10.8 MB in the file log |
| peak against average | 20 times | assumption |
| one busy tenant's share of the peak | a tenth | assumption |
| requests a record write comes with | 3 (the write, a read back, a check) | assumption |

## What it asks of the service

| | governed runs | marketed jobs |
|---|---|---|
| records over the beta | 2,000,000 | 10,000,000 |
| storage (673 bytes a record) | about 1.3 GB | about 6.7 GB |
| average writes a second | 0.25 | 1.26 |
| peak writes a second | 5.0 | 25.2 |
| records a tenant (1,000 runs each) | 2,000 | 10,000 |
| writes a minute for a busy tenant at the peak | about 30 | about 151 |

On the machine of the recorded run (22 cores, 31 GB, the file log, 32 tenants at once) the service took **314 writes a second and 550 requests a second** with a write p95 of 99 ms and a read p95 of 65 ms: more than 12 times the peak write rate of the marketed-jobs case. **That is one laptop, not the hosted server**: the hosted figure needs a hosted run.

## The stated latency target (local)

Write p95 at most 300 ms, read p95 at most 150 ms, no errors, at 32 tenants at once. The recorded local run meets it. The hosted target is not claimed.

## The limits and the starter pool, checked

| Limit (shipped default) | Governed runs | Marketed jobs |
|---|---|---|
| record quota 2,000 a tenant | covers it exactly (1,000 runs x 2 records), with no room for anything else the tenant writes | **short**: a tenant writes 10,000 |
| byte quota 16 MB a tenant | covers it (about 1.3 MB) | covers it (about 6.7 MB) |
| rate limit 600 requests a minute | covers it | covers it |
| write limit 120 a minute | covers it (about 30) | **short at the peak** (about 151) |
| starter pool 1,000,000 credits | covers 1,000 tenants x 2 identities x 500 credits exactly (`starterPoolFor`) | the same |

Measured at the limit: a tenant with a quota of 50 records was accepted 50 and then refused with `403 QUOTA_EXCEEDED`; a tenant writing as fast as it could was refused with `429` after about 29 writes, so the write bucket allows a burst of roughly 30, not a minute's 120 at once.

**Findings (recommendations, not changes: the limits are the owner's to set).** If the beta's runs go through the market, the default record quota (2,000) and write limit (120 a minute) are too low for 1,000 runs a tenant; raising the record quota to 10,000 and the write limit to 300 a minute would cover the marketed-jobs case. Governed runs that file only Actions fit as they are but leave no headroom. The starter pool is exactly the launch target: any tenant above 1,000, or a second grant, needs the operator to top it up (`asp serve starter`).

## What this does not show

- The hosted server's latency, its database (the load test used the file log, not the hosted PostgreSQL), its network, or a long soak: a hosted run is on [owner-checklist.md](owner-checklist.md).
- That a real run writes 2 or 10 records: the first weeks of real activity give the figure; rerun the plan with it (`capacityPlan`).
- Reads of large histories (`since` over millions of records) and the nightly audit's cost at 10 million records.
