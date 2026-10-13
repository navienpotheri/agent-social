# Fourth live set: identity, and everything the protocol logs about an agent

Status: a note, 2026-10-13. To be designed in detail and run after the third set (docs/live-run-market.md). Asked for by the owner during the live walkthrough: *check the unique identity given to the principal, the agent and a subagent, together with skills, tool calls and function calls: everything the protocol logs for the agent and the principal.*

## What it answers

1. **Is every party unique and verifiable?** The principal (a person), each agent, and each **subagent** has its own identity and key. No two share an address or a key. Anyone can check which identity made a given record.
2. **Is the chain of responsibility visible?** A subagent's identity says who it works under, who sponsors it, and for how long its key is valid. A record from a subagent can be traced up to the principal.
3. **Does the log hold what it claims to?** Every tool call, function call, skill use and memory change an agent makes is logged, at the right level of detail, under the right identity, and with no secrets in it.
4. **Can a principal read it back?** From any logged call, the principal can see which identity made it, under which Mandate, at what time, and whether it was allowed.

## The things the protocol records (from SPEC.md), and what each tells us

| Record | What it holds | Identity question |
|---|---|---|
| `asp.passport` | A persistent identity (a person, an agent or an organisation), its keys, who sponsors it | Is it unique? Is the key the one that signs its records? |
| `asp.fleet` | A declared group of agents under one organisation with a shared sponsor | Are group members distinguishable from each other? |
| `asp.node` | A short-lived worker (a **subagent** or a parallel copy) given its own signing key by a person | Does the subagent have its own key and an end time? Is it traceable to its parent? |
| `asp.lineage` | One signed edge in an agent's history (a runtime or memory change, a skill added) | Is every change to an agent's skills and memory attributable and in order? |
| `asp.package` | The portable agent: manifest, skills, memory, tool allow-list | Do the listed skills match what ran? |
| `asp.mandate` | What the agent may do: scopes, hosts, gates | Is each call tied to the Mandate it ran under? |
| `asp.action` | What an agent actually did: scopes used, artifacts, blocked attempts | Does it agree with the run log call for call? |
| `asp.delivery` | The result and its process evidence (the execution trace) | Does the trace show the subagents that contributed? |
| `asp.attestation`, `asp.checkpoint` | Judgments: acceptances, approvals, rulings | Is each signed by the right identity? |
| The run log (on this machine, optionally sealed on the service) | Every model request and reply, every tool call and result, every refusal and its reason | Is every call attributable and secret-free? |

## What to run (outline)

**A. Identities.** Make a principal, an agent, and a **subagent**. A subagent is made either as a **node** under `asp orchestrate` (a short-lived key delegated by a person, one task per node, run in parallel) or as a separate agent identity sponsored by the first. Check: each has its own address and key; the node record names its parent and its end time; `asp identity show <did>` for each; the service lists them under the right tenant; none shares a key.

**B. Calls.** Have the agent run, under a contract and under a standing job, a prompt that uses each kind of call:
- a **built-in tool** (read, edit, a shell command);
- a **shell command** that is refused, one that is held for approval, and one that is allowed;
- an **MCP tool** (through `asp mcp` or the gateway's MCP proxy), which shows as a function call by name;
- the **model's own function calls** (the tool-use blocks in its replies), which the gateway reads and judges;
- a **subagent's** calls, made inside an `orchestrate` run.
Check, for each: it appears in the run log, under which identity; it appears in the Action's scopes used; a blocked one appears as blocked and not as used; the command text has secrets masked; nothing in the log is a token, a key or a recovery code.

**C. Skills.** Add a skill to the agent's package, pack, run, and check that the skill is listed in the manifest and that the change is a signed lineage edge. Remove it and check the same. A skill the agent used but is not in the manifest is a finding.

**D. Reading it back as the principal.** Choose three logged calls (an allowed one, a refused one, a subagent's) and trace each: identity, Mandate, time, outcome. Use `asp runs <id>`, `asp run-log show <id>`, `asp market show <contract>`, and, once built, the day's view (docs/daily-view.md).

## What could go wrong, and what counts as a finding

| Possible finding | Why it matters |
|---|---|
| Two identities end up with the same key, or one key signs for two identities | The whole accountability story depends on uniqueness |
| A subagent's records appear under its parent's identity | Responsibility is blurred; the parent would be slashed for the child, or the child escapes |
| A node's key outlives its stated end time | A delegated key must really be short-lived |
| A tool or function call is missing from the log, or logged under the wrong identity | The record is incomplete or misleading |
| An MCP tool's arguments or results are not logged (gap E7 already says results are left out) | A principal cannot see what the agent really did |
| A secret appears in a logged command or result | A privacy and security failure |
| A skill is used but not in the manifest, or a manifest skill never ran | The package does not describe the agent |
| The Action and the run log disagree about what was used | Two records of one fact must not differ |

## Open points to settle when designing it

1. **What counts as "everything the protocol logs":** only what the gateway sees (model replies and the tool calls in them), or also what an agent's own code does outside the model loop (gap H10 says that is invisible today)?
2. **Subagents of runtimes we do not run:** a subagent inside Claude Code or Codex (their own parallel agents) is one process to the gateway. Is it one identity, or can we see inside?
3. **What a principal needs per call:** the whole command, a hash, or a scope only (see the open points in docs/daily-view.md).
4. **Which identity logs a skill use:** the agent, or the package?
