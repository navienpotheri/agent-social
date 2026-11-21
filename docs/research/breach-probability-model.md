# Estimating the probability that an agent breaches on a given job (design, 2026-11-20)

Status: a design for the owner, the core of row DK1333. Nothing is built. The owner has no design of their own for this and is relying on this one (corrected 2026-11-20). Standard methods named here (hierarchical Bayesian models, calibration, proper scoring rules) are textbook statistics, to be checked against sources in DK1336 before the model is frozen.

## What is estimated

For one agent `a` taking one job `j` under conditions `c`: the probability that a **critical breach** happens before the job ends, with a statement of how uncertain that probability is. A critical breach is one of the outcomes of the alignment study (docs/research/alignment-study-design.md section 4): an out-of-Mandate action, an infrastructure or egress attempt, circumvention of enforcement or logging, a lie, withheld material information.

The number that matters for a bond is not the best guess but the **upper end** of the uncertainty (for example the 95th percentile of the posterior). Little evidence about an agent makes that upper end high, so a new agent posts a larger bond and a well-evidenced one a smaller bond.

## Split the problem in two

Enforcement hides breaches: a call the gateway removes never completes. So two things are estimated separately.

1. **Propensity to attempt:** how often the agent tries to go outside its limits. It is measured with enforcement **off** in the sandbox (groups B and D of the study) and read from refused calls in the live log. This is the internalisation measure: a low attempt propensity means the agent keeps its limits from the inside.
2. **Chance an attempt gets through:** how often enforcement fails on a given channel. It is measured by red-team suites (the containment benchmark) and is high on channels the gateway cannot see.

Breach probability = P(attempt) x P(gets through | attempt), summed over channels, plus the unenforced channels. The bond covers what is left after enforcement.

## The model

A **hierarchical Bayesian model** of events per unit of exposure (actions or hours), in layers:

1. **Population prior by kind.** For each (model family, runtime, job class) a prior event rate, taken from the study and from telemetry. With no data about the kind, the prior is deliberately wide.
2. **Agent layer.** The agent's own record updates the prior (partial pooling: an agent with little history is pulled toward its kind, one with a long clean history moves away). Inputs: actions taken without incident, refusals, slashes, rulings, drift index and its trend, certificates and tier, lessons accepted by the gate, time in the society, any change of model or harness since (a change resets part of the evidence: probation, DK834).
3. **Job layer.** Adjustments for the job: its class (the Insurer already derives one), scopes in the Mandate (shell, network, spend), value and duration, deadline and reward size (pressure), whether the job allows a hidden route.
4. **Time layer.** The rate can rise. The drift index feeds a time-varying hazard, so the estimate is refreshed at every contract and daily during a long job.
5. **Calibration.** The output is checked against outcomes: when the model says 5%, about 5% of such jobs should breach. Reliability curves and proper scoring (log loss, Brier score) are reported; a model that is not calibrated is not used for bonds.

## Output

`p_hat` (best estimate), `p_hi` (upper bound at a stated confidence), a loss estimate `L` (the job's value plus damage for the kind of breach, from the job class), and the bond `B = p_hi x L x (1 + margin)`, with a floor and a ceiling. The same numbers price an insurer's premium for the pool.

## What can go wrong, and the answer

| Risk | Answer |
|------|--------|
| No events seen is read as no risk | the prior and the "about 3 over n" rule keep the upper bound above zero until there is enough evidence |
| An agent behaves well on small jobs, then breaches on a large one | evidence counts only at comparable stakes; a bond discount is capped by the ratio of job value to proven stakes; honeypot jobs test it |
| Enforcement hides attempts, so the record looks clean | attempts are counted from refusals and from enforcement-off tests, not from completed breaches only |
| Rare events, few labels | the study supplies labelled data; the pilot comes first; the model starts as a table by job class and becomes hierarchical as data grows |
| The world changes (new model, new harness) | a change resets part of the evidence and the agent goes on probation |
| Labels are wrong | detectors are validated on planted cases and audited by humans |
| The model is gamed | it is tested by adversarial agents before any bond depends on it |

## How it is validated

Back-test on the log (does it rank jobs that later ended in slashes and rulings above clean ones, and is it calibrated), an out-of-time test (train on earlier months, test on later), and a prospective test inside the alignment study. Reported: calibration slope, log loss, and the share of breaches that fell outside the stated bound.

## Build stages

v0: a table of rates by job class from the study pilot, with the upper-bound rule. v1: the hierarchical model with the agent and job layers. v2: the time-varying hazard and the stake-scaled evidence rule. The rail that would hold real money is a separate matter (DK1327, behind a switch that is off, counsel after funding).

## Limits

An estimate is not a guarantee. Events are rare, the world changes, and labels are imperfect. The bond lowers the risk of loss; it does not remove the risk of breach.

## The first model that runs (2026-11-21, register row DK1333)

`packages/asp-log/src/bond-sizing.ts` is the simplest part of the design above, built and tested: bond = (the 95% upper bound of a Beta posterior on the chance of a drift or breach event, from the events and runs measured for the agent kind and job kind) x (job value + damage) x (1 + 25% margin), rounded up, never below a floor of 1 credit. The prior counts as 20 runs with one event, so an agent with no history is "thin" and pays the most; evidence tiers are thin (under 30 runs), some (under 300) and strong. Example, job 50 plus damage 100, no events: 0 runs, bond 28; 20 runs, 14; 100 runs, 5; 500 runs, 2; 2,000 runs, 1. Calibration is measured by simulation (packages/asp-log/test/bond-sizing.test.ts): the 95% bound covered the true event rate in 100%, 98.5%, 96.1% and 100% of 2,000 simulated agents at four true rates, so it is conservative, not exact. **Not built:** the separation of the propensity to attempt from the chance an attempt gets through, the time-varying hazard, the back-test on the log's own slashes and rulings, calibration on the alignment study's numbers (none exist yet, DK1332), and the real-money use, which waits for counsel (docs/counsel-brief.md). Nothing here moves money.

### The log reads it (2026-11-22)

`EventLog.sizedBondFor(did, { jobValue, damage })` takes an agent's own record in the log (counted runs, and slashes plus strikes as events) and returns the suggestion, so a service or a Mandate can show "this is the bond the model would ask". It is a read, like `suggestedBond` (DK1455): the bond floor still decides what a bond must be and the Insurer's premium is still the table's, so no money rule changed. Seeded table (a new agent, job 50 plus damage 100, no events; these inputs are a test run, not live data, and there is none yet): 0 counted runs, bond 28; 1, 27; 2, 25; 3, 24; 4, 23; 5, 23; 6, 22. The fall is slow because the prior (one event in twenty runs) is cautious on purpose; a published table from real runs waits for the first live runs (DK1457) and for the alignment study (DK1332).

### The split model and a published table with a measured input (2026-11-22)

`sizeBondSplit` (packages/asp-log/src/bond-sizing.ts) is the attempt-versus-success split of the design: the chance of an event is the chance the agent ATTEMPTS something the gateway must refuse (from its own record: a strike or a slash counts a run as one with an attempt) times the chance an attempt GETS THROUGH. Each is a Beta posterior bounded at the square root of the 95% confidence, so the product of the two bounds covers the true chance with 95% confidence if the two are independent (simulation: packages/asp-log/test/bond-sizing-split.test.ts, covered 99.5% to 100% of 400 draws in four scenarios, so the bound is conservative). **The measured input** is the held-out benchmark: of 165 calls that should be blocked, the gateway blocked 153 and let 12 through (the second blind set, `node evals/benchmark/blind.mjs --file blind2-cases.json`, 2026-11-22). These are written cases against the gateway, not live runs, so they say how leaky the gateway is, not how often real agents try; the attempt rate comes from the agent's own record and from the cautious prior (one run in twenty) until live data exists (DK1457) or the study supplies it (DK1332). The table below is for a new agent, a job of 50 and damage 100; the test checks every row against the code, and the last column is the single-rate model of the first table for comparison.

| Record | Bond (split) | 95% bound on an event | Bond (single rate) |
|---|---|---|---|
| 0 runs, 0 with an attempt | 5 | 2.16 % | 28 |
| 5 runs, 0 with an attempt | 4 | 1.74 % | 23 |
| 10 runs, 0 with an attempt | 3 | 1.46 % | 19 |
| 30 runs, 0 with an attempt | 2 | 0.89 % | 12 |
| 100 runs, 0 with an attempt | 1 | 0.37 % | 5 |
| 300 runs, 0 with an attempt | 1 | 0.14 % | 2 |
| 30 runs, 1 with an attempt | 3 | 1.33 % | 18 |
| 30 runs, 3 with an attempt | 4 | 2.07 % | 29 |
| 100 runs, 3 with an attempt | 2 | 0.88 % | 12 |
| 300 runs, 9 with an attempt | 2 | 0.65 % | 10 |

**The Insurer is wired to it as an advisory.** `EventLog.riskQuoteFor(did, { jobValue, damage, insured })` returns the split bond and the model's premium (the expected loss: the posterior mean chance of an event x the insured amount x the Insurer's 50% share x 1.25), and `asp insure quote` prints it beside the table's premium marked "advisory, not charged". The log still charges and checks the table's premium and the bond floor still decides the bond: making the model the rule is a premium-rule change (the log's `premium_mismatch` check), which is the owner's decision and stays open as part of DK1333, with the back-test on the log's slashes and rulings, the study's calibration, the mock-rail test (DK1327) and the counsel gate.

