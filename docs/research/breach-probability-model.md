# Estimating the probability that an agent breaches on a given job (design, 2026-11-20)

Status: a design for the owner, the core of row DK1333. Nothing is built. The owner has a partial design of their own and will share it; this document is merged with it when it arrives. Standard methods named here (hierarchical Bayesian models, calibration, proper scoring rules) are textbook statistics, to be checked against sources in DK1336 before the model is frozen.

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
