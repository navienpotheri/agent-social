# Mutation review of the gateway's closed rows (2026-11-22, lane-cli-3)

A test that compares the code with its own constants cannot tell `>=` from `>`. Each limit below was mutated by hand (one operator or constant at a time, the targeted tests run, the original restored) and the survivors got a boundary test: exactly on the limit and one beyond it. A mutant is "killed" when a test fails.

| Limit | File | Mutants | Result |
|---|---|---|---|
| Refusal recorder: 10 a minute, 50 a run, the 60,000 ms window | gateway/refusal.ts | 3 | 1 survived (the window edge); killed by `refusal-recorder.test.ts` |
| Dollar cap: spend at the cap, the worst case on the cap, the stop | gateway/server.ts | 3 | all 3 survived; killed by `usd-cap-boundary.test.ts` |
| Per-run token cap | gateway/server.ts | 1 | killed by `token-cap-boundary.test.ts` |
| In-run ladder: 5 and 8 refusals, the 600,000 ms window | circumvention.ts, gateway/server.ts | 6 | all survived; killed by `escalation-ladder.test.ts` |
| Outbound scan lengths: card 13 to 19, phone 9 to 15, IBAN 15 to 34 | gateway/outbound-scan.ts | 7 | all survived; killed by `outbound-boundary.test.ts` |
| Daily, monthly, wake and sender ceilings and the tokens left | daily-ceiling.ts | 6 | none survived once `daily-ceiling-boundary.test.ts` existed (the new test is the evidence; the old tests did not state the equality case) |
| Untrusted-flow: token 6, opaque 32, five reported | gateway/untrusted-flow.ts | 6 | all survived; killed by `untrusted-flow.test.ts` |
| Decode scan: base64 runs of 16 | gateway/decode-scan.ts | 2 | killed by `decode-scan.test.ts` |

**Equivalent mutants (not killable):** `looksText` in `decode-scan.ts` requires 4 printable characters; its callers only pass runs that decode to 8 or more, so `> 4` and `>= 3` cannot change an outcome. In `circumvention.ts` the in-run ladder's tie rule (`n >= retry`) only changes which scope the message names.

**A limit found on the way:** a base64 payload of 11 bytes or fewer pads to 15 data characters and is not decoded (the run must be 16 characters before the padding). A command that short (`curl x.co/a`) is read as written, not decoded; the Mandate bounds it. Stated in `decode-scan.test.ts`.

## Second pass (same day)

| Limit | File | Mutants | Result |
|---|---|---|---|
| The run's token ceiling from the tokens left of the agent's daily cap and the sponsor's cap (the lower wins) | cli.ts (gateway command) | 4 | 3 survived (nothing tested that the remainder becomes the run's ceiling); killed by `sponsor-cap.test.ts` (25 left, ten a call, three answers) |
| Private memory: 256 KiB a scope, 16 scopes, the new-scope test | private-memory-run.ts | 3 | none survived |
| Ladder file: missing is none, unreadable or unknown is tighten, the five steps | ladder-file.ts | 5 | 1 survived: the `typeof step === "string"` guard is equivalent (`includes` is false for a non-string) |
| Roles and the irreversible gate scopes | gateway/roles.ts | 8 | 1 survived (policy scopes dropped when action_classes is present); killed in `roles.test.ts` |

## Third pass (same day)

| Limit | File | Mutants | Result |
|---|---|---|---|
| Workflow step checks, terminal state, the step reaching the Action, the cool-off bounds 1 to 604800 | cli.ts | 8 | 2 survived (the cool-off bounds were tested with a contract that did not exist); killed by `workflow-gateway.test.ts` with an exact 0, 1, 604800, 604801 |
| Standing budget warnings: level 80, the cap at equality, the percentage rounded down, day and month apart | budget.ts | 8 | none survived the new `budget-boundary.test.ts` except one equivalent: a cap of 0 cannot be set (a cap is a whole number of at least 1) |
| Run-log retention: the notice when logs are deleted, none when nothing was | cli.ts | 5 (2 skipped: the pattern occurs twice) | 1 survived (the notice only needed to say exactly "deleted 1 run log"); killed. One equivalent: `if (!days) return 0` (without a period the cutoff is NaN and nothing is deleted anyway) |
| The price table (each family, mini against big, case, unknown model priced high), overrides, cache costing at 0.1 and 1.25, the worst case (ceil of one token a three characters, 4096 default, never under 1) | gateway/pricing.ts | 21 | 4 survived (case flags of two families, the mini lookahead); killed by `pricing-boundary.test.ts`; one equivalent (the lookahead after gpt-4o: the mini family is matched first) and one (a type check that a non-string never matches anyway) |
| The refusal-rule classifier (every phrase of every class, the order of the classes, case) | gateway/refusal.ts | 25 | none survived the new case in `refusal-recorder.test.ts` |
| The loop breaker: equivalent calls, depth and what resets it, near repeats and their window (24 by default), the daily token cap at equality, the lower of the Mandate's and the fleet's limit, a kept halt | agent-guards.ts | 12 | 2 survived (the default window and the window edge); one killed by exact 21-and-22 and 3-call tests, one equivalent (the shift edge: the count reads only the last w-1 calls) |
