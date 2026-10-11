# Testing

How to run every suite, including the Postgres tests. Moved here from the README.

Node 22.18+ runs the TypeScript directly, with no build step.

```bash
npm install
npm test
npm run typecheck
```

```bash
cd python
python -m venv .venv
.venv/Scripts/python -m pip install -e ".[dev]"
.venv/Scripts/python -m pytest
```

The event log's Postgres tests need a database. Without one they are skipped. With Docker:

```bash
docker compose up -d --wait
ASP_TEST_DATABASE_URL=postgres://asp:asp-local-dev@127.0.0.1:54329/asp npm test
```

Without Docker, PGlite (Postgres 17 in WebAssembly) served over the wire protocol can stand in. **Known problem:** on 2026-10-10 this route failed with connection resets (gaps register O14); use Docker until it is fixed. Start the server in one terminal:

```bash
node packages/asp-log/scripts/pglite-server.ts 54330
```

Then run the tests in another:

```bash
ASP_TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54330/postgres ASP_TEST_PGLITE=1 npm test -w @agent-social/asp-log
```

PGlite is a single session, so its run cannot create real lock contention. Real Postgres is still the reference.

After changing `spec/` or `conformance/generate.ts`, regenerate the vectors with `npm run vectors`.
