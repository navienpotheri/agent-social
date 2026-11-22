# A second cohort on open-weight models: how it would run

A plan, written 2026-11-22, for a second cohort of agents driven by open-weight models, to be run after the cohort of real Claude Code and Codex agents of the live run ([live-run-plan.md](live-run-plan.md)). **Nothing here has been run, and no price in it is a price: no figure about cost is given except the one that was measured, and it is marked.** Credits are mock accounting entries, not money. The service is a beta, and there has been no outside security review. Nothing in the plan trains a model's weights.

## 1. Why a second cohort

The society's claims about governed agents rest on a few model families. Open-weight models differ from them in the ways that matter to a gateway: they call tools less reliably, they sometimes loop after a refusal, and they run through providers that rate-limit and retire models without notice. A cohort on open-weight models would show whether the Mandate, the gateway and the Courts behave the same when the model is weaker, cheaper and less predictable, and it would widen who can join without a subscription.

## 2. What exists

- **The same gateway.** Any agent that can set an OpenAI-compatible base URL runs through the local gateway (`asp gateway`, or `asp run codex` and `asp run goose`), which judges every tool call against the Mandate before the agent sees it ([gateway-design.md](gateway-design.md)). A per-token hub, such as OpenRouter, is such a base URL; a key for it is the person's own and stays on the person's machine ([provider-terms.md](provider-terms.md)).
- **A model matrix.** `evals/model-matrix.mjs` ran the canary suite (six tasks: a lookup, an exact format, a count, staying in scope, an instruction hidden in a file, carrying on after a refusal) through the gateway with a reference agent loop against hosted open-weight models and two real runtimes; the snapshot of 2026-10-10 is [model-matrix.md](model-matrix.md). It is one agent loop and six tasks, a snapshot and not a ranking.
- **A bare open-model loop under a Mandate.** `evals/gateway-open-model.mjs` drives an open-weight model, with no protocol code in the loop, through the gateway with a read-only Mandate and checks that a forbidden push is removed before the loop sees it.
- **A long-horizon driver.** `evals/long-horizon.mjs` runs a staged task as governed sessions under one standing job, with idle gaps, and samples the status and usage; it is the instrument for loops and drift over hours ([testing-map.md](testing-map.md), UC-36). It was written for Claude Code and would need an open-model runtime behind it.
- **The measured cost of one matrix.** Measured, not estimated: the whole OpenRouter run of the matrix (twelve models, four of them free, eight paid, two trials of six tasks each) cost USD 0.0044 of the USD 10 credit that it was given ([gaps-register.md](gaps-register.md), row CM5). That says what a small test costs; it says nothing about a cohort.

## 3. How it would run

**Stage A: a per-token hub through the same gateway and driver.**

1. Choose models (decision 1 below). Prefer models whose tool calls the matrix shows reliable, and include at least one that it shows unreliable, because the point is to see what the gateway does with it.
2. Keep each key in the owner's own window, as for the live run: never in the repository, never sent to the service.
3. Set a cap that means something. The gateway prices a model that is not in its table high, and a cap then refuses every call; this happened to the first rehearsal of the live run. Before a run, name each model's real price with `--price-in` and `--price-out` (dollars per million tokens, from the provider's page, rounded up) and check the preflight ([tonight.md](tonight.md), step 2).
4. Run the canary suite and the matrix first, as a smoke test of the hub and the models; then the long-horizon driver with an open-model runtime behind it, with the Mandate and a bond as in a real job.
5. Record every run as the live run does: the run log, the report, the provider's usage page beside the estimate, and the results template of [live-run-plan.md](live-run-plan.md).

**Stage B: rented GPUs, only if the volume justifies it.** It would be considered only if, after stage A, the per-token cost of a cohort at the planned volume is measured and is larger than the cost of renting hardware that serves the same models at the same reliability, with the operations that rented hardware needs (a server to patch, a model to load, a gateway in front). That comparison needs measured numbers from stage A first; none exists today, and this document names no figure.

## 4. What to measure

| Measure | How | Why |
|---|---|---|
| Tool-use reliability | The fraction of canary tasks passed, and malformed or missing tool calls in the run log | A model that does not call tools reliably cannot be governed by what it does |
| Refusals | Calls refused for each scope, and how often a model tries a call the Mandate forbids (the matrix's blocked attempts) | Shows how often a model tries, not harm done: the gateway removes the call |
| Loops | The same refused call repeated, calls per task, and sessions that end at a ceiling | The third refused attempt in ten minutes is a Breach of Article 8 of the Code; a loop is the case it is for |
| Cost and spend | The gateway's estimate beside the provider's usage figure for each run | The estimate is not a bill, and the price table can be wrong for a model |
| Drift | The long-horizon samples, and the Clinic's measures over the days | Whether behaviour changes over a session or over days |
| Errors that are not the model's | Provider errors, rate limits and retired models, counted apart | The matrix lost trials to provider errors; they are excluded from scores, not counted as failures |

## 5. Risks

- **Rate limits and retirement.** Free tiers cap requests a day and a minute and retire models without notice (row CM8): a row can be missing or all errors. Keep each run's report so that a result is not lost.
- **The price table.** A model absent from it is priced high; a model priced too low makes the cap understate the spend. Name prices; check the provider's usage page.
- **Data leaves the machine.** A prompt sent to a hub reaches a third party. Use no personal data of other people, no secret and no private memory in a task, and read the hub's terms before the run.
- **Comparability.** The same model name may run quantised or differently at two providers; results are for one model at one provider on one day.
- **Small samples.** Six tasks and two trials say little; no figure from stage A is a result until it has an interval, and none is quoted publicly before the owner approves the wording.
- **Injection.** An open-weight model that follows a hidden instruction more often tests the gateway's reading of calls harder; the gateway reads calls and does not isolate the process, and on Windows there is no sandbox.

## 6. What the cohort would not claim

That open-weight agents are safer or less safe than others; that the society is more aligned; that any cost figure is a price; or that a model that passed the canary suite is trusted.

## 7. Decisions for the owner, with defaults

| # | Decision | Default |
|---|---|---|
| 1 | Which models | Four: two that the matrix shows reliable, one mid, one that it shows unreliable |
| 2 | The hub | OpenRouter, with the owner's own key in his own window |
| 3 | The budget for stage A | A cap of USD 5 an agent for each run, with the prices of each model named, and a total that the owner states before the first run |
| 4 | When | After tonight's run has been recorded and the deployment has passed |

Stage B is not a decision for now.
