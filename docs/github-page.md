# The GitHub page

What the repository page should say. The repository settings are changed by hand or with the `gh` commands below, after the owner has read them; nothing here has been applied.

## Description (the "About" line, under 350 characters)

An open accountability layer for AI agents: signed identity, a Mandate that limits what an agent may do, a bond it forfeits if it breaks it, and a tamper-evident log. Works with Claude Code, Codex, OpenHands, Antigravity and any agent that can set a base URL. Early, single-machine, mock credits.

## Topics

`ai-agents`, `agent-accountability`, `agent-safety`, `mcp`, `llm-gateway`, `protocol`, `signed-log`, `claude-code`, `codex`, `typescript`, `python`

## Website

None yet. Leave empty until there is a page worth linking.

## Settings to turn on

- Private vulnerability reporting (Settings > Code security): SECURITY.md sends reporters there.
- Issues on; Discussions optional.
- Branch protection on `main` once there is CI (there is none yet: gap O12).
- No wiki; the docs are in the repo.

## Commands (run them yourself)

```bash
gh repo edit navienpotheri/agent-social --description "An open accountability layer for AI agents: signed identity, a Mandate that limits what an agent may do, a bond it forfeits if it breaks it, and a tamper-evident log. Works with Claude Code, Codex, OpenHands, Antigravity and any agent that can set a base URL. Early, single-machine, mock credits." --add-topic ai-agents --add-topic agent-accountability --add-topic agent-safety --add-topic mcp --add-topic llm-gateway --add-topic protocol --add-topic signed-log --add-topic claude-code --add-topic codex --add-topic typescript --add-topic python
```

## Before it is announced

Done on 2026-10-10 (see the release check below) and still to do by the owner:

- [x] A LICENSE (Apache-2.0), a NOTICE, SECURITY.md and CONTRIBUTING.md.
- [x] The README says what works, what does not, and that the credits are a mock ledger.
- [x] A scan of the whole git history for secrets found none (only the fake keys the redaction tests use).
- [ ] Decide whether the commit author email (every commit carries it) should stay public. Rewriting history to change it would change every commit id and break the log's signed references to them; it is not recommended.
- [ ] Apply the description and topics above, and turn on private vulnerability reporting.
- [ ] Run the evaluations once against the current agents and publish the result as a release note.
- [ ] A short demo (a blocked attempt before it runs, then the mail) once there is a hosted page to show it on.

## Release check, 2026-10-10

- History: 104 commits, one author. A search of every added line for API-key, token and private-key shapes found only test fixtures (`AKIAIOSFODNN7EXAMPLE`, `sk-ant-api03-abcdefghijklmnopqrstuvwx`, an OpenSSH header in a redaction test). No key files were ever tracked.
- Local paths (the author's machine, `C:\Users\...`) appear in a few docs and one test fixture. They reveal a username, not a secret.
- The packages already declared Apache-2.0 in their manifests; the root manifest now does too.
