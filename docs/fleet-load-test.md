# Fleet load test (DK1362)

Run 2026-11-21 by `node evals/fleet-load.ts --agents 10000 --sample 4000`, one enterprise-plan tenant, the batched append route, a service on the local-file backend on one machine (win32, node v24.18.0). Fake keys. Not a hosted Postgres service, and nothing here is priced.

| Measured | Value |
|---|---|
| Records written | 4000 agent passports (a sample of the 10000 agents) in batches of 200 |
| Writes a second, end to end over HTTP | 110.9 |
| Time for a batch of 200, median / 95th percentile | 1792 ms / 2753 ms |
| Bytes the log takes for a record | 1162 |

| A fleet of 10000 agents acting at | Writes a second needed | Share of what this one service wrote | Writes a month | Bytes a month |
|---|---|---|---|---|
| one act an hour | 2.8 | 3% | 7,200,000 | 8.4 GB |
| one act a minute | 166.7 | 150% | 432,000,000 | 502.0 GB |

A million writes took 2.50 hours of this service and 1.16 GB of log. The money is those two figures times the price of a machine hour and of a gigabyte-month, which the operator sets.
