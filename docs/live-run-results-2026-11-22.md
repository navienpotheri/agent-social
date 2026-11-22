# The live run of 2026-11-22: what the owner ran and saw

Recorded 2026-11-22 from the outputs that the owner pasted, as relayed by the lead; **nothing in this file was run or checked by a worker**, and no output beyond what is stated here was seen. Credits are mock accounting entries, not money. The service is a beta, and there has been no outside security review. The owner ran the sessions himself. This is the record that [live-run-plan.md](live-run-plan.md) asks for; it moves no row by itself (section 4).

## 1. The sessions

| Session | Runtime and model | What was run | What the owner saw |
|---|---|---|---|
| `36f6fb95` | Claude Code, a haiku model | A governed run with one allowed call and one call that reaches the network (item 1 of the plan) | One call refused, with the scope `shell.network` |
| `1681ffc5` | Codex | The same task, with the `curl` call | 2 calls judged, 1 allowed and 1 refused; the refusal had the scope `shell.network`; 1 model request, 18,525 tokens in and 142 out; a run log of 7 events whose hash chain verifies |
| `0364ec86` | Codex | The "Say done" run | No result was relayed beyond its session id and the task |
| `61ed67fe` | Codex | A run with a wrong key | Failed with a 401 from the provider; the owner reported that the key was the wrong one |

## 2. What the two governed runs show

In both the Claude Code run with a haiku model and the Codex run `1681ffc5`, the call that reaches the network was refused with the scope `shell.network`. For `1681ffc5` the allowed call is recorded too (1 allowed, 1 refused); for `36f6fb95` only the refusal was relayed. That is the observation that item 1 and item 5 of the plan count on: a governed session with one refusal under the Mandate. Session `1681ffc5` also shows that the number of judged calls (2) is the sum of the allowed (1) and the refused (1), and that its run log, 7 events, verifies as a hash chain.

## 3. Limits, stated plainly

- **The runs were `--local`.** A `--local` run makes its own identities on the owner's machine and keeps its records in his ASP home: **no signed Action report was written to a log on a service**, so none of these sessions has a record that anyone else can check. The hash chain of the run log shows that the file was not changed after it was written; it does not show that it was written by a real model.
- **Two of the four sessions are not claims about governance.** For the "Say done" run nothing was relayed beyond its id, and the wrong-key run was refused by the provider with a 401.
- **Costs.** The owner reported that his two provider balances, 11.26 and 6.45, were **unchanged** on the providers' own pages after the runs. It is not a measurement of cost, and the gateway's own figure is an estimate and not a bill.
- **One model, one machine, one evening.** Nothing here says how other models, other machines or longer sessions behave.
- **The other items of the plan were not run** and are not reported here.

## 4. What this moves in the register

Nothing moves by this file alone. A row moves only when a block of results matches its "counts when" line ([live-run-plan.md](live-run-plan.md), section 5), and a `--local` run cannot show a row that depends on a signed record on the service (for example DK1602, DK650 and DK1600). What the two refused-curl sessions support is the observation of P21 and of E5 for Claude Code and Codex, to be recorded in [live-run-checklist.md](live-run-checklist.md) with the owner's confirmation; until then the pages say nothing about it.

## 5. The figures, in one place

| Figure | Value |
|---|---|
| Sessions recorded | 4 |
| Sessions with one refused call | 2 (`36f6fb95`, `1681ffc5`) |
| Calls judged in `1681ffc5` | 2 (1 allowed, 1 refused) |
| Model requests in `1681ffc5` | 1 |
| Tokens in `1681ffc5` | 18,525 in and 142 out |
| Events in the run log of `1681ffc5` | 7, the hash chain verifies |
| The owner's two provider balances | 11.26 and 6.45, unchanged |
| The cap of each run | USD 5 |
