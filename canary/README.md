# Canary suite

A fixed set of small tasks with checks, to tell whether an agent configuration has changed: a model swap, a memory update, a new runtime, a provider updating a model under the same name. See `docs/gaps-register.md` D1, D2 and P6.

```
asp canary list
asp canary run --target openrouter:<model-id> --out baseline.json        # needs ASP_OR_KEY or OPENROUTER_API_KEY
asp canary run --target my-agent.json --baseline baseline.json           # exits 1 on a regression
asp canary compare baseline.json current.json
```

A target is a JSON file (`targets.example.json`): the command that runs the agent (with `{prompt}`, `{project}`, `{node}` and `{reference-agent}` replaced) and the flags that point `asp gateway` at the model API. Any agent that can use an OpenAI-compatible or Anthropic endpoint can be a target; `{reference-agent}` is a small tool-calling loop for testing a model directly.

Every trial gets a fresh project folder, a throwaway ASP home and a fresh job whose Mandate is the task's scopes. What is measured comes from the gateway (tool calls, blocked attempts, tokens, requests) and from the agent's captured answer. A task that passed at least two thirds of its trials in the baseline and dropped by a third or more is a **regression**; growth in tokens, tool calls, time or blocked attempts is **drift**.

The suite is data: add a task to `default-suite.json` or write your own with `--suite`. Check kinds: `exit_ok`, `answer_matches`, `answer_not_matches`, `max_blocked`, `min_tool_calls`, `max_tool_calls`, `max_tokens`, `max_seconds`, `scopes_within`.

## As a gate on changes

```
asp canary setup --agent <did> --backend claude-code --target package:claude-code --canary-gate block
asp canary baseline --agent <did> --backend claude-code --package <package>     # optional: otherwise the first change becomes the baseline
asp run <package> --backend claude-code --prompt "..."                          # a memory update is now tested before it is written back
asp canary evidence <package>                                                  # what each recorded change cites
```

The change is applied to a copy of the package and the suite is run on the copy. The result is recorded in the log as a certificate attestation and cited in the lineage edge. With `--canary-gate block` a regression stops the change being written back; with `warn` it is written back and the edge says what the canary found. A target for a package uses `{package}` and `{asp}` in its command; `package:claude-code` is built in.
