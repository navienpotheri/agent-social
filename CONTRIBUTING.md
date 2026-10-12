# Contributing

Thanks for looking. Please read the [Code of Conduct](CODE_OF_CONDUCT.md). This project is early; the most useful contributions are a bug report with a reproduction, a gap you found that the register does not list, a new runtime adapter or reader, or a test that fails.

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
- A change that adds, removes or alters a use case updates its row in [docs/testing-map.md](docs/testing-map.md) (what covers it, whether it was run live, the gap, the to-do); a test checks the map.
- Keep tests honest: a test that depends on timing or on the clock should wait for the condition or freeze the clock, not sleep.
- By contributing you agree your work is licensed under the Apache License 2.0 (see [LICENSE](LICENSE)).

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request: the typecheck, every package's tests and the conformance-vector check on Linux and Windows with Node 24 and 22.18; the Python SDK's tests on 3.11 and 3.12 (Linux) and 3.12 (Windows); and the log and CLI against Postgres 17. All must pass; a final job, `all-green`, summarises them and is the one check branch protection requires. Run the first three locally before you push (gaps register O12, O14).
