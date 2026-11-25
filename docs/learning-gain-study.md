# The learning-gain study: does going through the cards, the papers and the Academy make an agent better? (lead, 2026-11-25)

Status: **S0 (headroom) was run on 2026-11-25; the analysis plan below is fixed from it; S1 (the treatment arms) is next.** No claim of learning is made until S1 and the later steps are run.

## The premise (the owner's words, condensed)

An agent that goes through the continual-learning route (cards found on the map, the insight or paper behind each card, the Academy's check, and the write-back into its memory) **should get better, and the improvement must be substantial**. If it does not, the technical-learning side of the society has no point. So the first job is to test that, properly, before building more.

**Sources (the owner's final rule, 2026-11-25):** a course's anchor is a **published paper or an arXiv preprint** (a preprint is fine; a published venue is not required). An **insight** may also be used, but only from **very credible sources** (for example a major lab's or institution's engineering write-up or documentation, or a named expert's analysis), labelled as an insight and never as a paper. A note, post or cheat sheet from an unknown or weak source is not used as an anchor. Each course records its source type and venue; the audit of the 26 courses is in [lenses/course-sources-audit.md](lenses/course-sources-audit.md).

## What the Academy actually measures (read from the code)

`course_sit` takes the agent's **answer as JSON in the form the course asks for** (a set of rules, a note, a checklist) and **grades it on held-out tasks** drawn from seeds nobody controls, by running a scripted executor that uses the agent's answer. So a gain on the Academy check means **the agent wrote a better artifact** (better rules, a better note) after the card, not that it became generally smarter. That is exactly what continual learning at the memory and skill level is, and it is what the study measures; it must say so.

**Construct match (a finding of the lane while rewriting the cards, 2026-11-25).** The sitting engines test **rule induction, policy writing and grader-suite writing**, not the specific skill each paper teaches. For the eight tranche-1 courses: **three match** their paper reasonably (C-L2-1 lessons from failures, which tests writing a lesson a scripted executor can apply; C-L19-1 AutoManual, which tests writing rules for a peer; C-L11-1 evals, which tests writing a grader suite) and **five do not**: C-L7-1 (calibration: the sitting does not test stated confidence), C-L14-1 (verification: it does not test checking a draft), C-L8-1 (memory: it does not test add, update, delete or no-op on memory), C-L18-1 (macro-economy: it does not test household decisions) and C-L9-1 (SOTOPIA's seven dimensions: it does not test social goals and secrets). For those five a gain on the sitting says the agent learned to write better rules in that domain's clothing, **not that it learned the paper**. So the study labels every row with the construct it measures (**generic rule-writing** or **paper-specific probe**), and the five courses get **paper-specific probes** (a small deterministic task generator and rule-based scorer that measures the paper's own claim, for example expected calibration error on questions with known answers, precision of a list after verification against a fact table, the final state of a memory after a scripted dialogue, goal and secret outcomes against a scripted negotiation partner) before any claim of "learning from the paper" is made for them. This is the first thing the study must fix, because it decides whether the premise is tested at all.

## What "better" means here

1. **Primary:** the agent's score on the course's held-out sitting (0 to 100), against a control, with the repeat spread.
2. **Secondary:** first-try acceptance of real jobs of that kind (the society's own checker), before and after the write-back.
3. **Guard:** no drop on unrelated courses and on the agent's earlier skills (no forgetting; the self-evolving-agents papers warn of exactly this).

## Does a write-back make the agent worse somewhere else? (the regression measure; the full design is in [regression-measurement.md](regression-measurement.md))

The owner asked how the Academy measures the effect of a course, and of what is written back into memory, on everything else the agent can do: a lesson that helps in one domain may hurt in another. **Today the Academy does not measure this across domains.** What exists: (a) the **canary gate** (`asp canary`, built for the real `asp run`, `orchestrate` and `gateway --package` paths): a baseline test set is taken and a memory change that regresses it is refused or flagged, but it is not wired into the cohort and the Academy; (b) the **lesson gate** (deterministic checks of form: evidence, no instruction aimed at the reader), which checks a lesson's shape and not its effect on other skills; (c) the cohort's **harm check** (DK1310): first-try acceptance of jobs before and after an agent first read a lesson, against a control, which is narrow (one job kind at a time, small numbers). What is missing, and is now queued:

1. **An interference arm in the card-effect command** (`--interference`): the artifact written for course A is given to the model as memory while it sits the held-out items of courses B to Z; the score is compared with the same items without it. A drop means the write-back made the agent worse elsewhere. Cheap, and it isolates the effect.
2. **An Academy regression sweep:** after any write-back from a course or a lesson, the agent re-sits a small fixed canary set (3 items from each other course it holds) and the before and after are recorded per course; a drop above a threshold (default 5 points) is flagged in the report and, under `--regression-gate block`, holds the write-back until the owner or a rule releases it.
3. **A forgetting measure over time** (S4): the same canary set after hours, to see whether earlier skills decay.

## Pre-registered success rule (the owner sets the numbers; revised after a power check)

My first suggestion was too strict for a small first run, and the owner was right to say so. The reason is statistical: with ten trials per arm and a typical spread of about 15 points on a 0 to 100 score, the standard error of a difference is about 6.7 points, so even a true gain of 10 points would reach "interval excludes zero" in only about one course in three (power about 0.32). Asking two thirds of courses to pass individually would fail almost surely even when the cards work. With **40 trials per arm** the standard error is about 3.4 and power for a true +10 is about 0.8; the model calls are cheap, so the first study uses **n = 40 per arm** (18 courses, 3 arms, 40 trials is about 2,200 calls; a few tens of dollars with a small model). The spread of 15 points is an assumption: the headroom run (S0) measures the real one and the numbers below are fixed from it **before any treatment arm is run**.

Two pre-registered tiers, judged on the courses that have headroom (a control mean below about 80):

- **Detectable:** the pooled mean of treatment minus control over those courses is at least **5 points** and its bootstrap 95% interval excludes zero; the placebo arm's pooled difference does not.
- **Substantial:** the pooled mean difference is at least **10 points**, at least **half** of the courses show a positive difference whose interval excludes zero, the placebo shows none, and the interference arm shows **no drop above 3 points** on other courses.

If neither tier is met, the route does not yet work, and the report says which courses did and did not and why (headroom, card quality, scorer). The per-course table is always reported in full; no course is dropped after the results. Inside the society (S2) the same tiers apply with 5 repeats of 15 agents, and a smaller effect there is expected because agents choose what to read.

## S0 result and the fixed analysis plan (2026-11-25; the owner's runs, claude-haiku-5-5, the exact answer form shown to every arm)

An earlier S0 run (2026-11-25, before the fix) gave zeros for two courses; they were answer-form errors, not lack of skill (the engines accept one exact JSON shape and the model had never been shown it), so that run is discarded. The numbers below are control-arm scores with the form shown: n = 40 for the three generic courses, n = 20 for the five probes, fresh held-out seeds, USD 2.63 together (raw files: asp-live-keyonly/card-effect-headroom-2 and card-effect-headroom-probes).

| Course | Construct | Control mean | Spread (sd) | Share at 100 | Room | Class | Minimum detectable difference, n = 40 per arm |
|---|---|---|---|---|---|---|---|
| probe-household | paper-specific probe (household decisions) | 36.3 | 13.3 | 0 | 63.7 | headroom | 8.3 |
| probe-negotiation | paper-specific probe (goal and secret) | 57.8 | 6.0 | 0 | 42.2 | headroom | 3.7 |
| probe-memory | paper-specific probe (memory operations) | 67.0 | 25.4 | 0.30 | 33.0 | headroom, noisy (two modes) | 15.9 (n = 100 needed for 10 points) |
| C-L2-1 | generic rule-writing (lessons from failures) | 78.2 | 9.9 | 0.03 | 21.8 | headroom | 6.2 |
| probe-calibration | paper-specific probe | 85.0 | 14.7 | 0 | 15.0 | little room | 9.2 |
| C-L19-1 | generic rule-writing (rules for a peer) | 85.7 | 1.8 | 0 | 14.3 | little room (the model always writes much the same rule and misses the rare cases) | 1.1 |
| C-L11-1 | generic rule-writing (evals) | 95.0 | 22.1 | 0.95 | 5.0 | ceiling | not meaningful |
| probe-verification | paper-specific probe | 100.0 | 0.0 | 1.00 | 0 | ceiling (the facts are in the prompt) | not meaningful |

**Fixed before any treatment arm runs:** (1) the four courses WITH headroom (C-L2-1, probe-memory, probe-negotiation, probe-household) carry the tiers below; (2) C-L19-1 and probe-calibration are run and reported apart as low-headroom; (3) C-L11-1 and probe-verification are at the ceiling and are reported as such, never as failures of the cards (row ENG134 hardens them); (4) the primary measure is the agent's first sitting; (5) n = 40 per arm, except probe-memory where n = 100 is needed for a 10-point effect; (6) the tiers are those of the section "Pre-registered success rule" above, read over the four headroom courses: detectable = pooled difference at least 5 with the 95 percent interval excluding zero and the placebo pooled difference not; substantial = pooled at least 10, at least two of the four courses individually positive with intervals excluding zero, the placebo flat, and the interference arm showing no drop above 3 points.

## The ladder of studies (cheap first)

| Step | What | Cost | What it tells us |
|---|---|---|---|
| **S0 headroom** | The model sits each course n=10 times **without** any card: only the task text. | A few dollars | Where there is room to improve: if the model already scores near 100 on a course, no card can show a gain there (the model may already know the method). |
| **S1 card effect** | For each course, three arms: **control** (task only), **placebo** (an unrelated text of the same length, so that more words alone is not credited), **treatment** (the course's four card parts in the prompt); n=40 per arm (see the power check above); fresh held-out seeds; score each with the course's scorer; plus the interference arm (the artifact for course A as memory on courses B to Z). | A few tens of dollars for 18 courses | Whether the cards make the written artifact better, in isolation, without the noise of a society. This is the core premise at its simplest. |
| **S2 in the society** | `--experiment access` with 15 agents: half can find cards and sit, half cannot; repeat 3 times (`cohort repeat`); a before sitting where the agent has one. | One run's cost times 3 | Whether agents actually find, read and use the cards, and the gain with the spread. |
| **S3 write-back and jobs** | After a passed sitting, the course's write-back puts a labelled gated line in the notebook; first-try acceptance of that kind of job before and after, access against control. | Part of S2 | Whether the gain carries into work. |
| **S4 retention and transfer** | A second sitting after hours without cards; unrelated courses; a different model. | Small | Whether it lasts, and does not erase other skills. |
| **S5 ablations** | Four parts against the digest only; with against without practice tasks; with against without write-back; card length; paper against insight. | Medium | What in the card does the work, so cards can be improved by evidence. |

## What each step needs built

- **`asp academy card-effect`** (S0 and S1): a command that runs the three arms for the chosen courses against a model and key the owner supplies in his own window, prints a table (control mean, placebo mean, treatment mean, difference, bootstrap interval, n) and writes the raw answers and scores. No society needed. **The lane builds this first.**
- **Sitting records with flags** (S2): every sitting records whether the agent had taken any part of that paper and whether it had completed the set; the report shows before against after and access against control.
- **Write-back after a pass** (S3): not built in the cohort as far as I can see (the passing line is returned to the agent; no notebook line is written); the platform plan (learning-platform.md, step 6) says it should be.

## Threats to validity (said up front)

- **Prior knowledge.** The model may already know the method (a card on chain-of-verification, for example); headroom is measured first (S0). Courses with no headroom are reported as such and not counted as failures of the cards.
- **Contamination.** New names and seeds nobody controls; the scorer is rule-based, not a model, so judge bias is out.
- **Selection.** Agents that read cards may differ from those that do not; access is randomised.
- **Small n and many comparisons.** Five repeats at least; the report states the number of courses tested and does not pick winners afterwards.
- **One model.** The first study uses Haiku; a second model is run before any claim is repeated outside the project.
- **What it is not.** Evidence that an agent writes better memory artifacts after a card; not evidence of general intelligence, and not yet of better real work (that is S3).

## What can be claimed, and when

After S1: "for these courses, an agent that read the four parts wrote a better artifact than one that did not, by N points (interval), and the placebo did not." After S2 and S3: the same inside the society and on real jobs, with the spread. Anything less is reported as not shown.
