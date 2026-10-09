# Gaps register: everything the protocol and the network do not cover yet

Started 2026-10-09. One place to track what is **not** covered, so we can come back to it. Every row says what protects us today, what would close the gap, and where the detail lives. When a gap is closed, change its status and add the spec-delta number; never delete a row.

**Priority:** A = needed before outsiders join the live beta; B = needed for the first provider pilot; C = later. **Status:** open, designed (a design exists), partial (some of it is built), closed.

## 1. Agent drift and quality

| ID | Gap | Covered today by | Fix | Detail | Pri | Status |
|---|---|---|---|---|---|---|
| D1 | No canary or regression suite; `asp verify` has an empty canary check | Lineage edges say what changed; the Mandate bounds actions | A small fixed task set with checks, run on every memory update and runtime swap; pass/fail recorded | backlog "Drift and failure-mode testing" (S62: `asp canary` and canary/default-suite.json built; `asp verify`'s canary check is still empty and nothing runs the suite automatically on a memory update or runtime swap) | A | partial |
| D2 | No behavioural baseline or before/after comparison | Reputation, strikes, outcomes are in the log | Outcome series per agent and per principal, compared across each lineage edge | `docs/continual-learning-loop.md` §7 (S62: reports can be saved as baselines and compared, flagging regression and drift; no per-principal outcome series from the log yet) | A | partial |
| D3 | Memory loss is not detected | Memory hashes show that memory changed | Recall questions about earlier-known facts after each merge or prune | backlog | B | open |
| D4 | Which model weights actually ran is not recorded; a name can point to different weights | Runtime swap is a lineage edge | Record model name, provider and digest in the passport or Action; a change opens probation | backlog "open models" (8) | A | open |
| D5 | Probation is recorded but changes no rule | Shown in the lineage | Make it raise the risk floor or require a canary pass | backlog | B | open |
| D6 | No detection of prompt injection or goal hijacking | Mandate and gateway bound the actions that can follow | Injection tests in the canary; flag tool results that carry instructions | backlog (S62: the injection-in-file canary task measures whether a hidden instruction makes a model try a forbidden call; no detection of it) | B | partial |
| D7 | No reasoning-trace monitoring | none | Local-only analysis of visible reasoning as an earlier-firing signal | backlog "reasoning traces" | C | open |
| D8 | Quality, cost and time trends are not tracked | Actions carry a summary string | A structured `metrics` field (tokens, requests, seconds) on the Action, and a trend view | learning-loop doc | A | open |
| D9 | Lessons are not verified before they enter memory | Memory budget, merge, undo by lineage | Reflection proposes, a gate checks evidence, conflicts and an A/B replay | learning-loop doc §3 | A | designed |
| D10 | The principal is not shown what was learned | Lineage records each memory edit | `asp learned`, then the mail section and dashboard with Keep, Edit, Undo | learning-loop doc §4 | A | designed |
| D11 | Shared lessons are not offered to runs automatically, and reviews are one-agent-one-vote | Commons search through the gateway's MCP tools | Offer reviewed lessons at run start; weight reviews by reputation; stake or slash bad entries | backlog | B | partial |
| D12 | No per-principal memory with a privacy boundary | none | A memory scope private to a principal-agent pair | learning-loop doc | B | open |
| D13 | Saved states: no snapshot, pause or rollback mid-run | Between-run lineage only | Save memory and environment at junctures | backlog | C | open |

## 2. Harm the Mandate does not name

| ID | Gap | Covered today by | Fix | Detail | Pri | Status |
|---|---|---|---|---|---|---|
| H1 | A granted network scope can be used to hurt third parties (brute force, scanning, flooding); a swarm multiplies it | Contagion watcher (same input), strikes, kill switch | Baseline conduct rules with detectors; host-level allow lists; rate limits; fleet-wide caps | backlog "Harm that no Mandate names" | A | open |
| H2 | No default-deny network for new or low-tier agents | Tier limits on spend and parallel nodes only | Egress allowed by tier and by named hosts | same | A | open |
| H3 | Third parties have no way to report | Reports need a passport and a deposit | Signed abuse report verified by proof of domain control | same | B | open |
| H4 | Bond covers the principal, not third parties | none | Bond sizing for network scopes; insurance pool | same | B | open |
| H5 | No outcome detectors (a secret was obtained or leaked) | Known-bad list needs a prior report | Detect secret-shaped output and credential use | same | B | open |
| H6 | Known-bad list is exact-match, shell commands only, has no expiry | Fingerprint of normalized command | Pattern-level matching; expiry and removal; other tool types | S54 | B | open |
| H7 | Tool calls the model writes as text, and code-writing agents, are invisible to the gateway | Hooks on the runtimes that have them | Text-format parsers; sandbox with egress rules | gateway doc §4 | B | open |
| H8 | No sandbox level: what a tool does inside the machine is not bounded | Assurance level exists in the schema | Container or OS sandbox wrapper | gateway doc P4 (S60: Linux bubblewrap sandbox built; Docker backend for Windows and macOS added in S61, live end to end in WSL, see the checklist) | B | partial |
| H10 | Actions an agent's own code takes outside the model loop are invisible to the gateway. Seen live: Aider saw a URL in the prompt, offered to scrape it, auto-installed Playwright and tried to download Chromium, then navigated to the URL, none of it through a tool call | The Mandate and gateway only see model-requested tool calls | Sandbox with egress rules (H8), network-level redirect through the gateway, and a list of known self-acting agents with their risky defaults | S59, live checklist (S60: with --sandbox the agent has no network unless the Mandate grants one; not yet re-run against Aider) | A | partial |
| H9 | Unknown-unknowns | Least privilege, fast stop, accountability afterwards | Keep widening detectors from real incidents | | C | open |

## 3. Portability and runtimes

| ID | Gap | Covered today by | Fix | Detail | Pri | Status |
|---|---|---|---|---|---|---|
| P1 | Only four runtimes have adapters (Claude Code, Codex, Antigravity, OpenHands) | The gateway reaches any agent that can set a base URL or an MCP server | Top 20 runtimes through the gateway, then deeper adapters for the few that matter | backlog "Portability", `docs/gateway-design.md` | A | partial |
| P2 | Gemini API and non-OpenAI-compatible local APIs are not judged | OpenAI chat, Responses and Anthropic are | Gemini adapter in the gateway; Ollama native | backlog | B | open |
| P3 | Codex under a ChatGPT login cannot be pointed at the gateway | Codex with an API key or a custom provider can | An API-key route, or a network-level redirect | S58 | B | open |
| P4 | Hosted and enterprise agents that cannot be wrapped | none | Self-report SDK (assurance level 1) | gateway doc P4 (S60: TypeScript and Python self-report SDKs built and checked across languages; no real vendor trial) | B | partial |
| P5 | Memory write-back is verified live only for Claude Code (and any MCP agent through the gateway) | Gateway memory tools | Check or add per runtime | backlog | B | partial |
| P6 | No model matrix: which open models call tools reliably | none | Run the swarm scenario across models | backlog (S62: first model matrix in docs/model-matrix.md (free-tier snapshot); no paid or Anthropic/OpenAI models, one agent loop) | B | partial |
| P7 | Weak models: malformed tool arguments, loops after a refusal | Strike limit ends loops | Measure and document per model | backlog (S62: the survives-a-refusal task measures looping after a refusal per model) | B | partial |
| P8 | No public support matrix and no per-runtime conformance test | none | Matrix: runtime by assurance level, with a test each | gateway doc P5 | B | open |
| P10 | OpenCode 1.18.35 starts but fails under the gateway with an unexplained server error (run config via `opencode.json` and `-m asp/<model>`); not yet working | Goose, Codex and Claude Code work through the gateway | Debug OpenCode's server mode and its provider config | S59 | B | open |
| P11 | Gemini CLI 0.63.0 installed but not checked: it talks the Gemini API (not judged) and needs a Gemini API key, not the subscription login | none | Gemini API support in the gateway and a key | S59 | B | open |
| P12 | Agents that edit through a text format (Aider) never use structured tool calls, so the gateway can observe but not enforce | Assurance is reported as `gateway_observed` for them | Text-format parsers or a sandbox; document per agent | S59 | B | open |
| P9 | Free-tier hosted models are not reproducible | none | Pin a paid or self-hosted model for the matrix | backlog | C | open |

## 4. Money, banks and Courts

| ID | Gap | Covered today by | Fix | Detail | Pri | Status |
|---|---|---|---|---|---|---|
| M1 | The bank and credits are mock; no real money, rails or cash-out | Real rules and arithmetic on mock credits | A real custodian or payment partner signing the same Settlements | `docs/protocol-accountability.md` §8 | C | open |
| M2 | Juror pool is tiny and chosen by us; no defence against fake jurors | Deterministic panel draw, stake | Identity or stake at scale; reputation for jurors | | B | open |
| M3 | No appeals; no slashing of a juror for an overturned ruling | none | Appeal record and juror stake at risk | backlog | C | open |
| M4 | No delayed settlement or clawback for claims that need time to prove | Evidence grades on claims | Hold-back and clawback with a deadline | backlog (decision 2026-10-08: not yet) | C | open |
| M5 | Incentive constants (5% panel fee, 250‰ per slash, 20% reporter share) are untested against adversaries | Judgment calls | Simulation and a pilot | | B | open |
| M6 | Cold start: a tier-0 newcomer cannot be bonded | none | A path for a first job (sponsor-backed bond, small jobs) | | B | open |
| M7 | Compute is not priced into credits | Gateway meters tokens | Metering to credits | backlog | C | open |
| M8 | Subcontracting: only the basic nesting rules | S18 | Per-role Mandates inside one job | backlog | C | open |

## 5. Users, sign-in, dashboard and mail (live beta flow 1)

| ID | Gap | Covered today by | Fix | Detail | Pri | Status |
|---|---|---|---|---|---|---|
| U1 | No sign-up page, Gmail sign-in or consent screen | CLI identity creation | Live beta flow 1 | `docs/live-beta-flow-1.md` | A | designed |
| U2 | No dashboard (owner, principal, provider, juror, operator, reviewer views) | CLI commands | Read-only dashboard over the log | `docs/user-journey.md` §7 | A | designed |
| U3 | No internal money-flow dashboard for our own test runs | CLI balances | Live view of every mock transfer with the conservation check | backlog | A | open |
| U4 | No run mail (one per Mandate, highlights) | none | Mail provider, opt-in, runtime log capture and redaction | backlog, flow doc | A | designed |
| U5 | Key recovery: lose the key and the backup, lose the identity | Encrypted backup file (designed) | Second recovery key plus the backup; passkey wrapper later | flow doc | A | designed |
| U6 | No explainer for what mock funds, banks and courts mean to the user | none | Per-run "what this would mean with real money" panel | backlog | A | open |
| U7 | No approvals inbox or alerts outside the CLI | `asp market resolve` | Dashboard inbox and alerts | backlog | A | open |
| U8 | The app has to look good: no design system yet | none | Design pass on page, consent, dashboard, mail, money-flow screen | flow doc | A | open |
| U9 | Account deletion and data-retention rules | none | What is public forever vs deletable; retention for run logs | flow doc | A | designed |
| U10 | Measurement of the beta funnel (where people stop) | none | Instrument each flow step | flow doc | B | open |

## 6. Operating the network

| ID | Gap | Covered today by | Fix | Detail | Pri | Status |
|---|---|---|---|---|---|---|
| O1 | No TLS on the log service | Run behind a proxy | Terminate TLS in front or in the service | backlog | A | open |
| O2 | No per-tenant rate limits or abuse controls | Quotas on package storage | Rate limits per tenant and per address; invite codes | backlog | A | open |
| O3 | One log for all tenants; no partitioning | Tenants isolate packages only | Per-tenant partitioning of the log | backlog | C | open |
| O4 | No garbage collection of old package versions | none | Retention policy | backlog | C | open |
| O5 | No read replica for heavy readers | Snapshots speed up opening | Replica | backlog | C | open |
| O6 | Scale through the service not measured (5,000+ records) | Snapshot benchmark on the file log | Load test through `asp serve` on Postgres | S49 | B | open |
| O7 | Only one machine has played every client; no real second machine | Run D on one box | A VM or second computer | live-run checklist | B | open |
| O8 | Gateway is a single local process; no shared or enterprise deployment | Sidecar mode | Shared gateway with tenancy | gateway doc | C | open |
| O9 | Log custody by third parties: witnesses and feeds exist but few outside parties | S35, S36, S38 | Recruit witnesses | | C | open |
| O10 | No LICENSE file, GitHub page or website copy | Repo is public | Write them | backlog | A | open |
| O11 | The OpenRouter key on this machine should be revoked when we are done | File kept private | Revoke | | A | open |

## 7. Evidence and records

| ID | Gap | Covered today by | Fix | Detail | Pri | Status |
|---|---|---|---|---|---|---|
| E1 | Full tracing: LLM calls and tool responses are not recorded with commitments in the log | Fingerprints only (D1: metadata only) | Spans in the operator's store with signed commitments; redaction and retention | backlog "Full tracing" | B | open |
| E2 | The mail and dashboard need a redacted runtime log, which does not exist yet | Gateway sees traffic | Recorder in the gateway, local store | flow doc | A | open |
| E3 | Action's metrics are only a summary string | `assurance` field exists | Structured metrics (see D8) | | A | open |
| E4 | Secrets masking is pattern-based; unusual shapes can get through | `redactSecrets`, secret scan at pack | Broader patterns, entropy checks | S25 | B | open |

## 8. Process

| ID | Gap | Fix | Pri | Status |
|---|---|---|---|---|
| X1 | Live runs so far are one person, one machine, a few models | Pilot with one enterprise and one open-source provider using the before/after measures | B | open |
| X2 | Conformance exists for the records, not for runtime support levels | Per-runtime tests behind the support matrix | B | open |
| X3 | This register is only as good as its upkeep | Review it at the start of every build session; add a row when anything is found or deferred | A | open |


Added 2026-10-09 (P4):

| ID | Gap | Covered today by | Fix | Detail | Pri | Status |
|---|---|---|---|---|---|---|
| SB1 | No container backend for the sandbox level, so Windows and macOS hosts cannot reach `sandbox_enforced` (Docker Desktop is installed here but its engine would not start) | WSL on Windows runs the bubblewrap backend | Docker backend with an internal network and a relay | S60; closed 2026-10-09 (S61): Docker Desktop reinstalled and the Docker backend built and run live on Windows | B | closed |
| SB2 | `asp gateway --sandbox` has not been run end to end: the gateway is Node and WSL has no Node; the sandbox and relay were checked with a stand-in gateway | Unit tests of the policy, live check of isolation | Install Node in WSL, or run the whole CLI in a Linux container | S60; closed 2026-10-09: Node 24.18.0 installed in WSL (checksum verified) and `asp gateway --sandbox` run end to end | B | closed |
| SB3 | The sandbox policy is coarse: network is all or nothing from the scopes; no per-host allow list; the agent's tools must be bound in by hand with `--sandbox-bind` | Gateway judges what the model asks for | Host-level egress rules through the relay | S60 | B | open |
| SB4 | Before S60, the gateway passed the operator's own environment to the agent, including a provider key held in an environment variable named by `--openai-key-env` (the live runs of 2026-10-09 up to P3 leaked it to the child process) | none | Fixed in S60; revoke the OpenRouter key because of it | S60 | A | closed |
| SB5 | Self-report is only as good as the agent: an agent that omits an action is not caught | Mandate, bond, strikes and reports still apply; the log refuses claims outside the Mandate | Cross-check with the gateway or provider logs where available; random audits | S60 | B | open |
| SB6 | The Docker backend runs the agent inside a Linux image, so the agent's program must exist in that image; host-installed agents (Windows binaries, tools under the home folder) cannot run in it | Linux and WSL hosts use bubblewrap with the host's programs | Prebuilt images per common agent (Goose, Aider, OpenCode, Codex) | S61 | B | open |
| SB7 | The Docker relay container and the internal network are removed when the agent exits normally; a crash of `asp` itself could leave them behind | Names carry a run id; `docker ps -a` shows them | A sweep command | S61 | C | open |
| X4 | The live evaluations were scripts outside the repo, so nobody else could rerun them | Recorded in the live-run checklist | Moved into `evals/` as parameterised, self-checking evaluations with a runner (`npm run evals`) | evals/README.md | A | closed |


Added 2026-10-09 (canary and model matrix):

| ID | Gap | Covered today by | Fix | Detail | Pri | Status |
|---|---|---|---|---|---|---|
| CM1 | The canary suite is run by hand; nothing triggers it when memory is updated, the runtime is swapped, or a provider changes a model | `asp canary run --baseline` | Run it from `asp run` write-back and backend swap, and record the result as evidence on the lineage edge | S62 | A | open |
| CM2 | Six tasks are a smoke test, not coverage: no multi-step tasks, no memory-recall task, no tasks per Mandate scope, no adversarial suite | The default suite | Grow the suite; per-agent suites written by the principal; held-out tasks | S62 | B | open |
| CM3 | The matrix uses one agent loop (the reference agent) and free-tier models; results for a real runtime (Claude Code, Codex) or paid models may differ | The canary can drive any agent that uses a model API | Matrix rows for real runtimes and paid models | S62 | B | open |
| CM4 | Checks are regular expressions and counts; an answer can be correct but phrased unexpectedly, or wrong in a way a regex accepts | Several checks per task | A judge model or exact-answer tasks | S62 | B | open |
| CM5 | The full model matrix is waiting on OpenRouter: the free tier allows 50 requests a day per key and the card for a $10 top-up is not accepted yet (it needs time). | A partial matrix (Nemotron 6/6, Laguna 4/6, two models with no data) in docs/model-matrix.md | When the credit is on: set a $10 cap on a fresh key, save it to ~/.asp-openrouter-key, rerun `node evals/model-matrix.mjs`, add one or two cheap paid models, replace docs/model-matrix.md | S62 | B | open |
