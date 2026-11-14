# Closure audit

Register rows closed by mapping or by pointing at older tests are not real closures. This page records each audit: which rows were read against their Done criterion and the tests they cite, what the verdict was, and what was done. A verdict is "holds" (the cited tests prove every part of the criterion; nothing added), "reopened" (a part is not proved: the row went back to `partial` with a "Left:" sentence and, where needed, a new split row) or "note" (it holds, with a limit worth knowing).

## 2026-11-15, batch 1 (rows closed 2026-11-14 and 2026-11-15)

Method: for each row the closing commit (`git log` on `docs/gaps-register.md`) was found and its changed files listed; the row's Done criterion (or, where it has none, its Needs column) was read; each cited test file was opened and its test names read against each part. Where a test file was added in the closing commit this is stated; where the closing commit changed docs only, the cited tests are older and were read for what they actually prove.

| Row | Closed by | Verdict | What was found, and what was done |
|---|---|---|---|
| D9 | docs only (older `lesson-gate.test.ts`, `memory-gate.test.ts`) | holds | The criterion (evidence, conflicts and an A/B replay before a lesson enters memory) is each a test in `lesson-gate.test.ts`: the evidence rules, the contradiction, the held-out replay, a batch in order, the command door. Nothing added. |
| D12 | docs only (older `private-memory.test.ts`) | **reopened** | The sealing is tested but no run reads or writes memory through it, so the "memory scope private to a principal-agent pair" is a library, not the agent's memory. Back to `partial`; the remainder is DK272. |
| JB6 | new `credit-doors.test.ts` | holds | The test equates the table's numbers with the code's constants and runs a person-posted job through the board and settlement, checking the supply rule at every stop. |
| JB7 | new `cold-start.test.ts` | note | Holds for the measure and the seeded demand; the supply side is "newcomers find jobs", not a recruited supply. Acceptable as the row words it; a survey of why people post is GV15. |
| IS1 | docs only (older `institution-charters.test.ts`, `charters.publish.test.ts`) | holds | Founding, versions with notice, owner co-signature on officers and funding, closing with a reason, and no budget after it are each a test; founding by an agent or person is split as DK397. |
| CY1 | new `institutions-built.test.ts` | note | The test is a mapping (each institution has a spec, a charter, a module, a test file, a map row), but each institution has its own tests, and the selling ones are bought from in a test. Holds. |
| CY2 | new `spend-gate.test.ts` | holds | One test, but it drives each refusal named in the row (not in the Mandate, over the cap, another's Mandate, tier 0, halted) and checks the books. |
| CY3 | new `agent-view.test.ts` | holds | Four tests, including that tool arguments change nothing and that the agent's own system message does not replace the gateway's note. |
| CY14 | new `wake-ceiling.test.ts` | **reopened** | The row asks for wake only on allowed or matching events, per-sender limits and a report; the closing said "for what is built". The allow-list is not built. Back to `partial`; DK388. |
| DK3 | new `agent-purchase.test.ts` | holds | The test states the Done line (a name claim of 10 moves 7, 2 and 1; a Mandate that does not list the institution is refused with the reason). Standing orders and `auto_refund` are beyond the Done line and split as DK390. |
| DK5 | new `autonomy-ladder.test.ts` | holds | A tier 1 agent is refused above its limit, allowed after a recorded promotion, and a promotion cannot be asked for without its certificate. |
| DK6 | new `collusion.test.ts` and CLI test | holds | The Done line (a colluding pair and a ring move no tier, the detector reports them) is one test; the loop rule is tested at its edges (a ring of three to six, 90 days). The farming claim holds for pairs, rings and a sponsor's own agents. A Sybil cohort of unrelated sponsors is not claimed (DK271, DK365). |
| DK41 | new `institution-map.test.ts` | holds | Twelve rows, none pending, each with reads, writes and accounts; every record type an institution owns is named; Housing is bought through the shared path. |
| DK129 | new property test | **reopened** | The accepted deposit return and appeal-fee refund are drawn only as refusals, so the property is not shown over two of the operations the row names. Back to `partial`; DK441 asks for the generator state. |
| DK40 | new `charters.test.ts` | holds | Twelve charters, each passing the checklist. |
| GV1 | new `society-indicators.test.ts` | note | Holds for population, work, disputes, supply, inequality and newcomer survival, with the method beside each. "How happy the citizens are" is not measured and the page says so (GV15). |
| GV9 | new `operator-powers.test.ts` | **reopened** | The row asks for four things; the public log of acts and the limit on each power are built and tested; the succession plan and the hand-over path are not. Back to `partial`; DK421. |
| GV11 | docs only (new `rights-charter.test.ts`) | **reopened** | The test checks that each right names a "Backed by" line and that the files and commands exist; right 8 (a say before the operator acts) is stated as a commitment, not a mechanism. Back to `partial`; new row DK440 (a notice mechanism). |
| BM11 | new `panel-sybil.test.ts` | note | Holds for fronts under one sponsor (the Needs list is "or"); fronts funded from one source were split as DK271 and are now partly built (DK365). |
| T7 | new `agent-remove.test.ts` | holds | The plan, no change from it, the retirement, the Contract refused as retired, the history kept, a DID with no key refused; the leaving note exists. |
| AG9 | new `privacy-line.test.ts` | holds | The line is a document, and the test keeps it true (every named file and test exists; the Action record has no field for reasoning, prompts, replies or memory). The private memory scope is DK272. |
| BM1 | new `shell-scan.test.ts` cases | holds | Each tool in the row is `shell.network` and the local look-alikes are not. What a container does inside is DK280 (live). |
| DK70 | new tests in `economy-slice.test.ts` | holds | The supply page's starter figure equals the sum of starter mint records, a replica agrees, and an unsigned credit shows as inconsistent. |
| DK99 | docs plus the index test `treasury-rules.test.ts` | holds | The Done line allows "a numbered rule with a test, or the document says why not"; the index test fails on a rule with no test, a renamed test or a not-built rule with no reason or row. |
| DK111 | new tests in `closed-loop.test.ts`, `academy-halls.test.ts` | holds | A prize with no season is refused, and the prize tests run on defined seasons. |
| DK113 | new `commons-gate.test.ts` | holds | A poisoned lesson at the commons service is refused with its reasons and shown to its author only. |
| DK195 | new tests in TypeScript and Python | holds | The five safeguards each have a test, and the shared vectors are read by both `telemetry-vectors.test.ts` and `python/tests/test_telemetry.py`. |
| H14 | new `mcp-hosts.test.ts` | holds | Host checks and the rate, in the gateway and both hooks; the fixed-endpoint MCP server is DK240 (live). |

Reopened in this batch: D12, CY14, GV9, GV11, DK129. New rows: DK440, DK441.

## 2026-11-15, batch 2 (rows closed without a new test file, or closed "for" part of their Needs)

Method: every commit since 2026-11-08 that set a register row to `closed` was listed with the test files it added or changed. Rows closed in a commit that added no test file (a documentation commit, a status change, a renumbering) were read against their Done line and the tests they cite; rows closed "for" or "in part" were read against the whole Needs column, because a row that names three things and is closed on two is not closed.

| Row | Closed by | Verdict | What was found, and what was done |
|---|---|---|---|
| DK10, DK12, DK13, DK16, DK17, DK18 | register-text commit only (the tests came with each row on 2026-11-12) | holds | Each row's Done line is a named test in `registry-civil.test.ts`, `registry.test.ts`, `courts-routes.test.ts` or `market-board.test.ts`; the key assertions were found (a forged page found by `registryVerify`, a ruling citing a precedent, `ranking_not_reproducible`, the same input giving the same ranking, 30 trivial jobs adding nothing to standing). |
| CY10 | docs (the tests are CY6's and the rule tests of other rows) | note | Closed by pointing at `reward-farming.test.ts` (six farming strategies, none promotes) and the class, independence and cap tests of other rows; each of those exists. Holds, as a mapping closure whose parts are each tested. |
| DK25, DK26, DK32 | academy docs commit (tests earlier) | holds | The Overfitter and the leaked suite are `exam.test.ts` tests; a colluding pair cannot lift a rank is in `academy-halls.test.ts` (`arena_same_sponsor_opponent`); the lesson gate is `lesson-gate.test.ts`. |
| DK69 | register commit | holds | `qualifying.test.ts` states the Done line (a pair of one sponsor exchanging 30 jobs lowers nothing; independent principals do). |
| DK72 | register commit | holds | The tier-limit case in `economy-slice.test.ts` (caps summing to 101 refused, 100 accepted). |
| DK112 | tests modified | holds | `memory-gate.test.ts` covers the runtime write refused with its reason, the screen before write-back, and the misses listed with a count (6 of 14, `docs/gate-evasions.md`). |
| DK130 | tests modified | holds | `forum.test.ts` (moderation) covers each clause of the Done line. |
| DK15 | tests modified | holds | `treasury-closed-loop.test.ts` and `treasury-statement.test.ts`: every institution has a budget line and the statement shows income and spending. |
| DK184, DK396 | tests modified | holds | The Insurer's tools and public pages, and the charter cross-check with the page of all twelve, each have the test their Done line names. |
| BM10, D4, E3 | tests modified, no Done line | holds | The repeat probe is a `watch.test.ts` case; the model digest is in `gateway.test.ts` and `action.test.ts` (and DK399 for a local runtime); the SDK metrics are tested in both SDKs. |
| E4 | tests modified | note | The row's gap ("unusual shapes can get through") is narrowed, not removed: the closing text says masking still is by pattern and entropy. Left closed because the row is Priority B and the terms draft says so; a new pattern is a new test. |
| D6 | new tests | note | Closed "for the first detector": the row's Needs are two (canary tests, flag tool results) and both exist; goal hijacking without such text is DK315. Holds. |
| CY9 | new tests | note | Closed for storage, injection defence and moderation; rent is a price-list item and a recurring rent is DK393. Holds as the Needs words rent (a plot's decor is bought and held); watch DK393. |
| JB4, DK67 | new tests | holds | JB4's allocation modes and automatic flow are tested; DK67 is closed for a log that names an operator, which is the Done line (a replica built from the records alone has the same balances). |
| T26 | new tests | **reopened** | Closed "for the cutover" but the Needs include the decay, improvement and regression terms. Back to `partial`; DK312, DK313. |
| BM22 | new tests | **reopened** | Closed "for the lock and the budget" but the Needs name a model or sandbox check. Back to `partial`; DK352. |
| GV3 | new tests | **reopened** | Closed "for the cold-start mechanism" but the Needs name city-funded public-works jobs and an unemployment floor. Back to `partial`; DK395. |
| GV5 | new tests | **reopened** | Closed "for the first-week route" but the Needs name mentors paid by the apprenticeship scheme. Back to `partial`; DK392. |
| DK183 | tests modified | **reopened** | The Done line is "a test for each" of six loose ends and three have one. Closed "in part" is not closed. Back to `partial`; DK402. |

Reopened in this batch: T26, BM22, GV3, GV5, DK183. No new rows (each remainder already has a split row). Rule going forward: a row whose closing text says "for" a part or "in part" stays `partial` until the rest is closed or its Needs column is rewritten with the owner's agreement.
