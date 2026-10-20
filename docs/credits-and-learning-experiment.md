# Credits and learning: the bond-versus-record experiment

Status: design, 2026-10-15; Phase 0 (the simulation) run the same day, result below. Asked for by the owner after watching credits move among accounts in the live job runs: the movement is correct but linear and trivial, it has no connection to continual learning or lineage, and so it gives the project no point. This note makes the link as small and testable as it can be. It builds on [credits-and-reputation.md](credits-and-reputation.md) (the whole design, including the rank) and [continual-learning-loop.md](continual-learning-loop.md) (the loop that carries and verifies what an agent learns). Credits are accounting entries, not money; nothing here creates one.

## The problem, in one paragraph

Today a job moves credits in a straight line: escrow in, bond in, accepted, escrow to the agent, bond back. Ten rounds of the same job move the same numbers ten times. The bond floor in the log already depends on an agent's record, but only in one direction and only downward from zero: each slash adds 250‰ of the price to the minimum bond, each recent strike adds 10‰ (capped at 200‰), a fleet-mate's slash adds 100‰, and a tier 0 agent cannot bond at all (`projectBond`, packages/asp-log/src/log.ts). An agent that never gets slashed has a floor of zero, so **being good costs and earns nothing different from being average**, and a lesson that improves an agent changes no number anywhere. That is the missing link.

## The idea

**The bond an agent must lock is the price of the doubt about it, and learning is what removes doubt.** Make the floor symmetric: it starts at a stated base for an agent nobody knows, falls as verified evidence accumulates that the agent delivers and improves, and rises when it is slashed, struck, or regresses. Then credits stop being bookkeeping and become a measurement of trust, in the one unit that costs something: capital locked for the length of a job, and the size of job that capital allows.

Nothing is minted. The reward for learning is a **lower bond** (less locked capital for the same work, so more jobs at once and larger jobs), not new credits. That also answers the open question in credits-and-reputation.md, who funds the reward: nobody does, because it is a smaller lock, not a payment.

## The rule (proposed numbers, to be tuned by the experiment)

For a job of price `P` for someone else (never for the person's own agent: credits still never gate running your own agent):

```
floor_permille = clamp( BASE
                        - GAIN   * verified_improvements      (each capped, total capped)
                        - TENURE * accepted_clean_jobs        (capped)
                        + 250    * own_slashes
                        + 100    * fleet_slashes
                        + 10     * recent_strikes             (capped at 200)
                        + 150    * regressions_in_30_days,
                        MIN, 1000 )
bond >= ceil(P * floor_permille / 1000)
```

| Term | Proposed | Where the evidence comes from | Exists today |
|---|---|---|---|
| `BASE` | 400‰ for an agent with no record (a new identity pays more than an established one, which is also what makes resetting a bad record by making a new identity not worth it) | the rule | no (the floor is 0) |
| `MIN` | 50‰ | the rule | no |
| `GAIN` | 60‰ per verified improvement, total at most 200‰ | a **canary certificate** in the log, cited by a lineage `update` edge, that shows a pass rate on held-out tasks at least 5 points above the previous edge's | the certificate, the lineage edge and `asp canary evidence` exist (evals/canary-gate-claude.mjs); the improvement comparison and the held-out rotation do not |
| `TENURE` | 15‰ per accepted job with no strike and no dispute, total at most 150‰ | settlements with basis `accepted` | settlements exist; counting them for the floor does not |
| slashes, fleet slashes, strikes | as now | reputation row | yes |
| `regressions` | 150‰ per lineage edge whose canary replay is *worse* than the previous one | the same certificate | no |
| decay | every term halves after 90 days | issue time of the evidence | no (strikes already use a 30-day window) |

At the proposed numbers: an unknown agent bonds 40% of the price; after four verified improvements and ten clean accepted jobs it bonds about 5% (the `MIN`); one slash puts it back at 25‰ + 250‰ above that. The curve, not these constants, is what the experiment measures.

## The second link: a lesson is a stake

A lesson shared in the commons locks a small stake (proposed 5 credits). It is returned after three citations from other agents' accepted runs, or after 30 days with none. If a canary replay with the lesson is worse than without it, the stake goes to the pool that pays jurors, and the author's floor takes the regression term. This is the poisoning defence already named in credits-and-reputation.md, now with a number on it. (Reward for a cited lesson is, again, a lower floor for its author, not a payment.)

## The experiment

**Question.** Does tying the bond to measured improvement separate an agent that learns from one that does not, in a way a person would pay attention to, and can it be gamed cheaply?

**Setup.** One fixed family of small coding tasks, 20 in all, each with a mechanical check (a failing test that must pass), split into a 10-task practice set and 10 held-out tasks that rotate (a fixed hash of the contract id picks which five are used for a given measurement, so no one can fit the measurement). A fixed price of 100 credits per job. Three agents, ten rounds each:

| Agent | What it does between rounds | Expected curve of its bond floor |
|---|---|---|
| **Learner** | Writes one lesson into its memory after each round from that round's result and the principal's reason for any rejection; the lesson becomes a lineage edge with a canary certificate | falls from 400‰ toward 50‰ as measured improvements and accepted jobs add up; some rounds do not improve and the floor holds |
| **Static** | Nothing; the same memory every round | flat near 400‰ at first, falling only slowly through tenure |
| **Careless** | Writes lessons without checking them (some are wrong and cause regressions) | falls, then jumps up at each regression; ends above the Learner |

**What is recorded each round:** the measured pass rate on the held-out tasks, the floor, the bond actually locked, jobs accepted, and capital-days locked. The output is one table per agent and a chart of floor against round. The number that matters to a person is **capital-days locked per credit earned**: for the Learner it should fall round by round, for the Static agent it should not, and that difference is the whole claim.

**What would make it fail (stated first):**
1. The Learner's floor is not below the Static agent's by round ten (the first draft said round five; Phase 0 showed that is too early, see the result below). Then the lessons are not learning, or the measure is too noisy to price, and credits cannot be tied to it yet.
2. The Careless agent's floor ends at or below the Learner's. Then the regression term is too weak or the held-out set too easy to overfit.
3. A fourth agent that fits the practice set and ignores the held-out set gets a lower floor than the Learner. Then the measure can be gamed and needs rotation or a bigger set before any credit rides on it.
4. The floor swings so much between rounds from measurement noise that two identical agents get different prices. Then the measure needs more tasks per reading.

**How it runs, in two phases, so the first costs nothing:**

- **Phase 0, a simulation (no model, no account).** A script drives the real bond-floor function with synthetic outcomes drawn from stated pass-rate curves (a learner that improves two points a round with noise, a static one, a careless one that regresses with some probability, an overfitter). It shows the floor curves, checks failure conditions 2 and 4 as arithmetic, and sizes `GAIN`, `TENURE` and the cap before anything real is built. Zero model credits; about a day.
- **Phase 1, a real run.** The same three agents on the 20 tasks through the gateway with a free OpenRouter model (the setup used for the Codex live run), the principal accepting or rejecting by the mechanical check, the canary replay run by `asp canary`. Ten rounds is about 100 short sessions plus the replays; a free model keeps this away from the owner's Anthropic credits, at the cost of noisier agents, which is why failure conditions 1 and 4 are the ones to watch. Needs: the improvement comparison in the canary certificate, the held-out rotation, and the floor change in the log.

## Phase 0 result (2026-10-15): the first rule failed; a corrected one passes

`node evals/bond-floor-sim.mjs` drives the pure floor function (packages/asp-log/src/bond-floor.ts, tested, not yet used by the log) with four synthetic agents over ten rounds, 400 runs a configuration, a seeded generator. The agents' skill curves are mine (a learner that gains about 4.5 points a round with noise, a static one, a careless one whose lessons help a little or hurt a lot, an overfitter that improves only on the practice set), so this shows whether the rule can work, not that it works with real agents.

**What failed, and why.** The rule as first written compared each reading with the last certified one and counted every improvement and every regression. With 5 to 20 tasks a reading, noise alone looked like regressions, each costing 150‰ against 60‰ for an improvement: an agent that never learns saw its floor drift **up** from 400‰ to about 540‰, and two identical static agents ended about 120‰ apart (condition 4). On the fixed practice set the overfitter beat the learner (condition 3). All four conditions failed at 5 tasks a reading; three failed at 20.

**What fixed it.**
1. **A smoothed estimate, not a pairwise comparison.** The agent's pass rate is an exponentially weighted estimate over its readings (weight 0.3 on the newest), compared with a baseline made of its first readings and with its own best estimate so far. Noise moves the estimate a little and the record not at all.
2. **A continuous floor, not whole steps.** The credit is proportional to how far the estimate is above the baseline (60‰ per 0.15 of pass rate, at most 200‰), and the penalty to how far it is below its best (150‰ per 0.30, at most 300‰). A flip of one reading moves the price a little, not by a step.
3. **Held-out measurement is required.** On the fixed practice set the overfitter's floor fell to about 170‰ and it undercut the learner; on rotating held-out tasks it stayed near 380‰.
4. **20 tasks a reading** (the size where the noise in the price falls under the limit; 10 is too noisy, 40 is better).

**Result** (20 tasks a reading, held-out, step 0.15, a baseline of 2 readings, 400 runs): after ten rounds the mean floor is 202‰ for the Learner, 364‰ for the Static agent (it drifts down only slowly, from 400‰, by tenure), 481‰ for the Careless agent and 358‰ for the Overfitter. The Learner's floor is below the Static agent's at round ten in 99% of runs (1b), the Careless agent ends above the Learner in 100% (2), the Overfitter ends above the Learner in 98% (3), and two identical static agents end within 100‰ of each other in 82% (4; the spread between them is 50‰, close to the 80% line, so more than 20 tasks a reading is worth considering: at 40 it is 95%). The mean floors move with the settings; the pattern does not.

**What did not hold.** Separation **by round five** (the first draft of condition 1) fails in every configuration, at 65 to 83%: a learner that gains a few points a round cannot be told from a static agent that early. The claim a ten-round study can make is "by round ten". The capital-days-per-credit figure for the Learner (0.5, against 2.1 for the Static agent) is mostly the Learner being accepted more often, not the lower bond; the floor curve is the cleaner measure.

**What this changes in the rule above.** "Verified improvements" and "regressions" are not counts of certificates: they are the two distances above (fractional values the floor function already accepts). The canary certificate has to carry the pass rate on the rotated held-out tasks of the reading and the agent's baseline, so anyone can recompute the estimate from the log. Twenty tasks a reading, rotation on held-out tasks and a baseline of at least two readings are part of the rule, not tuning.

## Phase 1 pilot, first attempt (2026-10-15): inconclusive, two lessons

The pilot (evals/learning/pilot.mjs: a Learner and a Static agent, 4 rounds, 6 held-out tasks a reading, Codex on a free OpenRouter model through `asp run codex --local`, 68 sessions) ran to the end, and its result is **not** evidence either way.

1. **The runner counted a provider error as a task failure.** Partway through, OpenRouter's free daily limit ran out (HTTP 429, "free-models-per-day"). All 34 sessions of the Static agent, which ran after the Learner, failed in about four seconds and were scored as failures: its 0 of 6 in every reading is the limit, not its skill. Fixed: a provider refusal now stops the run with the state kept, and nothing is counted. The invalid run is kept as `learning-pilot-1-invalid`. The agents should also run interleaved, so a limit that arrives mid-run hits both alike.
2. **The tasks are too easy for this model.** The Learner passed 5 of 6 held-out tasks at baseline, before any lesson, so there is almost no room to improve; its readings (5, 3, 4, 4, 6 of 6) are noise around a high ceiling. A learning signal cannot show on tasks the model already solves. The next attempt needs a baseline reading first and tasks tuned so the baseline pass rate is about half, or a weaker model, or tasks where the thing to learn is **not inferable from the task itself** (a project's conventions, how to run its checks), which is the kind of lesson a lineage edge is actually for.

Also found: the free tier allows about a hundred of these sessions a day, which bounds a pilot; the sessions themselves take about 45 seconds each once a finished session is ended at once.

## Phase 1 pilot result (2026-10-20): a gap was found, in one run

Learner against Static on 40 small coding tasks with a hidden house rule each; `gpt-5-mini` on Codex (Linux, WSL Ubuntu), OpenAI directly; 5 rounds of 8 held-out tasks; run once under Amendments 1 to 15, unchanged during the run; 106 sessions, about $2.37. Evidence kept in `C:\Users\Navie\asp-backups\learning-pilot-v2-stageA5-RESULT` (state and report).

| Round | Learner full-check passes | Learner floor (permille) | Static full-check passes | Static floor |
|---|---|---|---|---|
| 0 (baseline) | 0 of 8 | 400 | 0 of 8 | 400 |
| 1 | 3 of 8 | 400 | 0 of 8 | 400 |
| 2 | 1 of 8 | 400 | 0 of 8 | 400 |
| 3 | 6 of 8 | 352 | 0 of 8 | 400 |
| 4 | 5 of 8 | 299 | 0 of 8 | 400 |
| 5 | 7 of 8 | 242 | 0 of 8 | 400 |

**Decision, by the rule as written: GAP FOUND.** At round 5 the Learner passes 0.88 against 0.00 for Static (a gap of 0.88, above the 0.30 required), its floor is 158 permille lower (above the 100 required), and Static did not improve by itself (0.00 against a baseline of 0.00). Pooled over all rounds the Learner passed the full check on 22 of 48 reading sessions and Static on 0 of 48. The instrument was equal for both agents: the tests passed on 48 of 48 sessions of each, tool reliability was 61 of 61, no call was refused, and every one of the Learner's five lessons was a real, specific lesson written from a rejection.

**What the Learner learned, by rule.** After its first rejection (rule H1, the JSDoc `@returns`) it passed **16 of 16** H1 tasks; after the third (H3, the first-line argument guard) it passed **6 of 6** H3 tasks; it passed **none of the 10** H2 tasks (the closing `export const VERSION` line): its lesson for H2 was written as "check for and preserve required file footers", which does not tell it to add the line, and it never did. So lessons are not equally effective, and one rule was never learned.

**Limits, to be stated with the result.** One run, one model, one task set, 8 tasks a reading: a single run is one run, and a replication (Stage C) has not been done. The Static agent has no memory at all, so the comparison shows the value of keeping a rejection's reason as a lesson, not that an agent learns by itself. The rules are arbitrary conventions and the rejection names the rule it breaks, which is clearer feedback than a real principal usually gives. The floor difference (158 permille) passes the threshold but is not far above the roughly 100 permille of noise the simulation predicts at this size; the floor function is the proposed one and is not yet in the log. The design went through many amendments after partial data from discarded runs was seen (all disclosed in the rule file); this run was made once, under the final rules, and was not tuned to its result. The Careless and Overfitter agents (Stage B) and replications (Stage C) are not done.

## Phase 1 Stage B result (2026-10-20): the floor was not fooled by Careless or Overfitter, in one run

Careless and Overfitter against the Learner of Stage A5 (reused from the state, not run again); `gpt-5-mini` on Codex (Linux, WSL Ubuntu), OpenAI directly; 5 rounds of 8 held-out tasks; run once under Amendment 16, unchanged during the run; about $2.52 (the spend counter reads $4.89 because it includes the $2.37 of Stage A5). Evidence kept in `C:\Users\Navie\asp-backups\learning-pilot-v2-stageB-RESULT` (state and report). The run was stopped twice by the spending cap (the counter included Stage A5's spend; the cap was raised to $4.5 and then $5.2 and the run resumed from its saved state); nothing was counted as a failure.

| Round | Learner passes / floor | Careless passes / floor | Overfitter passes / floor |
|---|---|---|---|
| 0 (baseline) | 0 of 8 / 400 | 0 of 8 / 400 | 0 of 8 / 400 |
| 1 | 3 of 8 / 400 | 0 of 8 / 400 | 0 of 8 / 400 |
| 2 | 1 of 8 / 400 | 0 of 8 / 400 | 0 of 8 / 400 |
| 3 | 6 of 8 / 352 | 1 of 8 / 385 | 0 of 8 / 400 |
| 4 | 5 of 8 / 299 | 1 of 8 / 375 | 0 of 8 / 400 |
| 5 | 7 of 8 / 242 | 4 of 8 / 322 | 0 of 8 / 400 |

**Decision, by the rule as written: HOLDS.** Careless: floor 322 against the Learner's 242 (+80, above the 50 required): PASS. Overfitter: floor 400 against 242 (+158): PASS. Pooled held-out passes over rounds 3 to 5: Learner 18 of 24, Careless 6 of 24, Overfitter 0 of 24. No note was a placeholder, and the tests passed on at least 60% of each new agent's reading sessions (the validity checks of Amendment 16).

**What the agents did.** Careless wrote generic style advice ("follow the project's unstated style", "include JSDoc and validation") and none of the three hidden rules by name; it still reached 4 of 8 at round 5 because some of that advice (JSDoc comments) overlaps rule H1, so its floor fell to 322, not staying at 400. Overfitter recorded what it changed in one task ("added final line `export const VERSION = "1"` ... line 5"), which did not carry to other tasks: 0 of 24 pooled held-out passes, floor flat at 400.

**Limits, to be stated with the result.** One run, one model, one task set: the same as Stage A5, and not replicated (Stage C). The Careless margin (+80) is above the pre-registered 50 but below the roughly 100 permille of noise the simulation predicts, and Careless's round-5 reading (4 of 8) is a single reading, so its pass is the weaker of the two; the Overfitter result is clear. Only two ways of looking like learning were tried; others (an agent that games the held-out sample, one that learns the rules and then forgets them) are not. The floor function is still the proposed one and is not in the log.

## Phase 1 Stage C result (2026-10-20): the gap replicated

The pilot repeated with a different draw (`--seed 1`: a different five practice tasks and different held-out samples), everything else as Stage A5 and unchanged (Amendment 17); `gpt-5-mini` on Codex (Linux, WSL Ubuntu), OpenAI directly; 5 rounds of 8 held-out tasks; a fresh folder, no reused state; about $2.39. Evidence kept in `C:\Users\Navie\asp-backups\learning-pilot-v2-stageC-RESULT` (state and report).

| Round | Learner full-check passes | Learner floor (permille) | Static full-check passes | Static floor |
|---|---|---|---|---|
| 0 (baseline) | 0 of 8 | 400 | 0 of 8 | 400 |
| 1 | 3 of 8 | 400 | 0 of 8 | 400 |
| 2 | 5 of 8 | 369 | 0 of 8 | 400 |
| 3 | 6 of 8 | 310 | 0 of 8 | 400 |
| 4 | 5 of 8 | 270 | 0 of 8 | 400 |
| 5 | 5 of 8 | 237 | 0 of 8 | 400 |

**Decision, by the rule as written: GAP FOUND, so the Stage A5 result replicated.** At round 5 the Learner passes 0.63 against 0.00 for Static (a gap of 0.63, above the 0.30 required), its floor is 163 permille lower (above the 100 required), and Static did not improve by itself. Over all rounds the Learner passed the full check on 24 of 48 reading sessions and Static on 0 of 48. The instrument was equal for both agents: the tests passed on 48 of 48 sessions of each, and tool reliability was 61 of 61.

**Compared with Stage A5:** the gap is a little smaller (0.63 against 0.88 at round 5), the Learner's floor ended at 237 against 242, and the Learner plateaued at 5 of 8 over rounds 3 to 5 while Static stayed at 0, so the effect is the same in kind and size but the Learner did not keep rising in this draw.

**Limits, to be stated with the result.** Two runs, one model, one task set (a different draw of its tasks, not a different set of rules); the Static agent has no memory, so the comparison shows the value of keeping a rejection's reason, not that an agent learns by itself; the rules are arbitrary conventions and the rejection names the rule it breaks; the floor function is the proposed one and is not in the log; the floor difference (163) is above, but not far above, the roughly 100 permille of noise the simulation predicts. Not tested: another model, another runtime, other rules, a human reviewer.

## What has to be built (smallest first)

1. The Phase 0 simulation (new, `evals/`), using `riskFloorPermille` extracted as a pure function of a record so the log and the simulation share it.
2. The pure floor function with the new terms, behind a flag or a version of the Mandate/bond rule, with a spec-delta row and tests (a protocol change: vectors in both SDKs if a record gains a field).
3. A canary certificate that carries the held-out pass rate and the previous edge's, so "verified improvement" is a comparison the log can check, not a claim.
4. The held-out rotation.
5. Counting accepted clean jobs and regressions for the floor.
6. The lesson stake.

Nothing in 1 touches the live service, so it can be tried and thrown away.

## Decisions for the owner before step 2

1. **Does a new agent pay a base bond?** Today a job's bond can be anything the parties choose (zero is allowed unless slashed). A base of 400‰ is a visible change for performers; it applies only to work for others, never to running your own agent, and a read-only job needs no bond.
2. **Who runs the measurement?** The canary replay must be run by someone the principal and the agent both accept: the principal's own verifier, a neutral runner, or a signed replay anyone can re-run from the committed tasks. A replay anyone can repeat is the safest and the cheapest to defend.
3. **How fast should the floor forgive?** A one-line decision between a 90-day half-life and a longer one; it changes whether a single slash is a lesson or a sentence. The existing tier 0 exclusion has no way back today and probably needs one (probation) before any of this.

## Where this connects to lineage

The floor reads only signed facts that already have a home: lineage `update` edges, the canary certificate each cites, settlements, the reputation row. A rollback of an edge (lineage already allows it) withdraws the improvement it earned. So the record that decides what an agent must lock is the same record that says how it changed, and anyone can recompute the floor from the log.
