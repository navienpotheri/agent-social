# Implementation notes

How the build works where the spec is silent and no decision is needed. Decisions for the spec are in [spec-deltas.md](spec-deltas.md).

## Records and schemas

- Schema ids are `urn:asp:v0.2:<name>`, so no web domain is claimed yet.
- `actor` is the issuer's DID or a DID URL under it, e.g. `…:coder-1#node-3`.
- Signed records are checked in a fixed order, which the conformance vectors depend on ([conformance/README.md](../conformance/README.md)).

## Event log (`packages/asp-log`)

- **Chains are linear.** Postgres enforces one successor per record with `UNIQUE (prev)`. A record whose `prev` isn't its chain's head is `BAD_PREV`.
- **Chain kinds.** A chain is named after its first record's type. A chain that starts with a Contract is a job and follows the lifecycle. Any other chain holds only its root's type, e.g. one passport's versions.
- **Registry.** Keys come from passport records. An update must follow the DID's latest passport and be issued by the DID or its sponsor. Keys dropped from a passport are revoked from then on; records signed before that still verify on replay.
- **Replay** uses each record's stored append time as its clock, so records stay valid after a node key expires.
- **Throughput.** Appends run one at a time, behind a lock on the log head.

## Agent packages and `asp run`

- **Harness** (`spec/package/harness.schema.json`) is runtime-neutral: instructions, skills, subagents, commands, hooks (in Claude Code's shape), MCP servers, permission rules, env and model. Anything with no neutral form goes under `runtime_specific`.
- **Manifest permissions** map runtime permission rules to coarse scopes (`repo.read`, `tests.run`, `pr.open`, …) for principals to read. The harness keeps the exact rules.
- **`run` never writes into the project.** Everything goes under `~/.asp/runs/<run>/`, and the run's report goes to stderr.
- **Write-back.** After a successful run, the package's memory is replaced, lineage edges are appended, and the manifest is re-signed. The local log then syncs from the package's history; a conflict is reported, not fatal.

### Claude Code

| Agent part | How it reaches Claude Code |
|---|---|
| Instructions | `--append-system-prompt-file`. Files the project already has, byte for byte, are skipped. |
| Path-scoped rules | A `PreToolUse` hook injects a rule the first time the agent reads or edits a matching file, once per session. |
| Skills | A workspace folder added with `--add-dir`, so they keep their own names. |
| Subagents, commands, output styles, hooks, MCP | A session-only plugin (`--plugin-dir`). Subagents and commands load as `<agent>:<name>`. |
| Memory | `autoMemoryDirectory` in a `--settings` file points at the run's copy of the package memory. |

### Codex CLI

| Agent part | How it reaches Codex |
|---|---|
| Instructions, skills, commands, subagent roles, deny rules, memory index | `developer_instructions` (a developer message). Skills are listed in Codex's own format, pointing at files in the run folder: Codex loads skills natively only from `.agents/skills` directories. |
| MCP servers | `-c mcp_servers.*` overrides. Secrets pass by env var name only. |
| Memory | A writable `--add-dir`; the instructions tell the agent to keep `MEMORY.md` there. |
| Launch | `codex exec --json` when there is a prompt. On Windows, the npm shim's `codex.js` runs under Node, avoiding `cmd.exe` quoting. |

Capture reads `AGENTS.md`/`AGENTS.override.md`, `.agents/skills`, `.codex/config.toml`, `.codex/hooks.json`, `.codex/rules/*.rules`, and the index of this project's sessions. With `--include-user` it also reads the Codex home's `AGENTS.md`, user skills, and Codex's global memories.

`packages/asp-cli/scripts/codex-live-check.ts` checks the adapter against the installed Codex with no model call. It uses `codex debug prompt-input` and `codex mcp list`.

### OpenHands (runs inside WSL on Windows)

| Agent part | How it reaches OpenHands |
|---|---|
| Home | A shadow home in the run folder: every entry of the real home is symlinked, so git, ssh and toolchains keep working, except `.agents` and `.openhands`. `.openhands` holds links to the real LLM settings and credentials. `HOME` points at the shadow home for the run. |
| Instructions, commands, subagent roles, deny rules, memory index | A legacy microagent with no triggers (`~/.openhands/microagents/asp-agent.md`), which OpenHands puts in the system prompt. The project's own `AGENTS.md`/`CLAUDE.md`/`GEMINI.md` are skipped when identical, since OpenHands loads them natively. |
| Skills | Native user skills (`~/.agents/skills`), advertised on demand. |
| Path-scoped rules | On-demand skills whose description names the globs, because OpenHands has only keyword and task triggers. |
| Hooks | `~/.openhands/hooks.json`, the same shape as Claude Code's. Matchers are translated to OpenHands tool names (`terminal`, `file_editor`, `task_tracker`), and events OpenHands lacks are dropped. |
| MCP | A template with `${NAME}` references. The launch script expands it into a private file on the Linux filesystem, links it into the shadow home, and deletes it on exit. |
| Launch | `wsl.exe -- bash launch.sh`, with secrets shared through `WSLENV`. `--headless --json -f task.md` when there is a prompt; `--override-with-envs` with `LLM_MODEL` when `--model` is given. Conversations are kept in the run folder. |

Capture reads the repo context files, `.agents/skills`, `.openhands/skills`, `.openhands/microagents` and `.openhands/hooks.json`. A microagent without triggers becomes an always-on instruction; one with triggers becomes an on-demand skill. With `--include-user`, capture also reads the user's skills, microagents, hooks, MCP servers, and the model name from `agent_settings.json` (never the API key).

`packages/asp-cli/scripts/openhands-live-check.ts` runs the real `launch.sh` in WSL, with `openhands` replaced by a probe on OpenHands' own Python. The probe builds the agent context the way the CLI does. No LLM call is made.

## Node revocation and key rotation (`packages/asp-log`)

A second Node record for the same node id, chained onto the first (`prev` = its id), is an update:
extending or replacing the key, or — by setting `expires` at or before `issued_at` — an immediate
revocation. `projectNode` checks that the chain's predecessor really is this same node's own grant
(never someone else's), then sets `revokedAt` when the update is a revocation, which makes the key
entirely unresolvable rather than merely expired. Dropping a passport key (a real rotation, not just
adding one) also revokes every one of that person's currently-live node keys, since delegations made
under a retired key are no longer trustworthy.

## Single-file packages (`packages/asp-package/src/archive.ts`)

A package is normally a directory, but `pack --out foo.aspkg.tgz` (or `.tar.gz`) packs it into one
gzipped tar file instead. `verify`, `run` and `orchestrate` accept either form: an archive is extracted
into a temp directory, operated on as usual, and — for `run`/`orchestrate`, only once a write-back
actually happened — re-packed into the same path afterward. A failed run never repacks, so the archive
on disk stays byte-for-byte whatever it was before a failed attempt.

## Probation tracking (decision D2)

A lineage `update` record carrying `probation_until` sets that DID's current probation window in the
registry (`EventLog.probation(did)`). A plain update with no `probation_until` leaves an existing window
untouched; a new one overwrites it. Nothing enforces the window yet, because there is no self-modification
pathway in the codebase to enforce it on (`docs/backlog.md`) — the decided policy (force
`self_modification` to `principal_approves` during probation) is recorded so it can be wired in the
moment that pathway exists.

## Log checkpoints (decision D5, `packages/asp-package/src/checkpoint.ts`)

`asp log checkpoint --as <did>` signs `{seq, log_hash, signed_at}` with that DID's key and appends it to
`~/.asp/checkpoints.ndjson`. This is not an ASP record — it is about the log, not a fact recorded in it —
so it doesn't add a 17th record type. `asp log verify` re-checks every stored checkpoint by independently
replaying the log up to that seq (`EventLog.verifyCheckpoint`) and comparing the resulting hash, rather
than trusting the value stored in the file; a checkpoint that is validly signed but simply claims the
wrong hash is still caught. Nothing publishes checkpoints anywhere yet — copying one out (email, a public
post, handing it to a counterparty) is what would make it externally checkable.

