#!/usr/bin/env node
/**
 * asp: the Agent Social portability tool.
 *
 *   asp identity new --kind human (--did <did> | --method did:key) [--sponsor <did>]
 *   asp identity new --kind agent (--did <did> | --method did:key) --sponsor <did> [--fleet <did>] [--purpose <text>]
 *     --did <did> uses a DID you already have (e.g. did:web:your-own-domain:...). --method did:key
 *     generates a fresh key and derives a self-certifying DID from it: no domain to bring, lose
 *     access to, or depend on anyone else for.
 *   asp identity show <did>
 *   asp identity copy <agent did> [--count <n>]
 *     Fleet isolation: makes n independently liable copies of an agent. Each is a fresh did:key agent with its
 *     own passport, key, ledger account and reputation, sponsored by the original's sponsor (whose key must be
 *     here), so one copy's slash or strike never touches another's balance. A copy starts at the original's
 *     CURRENT tier (a demoted agent cannot launder its record through copies; tier 0 cannot be copied).
 *   asp eval run [<scenario.json>] [--agents <n>] [--exploiters <n>] [--spare] [--real <backend>[:<model>][:exploit|honest] ...] [--out <report.json>]
 *     --real adds an agent on an actual runtime (claude-code, codex, antigravity, openhands), run through asp run --contract
 *     as its own independently liable copy; told to run the exploit command unless the role is honest.
 *     The evaluation harness (docs/stage-3-plan.md M5): runs a scenario through the real commands against a FRESH
 *     log in a temp folder (never your own), on a simulated clock, then prints measures read back from the log.
 *     One scenario kind exists, swarm-exploit (see scenarios/swarm-exploit.json): scripted agents work in parallel, some
 *     pick up an exploit one after another, a watcher reports, a scripted panel rules, the cohort is stopped.
 *   asp serve --db <postgres-url | local:<dir>> (--tokens <file> | --no-auth) [--port 8787] [--host 127.0.0.1] [--tls-cert <pem> --tls-key <pem>] [--rate-limit n] [--write-limit n] [--address-limit n] [--max-in-flight n] [--max-failed-auth n] [--trust-proxy] [--allow-plain-http]
 *     The ASP log service: one shared log behind HTTP (docs/spec-deltas.md S48). --db is a Postgres connection string
 *     or local:<dir> (a file log). Clients use it with ASP_LOG_URL=http://host:port and ASP_LOG_TOKEN=<token>; their keys
 *     stay local and the service re-verifies every record. --no-auth is only for a service on 127.0.0.1.
 *   asp serve suspend|resume --tokens <file> --tenant <name> [--reason <text>] | block|unblock --tokens <file> --address <ip> [--minutes n] [--reason <text>] | usage --tokens <file>
 *     What an operator does to a running service (it reads the tokens file and the block list <file>.blocked.json on each request, so no restart): a suspended tenant
 *     is refused with SUSPENDED; a blocked address with BLOCKED. The service counts each tenant's records and bytes in <file>.usage.json and refuses a write past the
 *     quota (--record-quota, default 100000, and --byte-quota-mb, default 256 on serve; per tenant on serve token; admins have none) with QUOTA_EXCEEDED.
 *   asp serve ... --packages <dir>   also stores each tenant's agent packages under <dir> (docs/spec-deltas.md S51).
 *   asp serve ... --known-bad <dir>   also holds the known-bad list (docs/spec-deltas.md S54): command fingerprints an upheld report found harmful.
 *   asp gateway --contract <id> --by <agent did> (--openai-upstream <base url> | --anthropic-upstream <origin>) [--openai-key-env NAME] [--anthropic-key-env NAME] [--max-strikes n] [--token-cap n] [--approval-wait s] [--port n] [-- <command> ...]
 *     Gateway P1 (docs/gateway-design.md): runs any agent command under the contract's Mandate. The command's OPENAI_BASE_URL and
 *     ANTHROPIC_BASE_URL point at a local proxy that removes tool calls the Mandate does not allow from the model's reply before the
 *     agent sees them (streams are relayed live, each tool call held until it is judged), holds calls on gated scopes for the principal's signed
 *     answer, counts strikes, stops on probing or when the contract ends or is revoked, and reports the Action (assurance gateway_enforced) when it finishes.
 *     With a canary target for the agent on backend "gateway" (asp canary setup --backend gateway ...), the memory the gateway writes back is tested first, as in asp run;
 *     asp orchestrate does the same on the backend it runs.
 *     --capture <file> writes the agent's standard output to a file (used by asp canary).
 *     P4: --sandbox [--sandbox-backend auto|bwrap|docker] [--sandbox-image <image>] [--project <dir>] [--sandbox-bind <path>[:rw] ...] runs the command in a sandbox
 *     (bubblewrap on Linux and WSL; Docker elsewhere, where the command runs inside --sandbox-image, default python:3.13-alpine, and must exist in it):
 *     no network unless the Mandate grants shell.network or web.read (it reaches the gateway through a relay), the system read-only, home hidden,
 *     project read-only unless the Mandate grants repo.write, environment cleared; the Action then carries assurance sandbox_enforced.
 *     The provider keys named by --openai-key-env / --anthropic-key-env are always removed from the agent's environment.
 *     P2: the gateway also serves MCP at <url>/mcp/asp (asp_memory_list/read/write/search, and asp_commons_search/show/cite when
 *     ASP_LOG_URL points at a service with a commons) and writes mcp.json for the agent (ASP_MCP_CONFIG). --package <dir> loads the agent's
 *     memory from its package and writes what it saves back, merged and budgeted, as a signed lineage update. --mcp <name>=<https url> |
 *     <name>=stdio:<command> [args] (repeatable) puts the agent's other MCP servers behind the gateway: every tools/call is judged as mcp.<name>.<tool>.
 *   asp canary setup --agent <did> --backend <runtime> --target <file | package:claude-code> [--canary-gate warn|block] [--trials n] [--suite file] [--package <pkg>: take the baseline now] | baseline --agent <did> --backend <runtime> --package <pkg> | evidence <package>
 *     The canary as a gate (docs/gaps-register.md CM1): with a target set up for an agent and a backend, asp run applies its memory update or runtime swap to a copy of the
 *     package, runs the canary suite on the copy and compares it with the baseline; the result is recorded in the log as a certificate attestation about the new memory
 *     and cited in the lineage edge (change.gates). With --canary-gate block a regression stops the change from being written back. --no-canary skips it. asp verify shows how many
 *     recorded changes cite a canary result; asp canary evidence <package> lists them with their verdicts. Targets use {package} so the canary sees the agent's memory.
 *   asp canary run --target <file | openrouter:<model> | groq:<model> | cerebras:<model> | gemini:<model>> [--suite <file>] [--trials n] [--only id,id] [--out report.json] [--baseline report.json] | compare <baseline> <current> | list
 *     The canary suite (docs/gaps-register.md D1, D2): small fixed tasks with checks, run against an agent through the gateway in a throwaway home.
 *     A report saved with --out is a baseline; running again with --baseline (or asp canary compare) flags a task that used to pass and does not
 *     (REGRESSION) and growth in tokens, tool calls, time or blocked attempts (drift). The default suite is canary/default-suite.json; the reference
 *     agent (src/reference-agent.mjs) lets any OpenAI-compatible model be tested: --target openrouter:<model>.
 *   asp mail preview|queue --contract <id> [--to <address>] [--run-log <file|folder>] [--link-base <url>] [--html] [--again] | pending | watch [--once] [--interval <s>] [--to <address>] | address set <did> <address> | address list
 *     The end-of-Mandate mail (docs/live-beta-flow-1.md step 8, gap E8): one mail per Mandate with the highlights from the log (what was asked, allowed, done,
 *     blocked, approved, what changed in memory, how it ended and what moved) and, when the gateway kept one, the checked run log. preview prints it (--html
 *     prints the HTML body); queue writes an .eml, .html and .txt to <home>/outbox and marks the Mandate as mailed (a second queue needs --again);
 *     pending lists ended Mandates and alerts not mailed yet. watch queues them as they happen (once with --once): the end mail when a job settles, and an
 *     alert mail at once for a kill (the kill switch's slashed settlement), an upheld report against the agent, or a Mandate that expired while the job still runs.
 *     The mail goes to the address set for the principal (asp mail address set), or --to. Nothing is sent: delivery to a mail provider is not built.
 *   asp known-bad add --report <upheld-report> --by <did> [--fingerprint <asp://shell-command#sha256:...> | --all] [--note <text>] | list
 *     The list is the log service's (ASP_LOG_URL; adding needs an admin token) or <home>/known-bad.json. Without --fingerprint the
 *     candidates are the shell commands shared by 3+ agents (asp watch) that include the reported job. asp run --contract gives the
 *     list to the pre-call hook (Claude Code, Antigravity), which blocks a matching command before it runs and counts it as a blocked
 *     attempt. Codex and OpenHands have no pre-call hook: the list is not enforced there, and the run says so.
 *   asp serve ... --commons <dir>   also hosts the commons: shared knowledge with citations and review (docs/spec-deltas.md S52).
 *   asp commons add <file> --by <agent> --title <t> [--tag a,b] [--contract <id>] | list [--tag --q --status] | show <id> | review <id> --by <did> --verdict endorse|dispute [--note] | cite <id> --by <did> --context <text>
 *     Needs ASP_LOG_URL/ASP_LOG_TOKEN. Entries, reviews and citations are signed by their authors' keys and checked against the log.
 *     --contract refuses to share unless that job's Mandate has learning.share_to_commons. An entry is "reviewed" after two other
 *     agents endorse it, "disputed" when disputes match or outnumber endorsements.
 *   asp package push <package> --name <n> | pull <n> --out <dir> [--merge] | list | delete <n>   [--tenant <t>: admin reads another tenant]
 *     Needs ASP_LOG_URL/ASP_LOG_TOKEN. Uploads are verified by the service and refused when they would overwrite a newer copy
 *     (If-Match on the last etag seen); pull --merge folds your copy's memory into the service's (three-way) and re-signs.
 *   asp serve token --tokens <file> --tenant <name> [--role tenant|admin] [--quota-mb <n>]
 *     Creates a bearer token for a tenant, prints it once and stores only its hash in <file>. Only an admin may mint credits.
 *   asp watch [--min-agents <n>] [--window <seconds>] [--draft-by <did>] [--all]
 *     The contagion watcher (docs/stage-3-plan.md M3): scans the log's Action records for a technique spreading
 *     between different agents. Same-input: one tool-call input fingerprint reported by n or more different agents
 *     within the window (default 3 agents, 600 s), counting only Actions that used a risky scope (--all counts every
 *     one). Same-probe: the same scope refused by the pre-call hook for n or more agents. Prints each cluster with
 *     the contracts involved and whether they can still be reported; --draft-by <did> adds the report commands.
 *     Exit 1 when it finds something, so it can run in a loop. A lead for a report, not a verdict.
 *   asp identity export <did> [--out <file>]
 *     Writes the DID's current signed passport record, to send to a registry operator.
 *   asp identity register <passport.json> [--trust-unverified]
 *     Admits someone else's signed passport into this log. A did:web passport is accepted only if the
 *     DID's own document (https://<domain>/.well-known/did.json, or the path form) publishes every key the
 *     passport declares; a did:key passport is checked by the log itself (the DID is the key). The fetch is
 *     an admission check here, never part of the log (replay stays offline). --trust-unverified skips it and
 *     says so; other DID methods are refused without it.
 *     Includes `reputation` (tier, slash count) for an agent that's ever been slashed as a Bond's
 *     backer, or that has a declared tier to fall back on — derived, not itself a signed record.
 *   asp pack --runtime claude-code|codex|openhands --agent <did> [--project <dir>] [--include-user] [--out <dir>]
 *     Includes memory/PENALTIES.md if the agent has ever been slashed and self-signed the lineage
 *     entry for it (asp market settle does this automatically) — every runtime materializes it into
 *     the agent's own memory alongside everything else it packed.
 *   asp verify <package> [--json]
 *   Memory (asp run and asp orchestrate; docs/spec-deltas.md S50): what a run learns is merged three-way into the package's memory,
 *   so two runs of one agent never overwrite each other (a topic file both changed is kept side by side, an index is the union of
 *   its lines), and the result is kept within a budget: --memory-max-files (default 200), --memory-max-bytes (1 MiB),
 *   --memory-max-index-lines (200). Over budget, the least recently changed topic files are pruned first, and the lineage update says so.
 *   asp run <package> --backend claude-code|codex|openhands [--project <dir>] [--prompt <text>] [--model <m>] [--dry-run] [--no-write-back] [--contract <id>]
 *     --model <m> --endpoint <url> [--api-key-env <NAME>]: run an open-weight model served from an
 *     OpenAI-compatible endpoint (Ollama, vLLM, ...) on OpenHands or Codex. --api-key-env names the
 *     environment variable holding the key; local servers get a placeholder.
 *     After a successful run, a backend swap and any memory the agent changed are recorded in the
 *     package as signed lineage updates, and the manifest is re-signed.
 *     --contract: the compliance bridge (docs/backlog.md). If the adapter supports it (Claude Code
 *     does, via --output-format stream-json), real tool-call scopes seen during the run are
 *     collected and reported as an asp.action/v0.2 record against that contract's live Mandate —
 *     not self-declared after the fact. The first call outside the Mandate is a violation: the
 *     process is stopped (kill switch) and the job settles with full fault (escrow back to the
 *     principal, the bond slashed). On Claude Code a pre-call hook also blocks such a call before
 *     it runs. A blocked call did no harm, so it is a signed strike (the action record's
 *     blocked_attempts), not the full settlement: the run is stopped only after --max-strikes
 *     blocked attempts (default 3) or when an out-of-scope call actually ran. The action record for
 *     a violation is refused, so it can never get laundered into a clean-looking log.
 *   asp orchestrate <package> --backend <runtime> --task <text> [--task <text> ...] [--project <dir>]
 *                   [--max-parallel N] [--model <m>] [--dry-run] [--isolate]
 *     --isolate: each node runs as its own independently liable copy (asp identity copy), and its node grant is
 *     issued by that copy, so a slash on one node cannot reach another's account.
 *     Runs one task per node, in parallel, each under its own signed, short-lived delegated key
 *     (an asp.node/v0.2 record; see spec/schemas/node.schema.json). Nodes only write memory; a single
 *     consolidation step then merges what every node learned into one signed lineage update for the
 *     agent, deduplicating identical lines and keeping conflicting ones side by side rather than
 *     silently discarding either. This is the spec's Learning-section pattern: "nodes only write
 *     experience... a consolidation step... produces one update to the person".
 *   asp log snapshot
 *     Writes a snapshot of a local log's state so the next command loads it instead of replaying every record (the log
 *     snapshots itself every ASP_SNAPSHOT_EVERY records, default 1000; 0 turns that off). It is trusted only as far as the log's
 *     hash chain vouches for it.
 *   asp log verify [--full] [--min-witnesses <n>]
 *     --full also replays the whole local log from genesis, ignoring any snapshot, and says whether the state a snapshot
 *     loaded matches (a snapshot can be audited at any time).
 *   asp log export --out <file> [--since <seq>]
 *     Writes the log's records (and the minted-credit totals a replica needs) for another party to replay.
 *   asp log import <file>
 *     Replays an export into this log, re-verifying every record; refuses a log that has diverged.
 *   asp log witness <export file> --as <witness did> [--out <file>]
 *     A witness: imports the export into a replica log (<home>/replica), and only if the replay reproduces the exported head,
 *     signs a checkpoint of it (saved in its checkpoints.ndjson, and to --out). Use a did:key identity.
 *   asp log cross-check <source>...
 *     Compares every checkpoint this home holds (its own, its witnesses') with the feeds others saw (files,
 *     folders, https URLs). The same signer with two different hashes at one seq is a signed proof of a fork
 *     (a host or operator that showed different readers different histories): printed with both entries,
 *     exit 1. `witnesses add` runs the same check before it accepts a feed.
 *   asp log publish --to <dir> [--with-export] [--seen]
 *     --seen also publishes the witness checkpoints this home collected, so others can cross-check what you saw.
 *     Copies this home's signed checkpoints that are not published yet into <dir>/feed.ndjson (append-only),
 *     for anyone to read: commit the folder to a public git repo, or serve it from any static host. A witness
 *     publishes its own the same way. --with-export also writes <dir>/export.ndjson, the whole log, so others
 *     can replay it themselves: it makes the log's contents public, so it is never done unless you ask.
 *   asp log witnesses add <witness checkpoints file | folder | https URL>
 *     A folder or URL means a published feed (feed.ndjson inside). Adding the same source again refreshes it;
 *     it fails if an entry published before has disappeared (a rewritten feed).
 *     Keeps witness checkpoints beside this log. `log verify` re-checks each against an independent replay
 *     (a witness that saw different history fails), and with --min-witnesses n needs n distinct witnesses.
 *   asp log checkpoint --as <did>
 *     Signs {seq, log_hash, signed_at} with <did>'s key and appends it to checkpoints.ndjson (decision
 *     D5): a portable, externally-checkable proof of the log's state at that point, published nowhere
 *     by asp itself. `log verify` re-checks every stored checkpoint against an independent replay.
 *
 *   asp credits grant --to <did> --amount <n>
 *     Bootstraps a DID's credit balance. Local, unsigned, not part of the tamper-evident log — a
 *     closed-loop ledger with no cash-out still needs some way to get the first credits in (MOCKS.md #13).
 *   asp credits balance <did>
 *
 *   Assignment mode (one performer bidding directly):
 *   asp market intent --by <did> --purpose <text> [--criteria <text> ...] --budget <n> --deadline <iso> [--verification deterministic|principal|arbiter] [--review-deadline <iso>] [--verifier <did>]
 *     --review-deadline (principal-mode verification only) is mirrored onto the Contract by
 *     `asp market contract`, and lets `asp market settle --basis silence` close the job once it's
 *     passed, without the principal ever signing an acceptance.
 *   asp market offer --by <did> --intent <id> --price <n> --plan <text> --eta <iso> [--bond-offered <n>]
 *
 *   Allocation mode (several Proposals compete for one Call; a panel member picks one):
 *   asp market call --by <did> --purpose <text> --budget <n> --panel <did> [--panel <did> ...] [--criteria <text> ...] --deadline <iso>
 *   asp market propose --by <did> --call <id> --plan <text> --budget-asked <n> [--team <did> ...]
 *   asp market allocate --by <did> --proposal <id> [--verdict <text>]
 *     `--by` must be one of the Call's panel DIDs (the log rejects others: not_on_call_panel).
 *
 *   asp market contract --principal <did> --bank <did> [--performer <did>] [--parent-contract <id>]
 *                        (--intent <id> --offer <id> | --call <id> --proposal <id>)
 *     Issued by the principal, co-signed by the performer. In assignment mode, purpose/criteria/
 *     deadline/verification come from the Intent and price from the Offer (performer defaults to the
 *     Offer's issuer). In allocation mode, they come from the Call and the allocated Proposal
 *     (performer defaults to the Proposal's team[0]; --verification, since Call has none).
 *     --parent-contract: subcontract nesting — the parent's own performer becomes this contract's
 *     principal (checked, not just recorded), funding it from its own balance; no automatic netting
 *     back to the parent's escrow. The parent must exist and not already be Settled.
 *   asp market bond --contract <id> --backer <did> --amount <n> --escrow-payer <did> --escrow-amount <n>
 *     Locks real credits: debits both the escrow payer and the backer for real (rejects with
 *     insufficient_balance rather than starting a job uncovered).
 *   asp market mandate --contract <id> --principal <did> --performer <did> [--scopes <s> ...] [--network-host <host> ...] [--spend-cap <n>] [--gate <scope> ...] [--irreversible checkpoint|forbid|allow] [--share-to-commons]
 *     --gate names granted scopes the irreversible policy applies to: with checkpoint (the default) a
 *     call to one needs the principal's approval first (asp run holds the call, raises a Checkpoint, and
 *     waits for asp market resolve; --approval-wait <seconds>, default 600, then it is refused); with
 *     forbid it is blocked outright; with allow it is ungated. Needs a runtime with a pre-call hook.
 *   asp market checkpoint --contract <id> --by <performer> --question <text> [--kind before_irreversible|plan|high_impact|delivery] [--summary <proposed action>] [--expires <iso>]
 *   asp market resolve --contract <id> --by <principal> --verdict approved|corrected|picked|expired [--correction <text>] [--about <checkpoint id>]
 *     The principal's signed answer to an open Checkpoint; corrected (with the reason) is how a request is refused.
 *   asp market deliver --contract <id> --by <did> --summary <text> [--claim "<text>::<measured|simulated|predicted>[::<uri>=<sha256>]" ...]
 *     Also redelivers after a reject (the lifecycle's own redelivery_available guard applies; at
 *     most one redelivery). Each --claim says what the Delivery asserts and how well established it is.
 *   asp market verify --contract <id> --by <verifier> --verdict confirmed|partly_confirmed|not_confirmed [--grade <claim index>=<grade> ...] [--about <id>]
 *     Outcome verification: the verifier named on the contract (asp market intent|contract --verifier
 *     <did>; never the principal, the performer, or anyone they sponsor) re-checks the Delivery and
 *     grades each claim (measured, simulated, predicted, unverified). With a verifier named, the log
 *     refuses to accept (or settle on silence) a Delivery without a confirming verification.
 *   asp market accept|reject --contract <id> --by <did> [--about <id>] [--reasons <text> ...]
 *     A reject moves the job to Disputed, open to either a redelivery or a ruling.
 *   asp market juror register --by <did> --stake <n>
 *     Self-registers (or re-registers, chaining onto the last one) to be eligible for random draw
 *     onto a Courts ruling panel, staking real credits from the ledger. A lower stake returns the
 *     difference; 0 withdraws.
 *   asp market juror show <did>
 *   asp market report --contract <id> --by <did> --reasons <text>
 *     A whistleblower report on a RUNNING contract, by any DID with a passport that is not a party (or sponsored
 *     by one). Locks a deposit equal to the panel fee (5% of the price).
 *   asp market report-rule --report <id> --by <juror> [--cosign-by <juror> ...] --verdict upheld|dismissed
 *     A majority of the panel drawn for the report (asp market panel draw --report <id>) rules. Upheld: the
 *     deposit returns, the accused's bond pays the jurors and gives the reporter 20% of what is left, and the
 *     contract must settle with full fault (settle defaults to it). Dismissed: the deposit pays the jurors.
 *   asp market cohort-stop --report <upheld report id> [--min-agents <n>] [--window <seconds>] [--spare]
 *     After an upheld report: finds the contagion clusters (asp watch) that include the reported contract and stops every
 *     running or checkpointed job in them with a revoked Settlement. The reported job settles with the full fault the
 *     ruling forces. The others stop without a ruling of their own: by default their escrow returns to the principal and
 *     their bond is SLASHED (they were running the same flagged pattern; the principal and the bank sign this). --spare
 *     returns their bonds instead.
 *     Needs each job's bank and principal keys here.
 *   asp market panel draw --contract <id> [--size <n>]
 *     Shows the panel a Disputed contract's ruling would draw — conflict-free (excludes the
 *     principal, the performer, and anyone they sponsor), deterministic (seeded from the rejection
 *     that opened the dispute, so it's reproducible, including by EventLog.verify()'s replay).
 *     Default panel size 3.
 *   asp market rule --contract <id> --by <did> [--cosign-by <did> ...] --verdict for_performer|for_principal|split --fault <did>=<permille> [...]
 *     A ruling on a Disputed job. If at least one juror is registered anywhere, the issuer plus
 *     cosigners must include a majority of the panel `panel draw` would show (panel_quorum);
 *     otherwise any neutral DID may rule, unchanged from the original mocked Courts (MOCKS.md #4).
 *   asp market settle --contract <id> --bank <did> --basis accepted|ruling|revoked|silence
 *                      [--escrow-released <n>] [--bond-returned <n>] [--bond-slashed <n>] [--fees <n>]
 *                      [--pro-rata <permille>] [--cites <id>] [--principal <did>] [--agent-permille <n>]
 *     The performer's passport sets the earnings_split (kept share, snapshotted at Bond time); the rest of its pay goes
 *     to its sponsor. --agent-permille only restates it (earnings_split_mismatch if it differs).
 *     --fees comes out of the same escrow, on top of --escrow-released, and credits to a local mock
 *     platform account (EventLog.PLATFORM_DID) standing in for a real platform/Insurer recipient.
 *     `silence`: requires the Contract to carry a review_deadline (from a principal-mode Intent)
 *     that the settlement's own timestamp is already past — no --cites needed, since no acceptance
 *     was ever signed. Distributes exactly what the Bond locked: pay to the performer, unreleased escrow back to the
 *     more than was locked (over_release). `revoked` is cosigned by the principal; `accepted`/`ruling`
 *     cite the acceptance or ruling Attestation (defaults to the chain's latest one). For `ruling`,
 *     omitting --escrow-released/--bond-slashed derives them from the cited ruling's fault on the
 *     performer — the formula the log itself enforces (settlement_mismatches_ruling otherwise), so
 *     you don't have to hand-compute it. --bond-returned still defaults to 0 either way.
 *     A slash also self-signs a lineage penalty for the backer, if its key is available locally
 *     (see `asp pack`'s note on memory/PENALTIES.md).
 *   asp market action --contract <id> --by <did> --scopes-used <s> [...] [--summary <text>] [--late <time of the last activity>]
 *     --late marks a report made after the job ended, for the last stretch of activity before the stop (docs/spec-deltas.md S80): the log accepts it on a settled job, from the performer, within ten minutes of the settlement, if the activity ended no later than thirty seconds after it. The gateway does this by itself when its report finds the job ended.
 *     The compliance bridge, by hand (see `asp run --contract` for automatic emission from real
 *     tool calls). Checked against the contract's live Mandate; refused if any scope wasn't granted.
 *   asp market show <contract>
 *     Prints the job's state, its full chain, and (once bonded) the ledger lock for that contract.
 *
 * Global: --home <dir> (default $ASP_HOME or ~/.asp), --user-home <dir> (the home dir holding .claude/.codex; default ~).
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { REFERENCE_AGENT, compareReports, formatComparison, formatReport, runCanary, type CanaryReport, type CanarySuite, type CanaryTarget, type RunCli, PROVIDERS, providerTarget } from "./canary.ts";
import { DEFAULT_SWARM, formatSwarm, runSwarm, type RealAgent, type SwarmScenario } from "./eval.ts";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createLogServer, hashToken, postgresHandle, UsageStore, type Tenant } from "@agent-social/asp-log";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  b64urlDecode, b64urlEncode, cosign, createRecord, didKeyFromPublicKey, didOf, fetchSmallText, passportKeysNotPublished, publicKeyFromDidKey, publicKeyFromSeed, randomSeed, sha256Id,
  type AspRecord, type Signer,
} from "@agent-social/asp-core";
import { fetchRetry, RunRecorder, buildAlertMail, buildMandateMail, collectMandateFacts, findAlerts, type MandateFacts, hashAfter, readRunLog, runLogArtifact,
  ADAPTERS, DEFAULT_MEMORY_BUDGET, Keystore, LocalLog, appendCheckpoint, enforceMemoryBudget, mergeMemoryInto, type MemoryBudget, openLog, type LogHandle, aspHome, diffTrees, finishPackage, isEmptyDiff, packDirectory,
  findContagion, findEquivocations, readCheckpoints, type WatchAction, type LogCheckpoint, redactSecrets, resolvePackage, scanForSecrets, signCheckpoint, updatePackage, verifyCheckpointSignature,
  verifyPackage, writePackage, PackagesClient, PackageServiceError, packageRoutes, unpackToTemp, commonsRoutes, signCommons, COMMONS_VERSION, addKnownBad, fetchKnownBad, knownBadRoutes, postKnownBad, readKnownBad, isKnownBadFingerprint, type KnownBadEntry, createGateway, httpUpstream, stdioUpstream, type McpUpstream, bwrapArgs, policyNeedsNetwork, sandboxAvailable, RELAY_JS, RELAY_PY, RELAY_TCP_PY, dockerPlan, AgentReporter, treeHash,
  type Harness, type LineageChange, type RuntimeAdapter,
} from "@agent-social/asp-package";

class UsageError extends Error {}

/** The clock records are stamped with; the evaluation harness swaps in a simulated one (asp eval). */
let clock: (() => Date) | undefined;
export function setClock(fn: (() => Date) | undefined): void { clock = fn; }
const now = () => (clock ? clock() : new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
const slug = (s: string) => s.replace(/^did:[a-z0-9]+:/, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
const quote = (a: string) => (/^[A-Za-z0-9_./:=@-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`);

export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
  env: NodeJS.ProcessEnv;
  cwd: string;
  /** Where a child runtime's own output is echoed (default: this process's stdout); the evaluation harness discards it. */
  raw?: (chunk: Buffer) => void;
}

const OPTIONS = {
  home: { type: "string" },
  "claude-home": { type: "string" },
  "user-home": { type: "string" },
  model: { type: "string" },
  endpoint: { type: "string" },
  "api-key-env": { type: "string" },
  kind: { type: "string" },
  did: { type: "string" },
  method: { type: "string" },
  sponsor: { type: "string" },
  fleet: { type: "string" },
  purpose: { type: "string" },
  runtime: { type: "string" },
  backend: { type: "string" },
  agent: { type: "string" },
  project: { type: "string" },
  out: { type: "string" },
  prompt: { type: "string" },
  "include-user": { type: "boolean" },
  "trust-unverified": { type: "boolean" },
  isolate: { type: "boolean" },
  "min-agents": { type: "string" },
  agents: { type: "string" },
  real: { type: "string", multiple: true },
  exploiters: { type: "string" },
  window: { type: "string" },
  "draft-by": { type: "string" },
  all: { type: "boolean" },
  spare: { type: "boolean" },
  blocked: { type: "string", multiple: true },
  report: { type: "string" },
  count: { type: "string" },
  since: { type: "string" },
  "min-witnesses": { type: "string" },
  to: { type: "string" },
  "with-export": { type: "boolean" },
  seen: { type: "boolean" },
  db: { type: "string" },
  port: { type: "string" },
  host: { type: "string" },
  tokens: { type: "string" },
  tenant: { type: "string" },
  role: { type: "string" },
  "no-auth": { type: "boolean" },
  packages: { type: "string" },
  commons: { type: "string" },
  "known-bad": { type: "string" },
  fingerprint: { type: "string" },
  "openai-upstream": { type: "string" },
  "anthropic-upstream": { type: "string" },
  "openai-key-env": { type: "string" },
  "anthropic-key-env": { type: "string" },
  "token-cap": { type: "string" },
  assurance: { type: "string" },
  metrics: { type: "string" },
  mcp: { type: "string", multiple: true },
  sandbox: { type: "boolean" },
  "sandbox-bind": { type: "string", multiple: true },
  "sandbox-backend": { type: "string" },
  capture: { type: "string" },
  target: { type: "string" },
  suite: { type: "string" },
  trials: { type: "string" },
  baseline: { type: "string" },
  only: { type: "string" },
  "no-canary": { type: "boolean" },
  "canary-gate": { type: "string" },
  "sandbox-image": { type: "string" },
  package: { type: "string" },
  title: { type: "string" },
  tag: { type: "string" },
  q: { type: "string" },
  status: { type: "string" },
  note: { type: "string" },
  context: { type: "string" },
  "quota-mb": { type: "string" },
  name: { type: "string" },
  merge: { type: "boolean" },
  "share-to-commons": { type: "boolean" },
  "memory-max-files": { type: "string" },
  "memory-max-bytes": { type: "string" },
  "memory-max-index-lines": { type: "string" },
  full: { type: "boolean" },
  "dry-run": { type: "boolean" },
  "no-write-back": { type: "boolean" },
  json: { type: "boolean" },
  "no-run-log": { type: "boolean" },
  late: { type: "string" },
  "record-quota": { type: "string" },
  "byte-quota-mb": { type: "string" },
  address: { type: "string" },
  minutes: { type: "string" },
  reason: { type: "string" },
  "tls-cert": { type: "string" },
  "tls-key": { type: "string" },
  "rate-limit": { type: "string" },
  "write-limit": { type: "string" },
  "address-limit": { type: "string" },
  "max-in-flight": { type: "string" },
  "max-failed-auth": { type: "string" },
  "trust-proxy": { type: "boolean" },
  "allow-plain-http": { type: "boolean" },
  "link-base": { type: "string" },
  once: { type: "boolean" },
  interval: { type: "string" },
  "run-log": { type: "string" },
  html: { type: "boolean" },
  again: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  task: { type: "string", multiple: true },
  "max-parallel": { type: "string" },
  as: { type: "string" },

  // asp credits / asp market (Stage 2 slice 1)
  amount: { type: "string" },
  by: { type: "string" },
  price: { type: "string" },
  budget: { type: "string" },
  deadline: { type: "string" },
  verification: { type: "string" },
  "review-deadline": { type: "string" },
  "parent-contract": { type: "string" },
  fees: { type: "string" },
  criteria: { type: "string", multiple: true },
  intent: { type: "string" },
  offer: { type: "string" },
  plan: { type: "string" },
  eta: { type: "string" },
  "bond-offered": { type: "string" },
  contract: { type: "string" },
  principal: { type: "string" },
  performer: { type: "string" },
  bank: { type: "string" },
  backer: { type: "string" },
  "escrow-payer": { type: "string" },
  "escrow-amount": { type: "string" },
  scopes: { type: "string", multiple: true },
  "network-host": { type: "string", multiple: true },
  "spend-cap": { type: "string" },
  summary: { type: "string" },
  about: { type: "string" },
  reasons: { type: "string", multiple: true },
  basis: { type: "string" },
  "escrow-released": { type: "string" },
  "bond-returned": { type: "string" },
  "bond-slashed": { type: "string" },
  "pro-rata": { type: "string" },
  "agent-permille": { type: "string" },
  cites: { type: "string" },

  // asp market call|propose|allocate|rule (allocation mode + the dispute/ruling path)
  panel: { type: "string", multiple: true },
  call: { type: "string" },
  proposal: { type: "string" },
  team: { type: "string", multiple: true },
  "budget-asked": { type: "string" },
  verdict: { type: "string" },
  fault: { type: "string", multiple: true },
  "cosign-by": { type: "string", multiple: true },

  // asp market juror|panel (Courts, a real staked random panel)
  stake: { type: "string" },
  size: { type: "string" },

  // asp market action (the compliance bridge) / asp run --contract
  "scopes-used": { type: "string", multiple: true },
  "max-strikes": { type: "string" },
  // asp market verify / deliver --claim / intent|contract --verifier (outcome verification)
  verifier: { type: "string" },
  // approval gates: asp market mandate --gate / --irreversible; asp market checkpoint|resolve; asp run --approval-wait
  gate: { type: "string", multiple: true },
  irreversible: { type: "string" },
  "approval-wait": { type: "string" },
  expires: { type: "string" },
  correction: { type: "string" },
  question: { type: "string" },
  claim: { type: "string", multiple: true },
  grade: { type: "string", multiple: true },
  artifact: { type: "string", multiple: true },
} as const;

/** The environment the current command runs with, so ASP_LOG_URL and ASP_LOG_TOKEN reach every openLog call (restored on exit: main re-enters). */
let logEnv: NodeJS.ProcessEnv = process.env;

export async function main(argv: string[], io: Io): Promise<number> {
  const previous = logEnv;
  logEnv = io.env;
  try { return await mainInner(argv, io); } finally { logEnv = previous; }
}

async function mainInner(argv: string[], io: Io): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  } catch (e) {
    io.err(String((e as Error).message));
    return 2;
  }
  const { values: v, positionals: [cmd, sub, ...rest] } = parsed;
  if (!cmd || v.help) {
    io.out(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0].replace(/^[\s\S]*?\/\*\*\n/, "").replace(/^ \* ?/gm, ""));
    return cmd ? 0 : 2;
  }
  const home = aspHome(v.home ?? io.env.ASP_HOME);
  const need = (name: keyof typeof v) => {
    const val = v[name];
    if (val === undefined || val === "") throw new UsageError(`--${name} is required`);
    return val as string;
  };

  try {
    if (cmd === "identity" && sub === "new") return await identityNew(home, v, need, io);
    if (cmd === "identity" && sub === "show") return await identityShow(home, rest[0] ?? v.did, io);
    if (cmd === "identity" && sub === "copy") return await identityCopy(home, rest[0] ?? v.did, v, io);
    if (cmd === "identity" && sub === "export") return await identityExport(home, rest[0] ?? v.did, v, io);
    if (cmd === "identity" && sub === "register") return await identityRegister(home, rest[0], v, io);
    if (cmd === "pack") return await pack(home, v, need, io);
    if (cmd === "verify") return await verify(sub, v.json ?? false, io);
    if (cmd === "run") return await run(home, sub, v, need, io);
    if (cmd === "orchestrate") return await orchestrate(home, sub, v, need, io);
    if (cmd === "log" && sub === "verify") return await logVerify(home, v, io);
    if (cmd === "log" && sub === "snapshot") return await logSnapshot(home, io);
    if (cmd === "log" && sub === "export") return await logExport(home, v, need, io);
    if (cmd === "log" && sub === "import") return await logImport(home, rest[0], io);
    if (cmd === "canary") return await canaryCmd(home, sub, rest, v, io);
    if (cmd === "gateway") return await gatewayCmd(home, [sub, ...rest].filter((x): x is string => !!x), v, need, io);
    if (cmd === "known-bad") return await knownBadCmd(home, sub, v, need, io);
    if (cmd === "run-log") return await runLogCmd(home, sub, rest, v, io);
    if (cmd === "mail") return await mailCmd(home, sub, rest, v, io);
    if (cmd === "commons") return await commonsCmd(home, sub, rest, v, need, io);
    if (cmd === "package") return await packageCmd(home, sub, rest, v, need, io);
    if (cmd === "serve" && sub === "token") return await serveToken(v, need, io);
    if (cmd === "serve" && ["suspend", "resume", "block", "unblock", "usage"].includes(sub ?? "")) return await serveAdmin(sub!, v, need, io);
    if (cmd === "serve") return await serve(v, need, io);
    if (cmd === "watch") return await watch(home, v, io);
    if (cmd === "eval" && sub === "run") return await evalRun(rest[0], v, io);
    if (cmd === "log" && sub === "cross-check") return await logCrossCheck(home, rest, io);
    if (cmd === "log" && sub === "publish") return await logPublish(home, v, need, io);
    if (cmd === "log" && sub === "witness") return await logWitness(home, rest[0], v, need, io);
    if (cmd === "log" && sub === "witnesses") return await logWitnessesAdd(home, rest[0] === "add" ? rest[1] : undefined, io);
    if (cmd === "log" && sub === "checkpoint") return await logCheckpoint(home, v, need, io);
    if (cmd === "credits" && sub === "grant") return await creditsGrant(home, v, need, io);
    if (cmd === "credits" && sub === "balance") return await creditsBalance(home, rest[0] ?? v.to, io);
    if (cmd === "market") return await market(home, sub, rest, v, need, io);
    throw new UsageError(`unknown command: ${[cmd, sub].filter(Boolean).join(" ")}`);
  } catch (e) {
    io.err(e instanceof UsageError ? `usage: ${e.message}` : `error: ${(e as Error).message}`);
    return e instanceof UsageError ? 2 : 1;
  }
}

type Values = {
  [K in keyof typeof OPTIONS]?: K extends "mcp" | "sandbox-bind" | "task" | "criteria" | "scopes" | "network-host" | "reasons" | "panel" | "team" | "fault" | "cosign-by" | "scopes-used" | "artifact" | "blocked" | "claim" | "grade" | "gate" | "real" ? string[]
    : (typeof OPTIONS)[K]["type"] extends "boolean" ? boolean : string;
};
type Need = (name: keyof typeof OPTIONS) => string;

async function identityNew(home: string, v: Values, need: Need, io: Io): Promise<number> {
  const kind = need("kind");
  if (kind !== "human" && kind !== "agent") throw new UsageError("--kind is human or agent");
  const keys = new Keystore(home);
  const log = await openLog(home, logEnv);

  // did:web (--did) requires a domain you control; did:key (--method did:key) is self-certifying —
  // derived from a fresh key, so there is no domain to bring, lose, or depend on anyone else for
  // (2026-09-27: raised against did:web-only identity undercutting "take your agent and leave").
  let did: string;
  let signer: Signer & { publicKey: Uint8Array };
  if (v.did) {
    did = v.did;
    const kid = `${did}#key-1`;
    signer = keys.find(kid) ?? keys.create(kid);
  } else if (v.method === "did:key") {
    const seed = randomSeed();
    did = didKeyFromPublicKey(publicKeyFromSeed(seed));
    signer = keys.createFromSeed(`${did}#key-1`, seed);
  } else {
    throw new UsageError("give --did <did> (e.g. did:web:your-domain:...), or --method did:key for a self-certifying identity that needs no domain");
  }
  if (await log.log.passport(did)) throw new Error(`${did} already has a passport`);
  const kid = `${did}#key-1`;

  let issuerSigner: Signer & { publicKey: Uint8Array };
  let body: Record<string, unknown>;
  if (kind === "human") {
    issuerSigner = signer;
    body = { did, kind, keys: [{ id: kid, type: "Ed25519", public_key: b64urlEncode(signer.publicKey) }] };
  } else {
    const sponsor = need("sponsor");
    const sponsorSigner = keys.forDid(sponsor);
    if (!sponsorSigner) throw new Error(`no key for sponsor ${sponsor} in ${home}; create it with: asp identity new --kind human --did ${sponsor}`);
    issuerSigner = sponsorSigner;
    body = {
      did, kind, keys: [{ id: kid, type: "Ed25519", public_key: b64urlEncode(signer.publicKey) }],
      sponsor, mentor: sponsor, tier: 1,
      shape: { memory: "files + experience index", keeps_learning: true, modalities: ["text", "code"] },
      ...(v.purpose ? { purpose: v.purpose } : {}),
      ...(v.fleet ? { fleet: v.fleet } : {}),
    };
  }
  const issuer = kind === "human" ? did : need("sponsor");
  const record = createRecord({ type: "passport", issuer, subject: did, prev: null, body, issued_at: now() }, issuerSigner);
  const res = await log.append(record);
  io.out(`created ${kind} ${did}`);
  io.out(`  key      ${kid} (stored in ${join(home, "keys")})`);
  io.out(`  passport ${res.id} (log seq ${res.seq})`);
  return 0;
}

/** Fleet isolation (docs/stage-3-plan.md M1): one independently liable copy of an agent. */
async function createCopy(home: string, local: LogHandle, original: string): Promise<{ did: string; signer: Signer & { publicKey: Uint8Array } }> {
  const p = await local.log.passport(original);
  if (!p) throw new Error(`no passport for ${original}`);
  const orig = (await local.log.get(p.head))!.record.body as {
    kind: string; sponsor?: string; mentor?: string; tier?: number; shape?: Record<string, unknown>; purpose?: string; fleet?: string;
  };
  if (orig.kind !== "agent" || !orig.sponsor) throw new Error(`${original} is not a sponsored agent, so it cannot be copied`);
  const rep = await local.log.reputationOf(original);
  const tier = Math.min(orig.tier ?? 1, rep?.tier ?? orig.tier ?? 1);
  if (tier === 0) throw new Error(`${original} is at tier 0 (demoted by repeat slashes); its copies would be excluded too`);
  const keys = new Keystore(home);
  const sponsorSigner = keys.forDid(orig.sponsor);
  if (!sponsorSigner) throw new Error(`no key for sponsor ${orig.sponsor} in ${home}; a copy is issued by the sponsor`);
  const seed = randomSeed();
  const did = didKeyFromPublicKey(publicKeyFromSeed(seed));
  const signer = keys.createFromSeed(`${did}#key-1`, seed);
  const body = {
    did, kind: "agent", keys: [{ id: `${did}#key-1`, type: "Ed25519", public_key: b64urlEncode(signer.publicKey) }],
    sponsor: orig.sponsor, mentor: orig.mentor ?? orig.sponsor, tier,
    shape: orig.shape ?? { keeps_learning: true },
    purpose: `${orig.purpose ?? "copy"} (independent copy of ${original})`.slice(0, 500),
    ...(orig.fleet ? { fleet: orig.fleet } : {}),
  };
  await local.append(createRecord({ type: "passport", issuer: orig.sponsor, subject: did, prev: null, body, issued_at: now() }, sponsorSigner));
  return { did, signer };
}

async function identityCopy(home: string, original: string | undefined, v: Values, io: Io): Promise<number> {
  if (!original) throw new UsageError("asp identity copy <agent did> [--count <n>]");
  const count = v.count === undefined ? 1 : Math.trunc(Number(v.count));
  if (!Number.isInteger(count) || count < 1 || count > 1000) throw new UsageError("--count must be a whole number from 1 to 1000");
  const local = await openLog(home, logEnv);
  for (let i = 0; i < count; i++) io.out((await createCopy(home, local, original)).did);
  return 0;
}

async function identityExport(home: string, did: string | undefined, v: Values, io: Io): Promise<number> {
  if (!did) throw new UsageError("asp identity export <did> [--out <file>]");
  const log = (await openLog(home, logEnv)).log;
  const p = await log.passport(did);
  if (!p) throw new Error(`no passport for ${did}`);
  const text = JSON.stringify((await log.get(p.head))!.record, null, 2);
  if (v.out) { writeFileSync(v.out, text + "\n"); io.out(`passport ${p.head} written to ${v.out}`); } else io.out(text);
  return 0;
}

async function identityRegister(home: string, file: string | undefined, v: Values, io: Io): Promise<number> {
  if (!file) throw new UsageError("asp identity register <passport.json> [--trust-unverified]");
  const record = JSON.parse(readFileSync(file, "utf8")) as AspRecord;
  if (record.type !== "asp.passport/v0.2") throw new UsageError(`${file} is not a passport record`);
  const body = record.body as { did: string; keys: { id: string; public_key: string }[] };
  const trust = v["trust-unverified"] ?? false;
  if (body.did.startsWith("did:web:")) {
    if (trust) io.err(`  warning  ${body.did} was NOT checked against its DID document (--trust-unverified)`);
    else {
      const missing = await passportKeysNotPublished(body.did, body.keys).catch((e: Error) => { throw new Error(`cannot verify ${body.did}: ${e.message}; fix the DID document or pass --trust-unverified`); });
      if (missing.length) throw new Error(`${body.did}'s DID document does not publish: ${missing.join(", ")}; not registered`);
      io.err(`  did:web  ${body.did}: every key is published by its DID document`);
    }
  } else if (body.did.startsWith("did:key:")) {
    io.err(`  did:key  ${body.did}: self-certifying, checked by the log`);
  } else if (trust) {
    io.err(`  warning  ${body.did} was NOT verified (unknown DID method, --trust-unverified)`);
  } else {
    throw new Error(`don't know how to verify ${body.did}; pass --trust-unverified to register it anyway`);
  }
  const local = await openLog(home, logEnv);
  const res = await local.append(record);
  io.out(`registered ${body.did}: passport ${res.id} (log seq ${res.seq})`);
  return 0;
}

async function identityShow(home: string, did: string | undefined, io: Io): Promise<number> {
  if (!did) throw new UsageError("asp identity show <did>");
  const log = (await openLog(home, logEnv)).log;
  const p = await log.passport(did);
  if (!p) throw new Error(`no passport for ${did}`);
  const rec = (await log.get(p.head))!.record;
  const reputation = await log.reputationOf(did);
  io.out(JSON.stringify({
    passport: p.head, sponsor: p.sponsor, fleet: p.fleet, body: rec.body, keys: await log.keys(did),
    ...(reputation ? { reputation } : {}),
  }, null, 2));
  return 0;
}

/** Signs a checkpoint of the local log's current head (decision D5) and appends it to checkpoints.ndjson. */
async function logCheckpoint(home: string, v: Values, need: Need, io: Io): Promise<number> {
  const did = need("as");
  const signer = new Keystore(home).forDid(did);
  if (!signer) throw new Error(`no key for ${did} in ${join(home, "keys")}`);
  const local = await openLog(home, logEnv);
  const head = await local.log.head();
  const cp = signCheckpoint(head, signer);
  const file = join(home, "checkpoints.ndjson");
  appendCheckpoint(file, cp);
  io.out(`checkpoint seq ${cp.seq} signed by ${cp.signer}`);
  io.out(`  log_hash   ${cp.logHash}`);
  io.out(`  signed_at  ${cp.signedAt}`);
  io.out(`  saved to   ${file}`);
  io.out("  this is not published anywhere yet; copy it out yourself to make it externally checkable.");
  return 0;
}

/** Verifies the log, then re-verifies every stored checkpoint against an independent replay. */
async function logExport(home: string, v: Values, need: Need, io: Io): Promise<number> {
  const out = need("out");
  const since = v.since === undefined ? 0 : Math.trunc(Number(v.since));
  if (!Number.isInteger(since) || since < 0) throw new UsageError("--since must be a whole number, 0 or more");
  const local = await openLog(home, logEnv);
  const head = await local.log.head();
  const lines: string[] = [JSON.stringify({ export: "asp.log/v1", head, since, mints: await local.log.mints() })];
  let after = since, count = 0;
  for (;;) {
    const page = await local.log.since(after, 500);
    if (!page.length) break;
    for (const s of page) { lines.push(JSON.stringify({ seq: s.seq, appendedAt: s.appendedAt, record: s.record })); after = s.seq; count++; }
  }
  writeFileSync(out, lines.join("\n") + "\n");
  io.out(`exported ${count} record(s) after seq ${since} to ${out} (head seq ${head.seq}, ${head.logHash})`);
  return 0;
}

function readExport(file: string) {
  const [first, ...rest] = readFileSync(file, "utf8").split("\n").filter((l) => l.trim());
  const header = JSON.parse(first) as { export?: string; head: { seq: number; logHash: string }; mints: { did: string; amount: number }[] };
  if (header.export !== "asp.log/v1") throw new UsageError(`${file} is not an asp log export`);
  return { header, items: rest.map((l) => JSON.parse(l) as { seq: number; appendedAt: string; record: AspRecord }) };
}

/** Replays an export into the local log; credit totals are applied only to a fresh replica (they are not records, MOCKS.md #13). */
async function importExport(local: LogHandle, file: string): Promise<{ imported: number; head: { seq: number; logHash: string } }> {
  const { header, items } = readExport(file);
  if ((await local.log.head()).seq === 0) for (const m of header.mints) await local.mint(m.did, m.amount);
  return local.importRecords(items, header.head);
}

async function logImport(home: string, file: string | undefined, io: Io): Promise<number> {
  if (!file) throw new UsageError("asp log import <file>");
  const res = await importExport(await openLog(home, logEnv), file);
  io.out(`imported ${res.imported} record(s); head seq ${res.head.seq}, ${res.head.logHash}`);
  return 0;
}

async function logWitness(home: string, file: string | undefined, v: Values, need: Need, io: Io): Promise<number> {
  if (!file) throw new UsageError("asp log witness <export file> --as <witness did> [--out <file>]");
  const did = need("as");
  const signer = new Keystore(home).forDid(did);
  if (!signer) throw new Error(`no key for ${did} in ${join(home, "keys")}; create one with: asp identity new --kind human --method did:key`);
  // The replica is its own log under <home>/replica, apart from the witness's own identity log.
  const local = await openLog(join(home, "replica"));
  const res = await importExport(local, file);
  const cp = signCheckpoint(res.head, signer);
  appendCheckpoint(join(home, "checkpoints.ndjson"), cp);
  if (v.out) appendCheckpoint(v.out, cp);
  io.out(`witnessed: replayed ${res.imported} record(s) and reproduced head seq ${cp.seq} (${cp.logHash})`);
  io.out(`  signed by ${cp.signer}${v.out ? `, written to ${v.out}` : ""}`);
  return 0;
}

/** Copies the home's signed checkpoints that the feed folder does not have yet into <dir>/feed.ndjson (append-only). */
async function logPublish(home: string, v: Values, need: Need, io: Io): Promise<number> {
  const dir = need("to");
  const mine = [...readCheckpoints(join(home, "checkpoints.ndjson")), ...(v.seen ? readCheckpoints(join(home, "witnesses.ndjson")) : [])];
  if (!mine.length) throw new Error("no checkpoints to publish; sign one with: asp log checkpoint --as <did>");
  const feed = join(dir, "feed.ndjson");
  const published = new Set(readCheckpoints(feed).map((c) => c.sig));
  const fresh = mine.filter((c) => !published.has(c.sig));
  for (const cp of fresh) appendCheckpoint(feed, cp);
  io.out(`published ${fresh.length} new checkpoint(s) to ${feed} (${published.size + fresh.length} in the feed)`);
  if (v["with-export"]) {
    const exportTo = join(dir, "export.ndjson");
    await logExport(home, { ...v, out: exportTo }, ((name: string) => (name === "out" ? exportTo : need(name as never))) as Need, io);
  }
  io.out("  nothing was uploaded: commit this folder to a public git repo, or serve it from a static host.");
  return 0;
}

/** A checkpoint signer's public key: from the log's passports, or the DID itself for a did:key. */
async function checkpointKey(local: LogHandle, cp: LogCheckpoint): Promise<Uint8Array | undefined> {
  const did = didOf(cp.signer);
  const key = (await local.log.keys(did)).find((k) => k.kid === cp.signer);
  if (key) return b64urlDecode(key.publicKey);
  if (did.startsWith("did:key:")) { try { return publicKeyFromDidKey(did); } catch { /* not ed25519 */ } }
  return undefined;
}

/** Signed proofs of forks among `cps`: only checkpoints whose signature verifies count. */
async function forksIn(local: LogHandle, cps: LogCheckpoint[]): Promise<[LogCheckpoint, LogCheckpoint][]> {
  const valid: LogCheckpoint[] = [];
  for (const cp of cps) {
    const pub = await checkpointKey(local, cp);
    if (pub && verifyCheckpointSignature(cp, pub)) valid.push(cp);
  }
  return findEquivocations(valid);
}

function printFork(io: Io, [a, b]: [LogCheckpoint, LogCheckpoint]) {
  io.out(`  FORK  ${didOf(a.signer)} signed two different histories at seq ${a.seq}:`);
  io.out(`          ${a.logHash}  (${a.signedAt})`);
  io.out(`          ${b.logHash}  (${b.signedAt})`);
}

/** Every Action record in the log, shaped for the contagion watcher. */
async function collectWatchActions(local: LogHandle): Promise<WatchAction[]> {
  const actions: WatchAction[] = [];
  for (let after = 0; ;) {
    const page = await local.log.since(after, 500);
    if (!page.length) break;
    for (const s of page) {
      after = s.seq;
      if (s.record.type !== "asp.action/v0.2") continue;
      const b = s.record.body as { contract: string; scopes_used: string[]; blocked_attempts?: { scope: string; count: number }[]; artifacts?: { uri: string; sha256: string }[] };
      actions.push({ id: s.id, issuer: s.record.issuer, contract: b.contract, issuedAt: s.record.issued_at, scopesUsed: b.scopes_used, blocked: b.blocked_attempts ?? [], artifacts: b.artifacts ?? [] });
    }
  }
  return actions;
}

async function serveToken(v: Values, need: Need, io: Io): Promise<number> {
  const file = need("tokens");
  const name = need("tenant");
  const role = v.role ?? "tenant";
  if (role !== "tenant" && role !== "admin") throw new UsageError("--role is tenant or admin");
  const tenants: Tenant[] = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
  if (tenants.some((t) => t.name === name)) throw new Error(`tenant ${name} already has a token in ${file}; remove it from the file to replace it`);
  const token = b64urlEncode(randomSeed());
  const quotaMb = v["quota-mb"] === undefined ? undefined : Number(v["quota-mb"]);
  if (quotaMb !== undefined && !(quotaMb > 0)) throw new UsageError("--quota-mb must be a positive number");
  const recordQuota = v["record-quota"] === undefined ? undefined : Number(v["record-quota"]);
  const byteQuotaMb = v["byte-quota-mb"] === undefined ? undefined : Number(v["byte-quota-mb"]);
  if (recordQuota !== undefined && !(Number.isInteger(recordQuota) && recordQuota >= 0)) throw new UsageError("--record-quota must be a whole number, 0 or more (0 for no limit)");
  if (byteQuotaMb !== undefined && !(byteQuotaMb >= 0)) throw new UsageError("--byte-quota-mb must be a number, 0 or more (0 for no limit)");
  tenants.push({
    name, role, tokenSha256: hashToken(token), ...(quotaMb ? { quotaBytes: Math.round(quotaMb * 1024 * 1024) } : {}),
    ...(recordQuota !== undefined ? { recordQuota } : {}), ...(byteQuotaMb !== undefined ? { byteQuota: Math.round(byteQuotaMb * 1024 * 1024) } : {}),
    ...(v["rate-limit"] !== undefined ? { rateLimitPerMinute: Math.trunc(Number(v["rate-limit"])) } : {}), createdAt: now(),
  });
  writeFileSync(file, JSON.stringify(tenants, null, 2) + "\n");
  io.out(`token for ${name} (${role}), shown once, only its hash is stored in ${file}:`);
  io.out(token);
  return 0;
}

const DEFAULT_RECORD_QUOTA = 100_000;
const DEFAULT_BYTE_QUOTA_MB = 256;

/** asp serve suspend|resume|block|unblock|usage: what an operator does to a running service (it picks the change up without a restart). */
async function serveAdmin(sub: string, v: Values, need: Need, io: Io): Promise<number> {
  const file = need("tokens");
  if (!existsSync(file)) throw new Error(`${file} does not exist`);
  const tenants: Tenant[] = JSON.parse(readFileSync(file, "utf8"));
  const save = (data: unknown, path = file) => writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
  if (sub === "suspend" || sub === "resume") {
    const name = need("tenant");
    const t = tenants.find((x) => x.name === name);
    if (!t) throw new Error(`no tenant called ${name} in ${file}`);
    if (sub === "suspend") t.suspended = { at: now(), ...(v.reason ? { reason: v.reason } : {}) }; else delete t.suspended;
    save(tenants);
    io.out(sub === "suspend" ? `${name} is suspended${v.reason ? `: ${v.reason}` : ""}; every request it makes is refused until you resume it` : `${name} is resumed`);
    return 0;
  }
  const blockedPath = `${file}.blocked.json`;
  if (sub === "block" || sub === "unblock") {
    const address = need("address");
    const list: { address: string; at: string; until?: string; reason?: string }[] = existsSync(blockedPath) ? JSON.parse(readFileSync(blockedPath, "utf8")) : [];
    const rest = list.filter((b) => b.address !== address);
    if (sub === "block") {
      const minutes = v.minutes === undefined ? undefined : Number(v.minutes);
      if (minutes !== undefined && !(minutes > 0)) throw new UsageError("--minutes must be a positive number");
      rest.push({ address, at: now(), ...(minutes ? { until: new Date(Date.now() + minutes * 60_000).toISOString() } : {}), ...(v.reason ? { reason: v.reason } : {}) });
    }
    save(rest, blockedPath);
    io.out(sub === "block" ? `${address} is blocked${v.minutes ? ` for ${v.minutes} minute(s)` : " until you unblock it"}` : `${address} is unblocked`);
    return 0;
  }
  // usage
  const used = new UsageStore(`${file}.usage.json`).all();
  const recordDefault = v["record-quota"] === undefined ? DEFAULT_RECORD_QUOTA : Math.trunc(Number(v["record-quota"]));
  const byteDefault = Math.round((v["byte-quota-mb"] === undefined ? DEFAULT_BYTE_QUOTA_MB : Number(v["byte-quota-mb"])) * 1048576);
  for (const t of tenants) {
    const u = used[t.name] ?? { records: 0, bytes: 0 };
    const rq = t.role === "admin" ? 0 : t.recordQuota ?? recordDefault;
    const bq = t.role === "admin" ? 0 : t.byteQuota ?? byteDefault;
    io.out(`  ${t.name.padEnd(16)} ${t.role.padEnd(7)} ${String(u.records).padStart(8)} / ${rq || "no limit"} records   ${(u.bytes / 1048576).toFixed(2)} MB / ${bq ? `${Math.round(bq / 1048576)} MB` : "no limit"}${t.suspended ? `   SUSPENDED${t.suspended.reason ? `: ${t.suspended.reason}` : ""}` : ""}`);
  }
  const blockedNow = existsSync(blockedPath) ? (JSON.parse(readFileSync(blockedPath, "utf8")) as { address: string; until?: string }[]).filter((b) => !b.until || Date.parse(b.until) > Date.now()) : [];
  io.out(`${tenants.length} tenant(s); ${blockedNow.length} blocked address(es)${blockedNow.length ? `: ${blockedNow.map((b) => b.address).join(", ")}` : ""}`);
  return 0;
}

async function serve(v: Values, need: Need, io: Io): Promise<number> {
  const db = need("db");
  const port = v.port === undefined ? 8787 : Math.trunc(Number(v.port));
  const host = v.host ?? "127.0.0.1";
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UsageError("--port must be a port number");
  const noAuth = v["no-auth"] ?? false;
  if (noAuth && !["127.0.0.1", "localhost", "::1"].includes(host)) throw new UsageError("--no-auth is only allowed on 127.0.0.1");
  if (!noAuth && !v.tokens) throw new UsageError("give --tokens <file> (see asp serve token), or --no-auth for a service on 127.0.0.1");
  const tenants: Tenant[] = !noAuth && existsSync(v.tokens!) ? JSON.parse(readFileSync(v.tokens!, "utf8")) : [];
  if (!noAuth && !tenants.length) throw new UsageError(`${v.tokens} has no tenants; create one with: asp serve token --tokens ${v.tokens} --tenant <name> --role admin`);
  // TLS (O1): with a certificate and key the service speaks HTTPS. Bound to anything but this machine it must, or it says so.
  if (!!v["tls-cert"] !== !!v["tls-key"]) throw new UsageError("--tls-cert and --tls-key go together");
  const tls = v["tls-cert"] ? { cert: readFileSync(resolve(io.cwd, v["tls-cert"])), key: readFileSync(resolve(io.cwd, v["tls-key"]!)) } : undefined;
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(host);
  if (!tls && !loopback && !v["allow-plain-http"]) {
    throw new UsageError(`bound to ${host} without TLS the service would send every tenant's token in the clear: give --tls-cert and --tls-key, or put it behind a proxy that terminates TLS and pass --allow-plain-http`);
  }
  // Limits (O2), on by default here: per tenant, per write, per address, in flight, and a lockout after failed sign-ins. 0 turns one off.
  const num = (name: string, fallback: number) => {
    const raw = v[name as "rate-limit"];
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) throw new UsageError(`--${name} must be a whole number, 0 or more`);
    return n;
  };
  const limits = {
    tenantPerMinute: num("rate-limit", 600), appendPerMinute: num("write-limit", 120), addressPerMinute: num("address-limit", 1200),
    maxInFlight: num("max-in-flight", 16), failedAuthMax: num("max-failed-auth", 10),
  };
  // What an operator changes while the service runs (O2): the tenants file (suspend, resume, new tokens), the block list, and the usage counts.
  const watched = <T,>(file: string, parse: (text: string) => T, empty: T) => {
    let stamp = "", value = empty;
    return () => {
      try { const st = statSync(file); const k = `${st.mtimeMs}:${st.size}`; if (k !== stamp) { value = parse(readFileSync(file, "utf8")); stamp = k; } } catch { if (!existsSync(file)) { value = empty; stamp = ""; } }
      return value;
    };
  };
  const tenantSource = !noAuth ? watched<Tenant[]>(v.tokens!, (t) => JSON.parse(t), tenants) : undefined;
  const blockedFile = !noAuth ? `${v.tokens}.blocked.json` : undefined;
  const blockedList = blockedFile ? watched<{ address: string; until?: string }[]>(blockedFile, (t) => JSON.parse(t), []) : undefined;
  const blocked = blockedList ? () => blockedList().filter((b) => !b.until || Date.parse(b.until) > Date.now()).map((b) => b.address) : undefined;
  const usage = new UsageStore(!noAuth ? `${v.tokens}.usage.json` : undefined);
  const defaultRecordQuota = v["record-quota"] === undefined ? DEFAULT_RECORD_QUOTA : Math.trunc(Number(v["record-quota"]));
  const defaultByteQuota = Math.round((v["byte-quota-mb"] === undefined ? DEFAULT_BYTE_QUOTA_MB : Number(v["byte-quota-mb"])) * 1024 * 1024);
  if (!(defaultRecordQuota >= 0) || !(defaultByteQuota >= 0)) throw new UsageError("--record-quota and --byte-quota-mb must be 0 or more (0 for no limit)");
  const handle = db.startsWith("local:") ? await LocalLog.open(db.slice("local:".length)) : await postgresHandle(db);
  const routes = [
    ...(v.packages ? [packageRoutes({ root: resolve(v.packages) })] : []),
    ...(v.commons ? [commonsRoutes({ root: resolve(v.commons), handle })] : []),
    ...(v["known-bad"] ? [knownBadRoutes({ root: resolve(v["known-bad"]) })] : []),
  ];
  const extra = routes.length ? async (req: any, res: any, ctx: any) => { for (const r of routes) if (await r(req, res, ctx)) return true; return false; } : undefined;
  const server = createLogServer({ handle, tenants, ...(tenantSource ? { tenantSource } : {}), ...(blocked ? { blocked } : {}), usage, defaultRecordQuota, defaultByteQuota, noAuth, limits, trustProxy: !!v["trust-proxy"], ...(tls ? { tls } : {}), ...(extra ? { extra } : {}) });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, host, resolve); });
  const addr = server.address() as { port: number };
  io.out(`asp log service listening on ${tls ? "https" : "http"}://${host}:${addr.port} (${db.startsWith("local:") ? db : "postgres"}, ${noAuth ? "no auth" : `${tenants.length} tenant(s)`})`);
  io.out(`  limits per minute: ${limits.tenantPerMinute || "no limit"} requests and ${limits.appendPerMinute || "no limit"} writes per tenant, ${limits.addressPerMinute || "no limit"} per address; ${limits.maxInFlight || "no"} in flight; lockout after ${limits.failedAuthMax || "never"} failed sign-ins`);
  io.out(`  quota per tenant (admins have none): ${defaultRecordQuota || "no limit"} records, ${defaultByteQuota ? `${Math.round(defaultByteQuota / 1048576)} MB` : "no limit"} of records; suspend, resume, block and unblock take effect without a restart (asp serve usage shows the counts)`);
  if (!tls && !loopback) io.out("  warning  plain HTTP on a network address: TLS must be terminated in front of this service");
  await new Promise<void>((resolve) => { process.once("SIGINT", resolve); process.once("SIGTERM", resolve); });
  server.close();
  return 0;
}

async function evalRun(file: string | undefined, v: Values, io: Io): Promise<number> {
  const loaded = file ? (JSON.parse(readFileSync(resolve(io.cwd, file), "utf8")) as Partial<SwarmScenario>) : {};
  if (loaded.kind !== undefined && loaded.kind !== "swarm-exploit") throw new UsageError(`unknown scenario kind ${loaded.kind}; available: swarm-exploit`);
  const sc: SwarmScenario = { ...DEFAULT_SWARM, ...loaded };
  if (v.agents !== undefined) sc.agents = Math.trunc(Number(v.agents));
  if (v.exploiters !== undefined) sc.exploiters = Math.trunc(Number(v.exploiters));
  // --real <backend>[:<model>][:exploit|honest], repeatable, adds agents on real runtimes.
  for (const spec of v.real ?? []) {
    const [backend, model, role] = spec.split(":");
    if (!["claude-code", "codex", "antigravity", "openhands"].includes(backend)) throw new UsageError(`--real backend must be claude-code, codex, antigravity or openhands, got "${backend}"`);
    sc.real = [...(sc.real ?? []), { backend: backend as RealAgent["backend"], ...(model && model !== "-" ? { model } : {}), exploiter: role !== "honest" }];
  }
  if (v.spare) sc.slashCohort = false;
  if (!Number.isInteger(sc.agents) || sc.agents < 0 || sc.agents > 200 || (sc.agents < 3 && !(sc.real ?? []).length)) throw new UsageError("agents must be a whole number from 3 to 200 (or fewer when real agents are given)");
  if (!Number.isInteger(sc.exploiters) || sc.exploiters < 0 || sc.exploiters > sc.agents) throw new UsageError("exploiters must be from 0 to the number of agents");
  const dir = mkdtempSync(join(tmpdir(), "asp-eval-"));
  let t = Date.now() - 2 * 3600_000;
  setClock(() => new Date(t));
  // A key for an OpenAI-compatible endpoint goes into this process's environment only, never printed.
  const keyEnv: Record<string, string> = {};
  const needsOrKey = (sc.real ?? []).some((r) => r.apiKeyEnv === "ASP_OR_KEY");
  if (needsOrKey) {
    const keyFile = [join(homedir(), ".asp-openrouter-key"), join(homedir(), ".asp-openrouter-key.txt")].find((f) => existsSync(f));
    if (!keyFile) throw new UsageError("this scenario uses ASP_OR_KEY: save the key to ~/.asp-openrouter-key");
    keyEnv.ASP_OR_KEY = readFileSync(keyFile, "utf8").replace(/\s+/g, "");
  }
  const run = async (args: string[], extra: Record<string, string> = {}) => {
    const out: string[] = [];
    const err: string[] = [];
    // A real runtime streams its output to stdout; keep it out of the harness's own report.
    const code = await main([...args, "--home", dir], { out: (l) => out.push(l), err: (l) => err.push(l), env: { ...io.env, ...keyEnv, ASP_HOME: dir, ...extra }, cwd: io.cwd, raw: () => {} });
    return { code, out: out.join("\n"), err: err.join("\n") };
  };
  try {
    io.out(`scenario ${sc.name}: ${sc.agents} agents, ${sc.exploiters} pick up the exploit (fresh log in ${dir})`);
    const report = await runSwarm(sc, run, (ms) => { t += ms; }, dir, (l) => io.out(`  ${l}`));
    io.out("result");
    io.out(formatSwarm(report));
    if (v.out) { writeFileSync(resolve(io.cwd, v.out), JSON.stringify(report, null, 2) + "\n"); io.out(`report written to ${v.out}`); }
    return report.logVerified ? 0 : 1;
  } finally {
    setClock(undefined);
  }
}

async function watch(home: string, v: Values, io: Io): Promise<number> {
  const minAgents = v["min-agents"] === undefined ? 3 : Math.trunc(Number(v["min-agents"]));
  const windowS = v.window === undefined ? 600 : Number(v.window);
  if (!Number.isInteger(minAgents) || minAgents < 2) throw new UsageError("--min-agents must be a whole number, 2 or more");
  if (!Number.isFinite(windowS) || windowS <= 0) throw new UsageError("--window must be a number of seconds above 0");
  const local = await openLog(home, logEnv);
  const actions = await collectWatchActions(local);
  const clusters = findContagion(actions, { minAgents, windowMs: windowS * 1000, all: v.all ?? false });
  io.out(`watched ${actions.length} action(s) from ${new Set(actions.map((a) => a.issuer)).size} agent(s); window ${windowS} s, threshold ${minAgents} agents`);
  if (!clusters.length) { io.out("no contagion pattern found"); return 0; }
  for (const c of clusters) {
    io.out(`  ${c.kind === "same-input" ? "SAME INPUT" : "SAME PROBE"}  ${c.key}`);
    io.out(`    ${c.issuers.length} agents between ${c.firstAt} and ${c.lastAt}; scopes: ${c.scopes.join(", ") || "-"}`);
    for (const contract of c.contracts) {
      const state = (await local.log.chainInfo(contract))?.state ?? "unknown";
      const reportable = state === "Running" || state === "Checkpoint";
      io.out(`    contract ${contract}: ${state}${reportable ? " (reportable)" : ""}`);
      if (v["draft-by"] && reportable) {
        io.out(`      asp market report --contract ${contract} --by ${v["draft-by"]} --reasons "asp watch: ${c.kind} cluster ${c.key.replace(/"/g, "")} across ${c.issuers.length} agents"`);
      }
    }
  }
  io.out(`${clusters.length} cluster(s) found`);
  return 1;
}

async function logCrossCheck(home: string, sources: string[], io: Io): Promise<number> {
  if (!sources.length) throw new UsageError("asp log cross-check <file | folder | https URL>...");
  const local = await openLog(home, logEnv);
  const known = [...readCheckpoints(join(home, "checkpoints.ndjson")), ...readCheckpoints(join(home, "witnesses.ndjson"))];
  const seen: LogCheckpoint[] = [];
  for (const s of sources) { const cps = await readFeed(s); io.out(`  read ${cps.length} checkpoint(s) from ${s}`); seen.push(...cps); }
  const forks = await forksIn(local, [...known, ...seen]);
  for (const f of forks) printFork(io, f);
  // A checkpoint someone else holds that this log's own replay contradicts is also a fork, from this log's point of view.
  let contradicted = 0;
  for (const cp of seen) {
    const pub = await checkpointKey(local, cp);
    if (!pub || !verifyCheckpointSignature(cp, pub)) continue;
    if (!(await local.log.verifyCheckpoint({ seq: cp.seq, logHash: cp.logHash })) && (await local.log.head()).seq >= cp.seq) {
      contradicted++;
      io.out(`  FORK  ${didOf(cp.signer)} signed ${cp.logHash} at seq ${cp.seq}, which this log does not have`);
    }
  }
  const signers = new Set([...known, ...seen].map((c) => didOf(c.signer)));
  io.out(forks.length || contradicted ? `cross-check FAILED: ${forks.length + contradicted} fork(s) among ${known.length + seen.length} checkpoint(s)` : `cross-check ok: ${known.length + seen.length} checkpoint(s) from ${signers.size} signer(s), no fork`);
  return forks.length || contradicted ? 1 : 0;
}

/** Reads a witness feed: a local checkpoints file, a folder holding feed.ndjson, or an https URL of one. */
async function readFeed(source: string): Promise<LogCheckpoint[]> {
  if (/^https?:\/\//.test(source)) {
    const url = source.endsWith(".ndjson") ? source : source.replace(/\/?$/, "/") + "feed.ndjson";
    return fetchSmallText(url, { maxBytes: 1024 * 1024, timeoutMs: 10_000 })
      .then((t) => t.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as LogCheckpoint));
  }
  return readCheckpoints(existsSync(join(source, "feed.ndjson")) ? join(source, "feed.ndjson") : source);
}

async function logWitnessesAdd(home: string, file: string | undefined, io: Io): Promise<number> {
  if (!file) throw new UsageError("asp log witnesses add <witness checkpoints file | folder | https URL>");
  const cps = await readFeed(file);
  if (!cps.length) throw new Error(`no checkpoints in ${file}`);
  // Append-only: an entry seen from this source before must still be there.
  const trackFile = join(home, "witness-feeds.json");
  const tracked: Record<string, string[]> = existsSync(trackFile) ? JSON.parse(readFileSync(trackFile, "utf8")) : {};
  // A feed that contradicts what this home already holds is refused, with the signed proof.
  const local = await openLog(home, logEnv);
  const forks = await forksIn(local, [...readCheckpoints(join(home, "checkpoints.ndjson")), ...readCheckpoints(join(home, "witnesses.ndjson")), ...cps]);
  if (forks.length) { for (const f of forks) printFork(io, f); throw new Error(`${file} contradicts checkpoints already held (a fork); not added`); }
  const nowSigs = new Set(cps.map((c) => c.sig));
  const vanished = (tracked[file] ?? []).filter((s) => !nowSigs.has(s));
  if (vanished.length) throw new Error(`${file} has rewritten its history: ${vanished.length} entry(ies) published before are gone; not updated`);
  const have = new Set(readCheckpoints(join(home, "witnesses.ndjson")).map((c) => c.sig));
  const fresh = cps.filter((c) => !have.has(c.sig));
  for (const cp of fresh) appendCheckpoint(join(home, "witnesses.ndjson"), cp);
  tracked[file] = [...nowSigs];
  writeFileSync(trackFile, JSON.stringify(tracked, null, 2));
  io.out(`added ${fresh.length} new witness checkpoint(s) (${cps.length} in the feed); asp log verify --min-witnesses <n> checks them`);
  return 0;
}

/** The memory budget for this command: the defaults, overridden by --memory-max-files, --memory-max-bytes and --memory-max-index-lines. */
function memoryBudget(v: Values): MemoryBudget {
  const num = (raw: string | undefined, name: string, fallback: number) => {
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) throw new UsageError(`--${name} must be a whole number, at least 1`);
    return n;
  };
  return {
    maxFiles: num(v["memory-max-files"], "memory-max-files", DEFAULT_MEMORY_BUDGET.maxFiles),
    maxBytes: num(v["memory-max-bytes"], "memory-max-bytes", DEFAULT_MEMORY_BUDGET.maxBytes),
    maxIndexLines: num(v["memory-max-index-lines"], "memory-max-index-lines", DEFAULT_MEMORY_BUDGET.maxIndexLines),
  };
}

/**
 * asp canary run|compare|list: a fixed set of small tasks with checks, run against an agent configuration so that a model swap, a memory update or a
 * new runtime shows up as a measured difference (packages/asp-cli/src/canary.ts, canary/default-suite.json).
 */
/** What `asp run` does after a change: per agent, a target for each backend and what to do with a regression. Kept in the ASP home. */
interface CanaryConfig { agent: string; gate: "warn" | "block"; trials?: number; suite?: string; targets: Record<string, CanaryTarget> }
const canaryConfigPath = (home: string, agent: string) => join(home, "canary", `${slug(agent)}.json`);
const canaryBaselinePath = (home: string, agent: string, backend: string) => join(home, "canary", `${slug(agent)}.${backend}.baseline.json`);
const readCanaryConfig = (home: string, agent: string): CanaryConfig | undefined => (existsSync(canaryConfigPath(home, agent)) ? JSON.parse(readFileSync(canaryConfigPath(home, agent), "utf8")) : undefined);
const DEFAULT_SUITE_PATH = fileURLToPath(new URL("../../../canary/default-suite.json", import.meta.url));
/** The runner the canary uses to call asp itself (the gateway, the identity commands) in a throwaway home. */
const canaryRunCli = (io: Io): RunCli => async (args, env, cwd) => {
  const out: string[] = [], err: string[] = [];
  const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env: { ...io.env, ...env }, cwd, raw: () => {} });
  return { code, out: out.join("\n"), err: err.join("\n") };
};

/**
 * The canary as a gate on a change (docs/gaps-register.md CM1): the change is applied to a copy of the package, the canary suite is run on the copy,
 * and the result is compared with the baseline for this backend and recorded in the log as a certificate attestation about the new memory. The caller
 * cites its id in the lineage edge (`change.gates`). With gate "block" a regression stops the change from being written back.
 */
async function canaryGateForChange(o: { home: string; io: Io; agent: string; signer: Signer; cfg: CanaryConfig; backend: string; pkgDir: string; changes: LineageChange[]; memoryFrom?: string; gate?: string }): Promise<{ blocked: boolean; gates: string[]; note: string }> {
  const { io, home, agent, backend } = o;
  const target = o.cfg.targets[backend];
  const suite = JSON.parse(readFileSync(resolve(o.cfg.suite ?? DEFAULT_SUITE_PATH), "utf8")) as CanarySuite;
  const cand = mkdtempSync(join(tmpdir(), "asp-canary-cand-"));
  let report: CanaryReport;
  let about: string;
  try {
    cpSync(o.pkgDir, cand, { recursive: true });
    updatePackage(cand, { signer: o.signer, changes: o.changes, memoryFrom: o.memoryFrom });
    about = treeHash(join(cand, "memory"));
    io.err(`  canary   running ${suite.tasks.length} task(s) on the changed package (${backend})`);
    report = await runCanary({ suite, target, packageDir: cand, trials: o.cfg.trials, run: canaryRunCli(io), log: (l) => io.err(l) });
  } finally { rmSync(cand, { recursive: true, force: true }); }
  const basePath = canaryBaselinePath(home, agent, backend);
  let verdict: "passed" | "regressed" | "baseline_set";
  let cmp: ReturnType<typeof compareReports> | undefined;
  if (existsSync(basePath)) {
    cmp = compareReports(JSON.parse(readFileSync(basePath, "utf8")) as CanaryReport, report);
    verdict = cmp.regressions.length ? "regressed" : "passed";
  } else {
    mkdirSync(dirname(basePath), { recursive: true });
    writeFileSync(basePath, JSON.stringify(report, null, 2) + "\n");
    verdict = "baseline_set";
    io.err(`  canary   no baseline for ${backend} yet: this run is now the baseline`);
  }
  const summary = `canary ${verdict}: ${report.totals.passedTasks}/${report.totals.tasks} tasks pass${cmp?.drift.length ? `, ${cmp.drift.length} drift warning(s)` : ""}`;
  io.err(`  canary   ${summary}`);
  for (const r of cmp?.regressions ?? []) io.err(`  canary   REGRESSION ${r}`);
  // The evidence: a certificate attestation about the new memory, signed by the agent's key, in the log.
  let gates: string[] = [];
  try {
    const reasons = [formatReport(report).split("\n").slice(0, 1)[0], ...(cmp?.regressions ?? []), ...(cmp?.drift ?? []), `suite ${report.suite.name} ${report.suite.hash}, target ${report.target.name}`];
    const cert = createRecord({ type: "attestation", issuer: agent, subject: agent, prev: null, issued_at: now(), body: { kind: "certificate", about, verdict, score: Math.round(report.totals.passRate * 1000), skill: `canary:${report.suite.hash}`, reasons } }, o.signer);
    const local = await openLog(home, logEnv);
    const res = await local.append(cert);
    gates = [res.id];
    io.err(`  canary   certificate ${res.id}`);
  } catch (e) { io.err(`  warning  the canary result could not be recorded in the log (${(e as Error).message}); the change will not cite it`); }
  const gate = (o.gate ?? o.cfg.gate ?? "warn") as "warn" | "block";
  return { blocked: verdict === "regressed" && gate === "block", gates, note: summary };
}

/**
 * Writes a change to an agent's package the way every write-back path does (asp run, asp gateway --package, asp orchestrate): if the agent has a canary
 * target for this backend the change is tested first (see canaryGateForChange), its result is cited in the lineage edge, and with the gate on "block" a
 * regression stops it being written. Returns the edges, or blocked = true and nothing written.
 */
async function applyChange(o: { home: string; io: Io; v: Values; agent: string; backend: string; pkgDir: string; signer: Signer; changes: LineageChange[]; memoryFrom?: string; keptAt?: string }): Promise<{ blocked: boolean; edges: AspRecord[] }> {
  const { home, io, v, agent, backend, pkgDir, signer } = o;
  let gates: string[] = [];
  let note = "";
  const cfg = v["no-canary"] ? undefined : readCanaryConfig(home, agent);
  if (cfg?.targets[backend]) {
    const outcome = await canaryGateForChange({ home, io, agent, signer, cfg, backend, pkgDir, changes: o.changes, memoryFrom: o.memoryFrom, gate: v["canary-gate"] });
    if (outcome.blocked) {
      io.err(`  canary   the change was NOT written back: it regressed the canary suite and the gate is "block".${o.keptAt ? ` The new memory is in ${o.keptAt}.` : ""} Rerun with --canary-gate warn or --no-canary to keep it anyway.`);
      return { blocked: true, edges: [] };
    }
    gates = outcome.gates;
    note = outcome.note;
  }
  const { edges } = updatePackage(pkgDir, { signer, memoryFrom: o.memoryFrom, changes: o.changes.map((c) => ({ ...c, ...(note ? { description: `${c.description}; ${note}` } : {}), ...(gates.length ? { gates } : {}) })) });
  return { blocked: false, edges };
}

/** Runs the canary on a package and keeps the result as the baseline for this agent and backend. */
async function canaryBaseline(home: string, io: Io, agent: string, backend: string, pkg: string): Promise<CanaryReport> {
  const cfg = readCanaryConfig(home, agent);
  if (!cfg?.targets[backend]) throw new Error(`no canary target for ${agent} on ${backend}: run asp canary setup first`);
  const suite = JSON.parse(readFileSync(resolve(cfg.suite ?? DEFAULT_SUITE_PATH), "utf8")) as CanarySuite;
  const report = await runCanary({ suite, target: cfg.targets[backend], packageDir: resolve(io.cwd, pkg), trials: cfg.trials, run: canaryRunCli(io), log: (l) => io.err(l) });
  mkdirSync(dirname(canaryBaselinePath(home, agent, backend)), { recursive: true });
  writeFileSync(canaryBaselinePath(home, agent, backend), JSON.stringify(report, null, 2) + "\n");
  return report;
}

async function canaryCmd(home: string, sub: string | undefined, rest: string[], v: Values, io: Io): Promise<number> {
  const load = <T>(file: string): T => JSON.parse(readFileSync(resolve(io.cwd, file), "utf8")) as T;
  const suitePath = v.suite ?? DEFAULT_SUITE_PATH;
  if (sub === "setup") {
    const agent = v.agent;
    const backend = v.backend;
    if (!agent || !backend) throw new UsageError("usage: asp canary setup --agent <did> --backend <runtime> --target <file | package:claude-code> [--canary-gate warn|block] [--trials n] [--suite file]");
    const t = v.target;
    if (!t) throw new UsageError("--target is a JSON file whose command uses {package}, or package:claude-code");
    const target = t === "package:claude-code"
      ? { name: "package-claude-code", command: ["{node}", "{asp}", "run", "{package}", "--backend", "claude-code", "--project", "{project}", "--prompt", "{prompt}", "--no-write-back", "--no-canary"], gatewayFlags: ["--anthropic-upstream", "https://api.anthropic.com"] } as CanaryTarget
      : load<CanaryTarget>(t);
    if (!target.command.some((c) => c.includes("{package}"))) throw new UsageError("a target for a package has to use {package} in its command, or the canary cannot see the package's memory");
    const gate = v["canary-gate"] ?? "warn";
    if (gate !== "warn" && gate !== "block") throw new UsageError("--canary-gate is warn or block");
    const cfg: CanaryConfig = readCanaryConfig(home, agent) ?? { agent, gate: "warn", targets: {} };
    cfg.gate = gate;
    if (v.trials) cfg.trials = Math.trunc(Number(v.trials));
    if (v.suite) cfg.suite = resolve(io.cwd, v.suite);
    cfg.targets[backend] = target;
    mkdirSync(dirname(canaryConfigPath(home, agent)), { recursive: true });
    writeFileSync(canaryConfigPath(home, agent), JSON.stringify(cfg, null, 2) + "\n");
    io.out(`canary set up for ${agent} on ${backend}: gate ${gate}`);
    if (v.package) {
      // --package runs the canary on the package now, so the very first change is compared with a real baseline instead of becoming it.
      const report = await canaryBaseline(home, io, agent, backend, v.package);
      io.out(formatReport(report));
      io.out(`baseline saved for ${agent} on ${backend}`);
    } else io.out(existsSync(canaryBaselinePath(home, agent, backend)) ? "a baseline exists" : `no baseline yet: add --package <package> to take one now, or the first change becomes the baseline`);
    return 0;
  }
  if (sub === "baseline") {
    const agent = v.agent, backend = v.backend, pkg = v.package;
    if (!agent || !backend || !pkg) throw new UsageError("usage: asp canary baseline --agent <did> --backend <runtime> --package <package>");
    const report = await canaryBaseline(home, io, agent, backend, pkg);
    io.out(formatReport(report));
    io.out(`baseline saved for ${agent} on ${backend}`);
    return 0;
  }
  if (sub === "evidence") {
    const pkg = rest[0];
    if (!pkg) throw new UsageError("usage: asp canary evidence <package>");
    const resolved = await resolvePackage(resolve(io.cwd, pkg));
    try {
      const agent = (JSON.parse(readFileSync(join(resolved.dir, "manifest.json"), "utf8")) as AspRecord).body as { agent: string };
      const history = readFileSync(join(resolved.dir, "records", "history.ndjson"), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as AspRecord);
      const edges = history.filter((r) => r.type === "asp.lineage/v0.2" && (r.body as any).child === agent.agent && (r.body as any).edge === "update");
      const local = await openLog(home, logEnv);
      io.out(`${edges.length} recorded change(s) for ${agent.agent}`);
      for (const e of edges) {
        const ch = (e.body as any).change;
        const gates: string[] = ch.gates ?? [];
        io.out(`  ${e.issued_at}  ${ch.layer.padEnd(8)} ${ch.description}`);
        if (!gates.length) io.out("      no canary result cited");
        for (const g of gates) {
          const rec = await local.log.get(g);
          const b = rec?.record.body as { verdict?: string; score?: number; reasons?: string[] } | undefined;
          io.out(rec ? `      canary ${b?.verdict}, ${Math.round((b?.score ?? 0) / 10)}% of trials; ${b?.reasons?.[0] ?? ""}  (${g.slice(0, 19)})` : `      cites ${g.slice(0, 19)}, which is not in this log`);
        }
      }
    } finally { await finishPackage(resolved, false); }
    return 0;
  }
  if (sub === "list") {
    const suite = load<CanarySuite>(suitePath);
    io.out(`${suite.name}: ${suite.tasks.length} tasks`);
    for (const t of suite.tasks) io.out(`  ${t.id.padEnd(22)} ${t.probes ?? ""}  (${t.checks.length} checks, scopes ${(t.scopes ?? ["repo.read"]).join(",")}, ${t.trials ?? 3} trials)`);
    return 0;
  }
  if (sub === "compare") {
    if (rest.length < 2) throw new UsageError("usage: asp canary compare <baseline.json> <current.json>");
    const cmp = compareReports(load<CanaryReport>(rest[0]), load<CanaryReport>(rest[1]));
    io.out(formatComparison(cmp));
    return cmp.regressions.length ? 1 : 0;
  }
  if (sub !== "run") throw new UsageError("usage: asp canary run --target <file | openrouter:<model>> [--suite <file>] [--trials n] [--only id,id] [--out report.json] [--baseline report.json] | compare <baseline> <current> | list");
  const t = v.target;
  if (!t) throw new UsageError("--target is a JSON file describing the agent, or <provider>:<model> (openrouter, groq, cerebras, gemini) for the reference agent on that model");
  let target: CanaryTarget;
  const provider = Object.keys(PROVIDERS).find((p) => t.startsWith(`${p}:`));
  if (provider) {
    const spec = PROVIDERS[provider];
    const keyFile = join(homedir(), spec.keyFile);
    const key = io.env[spec.envKey] ?? (provider === "openrouter" ? io.env.OPENROUTER_API_KEY : undefined) ?? (existsSync(keyFile) ? readFileSync(keyFile, "utf8").trim() : undefined);
    if (!key) throw new UsageError(`${provider} targets need the key in ${spec.envKey} or in ${keyFile}`);
    target = providerTarget(provider, t.slice(provider.length + 1), key);
  } else target = load<CanaryTarget>(t);
  const suite = load<CanarySuite>(suitePath);
  const trials = v.trials === undefined ? undefined : Math.trunc(Number(v.trials));
  if (trials !== undefined && (!Number.isInteger(trials) || trials < 1)) throw new UsageError("--trials must be a whole number, at least 1");
  io.err(`canary ${suite.name} on ${target.name}`);
  const report = await runCanary({
    suite, target, trials, only: v.only?.split(",").map((x) => x.trim()),
    run: canaryRunCli(io), packageDir: v.package ? resolve(io.cwd, v.package) : undefined,
    log: (l) => io.err(l),
  });
  io.out(formatReport(report));
  if (v.out) { writeFileSync(resolve(io.cwd, v.out), JSON.stringify(report, null, 2) + "\n"); io.out(`report written to ${v.out}`); }
  if (v.baseline) {
    const cmp = compareReports(load<CanaryReport>(v.baseline), report);
    io.out("");
    io.out(formatComparison(cmp));
    return cmp.regressions.length ? 1 : 0;
  }
  return report.totals.passedTasks === report.totals.tasks ? 0 : 1;
}

/**
 * asp gateway: runs any agent process under a contract's Mandate through the ASP gateway (docs/gateway-design.md, P0).
 * The agent is pointed at the gateway with OPENAI_BASE_URL / ANTHROPIC_BASE_URL; tool calls the Mandate does not allow
 * are removed from the model's reply before the agent sees them. Without a command it serves until interrupted.
 */
async function gatewayCmd(home: string, command: string[], v: Values, need: Need, io: Io): Promise<number> {
  const contract = need("contract");
  const by = need("by");
  if (!v["openai-upstream"] && !v["anthropic-upstream"]) throw new UsageError("give --openai-upstream <base url up to /v1> and/or --anthropic-upstream <origin>");
  const local = await openLog(home, logEnv);
  const state = (await local.log.chainInfo(contract))?.state;
  if (state !== "Running" && state !== "Checkpoint") throw new Error(`contract ${contract} is ${state ?? "not in the log"}, not Running, so there is no live Mandate to enforce`);
  const mandate = await local.log.mandateOf(contract);
  if (!mandate) throw new Error(`contract ${contract} has no Mandate`);
  let knownBad: KnownBadEntry[] = [];
  try { knownBad = await loadKnownBad(home, io); } catch (e) { io.err(`  warning  could not read the known-bad list, so it is not enforced: ${(e as Error).message}`); }
  const keyFrom = (name: string | undefined) => (name ? io.env[name] : undefined);
  // The Mandate's irreversible policy: gated scopes are held for the principal's signed answer, or refused.
  const approvalWait = v["approval-wait"] === undefined ? 600 : Number(v["approval-wait"]);
  if (!Number.isInteger(approvalWait) || approvalWait < 1) throw new UsageError("--approval-wait must be a whole number of seconds, at least 1");
  const mandateRecord = (await local.log.chain(contract)).filter((x) => x.record.type === "asp.mandate/v0.2").at(-1);
  const irreversible = (mandateRecord?.record.body as { irreversible?: { policy?: string; scopes?: string[] } } | undefined)?.irreversible;
  const gateOn = !!irreversible?.scopes?.length && irreversible.policy !== "allow";
  const gwRunDir = join(home, "runs", `gateway-${now().replace(/:/g, "")}`);
  const approvalsDir = join(gwRunDir, "approvals");
  // Memory: the agent's notes are served to it by the gateway's own MCP server (asp_memory_*), from a copy that is written back after the run.
  const pkgDir = v.package ? resolve(io.cwd, v.package) : undefined;
  if (pkgDir) {
    const report = await verifyPackage(pkgDir);
    if (!report.ok) throw new Error(`the package does not verify (${report.checks.filter((c) => c.status === "fail").map((c) => c.name).join(", ")}); run asp verify for details`);
    if (report.agent !== by) throw new UsageError(`--by must be the package's agent, ${report.agent}`);
  }
  const memDir = join(gwRunDir, "memory");
  const baseMemory = join(gwRunDir, "memory-base");
  mkdirSync(join(memDir, "auto"), { recursive: true });
  mkdirSync(baseMemory, { recursive: true });
  if (pkgDir && existsSync(join(pkgDir, "memory"))) { cpSync(join(pkgDir, "memory"), memDir, { recursive: true }); cpSync(join(pkgDir, "memory"), baseMemory, { recursive: true }); }
  // The agent's other MCP servers, put behind the gateway so every call is judged: --mcp name=https://host/mcp or --mcp name=stdio:command args
  const upstreams: Record<string, McpUpstream> = {};
  for (const spec of v.mcp ?? []) {
    const eq = spec.indexOf("=");
    const name = spec.slice(0, eq);
    const target = spec.slice(eq + 1);
    if (eq < 1 || !/^[A-Za-z0-9_-]+$/.test(name) || name === "asp" || !target) throw new UsageError(`--mcp must be <name>=<https url> or <name>=stdio:<command> [args], got "${spec}"`);
    if (target.startsWith("stdio:")) { const parts = [...target.slice(6).matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]); upstreams[name] = stdioUpstream(parts[0], parts.slice(1), io.env, io.cwd); }
    else upstreams[name] = httpUpstream(target);
  }
  const commonsUrl = io.env.ASP_LOG_URL;
  const citerKey = new Keystore(home).forDid(by);
  const commons = commonsUrl ? {
    url: commonsUrl, token: io.env.ASP_LOG_TOKEN,
    ...(citerKey ? { cite: async (entry: string, context: string) => {
      const doc = signCommons({ v: COMMONS_VERSION, kind: "citation", entry, citer: by, context, createdAt: now() }, citerKey);
      const res = await fetchRetry(new URL("commons/citations", commonsUrl.endsWith("/") ? commonsUrl : commonsUrl + "/"), { method: "POST", headers: { "content-type": "application/json", ...(io.env.ASP_LOG_TOKEN ? { authorization: `Bearer ${io.env.ASP_LOG_TOKEN}` } : {}) }, body: JSON.stringify(doc) });
      if (!res.ok) throw new Error(((await res.json().catch(() => undefined)) as any)?.error?.message ?? `the commons answered ${res.status}`);
    } } : {}),
  } : undefined;
  const gate = gateOn ? { scopes: irreversible!.scopes!, mode: (irreversible!.policy === "forbid" ? "deny" : "ask") as "ask" | "deny", waitSeconds: approvalWait, approvalsDir } : undefined;
  const approvals = gate?.mode === "ask"
    ? serveApprovals({ dir: approvalsDir, home, contract, agent: by, pollMs: Number(io.env.ASP_APPROVAL_POLL_MS) > 0 ? Number(io.env.ASP_APPROVAL_POLL_MS) : 1000, waitSeconds: approvalWait, io })
    : undefined;
  // The run log (E2): what the gateway sees, redacted, on this machine; the Actions commit to its hash.
  const runLog = v["no-run-log"] ? undefined : new RunRecorder(join(gwRunDir, "run-log.ndjson"));
  const gwHosts = (mandateRecord?.record.body as { network?: { hosts?: string[] } } | undefined)?.network?.hosts;
  runLog?.event("run_start", { contract, agent: by, scopes: mandate.scopes, ...(gwHosts ? { hosts: gwHosts } : {}), command: command.join(" "), assurance: v.sandbox ? "sandbox" : "gateway" });
  if (runLog) io.err(`  run log  ${runLog.path}`);
  const gw = createGateway({
    ...(runLog ? { runLog } : {}),
    ...(gate ? { gate } : {}),
    mcp: { asp: { memoryDir: memDir, ...(commons ? { commons } : {}) }, upstreams },
    openaiUpstream: v["openai-upstream"], anthropicUpstream: v["anthropic-upstream"],
    openaiKey: keyFrom(v["openai-key-env"]), anthropicKey: keyFrom(v["anthropic-key-env"]),
    scopes: mandate.scopes, hosts: (mandateRecord?.record.body as { network?: { hosts?: string[] } } | undefined)?.network?.hosts, knownBad: knownBad.map((e) => ({ fingerprint: e.fingerprint, report: e.report })),
    maxStrikes: v["max-strikes"] === undefined ? 3 : Math.trunc(Number(v["max-strikes"])),
    ...(v["token-cap"] ? { tokenCap: Math.trunc(Number(v["token-cap"])) } : {}),
    onCall: (e) => {
      io.err(`  ${e.allowed ? "allowed" : "REFUSED"}  ${e.tool} -> ${e.scope || "no scope"}${e.reason ? `: ${e.reason}` : ""}`);
      reportSoon(e.allowed ? eagerMs : 20);
    },
    onStop: (r) => io.err(`  stopped  ${r}`),
  });
  // The sandbox level: the agent runs where its only way out is the gateway, unless the Mandate grants a network scope.
  // Two backends: bubblewrap (Linux, WSL) and Docker (any host with Docker, for agents that run in a Linux image).
  const sandbox = v.sandbox ?? false;
  const requested = v["sandbox-backend"] ?? "auto";
  if (!["auto", "bwrap", "docker"].includes(requested)) throw new UsageError("--sandbox-backend is auto, bwrap or docker");
  let backend: "bwrap" | "docker" | undefined;
  if (sandbox) {
    const bw = sandboxAvailable();
    const dockerOk = () => spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { stdio: "ignore" }).status === 0;
    if (requested === "bwrap" || (requested === "auto" && bw.ok)) {
      if (!bw.ok) throw new Error(`--sandbox: ${bw.reason}`);
      backend = "bwrap";
    } else {
      if (!dockerOk()) throw new Error(`--sandbox: ${requested === "auto" ? `${bw.reason}; and ` : ""}Docker is not available (is Docker Desktop running?)`);
      backend = "docker";
    }
  }
  const sandboxNet = sandbox && policyNeedsNetwork(mandate.scopes);
  const socketDir = join(gwRunDir, "sock");
  const RELAY_PORT = 18080;
  const sandboxImage = v["sandbox-image"] ?? "python:3.13-alpine";
  let base: string;
  let dockerRun: ReturnType<typeof dockerPlan> | undefined;
  if (backend === "bwrap" && !sandboxNet) {
    mkdirSync(socketDir, { recursive: true });
    writeFileSync(join(socketDir, "relay.py"), RELAY_PY);
    writeFileSync(join(socketDir, "relay.cjs"), RELAY_JS);
    await gw.listenUnix(join(socketDir, "gw.sock"));
    base = `http://127.0.0.1:${RELAY_PORT}`;
  } else {
    const gwPort = await gw.listen(v.port === undefined ? 0 : Math.trunc(Number(v.port)));
    base = `http://127.0.0.1:${gwPort}`;
    if (backend === "docker") {
      mkdirSync(gwRunDir, { recursive: true });
      const relayScriptPath = join(gwRunDir, "relay-tcp.py");
      writeFileSync(relayScriptPath, RELAY_TCP_PY);
      const mcpFile = join(gwRunDir, "mcp.json");
      const extraBinds = (v["sandbox-bind"] ?? []).map((x) => (x.endsWith(":rw") ? { path: resolve(io.cwd, x.slice(0, -3)), writable: true } : { path: resolve(io.cwd, x) }));
      dockerRun = dockerPlan({
        id: randomUUID().slice(0, 8), image: sandboxImage, projectDir: resolve(io.cwd, v.project ?? "."), projectWritable: mandate.scopes.includes("repo.write"),
        network: sandboxNet, gatewayPort: gwPort, relayPort: RELAY_PORT, relayScriptPath, env: {}, extraBinds, files: [{ host: mcpFile, container: "/asp/mcp.json" }],
      });
      base = dockerRun.agentBase;
    }
  }
  const mcpConfig = join(gwRunDir, "mcp.json");
  writeFileSync(mcpConfig, JSON.stringify({ mcpServers: Object.fromEntries(["asp", ...Object.keys(upstreams)].map((n) => [n, { type: "http", url: `${base}/mcp/${n}` }])) }, null, 2));
  io.err(`  mcp      ${mcpConfig}  (servers: ${["asp", ...Object.keys(upstreams)].join(", ")}; the child gets it as ASP_MCP_CONFIG)`);
  io.err(`  gateway  ${base}  Mandate scopes: ${mandate.scopes.join(", ") || "none"}${knownBad.length ? `; ${knownBad.length} known-bad fingerprint(s)` : ""}`);
  // Reports follow the activity instead of waiting for the next interval (E15): a settled job takes no more Actions, so whatever has not been
  // reported when a revoke or kill lands is lost from the log's Actions. A blocked attempt is reported at once (the evidence a kill rests on), other
  // activity within `ASP_GATEWAY_EAGER_MS` (default 2 s) of its first call. flushAction is defined below; these only run once it is.
  // ASP_GATEWAY_EAGER_MS=-1 turns eager reports off (tests of the late report need activity that has not been reported when the job ends).
  const eagerEnv = io.env.ASP_GATEWAY_EAGER_MS === undefined || io.env.ASP_GATEWAY_EAGER_MS === "" ? NaN : Number(io.env.ASP_GATEWAY_EAGER_MS);
  const eagerOff = eagerEnv < 0;
  const eagerMs = eagerEnv >= 0 ? eagerEnv : 2000;
  let soon: NodeJS.Timeout | undefined;
  let soonDue = Infinity;
  const reportSoon = (ms: number) => {
    if (eagerOff) return;
    const due = Date.now() + ms;
    if (soon && soonDue <= due) return;
    if (soon) clearTimeout(soon);
    soonDue = due;
    soon = setTimeout(() => { soon = undefined; soonDue = Infinity; void flushAction("activity"); }, ms);
  };
  // A contract that is revoked, killed or settled stops the gateway, and so the agent.
  // Actions are reported while the run goes on, not only at the end: a contract revoked or settled mid-run can no longer take one.
  let flushing = Promise.resolve(0);
  const flushAction = (why: string) => (flushing = flushing.then(async () => {
    const d = gw.drain();
    // Nothing to report only when nothing happened: tokens of a request that was counted in the interval before arrive in this one, and must not be dropped.
    const m = d.metrics;
    if (!d.scopesUsed.length && !d.blocked.length && m.requests === 0 && m.tool_calls === 0 && m.tokens_in === 0 && m.tokens_out === 0) return 0;
    const s = gw.summary();
    const args = ["market", "action", "--contract", contract, "--by", by, "--home", home,
      ...d.scopesUsed.flatMap((x) => ["--scopes-used", x]),
      ...d.blocked.flatMap((b) => ["--blocked", `${b.scope}=${b.count}`]),
      ...d.artifacts.flatMap((a) => ["--artifact", `${a.uri}=${a.sha256}`]),
      "--metrics", JSON.stringify(d.metrics),
      ...(runLog ? (() => { const a = runLogArtifact(runLog.head()); return ["--artifact", `${a.uri}=${a.sha256}`]; })() : []),
      "--assurance", sandbox ? "sandbox_enforced" : s.toolCalls > 0 ? "gateway_enforced" : "gateway_observed", "--summary", `ASP gateway (${sandbox ? "sandbox-enforced: the agent ran in a sandbox whose only way out was the gateway" : s.toolCalls > 0 ? "gateway-enforced" : "gateway-observed: no structured tool calls passed through, so nothing could be enforced"}, ${why}): ${s.requests} request(s) so far, ${s.tokens.input + s.tokens.output} tokens, ${s.strikes} blocked${s.stopped ? `; stopped: ${s.stopped}` : ""}`];
    const out: string[] = [];
    let rc = await main(args, { out: (l) => out.push(l), err: (l) => out.push(l), env: io.env, cwd: io.cwd });
    // The job ended (a revoke, a kill or a settlement) between the last report and this one: report what this interval covers as a late Action (S80).
    if (rc !== 0 && out.join(" ").includes("is not currently Running")) {
      out.length = 0;
      rc = await main([...args, "--late", d.lastActivityAt], { out: (l) => out.push(l), err: (l) => out.push(l), env: io.env, cwd: io.cwd });
      if (rc === 0) out.unshift("(late report: the job had ended)");
    }
    io.err(rc === 0 ? `  action   ${out.join(" ").slice(0, 200)}` : `  warning  could not record an Action (${why}): ${out.join(" ").slice(0, 200)}`);
    return rc;
  }));
  const flusher = setInterval(() => { void flushAction("interval"); }, Number(io.env.ASP_GATEWAY_FLUSH_MS) > 0 ? Number(io.env.ASP_GATEWAY_FLUSH_MS) : 30_000);
  const pollMs = Number(io.env.ASP_GATEWAY_POLL_MS) > 0 ? Number(io.env.ASP_GATEWAY_POLL_MS) : 2000;
  const watcher = setInterval(async () => {
    try {
      // A local log is read once when it is opened, so reopen it to see records another process has added.
      const st = (await (await openLog(home, logEnv)).log.chainInfo(contract))?.state;
      if (st !== "Running" && st !== "Checkpoint") gw.stop(`the contract is now ${st}`);
    } catch { /* keep the last known state */ }
  }, pollMs);
  let code = 0;
  if (command.length) {
    code = await new Promise<number>((done) => {
      // The provider keys the gateway holds are removed from the agent's environment: it gets a placeholder and the gateway adds the real key.
      const childBase: NodeJS.ProcessEnv = { ...io.env };
      for (const k of [v["openai-key-env"], v["anthropic-key-env"]]) if (k) delete childBase[k];
      const agentEnv: Record<string, string> = {
        ASP_MCP_CONFIG: mcpConfig, ASP_GATEWAY_URL: base, OPENAI_BASE_URL: `${base}/v1`, OPENAI_API_BASE: `${base}/v1`, ANTHROPIC_BASE_URL: base,
        ...(v["openai-key-env"] ? { OPENAI_API_KEY: "asp-gateway" } : {}), ...(v["anthropic-key-env"] ? { ANTHROPIC_API_KEY: "asp-gateway" } : {}),
      };
      let program = command[0];
      let programArgs = command.slice(1);
      let spawnEnv: NodeJS.ProcessEnv = { ...childBase, ...agentEnv };
      if (backend === "bwrap") {
        const projectDir = resolve(io.cwd, v.project ?? ".");
        const extraBinds = (v["sandbox-bind"] ?? []).map((b) => (b.endsWith(":rw") ? { path: resolve(io.cwd, b.slice(0, -3)), writable: true } : { path: resolve(io.cwd, b) }));
        program = "bwrap";
        programArgs = bwrapArgs({ projectDir, projectWritable: mandate.scopes.includes("repo.write"), network: sandboxNet, memoryDir: memDir, socketDir, relayPort: RELAY_PORT, extraBinds, env: agentEnv, home: homedir() }, command, childBase);
        spawnEnv = childBase;
        io.err(`  sandbox  bubblewrap: ${sandboxNet ? "network kept (the Mandate grants a network scope)" : "no network; the gateway is the only way out"}; project ${mandate.scopes.includes("repo.write") ? "writable" : "read-only"}; home hidden; environment cleared`);
      }
      if (backend === "docker" && dockerRun) {
        const dockerEnv = { ...agentEnv, ASP_MCP_CONFIG: "/asp/mcp.json" };
        const envArgs = Object.entries(dockerEnv).flatMap(([k, val]) => ["-e", `${k}=${val}`]);
        // dockerPlan put the image last; the agent's command goes after it, and its environment before it.
        const i = dockerRun.agent.length - 1;
        programArgs = [...dockerRun.agent.slice(0, i), ...envArgs, dockerRun.agent[i], ...command];
        program = "docker";
        spawnEnv = childBase;
        for (const step of dockerRun.setup) {
          const r = spawnSync("docker", step, { encoding: "utf8" });
          if (r.status !== 0) { io.err(`could not set up the container sandbox (docker ${step.slice(0, 2).join(" ")}): ${(r.stderr || r.stdout || "").trim().slice(0, 300)}`); for (const c of dockerRun.cleanup) spawnSync("docker", c, { stdio: "ignore" }); return done(-1); }
        }
        io.err(`  sandbox  docker (${sandboxImage}): ${sandboxNet ? "network kept (the Mandate grants a network scope)" : "internal network; a relay container is the only way out, to the gateway"}; project ${mandate.scopes.includes("repo.write") ? "writable" : "read-only"}; read-only root; capabilities dropped; environment is only what the gateway sets`);
      }
      // --capture <file> keeps the agent's standard output (and still shows it), for evaluations that check what the agent said.
      const capturing = !!v.capture;
      const child = spawn(program, programArgs, { cwd: io.cwd, stdio: capturing ? ["ignore", "pipe", "inherit"] : "inherit", env: spawnEnv });
      child.on("close", () => { for (const c of dockerRun?.cleanup ?? []) spawnSync("docker", c, { stdio: "ignore" }); });
      child.on("error", (e) => { io.err(`could not start ${command[0]}: ${e.message}`); done(-1); });
      if (capturing) {
        const chunks: Buffer[] = [];
        child.stdout!.on("data", (c: Buffer) => { chunks.push(c); (io.raw ?? ((b: Buffer) => process.stdout.write(b)))(c); });
        child.on("close", (c) => { writeFileSync(v.capture!, Buffer.concat(chunks)); done(c ?? 1); });
      } else child.on("exit", (c) => done(c ?? 1));
    });
  } else {
    await new Promise<void>((resolve) => { process.once("SIGINT", resolve); process.once("SIGTERM", resolve); });
  }
  clearInterval(watcher);
  clearInterval(flusher);
  if (soon) clearTimeout(soon);
  if (approvals) await approvals.stop();
  const sum0 = gw.summary();
  runLog?.event("run_end", { exit_code: code, requests: sum0.requests, tool_calls: sum0.toolCalls, tokens: sum0.tokens, scopes_used: sum0.scopesUsed, blocked: sum0.blocked, strikes: sum0.strikes, ...(sum0.stopped ? { stopped: sum0.stopped } : {}), redactions: runLog?.redactions });
  const rc = await flushAction("exit");
  const sum = gw.summary();
  await gw.close();
  if (pkgDir && !v["no-write-back"]) await gatewayWriteBack({ home, pkgDir, agent: by, memDir, baseMemory, gwRunDir, v, io });
  io.err(`  summary  ${JSON.stringify({ requests: sum.requests, toolCalls: sum.toolCalls, unjudged: sum.unjudgedRequests, tokens: sum.tokens, scopesUsed: sum.scopesUsed, blocked: sum.blocked, strikes: sum.strikes })}`);
  return rc !== 0 ? rc : code;
}

/** After a gateway run, the agent's memory goes back into its package the way `asp run` does it: diffed, merged with any other run's, kept in budget, signed. */
async function gatewayWriteBack(o: { home: string; pkgDir: string; agent: string; memDir: string; baseMemory: string; gwRunDir: string; v: Values; io: Io }): Promise<void> {
  const { home, pkgDir, agent, memDir, baseMemory, gwRunDir, v, io } = o;
  const diff = diffTrees(baseMemory, memDir);
  if (isEmptyDiff(diff)) return;
  let memoryFrom = memDir;
  const current = join(pkgDir, "memory");
  const otherChanges = existsSync(current) && !isEmptyDiff(diffTrees(baseMemory, current));
  if (otherChanges) {
    const mergedDir = join(gwRunDir, "memory-merged");
    cpSync(current, mergedDir, { recursive: true });
    for (const n of mergeMemoryInto(mergedDir, baseMemory, memDir, { name: "this run", label: "run", other: "another run's" })) io.err(`  note     ${n}`);
    memoryFrom = mergedDir;
    io.err("  note     another run changed this agent's memory while this one ran; the two were merged");
  }
  const budget = enforceMemoryBudget(memoryFrom, memoryBudget(v));
  for (const f of budget.pruned) io.err(`  note     memory over budget: pruned ${f}`);
  const signer = new Keystore(home).forDid(agent);
  if (!signer) { io.err(`no key for ${agent} in ${join(home, "keys")}: cannot sign the lineage update. The run's memory is in ${memDir}.`); return; }
  const applied = await applyChange({ home, io, v, agent, backend: "gateway", pkgDir, signer, memoryFrom, keptAt: memDir, changes: [{ layer: "memory", description: `memory updated during a gateway run: +${diff.added.length} ~${diff.changed.length} -${diff.removed.length} files${otherChanges ? ", merged with another run" : ""}${budget.pruned.length ? `, pruned ${budget.pruned.length} over budget` : ""}` }] });
  if (applied.blocked) return;
  const edges = applied.edges;
  for (const e of edges) io.err(`  recorded ${(e.body as any).change.description} (${e.id})`);
  io.err(`  package  ${pkgDir} re-signed`);
  await syncLocalLog(home, pkgDir, agent, io);
}

/** The known-bad list this command line points at: the log service's when ASP_LOG_URL is set, else a file in the ASP home. */
async function loadKnownBad(home: string, io: Io): Promise<KnownBadEntry[]> {
  return io.env.ASP_LOG_URL ? await fetchKnownBad(io.env.ASP_LOG_URL, io.env.ASP_LOG_TOKEN) : readKnownBad(join(home, "known-bad.json"));
}

/** The gateway run folder whose run log belongs to this contract (the newest), or undefined. */
function findRunLog(home: string, contract: string): string | undefined {
  const runs = join(home, "runs");
  if (!existsSync(runs)) return undefined;
  for (const d of readdirSync(runs).sort((a, b) => (a.match(/\d{4}-\d\d-\d\dT\d+Z$/)?.[0] ?? a).localeCompare(b.match(/\d{4}-\d\d-\d\dT\d+Z$/)?.[0] ?? b)).reverse()) {
    const file = join(runs, d, "run-log.ndjson");
    if (!existsSync(file)) continue;
    const first = readFileSync(file, "utf8").split("\n", 1)[0];
    try { if (JSON.parse(first)?.data?.contract === contract) return file; } catch { /* not a run log */ }
  }
  return undefined;
}

/** asp mail preview|queue|pending|watch|address: see the header. */
async function mailCmd(home: string, sub: string | undefined, rest: string[], v: Values, io: Io): Promise<number> {
  const USAGE = "usage: asp mail preview|queue --contract <id> [--to <address>] [--run-log <file|folder>] [--link-base <url>] [--html] [--again] | pending | watch [--once] [--interval <seconds>] [--to <address>] | address set <did> <address> | address list";
  if (!["preview", "queue", "pending", "watch", "address"].includes(sub ?? "")) throw new UsageError(USAGE);
  const statePath = join(home, "mail-state.json");
  const addressPath = join(home, "mail-addresses.json");
  const readJson = <T,>(p: string, fallback: T): T => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback);
  const state: Record<string, { queuedAt: string; to: string; file: string }> = readJson(statePath, {});
  const addresses: Record<string, string> = readJson(addressPath, {});

  if (sub === "address") {
    if (rest[0] === "list") {
      for (const [did, a] of Object.entries(addresses)) io.out(`  ${did}  ${a}`);
      io.out(`${Object.keys(addresses).length} address(es)`);
      return 0;
    }
    if (rest[0] !== "set" || !rest[1] || !rest[2]) throw new UsageError(USAGE);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rest[2])) throw new UsageError(`"${rest[2]}" does not look like an email address`);
    addresses[rest[1]] = rest[2];
    writeFileSync(addressPath, JSON.stringify(addresses, null, 2));
    io.out(`mail for ${rest[1]} goes to ${rest[2]}`);
    return 0;
  }

  const local = await openLog(home, logEnv);
  const runLogFor = (contract: string) => {
    const given = v["run-log"] ? resolve(io.cwd, v["run-log"]) : findRunLog(home, contract);
    const file = given && !given.endsWith(".ndjson") ? join(given, "run-log.ndjson") : given;
    return file && existsSync(file) ? { ...readRunLog(file), path: file } : undefined;
  };
  const linkBase = v["link-base"] ? { linkBase: v["link-base"] } : {};
  const outbox = join(home, "outbox");
  /** Writes the .eml, .html and .txt, and records that this key was mailed. */
  const queueFiles = (key: string, label: string, mail: { eml: string; html: string; text: string }, to: string) => {
    mkdirSync(outbox, { recursive: true });
    const stem = join(outbox, `${label}-${key.replace(/[^A-Za-z0-9]/g, "").slice(-16)}${state[key] ? "-" + Date.now() : ""}`);
    writeFileSync(stem + ".eml", mail.eml);
    writeFileSync(stem + ".html", mail.html);
    writeFileSync(stem + ".txt", mail.text);
    state[key] = { queuedAt: now(), to, file: stem + ".eml" };
    writeFileSync(statePath, JSON.stringify(state, null, 2));
    return stem + ".eml";
  };
  /** Everything that should be mailed and has not been: ended Mandates, and alerts. */
  const due = async () => {
    const all = await local.log.since(0, 1_000_000);
    const finals: string[] = [];
    for (const c of all.filter((s) => s.record.type === "asp.contract/v0.2").map((s) => s.id)) {
      if ((await local.log.chainInfo(c))?.state === "Settled" && !state[c]) finals.push(c);
    }
    const alerts = (await findAlerts(local.log)).filter((a) => !state[a.key]);
    return { finals, alerts };
  };

  if (sub === "pending" || sub === "watch") {
    const pass = async (): Promise<number> => {
      const { finals, alerts } = await due();
      let queued = 0;
      const send = async (key: string, label: string, contract: string, build: (f: MandateFacts, to: string) => { eml: string; html: string; text: string; subject: string }) => {
        const f = await collectMandateFacts(local.log, contract);
        if (!f) return;
        const to = v.to ?? addresses[f.contract.principal];
        if (sub === "pending") { io.out(`  ${label.padEnd(13)} ${f.contract.purpose}  (${contract.slice(0, 19)}, principal ${f.contract.principal}${to ? ` -> ${to}` : ", NO ADDRESS"})`); return; }
        if (!to) { io.err(`  skipped  ${label} for ${contract.slice(0, 19)}: no address for ${f.contract.principal} (asp mail address set <did> <address>)`); return; }
        const mail = build(f, to);
        io.out(`queued ${queueFiles(key, label, mail, to)} to ${to}: ${mail.subject}`);
        queued++;
      };
      for (const a of alerts) await send(a.key, `alert-${a.kind}`, a.contract, (f, to) => buildAlertMail(a, f, { to, ...linkBase }));
      for (const c of finals) await send(c, "end", c, (f, to) => buildMandateMail(f, { to, ...(runLogFor(c) ? { runLog: runLogFor(c)! } : {}), ...linkBase }));
      if (sub === "pending") io.out(`${finals.length} ended Mandate(s) and ${alerts.length} alert(s) not mailed yet`);
      return queued;
    };
    if (sub === "pending") { await pass(); return 0; }
    io.err("  not sent: delivery to a mail provider is not built; mail is queued in the outbox");
    const n = await pass();
    if (v.once) { io.out(`${n} mail(s) queued`); return 0; }
    const every = Number(v.interval) > 0 ? Number(v.interval) * 1000 : 30_000;
    io.err(`  watching the log every ${every / 1000} s; Ctrl-C stops`);
    const timer = setInterval(() => { void pass().catch((e) => io.err(`  watch    ${(e as Error).message}`)); }, every);
    await new Promise<void>((resolveStop) => { process.once("SIGINT", resolveStop); process.once("SIGTERM", resolveStop); });
    clearInterval(timer);
    return 0;
  }

  const contract = v.contract;
  if (!contract) throw new UsageError("--contract <id> is required");
  const facts = await collectMandateFacts(local.log, contract);
  if (!facts) throw new Error(`contract ${contract} is not in the log`);
  const runLog = runLogFor(contract);
  const mail = buildMandateMail(facts, { to: v.to ?? addresses[facts.contract.principal] ?? "principal@localhost", ...(runLog ? { runLog } : {}), ...linkBase });
  if (sub === "preview") {
    io.out(v.html ? mail.html : mail.text);
    return 0;
  }
  const to = v.to ?? addresses[facts.contract.principal];
  if (!to) throw new UsageError("--to <address> is required for queue (or set the principal's address with asp mail address set)");
  if (facts.state !== "Settled") throw new Error(`contract ${contract} is ${facts.state}, not ended: the mail goes out when the Mandate ends`);
  if (state[contract] && !v.again) throw new Error(`contract ${contract} was already mailed (queued ${state[contract].queuedAt} to ${state[contract].to}); one mail per Mandate. Use --again to queue it a second time.`);
  io.out(`queued ${queueFiles(contract, "end", mail, to)} to ${to}: ${mail.subject}`);
  io.out("  not sent: delivery to a mail provider is not built; the .eml is in the outbox");
  return 0;
}

/**
 * asp run-log show|verify [<run-log file or gateway run folder>] [--contract <id>] [--json]: the redacted run log a gateway run kept (gap E2).
 * show prints it as a timeline; verify checks every line's hash chain and, with --contract, that each Action's run-log artifact matches the log.
 */
async function runLogCmd(home: string, sub: string | undefined, rest: string[], v: Values, io: Io): Promise<number> {
  if (sub !== "show" && sub !== "verify") throw new UsageError("usage: asp run-log show|verify [<run-log.ndjson | gateway run folder>] [--contract <id>] [--json]");
  let target = rest[0];
  if (!target) {
    const runs = join(home, "runs");
    const stamp = (d: string) => d.match(/\d{4}-\d\d-\d\dT\d+Z$/)?.[0] ?? d;
    const latest = existsSync(runs) ? readdirSync(runs).filter((d) => existsSync(join(runs, d, "run-log.ndjson"))).sort((a, b) => stamp(a).localeCompare(stamp(b))).at(-1) : undefined;
    if (!latest) throw new Error(`no run with a run log in ${runs}; give the file or folder`);
    target = join(runs, latest);
  }
  const file = target.endsWith(".ndjson") ? resolve(io.cwd, target) : join(resolve(io.cwd, target), "run-log.ndjson");
  const check = readRunLog(file);
  if (sub === "show") {
    if (!check.ok) io.err(`warning  ${check.problem}`);
    if (v.json) { for (const e of check.events) io.out(JSON.stringify(e)); return check.ok ? 0 : 1; }
    const q = (t: unknown) => JSON.stringify(typeof t === "string" ? t.replace(/\s+/g, " ") : t);
    for (const e of check.events) {
      const d = e.data as Record<string, any>;
      const time = e.at.slice(11, 19);
      const text = e.kind === "run_start" ? `contract ${String(d.contract).slice(0, 19)} agent ${d.agent}; scopes ${(d.scopes ?? []).join(", ") || "none"}${d.hosts ? `; hosts ${d.hosts.join(", ")}` : ""}`
        : e.kind === "model_request" ? `${d.model ?? "?"} (${d.api}) asked: ${q(d.prompt)}`
        : e.kind === "model_reply" ? `${d.tokens_in} in / ${d.tokens_out} out, ${d.ms} ms${d.text ? `: ${q(d.text)}` : ""}`
        : e.kind === "tool_call" ? `${d.allowed === undefined ? "" : d.allowed ? "allowed " : "REFUSED "}${d.tool}${d.scope !== undefined ? ` -> ${d.scope || "no scope"}` : ""}${d.reason ? ` (${d.reason})` : ""}${d.gated ? " [gated]" : ""}: ${q(d.input)}`
        : e.kind === "model_error" ? `provider answered ${d.status}`
        : e.kind === "stopped" ? `stopped: ${d.reason}`
        : e.kind === "run_end" ? `exit ${d.exit_code}; ${d.requests} request(s), ${d.tool_calls} tool call(s), ${d.strikes} blocked, ${d.redactions} secret-like value(s) masked`
        : e.kind === "assistant_text" ? q(d.text)
        : e.kind === "tool_result" ? `${d.blocked ? "BLOCKED " : d.error ? "failed " : ""}${q(d.text)}`
        : e.kind === "mcp_call" ? `${d.server}/${d.tool}${d.error ? " (error)" : ""}: ${q(d.input)} -> ${q(d.result)}`
        : e.kind === "call_judged" ? `${d.scope} ${d.granted ? "granted" : "NOT granted"}${d.gated ? " [gated]" : ""}${d.known_bad ? " [known bad]" : ""}`
        : e.kind === "strike" ? `${d.scope} was ${d.how} (${d.strikes} of ${d.max})`
        : e.kind === "kill" ? `${d.reason}: ${q(d.message)}`
        : e.kind === "run_result" ? `${[d.status, d.turns !== undefined ? `${d.turns} turn(s)` : "", d.tokens_in !== undefined ? `${d.tokens_in} in / ${d.tokens_out} out` : ""].filter(Boolean).join(", ")}`
        : JSON.stringify(d);
      io.out(`${time}  ${e.kind.padEnd(13)} ${text}`);
    }
    io.out(`${check.events.length} event(s); head ${check.head.hash.slice(0, 19)}${check.ok ? "" : `; NOT VERIFIED: ${check.problem}`}`);
    return check.ok ? 0 : 1;
  }
  if (!check.ok) { io.out(`run log NOT ok: ${check.problem}`); return 1; }
  io.out(`run log ok: ${check.head.events} event(s), head ${check.head.hash}`);
  if (!v.contract) return 0;
  const local = await openLog(home, logEnv);
  const actions = (await local.log.since(0, 100000)).filter((x) => x.record.type === "asp.action/v0.2" && (x.record.body as { contract: string }).contract === v.contract);
  let checked = 0, bad = 0;
  for (const a of actions) {
    for (const art of ((a.record.body as { artifacts?: { uri: string; sha256: string }[] }).artifacts ?? [])) {
      const m = /^asp:\/\/run-log\/(\d+)$/.exec(art.uri);
      if (!m) continue;
      const n = Number(m[1]);
      checked++;
      const want = n <= check.events.length ? hashAfter(check.events, n) : undefined;
      if (want === art.sha256) io.out(`  action ${a.id.slice(0, 19)} commits to the first ${n} event(s): matches`);
      else { bad++; io.out(`  action ${a.id.slice(0, 19)} commits to ${n} event(s) and ${want ? "the hash does not match" : "this file has fewer events"}`); }
    }
  }
  io.out(checked ? `${checked - bad} of ${checked} Action commitment(s) match` : "no Action of this contract commits to a run log");
  return bad ? 1 : 0;
}

/** asp known-bad add|list: command fingerprints that an upheld report found harmful (docs/spec-deltas.md S54). */
async function knownBadCmd(home: string, sub: string | undefined, v: Values, need: Need, io: Io): Promise<number> {
  if (sub === "list") {
    const list = await loadKnownBad(home, io);
    io.out(`${list.length} known-bad fingerprint(s)`);
    for (const e of list) io.out(`  ${e.fingerprint}  report ${e.report.slice(0, 19)}  added ${e.addedAt} by ${e.addedBy}${e.note ? "  " + e.note : ""}`);
    return 0;
  }
  if (sub !== "add") throw new UsageError("usage: asp known-bad add --report <id> --by <did> [--fingerprint <fp> | --all] [--note <text>] | list");
  const reportId = need("report");
  const by = need("by");
  const local = await openLog(home, logEnv);
  const report = await local.log.report(reportId);
  if (!report) throw new Error(`${reportId} is not a report in the log`);
  if (report.status !== "upheld") throw new Error(`report ${reportId} is ${report.status}; only an upheld report can put a command on the known-bad list`);
  const actions = await collectWatchActions(local);
  const ran = new Set(actions.filter((a) => a.contract === report.contract).flatMap((a) => a.artifacts.filter((f) => f.uri === "asp://shell-command").map((f) => `${f.uri}#${f.sha256}`)));
  let chosen: string[];
  if (v.fingerprint) {
    if (!isKnownBadFingerprint(v.fingerprint)) throw new UsageError("--fingerprint looks like asp://shell-command#sha256:<64 hex digits> (see asp watch)");
    if (!ran.has(v.fingerprint)) throw new Error(`the reported job ${report.contract} never ran a command with that fingerprint`);
    chosen = [v.fingerprint];
  } else {
    const minAgents = v["min-agents"] === undefined ? 3 : Math.trunc(Number(v["min-agents"]));
    const windowS = v.window === undefined ? 600 : Number(v.window);
    const clusters = findContagion(actions, { minAgents, windowMs: windowS * 1000, all: v.all ?? false })
      .filter((c) => c.kind === "same-input" && c.contracts.includes(report.contract) && ran.has(c.key));
    chosen = [...new Set(clusters.map((c) => c.key))];
    if (!chosen.length) throw new Error(`no shell command shared by ${minAgents}+ agents includes the reported job; name one with --fingerprint (the reported job ran ${ran.size} shell command(s))`);
    if (chosen.length > 1 && !v.all) {
      io.err(`${chosen.length} candidate fingerprints; pick one with --fingerprint, or add them all with --all:`);
      for (const f of chosen) io.err(`  ${f}`);
      return 2;
    }
  }
  let added = 0;
  for (const fingerprint of chosen) {
    const entry: KnownBadEntry = { fingerprint, report: reportId, contract: report.contract, addedAt: now(), addedBy: by, ...(v.note ? { note: v.note } : {}) };
    const created = io.env.ASP_LOG_URL ? await postKnownBad(io.env.ASP_LOG_URL, io.env.ASP_LOG_TOKEN, entry) : addKnownBad(join(home, "known-bad.json"), entry);
    io.out(`${created ? "listed" : "already listed"}: ${fingerprint}`);
    added += created ? 1 : 0;
  }
  return 0;
}

/** asp commons add|list|show|cite|review: shared knowledge with citations and review (docs/spec-deltas.md S52). */
async function commonsCmd(home: string, sub: string | undefined, rest: string[], v: Values, need: Need, io: Io): Promise<number> {
  const url = io.env.ASP_LOG_URL;
  if (!url) throw new UsageError("set ASP_LOG_URL (and ASP_LOG_TOKEN) to a log service started with --commons <dir>");
  const call = async (method: string, path: string, body?: unknown): Promise<any> => {
    const res = await fetchRetry(new URL(path, url.endsWith("/") ? url : url + "/"), {
      method,
      headers: { ...(io.env.ASP_LOG_TOKEN ? { authorization: `Bearer ${io.env.ASP_LOG_TOKEN}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(60_000),
    });
    if (res.status === 401) throw new Error("the service refused the request (set ASP_LOG_TOKEN)");
    const json = await res.json().catch(() => undefined) as any;
    if (!res.ok) throw new Error(json?.error ? `${json.error.message} (${json.error.code})` : `the commons answered ${res.status}`);
    return json;
  };
  const signerFor = (did: string) => {
    const signer = new Keystore(home).forDid(did);
    if (!signer) throw new Error(`no key for ${did} in ${join(home, "keys")}: only its holder can sign for it`);
    return signer;
  };
  const line = (e: any) => `  ${e.id.slice(0, 19)}  [${e.status}] ${e.title}  by ${e.author}  +${e.endorsements} -${e.disputes}  cited by ${e.citations}${e.tags.length ? "  #" + e.tags.join(" #") : ""}`;
  if (sub === "list") {
    const qs = new URLSearchParams();
    if (v.tag) qs.set("tag", v.tag);
    if (v.q) qs.set("q", v.q);
    if (v.status) qs.set("status", v.status);
    const r = await call("GET", `commons/entries?${qs}`);
    io.out(`${r.entries.length} entr${r.entries.length === 1 ? "y" : "ies"}`);
    for (const e of r.entries) io.out(line(e));
    return 0;
  }
  if (sub === "show") {
    const id = rest[0];
    if (!id) throw new UsageError("usage: asp commons show <entry-id>");
    const r = await call("GET", `commons/entries/${encodeURIComponent(id)}`);
    io.out(`${r.entry.title}  [${r.status}]  by ${r.entry.author}  ${r.entry.createdAt}`);
    io.out(`  ${r.id}`);
    io.out("");
    io.out(r.entry.text.trimEnd());
    io.out("");
    io.out(`  ${r.endorsements} endorsement(s), ${r.disputes} dispute(s), cited by ${r.citations} agent(s)`);
    for (const x of r.reviews) io.out(`    ${x.verdict}  ${x.reviewer}${x.note ? ": " + x.note : ""}`);
    for (const c of r.cited) io.out(`    cited by ${c.citer}: ${c.context}`);
    return 0;
  }
  const by = need("by");
  if (sub === "add") {
    const file = rest[0];
    if (!file) throw new UsageError("usage: asp commons add <file> --by <agent-did> --title <title> [--tag a,b] [--contract <id>]");
    const title = need("title");
    // A job's Mandate says whether what the agent learns may be shared: respect it.
    if (v.contract) {
      const local = await openLog(home, logEnv);
      const rec = (await local.log.chain(v.contract)).filter((x) => x.record.type === "asp.mandate/v0.2").at(-1);
      const share = (rec?.record.body as { learning?: { share_to_commons?: boolean } } | undefined)?.learning?.share_to_commons;
      if (!share) throw new Error(`contract ${v.contract} does not let ${by} share to the commons (learning.share_to_commons is not true in its Mandate)`);
    }
    const tags = (v.tag ?? "").split(",").map((t) => t.trim()).filter(Boolean);
    const doc = signCommons({ v: COMMONS_VERSION, kind: "entry", author: by, title, text: readFileSync(resolve(file), "utf8"), tags, createdAt: now(), ...(v.contract ? { contract: v.contract } : {}) }, signerFor(by));
    const r = await call("POST", "commons/entries", doc);
    io.out(`${r.created ? "shared" : "already shared"}: ${r.id}`);
    return 0;
  }
  if (sub === "review") {
    const id = rest[0];
    if (!id) throw new UsageError("usage: asp commons review <entry-id> --by <did> --verdict endorse|dispute [--note <text>]");
    if (v.verdict !== "endorse" && v.verdict !== "dispute") throw new UsageError("--verdict is endorse or dispute");
    const doc = signCommons({ v: COMMONS_VERSION, kind: "review", entry: id, reviewer: by, verdict: v.verdict, ...(v.note ? { note: v.note } : {}), createdAt: now() }, signerFor(by));
    const r = await call("POST", "commons/reviews", doc);
    io.out(`recorded: ${v.verdict}; the entry is now ${r.status}`);
    return 0;
  }
  if (sub === "cite") {
    const id = rest[0];
    if (!id) throw new UsageError("usage: asp commons cite <entry-id> --by <did> --context <what you used it for>");
    const doc = signCommons({ v: COMMONS_VERSION, kind: "citation", entry: id, citer: by, context: need("context"), createdAt: now() }, signerFor(by));
    const r = await call("POST", "commons/citations", doc);
    io.out(`${r.created ? "cited" : "already cited"}: ${r.id}`);
    return 0;
  }
  throw new UsageError("usage: asp commons add|list|show|review|cite");
}

/** asp package push|pull|list|delete: a tenant's packages on the log service (docs/spec-deltas.md S51). */
async function packageCmd(home: string, sub: string | undefined, rest: string[], v: Values, need: Need, io: Io): Promise<number> {
  const url = io.env.ASP_LOG_URL;
  if (!url) throw new UsageError("set ASP_LOG_URL (and ASP_LOG_TOKEN) to the log service that stores packages (asp serve --packages <dir>)");
  const client = new PackagesClient(url, io.env.ASP_LOG_TOKEN, v.tenant);
  const syncFile = join(home, "package-sync.json");
  const sync: Record<string, string> = existsSync(syncFile) ? JSON.parse(readFileSync(syncFile, "utf8")) : {};
  const keyOf = (name: string) => createHash("sha256").update(url + "|" + name).digest("hex").slice(0, 16);
  const baseOf = (name: string) => join(home, "package-base", keyOf(name));
  const save = () => { mkdirSync(home, { recursive: true }); writeFileSync(syncFile, JSON.stringify(sync, null, 2) + "\n"); };
  const remember = (name: string, etag: string, memoryDir: string) => {
    sync[keyOf(name)] = etag;
    save();
    rmSync(baseOf(name), { recursive: true, force: true });
    mkdirSync(baseOf(name), { recursive: true });
    if (existsSync(memoryDir)) cpSync(memoryDir, baseOf(name), { recursive: true });
  };
  try {
    if (sub === "list") {
      const l = await client.list();
      io.out(`${l.tenant}: ${l.packages.length} package(s), ${l.usedBytes} of ${l.quotaBytes} bytes used`);
      for (const p of l.packages) io.out(`  ${p.name}  ${p.bytes} bytes  ${p.updatedAt}  ${p.etag.slice(0, 12)}`);
      return 0;
    }
    if (sub === "push") {
      const pkg = rest[0];
      if (!pkg) throw new UsageError("usage: asp package push <package> --name <name>");
      const name = need("name");
      const resolved = await resolvePackage(pkg);
      const tmp = mkdtempSync(join(tmpdir(), "asp-push-"));
      try {
        const archive = join(tmp, "p.tgz");
        await packDirectory(resolved.dir, archive);
        const r = await client.push(name, readFileSync(archive), sync[keyOf(name)]);
        remember(name, r.etag, join(resolved.dir, "memory"));
        io.out(`pushed ${name} (${r.bytes} bytes, ${r.etag.slice(0, 12)}) for ${r.agent ?? "its agent"}`);
      } finally { rmSync(tmp, { recursive: true, force: true }); await finishPackage(resolved, false); }
      return 0;
    }
    if (sub === "pull") {
      const name = rest[0];
      if (!name) throw new UsageError("usage: asp package pull <name> --out <package-dir> [--merge]");
      const out = resolve(need("out"));
      if (existsSync(out) && !v.merge) throw new UsageError(`${out} exists; pull into a new folder, or add --merge to merge your copy's memory into the service's`);
      const got = await client.pull(name);
      const tmp = mkdtempSync(join(tmpdir(), "asp-pull-"));
      let theirs: string | undefined;
      try {
        const archive = join(tmp, "p.tgz");
        writeFileSync(archive, got.bytes);
        theirs = await unpackToTemp(archive);
        const theirMemory = join(theirs, "memory");
        const baseMemory = join(tmp, "their-memory");
        mkdirSync(baseMemory, { recursive: true });
        if (existsSync(theirMemory)) cpSync(theirMemory, baseMemory, { recursive: true });
        if (existsSync(out)) {
          // Three-way: the memory both copies started from (the last push or pull), the service's now, and yours.
          const base = existsSync(baseOf(name)) ? baseOf(name) : join(tmp, "no-base");
          mkdirSync(base, { recursive: true });
          const merged = join(tmp, "merged");
          mkdirSync(merged, { recursive: true });
          if (existsSync(theirMemory)) cpSync(theirMemory, merged, { recursive: true });
          const notes = existsSync(join(out, "memory")) ? mergeMemoryInto(merged, base, join(out, "memory"), { name: "your copy", label: "local", other: "the service's copy" }) : [];
          for (const n of notes) io.err(`  note     ${n}`);
          const budget = enforceMemoryBudget(merged, memoryBudget(v));
          for (const f of budget.pruned) io.err(`  note     memory over budget: pruned ${f}`);
          if (!isEmptyDiff(diffTrees(baseMemory, merged))) {
            const agent = JSON.parse(readFileSync(join(theirs, "manifest.json"), "utf8")).body.agent as string;
            const signer = new Keystore(home).forDid(agent);
            if (!signer) throw new Error(`no key for ${agent} in ${join(home, "keys")}: cannot sign the merge of your memory into the service's copy`);
            updatePackage(theirs, { signer, changes: [{ layer: "memory", description: "merged this copy's memory with the service's copy" }], memoryFrom: merged });
            io.err("  note     your memory was merged into the service's copy; the package is re-signed");
          }
          rmSync(out, { recursive: true, force: true });
        }
        mkdirSync(dirname(out), { recursive: true });
        cpSync(theirs, out, { recursive: true });
        remember(name, got.etag, baseMemory);
        io.out(`pulled ${name} (${got.bytes.length} bytes, ${got.etag.slice(0, 12)}) into ${out}`);
      } finally { rmSync(tmp, { recursive: true, force: true }); if (theirs) rmSync(theirs, { recursive: true, force: true }); }
      return 0;
    }
    if (sub === "delete") {
      const name = rest[0];
      if (!name) throw new UsageError("usage: asp package delete <name>");
      await client.remove(name, sync[keyOf(name)]);
      delete sync[keyOf(name)];
      save();
      io.out(`deleted ${name}`);
      return 0;
    }
  } catch (e) {
    if (e instanceof PackageServiceError && (e.code === "STALE" || e.code === "EXISTS")) {
      throw new Error(`${e.message}. Pull the service's copy and merge yours into it: asp package pull <name> --out <your package> --merge, then push again.`);
    }
    throw e;
  }
  throw new UsageError("usage: asp package push|pull|list|delete");
}

async function logSnapshot(home: string, io: Io): Promise<number> {
  if (logEnv.ASP_LOG_URL) throw new UsageError("snapshots are for a local log; the log service keeps its state in its database");
  const local = await LocalLog.open(home, logEnv);
  const snap = await local.snapshot();
  io.out(`snapshot at seq ${snap.seq} written to ${join(home, "snapshot.json")} (${snap.bytes} bytes); this log was opened ${local.openedFrom === "snapshot" ? `from a snapshot, replaying ${local.replayed} newer record(s)` : `by replaying ${local.replayed} record(s)`}`);
  return 0;
}

async function logVerify(home: string, v: Values, io: Io): Promise<number> {
  const local = await openLog(home, logEnv);
  const report = await local.log.verify();
  io.out(report.ok ? `log ok: ${report.records} records, head ${report.head.logHash}` : `log FAILED at seq ${report.error!.seq}: ${report.error!.message}`);
  if (!report.ok) return 1;
  if (v.full) {
    if (logEnv.ASP_LOG_URL) throw new UsageError("--full audits a local log (the log service is audited by its operator and witnesses)");
    const fresh = await LocalLog.openFull(home);
    const live = await LocalLog.open(home, logEnv);
    const same = JSON.stringify(fresh.exportState()) === JSON.stringify(live.exportState());
    io.out(same
      ? `  full replay from genesis: ${(await fresh.log.head()).seq} records re-verified; the state loaded ${live.openedFrom === "snapshot" ? "from the snapshot" : "by replay"} matches`
      : "  full replay from genesis: the state DIFFERS from the one this log loaded (the snapshot is wrong; delete snapshot.json)");
    if (!same) return 1;
  }

  const checkpoints = readCheckpoints(join(home, "checkpoints.ndjson"));
  let allOk = true;
  for (const cp of checkpoints) {
    const key = (await local.log.keys(didOf(cp.signer))).find((k) => k.kid === cp.signer);
    const sigOk = !!key && verifyCheckpointSignature(cp, b64urlDecode(key.publicKey));
    const hashOk = await local.log.verifyCheckpoint({ seq: cp.seq, logHash: cp.logHash });
    if (!sigOk || !hashOk) allOk = false;
    const problem = [!sigOk && "bad signature", !hashOk && "hash mismatch"].filter(Boolean).join(", ");
    io.out(`  checkpoint seq ${cp.seq} (${cp.signedAt}, ${cp.signer}): ${sigOk && hashOk ? "ok" : `FAILED (${problem})`}`);
  }

  // Witnesses: other parties who replayed the log themselves and signed the head they reached. Their keys are
  // taken from the log's passports or, for a did:key witness, from the DID itself.
  const minWitnesses = v["min-witnesses"] === undefined ? 0 : Math.trunc(Number(v["min-witnesses"]));
  if (!Number.isInteger(minWitnesses) || minWitnesses < 0) throw new UsageError("--min-witnesses must be a whole number, 0 or more");
  const ownSigners = new Set(checkpoints.map((c) => didOf(c.signer)));
  const good = new Map<string, number>(); // witness did -> highest seq it vouches for
  for (const cp of readCheckpoints(join(home, "witnesses.ndjson"))) {
    const wd = didOf(cp.signer);
    let pub: Uint8Array | undefined;
    const key = (await local.log.keys(wd)).find((k) => k.kid === cp.signer);
    if (key) pub = b64urlDecode(key.publicKey);
    else if (wd.startsWith("did:key:")) { try { pub = publicKeyFromDidKey(wd); } catch { /* not ed25519 */ } }
    const sigOk = !!pub && verifyCheckpointSignature(cp, pub);
    const hashOk = sigOk && await local.log.verifyCheckpoint({ seq: cp.seq, logHash: cp.logHash });
    const same = ownSigners.has(wd);
    if (!sigOk || !hashOk || same) allOk = false;
    io.out(`  witness ${wd} at seq ${cp.seq}: ${sigOk && hashOk && !same ? "ok" : `FAILED (${[!sigOk && "unknown key or bad signature", sigOk && !hashOk && "it saw a different history", same && "same DID as the log owner"].filter(Boolean).join(", ")})`}`);
    if (sigOk && hashOk && !same) good.set(wd, Math.max(good.get(wd) ?? 0, cp.seq));
  }
  if (good.size || minWitnesses) {
    const head = await local.log.head();
    const seqs = [...good.values()].sort((a, b) => b - a);
    io.out(`  witnessed by ${good.size} independent witness(es)${seqs.length ? `; the log is vouched for up to seq ${seqs[Math.min(minWitnesses || 1, seqs.length) - 1]} of ${head.seq}` : ""}`);
    if (good.size < minWitnesses) { io.out(`  FAILED: needs ${minWitnesses} witness(es), has ${good.size}`); return 1; }
  }
  return allOk ? 0 : 1;
}

/**
 * Bootstraps a DID's credit balance (MOCKS.md #13): local, unsigned, not part of the tamper-evident
 * log — a closed-loop ledger with no cash-out still needs some way to get the first credits in.
 */
async function creditsGrant(home: string, v: Values, need: Need, io: Io): Promise<number> {
  const to = need("to");
  const amount = Math.trunc(Number(need("amount")));
  if (!Number.isFinite(amount) || amount < 0) throw new UsageError("--amount must be a non-negative integer");
  const local = await openLog(home, logEnv);
  const balance = await local.mint(to, amount);
  io.out(`granted ${amount} credits to ${to} (not a signed record; local test/bootstrap only, see MOCKS.md #13)`);
  io.out(`  balance ${balance}`);
  return 0;
}

async function creditsBalance(home: string, did: string | undefined, io: Io): Promise<number> {
  if (!did) throw new UsageError("asp credits balance <did>");
  const local = await openLog(home, logEnv);
  io.out(`${did}: ${await local.log.balance(did)} credits`);
  return 0;
}

/** The full chain for a contract, in order, with each record's short type for convenience. */
async function marketChain(log: LogHandle["log"], contract: string) {
  const records = await log.chain(contract);
  return records.map((s) => ({ ...s, kind: s.record.type.replace(/^asp\./, "").replace(/\/v0\.2$/, "") }));
}

const artifactRefOf = (text: string) => ({ uri: `asp://local/${Buffer.from(text).toString("hex").slice(0, 16)}`, sha256: sha256Id(new TextEncoder().encode(text)) });

/** asp market intent|offer|contract|bond|mandate|deliver|accept|reject|settle|show */
async function market(home: string, sub: string | undefined, rest: string[], v: Values, need: Need, io: Io): Promise<number> {
  const keys = new Keystore(home);
  const local = await openLog(home, logEnv);
  const signerFor = (did: string) => {
    const s = keys.forDid(did);
    if (!s) throw new Error(`no key for ${did} in ${join(home, "keys")}`);
    return s;
  };

  if (sub === "intent") {
    const by = need("by");
    const verification: Record<string, unknown> = { mode: (v.verification ?? "principal") as "deterministic" | "principal" | "arbiter" };
    if (v["review-deadline"]) verification.review_deadline = v["review-deadline"];
    if (v.verifier) verification.verifier = v.verifier;
    const body = {
      purpose: need("purpose"),
      acceptance_criteria: v.criteria?.length ? v.criteria : [need("purpose")],
      budget: { value: Math.trunc(Number(need("budget"))), unit: "credit" as const },
      deadline: need("deadline"),
      verification,
    };
    const record = createRecord({ type: "intent", issuer: by, subject: by, prev: null, body, issued_at: now() }, signerFor(by));
    const res = await local.append(record);
    io.out(`intent ${res.id} by ${by} (log seq ${res.seq})`);
    return 0;
  }

  if (sub === "offer") {
    const by = need("by");
    const intent = need("intent");
    const body = {
      intent, price: { value: Math.trunc(Number(need("price"))), unit: "credit" as const },
      plan: need("plan"), eta: need("eta"),
      bond_offered: { value: Math.trunc(Number(v["bond-offered"] ?? "0")), unit: "credit" as const },
    };
    const record = createRecord({ type: "offer", issuer: by, subject: by, prev: null, body, issued_at: now() }, signerFor(by));
    const res = await local.append(record);
    io.out(`offer ${res.id} by ${by} on intent ${intent} (log seq ${res.seq})`);
    return 0;
  }

  // Allocation mode (Call -> several Proposals -> a panel picks one): an open problem instead of
  // one performer's direct bid. Call/Proposal are referenced by a Contract's basis, not chained,
  // exactly like Intent/Offer — so this needs no lifecycle change, only these three commands.
  if (sub === "call") {
    const by = need("by");
    if (!v.panel?.length) throw new UsageError("--panel <did> is required, at least once");
    const panel = v.panel;
    const body = {
      purpose: need("purpose"), budget: { value: Math.trunc(Number(need("budget"))), unit: "credit" as const },
      evaluation_criteria: v.criteria?.length ? v.criteria : [need("purpose")],
      panel, deadline: need("deadline"),
    };
    const record = createRecord({ type: "call", issuer: by, subject: by, prev: null, body, issued_at: now() }, signerFor(by));
    const res = await local.append(record);
    io.out(`call ${res.id} by ${by}, panel: ${panel.join(", ")} (log seq ${res.seq})`);
    return 0;
  }

  if (sub === "propose") {
    const by = need("by");
    const call = need("call");
    const body = {
      call, plan: need("plan"), team: v.team?.length ? v.team : [by],
      budget_asked: { value: Math.trunc(Number(need("budget-asked"))), unit: "credit" as const },
      milestones: [] as { description: string; due: string }[],
    };
    const record = createRecord({ type: "proposal", issuer: by, subject: by, prev: null, body, issued_at: now() }, signerFor(by));
    const res = await local.append(record);
    io.out(`proposal ${res.id} by ${by} on call ${call} (log seq ${res.seq})`);
    return 0;
  }

  if (sub === "allocate") {
    const by = need("by");
    const proposal = need("proposal");
    const body = { kind: "allocation", about: proposal, verdict: v.verdict ?? "selected" };
    const record = createRecord({ type: "attestation", issuer: by, subject: proposal, prev: null, body, issued_at: now() }, signerFor(by));
    const res = await local.append(record);
    io.out(`allocation ${res.id}: panel member ${by} selects proposal ${proposal} (log seq ${res.seq})`);
    return 0;
  }

  if (sub === "contract") {
    const principal = need("principal");
    const bank = need("bank");
    const intentId = v.intent;
    const offerId = v.offer;
    const callId = v.call;
    const proposalId = v.proposal;
    let performer = v.performer;
    let body: Record<string, unknown>;
    let priceValue: number;
    if (intentId || offerId) {
      if (!intentId || !offerId) throw new UsageError("assignment mode needs both --intent and --offer");
      const intentRec = await local.log.get(intentId);
      const offerRec = await local.log.get(offerId);
      if (!intentRec) throw new Error(`intent ${intentId} is not in the log`);
      if (!offerRec) throw new Error(`offer ${offerId} is not in the log`);
      const intentBody = intentRec.record.body as any;
      const offerBody = offerRec.record.body as any;
      performer ??= offerRec.record.issuer;
      priceValue = offerBody.price.value;
      body = {
        principal, performer, bank, purpose: intentBody.purpose, acceptance_criteria: intentBody.acceptance_criteria,
        price: offerBody.price, verification: intentBody.verification.mode, deadline: intentBody.deadline,
        basis: { intent: intentId, offer: offerId },
        ...(intentBody.verification.review_deadline ? { review_deadline: intentBody.verification.review_deadline } : {}),
        ...(intentBody.verification.verifier ? { verifier: intentBody.verification.verifier } : {}),
      };
    } else if (callId || proposalId) {
      if (!callId || !proposalId) throw new UsageError("allocation mode needs both --call and --proposal");
      const callRec = await local.log.get(callId);
      const proposalRec = await local.log.get(proposalId);
      if (!callRec) throw new Error(`call ${callId} is not in the log`);
      if (!proposalRec) throw new Error(`proposal ${proposalId} is not in the log`);
      const callBody = callRec.record.body as any;
      const proposalBody = proposalRec.record.body as any;
      performer ??= proposalBody.team[0];
      priceValue = proposalBody.budget_asked.value;
      body = {
        principal, performer, bank, purpose: callBody.purpose, acceptance_criteria: callBody.evaluation_criteria,
        price: proposalBody.budget_asked, verification: v.verification ?? "principal", deadline: callBody.deadline,
        basis: { call: callId, proposal: proposalId },
      };
    } else {
      throw new UsageError("give --intent and --offer (assignment mode), or --call and --proposal (allocation mode)");
    }
    if (!performer) throw new UsageError("--performer is required (or derivable from the Offer's issuer or the Proposal's team)");
    // Subcontract nesting (docs/spec-deltas.md): the log itself checks this is coherent — the
    // parent must exist, not be Settled yet, and its own performer must be this contract's principal.
    if (v["parent-contract"]) body.parent_contract = v["parent-contract"];
    // Outcome verification: an explicit --verifier wins over the Intent's (and is the only way in allocation mode).
    if (v.verifier) body.verifier = v.verifier;
    let record = createRecord({ type: "contract", issuer: principal, subject: performer, prev: null, body, issued_at: now() }, signerFor(principal));
    record = cosign(record, signerFor(performer));
    const res = await local.append(record);
    io.out(`contract ${res.id}: ${principal} -> ${performer}, price ${priceValue} credits (log seq ${res.seq}, state ${res.state})`);
    return 0;
  }

  if (sub === "bond") {
    const contract = need("contract");
    const backer = need("backer");
    const escrowPayer = need("escrow-payer");
    const body = {
      contract, backer, amount: { value: Math.trunc(Number(need("amount"))), unit: "credit" as const },
      escrow: { payer: escrowPayer, amount: { value: Math.trunc(Number(need("escrow-amount"))), unit: "credit" as const } },
      slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] as const,
    };
    const record = createRecord({ type: "bond", issuer: backer, subject: contract, prev: contract, body, issued_at: now() }, signerFor(backer));
    const res = await local.append(record);
    io.out(`bond ${res.id} on contract ${contract} (log seq ${res.seq}, state ${res.state})`);
    io.out(`  locked: ${body.escrow.amount.value} escrow from ${escrowPayer}, ${body.amount.value} bond from ${backer}`);
    return 0;
  }

  if (sub === "mandate") {
    const contract = need("contract");
    const principal = need("principal");
    const performer = need("performer");
    const contractRec = await local.log.get(contract);
    if (!contractRec) throw new Error(`contract ${contract} is not in the log`);
    const cbody = contractRec.record.body as any;
    const chain = await local.log.chain(contract);
    const bond = chain.find((s) => s.record.type === "asp.bond/v0.2");
    if (!bond) throw new Error(`contract ${contract} has no Bond yet; run asp market bond first`);
    const body = {
      contract, purpose: cbody.purpose, floor: "asp.floor/v1" as const,
      scopes: v.scopes?.length ? v.scopes : ["repo.read"],
      ...(v["network-host"]?.length ? { network: { hosts: v["network-host"] } } : {}),
      forbidden_means: [] as string[],
      spend: { cap: Math.trunc(Number(v["spend-cap"] ?? "0")), unit: "credit" as const },
      irreversible: {
        policy: (v.irreversible ?? "checkpoint") as "checkpoint" | "forbid" | "allow",
        ...(v.gate?.length ? { scopes: v.gate } : {}),
      },
      subcontract: { allowed: false },
      nodes: { max_parallel: 1 },
      learning: { scope: "harness" as const, share_to_commons: v["share-to-commons"] ?? false },
      self_modification: "principal_approves" as const,
      overlay: null, checkpoints: [] as string[], expires: cbody.deadline, revocable: true as const,
    };
    const record = createRecord({ type: "mandate", issuer: principal, subject: performer, prev: bond.id, body, issued_at: now() }, signerFor(principal));
    const res = await local.append(record);
    io.out(`mandate ${res.id} on contract ${contract} (log seq ${res.seq}, state ${res.state})`);
    return 0;
  }

  if (sub === "deliver") {
    const contract = need("contract");
    const by = need("by");
    const chain = await marketChain(local.log, contract);
    const head = chain.at(-1);
    if (!head) throw new Error(`contract ${contract} is not in the log`);
    const summary = need("summary");
    // --claim "<text>::<measured|simulated|predicted>[::<uri>=<sha256>]": what the Delivery asserts and how
    // well established each claim is, for the verifier to confirm or downgrade by index.
    const claims = (v.claim ?? []).map((entry) => {
      const [claim, grade, evidence] = entry.split("::");
      if (!claim || !["measured", "simulated", "predicted"].includes(grade ?? "")) {
        throw new UsageError(`--claim must be "<text>::<measured|simulated|predicted>[::<uri>=<sha256>]", got "${entry}"`);
      }
      const out: Record<string, unknown> = { claim, grade };
      if (evidence) {
        const [uri, sha256] = evidence.split("=");
        if (!uri || !sha256) throw new UsageError(`a claim's evidence must be <uri>=<sha256>, got "${evidence}"`);
        out.evidence = { uri, sha256: sha256.startsWith("sha256:") ? sha256 : `sha256:${sha256}` };
      }
      return out;
    });
    const body = {
      contract, result: { summary, artifacts: [] as { uri: string; sha256: string }[], ...(claims.length ? { claims } : {}) },
      evidence: { trace: artifactRefOf(summary), forecasts: [] as unknown[] },
    };
    const record = createRecord({ type: "delivery", issuer: by, subject: contract, prev: head.id, body, issued_at: now() }, signerFor(by));
    const res = await local.append(record);
    io.out(`delivery ${res.id} on contract ${contract} (log seq ${res.seq}, state ${res.state})`);
    return 0;
  }

  // Outcome verification: the contract's named, independent verifier re-checks the latest Delivery and
  // signs a verdict; --grade <claim index>=<measured|simulated|predicted|unverified> grades each claim.
  if (sub === "verify") {
    const contract = need("contract");
    const by = need("by");
    const verdict = need("verdict");
    if (!["confirmed", "partly_confirmed", "not_confirmed"].includes(verdict)) {
      throw new UsageError("--verdict must be confirmed, partly_confirmed or not_confirmed");
    }
    const chain = await marketChain(local.log, contract);
    const delivery = [...chain].reverse().find((s) => s.kind === "delivery");
    if (!delivery) throw new Error(`contract ${contract} has no Delivery yet; run asp market deliver first`);
    const about = v.about ?? delivery.id;
    const claims = (v.grade ?? []).map((entry) => {
      const [index, grade] = entry.split("=");
      if (!/^\d+$/.test(index ?? "") || !["measured", "simulated", "predicted", "unverified"].includes(grade ?? "")) {
        throw new UsageError(`--grade must be <claim index>=<measured|simulated|predicted|unverified>, got "${entry}"`);
      }
      return { index: Number(index), grade };
    });
    const body: Record<string, unknown> = { kind: "verification", about, verdict, ...(claims.length ? { claims } : {}) };
    if (v.reasons?.length) body.reasons = v.reasons;
    const record = createRecord({ type: "attestation", issuer: by, subject: about, prev: null, body, issued_at: now() }, signerFor(by));
    const res = await local.append(record);
    io.out(`verification ${res.id} on delivery ${about}: ${verdict} by ${by} (log seq ${res.seq})`);
    return 0;
  }

  // Approval gates: the performer raises a Checkpoint (asp run does this by itself when a gated call is
  // attempted), and the principal answers with a signed checkpoint_resolution that returns the job to Running.
  if (sub === "checkpoint") {
    const contract = need("contract");
    const by = need("by");
    const kind = v.kind ?? "before_irreversible";
    if (!["plan", "before_irreversible", "high_impact", "delivery"].includes(kind)) throw new UsageError("--kind must be plan, before_irreversible, high_impact or delivery");
    const head = (await marketChain(local.log, contract)).at(-1);
    if (!head) throw new Error(`contract ${contract} is not in the log`);
    const body: Record<string, unknown> = { contract, kind, question: need("question") };
    if (v.summary) body.proposed_action = v.summary;
    if (v.expires) body.expires = v.expires;
    const record = createRecord({ type: "checkpoint", issuer: by, subject: contract, prev: head.id, body, issued_at: now() }, signerFor(by));
    const res = await local.append(record);
    io.out(`checkpoint ${res.id} on contract ${contract} (log seq ${res.seq}, state ${res.state})`);
    return 0;
  }

  if (sub === "resolve") {
    const contract = need("contract");
    const by = need("by");
    const verdict = need("verdict");
    if (!["approved", "corrected", "picked", "expired"].includes(verdict)) throw new UsageError("--verdict must be approved, corrected, picked or expired (expired: the performer closes a Checkpoint past its --expires)");
    if (verdict === "corrected" && !v.correction) throw new UsageError("--verdict corrected needs --correction <text>");
    const chain = await marketChain(local.log, contract);
    const head = chain.at(-1);
    const open = [...chain].reverse().find((s) => s.kind === "checkpoint");
    if (!head || !open) throw new Error(`contract ${contract} has no Checkpoint to resolve`);
    const body: Record<string, unknown> = { kind: "checkpoint_resolution", about: v.about ?? open.id, verdict };
    if (v.correction) body.correction = v.correction;
    const record = createRecord({ type: "attestation", issuer: by, subject: contract, prev: head.id, body, issued_at: now() }, signerFor(by));
    const res = await local.append(record);
    io.out(`resolution ${res.id} on contract ${contract}: ${verdict} (log seq ${res.seq}, state ${res.state})`);
    return 0;
  }

  if (sub === "accept" || sub === "reject") {
    const contract = need("contract");
    const by = need("by");
    const chain = await marketChain(local.log, contract);
    const head = chain.at(-1);
    const delivery = [...chain].reverse().find((s) => s.kind === "delivery");
    if (!head) throw new Error(`contract ${contract} is not in the log`);
    if (!delivery) throw new Error(`contract ${contract} has no Delivery yet; run asp market deliver first`);
    const about = v.about ?? delivery.id;
    const body: Record<string, unknown> = { kind: "acceptance", about, verdict: sub === "accept" ? "accepted" : "rejected" };
    if (sub === "reject") body.reasons = v.reasons?.length ? v.reasons : ["rejected"];
    const record = createRecord({ type: "attestation", issuer: by, subject: contract, prev: head.id, body, issued_at: now() }, signerFor(by));
    const res = await local.append(record);
    io.out(`${sub === "accept" ? "acceptance" : "rejection"} ${res.id} on contract ${contract} (log seq ${res.seq}, state ${res.state})`);
    return 0;
  }

  // Courts: a ruling on a Disputed job, drawn from the real staked juror panel (asp-log's
  // drawPanel/checkRulingPanel) when at least one is registered anywhere; falls back to any
  // neutral DID when none are (MOCKS.md #4's original mocked behavior, unchanged).
  if (sub === "rule") {
    const contract = need("contract");
    const by = need("by");
    const verdict = need("verdict");
    if (!["for_performer", "for_principal", "split"].includes(verdict)) {
      throw new UsageError("--verdict is for_performer, for_principal or split");
    }
    const chain = await marketChain(local.log, contract);
    const head = chain.at(-1);
    if (!head) throw new Error(`contract ${contract} is not in the log`);
    const fault: Record<string, number> = {};
    for (const entry of v.fault ?? []) {
      const [did, permille] = entry.split("=");
      if (!did || !permille) throw new UsageError(`--fault must be <did>=<permille>, got "${entry}"`);
      fault[did] = Math.trunc(Number(permille));
    }
    if (!Object.keys(fault).length) throw new UsageError("--fault <did>=<permille> is required, at least once");
    const body = { kind: "ruling", about: contract, verdict, fault };
    let record = createRecord({ type: "attestation", issuer: by, subject: contract, prev: head.id, body, issued_at: now() }, signerFor(by));
    for (const cosigner of v["cosign-by"] ?? []) record = cosign(record, signerFor(cosigner));
    const res = await local.append(record);
    io.out(`ruling ${res.id} on contract ${contract}: ${verdict} (log seq ${res.seq}, state ${res.state})`);
    return 0;
  }

  // Courts: who is eligible to be drawn (real credits at stake) and who was actually drawn.
  if (sub === "juror" && rest[0] === "register") {
    const by = need("by");
    const stake = Math.trunc(Number(need("stake")));
    const current = await local.log.juror(by);
    const body = { did: by, stake: { value: stake, unit: "credit" as const } };
    const record = createRecord({ type: "juror", issuer: by, subject: by, prev: current?.head ?? null, body, issued_at: now() }, signerFor(by));
    const res = await local.append(record);
    io.out(`juror ${res.id}: ${by} now stakes ${stake} credits (log seq ${res.seq})`);
    return 0;
  }
  if (sub === "juror" && rest[0] === "show") {
    const did = rest[1] ?? v.to;
    if (!did) throw new UsageError("asp market juror show <did>");
    const juror = await local.log.juror(did);
    io.out(juror ? `${did}: staked ${juror.staked} credits` : `${did} is not a registered juror`);
    return 0;
  }
  // Whistleblower reports (docs/stage-3-plan.md M2): any DID with a passport may report a running contract.
  if (sub === "report") {
    const by = need("by");
    const contract = need("contract");
    const reasons = v.reasons ?? [];
    if (!reasons.length) throw new UsageError("--reasons <text> is required, at least once");
    const record = createRecord({ type: "attestation", issuer: by, subject: contract, prev: null, body: { kind: "report", about: contract, reasons }, issued_at: now() }, signerFor(by));
    const res = await local.append(record);
    const row = await local.log.report(res.id);
    io.out(`report ${res.id} on contract ${contract} by ${by}; deposit ${row?.deposit ?? 0} credits locked (log seq ${res.seq})`);
    io.out(`  a drawn panel rules with: asp market report-rule --report ${res.id} --by <juror> --cosign-by <juror> --verdict upheld|dismissed`);
    return 0;
  }

  if (sub === "report-rule") {
    const reportId = need("report");
    const by = need("by");
    const verdict = need("verdict");
    if (!["upheld", "dismissed"].includes(verdict)) throw new UsageError("--verdict is upheld or dismissed");
    const report = await local.log.report(reportId);
    if (!report) throw new Error(`${reportId} is not a report in the log`);
    let record = createRecord({ type: "attestation", issuer: by, subject: report.contract, prev: null, body: { kind: "report_ruling", about: reportId, verdict }, issued_at: now() }, signerFor(by));
    for (const cosigner of v["cosign-by"] ?? []) record = cosign(record, signerFor(cosigner));
    const res = await local.append(record);
    io.out(`report ruling ${res.id} on report ${reportId}: ${verdict} (log seq ${res.seq})`);
    if (verdict === "upheld") io.out(`  contract ${report.contract} must now settle with full fault: asp market settle --contract ${report.contract} --bank <bank> --basis revoked --principal <principal>`);
    return 0;
  }

  // Cohort stop (docs/stage-3-plan.md M4): after a report is upheld, stop every running job caught in the same pattern.
  if (sub === "cohort-stop") {
    const reportId = need("report");
    const report = await local.log.report(reportId);
    if (!report) throw new Error(`${reportId} is not a report in the log`);
    if (report.status !== "upheld") throw new Error(`report ${reportId} is ${report.status}; only an upheld report can stop a cohort`);
    const minAgents = v["min-agents"] === undefined ? 3 : Math.trunc(Number(v["min-agents"]));
    const windowS = v.window === undefined ? 600 : Number(v.window);
    const clusters = findContagion(await collectWatchActions(local), { minAgents, windowMs: windowS * 1000, all: v.all ?? false })
      .filter((c) => c.contracts.includes(report.contract));
    const cohort = [...new Set([report.contract, ...clusters.flatMap((c) => c.contracts)])];
    io.out(`cohort of ${cohort.length} contract(s) from ${clusters.length} cluster(s) that include the reported job${clusters.length ? "" : " (no pattern found: only the reported job)"}`);
    let stopped = 0;
    let eligible = 0;
    for (const contract of cohort) {
      const state = (await local.log.chainInfo(contract))?.state;
      if (state !== "Running" && state !== "Checkpoint") { io.out(`  ${contract}: ${state ?? "unknown"}, left alone`); continue; }
      eligible++;
      const cbody = (await local.log.get(contract))!.record.body as { principal: string; bank: string };
      const escrow = (await local.log.escrow(contract))!;
      const amounts = contract === report.contract
        ? [] // an upheld report already forces full fault, and settle defaults to it
        : ["--escrow-released", "0", ...(!v.spare ? ["--bond-slashed", String(escrow.bondLocked), "--bond-returned", "0"] : ["--bond-slashed", "0", "--bond-returned", String(escrow.bondLocked)]), "--pro-rata", "0"];
      const res = await main(["market", "settle", "--contract", contract, "--bank", cbody.bank, "--basis", "revoked", "--principal", cbody.principal, "--home", home, ...amounts],
        { out: () => {}, err: () => {}, env: io.env, cwd: io.cwd });
      stopped += res === 0 ? 1 : 0;
      io.out(`  ${contract}: ${res === 0 ? (contract === report.contract ? "stopped, full fault (the upheld report)" : !v.spare ? "stopped, bond slashed (use --spare to return it)" : "stopped, escrow back to the principal, bond returned (--spare)") : "NOT stopped (the bank's or principal's key is not here, or it already settled)"}`);
    }
    io.out(`${stopped}/${eligible} running contract(s) stopped`);
    return stopped === eligible ? 0 : 1;
  }

  if (sub === "panel" && rest[0] === "draw" && v.report) {
    const panel = await local.log.drawReportPanel(v.report, v.size ? Math.trunc(Number(v.size)) : undefined);
    io.out(panel.length ? `drawn panel for report ${v.report}: ${panel.join(", ")}` : "no staked, conflict-free jurors registered; a report cannot be ruled on");
    return 0;
  }
  if (sub === "panel" && rest[0] === "draw") {
    const contract = need("contract");
    const size = v.size ? Math.trunc(Number(v.size)) : undefined;
    const panel = await local.log.drawPanel(contract, size);
    io.out(panel.length ? `drawn panel for ${contract}: ${panel.join(", ")}` : `no staked, conflict-free jurors registered; asp market rule accepts any neutral DID`);
    return 0;
  }

  // The runtime -> protocol compliance bridge (docs/backlog.md): a self-issued, checkable report of
  // scopes actually used, against the contract's live Mandate. `asp run --contract` emits this
  // automatically from real tool calls; this command is for reporting by hand, or from a runtime
  // with no live-emission wiring yet.
  if (sub === "action") {
    const contract = need("contract");
    const by = need("by");
    const scopesUsed = v["scopes-used"] ?? [];
    const body: Record<string, unknown> = { contract, scopes_used: scopesUsed };
    if (v.assurance) {
      if (!["self_reported", "runtime_observed", "gateway_observed", "gateway_enforced", "hook_enforced", "sandbox_enforced"].includes(v.assurance)) throw new UsageError("--assurance is self_reported, runtime_observed, gateway_observed, gateway_enforced, hook_enforced or sandbox_enforced");
      body.assurance = v.assurance;
    }
    if (v.summary) body.summary = v.summary;
    // A late report (S80): the last stretch of activity, made after the job ended; the log accepts it only on a settled job, soon after, for activity up to the end.
    if (v.late) body.late = { activity_ended: v.late };
    if (v.metrics) {
      try { body.metrics = JSON.parse(v.metrics); } catch { throw new UsageError("--metrics must be a JSON object, e.g. '{\"tokens_in\":1200,\"tokens_out\":340,\"models\":[{\"name\":\"gpt-oss-120b\"}]}'"); }
    }
    if (v.blocked?.length) {
      body.blocked_attempts = v.blocked.map((entry) => {
        const [scope, count] = entry.split("=");
        if (!scope || !count) throw new UsageError(`--blocked must be <scope>=<count>, got "${entry}"`);
        return { scope, count: Math.trunc(Number(count)) };
      });
    }
    if (v.artifact?.length) {
      body.artifacts = v.artifact.map((entry) => {
        const [uri, sha256] = entry.split("=");
        if (!uri || !sha256) throw new UsageError(`--artifact must be <uri>=<sha256>, got "${entry}"`);
        return { uri, sha256: sha256.startsWith("sha256:") ? sha256 : `sha256:${sha256}` };
      });
    }
    const record = createRecord({ type: "action", issuer: by, subject: contract, prev: null, body, issued_at: now() }, signerFor(by));
    const res = await local.append(record);
    io.out(`action ${res.id} on contract ${contract}: ${scopesUsed.join(", ") || "no scopes"} (log seq ${res.seq})`);
    return 0;
  }

  if (sub === "settle") {
    const contract = need("contract");
    const bank = need("bank");
    const basis = need("basis") as "accepted" | "ruling" | "revoked" | "silence";
    const chain = await marketChain(local.log, contract);
    const head = chain.at(-1);
    if (!head) throw new Error(`contract ${contract} is not in the log`);

    let escrowReleased = v["escrow-released"] !== undefined ? Math.trunc(Number(v["escrow-released"])) : undefined;
    let bondSlashed = v["bond-slashed"] !== undefined ? Math.trunc(Number(v["bond-slashed"])) : undefined;
    const bondReturned = Math.trunc(Number(v["bond-returned"] ?? "0"));
    let cited: string | undefined = v.cites;
    // An upheld report forces full fault (the log refuses anything else): default to exactly that.
    const forced = (await local.log.escrow(contract))?.forcedFault ? await local.log.escrow(contract) : undefined;
    if (forced) { escrowReleased ??= 0; bondSlashed ??= forced.bondLocked; io.err("  note     an upheld report on this contract requires a full-fault settlement"); }

    if (basis === "accepted" || basis === "ruling") {
      cited ??= [...chain].reverse().find((s) => s.kind === "attestation")?.id;
      if (!cited) throw new Error(`no attestation to cite; give --cites <id>, or run asp market accept/reject first`);
    }
    // A ruling's fault on the performer *is* the payout formula (asp-log's checkRulingPanel guard,
    // docs/spec-deltas.md S13) — derive it here rather than making the caller compute it by hand.
    if (basis === "ruling" && (escrowReleased === undefined || bondSlashed === undefined)) {
      const [rulingRec, escrow] = await Promise.all([local.log.get(cited!), local.log.escrow(contract)]);
      const contractRec = await local.log.get(contract);
      const performer = (contractRec!.record.body as any).performer;
      const fault = (rulingRec?.record.body as any)?.fault?.[performer] ?? 0;
      escrowReleased ??= Math.floor((escrow!.escrowLocked * (1000 - fault)) / 1000);
      bondSlashed ??= Math.ceil((escrow!.bondLocked * fault) / 1000);
    }

    const body: Record<string, unknown> = {
      contract, basis,
      escrow_released: { value: escrowReleased ?? 0, unit: "credit" },
      bond_returned: { value: bondReturned, unit: "credit" },
      bond_slashed: { value: bondSlashed ?? 0, unit: "credit" },
    };
    // Comes out of the same escrow, on top of escrow_released; credits to the local mock platform
    // account (EventLog.PLATFORM_DID) standing in for a real platform/Insurer recipient (MOCKS.md).
    if (v.fees) body.fees = { value: Math.trunc(Number(v.fees)), unit: "credit" };
    if (v["agent-permille"] !== undefined) body.earnings_split = { agent_permille: Math.trunc(Number(v["agent-permille"])) };
    if (basis === "revoked") body.pro_rata_permille =Math.trunc(Number(v["pro-rata"] ?? "0"));
    else if (basis === "accepted" || basis === "ruling") body.cites = cited;
    let record = createRecord({ type: "settlement", issuer: bank, subject: contract, prev: head.id, body, issued_at: now() }, signerFor(bank));
    if (basis === "revoked") {
      const contractRec = await local.log.get(contract);
      const principal = (contractRec!.record.body as any).principal;
      record = cosign(record, signerFor(v.principal ?? principal));
    }
    const res = await local.append(record);
    io.out(`settlement ${res.id} on contract ${contract} (log seq ${res.seq}, state ${res.state})`);

    // Lineage as behavior-shaping (docs/backlog.md "Making a slash actually matter", mechanism 3):
    // a slash writes a real, signed lineage edge for the backer, self-issued — the log can't sign
    // on anyone's behalf, so this only happens when that DID's own key is available locally (true
    // for single-player testing; a real network would need the backer's own agent to countersign
    // this itself). asp pack later renders it into memory/PENALTIES.md, so it's what the agent
    // actually reads at the start of its next run, not just an entry in its signed history.
    if ((bondSlashed ?? 0) > 0) {
      const escrow = await local.log.escrow(contract);
      const backerSigner = escrow && keys.forDid(escrow.backer);
      if (escrow && backerSigner) {
        const lineage = createRecord({
          type: "lineage", issuer: escrow.backer, subject: escrow.backer, prev: null,
          body: {
            edge: "update", child: escrow.backer, parents: [escrow.backer],
            change: { layer: "memory", description: `Penalized: bond slashed ${bondSlashed} credits on contract ${contract} (settlement basis: ${basis}).` },
          },
          issued_at: now(),
        }, backerSigner);
        const lineageRes = await local.append(lineage);
        io.out(`  penalty recorded: lineage ${lineageRes.id} for ${escrow.backer}`);
      } else if (escrow) {
        io.out(`  note: ${escrow.backer} was slashed but no local key is available to record it in lineage`);
      }
    }
    return 0;
  }

  if (sub === "show") {
    const contract = rest[0] ?? v.contract;
    if (!contract) throw new UsageError("asp market show <contract>");
    const chain = await marketChain(local.log, contract);
    const info = await local.log.chainInfo(contract);
    io.out(`contract ${contract}: state ${info?.state ?? "unknown"}, ${chain.length} records`);
    for (const s of chain) io.out(`  seq ${s.seq}  ${s.kind.padEnd(11)} ${s.id}`);
    const escrow = await local.log.escrow(contract);
    if (escrow) io.out(`  escrow: ${escrow.escrowLocked} locked from ${escrow.escrowPayer}, ${escrow.bondLocked} bond from ${escrow.backer}, settled: ${escrow.settled}`);
    return 0;
  }

  throw new UsageError("asp market intent|offer|call|propose|allocate|contract|bond|mandate|deliver|verify|checkpoint|resolve|accept|reject|rule|report|report-rule|settle|show|action|juror register|juror show|panel draw");
}

/** The signed records a package needs: the agent's passports, its sponsors' passports, its fleet, its lineage. */
/**
 * Renders any of this agent's lineage `update` edges written by a slash (asp market settle's
 * "Penalized: ..." descriptions) into memory/PENALTIES.md, so the runtime materializes it into the
 * agent's own memory alongside everything else in the package — the second half of "lineage as
 * behavior-shaping" (docs/backlog.md): the point isn't that the penalty is *recorded*, it's that
 * the agent actually reads it at the start of its next run. Writes nothing if there are none.
 */
function writePenalties(staging: string, agent: string, history: AspRecord[]): void {
  const penalties = history
    .filter((r) => r.type === "asp.lineage/v0.2" && (r.body as any).child === agent)
    .map((r) => ({ issuedAt: r.issued_at, description: (r.body as any).change?.description as string | undefined }))
    .filter((p): p is { issuedAt: string; description: string } => !!p.description?.startsWith("Penalized:"))
    .sort((a, b) => Date.parse(a.issuedAt) - Date.parse(b.issuedAt));
  if (!penalties.length) return;
  const dir = join(staging, "memory");
  mkdirSync(dir, { recursive: true });
  const lines = ["# Penalties", "", "Read this before deciding how to act — these are real, signed consequences from past jobs.", ""];
  for (const p of penalties) lines.push(`- ${p.issuedAt}: ${p.description}`);
  appendFileEnsured(join(dir, "PENALTIES.md"), Buffer.from(lines.join("\n") + "\n"));
}

async function historyFor(log: LogHandle["log"], agent: string): Promise<AspRecord[]> {
  const all: AspRecord[] = [];
  for (let after = 0; ; ) {
    const page = await log.since(after, 500);
    if (!page.length) break;
    all.push(...page.map((s) => s.record));
    after = page.at(-1)!.seq;
  }
  const dids = new Set<string>([agent]);
  const fleets = new Set<string>();
  // Follow sponsors upward, and collect fleets.
  for (let grew = true; grew; ) {
    grew = false;
    for (const r of all) {
      const b = r.body as any;
      if (r.type !== "asp.passport/v0.2" || !dids.has(b.did)) continue;
      for (const d of [b.sponsor, r.issuer]) if (d && !dids.has(d)) { dids.add(d); grew = true; }
      if (b.fleet) fleets.add(b.fleet);
    }
    for (const r of all) {
      const b = r.body as any;
      if (r.type === "asp.fleet/v0.2" && fleets.has(b.did) && !dids.has(b.org)) { dids.add(b.org); grew = true; }
    }
  }
  return all.filter((r) => {
    const b = r.body as any;
    if (r.type === "asp.passport/v0.2") return dids.has(b.did);
    if (r.type === "asp.fleet/v0.2") return fleets.has(b.did);
    if (r.type === "asp.lineage/v0.2") return b.child === agent;
    return false;
  });
}

async function pack(home: string, v: Values, need: Need, io: Io): Promise<number> {
  const runtime = need("runtime");
  const adapter = ADAPTERS[runtime];
  if (!adapter) throw new UsageError(`unknown runtime ${runtime}; available: ${Object.keys(ADAPTERS).join(", ")}`);
  const agent = need("agent");
  const project = resolve(io.cwd, v.project ?? ".");
  const log = await openLog(home, logEnv);
  if (!(await log.log.passport(agent))) throw new Error(`${agent} has no passport; create one with: asp identity new --kind agent --did ${agent} --sponsor <your did>`);
  const signer = new Keystore(home).forDid(agent);
  if (!signer) throw new Error(`no key for ${agent} in ${join(home, "keys")}`);

  const staging = mkdtempSync(join(tmpdir(), "asp-pack-"));
  try {
    const capture = await adapter.capture({ project, includeUser: v["include-user"] ?? false, home: v["user-home"] ?? v["claude-home"], staging });
    const history = await historyFor(log.log, agent);
    writePenalties(staging, agent, history);
    const findings = [...scanForSecrets(join(staging, "harness"), "harness/"), ...scanForSecrets(join(staging, "memory"), "memory/")];
    if (findings.length) {
      io.err("refusing to pack: these captured files look like they contain secrets (values not shown):");
      for (const f of findings) io.err(`  ${f.file}:${f.line}  ${f.kind}`);
      io.err("remove them or move them into environment variables, then pack again.");
      return 1;
    }
    const out = resolve(io.cwd, v.out ?? `${slug(agent)}-${now().slice(0, 10)}.aspkg`);
    const asArchive = /\.(tgz|tar\.gz)$/i.test(out);
    const writeDir = asArchive ? mkdtempSync(join(tmpdir(), "asp-pack-out-")) : out;
    const manifest = writePackage({ out: writeDir, capture, agent, signer, history });
    if (asArchive) {
      await packDirectory(writeDir, out);
      rmSync(writeDir, { recursive: true, force: true });
    }
    const h: Harness = capture.harness;
    io.out(`packed ${agent} from ${runtime} (${project})`);
    io.out(`  package      ${out}${asArchive ? " (single file)" : ""}`);
    io.out(`  manifest     ${manifest.id}`);
    io.out(`  instructions ${h.instructions.map((i) => i.name).join(", ") || "none"}`);
    io.out(`  skills       ${h.skills.length}   subagents ${h.subagents.length}   commands ${h.commands.length}   MCP servers ${Object.keys(h.mcp_servers).length}`);
    io.out(`  hooks        ${Object.keys(h.hooks).join(", ") || "none"}`);
    io.out(`  sessions     ${capture.sessions} indexed (metadata only)`);
    if (h.secrets?.length) io.out(`  secrets      ${h.secrets.join(", ")} (placeholders; set them in the environment at run time)`);
    for (const w of capture.warnings) io.out(`  warning      ${w}`);
    return 0;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

async function verify(pkg: string | undefined, json: boolean, io: Io): Promise<number> {
  if (!pkg) throw new UsageError("asp verify <package>");
  const resolved = await resolvePackage(resolve(io.cwd, pkg));
  const report = await verifyPackage(resolved.dir);
  await finishPackage(resolved, false);
  if (json) io.out(JSON.stringify(report, null, 2));
  else {
    io.out(`${report.ok ? "VERIFIED" : "FAILED"}  ${report.agent ?? pkg}`);
    for (const c of report.checks) io.out(`  ${c.status.padEnd(4)}  ${c.name.padEnd(10)} ${c.detail ?? ""}`);
  }
  return report.ok ? 0 : 1;
}

async function run(home: string, pkg: string | undefined, v: Values, need: Need, io: Io): Promise<number> {
  if (!pkg) throw new UsageError("asp run <package> --backend <runtime>");
  const backend = need("backend");
  const adapter = ADAPTERS[backend];
  if (!adapter) throw new UsageError(`unknown backend ${backend}; available: ${Object.keys(ADAPTERS).join(", ")}`);
  const resolved = await resolvePackage(resolve(io.cwd, pkg));
  let mutated = false;
  try {
    return await runIn(resolved.dir, home, backend, adapter, v, io, () => { mutated = true; });
  } finally {
    await finishPackage(resolved, mutated);
  }
}

/**
 * The kill switch's economic consequence (docs/backlog.md): the same `basis: "revoked"` Settlement
 * `asp market settle` already exposes for manual mid-job cancellation, just with the numbers set to
 * full fault instead of a benign pro-rata split — zero escrow released, the whole bond slashed, the
 * escrow (plus the slash, as compensation) returned to the principal. No new settlement basis and no
 * lifecycle change: `checkSettlement`'s `revoked` guard already allows any split within what's locked,
 * it's the CLI choosing full fault here. Requires the bank's and the principal's keys to be available
 * locally to sign/cosign — true in this single-player build, an honest limit in a real deployment
 * (same as the existing slash-lineage write, which also only fires when a key happens to be local).
 */
async function autoSettleOnKill(local: LogHandle, home: string, contract: string, io: Io): Promise<void> {
  const [contractRec, escrow] = await Promise.all([local.log.get(contract), local.log.escrow(contract)]);
  if (!contractRec || !escrow) { io.err(`  settle   kill-switch fired but contract ${contract} has no Bond to slash`); return; }
  if (escrow.settled) { io.err(`  settle   kill-switch fired but contract ${contract} was already settled`); return; }
  const cbody = contractRec.record.body as { principal: string; bank: string };
  const bankSigner = new Keystore(home).forDid(cbody.bank);
  const principalSigner = new Keystore(home).forDid(cbody.principal);
  if (!bankSigner || !principalSigner) {
    io.err(`  settle   kill-switch fired but could not auto-settle: no local key for ${!bankSigner ? cbody.bank : cbody.principal}`);
    return;
  }
  const chain = await marketChain(local.log, contract);
  const body = {
    contract, basis: "revoked" as const,
    escrow_released: { value: 0, unit: "credit" }, bond_returned: { value: 0, unit: "credit" },
    bond_slashed: { value: escrow.bondLocked, unit: "credit" }, pro_rata_permille: 0,
  };
  let record = createRecord({ type: "settlement", issuer: cbody.bank, subject: contract, prev: chain.at(-1)!.id, body, issued_at: now() }, bankSigner);
  record = cosign(record, principalSigner);
  try {
    const res = await local.append(record);
    io.err(`  settle   ${res.id} kill-switch settlement: bond fully slashed, escrow returned to the principal`);
  } catch (e) {
    io.err(`  settle   kill-switch fired but auto-settlement was refused: ${(e as Error).message}`);
  }
}

/**
 * Approval gates, the run side. The pre-call hook holds a gated call and drops a request file; this
 * raises it as a Checkpoint (signed by the performer, which moves the job to Checkpoint), waits for the
 * principal's signed checkpoint_resolution to appear in the log, and writes the hook's decision file:
 * approved only for an `approved` resolution. Each request reopens the log fresh, because the principal
 * answers from another process, and requests are served one at a time (a job has one open Checkpoint).
 */
function serveApprovals(o: { dir: string; home: string; contract: string; agent: string; pollMs: number; waitSeconds: number; io: Io }) {
  let stopped = false;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // Written to a temporary name and renamed, so a hook polling for the file never reads half of it (found by the Postgres CI job: it failed closed on "Unexpected end of JSON input").
  const decide = (id: string, d: { approved: boolean; reason?: string }) => {
    const tmp = join(o.dir, `${id}.decision.tmp`);
    writeFileSync(tmp, JSON.stringify(d));
    renameSync(tmp, join(o.dir, `${id}.decision.json`));
  };

  async function handle(req: { id: string; tool: string; scope: string; summary: string }) {
    const signer = new Keystore(o.home).forDid(o.agent);
    if (!signer) return decide(req.id, { approved: false, reason: `no key for ${o.agent} to raise the Checkpoint` });
    // A job has one open Checkpoint at a time: wait for any earlier one to be resolved first.
    let local = await openLog(o.home);
    while ((await local.log.chainInfo(o.contract))?.state !== "Running") {
      if (stopped) return;
      await sleep(o.pollMs);
      local = await openLog(o.home);
    }
    // What the principal sees, and what goes in the log, is the command with anything secret-looking masked.
    const masked = redactSecrets(req.summary);
    const shown = masked.text.length > 300 ? masked.text.slice(0, 300) + "..." : masked.text;
    const head = (await marketChain(local.log, o.contract)).at(-1)!;
    const principal = ((await local.log.get(o.contract))!.record.body as { principal: string }).principal;
    // The request expires when the hook gives up waiting; then the performer closes the Checkpoint itself, so the job is not stuck.
    const expiresMs = Math.ceil((Date.now() + o.waitSeconds * 1000) / 1000) * 1000;
    const checkpoint = createRecord({
      type: "checkpoint", issuer: o.agent, subject: o.contract, prev: head.id, issued_at: now(),
      body: { contract: o.contract, kind: "before_irreversible", question: `May ${o.agent} run ${req.tool} (${req.scope})?`, proposed_action: shown,
        expires: new Date(expiresMs).toISOString().replace(/\.\d{3}Z$/, "Z") },
    }, signer);
    await local.append(checkpoint);
    o.io.err(`  APPROVAL NEEDED  ${req.scope}: ${shown}${masked.redacted ? "  (secret-looking text was masked)" : ""}`);
    o.io.err(`    answer with: asp market resolve --contract ${o.contract} --by ${principal} --verdict approved`);
    for (;;) {
      // The run is over: wait out a nearly-expired request, but leave a far-off one open (it can be answered, or expired later).
      if (stopped && expiresMs + 1000 - Date.now() > 10_000) {
        o.io.err(`  note     the Checkpoint for ${req.scope} is still open; the principal can answer it, or ${o.agent} can close it after ${new Date(expiresMs).toISOString()} with asp market resolve --verdict expired`);
        return;
      }
      await sleep(o.pollMs);
      const fresh = await openLog(o.home);
      const chain = await marketChain(fresh.log, o.contract);
      const at = chain.findIndex((x) => x.id === checkpoint.id);
      const resolution = chain.slice(at + 1).find((x) => {
        const b = x.record.body as { kind?: string; about?: string };
        return x.record.type === "asp.attestation/v0.2" && b.kind === "checkpoint_resolution" && b.about === checkpoint.id;
      });
      if (!resolution) {
        if (Date.now() < expiresMs + 1000) continue;
        const expired = createRecord({
          type: "attestation", issuer: o.agent, subject: o.contract, prev: chain.at(-1)!.id, issued_at: now(),
          body: { kind: "checkpoint_resolution", about: checkpoint.id, verdict: "expired" },
        }, signer);
        await fresh.append(expired);
        o.io.err(`  approval expired for ${req.scope}: no answer in ${o.waitSeconds} s, so the call was refused and the job runs again`);
        return decide(req.id, { approved: false, reason: `the principal did not answer within ${o.waitSeconds} seconds` });
      }
      const b = resolution.record.body as { verdict: string; correction?: string };
      const approved = b.verdict === "approved";
      o.io.err(`  approval ${approved ? "granted" : "refused"} for ${req.scope}${b.correction ? `: ${b.correction}` : ""}`);
      return decide(req.id, approved ? { approved: true } : { approved: false, reason: b.correction ?? `the principal answered ${b.verdict}` });
    }
  }

  const loop = (async () => {
    mkdirSync(o.dir, { recursive: true });
    while (!stopped) {
      const files = readdirSync(o.dir).filter((f) => f.endsWith(".request.json")).sort();
      for (const f of files) {
        if (stopped) break;
        const path = join(o.dir, f);
        const req = JSON.parse(readFileSync(path, "utf8"));
        renameSync(path, join(o.dir, f.replace(".request.json", ".request.seen.json")));
        try { await handle(req); } catch (e) { try { decide(req.id, { approved: false, reason: `asp run could not raise the Checkpoint: ${(e as Error).message}` }); } catch { /* the run is ending */ } }
      }
      await sleep(o.pollMs);
    }
  })();
  return { stop: async () => { stopped = true; await loop; } };
}

async function runIn(pkgDir: string, home: string, backend: string, adapter: RuntimeAdapter, v: Values, io: Io, onMutate: () => void): Promise<number> {
  const report = await verifyPackage(pkgDir);
  if (!report.ok) {
    io.err(`refusing to run: the package does not verify (${report.checks.filter((c) => c.status === "fail").map((c) => c.name).join(", ")}). Run asp verify for details.`);
    return 1;
  }
  const manifest = JSON.parse(readFileSync(join(pkgDir, "manifest.json"), "utf8")) as AspRecord;
  const harness = JSON.parse(readFileSync(join(pkgDir, "harness", "harness.json"), "utf8")) as Harness;
  const agent = report.agent!;
  const runDir = join(home, "runs", `${slug(agent)}-${now().replace(/[:]/g, "")}`);
  const maxStrikes = v["max-strikes"] === undefined ? 3 : Number(v["max-strikes"]);
  if (!Number.isInteger(maxStrikes) || maxStrikes < 1) throw new UsageError("--max-strikes must be a whole number, at least 1");
  const approvalWait = v["approval-wait"] === undefined ? 600 : Number(v["approval-wait"]);
  if (!Number.isInteger(approvalWait) || approvalWait < 1) throw new UsageError("--approval-wait must be a whole number of seconds, at least 1");
  mkdirSync(runDir, { recursive: true });
  // The memory this run starts from, kept to merge against: another run may write back first.
  const baseMemory = join(runDir, "memory-base");
  mkdirSync(baseMemory, { recursive: true });
  if (existsSync(join(pkgDir, "memory"))) cpSync(join(pkgDir, "memory"), baseMemory, { recursive: true });
  // Under a contract, the live Mandate is read once up front: it drives the pre-call hook (an
  // out-of-scope call is blocked before it runs, where the adapter supports it) and the live check below.
  let local = v.contract ? await openLog(home, logEnv) : undefined;
  // A contract that is not running has no live Mandate to enforce: running the agent anyway would leave every call unchecked
  // (found live: a demoted agent's job never reached Running, and the agent ran with no limits at all).
  if (v.contract) {
    const state = (await local!.log.chainInfo(v.contract))?.state;
    if (state !== "Running" && state !== "Checkpoint") {
      io.err(`refusing to run: contract ${v.contract} is ${state ?? "not in the log"}, not Running, so there is no live Mandate to enforce. Finish setting the job up (bond, then mandate) first.`);
      return 1;
    }
  }
  const mandate = v.contract ? await local!.log.mandateOf(v.contract) : undefined;
  // The Mandate's irreversible policy: scopes that need the principal's approval first, or are forbidden.
  let gate: { scopes: string[]; mode: "ask" | "deny"; waitSeconds: number } | undefined;
  let mandateHosts: string[] | undefined;
  if (v.contract && mandate) {
    const mandateRecord = (await local!.log.chain(v.contract)).filter((x) => x.record.type === "asp.mandate/v0.2").at(-1);
    const irreversible = (mandateRecord?.record.body as { irreversible?: { policy?: string; scopes?: string[] } } | undefined)?.irreversible;
    mandateHosts = (mandateRecord?.record.body as { network?: { hosts?: string[] } } | undefined)?.network?.hosts;
    if (irreversible?.scopes?.length && irreversible.policy !== "allow") {
      gate = { scopes: irreversible.scopes, mode: irreversible.policy === "forbid" ? "deny" : "ask", waitSeconds: approvalWait };
    }
  }
  // Commands an upheld report found harmful are blocked before they run, whatever the Mandate grants (S54).
  let knownBad: KnownBadEntry[] = [];
  if (v.contract) {
    try { knownBad = await loadKnownBad(home, io); } catch (e) { io.err(`  warning  could not read the known-bad list, so it is not enforced: ${(e as Error).message}`); }
  }
  const plan = await adapter.materialize({
    pkgDir, harness, project: resolve(io.cwd, v.project ?? "."), runDir, agentName: basename(agent.replace(/:/g, "/")), prompt: v.prompt, env: io.env,
    mandateScopes: mandate?.scopes, mandateHosts, mandateGate: gate, mandateKnownBad: knownBad.map((e) => ({ fingerprint: e.fingerprint, report: e.report })), model: v.model, endpoint: v.endpoint, apiKeyEnv: v["api-key-env"], sourceRuntime: (manifest.body as any).source_runtime?.name,
  });

  if (knownBad.length) io.err(plan.preventsCalls ? `  note     ${knownBad.length} known-bad command fingerprint(s) are enforced by the pre-call hook` : `  note     the known-bad list (${knownBad.length}) is not enforced: this runtime has no pre-call hook`);
  // The run's own report goes to stderr, so a -p run's stdout stays the runtime's stream alone.
  const current = currentRuntime(pkgDir, manifest);
  const swap = current !== backend;
  io.err(`run ${agent} on ${backend}${swap ? ` (last ran on ${current})` : ""}`);
  io.err(`  run dir  ${runDir}`);
  io.err(`  cwd      ${plan.cwd}`);
  io.err(`  command  ${[plan.command, ...plan.args].map(quote).join(" ")}`);
  for (const n of plan.notes) io.err(`  note     ${n}`);
  if (swap) io.err(`  note     ${v["dry-run"] ? "a real run would record" : "after a successful run, records"} the backend swap ${current} -> ${backend} as a lineage update (7-day probation)`);
  if (plan.missingSecrets.length) {
    io.err(`missing secrets: ${plan.missingSecrets.join(", ")}; set them as environment variables.`);
    if (!v["dry-run"]) return 1;
  }
  if (v["dry-run"]) return 0;

  // Some runtimes report a fatal error only inside their output stream and still exit 0
  // (see checkOutputForFailure); when the adapter asks for it, stdout is piped and scanned
  // line by line while still being forwarded, instead of simply inherited. The compliance bridge
  // (checkOutputForAction, docs/backlog.md) piggybacks on the same piping: real tool-call scopes,
  // not self-declared ones, collected as they happen.
  //
  // Kill switch (docs/backlog.md, raised 2026-09-28): with a live Mandate to check against, the
  // very first out-of-scope call stops the child process instead of only being flagged once the
  // run has already finished. It can't undo the call that already happened, but it stops the next
  // one. SIGTERM first, SIGKILL after a grace period if the runtime doesn't exit on its own.
  //
  // Strikes (docs/backlog.md): where the adapter blocks out-of-scope calls before they run (a
  // pre-call hook), a blocked attempt did no harm, so it is a signed strike, not grounds for the full
  // settlement: the run is stopped only when --max-strikes blocked attempts pile up (probing), or
  // when an out-of-scope call actually executed (the hook missing, failing open, or timing out).
  // Each out-of-scope call waits for its outcome (checkOutputForResult) before it is judged.
  const KILL_GRACE_MS = 3000;
  // The run log (E5): what the runtime's output shows, redacted, in the run folder; the Actions commit to its hash. Needs the output piped, which every
  // adapter that reads it asks for; an interactive run with no prompt has no stream to read and keeps none.
  const runLog = (v["no-run-log"] || !(plan.checkOutputForAction || plan.checkOutputForFailure)) ? undefined : new RunRecorder(join(runDir, "run-log.ndjson"));
  runLog?.event("run_start", { contract: v.contract, agent, backend, scopes: mandate?.scopes, ...(mandateHosts ? { hosts: mandateHosts } : {}), command: [plan.command, ...plan.args].join(" "), assurance: plan.preventsCalls ? "hook_enforced" : "runtime_observed" });
  if (runLog) io.err(`  run log  ${runLog.path}`);
  let hiddenFailure: string | undefined;
  const scopesSeen = new Set<string>();
  const artifactsSeen: { uri: string; sha256: string }[] = [];
  const prevents = !!(plan.preventsCalls && plan.checkOutputForResult && mandate);
  const pending = new Map<string, { scope: string; artifact?: { uri: string; sha256: string }; gated: boolean }>();
  const gatedScopes = new Set(gate?.mode === "ask" ? gate.scopes : []);
  const forbiddenScopes = new Set(gate?.mode === "deny" ? gate.scopes : []);
  if (gate?.mode === "ask" && !plan.approvalsDir) {
    io.err(`  note     ${backend} cannot hold a call for approval, so ${gate.scopes.join(", ")} are NOT gated on this run`);
  }
  const knownBadSet = new Set(knownBad.map((e) => e.fingerprint));
  const blockedByScope = new Map<string, number>();
  let strikes = 0;
  let killed: { scope: string; reason: "violation" | "probing" } | undefined;
  const code = await new Promise<number>((done) => {
    const child = spawn(plan.command, plan.args, {
      cwd: plan.cwd, env: { ...io.env, ...plan.env },
      // A run given a --prompt is headless: its stdin is closed, so a runtime that also reads stdin (Codex does when stdin is a pipe) cannot wait on it forever.
      stdio: (plan.checkOutputForFailure || plan.checkOutputForAction) ? [v.prompt !== undefined ? "ignore" : "inherit", "pipe", "inherit"] : v.prompt !== undefined ? ["ignore", "inherit", "inherit"] : "inherit",
    });
    let killTimer: NodeJS.Timeout | undefined;
    const approvals = plan.approvalsDir && v.contract
      ? serveApprovals({ dir: plan.approvalsDir, home, contract: v.contract, agent, pollMs: Number(io.env.ASP_APPROVAL_POLL_MS) > 0 ? Number(io.env.ASP_APPROVAL_POLL_MS) : 1000, waitSeconds: approvalWait, io })
      : undefined;
    const strike = (scope: string, how: string) => {
      strikes++;
      runLog?.event("strike", { scope, how, strikes, max: maxStrikes });
      blockedByScope.set(scope, (blockedByScope.get(scope) ?? 0) + 1);
      io.err(`  strike   ${scope} was ${how} (${strikes} of ${maxStrikes})`);
      if (strikes >= maxStrikes) halt({ scope, reason: "probing" }, `${strikes} blocked attempts reached the limit of ${maxStrikes}; stopping ${backend} now.`);
    };
    // Did the runtime actually run this call? Where the adapter records that (its post-call events), the
    // record decides; the result's text never does. The record may land a moment after the result, so a call
    // with no record yet is rechecked for a short grace period before it is judged not run.
    const ranFile = plan.executedCallsFile;
    const didRun = (id: string): boolean => {
      if (!ranFile || !existsSync(ranFile)) return false;
      return readFileSync(ranFile, "utf8").split(/\r?\n/).some((l) => { try { return JSON.parse(l).id === id; } catch { return false; } });
    };
    const confirmations: Promise<void>[] = [];
    // How long a missing record is waited for (default 3 s; ASP_RAN_GRACE_MS raises it, e.g. on a heavily loaded machine).
    const graceTicks = Math.max(1, Math.ceil((Number(io.env.ASP_RAN_GRACE_MS) > 0 ? Number(io.env.ASP_RAN_GRACE_MS) : 3000) / 100));
    const settle = (id: string, onRan: () => void, onNotRun: () => void) => {
      if (!ranFile || didRun(id)) { onRan(); return; } // no record kept for this runtime: assume it ran
      confirmations.push((async () => {
        for (let i = 0; i < graceTicks; i++) {
          await new Promise((r) => setTimeout(r, 100));
          if (didRun(id)) { onRan(); return; }
        }
        onNotRun();
      })());
    };
    const halt = (k: { scope: string; reason: "violation" | "probing" }, message: string) => {
      if (killed) return;
      killed = k;
      runLog?.event("kill", { scope: k.scope, reason: k.reason, message });
      io.err(`  KILL SWITCH  ${message}`);
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, KILL_GRACE_MS);
    };
    if (plan.checkOutputForFailure || plan.checkOutputForAction) {
      let carry = "";
      child.stdout!.on("data", (chunk: Buffer) => {
        (io.raw ?? ((c: Buffer) => process.stdout.write(c)))(chunk);
        carry += chunk.toString("utf8");
        const lines = carry.split("\n");
        carry = lines.pop() ?? "";
        for (const line of lines) {
          hiddenFailure ??= plan.checkOutputForFailure?.(line);
          if (runLog) for (const e of plan.describeOutput?.(line) ?? []) runLog.event(e.kind, e.data);
          for (const call of plan.checkOutputForAction?.(line) ?? []) {
            const outside = !!mandate && (!mandate.scopes.includes(call.scope) || forbiddenScopes.has(call.scope));
            const held = !outside && !!plan.approvalsDir && gatedScopes.has(call.scope);
            // A listed command is blocked by the hook though its scope is granted: judge it by its outcome like an out-of-scope call.
            const listed = !outside && !held && !!call.artifact && knownBadSet.has(`${call.artifact.uri}#${call.artifact.sha256}`);
            runLog?.event("call_judged", { ...(call.id ? { id: call.id } : {}), scope: call.scope, granted: !outside, ...(held ? { gated: true } : {}), ...(listed ? { known_bad: true } : {}) });
            if (prevents && (outside || held || listed) && call.id) {
              pending.set(call.id, { scope: call.scope, artifact: call.artifact, gated: held });
              continue;
            }
            scopesSeen.add(call.scope);
            if (call.artifact) artifactsSeen.push(call.artifact);
            if (outside) halt({ scope: call.scope, reason: "violation" }, `${call.scope} is outside the Mandate; stopping ${backend} now.`);
          }
          if (prevents) for (const res of plan.checkOutputForResult!(line) ?? []) {
            const call = pending.get(res.id);
            if (!call) continue;
            pending.delete(res.id);
            const ran = () => { scopesSeen.add(call.scope); if (call.artifact) artifactsSeen.push(call.artifact); };
            if (call.gated) {
              // An approval gate, not a violation: refused means the call never ran and nothing is counted.
              if (res.blocked) io.err(`  gate     ${call.scope} was not approved, so the call did not run`);
              else settle(res.id, ran, () => io.err(`  gate     ${call.scope} was approved, but the runtime did not run the call`));
              continue;
            }
            if (res.blocked) strike(call.scope, call.artifact && knownBadSet.has(`${call.artifact.uri}#${call.artifact.sha256}`) && mandate!.scopes.includes(call.scope) ? "a known-bad command, blocked before it ran" : "blocked before it ran");
            else if (mandate!.scopes.includes(call.scope) && call.artifact && knownBadSet.has(`${call.artifact.uri}#${call.artifact.sha256}`)) {
              // In scope, on the list, and not blocked: the hook did not stop it. It is reported as what it was, a call that ran.
              settle(res.id, () => { ran(); io.err("  warning  a known-bad command ran: the pre-call hook did not block it"); }, () => strike(call.scope, "refused by the runtime before it ran"));
            } else {
              // No hook blocked it. It is only a violation if the runtime says it ran: its own permissions may
              // have refused the call, which did no harm and is a strike, never a slash.
              settle(res.id,
                () => { ran(); halt({ scope: call.scope, reason: "violation" }, `${call.scope} is outside the Mandate and the call ran; stopping ${backend} now.`); },
                () => strike(call.scope, "refused by the runtime before it ran"));
            }
          }
        }
      });
    }
    child.on("error", (e: NodeJS.ErrnoException) => {
      io.err(e.code === "ENOENT"
        ? `${plan.command} is not installed or not on PATH. Install it, or rerun with --dry-run.`
        : `could not start ${plan.command}: ${e.message}`);
      void (approvals ? approvals.stop() : Promise.resolve()).then(() => done(-1));
    });
    // "close", not "exit": every line of output is read (and every outcome judged) before the run is wrapped up.
    child.on("close", (c) => {
      if (killTimer) clearTimeout(killTimer);
      void (approvals ? approvals.stop() : Promise.resolve())
        .then(() => Promise.all(confirmations))
        .then(() => done(c ?? 1));
    });
  });
  if (code === -1) return 1;
  // The principal may have answered Checkpoints from another process while the run was going.
  if (v.contract) local = await openLog(home, logEnv);

  if (pending.size) io.err(`  note     ${pending.size} out-of-scope call(s) ended with no result, so they were not counted either way`);
  // The pre-call hook's own records see calls the output does not show (a subagent's): merge them, never double counting.
  if (plan.blockedCallsFile && existsSync(plan.blockedCallsFile)) {
    const fromHook = new Map<string, number>();
    for (const line of readFileSync(plan.blockedCallsFile, "utf8").split(/\r?\n/)) {
      try { const b = JSON.parse(line); if (typeof b.scope === "string" && b.scope) fromHook.set(b.scope, (fromHook.get(b.scope) ?? 0) + 1); } catch { /* not a record */ }
    }
    for (const [scope, n] of fromHook) {
      if (n > (blockedByScope.get(scope) ?? 0)) {
        io.err(`  strike   ${n - (blockedByScope.get(scope) ?? 0)} more ${scope} call(s) were blocked by the hook where the output did not show them (a subagent's)`);
        blockedByScope.set(scope, n);
      }
    }
  }
  if (plan.executedCallsFile && existsSync(plan.executedCallsFile)) {
    for (const line of readFileSync(plan.executedCallsFile, "utf8").split(/\r?\n/)) {
      try { const e = JSON.parse(line); if (typeof e.scope === "string" && e.scope && mandate?.scopes.includes(e.scope)) scopesSeen.add(e.scope); } catch { /* not a record */ }
    }
  }
  const blockedAttempts = [...blockedByScope].sort(([a], [b]) => a.localeCompare(b)).map(([scope, count]) => ({ scope, count }));
  runLog?.event("run_end", { exit_code: code, scopes_used: [...scopesSeen].sort(), blocked: blockedAttempts, strikes, ...(killed ? { killed: killed.reason } : {}), ...(hiddenFailure ? { failure: hiddenFailure } : {}), redactions: runLog?.redactions });

  if (killed) {
    // A refused Action record for the offending scope, purely for the paper trail (it will be
    // refused the same way checkAction refuses any out-of-scope call — this never gets laundered
    // into a clean-looking log). Then the same economic consequence a Courts ruling of full fault
    // would produce: escrow back to the principal, the performer's whole bond slashed — without
    // waiting for a human to notice the job stalled Running and open a dispute themselves.
    const actionSigner = new Keystore(home).forDid(agent);
    if (actionSigner) {
      const action = createRecord({
        type: "action", issuer: agent, subject: v.contract!, prev: null, issued_at: now(),
        body: {
          contract: v.contract!, scopes_used: [...scopesSeen].sort(), assurance: plan.preventsCalls ? "hook_enforced" : "runtime_observed", summary: `${backend} run, ${runDir}, killed mid-run`,
          ...(blockedAttempts.length ? { blocked_attempts: blockedAttempts } : {}),
          ...(artifactsSeen.length || runLog ? { artifacts: [...artifactsSeen, ...(runLog ? [runLogArtifact(runLog.head())] : [])] } : {}),
        },
      }, actionSigner);
      try { await local!.append(action); } catch (e) { io.err(`  action   COMPLIANCE VIOLATION: ${(e as Error).message}`); }
    }
    await autoSettleOnKill(local!, home, v.contract!, io);
    const why = killed.reason === "probing" ? `repeated blocked attempts (${strikes}, limit ${maxStrikes})` : `a Mandate violation (${killed.scope})`;
    io.err(`${backend} killed mid-run for ${why}; nothing written back. The run's memory is in ${plan.memoryDir ?? runDir}.`);
    return 1;
  }

  if (code !== 0 || hiddenFailure) {
    if (hiddenFailure) io.err(`${backend} reported a failure it did not exit with: ${hiddenFailure}`);
    io.err(`${backend} ${hiddenFailure ? "failed" : `exited with code ${code}`}; nothing written back. The run's memory is in ${plan.memoryDir ?? runDir}.`);
    return hiddenFailure ? 1 : code;
  }

  // The runtime -> protocol compliance bridge: report what was actually used against the
  // contract's live Mandate, before the agent gets to write up a clean Delivery. Self-reported by
  // this same CLI process (not the runtime), so it can't be skipped by a runtime that doesn't know
  // about it, but it's still only as honest as the tool-call parsing that produced scopesSeen.
  if (v.contract && (scopesSeen.size || blockedAttempts.length || runLog)) {
    const actionSigner = new Keystore(home).forDid(agent);
    if (actionSigner) {
      const action = createRecord({
        type: "action", issuer: agent, subject: v.contract, prev: null, issued_at: now(),
        body: {
          contract: v.contract, scopes_used: [...scopesSeen].sort(), assurance: plan.preventsCalls ? "hook_enforced" : "runtime_observed", summary: `${backend} run, ${runDir}`,
          ...(blockedAttempts.length ? { blocked_attempts: blockedAttempts } : {}),
          ...(artifactsSeen.length || runLog ? { artifacts: [...artifactsSeen, ...(runLog ? [runLogArtifact(runLog.head())] : [])] } : {}),
        },
      }, actionSigner);
      try {
        const res = await local!.append(action);
        io.err(`  action   ${res.id} reported scopes: ${[...scopesSeen].sort().join(", ") || "none"}${blockedAttempts.length ? `; ${blockedAttempts.reduce((n, b) => n + b.count, 0)} blocked attempt(s) recorded as a strike` : ""}`);
      } catch (e) {
        if (/is not currently Running/.test((e as Error).message)) {
          // The job ended while the run was going (a revoke or a settlement): report the run as a late Action (S80); the log refuses it if it is too late.
          const lateAction = createRecord({ type: "action", issuer: agent, subject: v.contract, prev: null, issued_at: now(), body: { ...(action.body as object), late: { activity_ended: now() } } }, actionSigner);
          try {
            const res = await local!.append(lateAction);
            io.err(`  action   ${res.id} reported late: the job had ended while the run was going`);
          } catch (e2) {
            io.err(`  action   COMPLIANCE VIOLATION: ${(e2 as Error).message}`);
          }
        } else io.err(`  action   COMPLIANCE VIOLATION: ${(e as Error).message}`);
      }
    }
  }

  // Write back: a backend swap and any memory the agent changed become signed lineage updates.
  const changes: LineageChange[] = [];
  if (swap) changes.push({ layer: "backend", description: `runtime ${current} -> ${backend}`, probationDays: 7 });
  const diff = plan.memoryDir ? diffTrees(baseMemory, plan.memoryDir) : undefined;
  const memoryChanged = !!diff && !isEmptyDiff(diff) && !v["no-write-back"];
  let memoryFrom = plan.memoryDir;
  if (memoryChanged) {
    // If another run wrote back since this one started, merge this run's changes onto what the package holds now.
    const current = join(pkgDir, "memory");
    const otherChanges = existsSync(current) && !isEmptyDiff(diffTrees(baseMemory, current));
    if (otherChanges) {
      const mergedDir = join(runDir, "memory-merged");
      cpSync(current, mergedDir, { recursive: true });
      for (const n of mergeMemoryInto(mergedDir, baseMemory, plan.memoryDir!, { name: "this run", label: "run", other: "another run's" })) io.err(`  note     ${n}`);
      memoryFrom = mergedDir;
      io.err("  note     another run changed this agent's memory while this one ran; the two were merged");
    }
    const budget = enforceMemoryBudget(memoryFrom!, memoryBudget(v));
    for (const f of budget.pruned) io.err(`  note     memory over budget: pruned ${f}`);
    changes.push({ layer: "memory", description: `memory updated during a ${backend} run: +${diff!.added.length} ~${diff!.changed.length} -${diff!.removed.length} files${otherChanges ? ", merged with another run" : ""}${budget.pruned.length ? `, pruned ${budget.pruned.length} over budget` : ""}` });
  }
  if (!changes.length) return 0;

  const signer = new Keystore(home).forDid(agent);
  if (!signer) {
    io.err(`no key for ${agent} in ${join(home, "keys")}: cannot sign the lineage update. The run's memory is in ${plan.memoryDir}.`);
    return 0;
  }
  // Every write-back path goes through applyChange, which tests the change with the canary when the agent has a target for this backend (gaps register CM1, CM6).
  const applied = await applyChange({ home, io, v, agent, backend, pkgDir, signer, changes, memoryFrom: memoryChanged ? memoryFrom : undefined, keptAt: plan.memoryDir });
  if (applied.blocked) return 0;
  const edges = applied.edges;
  onMutate();
  for (const e of edges) io.err(`  recorded ${(e.body as any).change.description} (${e.id})`);
  io.err(`  package  ${pkgDir} re-signed`);
  await syncLocalLog(home, pkgDir, agent, io);
  return 0;
}

interface NodeResult {
  index: number;
  task: string;
  ok: boolean;
  runDir: string;
  memoryDir?: string;
  error?: string;
}

/**
 * Runs one task per node in parallel, each under its own signed, short-lived delegated key
 * (asp.node/v0.2; nodes only write memory, per the spec's Learning section), then consolidates
 * every node's memory changes into a single signed lineage update for the agent.
 */
async function orchestrate(home: string, pkg: string | undefined, v: Values, need: Need, io: Io): Promise<number> {
  if (!pkg) throw new UsageError("asp orchestrate <package> --backend <runtime> --task <text> [--task <text> ...]");
  const backend = need("backend");
  const adapter = ADAPTERS[backend];
  if (!adapter) throw new UsageError(`unknown backend ${backend}; available: ${Object.keys(ADAPTERS).join(", ")}`);
  const tasks = v.task ?? [];
  if (!tasks.length) throw new UsageError("--task is required at least once");
  const maxParallel = Math.max(1, Math.trunc(Number(v["max-parallel"] ?? 4)) || 1);

  const resolved = await resolvePackage(resolve(io.cwd, pkg));
  let mutated = false;
  try {
    return await orchestrateIn(resolved.dir);
  } finally {
    await finishPackage(resolved, mutated);
  }

  async function orchestrateIn(pkgDir: string): Promise<number> {
  const report = await verifyPackage(pkgDir);
  if (!report.ok) {
    io.err(`refusing to orchestrate: the package does not verify (${report.checks.filter((c) => c.status === "fail").map((c) => c.name).join(", ")}). Run asp verify for details.`);
    return 1;
  }
  const manifest = JSON.parse(readFileSync(join(pkgDir, "manifest.json"), "utf8")) as AspRecord;
  const harness = JSON.parse(readFileSync(join(pkgDir, "harness", "harness.json"), "utf8")) as Harness;
  const agent = report.agent!;
  const foundSigner = new Keystore(home).forDid(agent);
  if (!foundSigner) throw new Error(`no key for ${agent} in ${join(home, "keys")}`);
  const signer = foundSigner;
  const project = resolve(io.cwd, v.project ?? ".");
  const local = await openLog(home, logEnv);
  const inLocalLog = !!(await local.log.passport(agent));
  const dryRun = v["dry-run"] ?? false;

  const batchTag = Date.now().toString(36);
  const batchDir = join(home, "runs", `${slug(agent)}-fleet-${batchTag}`);
  mkdirSync(batchDir, { recursive: true });
  io.err(`orchestrating ${tasks.length} task(s) for ${agent} on ${backend} (up to ${maxParallel} in parallel)`);
  io.err(`  batch    ${batchDir}`);

  const results: NodeResult[] = new Array(tasks.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor++;
      if (i >= tasks.length) return;
      results[i] = await runNode(i);
    }
  }

  async function runNode(i: number): Promise<NodeResult> {
    const index = i + 1;
    const task = tasks[i];
    const runDir = join(batchDir, `node-${index}`);
    mkdirSync(runDir, { recursive: true });
    const plan = await adapter.materialize({
      pkgDir, harness, project, runDir, agentName: `${basename(agent.replace(/:/g, "/"))}-node${index}`,
      prompt: task, env: io.env, model: v.model, endpoint: v.endpoint, apiKeyEnv: v["api-key-env"], sourceRuntime: (manifest.body as any).source_runtime?.name,
    });
    io.err(`  node ${index}  ${task.length > 60 ? task.slice(0, 57) + "..." : task}`);
    io.err(`         command  ${[plan.command, ...plan.args].map(quote).join(" ")}`);
    if (dryRun) return { index, task, ok: true, runDir, memoryDir: plan.memoryDir };
    if (plan.missingSecrets.length) {
      const error = `missing secrets: ${plan.missingSecrets.join(", ")}`;
      io.err(`  node ${index}  FAILED  ${error}`);
      return { index, task, ok: false, runDir, error };
    }

    // A delegated, short-lived key for this node (spec/schemas/node.schema.json); no Mandate yet in
    // single-player mode, so it is bookkeeping and audit trail only (see MOCKS.md).
    // --isolate: the node is its own independently liable copy; otherwise it is a key of the one agent.
    let liable: { did: string; signer: Signer & { publicKey: Uint8Array } } = { did: agent, signer };
    if (v.isolate) {
      try { liable = await createCopy(home, local, agent); io.err(`  node ${index}  runs as its own copy ${liable.did}`); }
      catch (e) { io.err(`  node ${index}  FAILED  could not make an independent copy: ${(e as Error).message}`); return { index, task, ok: false, runDir, error: "isolation failed" }; }
    }
    const nodeSeed = randomSeed();
    const nodeKid = `${liable.did}#node-${batchTag}-${index}`;
    const nodeRecord = createRecord({
      type: "node", issuer: liable.did, subject: liable.did, prev: null, issued_at: now(),
      body: {
        node: nodeKid, public_key: b64urlEncode(publicKeyFromSeed(nodeSeed)),
        expires: new Date(Date.now() + 3600_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
        purpose: task.slice(0, 200),
      },
    }, liable.signer);
    if (inLocalLog) {
      try { await local.append(nodeRecord); } catch { /* best-effort: node bookkeeping only */ }
    }
    // A node whose task is abandoned shouldn't just sit there until its hour is up: chain an
    // immediate revocation onto its own grant the moment failure is known (the existing
    // revoke-by-chaining pattern: a second Node record with expires <= issued_at).
    async function revokeAbandonedNode(): Promise<void> {
      if (!inLocalLog) return;
      try {
        const revokedAt = now();
        const revoke = createRecord({
          type: "node", issuer: liable.did, subject: liable.did, prev: nodeRecord.id, issued_at: revokedAt,
          body: { node: nodeKid, public_key: b64urlEncode(publicKeyFromSeed(nodeSeed)), expires: revokedAt, purpose: task.slice(0, 200) },
        }, liable.signer);
        await local.append(revoke);
      } catch { /* best-effort: node bookkeeping only */ }
    }

    const stdoutLog = join(runDir, "stdout.log");
    const stderrLog = join(runDir, "stderr.log");
    let hiddenFailure: string | undefined;
    const code = await new Promise<number>((done) => {
      const child = spawn(plan.command, plan.args, { cwd: plan.cwd, env: { ...io.env, ...plan.env }, stdio: ["ignore", "pipe", "pipe"] });
      let outCarry = "";
      child.stdout!.on("data", (chunk: Buffer) => {
        appendFileEnsured(stdoutLog, chunk);
        if (!plan.checkOutputForFailure) return;
        outCarry += chunk.toString("utf8");
        const lines = outCarry.split("\n");
        outCarry = lines.pop() ?? "";
        for (const line of lines) hiddenFailure ??= plan.checkOutputForFailure!(line);
      });
      child.stderr!.on("data", (chunk: Buffer) => appendFileEnsured(stderrLog, chunk));
      child.on("error", (e: NodeJS.ErrnoException) => {
        io.err(`  node ${index}  FAILED  ${e.code === "ENOENT" ? `${plan.command} is not installed or not on PATH` : e.message}`);
        done(-1);
      });
      child.on("exit", (c) => done(c ?? 1));
    });
    if (code === -1) {
      await revokeAbandonedNode();
      return { index, task, ok: false, runDir, error: "could not start the runtime" };
    }
    if (code !== 0 || hiddenFailure) {
      const error = hiddenFailure ?? `exited with code ${code}`;
      io.err(`  node ${index}  FAILED  ${error} (log: ${stderrLog})`);
      await revokeAbandonedNode();
      return { index, task, ok: false, runDir, error };
    }
    io.err(`  node ${index}  ok`);
    return { index, task, ok: true, runDir, memoryDir: plan.memoryDir };
  }

  await Promise.all(Array.from({ length: Math.min(maxParallel, tasks.length) }, worker));
  const succeeded = results.filter((r) => r.ok && r.memoryDir);
  const failed = results.filter((r) => !r.ok);
  io.err(`  ${succeeded.length}/${tasks.length} node(s) succeeded${failed.length ? `; failed: ${failed.map((r) => r.index).join(", ")}` : ""}`);
  if (dryRun) return 0;
  if (!succeeded.length) {
    io.err("  no node completed successfully; nothing consolidated");
    return 1;
  }

  // Consolidation: every node's memory diff is merged into one tree. MEMORY.md entries are unioned
  // (deduplicated line by line); other files that differ between nodes are kept side by side rather
  // than one silently overwriting another's lesson (spec: "deduplicates lessons, resolves
  // contradictions... produces one update to the person").
  const baseMemDir = join(pkgDir, "memory");
  const mergedDir = join(batchDir, "memory");
  if (existsSync(baseMemDir)) cpFolder(baseMemDir, mergedDir);
  mkdirSync(join(mergedDir, "auto"), { recursive: true });
  const conflictNotes: string[] = [];
  for (const r of succeeded) {
    conflictNotes.push(...mergeMemoryInto(mergedDir, baseMemDir, r.memoryDir!, { name: `node ${r.index}`, label: `node${r.index}`, other: "an earlier node's" }));
  }
  for (const n of conflictNotes) io.err(`  note     ${n}`);

  const budget = enforceMemoryBudget(mergedDir, memoryBudget(v));
  for (const f of budget.pruned) io.err(`  note     memory over budget: pruned ${f}`);
  const overall = diffTrees(baseMemDir, mergedDir);
  if (isEmptyDiff(overall)) {
    io.err("  no memory changes across nodes; nothing consolidated");
    return 0;
  }
  const changes: LineageChange[] = [{
    layer: "memory",
    description: `consolidated fleet memory from ${succeeded.length}/${tasks.length} node(s): +${overall.added.length} ~${overall.changed.length} -${overall.removed.length} files${budget.pruned.length ? `, pruned ${budget.pruned.length} over budget` : ""}`,
  }];
  const applied = await applyChange({ home, io, v, agent, backend, pkgDir, signer, changes, memoryFrom: mergedDir, keptAt: mergedDir });
  if (applied.blocked) return 0;
  const edges = applied.edges;
  mutated = true;
  for (const e of edges) io.err(`  recorded ${(e.body as any).change.description} (${e.id})`);
  io.err(`  package  ${pkgDir} re-signed`);
  await syncLocalLog(home, pkgDir, agent, io);
  return 0;
  }
}

function appendFileEnsured(path: string, chunk: Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, chunk, { flag: "a" });
}

function cpFolder(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
}

/**
 * Brings the local log up to date with the package's history (it may have gained records elsewhere),
 * when the local log knows this agent. Every record is verified on append; a conflict is reported, not fatal.
 */
async function syncLocalLog(home: string, pkgDir: string, agent: string, io: Io): Promise<void> {
  const local = await openLog(home, logEnv);
  if (!(await local.log.passport(agent))) return;
  const history = readFileSync(join(pkgDir, "records", "history.ndjson"), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as AspRecord);
  let added = 0;
  for (const r of history) {
    if (await local.log.get(r.id)) continue;
    try {
      await local.append(r);
      added++;
    } catch (e) {
      io.err(`  warning  the local log's history for ${agent} diverges from the package's: ${(e as Error).message}`);
      return;
    }
  }
  if (added) io.err(`  log      ${added} record(s) added to the local log`);
}

/** The runtime the agent last moved to (the latest backend lineage edge), or the one it was packed from. */
function currentRuntime(pkgDir: string, manifest: AspRecord): string {
  const history = readFileSync(join(pkgDir, "records", "history.ndjson"), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as AspRecord);
  const agent = (manifest.body as any).agent;
  const moves = history.filter((r) => r.type === "asp.lineage/v0.2" && (r.body as any).child === agent && (r.body as any).change?.layer === "backend");
  const last = moves.at(-1);
  const to = last && /-> (\S+)$/.exec((last.body as any).change.description)?.[1];
  return to ?? (manifest.body as any).source_runtime?.name;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
if (isMain) {
  const code = await main(process.argv.slice(2), {
    out: (l) => process.stdout.write(l + "\n"),
    err: (l) => process.stderr.write(l + "\n"),
    env: process.env,
    cwd: process.cwd(),
  });
  process.exitCode = code;
}
