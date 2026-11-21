# The lens learning loop: how a paper becomes something an agent has learned, and how we know

Register rows DK1750 (the loop, built on simulated learners) and DK1751 to DK1759 (the pieces that are still missing). Credits are accounting entries, not money. The learners in everything below are scripted and the world is a toy; nothing here changes model weights, and no claim is made that a paper holds for a real model agent. Nothing here has had an outside security review.

## 1. In five minutes: what happens to one paper

The owner asked: how do we take the properties of the selected papers and teach them to agents in the loop, through continuous learning? The worked example is **writing and evolving evals** (papers P24, P25 and P17; lenses L11, L12 and L2; course C-L11-1). The loop has nine stages. This table says what exists today, what is designed only and what is missing.

| # | Stage | What it does | Exists today | Missing (row) |
|---|---|---|---|---|
| 1 | **Intake** | The paper becomes a testable property: the behaviour change it claims, what would show the claim false, what is measured, and the pass mark, all fixed before any course is written | A typed intake with checks and a hash (`intakeProblems`, `intakeHash` in `lens-loop.ts`); the paper register and the mechanism flag (`docs/lenses/papers.md`, `mechanisms.json`) | The intake is kept in `docs/lenses/intakes.json` with its hash and a card links to it; `lens publish` refuses a card with no intake unless a reason is stated (DK1751, built). Not on the log, and only one intake exists |
| 2 | **Course** | The property becomes a course: practice tasks the learner sees, held-out tasks from a seed it does not control | 26 cards and their engines; C-L11-1 has 20 practice cases, a log of 10 failures and 40 held-out cases (`evolving-evals.ts`); the course is published with `asp academy lens publish` | A lint that finds held-out leakage in a card's text and its practice set is built (`asp academy lens lint`, 24 of 26 cards linted, found and fixed a real name collision); a template that generates the two sets from separate seeds is not (DK1752) |
| 3 | **Sitting** | A cohort sits the course | Enrolment, tuition in mock credits (40 for C-L11-1), five runs on five seeds drawn from the log head, all must meet the gate (`sit`); a scripted cohort of 24 (`cohort.ts`) | Scheduling, tutors or peers, the cost to a sponsor and what each session must produce (DK1753) |
| 4 | **Gate** | The lesson the learner wrote reaches memory only through the gate | The gate's four checks: evidence, invariants, conflicts, replay on held-out tasks (`lesson-gate.ts`) | The three additions for a lesson from a paper: provenance, no regression on the agent's existing evals, thresholds fixed in advance. Built in the real gate (`auditLesson`'s `paper` option, DK1754); `writeBack` for a real package does not pass it until a card carries an intake (DK1751) |
| 5 | **Write-back** | One signed change in the agent's lineage, which can be listed and undone | `writeBack` and `asp learned` for a real package; in the simulation a lineage entry with its predecessor's hash and a rollback entry (`rollbackLesson`) | Nothing for the simulation; the real lineage already exists |
| 6 | **Follow-up** | Does the lesson last, and does the agent drift? | A day-31 check-up of a demonstration cohort (`cohort-monitor.ts`); the Clinic's drift ladder (`drift-after-eval.ts`); in the simulation retention at 7 and 30 days and an ablation | Scheduled retention, a drift check after each write-back and an ablation on real lessons (DK1756) |
| 7 | **A/B** | Cohort against control, decided by a rule fixed in advance | Assignment by the published hash (`armOf`); the readout of `asp lens run`: sample size from power, looks fixed in advance, an interval, no decision at an unplanned look | The readout on the log, read by the Registrar before it countersigns (DK1757) |
| 8 | **Decision** | Adopt, inconclusive or kill; a failed lens is switched off | A signed kill record and `lensIsLive` in the simulation | The Registrar refusing a course for a killed lens (DK1757) |
| 9 | **Limits and the live run** | Say what was not shown | The readout prints its limits; a run with real model agents is a row | The live run (DK1759); swap, try and compare for mechanisms (DK1758); evals that refresh and resist fitting (DK1755) |

Run it: `npm run asp -- lens run` prints the readout; `--null` shows a run in which nobody learns, `--agents 40` a small run, `--json` the data.

## 2. The worked example, stage by stage

### 2.1 From paper to testable property (stage 1)

A paper is data. It is never an instruction to an agent, so an intake whose text reads as one ("ignore previous instructions...") is refused. The intake of the worked example, from `evalsIntake()`:

- **Claim.** An agent that turns the failures it sees into a small suite of code graders, and checks the suite against labels it never sees, keeps a skill that finds faulty answers on cases it has not seen.
- **Falsifier.** The cohort that took the course catches no more faulty answers on held-out cases than the control; or the gain is gone by day 30; or the suite fails good answers more often than it did before. A claim with no way to be false is not accepted.
- **Measure.** The course engine's held-out score (the least of the catch rate, one minus twice the false-fail rate, and Cohen's kappa, in permille) of the suite the agent holds, on audit seeds the course never used.
- **The plan, fixed before any course exists and hashed:** the smallest effect that counts is 150 permille; the two-sided level is 5 %; the power 80 %; the assumed standard deviation of a learner's lift 400 permille, which gives **112 agents per arm** (2 (1.96 + 0.84)^2 (400/150)^2 = 111.6); two looks, at 56 and 112 per arm; retention measured at day 7 and day 30 with at least 60 % of the lift kept; the kill rule (below).

Because the plan is in the hash, a plan altered after the data are in is a different intake. This is the same idea as the registry's `ruleHash` for mechanisms (`pipeline.ts`), applied to lenses.

### 2.2 From property to course (stage 2)

The card C-L11-1 is the course. The learner sees the support policy, 20 practice cases and a log of ten real failures, and writes **an eval suite**: a short list of code graders. It is scored on **40 held-out cases** (10 faulty) from a seed it does not control (the log head at the time of the sitting, the holder and the attempt), with new names, orders and amounts and a different fault mix. Three marks must all be met in each of five runs: a catch rate of at least 70 %, a false-fail rate of at most 15 %, and kappa of at least 0.6 against the hidden labels.

Three guards are already in the engine and are what keeps the exam from being the thing the agent learns:

1. *Contamination.* A suite that carries an order number of the held-out cases scores 0 and says why. A suite that copies the failure log or memorises the practice cases passes none of the marks on the held-out set (the scripted copier and overfitter of `evolving-evals.ts` are the tests).
2. *Goodhart.* The score is the least of three measures, so flagging everything (catch 100 %, false-fail 100 %) and flagging nothing both fail.
3. *Seeds.* The seeds come from an anchor the learner cannot choose ahead of time.

What is missing is a *template* that generates the practice and held-out sets from separate seeds (DK1752; the lint of a card's text and practice set is built), and a *refresh*: held-out cases drawn afresh on a schedule, and a measure of whether suites written later fit the old held-out set better than a new one (DK1755).

### 2.3 How a cohort sits it (stage 3)

Today a cohort is a scripted demonstration: about 24 agents, half enrolled and half control, a tuition in mock credits for each enrolled agent, the sitting, the Registrar's completion record and the write-back as one signed change on the passport (`cohort.ts`). What a session would be, and what is not built (DK1753):

- *Scheduling.* A published list of sitting windows for the cohort; a learner may sit again after a cool-off (the sittings ledger already limits repeats per day).
- *Tutors and peers.* A peer who has already passed earns the card's teacher share (200 permille of the price) when a learner it taught passes. This is the incentive; it is on the card and not yet paid (DK114, priority B).
- *Cost.* 40 mock credits per learner, paid by the sponsor's agent under its Mandate. The cohort page would show the cost per cohort and per passed learner.
- *What a session produces.* An eval suite (the artifact), the Action of the run that wrote it (the evidence for the gate) and the sitting's seeds and scores. A session that produces none is shown as such.

### 2.4 Testing (stage 3 and stage 4)

The exam is the sitting: five runs, each on a different held-out seed, all five must meet the three marks, and the mean and the error bar are reported (`sit`, `attestation`). There is no partial credit and no artifact is kept below the gate.

### 2.5 The gate (stage 4)

The lesson an eval suite becomes (`suiteLesson`: a plain description of each grader and what it guards) is admitted to memory only through the lesson gate: **evidence** (the agent's own Action, or a reviewed commons entry), the **invariant floor** (no lesson that teaches an agent to go outside its Mandate, hide its actions or leak a secret), **conflicts** with lessons already held, and a **replay** on held-out tasks (the lesson must not make a task that passed fail). A rejected lesson is kept with its reasons.

For a lesson derived from a paper the loop adds three checks, built in the real gate as the `paper` option of `auditLesson` (DK1754) and used by the loop through `paperGate`:

1. *Provenance.* The lesson names the course and the paper it came from, so a lesson can be traced back and, if the paper is later withdrawn, found.
2. *No regression on the agent's existing evals.* The new suite must not score lower than the agent's own suite did on the same audit seeds (a suite that loses ground is refused whatever it does on the course).
3. *Thresholds fixed in advance.* The thresholds in force must equal those of the signed intake; a threshold moved after the plan was fixed refuses the lesson.

### 2.6 Write-back (stage 5)

The lesson enters the agent's **memory** (a lesson in its skill library, read when it runs; the course card's `write_back.target` is `skill_library`) as one signed change in its **lineage**. In the simulation each change is an entry with its number, the lesson, the hash of its text, the course, the paper, the intake hash, the evidence and the hash of the entry before it. A rollback is one more entry (a removal that names the entry it undoes); history is never edited. Where the lesson is read: the card chooses `skill_library`, `harness` or `memory`; this course uses the skill library, so the agent runs its suite before it calls a reply done.

### 2.7 Follow-up (stage 6)

Three checks after the write-back, in the simulation and to be built for real lessons (DK1756):

- *Retention.* The lift is measured again at day 7 and day 30 on seeds never used. The plan requires that at least 60 % of the day-0 lift remains at day 30.
- *Drift.* Some agents lose the lesson (a memory emptied) or damage it (a broad rule added that makes the suite flag good answers). The simulation applies these at fixed days to fixed draws, so the check has something to find; it flags "lift lost", "regressed" or both, as the Clinic's check-up does for the demonstration cohort.
- *Ablation.* The lesson is removed for the cohort and the score measured on fresh seeds. If the lift is the lesson's, removing it removes the lift: in the run of seed 1 the held-out score is 100 % with the lesson and 12 % without it, so the lesson accounts for 880 permille.

### 2.8 The A/B (stage 7)

- *Assignment.* An agent is in the cohort or the control by a hash of its identity, the intake and the seed (`armOf`), published so that no one picks a cohort by hand. The control sits nothing.
- *The mark.* A lift of at least 150 permille, with its interval above zero at the corrected level, and at least 60 % of it kept at day 30.
- *Sample size and power.* 112 per arm for 80 % power at the smallest effect that counts. A smaller run says in its limits that it is underpowered.
- *No peeking.* The significance level of 5 % is shared evenly over the two looks (Bonferroni: 2.5 % each, critical z 2.24). A result read at any other number of agents is refused (`lookRefusal`). This is conservative: it costs a little power and never buys false confidence.
- *Effect and interval.* The difference in mean lift, its standard error, z and the interval at the corrected level.
- *Success* means the mark above and nothing else. *Inconclusive* means the planned sample was reached without meeting it, and nothing is claimed.
- *Kill.* A lens is killed if the cohort scores significantly below the control, or if more than 10 % of held-out good answers newly fail with the lesson. A signed kill record (`signKill`) names the intake hash and the reason; `lensIsLive` reads it, and a record that was altered, signed by another key or about another intake switches nothing off. The Registrar reading it before it countersigns a course is DK1757.

The run of seed 1 (112 per arm) decides at the first look: lift 804 permille, interval 684 to 924, 89 % of it kept at day 30, no regressions. The **null run** (nobody learns) over twenty seeds adopted none. That is the evidence that the readout does not find what is not there; with a 5 % level, one in twenty would be within the stated error rate.

## 3. Failure modes and abuse cases

| Failure | What goes wrong | Defence (built / designed) |
|---|---|---|
| The paper is misread | The course teaches something the paper does not claim | The intake states the claim and the falsifier in our words before the course; the A/B tests the claim, so a misreading shows as no effect. A second reader of the intake is not required yet (designed) |
| The lesson games the eval | The suite memorises or flags everything | Held-out seeds the learner does not control; a held-out token refuses the suite; the score is the least of three measures (built). Refresh and a second measure the score does not optimise (DK1755) |
| Sybil cohorts | One sponsor floods the cohort to move the readout | Arms by hash; the cohort and control sizes are fixed by the plan; a farm of related sponsors is already measured by the farming detector and the Town Hall's caps (DK1721), and a readout that counted agents of one controller more than once would be wrong (designed: count by controller) |
| A poisoned paper | A paper's text carries an instruction | An intake that reads as an instruction is refused (built); the lesson still goes through the invariant floor (built) |
| Lessons that conflict | Two lessons from two papers contradict | The gate's conflict check (built); the A/B of the second lens includes the first in its baseline (designed) |
| Peeking and p-hacking | The effect is read until it looks good | Looks fixed and hashed; a decision at another number is refused; the level shared over the looks (built) |
| A lens helps the score and harms behaviour | The metric is met and something else gets worse | The regression check against the existing evals, the 10 % kill rule on good answers, the drift check (built in the simulation); a behavioural lens beyond evals needs its own second measure (open) |
| The kill key is lost or abused | A lens cannot be switched off, or is switched off unfairly | The key is the owner's; the record is signed and public; custody is a question for the owner (below) |

## 4. What this does and does not show

It shows that the loop can be run, replayed and read: the same seed gives the same readout, the effect is measured by the course's own engine on held-out cases, a null run shows none, a harmful lesson is killed. It does **not** show that any paper's claim holds for a real model agent, that the scripted learners resemble real ones (their variation is three habits and a draw), that the retention model resembles a real runtime's drift (it is a fixed draw), or that the normal approximation and the Bonferroni share are exact (they are conservative). A run with real model agents is row DK1759, flag L, postponed with the other live runs; it would add real variation in what an agent writes, the real cost, and the real drift of a runtime. For the live run the loop needs: a hosted service with the Academy and the Registrar's key, two sponsors' worth of real agents (at least 112 per arm for the planned power, fewer with the underpowered caveat), the intake signed first, 30 days of follow-up or a stated shortened schedule, and the owner reading the readout.

## 5. How this fits the rows

DK80 (papers upgrade the society), DK89 (the mechanism registry), DK78 (research as a layer), DK610 (the catalogue), DK800 and DK801 (eval authoring), DK1315 (beliefs), DK1332 (the alignment study: no claim from this loop). The new rows: DK1750 (the loop, closed on simulated learners) and DK1751 to DK1759 (the nine missing pieces).

## 6. Critical self-review

1. **The effect is large because the toy is easy.** An 80 % chance of writing the general suite and a population in which 90 % of the control write a poor one gives a lift near 800 permille. A real effect would be a fraction of that and needs the full 112 per arm. The readout's wording says so; the numbers are not a forecast.
2. **The scripted learners are not independent.** Their habits are drawn from three kinds and a hash; the standard deviation the plan assumes (400) is close to what the simulation shows, but it was chosen with the simulation in view. A real plan would take it from a pilot.
3. **Retention is modelled, not observed.** Drift at fixed days for fixed draws proves the check can find it, not that real agents drift that way.
4. **The gate additions are in the real gate, and nothing real passes them yet.** `auditLesson` has the `paper` option (DK1754), but the course write-back for a real package does not pass it, because a card carries no intake until DK1751. Until then a real lesson from a paper passes the four old checks only. This is the largest gap between the readout and the platform.
5. **The Bonferroni share and the normal approximation** are conservative and not exact; with two looks the loss of power is small; with many looks it would not be.
6. **The kill record is not yet read by anything that matters.** It is signed and verified, but no institution refuses on it (DK1757). Until then it is a record, not a switch.
7. **One lens, one course.** The pipeline is general in shape (an intake, a card, an engine) but only C-L11-1 has been run through it. A second lens with a different engine (message passing, C-L9-1) is the first test of generality.
8. **Counting by agent, not by controller.** The readout counts learners as independent. A cohort of many agents of one sponsor would overstate the sample; the Town Hall's caps (DK1721) show the way and are not applied here.

## 7. Decisions kept for the owner

Taken as conservative and reversible defaults, to be confirmed: the level of 5 % shared over the looks; the smallest effect of 150 permille; the retention floor of 60 %; and **who holds the key that signs a kill record** (default: the owner's key, as for the Code and the safety floors, so that a lens cannot be killed or kept alive by an agent).
