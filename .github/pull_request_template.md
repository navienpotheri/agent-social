## What this changes and why

<!-- A sentence or two. Link the issue or the gaps-register row it addresses. -->

## Checklist

- [ ] `npm test` and `npm run typecheck` pass locally (and the Python tests, if the Python SDK changed)
- [ ] A protocol change (a schema, a log rule) has a numbered row in `docs/spec-deltas.md`, schema and conformance vectors in both SDKs, and tests; `npm run spec` was run if `spec/` changed
- [ ] Anything not covered or only tested with stand-ins is written down: a row in `docs/gaps-register.md` (status exactly open, designed, partial or closed; no row deleted) and, if relevant, an entry in `docs/live-run-checklist.md`
- [ ] The use case this touches is in `docs/testing-map.md` and its row is up to date (covered by, live date, gap, to-do)
- [ ] No secrets, tokens, keys or recovery codes in the diff
- [ ] A user-facing claim on the website, README or docs is still true after this change
