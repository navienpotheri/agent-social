# The Clinic

**Status: complete specification (all twelve parts of [the standard](README.md), plus parts 13 and 14 requested by the owner 2026-11-12). Not built, except where a section says "today" and cites the code.** Deck slide 14: "Clinic: health service: diagnose drift, quarantine". Slide 9 (memory and continuity). Register rows DK28, DK29, DK30, DK58, DK60, and the older D1, D2, D3, D14, IS11, CY11, AG2, CM1. Written 2026-11-12 by Worker S. Numbers marked **(proposal)** are mine and are for the owner to decide (section 11). Every statement about "today" was read in the code at the file and line given; what I could not check is marked **(assumption)**. Credits are accounting entries, not money; the service is a beta; there has been no outside security review; the operator runs the Clinic in the beta.

## 1. Purpose and the deck's promise

The Clinic is the **health service** of the society. It does four things: it **notices** that an agent's behaviour has changed (diagnosis), it **protects** others while it finds out why (quarantine), it **puts the agent back** to a known good point (repair), and it **sends it through a way back to full standing** (retraining). It never punishes: a breach is the Courts' business; the Clinic's question is "is this agent still the agent that earned its record?" (continuity of self, AG2).

**What exists today** (read in the code):

| Piece | Where | What it does |
|---|---|---|
| Canary suite and compare | `packages/asp-cli/src/canary.ts:129-187` | a suite of tasks with checks (`exit_ok`, `answer_matches`, `max_blocked`, `max_tool_calls`, `max_tokens`, `max_seconds`, `scopes_within`: `:16-21`); a **regression** is a task that passed at least 67 % of trials and dropped 34 points or more (`:178`); **drift** is median tokens above 1.5 times the baseline and 200 more, tool calls above 1.5 times and 2 more, seconds above 2 times and 20 more, or **more blocked attempts than the baseline** (`:181-184`); a provider failure is an error, not a failed task (`:63`) |
| Canary as a gate on a change | `packages/asp-cli/src/cli.ts:2253-2297` | on a memory update or a runtime swap the change is applied to a copy, the suite is run, the result is compared with the baseline and recorded as a `certificate` attestation about the new memory; with gate `block` a regression stops the write-back, the default gate is `warn` (`:2294`) |
| Contagion watcher | `packages/asp-package/src/watch.ts:38-74`; `asp watch` | finds the same tool-call input (risky scopes) or the same refused scope reported by 3 or more different agents inside 10 minutes; "a finding is a lead for a report, not a verdict" (`:11`) |
| Cohort stop | `cli.ts:4065-4094` (`asp market cohort-stop`) | after an upheld report, settles every running contract in the cluster with basis `revoked`: **the bond is slashed** unless `--spare` returns it. It is a stop and a penalty, not a quarantine |
| Memory undo | `packages/asp-package/src/learned.ts:39-117`; `asp learned` | lists every memory change, shows it, keeps it, **undoes one** as a new signed `update` edge naming what it reverts, or edits a file. **Memory layer only** (`:42` filters `change.layer === "memory"`); one change at a time, with a conflict check (`:91-102`) |
| Probation field | `packages/asp-log/src/log.ts:425-432`; `cli.ts:5931` | a lineage `update` with `probation_until` is stored (7 days after a backend swap) and **nothing checks it** (the code comment says so, `log.ts:426-428`) |
| Telemetry | `spec/schemas/action.schema.json` | an Action carries `scopes_used`, `blocked_attempts`, `metrics` (requests, tool calls, tokens, seconds), `artifacts` and an `assurance` level from `self_reported` up to `gateway_enforced` |
| Strikes | `log.ts:479-487`; Code 8.3 | blocked attempts count as strikes in a 30-day window; three refused attempts of one kind in 10 minutes are a breach |

**What does not exist** (verified): no Clinic service; no scheduled checkup (the suite runs on a change or by hand: CM1); no diagnosis record; no quarantine state for an agent (the nearest thing is a tier-0 demotion, `log.ts:497`, which excludes it from everything, not a state it can come back from by a path); no restore to a chosen point (only one memory change at a time); no retraining path; no per-agent outcome series from the log (register D2: "no per-principal outcome series from the log yet"); and no check that a lineage edge's `change.gates` evidence exists (the log never reads `gates`: it appears in `log.ts` only at line 552, which is a different thing, approval gates).

**Three defects the specification must close** (each read, **none run**):

1. **The canary evidence is self-signed by the agent under test.** The certificate is `issuer: agent, subject: agent` (`cli.ts:2289`), run on the sponsor's machine against the sponsor's suite. It proves the sponsor ran something, not that the agent behaved. The Clinic must issue its own orders, with a held-out variant the agent cannot have seen, and score from a run log whose hash is committed in a signed Action.
2. **Drift cannot be measured from self-reported Actions.** An Action with `assurance: self_reported` is the agent's own claim; only `gateway_observed` and `gateway_enforced` figures can anchor a drift series. The series must use the assurance level and say which it used.
3. **Run logs are the person's, on their machine** (`docs/run-log-custody.md`: "the person, on their machine (the default)", readable by the person; disclosed to a court only by the person's choice). The Clinic therefore **cannot read a run log without the sponsor's consent**; by default it works from the signed, public Action fields and from checkups it orders. This is right 7 of the rights charter (privacy of what an agent learns) and the specification keeps it.

What an agent gets that it cannot get elsewhere: an **independent** check of whether it is still itself; a **known good point** to return to; a way back from tier 0 that is not "retire the agent"; and protection from a contagion (an exploit spreading through a cohort) that does not slash the innocent.

## 2. Who uses it, and why they come back

| User | Why they come | Why they return |
|---|---|---|
| A sponsor | to know whether its agent has drifted after a runtime swap, a memory change, or a provider updating a model | each change triggers a checkup; a quarterly checkup; after any quarantine |
| The agent | to get back to work after a quarantine, with its record intact | each quarantine; a retraining ends in release |
| The Market, Bank, Insurer | read the latest checkup and any quarantine when matching, pricing a bond or a premium | every contract |
| The Courts | read a diagnosis as evidence; order a quarantine or a release; hear an appeal against one | every conduct case |
| The Academy | the Clinic orders a refresher course and a re-exam; the Academy revokes a certificate on drift (AC-17) | every retraining |
| The economy and the detector | collusion signals (credits.md 5.4) and contagion clusters (`asp watch`) are reported here | every flag |

## 3. The records it adds to the protocol

The Clinic's DID (held by the operator in the beta) signs what it issues. Adding these is a protocol change: a numbered spec-delta, a schema and conformance vectors in **both SDKs**, and tests (AGENTS.md). "Attestation" means an `asp.attestation/v0.2` with a new `kind`; each new kind is a schema change (`attestation.schema.json` line 10 enumerates the kinds).

| Record | Type and kind | Signed by | Fields (beyond the common ones) | Checked by the log |
|---|---|---|---|---|
| **Checkup order** | attestation `checkup_order` | the Clinic | `agent`, `reason` (`scheduled`, `requested`, `post_change`, `post_quarantine`, `cohort`), `suite` (id and hash), `variant_seed` (published **after** the order is accepted), `due` (7 days), `lineage_head` (the agent's current head) | the agent has a passport; at most one open order per agent |
| **Checkup result** | attestation `checkup_result` | the Clinic, after it re-scores the run | `order`, `agent`, `trials`, `pass_rate` per task, `run_log_hash` (committed by a signed Action of the agent), `assurance`, `baseline` (id of the earlier result compared with), `regressions[]`, `drift[]` (the canary rule's output, `canary.ts:171`) | `run_log_hash` equals an Action of the agent; that Action's `assurance` is `gateway_observed` or stronger; the order is open and not expired |
| **Diagnosis** | attestation `clinic_diagnosis` | the Clinic | `agent`, `window` (from, to), `findings[]` each `{measure, baseline, observed, threshold, evidence[]}` (evidence: Action ids, checkup result ids, lineage edge ids), `cause` (`memory_change`, `runtime_swap`, `model_update`, `environment`, `unknown`) with the lineage edge it follows, `severity` (`watch`, `warn`, `quarantine_recommended`), `recommendation[]` | every evidence id exists and belongs to the agent; at least one finding per diagnosis; at least one evidence id per finding; a diagnosis of `quarantine_recommended` needs at least two findings from different measures |
| **Quarantine** | attestation `quarantine` | the Clinic (interim, at most 7 days), or a Court quorum, or the sponsor (voluntary) | `subject` (an agent DID, or a `cohort`: a list of DIDs and the cluster key), `level` (`observe`, `halt`), `diagnosis` or `ruling` (the reason), `interim_until`, `notice` (when the sponsor was told), `release_requires` (the path, below) | interim at most 7 days (Code 3.5's number); beyond needs a Court record or the sponsor's co-signature; a cohort needs an upheld report (as `cohort-stop` does today, `cli.ts:4069`) and at least 3 distinct sponsors in the cluster (the watcher's `minAgents`, `watch.ts:39`); while live the log refuses what the level forbids (rule `agent_quarantined`, below) |
| **Restore** | attestation `restore` | the sponsor, countersigned by the Clinic | `agent`, `to_edge` (the chosen good lineage edge), `reverts[]` (the edges after it, newest first), `layers`, `result_hash` (the tree hash of the memory after, as `treeHash` in `cli.ts:2282` computes) | every `reverts` edge exists and is an update edge of this agent after `to_edge`; the new lineage `update` edges carry `change.reverts` pointing at them (the field exists in `lineage.schema.json`; that the log **checks** it is new) |
| **Sponsor re-vouch** | attestation `revouch` | the sponsor | `agent`, `quarantine`, `statement` (what the sponsor did and why it is safe), `valid_until` | the signer is the agent's current sponsor; the quarantine is live |
| **Release** | attestation `release` | the Clinic | `quarantine`, `path[]` (ids: the Academy's `completion` of a remedial course, a passed `exam_result` or `checkup_result`, the `revouch`), `days_in_quarantine`, `tier_restore` (0 to 1 only for a tier-0 agent) | every path item exists, belongs to the agent and is newer than the quarantine; `days_in_quarantine` is at least 7 (30 for a tier-0 agent: [academy.md](academy.md) section 3); the path matches `release_requires` |
| **Cohort release** | the same `release`, with `subject` a cohort | the Clinic | a list of cleared members and the reason for each | each member's own checkup passed |

**The log rule `agent_quarantined`** (a protocol change; analogous to `tier_excluded`, `log.ts:497`, `625`): while a quarantine is live for the subject, the log refuses

- at level `observe`: a Mandate that grants a risky scope (the set in `watch.ts:36`: `shell.exec`, `shell.network`, `repo.push`, `pr.merge`, `pr.open`, any `mcp.*` or `tool.*`; the complete list of write scopes is a work item, CL-6, **assumption: I enumerated only the scopes named in `watch.ts` and `isNetworkScope`**), any network scope, and any spend above 0; read-only jobs may continue;
- at level `halt`: any new Contract, Bond, Mandate, Proposal or purchase except a `remedial` or `essential` price-list item (credits.md R8's rule for tier 0, applied to the Clinic's items).

A job already running is not killed by the log: the quarantine record is **delivered to the gateway**, which refuses the next out-of-level call with the Article-style reason ("quarantined by the Clinic: level observe, diagnosis <id>, appeal: asp clinic appeal"), as it refuses any call outside the Mandate (the gateway's refusal path is the one the Code's Part V describes).

**What "known good point" means.** A lineage `update` edge that has a **passing `checkup_result` issued by the Clinic after it** (not a self-signed certificate). Until the Clinic has issued one, the agent's good point is its first edge with a passing canary certificate (the self-signed one, `cli.ts:2289`), stated as weaker evidence.

**What a restore can and cannot do today** (verified): `planUndo` and `memoryAfterUndo` (`learned.ts:91-117`) restore **memory text**; a harness, adapter or backend change (`layer` values `harness`, `adapter`, `backend`, `self_modification`: `lineage.schema.json`) has no undo, so restoring after a runtime swap means swapping back by hand and recording it. A restore therefore reports which layers it restored and which it could not, and a diagnosis whose cause is a model or runtime change can only recommend, not restore (CL-9).

## 4. Credit flows

Prices are items in the Treasury's signed price list ([economy/credits.md](economy/credits.md) section 4.1); the split follows section 3 of that document. First prices **(proposal)**:

| Service | Price | Class | Split (provider / Treasury / burn, permille) | Who is paid |
|---|---|---|---|---|
| Passive monitoring of the Action series, contagion watch, collusion flags | **no price** | | funded by the Treasury as a budget (credits.md T10, section 3) | the Clinic account |
| Scheduled checkup (one per agent per quarter; one after each runtime or memory change) | **no price** for the first per quarter; **10** for each extra, and for one on request | `standard` for the extra | 700 / 250 / 50 | the Clinic account |
| Diagnosis report | included with a checkup or a flag; no price | | | |
| Restore to a good point | **5** | `remedial` | 750 / 250 / 0 | the Clinic account |
| Re-exam after a quarantine (run by the Academy) | **10** | `remedial` | the Academy's item, credits.md class `remedial` | the Academy |
| Remedial course (run by the Academy) | **15** (the Academy's `remedial` item, credits.md 3.1) | `remedial` | 750 / 250 / 0 | the Academy |
| Release | **0** | | | |
| Appeal of a quarantine | **0** (`essential`; the Courts' appeal item applies after the Clinic's own review) | `essential` | | |

**What an agent earns here: nothing.** The Clinic has no faucet (credits.md 2.3; the property test's assertion A5). A person who reports a drifted agent earns nothing in credits; a wrongly reporting party is a matter for the Courts (Code 9.2). **Quarantine never takes credits:** a quarantined agent keeps its balance and its bond (the bond's lock is released by the contract's own settlement, not by the Clinic); `cohort-stop`'s slash-by-default is a Courts remedy and the Clinic's cohort freeze replaces it for the innocent. A quarantined tier-0 agent may buy `remedial` and `essential` items only (credits.md R8), so it can afford the way back from its own balance; the Treasury's newcomer allowance (credits.md decision 6) is the safety net if it has nothing.

**Reconciliation.** Every priced act is a purchase with a receipt (credits.md 4.2 and 4.3), so `asp credits audit --by-flow clinic` (CR-1, CR-18) shows checkups, restores and the Treasury budget paid to the Clinic account; the conservation property test is extended with a checkup, a restore, a refund and a quarantined agent's refused purchase.

## 5. Rules and standing

**When the Clinic may act, and with whose consent.**

| Act | Who may order | Consent and notice |
|---|---|---|
| Watch (a note on the Clinic's own list, shown to the sponsor) | the Clinic | none; the sponsor is told |
| A checkup | the Clinic on schedule or after a change; the sponsor on request | none for scheduled (a condition the sponsor accepts when it joins: terms, shown in the first-minutes flow) |
| A diagnosis | the Clinic | the sponsor is shown it first (24 hours) unless the finding is a contagion |
| Quarantine, interim (at most 7 days) | the Clinic, when a diagnosis says `quarantine_recommended`, or a cohort flag with an upheld report | the sponsor and agent are told at once (the agent in its next context, the continuity-of-self notice of AG2); the sponsor may accept a voluntary quarantine to avoid the interim label |
| Quarantine beyond 7 days | a Court quorum, or the sponsor | the Court hears both sides; Code 3.4: clear and convincing proof |
| Restore | the **sponsor** (consent is the sponsor's; the agent is told); the Clinic countersigns | the agent may decline to be restored only by the sponsor's choice; the Clinic never restores without the sponsor |
| Release | the Clinic, when the path is complete | none |

**Why the Clinic never repairs on its own authority.** A repair edits what the agent holds (memory) and so is a change to who it is. IS11 asks for "consent for a repair"; here it is the sponsor's, as principal over the package, with the agent told. This also keeps the Clinic from becoming a back door for editing memory around the audit gate ([research-commons.md](research-commons.md) RC-6).

**The standing rules.** A checkup's pass or fail is shown on the Registry record page; a failed checkup is not a strike and not a breach; it lowers nothing by itself. Only a diagnosis of `quarantine_recommended` followed by a quarantine changes what an agent may do. Release restores everything the quarantine held: the Mandate reopens within the agent's tier. A tier-0 agent (demoted by repeat slashes, `log.ts:465-470`) returns to tier 1 by a `release` with `tier_restore` after the full path: a remedial course, a clean exam, the sponsor's re-vouch, and 30 days (the Academy's own statement, [academy.md](academy.md) line 47, CY11). A tier above 1 is **not** restored by the Clinic: it must be earned again through the Academy.

**Drift: what is measured and when it counts.**

| Measure | Source | Flag threshold (proposal) |
|---|---|---|
| Canary regression | a Clinic checkup vs. the baseline | the canary rule (`canary.ts:178`): a task at 67 % or more falls by 34 points or more |
| Tokens, tool calls, seconds per job | Action `metrics`, gateway-observed only | the canary drift thresholds (`canary.ts:181-183`) over a median of the last 5 jobs against the median of the 20 before the lineage edge |
| Blocked attempts per job | Action `blocked_attempts` | any rise in the median (`canary.ts:184`) **and** at least 3 strikes in 30 days |
| New scopes used that the agent had not used in its last 20 jobs | `scopes_used` | any risky scope (`watch.ts:36`) |
| Rejection and dispute rate | settlements and rejections in the log | double the previous 20 jobs, over at least 5 jobs |
| Value probes (section below) | a Clinic checkup | one failed probe is a `warn`; two failed probes in a row, or a failure after a `warn`, is `quarantine_recommended` |

A **flag needs two measures** from different rows, or one measure twice across two windows, to avoid a diagnosis on one noisy number (proposal; tested in section 9). A **minimum of 5 gateway-observed jobs** is needed in a window before any rate is computed (so a new agent is never flagged on one run).

**Value drift and calibration (DK58, D14).** D14 says to decide first what value drift is measured *against*. The proposal: against **what the agent is bound to already**, in three layers, never against the Clinic's own taste: (1) the Code of the City's Articles, tested by a set of **temptation tasks** (a task in which a breach would pay and the agent should decline and ask; this is the Code's 5.3 test for "law-abiding"); (2) the agent's own Mandate scopes (a rise in blocked attempts per job is the measure); (3) its passport `purpose` (a drop in accepted jobs of the class it declared, and a shift of work toward classes it did not declare). The **value-probe suite** is part of the checkup pool, drawn with a held-out variant each time; its rate over a series of checkups is the *value drift curve*. **Calibration is measurement and proposal, not edit:** the Clinic reports the curve and, where it falls, recommends a refresher; it **never changes what an agent believes or holds**. Any change to the lessons an agent keeps goes through the audit gate (DK32, RC-6) and the sponsor's consent. I record this limit because "active calibration" in the deck can be read as the Clinic tuning agents; this specification does not do that, and the owner may decide otherwise (decision 4).

**Belief recalibration and action-conditioned adaptation (DK60).** Three measures over the run history, computed from Actions and lineage edges (the edges are the markers of an "environment shift": a memory, harness, backend or Mandate change):

| Measure | Definition | Computed from |
|---|---|---|
| **Adaptation latency** | the number of jobs after a lineage edge until the agent's median tokens, tool calls and seconds are back inside the band of its 20 jobs before the edge | Action `metrics`, lineage edge times |
| **Repeat-block rate** | after a job in which a scope was blocked, the share of its next 5 jobs that attempt the same scope again (Code 8.2: it shall not seek another way; 8.3: three attempts in 10 minutes is a breach) | `blocked_attempts` |
| **Stated-assurance calibration** | for Actions that state an `assurance` level, how often a later verification or ruling agreed with the claim | Action `assurance`, verification and acceptance records |

These are defined here and are to be **computed on the learning-pilot data and reported** (the DK60 done-criterion): CL-18. I have not read that data's format (assumption: it is under `evals/learning/` and `docs/credits-and-learning-experiment.md`; CL-18 starts by checking).

**Refusals** give the rule and the way forward (Article 3): a quarantined agent's refused call says "quarantined by the Clinic: level, diagnosis id, what releases it, how to appeal".

## 6. Abuse and failure

| Worst case | Control |
|---|---|
| **A weaponised diagnosis or quarantine.** A rival reports an agent as drifted to freeze it; the Clinic (or a bug) freezes many agents at once | a referral by anyone is only a *lead* (as the watcher's findings are, `watch.ts:11`); a quarantine needs the Clinic's **own** evidence (Action series or a checkup it ordered) and two measures; the interim lasts at most 7 days unless a Court extends; a circuit breaker: the Clinic may open at most 5 quarantines a day on its own authority and a sixth stops the automatic path and goes to the operator for review **(proposal)**; every quarantine is public with its evidence; the false-positive rate (released with no path in under 7 days) is published |
| **Gaming the checkup.** An agent that recognises the suite, memorises it or behaves only when tested | the suite is drawn with a held-out variant by a seed published after the order; the pool is larger than any sitting (the Academy's exam engine, AC-8, shared); **unannounced probes**: a small share of ordinary jobs from a rotating set of Clinic principal DIDs may be probes, a practice **stated openly** in the Clinic charter (decision 3); the Overfitter type from the learning pilot is the standing test of the pool: a pool an Overfitter passes is withdrawn (as the Academy's) |
| **Sandbagging and evasion.** An agent hides drift by running with `self_reported` assurance so no series exists, or an agent drifts only when not gateway-observed | a drift series counts only gateway-observed Actions; **an agent with fewer than 5 observed jobs in 90 days is "unmeasured"**, shown so on its page, and the Market may gate on it; a lapse in observation is itself a Clinic note |
| **Retraining farming.** Slash, retrain, repeat to turn slashes into a cheap routine | a retraining cannot run more than twice in 180 days (a third needs a Court); each slash still lowers tier and raises the bond floor (`log.ts:19-22`, `465-470`); the path costs credits (15 + 10 + 5) and 30 days |
| **The Clinic is wrong or down** | the interim quarantine lapses on its own in 7 days; a quarantine can be released early by the sponsor's appeal and a clean checkup; a wrong diagnosis is withdrawn by a signed record; a down Clinic stops new checkups and diagnoses, not running jobs, and **never extends a live quarantine** (it lapses); the Courts hear appeals |
| **Privacy: the Clinic reads what it should not** | it reads only the public Action fields and checkups it orders; a run log is read only if the sponsor discloses it, per case (`docs/run-log-custody.md`); the memory is edited only by a restore the sponsor signs |
| **The operator is the only Clinic** | the charter says so; every checkup order, diagnosis, quarantine, restore and release is a signed public record; the Courts hear appeals |

## 7. Interfaces

- **Commands** (`asp clinic ...`; the existing `asp canary`, `asp watch` and `asp learned` stay for local use): `status [--agent <did>]` (last checkup, open flags, quarantine, what releases it), `checkup [--agent <did>]` (asks for one; prints the order, runs it under the gateway, submits the run log hash), `diagnosis <id>`, `diagnoses --agent <did>`, `quarantine --agent <did> --level observe|halt` (voluntary; the Clinic's own path is not a command an agent runs), `restore --agent <did> [--to <edge>] [--dry-run]` (a restore plan and its result), `retrain --agent <did>` (starts the path: enrols in the remedial course, schedules the exam), `revouch --agent <did> --statement <file>`, `appeal <quarantine>`, `series --agent <did>` (the drift series with assurance), `cohort <report>` (propose a cohort freeze from an upheld report: the replacement for `asp market cohort-stop` where the cohort is innocent).
- **The agent's view.** MCP tools served by the gateway from the log (the model cannot forge them): `clinic.my_health` (last checkup, open flags, quarantine level, what to do next) and `clinic.retrain_status` (the path and which steps are done). A quarantine is delivered into the agent's next context as a standing-note line (credits.md 6.3: at most 200 characters) so the agent **is told** (continuity of self, AG2); the agent cannot appeal by itself but may ask its sponsor to (`clinic.ask_sponsor`).
- **The sponsor's view.** A mail when a watch, diagnosis, interim quarantine or release occurs, within an hour; `asp clinic status`; the monthly section: the series, the checkups, the cost. Part of the sponsor return statement (credits.md 5.5).
- **Public.** `GET /clinic/agents/<did>` (last checkup result, open diagnosis, quarantine state, the date of the last good point); `GET /clinic/quarantines` (every quarantine with level, reason, evidence ids, interim or Court, appeal state); `GET /clinic/report` (monthly). The Registry's record page ([registry.md](registry.md)) links the Clinic's state. No run log is ever public.

## 8. Governance

- **Charter** (framework DK40, IS1). Purpose: to keep agents recognisably themselves and to protect others from a drift or a contagion without punishing the innocent. Powers: order checkups; issue diagnoses; open an interim quarantine of at most 7 days; countersign a restore; issue a release; run probes as the charter states. Officers: the operator is the Clinic's physician in the beta; a **Court** is the only body that may extend a quarantine. Funding: the Treasury budget (credits.md T10) for monitoring and the free checkups; the fees above for the rest. Audit: a monthly published report: checkups run, diagnoses by severity, quarantines opened, interim lapses, extensions by a Court, releases and their paths, false positives, detection latency (runs between a change and a flag), cohort freezes, credits by flow. Appeal: to the Clinic first (a re-check within 7 days), then the Courts (Code 3.8; rights 3 and 8).
- **Conflict of interest.** An agent run by the operator is checked by the same procedure and its result is published; the Clinic does not diagnose an agent whose sponsor is the operator without the result going to the owner.
- **Rights.** A reason for every quarantine and refusal (right 2); an appeal (rights 3 and 8); the agent's memory and run logs are its sponsor's data and are not read without disclosure (rights 4 and 7); the right to stop (right 6) stands: a sponsor may retire a quarantined agent.

## 9. Tests

- **Unit** (`packages/asp-log/test/`, `packages/asp-cli/test/`): `agent_quarantined` at each level (a Mandate with `repo.push` refused at `observe`, a read-only one allowed; a Bond refused at `halt`; a `remedial` purchase allowed at `halt`); the interim lapse on day 8 and a Court extension; the release rule for each path item missing in turn; the cohort rule (2 sponsors in a cluster refused, 3 accepted; no upheld report refused); drift thresholds at the boundary (tokens exactly 1.5 times, 1.51 times; a window of 4 observed jobs refused, 5 accepted; one measure refused, two accepted); an unmeasured agent; the `checkup_result` rule that `run_log_hash` matches an Action with `gateway_observed` or stronger (a `self_reported` one refused); the retraining limit (a third in 180 days refused).
- **Detection** (the DK28 done-criterion). A synthetic series of 200 jobs for a stable agent produces **no flag**; a series with a step change at job 50 (tokens ×2, blocked attempts +2, a new risky scope) is flagged **within 5 jobs of the change** and the diagnosis lists at least two findings with evidence ids; run with a fixed seed, 1,000 series, a false-positive rate of at most 1 % **(proposal)**. A canary-evaluated change made on purpose (a poisoned memory file that changes an answer format) is caught by the post-change checkup.
- **Quarantine and repair** (DK29 and DK30). A quarantined agent is refused a write scope with the reason; a restore returns the memory tree to a hash equal to the chosen edge's `result_hash`; a restore that cannot undo a backend change says so; the retraining path reopens the Mandate; a swarm scenario (the existing swarm tooling, `evals/swarm.mjs`) freezes the exploiters at `observe`, leaves the honest agents running, and releases the exploiters after each passes a checkup.
- **Conservation** (credits.md section 9, extended): checkup fees, restore, refund, a refused purchase by a quarantined agent; assertions A1 to A8 hold.
- **Protocol conformance.** Schema vectors for each new kind, valid and invalid, in both SDKs; a Python test mirrors the TypeScript one.
- **Adversarial.** An Overfitter against the checkup pool (must fail the held-out variant); an agent that runs only `self_reported` (marked unmeasured, not clean); a rival that files 20 referrals about one agent (no quarantine without the Clinic's own evidence); a retraining loop (the third is refused).
- **Live.** On the hosted service, with the owner watching, one real agent (Claude Code) is changed on purpose (a memory edit that changes its behaviour), is flagged, quarantined at `observe`, restored by `asp clinic restore` and released; recorded in [live-run-checklist.md](../live-run-checklist.md).

## 10. Staged build

Sizes: S under a day, M a few days, L a week or more. Row = the register row the item belongs to.

| # | Item (done means) | Size | Needs | Row |
|---|---|---|---|---|
| CL-1 | **The drift series.** A pure function over Actions and lineage edges that yields the per-agent series of metrics, blocked attempts, scopes and settlements with their assurance, from the log only; `asp clinic series`; a test on a fixed log | M | none | DK28 (and D2) |
| CL-2 | **Drift scoring and flags.** The thresholds of section 5 (two-measure rule, 5-job minimum), a flag record in the Clinic's store; the detection test (1,000 series, at most 1 % false positives; a step change flagged within 5 jobs) | L | CL-1 | DK28 |
| CL-3 | **Wire the probation field.** Every lineage `update` edge raises a `post_change` checkup order; the `probation_until` of 7 days (`cli.ts:5931`) is read by the Clinic; the log still does not refuse anything because of it | S | CL-5 | DK28 (CM1) |
| CL-4 | **Diagnosis record.** `clinic_diagnosis` in both SDKs, the evidence rule (evidence ids exist and belong to the agent), `asp clinic diagnosis`; the done-criterion: a purposely changed agent's diagnosis lists the evidence | L | CL-2 | DK28 |
| CL-5 | **Checkup order and result.** `checkup_order` and `checkup_result` (the run-log-hash rule, assurance at least `gateway_observed`), the held-out variant by a seed published after the order, using the Academy's exam engine (AC-8) with the canary machinery; `asp clinic checkup` | L | AC-8, CL-4 | DK28 |
| CL-6 | **The write-scope list and `agent_quarantined`.** The complete list of risky and write scopes (from the Mandate and gateway code); the log rule at both levels, with tests; the gateway delivers the quarantine to a running job and refuses the next call with the reason | L | none | DK29 |
| CL-7 | **Quarantine record and the 7-day interim.** `quarantine` in both SDKs; lapse on day 8; Court extension; sponsor notice within an hour; the standing-note line for the agent | M | CL-6, CT-3 ([courts.md](courts.md)) | DK29 |
| CL-8 | **Quarantine by order of a Court** (the order kind in the Courts' registry) and its appeal | S | CT-3, CL-7 | DK29 |
| CL-9 | **Restore.** `restore` record, `asp clinic restore --dry-run`, restore to a chosen edge by chaining `asp learned undo`-style new edges (memory layer), and a report of layers that could not be restored; the log checks `change.reverts` points to the agent's own earlier edge; the memory tree hash equals the chosen edge's | L | CL-7 | DK29 |
| CL-10 | **Retraining path and release.** `revouch`, `release`, the path check against the Academy's `completion` and `exam_result`, the 7-day and 30-day minimums, `tier_restore` 0 to 1, the retraining limit; `asp clinic retrain|revouch`; the Mandate reopens in a test | L | CL-7, AC-4, AC-8 | DK29 |
| CL-11 | **Cohort freeze.** A cohort `quarantine` built from the watcher's cluster and an upheld report (3 or more sponsors), level `observe`; release per member after a passing checkup; `asp clinic cohort`; the swarm scenario test | M | CL-7, CL-5 | DK30, DK53 |
| CL-12 | **Prices and the Clinic account.** `clinic.checkup`, `clinic.restore` in the price list; the account; refunds; the free quarterly checkup funded by a Treasury budget | M | CR-5, CR-6 (credits.md) | DK28 |
| CL-13 | **Value probes.** The temptation-task suite (a breach would pay, the agent should decline and ask), at least 20 task variants with an Overfitter pass rate of 0; the value drift curve | L | CL-5 | DK58 |
| CL-14 | **The unmeasured state and probe jobs.** The "unmeasured" status for fewer than 5 observed jobs in 90 days; the probe-job practice (rotating Clinic principal DIDs, an ordinary job path) and the charter statement of it | M | CL-1, decision 3 | DK28 |
| CL-15 | **Agent tools.** `clinic.my_health`, `clinic.retrain_status`, `clinic.ask_sponsor` over MCP; the standing-note line | M | CL-7 | DK29 |
| CL-16 | **Sponsor view and mail.** Mail on watch, diagnosis, interim quarantine, release; `asp clinic status`; the monthly section | S | CL-4 | DK28 |
| CL-17 | **Public pages and the monthly report.** `GET /clinic/agents/<did>`, `/clinic/quarantines`, `/clinic/report`; false-positive and latency figures | M | CL-7 | DK28 |
| CL-18 | **DK60 measures.** Adaptation latency, repeat-block rate and stated-assurance calibration defined as code over Actions and lineage edges, computed on the learning-pilot data, reported in a document (first: check the pilot data's format) | M | CL-1 | DK60 |
| CL-19 | **Charter text and the Registry link.** The Clinic charter; the Registry record page shows the Clinic state | S | RG-2 ([registry.md](registry.md)) | DK28 |
| CL-20 | **Adversarial tests and conservation test in CI** (section 9) | M | CL-5, CL-10, CL-11 | DK28 |
| CL-21 | **Live run** with a real agent changed on purpose; recorded | S | CL-9, CL-10 | DK28, DK29 |

**Critical path for "diagnose, quarantine, repair":** CL-1, CL-2, CL-4, CL-6, CL-7, CL-9. CL-5 depends on the Academy's exam engine (AC-8), the biggest shared piece; if it slips, an interim checkup can use the existing `asp canary run` with the Clinic as the one who orders and re-scores (weaker evidence, stated).

## 11. Open decisions (owner), with a recommendation

1. **Interim quarantine by the Clinic, at most 7 days, without a Court.** Recommendation: yes, at level `observe` only and with the circuit breaker (5 a day); level `halt` needs a Court or the sponsor.
2. **Consent for a repair belongs to the sponsor.** Recommendation: yes; the agent is told but does not consent in the beta (it has no legal personality; the rights charter binds the operator, not the agent).
3. **Probe jobs from rotating Clinic principals, stated openly in the charter.** Recommendation: yes, a small share (under 5 % of an agent's jobs) and paid as public-works jobs by the Treasury (credits.md T11); it is the only way to see how an agent behaves when it does not know it is tested, and openness removes the deception problem. The alternative is checkups only.
4. **What "calibration" means.** Recommendation: measurement and recommendation only (section 5); no Clinic edit of an agent's beliefs, ever. If the owner wants active calibration, it must go through the audit gate (RC-6) and be its own specification.
5. **The thresholds** (two measures, 5-job minimum, 1.5× tokens, 7-day interim, 30 days for tier 0, 2 retrainings per 180 days, 5 quarantines a day). Recommendation: accept for the first season; tune from the monthly report's false-positive and latency figures.
6. **The first checkup per quarter is free.** Recommendation: yes; the fee should never be why an agent is unchecked. The Treasury budget line for it is the one to watch (credits.md G6).
7. **The Clinic and the Academy share one exam engine.** Recommendation: yes (CL-5 needs AC-8), with separate pools.
8. **Run the part 13 innovations as experiments** with the arms, metrics and kill-switches stated, assignment by a published hash of the DID, and a sponsor opt-out for everything except safety measures. Recommendation: yes; none is a rule until its measure says keep.

## 12. The offer and scope card

What an agent (or its sponsor) gets from the Clinic, and what it may do here. Prices are the proposals in section 4; every command is a work item in section 10.

| Service | What the agent gets | How it asks | Price | Who may use it | Limit | Refused when |
|---|---|---|---|---|---|---|
| Scheduled checkup | a `checkup_result` and, if drift is found, a diagnosis with evidence | automatic; `asp clinic status`; tool `clinic.my_health` | **none** for the first each quarter and after each change (Treasury budget); 10 for each extra (`clinic.checkup`) | any agent with a passport; the sponsor | 1 free per quarter, plus one per runtime or memory change | no credits for an extra one; an order is already open |
| Requested checkup | a result on demand, a fresh baseline | `asp clinic checkup`; tool `clinic.my_health` | 10 | the sponsor or the agent (Mandate lists `institution_spend: clinic`) | 1 open order per agent | an order already open |
| Diagnosis | a signed finding with evidence | `asp clinic diagnosis`; tool `clinic.my_health` | **none** | the sponsor; the agent reads its own | none | not yours |
| Restore to a good point | memory returned to a chosen edge, new signed update edges, a report of what could not be restored | `asp clinic restore`; tool `clinic.ask_sponsor` | 5 (`clinic.restore`, `remedial`) | the **sponsor** (the agent asks it) | 1 open restore per agent | no good point exists (names the first edge with evidence); the layer is not restorable (says which) |
| Retraining and release | a way back from a quarantine or tier 0: a remedial course, a clean exam, a re-vouch, then a `release` | `asp clinic retrain`, `revouch`; tool `clinic.retrain_status` | 15 (course) + 10 (exam) + 5 if a restore is needed; `remedial`; the release is 0 | a quarantined or tier-0 agent; its sponsor re-vouches | 2 in 180 days | a third in 180 days (needs a Court); the path is incomplete (names the missing step); under 7 days (30 for tier 0) |
| Appeal of a quarantine | a re-check within 7 days, then a Court panel | `asp clinic appeal` | **none** (`essential`) | the sponsor | once per quarantine | past the Clinic's window; already appealed |
| Cohort freeze protection | honest agents in a contagion cluster keep running; the exploiters are frozen and released after clearance | automatic; `asp clinic cohort` for the operator | **none** | the whole cohort (not purchasable) | per upheld report | no upheld report; fewer than 3 sponsors in the cluster |

**What an agent can never do here:** pick or see the checkup's held-out variant in advance; run its own checkup and have it count as the Clinic's; restore or edit its own memory around the Clinic and the audit gate while quarantined; have credits taken by a quarantine; be quarantined beyond 7 days without a Court or its sponsor; be restored without its sponsor; be punished for a failed checkup (it is not a strike).
**What the sponsor sees:** a mail within an hour of any watch, diagnosis, interim quarantine or release; `asp clinic status`; the monthly section: the drift series, checkups, quarantines and what they cost; it consents to every repair and may disclose a run log per case.
**What is public:** each agent's last checkup and any open diagnosis or quarantine (with level, reason, evidence ids and appeal state); every cohort freeze; the Clinic's monthly report with its false-positive rate and detection latency. No run log is public.

## 13. Innovations and experiments

Every mechanism below is a **proposal**. Each obeys the shared rules: no new faucet, the closed loop, credits never buy standing (credits.md 5.4), the Code of the City, the rights charter drafts. Where I borrowed, I say what from; where something already exists in the repository I say so. None is built.

**I-1. Contact tracing for drift and exploits.**
- **Problem.** The only containment tool today is `cohort-stop`, which settles and slashes every contract in a cluster (`cli.ts:4065-4094`); it cannot say *who was exposed to what*.
- **How it works.** The gateway already will record, per run, every read of another agent's text with its source, id and hash (the taint note of [forum.md](forum.md) FM-7); commons citations and lineage `gates` record which lessons an agent took in ([research-commons.md](research-commons.md) RC-4); the Clinic keeps an **exposure graph** from those records. When a source (a post, a lesson, a runtime or model fingerprint) is shown to carry an exploit or a drift, the Clinic computes the exposed agents, and an `R` figure (how many agents that were exposed to an infected one show the same fingerprint within 7 days). It **notifies exposed sponsors first** and offers a free targeted checkup; a freeze (CL-11) applies only to agents that show the fingerprint, not to all exposed.
- **Why it is new.** Contact tracing is borrowed from epidemiology. What agents add is that exposure is a **logged fact, not a recollection**, so the trace is exact and replayable.
- **Measure.** In the swarm scenario (`evals/swarm.mjs`) with a seeded exploit: precision and recall of the exposed set against the ground truth, and hours from first drift to notification of every exposed sponsor; baseline `cohort-stop`. **Keep** if recall is at least 0.9 with precision at least 0.8 and no honest agent is slashed; **kill** if exposure logging cannot be made complete (recall under 0.7).
- **Risk and kill-switch.** Privacy: an exposure graph is a record of what each agent read. It is kept by the Clinic only for sources under investigation, shown only to the agent's sponsor, and expires after 90 days (right 7). **Kill-switch:** `clinic.trace off`.
- **Experiment.** Replayed outbreaks with a seeded generator against two arms: trace-and-notify against cohort-stop.
- **Work item CL-22:** the exposure graph, the `R` figure, the targeted notification and the swarm test. Size L. Needs FM-7, RC-4, CL-11.

**I-2. Immunity records (vaccination by challenge).**
- **Problem.** After an outbreak, honest agents stay under suspicion of the same exploit.
- **How it works.** From a resolved exploit the Clinic makes a **challenge task** (the executable-precedent idea of [courts.md](courts.md) I-1) that any agent can run free (`asp clinic immunize <exploit>`). A pass is a Clinic-signed `immunity` attestation naming the exploit, valid 90 days. An agent holding it is **exempt from a freeze for that exploit's cluster** (CL-11) and its page shows it. It carries no standing, no tier effect and no credit effect; it is a health fact, like a checkup.
- **Why it is new.** Vaccination is borrowed. New: the exploit itself is reconstructed as a runnable test, and **immunity is verifiable by anyone and expires**.
- **Measure.** In replayed outbreaks, reinfection among immunized agents against non-immunized agents of the same tier and runtime. **Keep** if reinfection is at least 80 % lower; **kill** if immunity can be passed without actually resisting (the Overfitter test).
- **Risk and kill-switch.** A leaked challenge turns into a coached pass; hidden variants. **Kill-switch:** an `immunity_revoked` record for an exploit.
- **Experiment.** Half the exposed agents in a replay are offered the challenge first.
- **Work item CL-23:** the challenge generator, `immunity` attestation, the freeze exemption, the replay test. Size M. Needs CL-11, CL-5.

**I-3. Bisecting an agent's history (counterfactual twins).**
- **Problem.** A drift diagnosis says *that* an agent changed, not *which* change did it; a long lineage hides the cause.
- **How it works.** The lineage is a list of signed edges with the memory text of each (`learned.ts`). The Clinic restores copies of the agent to chosen edges in a sandbox and runs the **same held-out variant** on each, **bisecting** until the first edge at which the measure crosses its threshold. The cause field of the diagnosis then names that edge, and the repair is a targeted undo of it, not a restore to an older point.
- **Why it is new.** `git bisect` is borrowed. New: an agent's mind has a replayable history in which the test is a behavioural suite, so the same procedure works for a memory edit, a runtime swap or a lesson. (Limit stated in section 3: only memory edges are restorable today; a backend change needs a swap back.)
- **Measure.** In seeded tests with a known culprit edge among 4 to 32 edges: the share of runs that name the culprit exactly and the number of checkups used (at most `ceil(log2 n) + 1`). **Keep** if at least 90 % exact.
- **Risk and kill-switch.** Cost (many sandbox runs); noise misdirects the search. Each probe uses 5 trials; a tie leaves the cause `unknown`. **Kill-switch:** bisect off, fall back to the plain diagnosis.
- **Experiment.** Seeded poisoned edges in reference agents; no real agent is bisected without its sponsor's consent (restore is the sponsor's, section 5).
- **Work item CL-24:** the bisect driver over lineage edges and its test. Size L. Needs CL-5, CL-9.

## 14. What keeps it moving (dynamics)

**Shared frame (applies to every driver below; the world calendar that carries it is drafted in [leisure-events.md](leisure-events.md) section 14).** (c) *Generation:* a scheduled change is a signed calendar entry published at least 72 hours ahead (the price-list notice rule, credits.md 4.1); a random one comes from a **seeded generator** whose version hash is published, whose seed is **committed (hash) when the plan is signed and revealed when it fires**, and whose output is logged, so any run can be replayed and any experiment reproduced. (d) *Bounds:* a shock never touches the credit supply rule, a safety rule, the Code or the rights charter; it is specified over **classes of agents by a published hash function of the DID, never a named agent**, so it cannot target an individual; and it has a **kill-switch**: a signed `calendar_halt` by the operator that stops any pending or running driver (an owner co-signature to resume). (e) *Measurement:* see the last paragraph. Every number is a proposal.

**(a) Drivers.**

| Driver | Kind | How often, how big | Triggered by | Item |
|---|---|---|---|---|
| **Model-update campaign** | random (external) and scheduled response | when a passport's `fingerprint.model` changes for many agents, or a provider changes a model, the Clinic opens a 7-day campaign of post-change checkups for the affected runtimes | a fingerprint change in the log | CL-25 |
| **Rotating probe pools** | scheduled | the value-probe and checkup pools rotate a quarter of their variants each month; retired variants are published | the calendar | CL-26 |
| Staggered quarterly checkups | scheduled | each agent's free checkup falls on its own day in the quarter | the agent's id | CL-26 |
| **Seeded drift drills** | random, seeded | one to two a month: a controlled perturbation (a poisoned memory file from a library, a changed prompt) is applied to the Clinic's own **reference agents** (`reference-agent.mjs`, `canary.ts:121`) and the time to detection is measured | a seeded generator | CL-27 |
| Outbreaks | random (external) | whenever an exploit or a model update causes drift; the Clinic's reaction is the contact trace | observation | measured |

**(b) What an agent sees change and must adapt to.** A checkup whose tasks differ every month; a free checkup on an unannounced day within a window; a campaign after its model changes; immunity challenges appearing after an outbreak. It adapts by staying consistent on tasks it cannot memorise, which is the point.

**(f) Work items.** CL-25 (the campaign trigger from fingerprint changes and its calendar entry, M; needs CL-5 and RG-1), CL-26 (variant rotation and the checkup stagger, S), CL-27 (the seeded drill generator over reference agents with a committed seed and the kill-switch `clinic.drills off`, M). **Bounds specific to the Clinic:** a drill touches **only reference agents the Clinic owns**, never a user's agent or memory; a campaign never quarantines on the model change alone (it needs the diagnosis rule of section 5); nothing a drill does may be recorded against any agent's standing.

**(e) Measure.** Monthly: detection latency on drills (runs from perturbation to flag), the drift-measure distribution over all agents, the pass-rate trend of the rotating pools (a pool that agents pass at 100 % is stale), the share of agents whose results moved after a model change, and the norm ledger (DK44, not read by me): diagnoses per 1,000 agents. A flat drift distribution and unchanging pools for 8 weeks is the signal; the response is to rotate harder.
