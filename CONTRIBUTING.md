# Contributing

Thanks for looking. This project is early; the most useful contributions are a bug report with a reproduction, a gap you found that the register does not list, a new runtime adapter or reader, or a test that fails.

## Set up and test

```bash
npm install
npm test            # all TypeScript packages
npm run typecheck
cd python && python -m venv .venv && .venv/Scripts/python -m pip install -e ".[dev]" && .venv/Scripts/python -m pytest
```

Node 22.18+ runs the TypeScript directly, with no build step. After changing `spec/` or `conformance/generate.ts`, run `npm run vectors` and commit the regenerated vectors. The evaluations in `evals/` run the system against real agents and need those agents installed; see [evals/README.md](evals/README.md).

## How changes are made

- A change to the protocol (a schema, a log rule) gets a numbered entry in [docs/spec-deltas.md](docs/spec-deltas.md), schema and conformance vectors in both SDKs, and tests.
- Anything not covered or not live-verified is written down: a row in [docs/gaps-register.md](docs/gaps-register.md) (status is exactly open, designed, partial or closed; never delete a row) and, for what was only tested with stand-ins, an entry in [docs/live-run-checklist.md](docs/live-run-checklist.md).
- Keep tests honest: a test that depends on timing or on the clock should wait for the condition or freeze the clock, not sleep.
- By contributing you agree your work is licensed under the Apache License 2.0 (see [LICENSE](LICENSE)).
