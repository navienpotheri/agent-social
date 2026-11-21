# Private memory in a run: the design that finishes D12 and DK272

Written 2026-11-22 by launch-bar-2 for lane-cli-3 (code) and the owner (review). The sealing exists and is tested: [packages/asp-package/src/private-memory.ts](../packages/asp-package/src/private-memory.ts) seals a scope to one principal-agent pair (an X25519 key for each side, HKDF over the Diffie-Hellman secret, the DIDs of the pair and the scope name, AES-256-GCM with the pair and scope as authenticated data). What is missing is the run: no run reads or writes memory through it, so an agent's memory is still a folder on the sponsor's machine. This document specifies how a run uses the scope, so that the scope opens only inside a run of that agent for that principal. Credits are mock accounting entries; the service is a beta; there has been no outside security review.

## 1. Keys and where they live

| Key | Held by | Stored | Published |
|---|---|---|---|
| The principal's memory key (X25519) | the principal, on their machine | the keystore beside the signing key, as `<did>#memory-1`, sealed with the key passphrase when one is set | the public half in the principal's passport as an entry of type `X25519` named `memory-1` |
| The agent's memory key (X25519) | the agent's package on the principal's machine, or the resident's host for a hosted agent | `<package>/keys/memory.json`, sealed with the principal's public memory key so that the host cannot read it | the public half in the agent's passport, as above |

The signing keys do not change. A host that holds only a node key holds neither memory key and cannot open a scope (the existing test already shows this).

## 2. What a run does

1. **Start.** `asp run` and `asp gateway` check whether the Mandate names a private scope (`learning.private_scopes`: a list of scope names, default none). If none is named the run changes nothing.
2. **Unseal in the gateway only.** The gateway process opens the agent's memory key with the principal's key and holds the key in memory for the duration of the run. The key is never passed to the child agent, written to the run log or placed in an environment variable.
3. **Tools, not files.** The gateway offers two tools to the agent through its MCP route: `asp_memory_private_read(scope)`, `asp_memory_private_write(scope, text)` and `asp_memory_private_list` (named like the gateway's other memory tools). A call outside the scopes that the Mandate names is refused and counted as a blocked attempt. The agent never sees the key or the sealed file.
4. **Storage.** A write seals the whole scope text and writes `<package>/memory/private/<scope>.sealed.json`. The file is replaced atomically. The sealed file travels with the package and with an account export; it is useless without the pair's keys.
5. **Run log.** A read or a write adds a line to the run log with the scope name, the size and a hash of the plaintext, never the plaintext.
6. **End.** The key leaves memory when the run ends. A second run of a different agent of the same sponsor has a different memory key and cannot open the scope.

## 3. Numbers and limits

A scope is at most **256 KiB**; an agent has at most **16** private scopes; a scope name is 1 to 64 characters from `a-z 0-9 - _`. A write above the limit is refused with a message that names the limit. These bound the cost and the harm of a runaway write.

## 4. What this does not protect

The scope protects against other agents of the same sponsor, against a host that holds only a node key, and against the operator's tools. It does not protect against the principal (who holds both keys by design), against the agent's own model provider (the agent's text reaches the provider when the agent reads its scope into a prompt), or against a compromised machine that runs the gateway. The statement of the privacy line ([privacy-line.md](privacy-line.md)) must say so.

## 5. Tests that close DK272 and D12

1. An agent writes a private scope during a run through `memory_private_write`; the sealed file exists; the plaintext appears nowhere on disk or in the run log.
2. The principal and the agent, with their own keys, read it; a second agent of the same sponsor, a host process given only the node key, and the wrong scope name cannot.
3. A call to a scope that the Mandate does not name is refused and counted as a blocked attempt.
4. A write over 256 KiB, a seventeenth scope and a bad name are refused.
5. An account export contains the sealed file and not the plaintext, and an import into a fresh machine opens it with the same keys.
6. A recorded run (a row of docs/live-run-checklist.md) with a real runtime.

## 6. Work

| Piece | Owner |
|---|---|
| Memory key creation, passport entries, sealing of the agent key to the principal | lane-cli-3 |
| `learning.private_scopes` in the Mandate schema (a protocol change: schema, both SDKs, vectors, spec-delta) | lane-protocol-3 |
| The two MCP tools in the gateway and the run-log lines | lane-cli-3 |
| The tests of section 5 and the privacy-line text | lane-cli-3 and launch-bar-2 |

## 7. As built (lane-cli-3, 2026-11-22)

Built: custody and the run store in `packages/asp-package/src/private-memory-run.ts` (the principal's key sealed with the key passphrase when set; the agent's key sealed to the principal's public memory key; atomic sealed scope files; the limits), the three MCP tools, and `asp gateway --private-scopes a,b --package <dir> [--principal <did>]` (the Mandate does not name the scopes yet). The run log holds the scope, the size and a hash for a call to a private tool, and `(private memory; not logged)` for the result; the telemetry copy of the actions holds the same summary. Tests 1 to 4 of section 5 are in `packages/asp-package/test/private-memory-run.test.ts`.

Not built, so both rows stay partial: the public halves in the passports (a passport entry type: a protocol change), the Mandate field `learning.private_scopes` (lane-protocol-3), the account export and import test (5) and the recorded run (6). The agent's text reaches its model provider when it reads a scope into a prompt (section 4), and a read result passes through the model request like any tool result.
