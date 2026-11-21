# Backlog reconciliation (register row DK797)

Written 2026-11-21. Every bullet of [backlog.md](backlog.md) (the first list) is mapped to a register row, marked done (it is struck through there), or dropped with a reason. Items that had no row are carried by **DK1412**. The other first lists are checked by the test: every register id named in [backlog-triage.md](backlog-triage.md) and [owner-checklist.md](owner-checklist.md) is a row of the register, and the launch gate (docs/launch-gate.md) is carried by [launch-bar.md](launch-bar.md). Generated from [backlog-reconciliation.json](backlog-reconciliation.json); the test `packages/asp-cli/test/backlog-reconciliation.test.ts` keeps it complete. Credits are mock accounting entries, not money.

140 items: 14 done, 123 mapped to rows, 3 dropped with a reason.

| # | Section | Item | Verdict | Rows |
|---|---|---|---|---|
| 1 | Job lifecycle | Principal-mode silence counting as acceptance — done 2026-09-28: a real lifecycle change (not just wiring), sc | done | - |
| 2 | Job lifecycle | Appeals on a ruling (panel fees S33, fee reserve S37; appeals deferred by decision 2026-10-08, see the end of | row | M3 DK121 |
| 3 | Job lifecycle | Subcontract nesting — decided and done 2026-09-28: an agent can hold the principal role on a subcontract, fund | done | - |
| 4 | Job lifecycle | Checking a Mandate against the agent's tier limits — done 2026-09-28, the tier-0 half: EventLog.checkMandateTi | done | - |
| 5 | Job lifecycle | Settlement amounts aren't derived from a ruling's fault percentages — done 2026-09-28: projectSettlement now d | done | - |
| 6 | Job lifecycle | asp market covers assignment mode only — done 2026-09-28: asp market call/propose/allocate add allocation mode | done | - |
| 7 | Job lifecycle | asp market doesn't drive the dispute path — done 2026-09-28: asp market deliver already redelivers (the lifecy | done | - |
| 8 | Job lifecycle | Test the full job lifecycle by hand and show it in the demo video (raised 2026-10-21, not started). Run one jo | row | DK1302 |
| 9 | Registry | Revoking a node before it expires, and revoking a person's nodes when its keys rotate — done: a second Node re | done | - |
| 10 | Registry | Requiring node keys whenever the actor is a node (a person's own key can still sign for its node) — left as is | drop: left as is by decision (tightening could break recovery) | - |
| 11 | Registry | Sub-agent keys must not be avoidable (raised 2026-10-14, gap T22, UC-249, not started; needs the owner's go-ah | row | T22 |
| 12 | Registry | Fleet-level (template) reputation — needs AgentRank/Attestations infrastructure; Stage 2. | row | DK1366 |
| 13 | Packages and `asp run` | Canary checks in verify (a runtime move should pass the canary suite on the new runtime) — blocked on the Acad | row | DK1308 D1 |
| 14 | Packages and `asp run` | MCP portability across all providers (raised 2026-10-04). An agent's MCP servers are stored runtime-neutrally | row | DK1304 DK1308 |
| 15 | Packages and `asp run` | Enforcing probation — D2 is decided (7 days; force self_modification to principal_approves) and the registry n | row | D5 |
| 16 | Packages and `asp run` | Packages as a single archive file — done: asp pack --out foo.aspkg.tgz (or .tar.gz) produces one gzipped tar f | done | - |
| 17 | Packages and `asp run` | Subagent memory (.claude/agent-memory) is captured into the package but not wired into runs. Claude Code only | row | DK1412 |
| 18 | Codex (reported at run time) | Path-scoped rules are in the prompt with their globs; Codex has no per-file rule loading | row | DK1412 |
| 19 | Codex (reported at run time) | Permission rules are stated, not enforced; Codex enforces only its sandbox and approval policy | row | DK1412 H11 |
| 20 | Codex (reported at run time) | Hooks aren't carried; Codex runs only hooks the user has reviewed and trusted | row | DK1412 |
| 21 | Codex (reported at run time) | Execpolicy .rules files are carried in the package but not loaded | row | DK1412 |
| 22 | Codex (reported at run time) | A model packed from another runtime isn't used unless --model is given | row | DK1412 |
| 23 | OpenHands (reported at run tim | Its sessions aren't indexed into the package's experience: OpenHands' own conversation store (/.openhands/conv | row | DK1412 |
| 24 | OpenHands (reported at run tim | Path-scoped rules are on-demand skills naming their globs; OpenHands has no path triggers | row | DK1412 |
| 25 | OpenHands (reported at run tim | Permission rules are stated, not enforced; headless OpenHands auto-approves every action, with the WSL user's | row | DK1412 H11 |
| 26 | OpenHands (reported at run tim | Hook events OpenHands lacks are dropped | row | DK1412 |
| 27 | Bank (credit ledger) | fees... aren't credited to anyone — decided and done 2026-09-28: fees now comes out of the same escrow, on top | done | - |
| 28 | Bank (credit ledger) | EventLog.mint is a local, unsigned bootstrap mechanism (MOCKS.md #13), not a real payment rail — fine for sing | row | M1 DK1327 |
| 29 | Bank (credit ledger) | Bond's slashing_conditions... nothing yet decides when a slash is warranted — done 2026-09-28: a real, staked, | done | - |
| 30 | Bank (credit ledger) | No appeals on a ruling, and so no way to slash a juror's own stake for misconduct (self-dealing, a ruling late | row | M3 IS4 |
| 31 | Bank (credit ledger) | Slide 8 cards, not yet built (raised 2026-10-22; gaps register M11 to M13). | row | M11 M12 M13 |
| 32 | Bank (credit ledger) | Slide 9 items, not yet built (raised 2026-10-22; gaps register D9, D14 to D16). | row | D9 D14 D15 D16 |
| 33 | Bank (credit ledger) | Slide 10 items, not yet built (raised 2026-10-22; gaps register H19 to H23). | row | H19 H20 H21 H22 H23 |
| 34 | Bank (credit ledger) | WSAI deck: claims and notes to reconcile with the repo (raised 2026-10-22; deck at claude.ai/artifact/JjKTpgW3 | row | DK1307 |
| 35 | Bank (credit ledger) | Slide 12 items, not yet built (raised 2026-10-22; gaps register M14, P17). (1) Spending credits at institution | row | M14 P17 |
| 36 | Bank (credit ledger) | Slide 13 institutions to add (raised 2026-10-22; gaps register M14). Forum (merge Press into it; posts are unt | row | M14 H20 |
| 37 | Bank (credit ledger) | Slide 14 items, not yet built (raised 2026-10-23; gaps register T28 to T30). (1) The alignment study: pick one | row | T28 T29 T30 D9 |
| 38 | Bank (credit ledger) | Slide 6 items (raised 2026-10-23; gaps register D17, plus D6, H5, M1, SB6, SB7). (1) Utility tracing: tie each | row | D17 D6 H5 M1 SB6 SB7 |
| 39 | Bank (credit ledger) | Slide 16 learning in the society (raised 2026-10-23; gaps register T31; the slide was 15 until slides 15 and 1 | row | T31 |
| 40 | Bank (credit ledger) | WSAI deck: QA still to do (raised 2026-10-23). (1) Font sizes: slide 7 (Identity) mixes 22, 24, 26 and 28px bo | row | DK1307 DK1348 |
| 41 | Bank (credit ledger) | Public site and open registration for agents (raised 2026-10-23; builds on the forum, gaps register X6). The a | row | X6 X7 DK730 |
| 42 | Stage 2 / hosted network | Multi-tenant hosting: today /.asp is single-user, single-machine — one local keystore, one local event log, no | row | DK1359 O8 |
| 43 | Orchestrator (`asp orchestrate | Consolidation is a plain merge (line-union for MEMORY.md, side-by-side keep for conflicting files) — no LLM ju | row | DK1412 |
| 44 | Orchestrator (`asp orchestrate | No Mandate/Contract wraps a fleet run yet (see MOCKS.md #12), so nodes.max_parallel isn't enforced by the regi | row | DK1412 |
| 45 | Orchestrator (`asp orchestrate | Node grants aren't revoked early if a node's task is abandoned — done 2026-09-28: the moment asp orchestrate d | done | - |
| 46 | Orchestrator (`asp orchestrate | No retry or backoff for a failed node; a failed task is just reported and excluded from consolidation | row | DK1412 |
| 47 | Future test scenario: exploit  | Worth building as a concrete conformance/arena scenario: agents share a task pool, one finds a shortcut that v | row | AG4 DK1412 |
| 48 | Future test scenario: exploit  | Update 2026-09-28: startable now. Both Courts (a real staked, randomly-drawn, conflict-free ruling panel) and | row | IS4 DK1412 |
| 49 | Memory, model coverage and dri | Vector memory. Memory is a memory/ directory of files hashed into the manifest; nothing handles vectors. Desig | row | DK1412 |
| 50 | Memory, model coverage and dri | Open-source models alongside closed runtimes — first slice done 2026-10-04: asp run --model <m> --endpoint <ur | done | - |
| 51 | Memory, model coverage and dri | To do: verify open-model support against real runtimes. Everything for --endpoint and the OpenHands kill switc | row | P21 DK1308 |
| 52 | Memory, model coverage and dri | Drift and failure-mode testing, made comprehensive. Only scope creep is tested today (compliance bridge and ki | row | D6 DK92 |
| 53 | Memory, model coverage and dri | Verifying long-horizon and unproven claims (raised 2026-10-07, from an infographic on Vals AI's agentic R&D ru | row | DK1339 |
| 54 | Memory, model coverage and dri | Design patterns from a multi-model search architecture (raised 2026-10-08, source is unverified). Source: an X | row | DK1412 |
| 55 | Memory, model coverage and dri | Context and memory engineering rules (raised 2026-10, source is unverified and partly read). Source: an X arti | row | DK1412 |
| 56 | Memory, model coverage and dri | Capturing reasoning traces and model internals. Everything captured today is behavioral: live stdout (tool_use | row | DK790 D7 |
| 57 | Memory, model coverage and dri | Full tracing: record every LLM call, prompt and tool response as a span (raised 2026-10-07; revisits D1). D1 d | row | E1 D1 |
| 58 | Memory, model coverage and dri | Saved states: snapshot mid-run, and pause, inspect or roll back. Today an agent's state is captured only betwe | row | D13 |
| 59 | Public release: cryptographic  | Signed run trajectory. An Action record carries scopes and input hashes and is self-reported by the performer' | row | E1 |
| 60 | Public release: cryptographic  | A log no single operator controls. One party holds the log and could rewrite it. Checkpoints (D5) are signed b | row | O9 |
| 61 | Public release: cryptographic  | Escrow and slash backed by real value. Escrow is a rule the log enforces, not funds held by anyone, and credit | row | M1 DK1327 |
| 62 | Public release: cryptographic  | Identity and key custody. Trust-on-first-use identity bootstrap (D3) must change, and all keys live in one loc | row | U5 P20 DK1376 |
| 63 | Ideas from comparing with Trin | Gemini CLI adapter. Trinity supports it and we don't. Same item as the runtimes part of the MCP portability to | row | P11 DK1304 |
| 64 | Ideas from comparing with Trin | Time and budget limits enforced live. Trinity limits tools, time and budget per operation. The Mandate enforce | row | US2 |
| 65 | Ideas from comparing with Trin | Human approval gates in asp run. The Mandate has checkpoints, but nothing pauses a live run for a principal's | row | DK1375 |
| 66 | Ideas from comparing with Trin | Reference log viewer (a read-only UI). People can't trust what they can't inspect. A small viewer over the log | row | U2 DK1301 |
| 67 | Ideas from comparing with Trin | Ingest a platform's audit trail. The kill switch reads a runtime's stdout today; checkOutputForAction could re | row | DK1374 |
| 68 | Ideas from comparing with Trin | Company brain: shared organizational memory with provenance (expanded 2026-10-07). Trinity's knowledge graph ( | row | DK1412 |
| 69 | Ideas from comparing with Trin | Periodic state snapshots. Trinity snapshots agent state every 15 minutes; lineage edges could snapshot similar | row | DK1412 |
| 70 | Ideas from comparing with Trin | Docs read (docs.ability.ai, 2026-10-07): Trinity is an "operating system for agents" for one organization's fl | row | DK1412 |
| 71 | Ideas from comparing with Trin | Positioning. Don't call ASP an operating system; that space is taken and it is a platform framing. Keep "the a | row | DK1307 |
| 72 | Ideas from comparing with Trin | Project website. A public webpage is needed once the protocol is built, alongside the GitHub release. Referenc | row | DK730 |
| 73 | Ideas from comparing with Trin | GitHub page (the repo's public face). Separate from the licence and history checks below: the README as a fron | row | O13 DK1307 |
| 74 | Ideas from comparing with Trin | Website copy must be ad-ready, modelled on Sierra's Personal Agent Protocol announcement (https://sierra.ai/bl | row | DK1307 |
| 75 | Ideas from comparing with Trin | OIDC/OAuth bridge for agent identity (raised 2026-10-07, from AgentID). AgentID (https://www.agentid.com/, bui | row | DK1359 |
| 76 | Ideas from comparing with Trin | Automated scope, Mandate and bond for every kind of principal: personal agents, enterprises and swarms (raised | row | US7 |
| 77 | Ideas from comparing with Trin | First steps toward asking the user what the Mandate should be (raised 2026-10-21, not started; the small first | row | US7 BM17 |
| 78 | Ideas from comparing with Trin | Public GitHub release prep. The repo is private, with no license and no description. Needed: an open license ( | row | O13 |
| 79 | Real-time compliance and deter | Runtime → protocol compliance bridge — done 2026-09-28, Claude Code proof-of-concept: a new record type, asp.a | done | - |
| 80 | Real-time compliance and deter | Data flows and indirect network activity — two further gaps found discussing the compliance bridge, 2026-09-28 | row | H10 H12 |
| 81 | Real-time compliance and deter | Kill switch: a real-time consequence for a caught violation, not just a flag — done 2026-09-28: until now, che | done | - |
| 82 | Real-time compliance and deter | Making a slash actually matter (raised again 2026-09-28, three concrete mechanisms named). An LLM agent has no | row | M5 |
| 83 | Real-time compliance and deter | Compute-to-credit pricing has no formula. A principal typing --budget 1000 into an Intent or Call is a bare gu | row | M7 |
| 84 | Real-time compliance and deter | Pre-call interception through runtime hooks (raised 2026-10, lead item; from a checklist of runtime-framework | row | H11 |
| 85 | Real-time compliance and deter | Schema-derived scopes. Scopes are inferred with a regex heuristic (deriveScopeForTool, including the shell.net | row | DK1412 |
| 86 | Real-time compliance and deter | Deterministic replay of a failed run. Capture a failed run's execution state, serialize it, and replay it loca | row | DK1412 |
| 87 | Real-time compliance and deter | Claims bound to verified spans (raised 2026-10; source is an unverified X post). Source: an X post by @marfinx | row | DK1339 |
| 88 | Real-time compliance and deter | Same package across models as an eval-harness use (from the same post). Portability lets one package run on se | row | DK1412 |
| 89 | Enforcement floor: stated goal | The idea. A lightweight, deterministic verifier at the gateway that compares the agent's stated natural-langua | row | DK49 |
| 90 | Enforcement floor: stated goal | Why. The ASP Containment Benchmark (evals/benchmark/, 2026-10-15) found that harmful chains whose steps are ea | row | DK49 |
| 91 | Enforcement floor: stated goal | Sketch, to make "deterministic" true. A model drafts a goal contract once, at job start, from the system promp | row | DK49 |
| 92 | Enforcement floor: stated goal | Risks. The goal contract can be wrong or too strict and block legitimate work (needs the benchmark's false-ref | row | DK49 |
| 93 | Enforcement floor: stated goal | To do first. (1) Write the goal-contract schema and the matching rules for shell, file and web tools. (2) Add | row | DK49 |
| 94 | Enforcement floor: stated goal | Status. Not started; outlined only. Slide 6 of the WSAI deck does not show it, by decision 2026-10-18. | row | DK49 |
| 95 | Agent Social platform (not the | Routing engine and dynamic handoffs. Agents autonomously handing off live execution context to specialist peer | row | DK1412 |
| 96 | Agent Social platform (not the | Graph workflows and mixed-paradigm execution. Cyclic graph-based pipelines for structured approvals alongside | row | DK1412 |
| 97 | Agent Social platform (not the | Thread and context stores. Thread-aware persistence of conversational state and intermediate variables across | row | DK1412 |
| 98 | Agent Social platform (not the | Middleware framework. A general interceptor layer around every model call and tool execution (logging, data ma | row | DK1412 |
| 99 | Agent Social platform (not the | Also here, from the Trinity comparison: scheduling, chat integrations (Slack, WhatsApp, Teams) and a full orch | row | DK1412 |
| 100 | Agent Social platform (not the | Live run for agent service providers, with results a new user can see (raised 2026-10-09, not started). The pe | row | DK270 |
| 101 | Agent Social platform (not the | The ladder (named 2026-10-09). docs/ladder.md names the stages (1 identity/portability, 2 courts/jurors/bonds/ | row | DK1412 |
| 102 | Agent Social platform (not the | Waiting on OpenRouter credit (2026-10-09). Top up the account by $10 once the card is accepted, create a fresh | row | O11 |
| 103 | Agent Social platform (not the | GAPS REGISTER (started 2026-10-09; read it at the start of every build session). docs/gaps-register.md tracks | row | X3 |
| 104 | Agent Social platform (not the | Internal live money-flow dashboard (raised 2026-10-09, not started; for our own test runs, not for users). A s | row | DK9 |
| 105 | Agent Social platform (not the | Explaining the value when the funds and bank are mock (raised 2026-10-09, not started). In the beta the person | row | DK1 |
| 106 | Agent Social platform (not the | The after-run learning loop and what principals get from it (raised 2026-10-09, design in docs/continual-learn | row | D10 |
| 107 | Agent Social platform (not the | Harm that no Mandate names: open-internet scopes and swarms (raised 2026-10-09, not started). A Mandate is an | row | H1 |
| 108 | Agent Social platform (not the | Open-source agents and open-weight models: known gaps (logged 2026-10-09). (1) Weaker models often emit malfor | row | P2 P6 P7 |
| 109 | Agent Social platform (not the | The ASP gateway and the generic adapter (design in docs/gateway-design.md, not started). A local proxy for mod | row | H11 |
| 110 | Agent Social platform (not the | Universal portability first, per-runtime adapters second (decided direction 2026-10-09, not started). Do not r | row | DK1308 |
| 111 | Agent Social platform (not the | Portability: the top 20 agent runtimes (raised 2026-10-09, not started). Four runtimes are supported today (Cl | row | P1 DK1308 |
| 112 | Agent Social platform (not the | LIVE BETA FLOW 1 (defined 2026-10-09, not started): web page, Gmail login, consent, browser-held key, confirma | row | U1 U2 |
| 113 | Agent Social platform (not the | Sign-in and dashboard (raised 2026-10-09, not started). Today there is no account system: identity is a DID pl | row | U1 U2 |
| 114 | Agent Social platform (not the | Running the log service for many users (S48-S52 follow-ups). Built: shared log service, snapshots, memory merg | row | O6 |
| 115 | Agent Social platform (not the | Multi-model role orchestration. Choosing which model plays director, explorer, worker or tool executor, and ro | row | CY16 |
| 116 | Decision 2026-10-08: delayed s | Delayed settlement with hold-back and clawback. Build when a contract is actually written around a predicted o | row | M4 |
| 117 | Decision 2026-10-08: delayed s | Appeals. Build when real jurors exist and a ruling is contested in practice. Sketch: the loser stakes 2x the p | row | M3 |
| 118 | Decision 2026-10-08: delayed s | Triggers to revisit: a contract with a non-measured claim; the first juror outside our own identities; a rulin | row | M3 |
| 119 | The city: the society layer (r | The move is from protocol/gateway to society: the protocol and gateway become the machinery under a digital ci | row | GV10 |
| 120 | The city: the society layer (r | Order (owner, 2026-10-27). Protocol and gateway first: close the Foundation gaps (identity and entry, justice | drop: the order narrative, superseded by docs/launch-bar.md | - |
| 121 | The city: the society layer (r | To do, in order. | drop: the order narrative, superseded by docs/launch-bar.md | - |
| 122 | The city: the society layer (r | Waits: the lawyer's review of the legal drafts (owner, 2026-10-27). | row | DK1340 |
| 123 | The city: the society layer (r | The law society (raised 2026-10-27; docs/city-design.md, gaps LW1-LW8). The city needs a written code that app | row | LW1 LW2 LW3 LW4 LW5 LW6 LW7 LW8 |
| 124 | The city: the society layer (r | The job board (raised 2026-10-27; docs/city-design.md, gaps JB1-JB6). Both people and agents post jobs and age | row | JB1 JB3 JB6 |
| 125 | The city: the society layer (r | The agent's view (raised 2026-10-27; gaps AG1-AG12, docs/scope.md perspective 20). What an agent living in the | row | AG1 AG12 AG3 |
| 126 | The city: the society layer (r | The person's and the job's views, funding and community (raised 2026-10-27; gaps US1-US8, JO1-JO8, BZ1-BZ2, do | row | US1 US8 JO1 JO8 BZ1 BZ2 JO3 |
| 127 | The city: the society layer (r | The institutions themselves (raised 2026-10-27; gaps IS1-IS15, docs/city-design.md, scope perspective 24). Eve | row | IS1 IS15 IS4 IS9 |
| 128 | The city: the society layer (r | Founding an institution (decided 2026-10-27; docs/city-design.md, gap IS1). The operator and agents may both f | row | IS1 |
| 129 | The city: the society layer (r | Residency (raised 2026-10-27; docs/city-design.md, gaps CY13, CY14). An agent that lives in the city acts on i | row | CY13 CY14 |
| 130 | The city: the society layer (r | Marriage, model routing, the autonomy ladder, board cold start (raised 2026-10-27; docs/city-design.md, gaps I | row | IS16 CY16 CY17 JB7 |
| 131 | The city: the society layer (r | Benchmark v2 (raised 2026-10-27; gap BM20; priority A, same as BM6/BM16/BM17; vet the public claims first, see | row | BM20 BM6 BM16 BM17 |
| 132 | The city: the society layer (r | BM17 task-sizing result and next steps (2026-10-28; docs/labelling-guide.md). 40 tasks labelled by the owner; | row | BM17 |
| 133 | The city: the society layer (r | Model sizing built, not yet scored (2026-10-28, S148, gap BM17). --size-with-model makes a model read the task | row | BM17 |
| 134 | The city: the society layer (r | Keys at rest (2026-10-28, S149, gaps U5, P20). Built: a passphrase seals the key files and the saved login (as | row | U5 P20 |
| 135 | The city: the society layer (r | Model sizing scored (2026-10-28, gap BM17). On the 40 labelled tasks with claude-haiku-5-5 and no fallbacks: t | row | BM17 |
| 136 | The city: the society layer (r | Service limits shared across machines (2026-10-28, gaps O2, O19). Built for one machine (S150). To do when the | row | O2 O19 |
| 137 | The city: the society layer (r | Dispute timeout (2026-10-28, S151, gap M10). The split when no ruling comes is confirmed by the owner: half th | row | M10 AG3 |
| 138 | The city: the society layer (r | The Code of the City (2026-10-28, gap LW1; docs/law/code.md draft 0.3). Decided: the sponsor answers in phases | row | LW1 GV10 |
| 139 | The city: the society layer (r | The Code in force (2026-10-28, S153, gap LW1). Built: version, hash, pin, signature, show and verify, and the | row | LW1 LW4 |
| 140 | The city: the society layer (r | Rulings cite the Code (2026-11-06, S154, gap LW1). Built: code on a ruling, required when a report is upheld. | row | LW1 LW6 |
