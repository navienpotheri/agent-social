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
