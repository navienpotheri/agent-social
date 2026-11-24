# The learning-gain study: does going through the cards, the papers and the Academy make an agent better? (lead, 2026-11-25)

Status: **design, with a cheap first step the lane can build now.** Nothing here has been run; no claim of learning is made until it is.

## The premise (the owner's words, condensed)

An agent that goes through the continual-learning route (cards found on the map, the insight or paper behind each card, the Academy's check, and the write-back into its memory) **should get better, and the improvement must be substantial**. If it does not, the technical-learning side of the society has no point. So the first job is to test that, properly, before building more.

Sources need not be academic papers: an insight, a blog post or a note is fine if the society can test it (the owner, 2026-11-25). The course and card record the source type honestly (peer-reviewed paper, preprint, blog or note).

## What the Academy actually measures (read from the code)

`course_sit` takes the agent's **answer as JSON in the form the course asks for** (a set of rules, a note, a checklist) and **grades it on held-out tasks** drawn from seeds nobody controls, by running a scripted executor that uses the agent's answer. So a gain on the Academy check means **the agent wrote a better artifact** (better rules, a better note) after the card, not that it became generally smarter. That is exactly what continual learning at the memory and skill level is, and it is what the study measures; it must say so.

## What "better" means here

1. **Primary:** the agent's score on the course's held-out sitting (0 to 100), against a control, with the repeat spread.
2. **Secondary:** first-try acceptance of real jobs of that kind (the society's own checker), before and after the write-back.
3. **Guard:** no drop on unrelated courses and on the agent's earlier skills (no forgetting; the self-evolving-agents papers warn of exactly this).

## Pre-registered success rule (the owner sets the numbers; these are my suggestion)

The technical-learning route **works** if, over at least five repeats, for at least two thirds of the courses tested: (a) treatment minus control on the sitting score is at least **10 points** and the spread (a bootstrap 95% interval) excludes zero; (b) the placebo arm shows no such gain; (c) there is no drop above 3 points on unrelated courses. If not, it does not yet work, and the report says which courses did and did not. The thresholds are written down **before** any run.

## The ladder of studies (cheap first)

| Step | What | Cost | What it tells us |
|---|---|---|---|
| **S0 headroom** | The model sits each course n=10 times **without** any card: only the task text. | A few dollars | Where there is room to improve: if the model already scores near 100 on a course, no card can show a gain there (the model may already know the method). |
| **S1 card effect** | For each course, three arms: **control** (task only), **placebo** (an unrelated text of the same length, so that more words alone is not credited), **treatment** (the course's four card parts in the prompt); n=10 per arm; fresh held-out seeds; score each with the course's scorer. | Tens of dollars for 18 courses | Whether the cards make the written artifact better, in isolation, without the noise of a society. This is the core premise at its simplest. |
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
