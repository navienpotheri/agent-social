# CI findings: the approval tests that hung for 300 seconds (gap T23)

## What hung

`run-ask-match.test.ts` ("per-command approval ...") took 310 s alone, locally; `run-concurrent.test.ts` ("two sessions of one agent at once ...") failed on CI with the fake agent's request timing out after 300 s (`HeadersTimeoutError`, undici's default).

## Cause 1 (the per-command test, and very likely the CI failures): a lockout from tokenless requests

Every `asp run` session probes the service with `GET /forum/head` to see whether a forum is offered. The probe carries no token. The log service answered 401 and counted it as a **failed sign-in**; after ten of them in 300 s it locks the whole address out (HTTP 429 "too many failed sign-ins from this address", about 5 minutes). The per-command test runs about ten sessions against one service from one address, so the tenth or eleventh session was locked out: its gateway request waited out the lockout (the client waits out a 429 by design), which is the 300 s.

Evidence:
- The approvals trail (`ASP_DEBUG_APPROVALS=1`) of the stuck session showed `request seen; waiting for the job to be Running` and nothing after: the job-state read was being refused.
- `curl` against the test's service while it hung: `{"error":{"code":"RATE_LIMITED","message":"too many failed sign-ins from this address","retryAfterSec":74}}`, HTTP 429.
- A temporary line in the service logging each 401 showed exactly ten `GET /forum/head`, no token, in 6 seconds, then the lockout.
- Per-step timings of the test: all earlier sessions 0.3 to 0.8 s, the step after the tenth probe hung.

Fix: `packages/asp-log/src/server.ts`: only a request that presents a wrong token counts as a failed sign-in. A request with no token guesses nothing (the forum probe, a browser, a health check). The brute-force protection for wrong tokens is unchanged (`log-service-limits.test.ts` passes, including "repeated failed sign-ins lock an address out").

Before: 310 s (passes only after the lockout). After: 15.9 s.

## Cause 2 (the two-sessions test, found earlier, in the starting branch)

`logEnv` was one module-level variable that each `main()` set and restored, so overlapping in-process `main()` calls clobbered each other; session D's background loop then read the wrong environment. Fixed with an `AsyncLocalStorage` (`logEnvStore`). That test also runs several sessions against one service from one address, so cause 1 can also have contributed on CI; I did not separate the two there.

## What I could not explain / not verified

- I could not run CI. The claim that cause 1 explains the CI failures rests on the same test shape (many sessions against one service) and on the local reproduction; it is not confirmed on CI.
- A real deployment where the forum is not served would lock a user out after ten runs in five minutes before this fix; with the fix it cannot.
- Not changed: the client still probes without a token (harmless now).

## Evidence after the fix (local, Windows, Node 24)

- `run-ask-match.test.ts` alone, 5 runs in a row: all pass, 21 to 24 s per run (310 s before).
- `run-concurrent.test.ts` alone, 5 runs in a row: all pass; the test itself takes about 10 s.
- Full `npm test`: 4 suites of 348, 201, 178 and 198 tests; 4 failures, all the known ones ("asp canary" and three "swarm" tests). Nothing else failed.
- Unexplained, harmless: after `run-concurrent.test.ts` passes, its process stays alive about 120 s before exiting (something holds a handle open); it does not fail the test.
