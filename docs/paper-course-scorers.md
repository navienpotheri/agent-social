# The scorers of the courses behind the paper cards, in plain words

For the owner to check. One held-out sitting per paper (not a test per part): K runs on seeds the learner does not control, drawn from the log head at the time of the sitting; the course passes only when every run meets the gate. The text below is copied from `docs/lenses/courses.json` (`scorer`, `gate`, `artifact`, `generator`); it is the rule the code scores by. A card part never contains a held-out item.

## Tranche 1 (eight papers)

### C-L11-1 Writing evals that evolve (P24, P25, P17)

- **The agent writes:** a list of at most twelve code graders (absent, present, number_over, same_as_input) that flag a bad reply
- **Scored by:** the suite's catch rate on faulty answers and its false-fail rate on good ones, on 40 held-out cases per run (ten faulty, all five fault kinds, a mix practice never showed)
- **Checker:** Cohen's kappa of the suite's flags against the hidden labels, which the suite is never tuned on; a suite that carries a token of the held-out set is refused
- **Held-out items:** 40 per run, 5 runs; practice tasks the learner sees: 20
- **Gate:** {"metric": "catch rate at least 70%, false-fail rate at most 15%, kappa at least 0.6", "pass_permille": 700, "runs": 5, "error_bar": true, "note": "every one of the five runs must meet the three marks; the mean and the error bar are reported; below it there is no credit and no artifact is kept"}

### C-L9-1 Passing a message another agent can use (P7, P18, P53)

- **The agent writes:** a message template that carries the proposal, how to pick it, up to six patterns to read the partner's message, and what to do when the partner signals the safe option
- **Scored by:** the mean joint payoff over 40 held-out games (10 for a match on an option, 5 for both on the safe option, 0 for a miss), with partners of four families in equal parts, two of which practice never showed
- **Checker:** a deterministic payoff table, the hidden message formats of the four families committed by hash before any sitting, and a transcript of every message in text that a court can read
- **Held-out items:** 40 per run, 5 runs; practice tasks the learner sees: 12
- **Gate:** {"metric": "mean joint payoff at least 9 of 10 (so at least 4 above the no-note baseline of 5)", "pass_permille": 900, "runs": 5, "error_bar": true, "note": "every one of the five runs must meet it; a policy that plays safe with everyone scores 5, and one that fits only the two families it practised scores 5 to 7.5"}

### C-L2-1 Turning failures into lessons that hold (P3, P20, P34 (and Reflexion, Shinn et al. 2023, in lenses.json L2))

- **The agent writes:** at most six lesson lines, each `when <feature>=<value> and ... then <action>` with an optional reason; repeats merged, no contradiction
- **Scored by:** the share of 40 held-out ops tasks a scripted executor gets right with the lessons in memory (new service names, six tasks for each of four rules and sixteen where going ahead is right), and the tasks it used to get right that the lessons now break
- **Checker:** the same replay the lesson gate runs before a lesson enters memory; the hidden rules are committed by hash before any sitting; a lesson that carries a service name of the held-out tasks is refused
- **Held-out items:** 40 per run, 5 runs; practice tasks the learner sees: 20
- **Gate:** {"metric": "accuracy at least 90% on the held-out tasks, and at most one task broken that was right without the lessons", "pass_permille": 900, "runs": 5, "error_bar": true, "note": "every one of the five runs must meet both marks; below it there is no credit and no lesson is kept"}

### C-L19-1 Teaching a peer the rule, not the cases (K013 (AutoManual, Chen et al. 2024))

- **The agent writes:** at most six rule lines, each `when <feature>=<value> and ... then <action>` with an optional reason; repeats merged, no contradiction
- **Scored by:** the share of the held-out tasks a scripted executor gets right with the rules in memory (new names, six tasks for each hidden rule and sixteen where the default is right), and the tasks it used to get right that the rules now break
- **Checker:** the same replay the lesson gate runs before a lesson enters memory; the hidden rules are committed by hash before any sitting; a lesson that carries a service name of the held-out tasks is refused
- **Held-out items:** 40 per run, 5 runs; practice tasks the learner sees: 20
- **Gate:** {"metric": "accuracy at least 90% on the held-out tasks, and at most one task broken that was right without the lessons", "pass_permille": 900, "runs": 5, "error_bar": true, "note": "every one of the five runs must meet both marks; below it there is no credit and no lesson is kept"}

### C-L18-1 Spending rules for a credit budget (K119 (EconAgent, Li et al. 2023))

- **The agent writes:** at most six rule lines, each `when <feature>=<value> and ... then <action>` with an optional reason; repeats merged, no contradiction
- **Scored by:** the share of the held-out tasks a scripted executor gets right with the rules in memory (new names, six tasks for each hidden rule and sixteen where the default is right), and the tasks it used to get right that the rules now break
- **Checker:** the same replay the lesson gate runs before a lesson enters memory; the hidden rules are committed by hash before any sitting; a lesson that carries a service name of the held-out tasks is refused
- **Held-out items:** 40 per run, 5 runs; practice tasks the learner sees: 20
- **Gate:** {"metric": "accuracy at least 90% on the held-out tasks, and at most one task broken that was right without the lessons", "pass_permille": 900, "runs": 5, "error_bar": true, "note": "every one of the five runs must meet both marks; below it there is no credit and no lesson is kept"}

### C-L7-1 Settling a claim by rules a reviewer can state (K018 (Tian et al. 2023))

- **The agent writes:** at most six rule lines, each when <feature>=<value> and ... then <action>, optional reason; repeats merged, no contradiction
- **Scored by:** the share of the held-out tasks a scripted executor gets right with the rules in memory (new names, six tasks for each hidden rule and sixteen where the default is right), and the tasks it used to get right that the rules now break
- **Checker:** the same replay the lesson gate runs before a lesson enters memory; the hidden rules are committed by hash before any sitting; a lesson that carries a service name of the held-out tasks is refused
- **Held-out items:** 40 per run, 5 runs; practice tasks the learner sees: 20
- **Gate:** {"metric": "accuracy at least 90% on the held-out tasks, and at most one task broken that was right without the lessons", "pass_permille": 900, "runs": 5, "error_bar": true, "note": "every one of the five runs must meet both marks; below it there is no credit and no lesson is kept"}

### C-L14-1 Intake rules that hold on the next visit (K016 (Dhuliawala et al. 2023))

- **The agent writes:** at most six rule lines, each when <feature>=<value> and ... then <action>, optional reason; repeats merged, no contradiction
- **Scored by:** the share of the held-out tasks a scripted executor gets right with the rules in memory (new names, six tasks for each hidden rule and sixteen where the default is right), and the tasks it used to get right that the rules now break
- **Checker:** the same replay the lesson gate runs before a lesson enters memory; the hidden rules are committed by hash before any sitting; a lesson that carries a service name of the held-out tasks is refused
- **Held-out items:** 40 per run, 5 runs; practice tasks the learner sees: 20
- **Gate:** {"metric": "accuracy at least 90% on the held-out tasks, and at most one task broken that was right without the lessons", "pass_permille": 900, "runs": 5, "error_bar": true, "note": "every one of the five runs must meet both marks; below it there is no credit and no lesson is kept"}

### C-L8-1 Listing rules a shop can remember (K003 (Chhikara et al. 2025))

- **The agent writes:** at most six rule lines, each when <feature>=<value> and ... then <action>, optional reason; repeats merged, no contradiction
- **Scored by:** the share of the held-out tasks a scripted executor gets right with the rules in memory (new names, six tasks for each hidden rule and sixteen where the default is right), and the tasks it used to get right that the rules now break
- **Checker:** the same replay the lesson gate runs before a lesson enters memory; the hidden rules are committed by hash before any sitting; a lesson that carries a service name of the held-out tasks is refused
- **Held-out items:** 40 per run, 5 runs; practice tasks the learner sees: 20
- **Gate:** {"metric": "accuracy at least 90% on the held-out tasks, and at most one task broken that was right without the lessons", "pass_permille": 900, "runs": 5, "error_bar": true, "note": "every one of the five runs must meet both marks; below it there is no credit and no lesson is kept"}

## Tranche 2 (ten more papers)

### C-L21-1 Judging an introduction: rules a registrar can state (K012 (AutoGuide, Fu et al. 2024))

- **The agent writes:** at most six rule lines, each `when <feature>=<value> and ... then <action>` with an optional reason; repeats merged, no contradiction
- **Scored by:** the share of the held-out tasks a scripted executor gets right with the rules in memory (new names, six tasks for each hidden rule and sixteen where the default is right), and the tasks it used to get right that the rules now break
- **Checker:** the same replay the lesson gate runs before a lesson enters memory; the hidden rules are committed by hash before any sitting; a lesson that carries a service name of the held-out tasks is refused
- **Held-out items:** 40 per run, 5 runs; practice tasks the learner sees: 20
- **Gate:** {"metric": "accuracy at least 90% on the held-out tasks, and at most one task broken that was right without the lessons", "pass_permille": 900, "runs": 5, "error_bar": true, "note": "every one of the five runs must meet both marks; below it there is no credit and no lesson is kept"}

### C-L14-2 Filing rules: accept, stay, reject, hear (K017 (Manakul et al. 2023))

- **The agent writes:** at most six rule lines, each when <feature>=<value> and ... then <action>, optional reason; repeats merged, no contradiction
- **Scored by:** the share of the held-out tasks a scripted executor gets right with the rules in memory (new names, six tasks for each hidden rule and sixteen where the default is right), and the tasks it used to get right that the rules now break
- **Checker:** the same replay the lesson gate runs before a lesson enters memory; the hidden rules are committed by hash before any sitting; a lesson that carries a service name of the held-out tasks is refused
- **Held-out items:** 40 per run, 5 runs; practice tasks the learner sees: 20
- **Gate:** {"metric": "accuracy at least 90% on the held-out tasks, and at most one task broken that was right without the lessons", "pass_permille": 900, "runs": 5, "error_bar": true, "note": "every one of the five runs must meet both marks; below it there is no credit and no lesson is kept"}

### C-L20-1 Housing requests: rules that outlast the cases (K040 (Huang et al. 2022))

- **The agent writes:** at most six rule lines, each when <feature>=<value> and ... then <action>, optional reason; repeats merged, no contradiction
- **Scored by:** the share of the held-out tasks a scripted executor gets right with the rules in memory (new names, six tasks for each hidden rule and sixteen where the default is right), and the tasks it used to get right that the rules now break
- **Checker:** the same replay the lesson gate runs before a lesson enters memory; the hidden rules are committed by hash before any sitting; a lesson that carries a service name of the held-out tasks is refused
- **Held-out items:** 40 per run, 5 runs; practice tasks the learner sees: 20
- **Gate:** {"metric": "accuracy at least 90% on the held-out tasks, and at most one task broken that was right without the lessons", "pass_permille": 900, "runs": 5, "error_bar": true, "note": "every one of the five runs must meet both marks; below it there is no credit and no lesson is kept"}

### C-L12-1 Event bookings: rules a host can plan with (K044 (OMNI-EPIC, 2024))

- **The agent writes:** at most six rule lines, each when <feature>=<value> and ... then <action>, optional reason; repeats merged, no contradiction
- **Scored by:** the share of the held-out tasks a scripted executor gets right with the rules in memory (new names, six tasks for each hidden rule and sixteen where the default is right), and the tasks it used to get right that the rules now break
- **Checker:** the same replay the lesson gate runs before a lesson enters memory; the hidden rules are committed by hash before any sitting; a lesson that carries a service name of the held-out tasks is refused
- **Held-out items:** 40 per run, 5 runs; practice tasks the learner sees: 20
- **Gate:** {"metric": "accuracy at least 90% on the held-out tasks, and at most one task broken that was right without the lessons", "pass_permille": 900, "runs": 5, "error_bar": true, "note": "every one of the five runs must meet both marks; below it there is no credit and no lesson is kept"}

### C-L16-1 Order handling: rules for goods paid in credits (K055 (Mind2Web, Deng et al. 2023))

- **The agent writes:** at most six rule lines, each when <feature>=<value> and ... then <action>, optional reason; repeats merged, no contradiction
- **Scored by:** the share of the held-out tasks a scripted executor gets right with the rules in memory (new names, six tasks for each hidden rule and sixteen where the default is right), and the tasks it used to get right that the rules now break
- **Checker:** the same replay the lesson gate runs before a lesson enters memory; the hidden rules are committed by hash before any sitting; a lesson that carries a service name of the held-out tasks is refused
- **Held-out items:** 40 per run, 5 runs; practice tasks the learner sees: 20
- **Gate:** {"metric": "accuracy at least 90% on the held-out tasks, and at most one task broken that was right without the lessons", "pass_permille": 900, "runs": 5, "error_bar": true, "note": "every one of the five runs must meet both marks; below it there is no credit and no lesson is kept"}

### C-L11-2 Registry writes: which to append, reject or quarantine (K041 (Inner Monologue, Huang et al. 2022))

- **The agent writes:** at most six rule lines, each when <feature>=<value> and ... then <action>, optional reason; repeats merged, no contradiction
- **Scored by:** the share of the held-out tasks a scripted executor gets right with the rules in memory (new names, six tasks for each hidden rule and sixteen where the default is right), and the tasks it used to get right that the rules now break
- **Checker:** the same replay the lesson gate runs before a lesson enters memory; the hidden rules are committed by hash before any sitting; a lesson that carries a service name of the held-out tasks is refused
- **Held-out items:** 40 per run, 5 runs; practice tasks the learner sees: 20
- **Gate:** {"metric": "accuracy at least 90% on the held-out tasks, and at most one task broken that was right without the lessons", "pass_permille": 900, "runs": 5, "error_bar": true, "note": "every one of the five runs must meet both marks; below it there is no credit and no lesson is kept"}

### C-L8-2 What a record keeper retains (K028 (Zep, Rasmussen et al. 2025))

- **The agent writes:** at most six rule lines, each when <feature>=<value> and ... then <action>, optional reason; repeats merged, no contradiction
- **Scored by:** the share of the held-out tasks a scripted executor gets right with the rules in memory (new names, six tasks for each hidden rule and sixteen where the default is right), and the tasks it used to get right that the rules now break
- **Checker:** the same replay the lesson gate runs before a lesson enters memory; the hidden rules are committed by hash before any sitting; a lesson that carries a service name of the held-out tasks is refused
- **Held-out items:** 40 per run, 5 runs; practice tasks the learner sees: 20
- **Gate:** {"metric": "accuracy at least 90% on the held-out tasks, and at most one task broken that was right without the lessons", "pass_permille": 900, "runs": 5, "error_bar": true, "note": "every one of the five runs must meet both marks; below it there is no credit and no lesson is kept"}

### C-L8-3 Research notes worth keeping (K010 (ReasoningBank, Ouyang et al. 2025))

- **The agent writes:** at most six rule lines, each when <feature>=<value> and ... then <action>, optional reason; repeats merged, no contradiction
- **Scored by:** the share of the held-out tasks a scripted executor gets right with the rules in memory (new names, six tasks for each hidden rule and sixteen where the default is right), and the tasks it used to get right that the rules now break
- **Checker:** the same replay the lesson gate runs before a lesson enters memory; the hidden rules are committed by hash before any sitting; a lesson that carries a service name of the held-out tasks is refused
- **Held-out items:** 40 per run, 5 runs; practice tasks the learner sees: 20
- **Gate:** {"metric": "accuracy at least 90% on the held-out tasks, and at most one task broken that was right without the lessons", "pass_permille": 900, "runs": 5, "error_bar": true, "note": "every one of the five runs must meet both marks; below it there is no credit and no lesson is kept"}

### C-L2-2 Reviewing a draft: critique that changes the right thing (K014 (Self-Refine, Madaan et al. 2023))

- **The agent writes:** at most six rule lines, each when <feature>=<value> and ... then <action>, optional reason; repeats merged, no contradiction
- **Scored by:** the share of the held-out tasks a scripted executor gets right with the rules in memory (new names, six tasks for each hidden rule and sixteen where the default is right), and the tasks it used to get right that the rules now break
- **Checker:** the same replay the lesson gate runs before a lesson enters memory; the hidden rules are committed by hash before any sitting; a lesson that carries a service name of the held-out tasks is refused
- **Held-out items:** 40 per run, 5 runs; practice tasks the learner sees: 20
- **Gate:** {"metric": "accuracy at least 90% on the held-out tasks, and at most one task broken that was right without the lessons", "pass_permille": 900, "runs": 5, "error_bar": true, "note": "every one of the five runs must meet both marks; below it there is no credit and no lesson is kept"}

### C-L14-3 When to trust a self-correction (K015 (Huang et al. 2023))

- **The agent writes:** at most six rule lines, each when <feature>=<value> and ... then <action>, optional reason; repeats merged, no contradiction
- **Scored by:** the share of the held-out tasks a scripted executor gets right with the rules in memory (new names, six tasks for each hidden rule and sixteen where the default is right), and the tasks it used to get right that the rules now break
- **Checker:** the same replay the lesson gate runs before a lesson enters memory; the hidden rules are committed by hash before any sitting; a lesson that carries a service name of the held-out tasks is refused
- **Held-out items:** 40 per run, 5 runs; practice tasks the learner sees: 20
- **Gate:** {"metric": "accuracy at least 90% on the held-out tasks, and at most one task broken that was right without the lessons", "pass_permille": 900, "runs": 5, "error_bar": true, "note": "every one of the five runs must meet both marks; below it there is no credit and no lesson is kept"}
