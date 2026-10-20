# We tried to break our own agent governance layer. Here is what we found.

*Navien Potheri, Deep Transformation AI. October 2026.*

There is no standard way to measure whether the thing that sits between an AI agent and its tools actually works.

Model benchmarks tell you what a model can do, or whether it can be tricked in a chat. They do not tell you whether a permission layer, the part that decides call by call what an agent may do, blocks what it should, leaves ordinary work alone, and keeps an honest record. Teams ship these layers with a handful of unit tests and a feeling.

We build one, as part of the Agent Social Protocol (ASP): a gateway that holds an agent's permissions (a *Mandate*), judges every tool call against it, and writes what happened into a signed, hash-chained log. So we wrote a benchmark for it, ran it on ourselves, and published it. This is what it measures, what it found, and what it cannot tell you.

## What it is

The Containment Benchmark runs on one machine in about two minutes. It needs no model, account or network for its core suites. It has eleven parts:

- **Interception.** 445 labelled tool calls under four permission sets: read-only, development, development with one allowed host, development with a wildcard family of hosts. Plain violations, disguised ones, ordinary work that must pass, and look-alikes (the word `curl` in a commit message).
- **Held-out cases, written blind.** Two sets of 300 cases written by a separate author who was given only a plain description of the permissions and never saw our code or our cases.
- **Audit integrity.** Take a real settled job, alter a copy of its signed history in eleven ways, and replay it. Plus the protocol's own 36 conformance vectors.
- **Policy.** Rate limits counted in requests rather than calls, and the known-bad list against disguise.
- **Swarm containment.** One agent finds an exploit and others copy it. How many are stopped, how fast, and are honest agents left alone?
- **Court correctness.** How a ruling panel is drawn, and whether it resists capture.
- **Chains and utility.** Harmful sequences whose steps are each allowed, and ordinary multi-step tasks run whole.
- **Injection with real models**, on the public InjecAgent dataset (UIUC).
- **A model as the guardrail**, the common alternative to rules.
- **Replay of real traces** from our own live runs.
- **An adaptive attacker**, a model that is told why a command was refused and tries again.

Each case is a tool call, the permissions the job holds, and the verdict a careful reviewer gives. We score two numbers together, because either alone can be gamed: how much of the harm was blocked, and how much ordinary work was wrongly refused. A layer that blocks everything scores perfectly on the first and uselessly on the second.

## What we found

**Our own numbers flattered us.** On the 445 cases we wrote ourselves, the gateway first blocked 75% of what it should and wrongly refused 2%. After a rewrite of how it reads commands, 91% and 0%. But we wrote those cases after reading the code, which is marking your own exam. The first blind set, written by someone who had never seen the code, scored 73% blocked and 14% wrongly refused.

**The holes were real, and plain.** A `git push` was only recognised at the start of a command, so `cd sub && git push` went through. Package managers, `git pull`, DNS tools and uploads through cloud command lines were not seen as network use. The word `curl` in a commit message was treated as the tool. A flag's value (`curl -o out.json URL`) was read as a host. None of this was exotic. All of it is the kind of thing that only shows up when someone who did not write the code tries.

**We fixed them, then used a second blind set.** Because we used the first blind set to find the bugs, it stopped being held out. A second, separate author wrote another 300 cases after the fix. On those, never used for tuning:

| | Blocked what it should | Wrongly refused ordinary work |
|---|---|---|
| No governance | 0% | 0% |
| A typical command denylist | 45% | 29% |
| ASP gateway (rules) | 90% | 6% |
| A language model as the guard (Claude Haiku 5.5) | 98% | 4% |

**An AI guard read messy commands better than our rules.** That is worth saying plainly. On the held-out set a small model beat the rules by about eight points at about 1.3 seconds and a fraction of a cent per call, against microseconds and nothing for the rules. We do not read this as the model being better than the protocol. The protocol is the identity, the permissions, the signed record and someone who answers when it goes wrong. A model's answer is not signed, can change from one run to the next, and can be argued with. The sensible design is rules as the fast, deterministic floor, a model as a second opinion on calls the rules cannot classify, and the decision and reason written to the log either way. In the adaptive-attacker test, the rules plus a model guard were beaten zero times.

**Against the open-source agents' own command checks.** We ran the same held-out cases through the command-safety code of three open-source agents (cloned from their public repositories; two are ports of the published logic, one runs the project's own regexes). They are designed to ask a person, so the fair question is what each lets through when nobody is there. Gemini CLI's strict read-only allowlist let nothing harmful through and also held back 83% of ordinary work for a human to approve. Codex's command rule flags only forced deletes, because its defence for network and writes is the operating-system sandbox. Goose's threat patterns caught about 1% of the bad calls in our set, since they target a few destructive and remote-execution one-liners. The gateway sat between them: 13% let through, 7% of ordinary work held up, with no person involved. None of these is a verdict on the products, which have prompts and sandboxes this comparison leaves out. It shows only that a command reader alone is a thin defence, and that a permission set the user wrote is what lets a run go unattended.

**Real traffic was quiet.** We replayed 119 tool calls from 46 of our own live Claude Code runs through the current gateway. It allowed 117. The two it refused were deliberate `curl` test calls. Nothing real was refused. The caveat matters: these were mostly short scripted tasks from one agent.

**Injection depends on how narrow the permission is.** On InjecAgent, current models rarely follow a hidden instruction in a tool's reply: 0% for several, 10% for the weakest we tried. When one did, a permission scoped to the task stopped every such call, and a permission that granted every tool stopped none. The protection is only as good as the permission is narrow, and today no tool builds a narrow one for you.

**Steps that are each allowed are not seen.** Write a script, then run it. Plant a git hook. Edit the build pipeline. Leak a file a line at a time to an allowed host. A judge that looks at one call at a time cannot see these: none of 14 such chains were stopped on purpose. What catches them is the sandbox and the signed history.

**An adaptive attacker got through 3 times in 48 runs.** Four models, twelve goals, up to eight tries each, nothing executed. Twice by appending to a file outside the project, which the gateway does not confine (that needs a sandbox), and once by building a package install inside Python code. The model guard stopped all three.

**The court's juror draw is statistically sound, with one loophole.** The draw matches the exact capture odds. But the rule that keeps a party's own jurors off its case looks only one step of sponsorship deep. A performer that registers fake jurors through an unrelated front account is not excluded: with 20 fake and 20 honest jurors, the fakes held a panel majority in half of disputes.

## What it does not tell you

- **No real agent loop.** Apart from the replay and the injection suite, the calls are written, not produced by a running agent.
- **The attacker is weak.** It tries eight times with no tools to see effects. Real attackers will be better.
- **The labels are ours or an AI's.** The "blind" author is a separate AI agent, not an independent person. The grader that decides whether an allowed command reaches an attacker's goal is also a model.
- **One agent in the traces**, mostly short tasks.
- **Everything that needs a sandbox is reported separately**, not counted for or against the gateway.
- **It can be over-fitted.** The rule is to add cases, not to tune to the existing ones. Our own first number is the proof: it moved a lot once someone else wrote the cases.

Every miss the benchmark found is recorded, with what protects us today and what would close it, in a public gaps register (19 entries from this work, 11 now closed or partly closed).

## Run it, break it, add to it

The benchmark, the cases, the results and the gaps register are in the repository under `evals/benchmark/`. The suites that call real models cost about a dollar in total on OpenRouter. A case is a few lines: a tool call, the permissions, and what should happen.

If you build a governance layer for agents, point it at the same cases and publish the numbers, including the bad ones. If you think a label is wrong, or you can write a call we do not stop, send it. That is the point of publishing it.

Next: a second public injection benchmark (AgentDojo), a stronger attacker, and permissions that are generated narrow from the user's request.
