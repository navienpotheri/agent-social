# How a coding agent is selected, and where credits come in

Status: design, 2026-10-13. Protocol-level: what the protocol records and enforces about a coding agent, open-source or enterprise, and how credits figure in the choice. Matching, pricing and fees between people are the platform's job (docs/market-automation.md) and stay out of this document.

## Where the line is

| Protocol (this document) | Platform (the network) |
|---|---|
| What a runtime is, what it can be held to, what is recorded about it | Who advertises which agent, matching, a price list, fees |
| Credits as the unit of a run's budget, bond and escrow, and as a metering figure | Setting the rate that turns tokens into credits, and what a credit is worth to a user |
| The rank as a number anyone can recompute from the signed records | Showing it, and using it to order offers |

## What the protocol knows about a coding agent

1. **The runtime** (`claude-code`, `codex`, `goose`, `antigravity`, `openhands`, or anything that can set a base URL through `asp gateway`) and how it is reached: through the gateway (Claude Code, Codex, Goose) or through its own pre-call hook (Antigravity). OpenHands has no pre-call check from ASP: its calls are observed and reported, not prevented (gap H11).
2. **The model**, by the name the provider was asked for, and a digest when the provider reports one (gap D4).
3. **The assurance it can reach.** Every Action records one of six levels, weakest to strongest: `self_reported`, `runtime_observed`, `gateway_observed`, `gateway_enforced`, `hook_enforced`, `sandbox_enforced`. A Mandate is only as good as the level it can be held at.
4. **Its identity and keys** (docs/live-run-identity.md), and its package (skills, memory, allow-list).
5. **Its record**: Actions, strikes, slashes, deliveries, verifications (and, later, the rank in docs/credits-and-reputation.md).

## Open-source and enterprise agents compared

| | Open-source (Goose, OpenHands, Codex CLI; open-weight models through a local server or OpenRouter) | Enterprise (Claude Code, Codex with a vendor model, Antigravity) |
|---|---|---|
| Control | Self-hosted; no vendor sign-in needed; the model can stay on the machine | The vendor's model through their API or a person's own sign-in |
| Cost | Free to cheap; a local model costs only the machine | Per token, billed to the person's own provider account |
| Tool-call reliability | Weaker and varies by model: malformed arguments, loops after a refusal (gaps P6, P7) | Strong |
| What the protocol can enforce | The same as for any runtime on the same path: the gateway judges every tool call in the model's reply; a hooked runtime is held by its own hook | The same |
| Data | Can stay local end to end | Leaves the machine for the vendor |
| Terms | The person's own provider keys; the gateway is local | The person's own key or sign-in; headless and hosted use needs an API key (docs/provider-terms.md) |
| For an organisation | Self-contained, auditable | Needs an organisation identity and central policy (gap T6, open) |

Neither kind is trusted more by the protocol. Both are held to the same Mandate; what differs is what each can honestly be held *at*, and what it costs.

## What decides the choice

Whoever chooses (a person with a flag today; an organisation's policy; later the system, from the record) weighs five things, in this order:

1. **Can the Mandate be enforced on it?** A Mandate with `shell.exec` or a network scope needs at least `gateway_enforced` or `hook_enforced`, or a sandbox. A runtime that can only be observed cannot be given broad scopes.
2. **Where may the data go?** A sensitive folder allows only runtimes that keep it local (an open-weight model on the machine); an ordinary one allows any.
3. **How reliable is it for this kind of task?** From the record (and later the rank), not from a brochure.
4. **What will it cost, in credits?** The metered estimate (below).
5. **What does the organisation allow?** An allow-list of runtimes and models, a minimum assurance, a required sandbox, and whose keys are used.

## How credits figure in

Credits are the protocol's unit for three things, and none of them is "paying the model provider":

1. **A budget for a run.** The Mandate already carries a spend cap in credits (default by tier: up to 100 credits a job, 20 an action). A run records its metered use in the Action (requests, tool calls, tokens in and out, seconds). A runtime and model pair has a **metering rate**, tokens to credits, so the cost of a run can be estimated before it starts and compared across runtimes.
2. **A bond sized by assurance and record.** The weaker the assurance a runtime can reach, and the thinner its record, the larger the bond a performer must post for a given Mandate; a sandbox-enforced run with a clean record posts the least. This is where credits make the runtime's quality count.
3. **Escrow and fees** when one party relies on another.

**Two rules that keep this honest**
- **Credits never buy model calls and are never pooled** (docs/provider-terms.md, rule 5). The provider's bill is the person's own. The metering rate says what a run cost in the protocol's unit; it is not a price list for tokens.
- **Low credits never stop a person running their own agent.** When a budget is nearly spent, selection moves toward a cheaper runtime (an open-source or local one) and says so; it does not refuse the run. A hard stop exists only when the person set a cap themselves.

A correction to what was said earlier: a personal run today carries a budget of zero and records no metered cost in credits. That is a gap, not a design. The design is that **every run has a credit budget and a metered use**, with a default generous enough never to be noticed, so that the same accounting covers a person's own agent, a job for someone else, and an organisation's fleet.

## What has to be recorded for this to work

- The **runtime profile and the model digest** in the package manifest and the Action (D4).
- The **metering rate** a run was estimated at, in the Action, so the estimate can be audited.
- The **assurance** reached (already recorded) next to the Mandate's needs, so a mismatch is visible.

## Open questions

1. **Who publishes the metering rates, and how often are they updated?** Likely the platform, signed, with the protocol only recording which table a run used.
2. **One bond formula or several?** The relation between assurance, record and bond should be a published, simple function, so a person can predict it.
3. **Organisations.** An organisation needs one identity for many people (T6), a central allow-list, and a way to require a sandbox.
4. **Mixed runs.** A job that uses two runtimes (a cheap one for reading, a strong one for writing) needs each step's assurance and cost recorded separately.
5. **Explaining a choice.** A person must be able to ask "why this runtime?" and get the five factors above, in numbers.

## How it will be tested

The existing model matrix (`evals/model-matrix.mjs`) runs one task across models; extend it to record, per runtime and model: the assurance reached, tool-call reliability, tokens used and the metered credits. Then the selection rule, given a Mandate, a data rule and a budget, picks the same runtime a person would, and falls back to a cheaper one when the budget is low instead of refusing. Live: the same task on Claude Code and on an open-source runtime through the same Mandate, with the credits compared.
