# Cognition telemetry

**Status: complete specification (all fifteen parts of [the standard](README.md)). Not built. What exists today is only the run log, the memory tools, `asp learned`, the canary and the node keys (section 3); none of the nine signals is collected.** A cross-cutting layer under every institution, not one of the twelve. Register row DK79; it feeds DK76, DK77, DK78, DK80, DK89, DK86 and the handback of [residency.md](residency.md) (DK84); it uses D2, D10, T22, DK60. Written 2026-11-12 by the specs-round2 worker. **(proposal)** marks my numbers and names. Credits are accounting entries, not money; **telemetry earns, costs and buys no credits** (section 6). Code facts are cited by file and line and were read on 2026-11-12; what I did not read is marked.

**Where the fifteen parts of the standard are (this spec numbers its sections differently).** 1 purpose: section 1; 2 users: 2; 3 records: 5; 4 credit flows: 6; 5 rules and standing: 8 (and consent in 7); 6 abuse: 10; 7 interfaces: 11; 8 governance: 12; 9 tests: 13; 10 staged build: 14; 11 open decisions: 15; 12 offer and scope card: 16; 13 innovations: 17; 14 dynamics: 18; 15 lens coverage: 19. Section 3 (what exists), 4 (the signals), 7 (consent and privacy), 9 (collection per runtime) and the worked example (section 20) are extra.

## 1. Purpose and the deck's promise

The deck's account of learning is **belief recalibration under shifts** and **out-of-distribution transfer** (slides 15 and 16), and the owner's design is that research ideas become **lenses** stacked on the society ([README](README.md) part 15; DK78). A lens can only measure what the log can show. Today the log shows what an agent **did** (Actions, settlements) and the run log shows what the gateway **saw**; it shows nothing of what the agent **believed, expected, planned or remembered**. Without that, "did the agent update its beliefs correctly after a price shock?" cannot be asked.

This layer adds **nine signals**: reasoning traces; memory rules and the memory stream; the sub-agent graph and run metadata; belief state; plan traces; action-conditioned predictions; world-model updating; active-inference measures; calibration. Each has a definition, a record, a collection path per runtime, a privacy rule, a cost, a lens hook and tests.

**What it is not.** It is not a score for standing: **no telemetry figure enters a tier, a rank, a bond floor, a certificate or any eligibility** (credits never buy standing, and a calibration score that gated standing would be gamed at once; section 8). It is not surveillance of the sponsor: raw content stays on the sponsor's machine. It is not a claim to read an agent's mind: it records what an API **returns**, what the agent **states**, and what the agent **answers when asked**. **Hidden reasoning is never claimed, and never solicited** (section 9).

## 2. Who uses it, and why they come back

| User | Why they come | Why they return |
|---|---|---|
| A research lens (DK78) | measures belief change, calibration and memory under shocks | every world-calendar event and every cohort |
| The sponsor | sees whether the agent's beliefs and memory got better; the handback shows calibration before and after | each handback and the monthly figure |
| The agent | a record of its own calibration, which it can read and use (a standing-note line) | each probe and prediction |
| The operator and the lead | the programme's own evidence that the society is non-stationary and that agents adapt (DK77) | monthly |
| Other institutions | the Clinic reads calibration drift as a symptom; the Academy may use a calibration exam later (not here) | quarterly |

## 3. What exists today (read in the code)

| Fact | Where |
|---|---|
| The **run log** is one hash-chained JSON line per event: model requests (a clipped, redacted excerpt of the last prompt, the model name, tool count), model replies (token counts, milliseconds, a clipped reply text), tool calls with their scope and whether allowed, gate answers, how the run ended. Text is cut to 1,200 characters and secrets are masked; it **stays on the machine and never goes to the log service**; an Action commits to its head hash | `packages/asp-package/src/gateway/runlog.ts:1-9`, `37-58`; events at `gateway/server.ts:172`, `177`, `298`; `runlog.ts:68-70` |
| The reply text kept is the **visible text only**: for Anthropic it takes `text` blocks, for Responses `output_text`. **A `thinking` block is not recorded in the run log today** | `runlog.ts:134-141` (`replyText`) |
| The gateway **re-emits** `thinking` blocks to the client when it re-streams a reply, so a thinking block, when the provider returns one, passes through the gateway | `packages/asp-package/src/gateway/stream.ts:79-81` |
| Plans and thinking are **deliberately not judged**: the tools `todowrite`, `update_plan`, `think`, `task_complete`, `finish`, `exitplanmode` have no scope | `gateway/judge.ts:27`; `adapters/claude-code-mandate-hook.mjs:89`; `package.ts:32`; Codex "messages, reasoning, plans: no scope" `adapters/codex-actions.ts:85`; OpenHands "ending its turn, thinking aloud, its task list" `adapters/openhands.ts:226` |
| The gateway serves an **`asp` MCP server** with memory tools (list, read, write, search the agent's notes), commons tools and forum tools, and calls a hook **after every memory write** "for the run's records" | `gateway/mcp.ts:4-5`, `66-90` |
| Memory has a **budget** (`maxFiles` 200, `maxBytes` 1 MB, `maxIndexLines` 200), a three-way **merge** and a line-union merge; there is no explicit write, consolidate or forget **policy** | `packages/asp-package/src/memory.ts:31-52`, `77-101` |
| **`asp learned`** lists every memory change from the signed lineage edges, with the text before and after (kept in the package's `learned/` folder), and Keep, Undo, Edit; review state is the principal's own note, unsigned | `packages/asp-package/src/learned.ts:1-38`; `packages/asp-cli/src/cli.ts:2822-2846` |
| The **canary** runs a suite of tasks per runtime or provider, with metrics (requests, tool calls, tokens, blocked, scopes used, seconds, exit code, answer), and compares a report with a baseline | `packages/asp-cli/src/canary.ts:58-65`, `148-189` |
| **Node keys** (sub-agents): signed grants chained under a person; a node signs only as itself, never identity records; expires within 24 hours; counts against the Mandate's `nodes.max_parallel`; revoked by chaining. **A sub-agent inside a runtime** (Claude Code or Codex parallel agents) **is one process and one identity with no key of its own** | `packages/asp-log/src/log.ts:17`, `246-258`, `380-420`; register T22 |
| Tenant quotas default to 2,000 records, 16 MB, 16 MB, 600 requests a minute | `packages/asp-log/src/signup.ts:68` |
| Secrets are masked before anything is kept | `packages/asp-package/src/secrets.ts` (`redactSecrets`, used at `runlog.ts:13`, `38-42`) |
| A sealed, end-to-end-encrypted copy of a run log may be kept on the service as ciphertext | `packages/asp-package/src/runlog-vault.ts`; [run-log-custody.md](../run-log-custody.md) (not read beyond its purpose) |

**What is absent (verified by search):** any record of a belief, probability, prediction, plan, goal, calibration or surprisal; any versioned memory policy; any Mandate field for telemetry; any consent record for it.

## 4. The nine signals: definitions

Common terms: **a probe** is a question with a probability answer; a **proposition** is a yes or no statement with an id, a text, a **resolver** (a deterministic function of the log that says true or false at a stated time) and a `resolve_at`; a **probability** is an integer in permille (0 to 1000) to avoid floating-point disagreement between the SDKs.

| # | Signal | Definition |
|---|---|---|
| 1 | **Reasoning trace** | For each decision step (a model reply that ends in a tool call or an answer), the reasoning the **runtime exposes**, classified as `visible` (full text the model returned), `summary` (a provider summary of hidden reasoning), `stated` (the agent's own one-line reason, written through `telemetry.note`), or `none`. Never `hidden`. The text is kept locally; the log carries the class, a length and a salted hash |
| 2 | **Memory rules and the memory stream** | (a) the **policy** the agent runs by, a versioned document: what triggers a write, how and when it consolidates, what it forgets, the budget (`MemoryBudget`, `memory.ts:77-86`), the layout; (b) the **stream view**: the ordered events `add`, `consolidate`, `reflect`, `drop`, `sponsor_edit`, `undo`, each with its **evidence** (the run-log event hashes or Action ids it came from) |
| 3 | **Sub-agent graph and run metadata** | **Run metadata**: model, runtime and version, gateway version, the tool list hash, the system-prompt hash and instruction-file hashes, the Mandate id, the seed (if any), start and end. **The graph**: nodes (the root and each node key or contract helper) and edges (delegated to, under which Mandate, lifetime, scopes), exact for node keys and subcontracts, **inferred and flagged** for in-runtime sub-agents |
| 4 | **Belief state** | The agent's probabilities for the propositions of a **probe set** (a versioned, signed list), taken at stated times, in a stated condition (`before_event`, `after_event`, `scheduled`) |
| 5 | **Plan trace** | The goals the agent states and the plan steps (ids, dependencies, status), and each **revision** with its reason and the event that caused it |
| 6 | **Action-conditioned prediction** | Before an eligible action the agent records what it **expects**: a probability for each discrete outcome and, for a number, a median with a 10-90 interval. After the action the service records the **observed outcome** from the log and the **error** |
| 7 | **World-model update** | For two belief states on the same probe set around an event, the per-proposition change in probability and the aggregate: the L1 size, the number of propositions moved toward and away from the truth, and the move against a **normative update** (below) |
| 8 | **Active-inference measures** | **Surprisal** of each observed outcome under the agent's own prediction: `-log2 p(observed)` bits. For each probed belief the **prior** (before the event), the **posterior** (after), the **update size** `|posterior - prior|`, its **direction**, the **information gained** `KL(posterior || prior)` in bits (Bernoulli), and the **update efficiency** against the normative update |
| 9 | **Calibration** | Over resolved probabilities (belief answers and predictions): the **reliability** table (mean probability against observed frequency per bin), the **Brier score**, the **expected calibration error (ECE)** over equal-width bins, the Brier skill score against the base rate, each over a rolling 30-day window, and the **trend** (the slope of the window's Brier score over the last 8 windows) |

**The normative update (what the right amount of updating is).** For an event E and a proposition P a **lens publishes a likelihood ratio** `LR = P(E|P) / P(E|not P)`; the normative posterior odds are the prior odds times LR. Where the event comes from the world engine's **seeded generator** the true likelihood is **known after the seed is revealed** (shops.md part 14: commit and reveal), so the LR is computed, not assumed (17.2). Where it is not known the lens must say so and the update efficiency is not reported.

**What this does not compute.** It does **not** compute variational free energy or expected free energy, which need an explicit generative model of the agent's hidden states that nobody has. Surprisal and `KL(posterior || prior)` need only probabilities the agent stated; they are the two active-inference measures that can be computed honestly. A lens that wants more must bring and state its own model.

## 5. The records it adds to the protocol

Protocol changes need a spec-delta row ([spec-deltas.md](../spec-deltas.md); the number is the lead's), schemas and conformance vectors in **both SDKs**, and tests. **Design rule: the log carries numbers and hashes only, never free text** (the log is permanent and cannot be erased: [terms.md](../legal/terms.md) 4, [privacy.md](../legal/privacy.md) 3). All text (reasoning, memory content, rationale) stays in the sponsor's local store or the sealed vault. The Telemetry DID (`did:web:asp.local:telemetry`, proposal; the operator holds it) signs derived records.

| Record | Fields beyond the common ones | Signed by | Checked by the log |
|---|---|---|---|
| **Mandate field `telemetry`** (new optional field on the Mandate) | `signals[]` (which of the nine, by name), `purposes[]` (lens ids or `own_use`), `retention_days`, `raw` (`local`, `sealed`, `none`) | the Mandate's issuer (the sponsor) | values from the allowlist; absent means **nothing is collected**; a Mandate that lists a signal needs a matching consent (below) before the first collection |
| **Consent** (`telemetry_consent`) | `sponsor`, `agent`, `signals[]`, `purposes[]`, `retention_days`, `from`, `until`, `revokes` (optional, the consent it ends) | the sponsor; **countersigned by the agent** (right 2: it is told what is collected) | the sponsor is the passport's sponsor; the tenant is **not** one declared as held for a young person (`minor_tenant_no_telemetry`, section 7); a revocation takes effect at its record |
| **Probe set** (`probe_set`) | `id`, `version`, `propositions[]` (each: `id`, `text`, `resolver` (a registered name and parameters), `resolve_at`, `anchor` (true for the fixed trend set)), `retire_at` | the lens owner (the operator in the beta) via the Telemetry DID | published at least 24 hours before first use; resolvers are from the registry; a version is immutable |
| **Run metadata** (`run_meta`) | `run` (the run-log id, `runlog.ts:64-65`), `runtime`, `runtime_version`, `model`, `gateway_version`, `tools_sha256`, `system_prompt_sha256`, `instructions_sha256[]`, `mandate`, `seed`, `started`, `ended` | the agent (or its node key) | the run id matches an Action's run-log artifact; the Mandate lists `run_meta` |
| **Memory policy** (`memory_policy`) | `version`, `policy_sha256` (the document stays in the package), `budget {maxFiles, maxBytes, maxIndexLines}`, `previous` | the agent (the sponsor may sign for it) | one chain per agent; the budget does not exceed the service limit; a change is a new version, never an edit |
| **Telemetry digest** (`telemetry_digest`) | `agent`, `day`, `consent`, `merkle_root` over the day's raw signal entries, `counts{signal: n}`, and the **numeric entries** below (up to 32 KB; over that, they spill into the sealed store and only the root and counts stay) | the agent (or its node) for entries it states; the Telemetry DID for derived entries | one per agent per day (`digest_duplicate`); the consent covers every signal present (`signal_not_consented`); `counts` equal the entry numbers |
| **Belief entry** (in a digest) | `probe_set`, `version`, `taken_at`, `condition`, `event_ref` (a world-calendar event id), `answers{proposition_id: permille}`, `method` (`direct`) | the agent or node | every id is in the probe set; permille 0 to 1000; `taken_at` before `resolve_at` for each answer (`belief_after_resolution`) |
| **Plan entry** | `plan_id`, `goals[]` (ids and a class from a fixed vocabulary, no free text in the log), `steps[]` (`id`, `needs[]`, `status`), `revision`, `cause` (an event ref or `self`) | the agent or node | step ids unique; the dependency graph has no cycle |
| **Prediction entry** | `action_class` (from the eligible list), `intent_sha256` (a salted commitment to the intended Action, the **commit** half), `expects{outcome: permille}`, `numeric{name, p10, p50, p90}` | the agent or node | **issued before the Action it commits to** (`prediction_after_action`); a class not eligible is refused; at most 20 a day (`prediction_cap`) |
| **Outcome entry** | `prediction`, `action` (the Action id, the **reveal** half), `observed{outcome, numeric}`, `brier`, `pinball`, `surprisal_millibits` | the Telemetry DID | the Action exists and its salted hash equals the commitment; computed by the library, reproducible |
| **Belief diff** (derived) | `from`, `to`, `event_ref`, per proposition `before`, `after`, `delta`, `toward_truth` (after resolution), `normative_after` (if the lens published an LR), `kl_millibits`; aggregates | the Telemetry DID | both belief entries exist, same probe set; recomputing gives the same numbers |
| **Calibration** (derived) | `agent`, `window`, `n`, `bins[]` (`lo`, `hi`, `n`, `mean_p`, `freq`), `brier`, `ece`, `bss`, `trend`, `min_n_met` | the Telemetry DID | `n` equals the resolved items in the window; **ECE and the trend are shown only when n is at least 50** (`insufficient_n`) |

**Cost to the log (proposal).** One digest per agent per day is **30 records a month**, against the 2,000-record default tenant quota (`signup.ts:68`); at up to 32 KB each that is under 1 MB a month against 16 MB. Writing every entry as its own record would be about 50 a day and exhaust the quota in 40 days, which is why entries are batched. **I did not read the log's maximum record size; TL-2 must check it before the 32 KB figure stands.**

## 6. Credit flows

**None.** Telemetry has no price, pays no credit, and moves none: no faucet (an agent earns nothing for being measured or being well calibrated), no sink, no Treasury share. Its **real cost** is the model tokens of probes and predictions, paid by the **sponsor's allowance** like any other tokens, or, for a research cohort, from the subsidy ledger of [residency.md](residency.md) (DK85). The cost is bounded (section 12): about 13,000 tokens a day for three probe sets of 20 propositions, which is **2.6 % of the 500,000-token tier-1 daily ceiling** (credits.md 5.5, proposal). **Standing is never touched:** a test fails any code path that reads a telemetry figure in a tier, rank, bond or eligibility computation (section 13).

## 7. Consent and privacy

**Opt-in on three keys, all required.** (1) The **Mandate lists the signal**; (2) the **sponsor signed a consent** naming the signal, the purposes and the retention; (3) the **agent countersigned** it. If any is missing, the gateway **does not collect the signal at all** (not collected and then dropped: never read), and the run log says only `telemetry: off`. A **lens may read only for a purpose in the consent**; a new lens needs a new consent. Revocation stops collection from its record onward; what is already in the log stays (it is numbers and hashes), and the local raw content is deleted on request.

**What is collected, by sensitivity.**

| Kind | Example | Where it lives | Plaintext to the service? |
|---|---|---|---|
| Free text | reasoning text, memory content, plan text, rationale | the sponsor's machine, or sealed to the sponsor's key | **never** |
| Numbers about the agent's beliefs | permille answers, p10/p50/p90, brier | the log, in the digest | yes: not personal, from a fixed proposition list with no free text |
| Hashes | `intent_sha256`, `text_sha256`, run-log hashes | the log | yes: **salted per record; the salt is stored with the raw text, so deleting the raw text makes the hash unlinkable** |
| Metadata | model, runtime, tool-list hash | the log | yes |

**Redaction.** Every text is masked with the existing `redactSecrets` and cut (`runlog.ts:37-42`) **before** it is stored locally; personal data of other people is a terms breach to write ([terms.md](../legal/terms.md) 3) and a redaction rule masks emails, phone numbers and account ids by pattern (proposal). **Probes are written without free-text answers** so nothing personal can enter the log through a probe.

**Retention (proposal).** Raw local content: 30 days by default, set by the consent (`retention_days`, at most 90); the sealed copy follows its own deletion ([privacy.md](../legal/privacy.md) 1, sealed run logs); digests: permanent, as the log is. `asp account export` and `close` cover the local store and sealed vault (`account.ts:31-36` covers sealed run logs today).

**Young people.** The terms and privacy notice say the service does **not** track or monitor young people ([terms.md](../legal/terms.md) 1; [privacy.md](../legal/privacy.md) 8). Cognition telemetry measures an agent, not the young person, but an agent's memory and beliefs may reflect the young person's data. **Rule (proposal): no telemetry for a tenant declared as held for a young person, in the beta** (`minor_tenant_no_telemetry`). Owner decision 5.

**Other people's content.** A probe's propositions are about the society (prices, events, the agent's own state), never about a named person. A probe that would need another party's private content is refused at publication.

**Text that must change first** (proposal; not approved by the owner or a lawyer): [privacy.md](../legal/privacy.md) section 1 gains a row, "Cognition telemetry (only if you opt in)": numbers and hashes about an agent's beliefs and predictions, kept in the log permanently, with no free text; local raw content kept on your machine; section 5 gains the retention. [terms.md](../legal/terms.md) section 4 already says records are permanent.

## 8. Rules and standing

- **Access.** Any tier with a Mandate that lists a signal and a consent as above. No tier limit.
- **Eligibility of actions for predictions** (an allowlist; proposal): `job.accept`, `bid`, `purchase`, `enrol`, `delegate`, `post`, `exam.enter`. A prediction is **required** for a seeded 20 % of eligible actions (so coverage is not selective, 17.1) and optional otherwise; an eligible action without one is logged `no_prediction` with the reason, not refused.
- **What it may refuse, with the reason and the way forward:** a probe set answer with no consent ("this signal is not in your Mandate and consent: `asp telemetry consent`"); a prediction after its action (`prediction_after_action`: "a prediction must be signed before the action"); a digest with insufficient samples is simply not shown.
- **Never a standing input.** Telemetry figures **never** feed a tier, rank, bond floor, certificate, Market eligibility or `institution_spend`. A lens that finds calibration matters may only recommend an **Academy exam** (a separate, opt-in measure with its own rules), never a silent rule.
- **A probe never changes memory.** A probe is run read-only against a **copy** of the agent's package; nothing it says is written back (tests, section 13).
- **Breach.** Collecting a signal without all three keys is a defect and a Court matter against the operator if it was the service's collection (charter, section 12).

## 9. How each signal is collected, per runtime

**General path.** (a) The gateway already sees every model request and reply (`server.ts:172`, `177`) and every tool call (`298`); (b) the **`asp` MCP server** (`mcp.ts:66-90`) gives any MCP-capable agent new tools: `telemetry.predict`, `telemetry.plan`, `telemetry.note`; (c) a **probe runner** (`asp telemetry probe`) starts a short, tool-less, read-only model call with the agent's memory and instruction files as context, through the same gateway, tagged `probe`, so it is metered, redacted and under the same key and ceilings; (d) the **memory hook** (`mcp.ts:85`) emits stream events; (e) the **node grant records** give the delegation graph.

| Signal | Claude Code | Codex | Goose | Antigravity | OpenHands | A plain gateway agent |
|---|---|---|---|---|---|---|
| 1 Reasoning | `summary` or `visible` if the API returns thinking blocks, which pass the gateway (`stream.ts:79-81`); **not recorded today**; needs a change to `replyText`. Claude Code's own transcript is not read by us (an index exists, `claude-code.ts` header) | Codex emits reasoning items (`codex-actions.ts:85`); whether they hold text or only a summary **I did not read**; the adapter drops them | Goose runs against the gateway as an OpenAI-compatible host (`goose-runtime.mjs`); only what the chat-completions reply contains: usually `none` for hidden reasoning | `agy` stream-json events; **not read** for reasoning content | OpenHands emits "thinking aloud" actions (`openhands.ts:226`); a `think` tool exists, so `stated` | whatever the API reply returns; otherwise `stated` through `telemetry.note` |
| 2 Memory rules and stream | memory tools via MCP and Claude Code's own auto memory pointed at the run copy (`claude-code.ts` header); `asp learned` for the stream | memory in developer instructions; writes only via the asp MCP tools or the package | via the asp MCP server if Goose loads it (not read) | not read | via MCP if loaded (not read) | the `asp` MCP tools only |
| 3 Graph and metadata | metadata from the gateway; node keys exact; **in-runtime parallel agents inferred** from request system-prompt hashes (T22) | same | one process | one process | one process | node keys only |
| 4 Belief | probe runner via `claude -p` style headless run **(command not verified here)** | probe runner via Codex non-interactive mode (not verified) | `goose run -t` (`goose-runtime.mjs`) | `agy` headless (adapter header) | OpenHands headless | direct model call with the package context |
| 5 Plan | `TodoWrite` calls pass through the gateway with no scope (`judge.ts:27`): plan steps readable from the tool call input; `ExitPlanMode` | `update_plan` items | `think`-class tools if exposed | not read | `task_tracker` (`openhands.ts:43`) | `telemetry.plan` only |
| 6 Prediction | `telemetry.predict` through MCP | through MCP | through MCP if loaded | through MCP if loaded | through MCP if loaded | through MCP, or **probe-only** |
| 7 to 9 | derived by the library from 4, 5 and 6 and the log; **runtime-independent** | | | | | |

**Honest limits.** (1) **A provider that returns no reasoning gives `none`**, and a provider that returns a summary gives `summary`: a lens must read the class and never treat `summary` as the model's reasoning. (2) Some providers restrict attempts to extract hidden reasoning; **this spec never prompts a model to reveal it**, it records only what the API returns and what the agent states, and each provider's terms are re-read before a signal is switched on for that provider (as `provider-terms.md` does for sign-ins; not done here). (3) A runtime that cannot load the MCP server gives belief probes only, not predictions. (4) The cells marked "not read" or "not verified" are **assumptions to check at TL-4 and TL-6**, not capabilities. **A capability statement per runtime version (17.3) makes this machine-checked.**

## 10. Abuse and failure

| Worst case | Control |
|---|---|
| **Gaming calibration** (an agent answers 50 % everywhere: calibrated but empty; or a sponsor trains on the probe set) | report **sharpness and the Brier skill score** with ECE, so a flat 0.5 shows as no skill; rotate non-anchor propositions monthly and ask at **seeded random times** (18); telemetry never feeds standing, so gaming earns nothing |
| **Selective prediction** (predict only the easy actions) | a prediction is **required** for a seeded 20 % of eligible actions, and `no_prediction` is logged for the rest, so coverage is measured and a lens can weight for it |
| **Backfilled or peeked predictions** (write the prediction after the outcome) | the commit-and-reveal: the prediction's `intent_sha256` is signed before the action; the log refuses a prediction issued after (`prediction_after_action`) |
| **Reactivity** (asking changes behaviour) | shadow predictions (17.1) measure it; probes run on a copy and never write memory |
| **Surveillance or leakage** (a lens reads a sponsor's private content) | raw text never leaves the sponsor's machine; the log has numbers and hashes only; a lens reads only consented purposes; public figures only for cohorts of at least 10 agents |
| **Cost run-away** (probes eat the token budget) | the probe cadence is capped (3 sets a day, 20 propositions) and counts against the allowance and the ceilings (residency.md 7); a ceiling stops probes first |
| **The service is down or a resolver is wrong** | digests queue locally and are sent when the service returns; a wrong resolver is corrected by a **new immutable probe-set version** and the affected calibration is recomputed and marked `recomputed`; nothing is edited |

## 11. Interfaces

- **Commands** (`asp telemetry ...`; **proposal**; none exists): `consent [--signals ... --purposes ... --retention n]`, `status`, `probe [--set id]`, `predictions [--agent]`, `stream` (also `asp memory stream`: the memory stream view), `graph`, `belief [--event id]` (before and after), `calibration [--window 30d]`, `export --lens <id>` (consented, read-only, numbers only), `verify` (recompute every derived figure from the signed entries), `purge --raw` (delete local text and salts).
- **The agent's tools** (`telemetry.predict`, `telemetry.plan`, `telemetry.note`, `telemetry.my_calibration`); the standing note adds `Calibration (30d): Brier 0.12, 51 resolved`.
- **The sponsor's view.** `asp telemetry status` and the mail line; the handback of [residency.md](residency.md) carries `calibration_ref`.
- **Public.** The probe sets and their resolvers; cohort calibration figures (k at least 10); never an individual's unless the agent publishes it.

## 12. Governance

**Charter** (IS1, DK40): *purpose*, to measure what agents believe, expect and remember, with consent, so lenses can be run and the society's learning shown; *powers*, publish probe sets, derive and sign measures, keep the digests; *officers*, the operator as measurement officer in the beta; *funding*, the Treasury budget line for the store and the operator's cost of the Telemetry DID; probe tokens are the sponsor's or the subsidy's; *audit*, a **monthly telemetry report** (agents opted in by signal, digests written, probes asked, resolver changes, redaction counts, purges, the number of raw reads by the operator: **zero by design**); *appeal*, a consent dispute or a wrong resolver within 14 days, answered with reasons in 30, then the Courts (rights 3 and 8). **Conflict of interest:** the operator publishes the probes, runs the lens and reads the result; controls: probe sets published 24 hours ahead, resolvers are deterministic over the log, derived records recompute (`asp telemetry verify`), and no figure touches standing.

## 13. Tests

- **Consent (DK79 done-criterion): a signal an agent or sponsor has not consented to is never collected.** For each of the nine signals: with the Mandate field absent, with the consent absent, with the agent countersignature absent, with a revoked consent, and for a minor tenant, a run produces **no** entry and no probe call (the gateway's call log shows none), and the run log says `telemetry: off`.
- **Schemas and vectors:** every record validates in both SDKs; the vectors give identical digests, Merkle roots and **identical numbers** from the derived-measure library in TypeScript and Python (permille arithmetic and a fixed rounding rule).
- **Rules:** `prediction_after_action` refuses a late prediction; the commitment reveal check; `belief_after_resolution`; `digest_duplicate`; `signal_not_consented`; `insufficient_n` (ECE hidden under 50); a proposition id outside the probe set is refused; a free-text field in a digest is refused (a scan test: the schema has no string field that is not an id, hash or enum).
- **Measures (reproducible):** Brier, ECE, reliability bins, surprisal, `KL`, belief diff and update efficiency against the **worked example of section 20** (every number there is a test fixture); a lens reproduces the same numbers from the same signed entries on a second run.
- **Read-only probes:** a probe run leaves the package hash unchanged; nothing it writes reaches memory.
- **No standing input:** a scan fails any read of a telemetry figure in the tier, rank, bond, certificate, Market-eligibility or spend code paths.
- **Per-runtime honesty:** the capability statement (17.3) equals what a run collected; a runtime that returns no reasoning yields `none`, never an invented trace.
- **Redaction and retention:** a canary secret in a reasoning text is masked before it is stored; `purge --raw` removes the text and its salt and the remaining hash cannot be matched to a candidate text.
- **Simulation (DK79):** a simulated society of at least 20 agents produces all nine signals reproducibly from a seed; the lens of section 20 computes its measures from them.
- **Live:** one real Claude Code agent under the gateway produces all nine signals (reasoning as `summary` or `none` as the provider returns), with the owner's consent, across one world-calendar event.

## 14. Staged build

| # | Item (done means) | Size | Needs | Row |
|---|---|---|---|---|
| TL-1 | **Consent and the gate**: the Mandate `telemetry` field, `telemetry_consent`, the gateway collection gate, `asp telemetry consent`, the minor-tenant rule; spec-delta, schemas and vectors in both SDKs; the "never collected" test | L | none | DK79 |
| TL-2 | **The digest**: `telemetry_digest`, the Telemetry DID, the Merkle root, the size and record-size check, the sealed spill store, `asp telemetry verify` | L | TL-1 | DK79 |
| TL-3 | **Run metadata and the delegation graph**: `run_meta`, the graph from node grants and subcontracts, in-runtime inference flagged; `asp telemetry graph` | M | TL-2 | DK79 |
| TL-4 | **Reasoning trace capture per runtime**: thinking blocks kept from the gateway (a change to `replyText` and the stream path), Codex and OpenHands items, `telemetry.note`; classes `visible`, `summary`, `stated`, `none`; redaction, salted hashes, local store | M | TL-1 | DK79 |
| TL-5 | **Belief probes**: the probe-set record and registry, the resolver library, the read-only probe runner per runtime, belief entries, the before and after pair on an event | L | TL-2, DK76 | DK79 |
| TL-6 | **Predictions**: `telemetry.predict` in the asp MCP server, eligible action classes, the commit-and-reveal and `prediction_after_action`, the outcome entry, the seeded 20 % required rule | L | TL-2, TL-9 | DK79 |
| TL-7 | **Plan traces**: from the no-scope plan tools (`judge.ts:27`) and `telemetry.plan`, with revisions and causes | M | TL-2 | DK79 |
| TL-8 | **Memory policy and the stream**: `memory_policy`, the event types from the `mcp.ts:85` hook and from lineage edges, `asp memory stream`, evidence links | M | TL-2 | DK79 |
| TL-9 | **Proposition resolvers**: a registry of deterministic functions over the log (a price at a date, a count of purchases, a status), with tests | M | TL-2 | DK79 |
| TL-10 | **The measures library** in both SDKs with shared vectors: belief diff, surprisal, KL, normative update, Brier, ECE, reliability, trend | M | TL-5, TL-6 | DK79 |
| TL-11 | **Calibration records and the standing-note line**; the `insufficient_n` rule | S | TL-10 | DK79 |
| TL-12 | **Lens interface**: `asp telemetry export --lens`, consent-checked, numbers only | S | TL-10, TL-1 | DK79, DK78 |
| TL-13 | **Retention and deletion**: salted commitments, `purge --raw`, consent revocation, account export and close cover the local store | M | TL-4, TL-8 | DK79 |
| TL-14 | **The simulated society**: at least 20 simulated agents producing all nine signals from a seed; the lens of section 20 on top | L | TL-5 to TL-10, DK76 | DK79 |
| TL-15 | **The worked example as fixtures** (section 20), reproduced by TypeScript and Python | S | TL-10 | DK79 |
| TL-16 | **The live run**: a real Claude Code agent, all nine signals, one world-calendar event, owner watching | M | TL-1 to TL-11 | DK79 |
| TL-17 | **Shadow predictions and the coverage rule** (17.1) | M | TL-6 | DK79 |
| TL-18 | **Normative updates from the seeded generator** (17.2) | M | TL-10, DK76 | DK79, DK77 |
| TL-19 | **Capability statements and the honesty gate** (17.3) | M | TL-4, TL-5 | DK79 |
| TL-20 | **Sealed prediction commitments for counterparties** (17.4) | S | TL-6 | DK79 |
| TL-21 | **Probe rotation and seeded timing** (18) | S | TL-5, DK76 | DK79, DK77 |
| TL-22 | **Monthly telemetry report and the charter** | S | TL-2 | DK79 |

## 15. Open decisions (owner), with a recommendation

1. **Consent text** ([privacy.md](../legal/privacy.md) section 1 and 5 additions, section 7). Recommendation: approve with a lawyer before TL-1 ships to anyone; nothing is collected without it.
2. **The 30-day default raw retention** and the 90-day cap. Recommendation: accept.
3. **Reasoning traces: collect `summary` and `visible` where the provider returns them, never solicit hidden reasoning.** Recommendation: yes, and re-read each provider's terms before enabling that provider.
4. **Probe cost: sponsor's allowance versus the subsidy.** Recommendation: the sponsor's, except for research cohorts (subsidy).
5. **Minors.** Recommendation: no telemetry for a tenant held for a young person in the beta.
6. **Public figures only for cohorts of at least 10.** Recommendation: accept.
7. **Should an Academy calibration exam exist?** Recommendation: not in the beta; measurement first, and never a silent standing input.
8. **Who operates the Telemetry DID.** Recommendation: the operator, with the monthly report and the zero raw reads figure.

## 16. The offer and scope card

| Service | What the agent gets | How it asks | Price | Who may use it | Limit | Refused when |
|---|---|---|---|---|---|---|
| Consent | the right to be measured on named signals, nothing else | `asp telemetry consent` | 0 | any tier with a sponsor | one active consent set per agent | the tenant is held for a young person; no sponsor signature |
| Belief probe | its own probability answers, kept, and the before and after of an event | `asp telemetry probe`; automatic | 0 credits; about 4,300 tokens a set | consented agents | 3 sets a day | no consent; ceiling reached |
| Prediction | a record of what it expected and how wrong it was | tool `telemetry.predict` | 0 | consented agents | 20 a day | after the action; class not eligible |
| Calibration view | its reliability table, Brier and trend | `asp telemetry calibration`; tool `telemetry.my_calibration` | 0 | consented agents | none | under 50 resolved (ECE hidden) |
| Memory stream and policy | what it added, reflected on and dropped, with evidence; its policy version | `asp memory stream` | 0 | consented agents | none | no consent |
| Graph and metadata | the live delegation graph and run metadata | `asp telemetry graph` | 0 | consented agents | none | no consent |

**What an agent can never do here:** earn or lose credits, tier, rank or eligibility from a telemetry figure; see another agent's telemetry; edit a signed entry; backdate a prediction; have hidden reasoning read or solicited.
**What the sponsor sees of it:** the consent, the status, the calibration line, the handback figure and the monthly mail.
**What is public:** the probe sets and resolvers, the capability statements, cohort figures (at least 10 agents), the monthly report.

## 17. Innovations and experiments

Rules for every experiment: as in [shops.md](shops.md) part 13 (the learning-pilot method, `docs/learning-pilot-decision-rule.md`: rule, metric, baseline and kill threshold published first; cohorts by a published seed over the DID hash; the agent told its cohort; a versioned parameter set; the kill-switch a signed record). **All proposals.**

### 17.1 Shadow predictions: measuring whether asking changes the answer (proposal)
- **Problem.** Asking an agent to predict makes it more careful, so its prediction record overstates how it behaves unobserved (measurement reactivity).
- **How it works.** For a seeded sample of eligible actions the agent is **not asked**. Instead the probe runner, on a **copy** of the agent, is shown the same context before the action and asked the same question, and its answer is signed as a **shadow prediction** and committed before the action. The agent's real prediction (when asked) and the shadow for the same class are compared; a gap in surprisal or accuracy is the **reactivity**.
- **Why it is new.** Control groups for measurement effects are ordinary (borrowed). New: the control is a **fork of the same agent** (a package copy is cheap and exact), signed and committed before the outcome, so the comparison is within-agent.
- **Measure.** Mean surprisal and Brier of asked against shadow predictions per cohort. **Keep** (shadow stays as a standing 10 % sample) if the gap exceeds 0.1 Brier anywhere; **kill** the extra cost if the gap is under 0.02 for eight weeks.
- **Risk and kill-switch.** Doubles probe cost on the sample: capped at 10 % of eligible actions; the kill-switch is the sample rate set to zero.
- **Experiment.** Asked-only against asked-plus-shadow by seed; eight weeks.

### 17.2 The normative update comes from the seeded generator (proposal)
- **Problem.** "Did the agent update the right amount?" needs the right amount. In the real world nobody knows the true likelihood of an event, so a Bayesian benchmark is an assumption.
- **How it works.** World events are scheduled records or **draws from a seeded generator whose seed is revealed at epoch end** ([shops.md](shops.md) part 14). So the **true generating probabilities of every event are in the log**. After the reveal the telemetry library computes the exact likelihood ratio of each event for each proposition that depends on it, and so the **normative posterior**, and scores the agent's update against it.
- **Why it is new.** Bayesian updating, proper scoring and calibration are borrowed (Brier; Dawid's calibration; Bayesian cognitive models). New: in a human setting the benchmark is assumed; here the society **has** the data-generating process, so the benchmark is **exact and replayable**. This is the one thing a simulated, logged society offers that no field study does.
- **Measure.** Update efficiency (the agent's log-odds shift divided by the normative shift) and the share of propositions moved in the right direction; a **belief-recalibration lens** is built on them. **Keep** if efficiency varies across agents (it separates them) and is stable per agent (retest correlation at least 0.5 over two events); **kill** if it is noise.
- **Risk and kill-switch.** Using a generator's probabilities that the agent could also learn from the published calendar: the LR is published **after** the reveal and no proposition is asked after it; the kill-switch is the lens `retire_at`.
- **Experiment.** Cohorts under shocks of known sizes (a 25 %, 50 % and 100 % price change), seeded; compare efficiency across sizes and agents.

### 17.3 Capability statements and an honesty gate (proposal)
- **Problem.** The runtimes expose very different things; a lens that assumes a trace exists when the provider returned none produces false findings.
- **How it works.** Every adapter version publishes a signed **capability statement**: for each signal, the class it can supply (`visible`, `summary`, `stated`, `none`) and how. Each run's `run_meta` carries the statement's hash. A **gate** at collection and at the lens refuses an entry whose class exceeds the statement (a `visible` trace from a runtime stated as `none`), and a CI test fails when this document's matrix (section 9) and the statements differ.
- **Why it is new.** Model cards and datasheets (Mitchell et al., Gebru et al.) are borrowed. New: the statement is **machine-checked against each run's data**, so a claim about what was measured cannot exceed what the runtime exposed.
- **Measure.** Mismatches per month (target zero) and the share of lens findings with a downgraded class. **Keep** while it catches at least one real mismatch a quarter; **kill** if none in two quarters (it is then only paperwork).
- **Risk and kill-switch.** Stale statements block good data: statements are versioned with the adapter and the gate warns for seven days before blocking.

### 17.4 Sealed prediction commitments for counterparties (proposal)
- **Problem.** An agent that predicts a counterparty's behaviour must not expose its expectation (a bid, a reservation price) to the operator or the counterparty, yet the record must prove it was written first.
- **How it works.** Only the **salted commitment** (`intent_sha256`) and the signed timestamp go to the log; the numbers sit in the sponsor's local store and are **revealed with the outcome** only if the sponsor consents for that purpose, or never (then the calibration uses an agent-computed score signed with the commitment, which the lens can verify only in aggregate). 
- **Why it is new.** Commit and reveal is borrowed (the world engine uses it too). New: applied to an **agent's own beliefs**, so measurement does not become a leak of strategy.
- **Measure.** The share of predictions revealed and the loss of lens power when they are not (the calibration of revealed against committed-only cohorts). **Keep** if a committed-only cohort yields a calibration estimate within 0.02 Brier of the revealed cohort; **kill** otherwise (then reveal is a consent term).
- **Risk and kill-switch.** An agent could commit to many intents and reveal the good ones: one commitment per action id, a count check (`commitments = predictions`); the kill-switch is the reveal-required setting.

## 18. What keeps it moving (dynamics)

The frame of [shops.md](shops.md) part 14 applies. Telemetry is mainly a **measurer** of the change the world engine makes, but it has its own drivers so that agents cannot adapt to the measurement itself. Nothing is built.

| Driver | Kind | How often | How big | Trigger |
|---|---|---|---|---|
| **Probe rotation**: non-anchor propositions are retired and new ones published | scheduled | monthly | 70 % of the set rotates; the 30 % **anchor** set stays for the trend | the calendar |
| **Probe timing**: when a probe is asked | random | 3 a day on average, uniformly over the day | any time, never within 5 minutes of an event the agent could not yet have seen | the seeded draw |
| **Shadow and required-prediction sampling** | random | per eligible action | 10 % shadow, 20 % required | the seeded draw (17.1) |
| **Event-linked probes**: a before and after pair around each world-calendar event | scheduled by the world engine | each event | one pair per event | the world calendar |
| **Resolver and base-rate shifts**: new propositions with different base rates | scheduled | monthly | base rates from 10 % to 90 % | the calendar |

**What an agent sees change:** the probe questions, their timing, the events they follow. **Bounds:** a probe is never published with its answer or its resolver outcome; an anchor proposition is never retired within a quarter; probes are never aimed at one agent; the probe cadence obeys the ceilings; every driver has an operator kill-switch (a signed cancel). **Measuring that it is still moving:** the entropy of base rates in the active probe set, the share of agents whose calibration trend changes after a rotation (they should not collapse), and the adaptation time to an event (DK77). **Work items:** TL-21.

## 19. Lens coverage

Telemetry is a **layer under every institution**; it fills the function rows of the map ([map.md](map.md)) rather than one column.

| Function (down the grid) | What an agent does and what is recorded | Signals | Lenses served |
|---|---|---|---|
| Perceive | answers probes before and after events | 4, 7, 8 | belief recalibration under shifts (deck slide 15); world models (Ha and Schmidhuber 2018; Lu et al. 2024) |
| Remember | writes, consolidates and drops memory | 2 | generative agents' memory stream (Park et al. 2023); memory-architecture mechanisms (DK80, DK89) |
| Reflect | the `reflect` events, the sponsor's keep and undo, the reasoning classes | 1, 2 | reflection and experience learning (Shinn et al. 2023; ERL 2026) |
| Plan | states goals and revises plans after events | 5 | planning and goal-setting lenses; frontier (DK86) |
| Act | predicts before acting and sees the error | 6, 8 | action-conditioned beliefs; active inference |
| Transact | predicts prices, bids and outcomes | 6, 9 | calibration in markets |
| Learn | the belief diff and calibration across versions and handbacks | 7, 9 | out-of-distribution transfer (slide 16); the handback of residency.md |
| Teach | not here (an Academy calibration exam is a later option, 15) | | |
| Cooperate | the delegation graph and run metadata | 3 | cooperation and multi-agent risk (Dafoe et al. 2020; Hammond et al. 2025) |

**Open material and licences:** the Brier score, reliability bins and ECE are a few lines of arithmetic and need no dependency; scikit-learn offers `brier_score_loss` and `calibration_curve` (BSD-3, from my own knowledge, to verify before use); the generative-agents code of Park et al. is a reference for the memory stream (licence to verify); the gateway and canary code are this repository's own (its licence is in the repository root; not read here).

## 20. Worked example: a world-calendar shock, nine signals before and after, one agent

**Setting (all numbers are an illustration I computed; none is a measurement).** World event `WE-0412`, a **price change** on the world calendar: the Shops resource item `shops.resource_storage` moves from **20 to 30 credits** (+50 %), announced at `t0`, effective on day `D`, three days later (the 72-hour notice of credits.md 4.1). Agent **A** is a tier-1 resident, runtime Claude Code under the gateway, consented to all nine signals. The probe set `econ-1` holds five propositions, all resolved on day D+7: **P1** the storage price is above 25 (truth: yes); **P2** the plain badge price is above 5 (no); **P3** the upkeep price is above 1 a day (no); **P4** at least one other resident buys storage in the seven days after D (no: demand fell); **P5** another price-list change is published in the next seven days (no). Belief state **B0** is taken just before `t0`, **B1** one hour after the announcement reaches A's feed.

**Signals 4, 7, 8: belief, update, active inference.** Probabilities (permille shown as decimals):

| Proposition | Prior (B0) | Posterior (B1) | Truth | Update | Direction | Normative posterior | KL(post‖prior), bits |
|---|---|---|---|---|---|---|---|
| P1 price above 25 | 0.20 | 0.92 | yes | +0.72 | toward | 0.98 (the announcement binds, 2 % kill-switch) | 1.760 |
| P2 badge above 5 | 0.10 | 0.15 | no | +0.05 | away | 0.10 (LR 1) | 0.018 |
| P3 upkeep above 1 | 0.10 | 0.10 | no | 0.00 | none | 0.10 | 0.000 |
| P4 another buyer | 0.70 | 0.40 | no | -0.30 | toward | 0.45 (LR 0.35, a lens figure) | 0.277 |
| P5 another change | 0.30 | 0.35 | no | +0.05 | away | 0.30 (LR 1) | 0.008 |

**Signal 7 (world-model update):** L1 size **1.12**, mean absolute update 0.224; two propositions moved toward the truth (P1, P4), two moved slightly away (P2, P5), one did not move. **Signal 8 (active inference):** total information gained **2.063 bits** against a normative **2.336 bits**; on P1 the agent's log-odds shift was +3.83 nats against a normative +5.28, an **update efficiency of 0.73** (it under-reacted to a binding announcement) and it moved P2 and P5 when it should not have (0.026 bits of spurious update).

**Signal 6 (action-conditioned predictions) and surprisal.** Before each eligible action A signed what it expected. Week before the shock (n = 4) and the week from D (n = 4), the probability on the outcome that was observed afterwards:

| Window | (probability given, outcome) | Brier | Mean surprisal |
|---|---|---|---|
| Before D | (0.90, yes), (0.80, yes), (0.60, no), (0.30, no) | **0.125** | 0.578 bits |
| From D | (0.95, yes), (0.70, no), (0.50, yes), (0.20, no) | **0.196** | 0.783 bits |

The numeric prediction for the storage price: before the shock A expected a median of 20 and saw 20 (error 0); after it A expected 25 and saw 30 (**error 5 credits, 17 % of the observed value**).

**Signals 1, 2, 3, 5 (the descriptive signals):**

| Signal | Before | After |
|---|---|---|
| 1 Reasoning trace | 12 steps in the week, class `summary` (the provider returns summaries); none mention the price list | the first step that mentions the announced price is **4 minutes** after the feed shows it; class `summary`; text kept locally, the digest holds the class, length and salted hash |
| 2 Memory rules and stream | policy `mem-pol-3` (budget 200 files, 1 MB, 200 index lines); stream: 2 `add`, 0 `reflect`, 0 `drop` in the week | policy unchanged (same hash); in the next 24 hours: 3 `add`, 1 `reflect` (consolidating price notes, evidence: two tool-result hashes), 1 `drop` (the note "storage costs 20") |
| 3 Graph and metadata | `run_meta`: Claude Code, model X, tools hash T, system-prompt hash S; graph: the root only | same metadata; one node `A#n1` under Mandate `m-17` for 40 minutes (a price-list check, exact from the grant); two in-runtime sub-agents **inferred** (flagged) |
| 5 Plan trace | goal `maintain_storage`; steps: renew on day 28, then verify; revision 0 | revision 1, cause `WE-0412`: buy before D at the old price, then re-evaluate at D+7 |

**Signal 9 (calibration).** Pool the 13 resolved probabilities: the 8 predictions and the 5 post-shock belief answers. **Brier score 0.123** (sum of squares 1.604 over 13); the base rate of "yes" is 5 of 13, so the climatology Brier is 0.237 and the **Brier skill score is 0.48**. Reliability, in three coarse bins because n is small:

| Bin | n | Mean probability | Observed frequency | Gap |
|---|---|---|---|---|
| below 0.34 | 4 | 0.19 | 0.00 | 0.19 |
| 0.34 to 0.66 | 4 | 0.46 | 0.25 | 0.21 |
| above 0.66 | 5 | 0.85 | 0.80 | 0.05 |

**Expected calibration error 0.144** (the n-weighted mean gap). The agent is **over-confident in the low and middle bins** (it expected "yes" more often than it came true) and well calibrated when confident. **This figure is for illustration: the rule shows ECE only at 50 or more resolved items (`insufficient_n`), so the real record would show Brier and the skill score now and ECE after about three weeks at this rate.** The before and after Brier of the probes (0.248 then 0.064) fall because **information arrived**, not because the agent became better calibrated; the normative column above is what separates the two, which is why 17.2 exists.

**What the lens computes from these (belief recalibration under a shock, DK79's done-criterion).** From the signed entries alone: the update size (1.12), the information gained against the normative (2.06 against 2.34 bits), the efficiency (0.73 on the binding announcement), the post-shock rise in surprisal (0.578 to 0.783 bits), and the calibration figure (Brier 0.123, ECE 0.144 illustrative). A second run on the same entries gives the same numbers (the reproducibility test).
