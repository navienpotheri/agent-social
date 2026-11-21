# What a run can cost you: the spend guard (register row DK1715)

Written 2026-11-21. Costs here are **tokens**, the model provider's unit; the credits in the society are mock accounting entries, not money, and a model's price is the provider's, not ours. The guard stops a runaway agent from spending your tokens; it cannot say what the provider will charge.

## The figures

| Ceiling | Default | You may | Never above (the operator's maximum) |
|---|---|---|---|
| Tokens for one run | 1,000,000 | lower or raise it: `asp market mandate ... --tokens-per-run <n>`, or for one run `asp gateway/run --token-cap <n>` | 20,000,000 |
| Tokens for one agent in a UTC day | 3,000,000 | `--tokens-per-day <n>` on the Mandate, or `asp budget set --agent <did> --daily-tokens <n>` | 50,000,000 |
| Tokens in a UTC month | none | `asp budget set --agent <did> --monthly-tokens <n>` | none set |

A new Mandate carries the per-run and per-day defaults in its `token_budget` unless you name your own. If the agent's fleet states a smaller ceiling, the fleet's rule wins and the gateway still applies the defaults when the agent runs. A run is capped by the smallest of: its own flag, what is left of the day, the Mandate's per-run figure, and the default.

## What you are told, and when

- At **50, 80 and 100 percent** of the run's ceiling the terminal says so, once each (`budget  80% of the Mandate's token budget for one run: 800000 of 1000000 tokens`), the run log gets a `budget_alert` line, and the end-of-job mail repeats it under "Check it".
- **The hard stop:** once the ceiling is reached, the next model request is refused at the gateway (HTTP 429): the provider is not called, the refusal is named in the run log (`model_refused`, reason `token_cap`) and in the terminal. A sponsor raises the ceiling deliberately with `asp budget set`, never above the operator's maximum.

Tests: `packages/asp-cli/test/spend-guard.test.ts` (the default in a new Mandate, each alert once, the refusal with the provider not called, the mail line, the operator's maximum). Related: `asp budget` and `asp forecast` (US2), the wake ceilings (DK8), the loop breaker (DK1230).
