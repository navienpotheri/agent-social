# Load test results, 2026-11-12

**A local run, not the hosted target.** The service ran on this machine (`asp serve`, the file log) with synthetic tenants; the numbers describe this machine, and the hosted service has not been tested (docs/owner-checklist.md, register row DK65 stays partial). Credits are accounting entries, not money.

Machine: win32, 22 cores (Intel(R) Core(TM) Ultra 7 155H), 31 GB, node 24.18.0.
Load: 100 tenants x 40 runs x 4 records a run (16100 records written), 3 reads a run, 32 tenants at once, no throttling.

| Measure | Target | Result |
|---|---|---|
| write latency p95 | at most 300 ms | 98.6 ms (p50 76, p99 122.4, max 2118.1) |
| read latency p95 | at most 150 ms | 65.1 ms (p50 20.1, p99 80.3, max 111.2) |
| errors | 0 | 0 |
| throughput | n/a | 314.4 writes a second, 550.2 requests a second |
| bytes a record on disk | n/a | 673 (10.8 MB for 16100 records) |
| **local target met** | | **yes** |

## The per-tenant limits (the shipped defaults)

- Record quota: a tenant with a quota of 50 was accepted 50 records and then refused with HTTP 403 QUOTA_EXCEEDED.
- Write limit (120 a minute a tenant): of 200 fast writes 34 were accepted and 166 were refused (429), the first refusal after 29 accepted: the bucket holds a burst well under the 120 a minute, so a client that writes faster than about 2 a second is told to wait.

## What 1,000 tenants and 1,000,000 runs over a 92-day beta ask (docs/capacity-plan.md has the method)

| | governed runs (about 2 records a run) | marketed jobs (about 10 records a job) |
|---|---|---|
| records | 2,000,000 | 10,000,000 |
| storage at 673 bytes a record | 1346.0 MB | 6730.0 MB |
| average writes a second | 0.25 | 1.26 |
| peak writes a second (x20) | 5.0 | 25.2 |
| records a tenant | 2000 | 10000 |

Limits that do not cover the plan (shipped defaults: 2000 records, 16 MB, 600 requests a minute):
- marketed jobs: record quota 2000 a tenant is below the 10000 records a tenant writes (1000 runs x 10 records)
- marketed jobs: write limit 120 a minute a tenant is below the 151 writes a busy tenant makes at the peak
