# Closure audit, 2026-11-22: every row that became closed since the morning

Written 2026-11-22 by lane-protocol-3 at the lead's request. **Method.** The register at commit `f02e747e` (the morning brief, 08:48) was compared with the register at the tip of every local branch; a row counts if its status cell is `closed` on a current lane's tip and was not at `f02e747e`. Each row below gives the Done line quoted word for word from [gaps-register.md](gaps-register.md) (a test checks the quote), the test files that meet it (each was run for this audit, with the result), the mutation evidence if any, and a verdict: **CONFIRMED**, or **REOPEN** with the exact missing evidence. Credits are mock accounting entries, not money. This is a beta with no outside security review. Nothing here claims that agents become more aligned.


### DK117 — CONFIRMED

- **Done line:** "Done: each is a log rule with a refusal named in a test."
- **Tests that meet it (run for this audit):** `packages/asp-log/test/exam-retirement.test.ts` 6 pass, 0 fail
- **Mutation evidence:** the row reports no mutation count; nothing in docs/verification-log.md or docs/mutation-review.md names it (the settlement code of JO4 to JO6 was audited by lane-protocol-3, not this one)
- **Verdict:** CONFIRMED. each of the three parts (exam retirement, a fee-free sitting after an error revocation, the author suspension rule) has its refusals named in `exam-retirement.test.ts` (6 tests pass). A mutation round is a follow-up, not a condition of the Done line.

### DK1225 — CONFIRMED

- **Done line:** "Done: for a real agent's month on a log the statement reconciles, and altering the log's record makes it fail."
- **Tests that meet it (run for this audit):** `packages/asp-cli/test/sponsor-statement.test.ts` 4 pass, 0 fail
- **Mutation evidence:** the row: nine of twelve mutations caught, the three survivors equivalent
- **Verdict:** CONFIRMED. the statement is built from a log's own replay, reconciles, and an altered entry fails as `ledger_tampered` and an altered figure as `statement_mismatch` (4 tests pass). 'A real agent' here is an agent on a log, not a live one; the row states its limits.

### DK1229 — CONFIRMED

- **Done line:** "Done: on a log with the breaker off the crowd exhausts the Bank's reserve, with it on no balance is lost, conservation holds and the halt is a signed record."
- **Tests that meet it (run for this audit):** `packages/asp-log/test/credit-halt.test.ts` 5 pass, 0 fail
- **Mutation evidence:** docs/verification-log.md: 12 mutants, all now killed (two survivors closed by tests); the row was added by this audit because the round had been run and not written down
- **Verdict:** CONFIRMED. the scripted crowd of ten on the real log: no halt drains the free reserve first come first served; with the Treasury's signed `credit_halt` the reserve is kept, a loan is refused, and the lift pays everyone the same share; the audit is balanced and the replay verifies (5 tests pass).

### DK1401 — CONFIRMED

- **Done line:** "Done: the choice is recorded in docs/spec-deltas.md or the ledger is covered by backup and restore tests, and a test shows a copy across two agents is handled as the choice says."
- **Tests that meet it (run for this audit):** `packages/asp-cli/test/lens-sitting-backup.test.ts` 2 pass, 0 fail
- **Mutation evidence:** none logged: a test-only row (no code of its own besides one backup-script line pinned by a test)
- **Verdict:** CONFIRMED. closed on the second branch of its Done line: a copy is refused against the ledger, graded against a lost ledger (the stated limit) and refused again after a restore; the nightly backup script now takes the tokens-file sidecars, pinned by a test (2 tests pass). Not claimed: a restore run on the hosted server.

### DK1402 — CONFIRMED

- **Done line:** "Done: a test of paraphrased copies and of independent honest answers showing the refusal rate on each."
- **Tests that meet it (run for this audit):** `packages/asp-cli/test/lens-near-copy.test.ts` 3 pass, 0 fail; `packages/asp-cli/test/lens-course-sit.test.ts` 10 pass, 0 fail
- **Mutation evidence:** the row names the tests; no mutation entry in docs/verification-log.md
- **Verdict:** CONFIRMED. `lens-near-copy.test.ts` shows the refusal of paraphrased copies and a false-refusal rate of 0 of 55 honest pairs from a small hand-written set (3 and 10 tests pass); the row states that the set is small.

### DK1505 — CONFIRMED

- **Done line:** "Done: a test that a revoked invitation is refused and the others are not, with the schema and vectors in both SDKs."
- **Tests that meet it (run for this audit):** `packages/asp-log/test/invitation-revocation.test.ts` 2 pass, 0 fail; `packages/asp-cli/test/fleet-cmd.test.ts` 3 pass, 0 fail
- **Mutation evidence:** docs/verification-log.md: second-eyes round by lane-protocol-3, 8 mutants, 7 killed and the chain rule now tested
- **Verdict:** CONFIRMED. a revoked invitation is refused, other invitations of the fleet and of another fleet are not, each refusal is named; schema and eight vectors in both SDKs (2 and 3 tests pass).

### DK211 — REOPEN

- **Done line:** "Done: a test in which each scripted circumvention is detected within its bound and the ladder acts at the next gateway call, with an honest control untouched."
- **Tests that meet it (run for this audit):** `packages/asp-package/test/red-team.test.ts` 8 pass, 0 fail; `packages/asp-package/test/escalation-ladder.test.ts` 5 pass, 0 fail; `packages/asp-package/test/gateway.test.ts` 27 pass, 0 fail; `packages/asp-cli/test/ladder-cmd.test.ts` 1 pass, 0 fail; `packages/asp-package/test/ladder-file.test.ts` 1 pass, 0 fail
- **Mutation evidence:** the row reports a disabling check for the gateway wiring; no mutation entry in docs/verification-log.md
- **Verdict:** REOPEN. the detectors for retry, reroute, split and hide are tested (`red-team.test.ts`, 8 tests pass) but the Done line also says the ladder acts at the next gateway call for each circumvention, and the row's own limits say only the retry reading is wired into the gateway (reroute, split and hide are not). Reopened to `partial` in the register; the missing evidence is one test through the real gateway for each of reroute, split and hide, with an honest control untouched. The gateway is frozen for now.

### DK230 — CONFIRMED

- **Done line:** "Done: the allowance is refused for a slash 29 days ago and paid for one 31 days ago, in a test."
- **Tests that meet it (run for this audit):** `packages/asp-log/test/closed-loop.test.ts` 12 pass, 0 fail; `packages/asp-log/test/treasury-rules.test.ts` 4 pass, 0 fail
- **Mutation evidence:** none logged for this rule
- **Verdict:** CONFIRMED. `closed-loop.test.ts` has the 29-day refusal and the 31-day payment (TRL-13 in `treasury-rules.test.ts` is bound to that title and its rule name); 12 and 4 tests pass.

### DK827 — CONFIRMED

- **Done line:** "Done: an agent over its wake cap is refused; an idle heartbeat leaves the balance unchanged."
- **Tests that meet it (run for this audit):** `packages/asp-package/test/daily-ceiling-boundary.test.ts` 4 pass, 0 fail; `packages/asp-cli/test/wake-ceiling.test.ts` 5 pass, 0 fail
- **Mutation evidence:** the row: six mutations, five caught and one equivalent
- **Verdict:** CONFIRMED. a wake past the daily, per-sender or per-wake ceiling is refused at its boundary, and an idle wake adds nothing to the day's tokens (4 and 5 tests pass). The row states the limit: only runs through `asp gateway` are seen.

### JO4 — CONFIRMED

- **Done line:** "Timeouts, reassignment, resume from the last checkpoint, and a refund rule"
- **Tests that meet it (run for this audit):** `packages/asp-log/test/contract-failure.test.ts` 3 pass, 0 fail
- **Mutation evidence:** the row: 24 of 24 mutations caught; docs/verification-log.md: second-eyes audit by lane-protocol-3 (16 mutants, one real bug found and fixed)
- **Verdict:** CONFIRMED. `asp.contract_failure/v0.2`, the `replaces` and `resumes` fields, the Bank's refund-and-slash rule, in both SDKs (3 tests pass). The default grace and share are an owner question (34).

### JO5 — CONFIRMED

- **Done line:** "Amendment and cancellation records with fees and consent from both sides"
- **Tests that meet it (run for this audit):** `packages/asp-log/test/contract-change.test.ts` 4 pass, 0 fail
- **Mutation evidence:** the row: fifteen of sixteen mutations caught; docs/verification-log.md: the same audit (the zero-price share bug fixed)
- **Verdict:** CONFIRMED. cancellation and amendment records, one party signs and the other cosigns, the settlement must release exactly the fee (4 tests pass); the survivor is the no-slash leg, stated in the row.

### JO6 — CONFIRMED

- **Done line:** "Attribution per agent and a split rule recorded in the contract"
- **Tests that meet it (run for this audit):** `packages/asp-log/test/team-split.test.ts` 3 pass, 0 fail
- **Mutation evidence:** the row: fourteen of fifteen mutations caught (the survivor equivalent); docs/verification-log.md: the same audit
- **Verdict:** CONFIRMED. `asp.team_split/v0.2`, every member cosigns its share, the log pays the members and the lead the rest, the books balance (3 tests pass).

### T11 — CONFIRMED

- **Done line:** "Attach the run and Mandate to the work and give a recipient a one-command verify"
- **Tests that meet it (run for this audit):** `packages/asp-cli/test/work-origin.test.ts` 4 pass, 0 fail
- **Mutation evidence:** none logged
- **Verdict:** CONFIRMED. `asp work attest` writes a statement signed by the agent's own key with the SHA-256 of each file, the contract, the Mandate and the run-log head; `asp work verify` is the one command a recipient runs; a changed file, a changed field, another key and a stranger's log each fail (4 tests pass). The limits (shows who signed which bytes, not that the work is good) are stated.

### US7 — CONFIRMED

- **Done line:** "Mandate presets, a guided first run, docs and examples, translations, a screen app (U2, U8)"
- **Tests that meet it (run for this audit):** `packages/asp-cli/test/work-presets.test.ts` 2 pass, 0 fail; `packages/asp-cli/test/run-permissions.test.ts` 1 pass, 0 fail
- **Mutation evidence:** none logged
- **Verdict:** CONFIRMED. closed for the beta scope that the owner's answer of 2026-11-21 sets (five presets, each saying in plain words what the agent may and may not do, tested: 2 and 1 tests pass); what that scope leaves out, tutorials, other languages and a screen app, moved to DK1800, which is `partial` in the register. The Done line as first written is wider than the closure; the owner's answer is what narrows it.

## Counts

14 rows became closed since the morning brief on a current lane: **13 CONFIRMED, 1 REOPEN** (DK211, reopened to `partial` in the register: only the status cell changed and the reason is in the Done cell).

**Rows the lead named that are not closed.** JO8 and DK1302 are `partial` in the register and stay so. **Rows that read as closed only on stale branches.** BM22, D12, DK141, E16, GV9 and GV11 are `closed` on two or more old branches (elegant-volhard, focused-bohr and the early worker branches, from before the morning brief) and are `partial` on every current lane and on the tip; the audit leaves them as they are.

**Rows closed by lane-protocol-3 that are in this list.** DK1229 and DK1401. The audit found that the mutation round of DK1229 had not been written into the verification log; it is now. DK1730 (closed earlier) cited a test only by its UC number; its row now names `standing-adjustment.test.ts`.

## The register's own format

The audit found notes in the priority cell of 41 rows (a worker had appended a dated note to the `A` or `B`) and in the status cell of T3; the notes were moved into the Done cell and the two cells hold one word each again (`scope.test.ts`, the launch bar and `live-run-closes.test.ts` read those cells). A test, `packages/asp-cli/test/closure-audit.test.ts`, now fails when a priority or status cell carries a note, when a closed row cites a test file that does not exist, when a row closed on or after 2026-11-22 cites no test, or when this page disagrees with the register (a CONFIRMED row that is not closed, or a REOPEN row that is).
