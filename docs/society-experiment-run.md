# Do field cards, courses and accreditation make agents better? The harness (ENG75, groundwork)

**Status: the harness and the report are built and tested with stand-in agents whose skill does and does not respond; the held-out battery is not yet given to real agents, and nothing here claims anything about real agents.** Credits are mock accounting entries, not money. The cost is a cap, never a price.

## The question, and what is not known

It is not known whether field cards, courses and accreditation (a Registrar-attested completion, a certificate, a standing) make agents better. The Academy's lens courses measure a lift on held-out tasks with an error bar; the field cards are unmeasured by design; and nothing compares agents with access to them against agents without. This is the controlled comparison.

## What is built

- **Random assignment.** `--experiment access --seed <n>`: exactly half of the agents (from a hash of the seed and the agent's id, so the same seed gives the same split on the same society) get access; the other half do not. `--access cards,courses,accreditation` names which resources are switched (default all three). The control agents are not offered the tools that the resources switch (courses: `look_courses`, `course_enrol`, `course_sit`, `my_progress`; cards: `inspect`, `field_answer`, which exist only with `--markers`); everything else, and the society, are the same. Accreditation has no tool of its own in this build: an agent without courses cannot earn one, so it follows the courses until lane-society-2's Registrar-attested accreditation can be switched by itself. The table is `ACCESS_TOOLS` in `packages/asp-cli/src/cohort/experiment.ts`.
- **The fixed held-out outcome measure.** A battery of the house's own text jobs (the solo jobs, each with a check on the delivery that the house applies), chosen from the seed, the same for every agent and given the same way before and after; the score is the share of deliveries the house's checks accept. The comparison is the change (after minus before) in the access arm minus the change in the control.
- **Accreditation, two ways, from the trace.** Whether accredited agents do better on the same jobs (jobs delivered and accepted for each agent) and whether others prefer them (how often their offers are accepted, and at what price once the society records it). An agent is accredited when the society emits an `accredited` event (the Academy's flow, lane-society-2's).
- **The reading rule.** Every figure is to be read with its spread between repeat runs (ENG72, `asp society cohort repeat`): a difference smaller than the spread is not called a difference, and without a measured spread no difference is called one. The report has a "What this cannot tell you" list and makes no claim about agents in general.

## The run, as far as it goes today

```powershell
$env:ANTHROPIC_API_KEY = "PASTE-YOUR-OWN-KEY"
npm run asp -- society cohort --local --agents 15 --model claude-haiku-5-5 --api-key-env ANTHROPIC_API_KEY --budget-usd 0.40 --total-usd 6 --minutes 60 --arrivals staggered:5@30 --markers --experiment access --seed 1
```

The report gets "Does access help? (a controlled comparison, not a claim)" and `experiment.json`: the arms, the jobs accepted and the calls refused for each arm, the accreditation figures when the society emits them, and, because the battery has not been given, "there is nothing to compare: the battery was not given to both arms". Each agent's trace line carries its `access` arm.

## What is left

1. The battery given to real agents: each agent answers the held-out jobs through its own gateway before and after (the harness takes any answer function; the real one is a model call that counts against the agent's cap).
2. A Registrar-attested accreditation that can be switched on and off by itself, and the hire and price records for the "others prefer them" measure.
3. A held-out sibling task for each card and course check (so each has a measure of its own): the cards and courses are lane-society-2's.
4. The real run, read by the owner, with the spread from repeat runs beside each figure.
