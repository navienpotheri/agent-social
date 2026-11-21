# What a run can cost

A run is metered in **tokens** (what the model reads plus what it writes), not in money. Credits in this society are mock accounting entries and are not money.

Every run under `asp gateway` or `asp run` carries a ceiling, even when you set nothing:

| Ceiling | Default | The most the operator allows |
|---|---|---|
| Tokens in one run | 2,000,000 | 20,000,000 |
| Tokens for one agent in one UTC day | 10,000,000 | 100,000,000 |

You may raise or lower either with `--token-cap <tokens>` and `--daily-tokens <tokens>`; a figure above what the operator allows is lowered to it, and the terminal says so. The operator sets the maximum with `ASP_MAX_RUN_TOKENS` and `ASP_MAX_DAY_TOKENS`.

The gateway tells you in the terminal when the run reaches **50, 80 and 100 percent** of its ceiling, once each, and writes each as a `budget_alert` in the run log. When the ceiling is reached the **next model call is refused**: the provider is not called, and the run log has a `budget_stop`. Nothing is billed by this service; what the model provider charges for the tokens is between you and the provider.

Not built yet: the alerts by mail (they are in the terminal and the run log), and a ceiling carried in the Mandate record itself (today it is set by these flags and defaults, which is a protocol change to make a Mandate field).
