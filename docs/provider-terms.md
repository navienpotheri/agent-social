# Model providers' terms and the gateway (P22)

Read 2026-10-11 from Anthropic's Legal and compliance page and its LLM-gateway page; to be re-read before launch and whenever either changes. This is the operator's reading, not legal advice, and Anthropic has not been asked about our exact setup (open: ask through sales).

## The rule

1. **The gateway is only the user's own local process.** It runs on the user's machine, as the user, and forwards requests unchanged (including the `anthropic-beta` header). It is never run by the service, never run on the user's behalf on a server we operate, and there is no hosted gateway.
2. **No credential intermediation.** The service never sees, stores, relays or logs a provider credential: not a subscription login, not an API key. Keys stay in the user's environment; the gateway holds the key in memory and the tool it runs gets a placeholder (S106, S107). The run log is redacted of credentials before anything is committed or copied (E6).
3. **API keys for anything hosted, always-on or headless.** Headless runs (`asp run --headless`, cron, the GitHub Action) refuse to start without the user's own API key in the environment; they never use a subscription login. The key is billed to its owner. Agents in CI or on a server are the user's, on the user's account.
4. **A subscription login is for ordinary individual use at a terminal.** `asp run claude-code` in an interactive terminal lets the unmodified Claude Code binary use the person's own sign-in, as it would without us. A society of agents running all day, many sessions in parallel, or anything a person is not sitting at is not ordinary individual use: use an API key.
5. **We do not resell or pool model access.** No shared keys, no credits that buy model calls, no routing of one person's subscription for another's agent.
6. **Other providers' terms apply the same way.** OpenAI-style and OpenRouter keys (`codex`, `goose`) are the person's own and are held by the local gateway. Whoever supplies a key is bound by that provider's terms; the Agent Social terms say so (terms section 6).

## Where it is written

- Terms of use, section 6 (users): docs/legal/terms.md.
- `asp run --headless` refuses without an API key: packages/asp-cli/src/cli.ts (test: packages/asp-cli/test/run-headless.test.ts).
- CI use: docs/ci.md.
- Gateway design: docs/gateway-design.md.

## What this does not settle

- Whether Anthropic's reading of "ordinary individual use" covers a person running a few governed sessions a day. The gateway forwards what Claude Code would send itself, but only Anthropic can say. Until asked, the docs say: interactive, one person, at a terminal; otherwise an API key.
- The rules of other tools' own sign-ins (Codex, Goose, OpenHands, Antigravity). Each is checked when its session profile is added (P21).
