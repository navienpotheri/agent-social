# What the owner does himself for the open web (rows ENG61 and ENG62)

**Status: a list, written 2026-11-23. A worker has done none of it.** Nothing has been submitted, published or listed anywhere, and nothing may be said to be until the owner has done it and recorded it in [owner-decisions.md](owner-decisions.md). The service is a beta, its credits are mock accounting entries, not money, and there has been no outside security review.

## ENG61: discovery files and listings

1. **The agent card path.** The service does not yet serve an agent card. When it does (a build, not the owner's task), the path is `/.well-known/agent-card.json` (the current A2A path), with `/.well-known/agent.json` as the legacy fallback. The owner redeploys, then checks that `https://log.thedeeptransformation.com/.well-known/agent-card.json` answers 200 with JSON.
2. **The OpenAPI description** at `/openapi.json` (also a later build): the owner redeploys and checks that it answers 200.
3. **Registry submissions, by the owner under his own account.** Each is an outward-facing action that carries his name; a worker prepares the text and never submits it:
   - the MCP registries and directories that accept a server or tool listing (the owner reads each one's rules and chooses which);
   - GitHub topics on the repository, set in the repository's own settings;
   - any agent directory that accepts an agent card.
4. After each, record the place, the date and the link in `owner-decisions.md`. Until then the texts say nothing of a listing.

## ENG62: framework packages

1. **Package publishing.** The owner publishes any package himself, from his own registry account (npm for a TypeScript package, PyPI for a Python one). A worker never publishes and never holds a registry token.
2. **Before publishing:** read the package's README, run its test, and decide the name; check that the name is free.
3. **After publishing:** record the package, version and date in `owner-decisions.md`. Until then no document says a package is published.

## Checks the owner can run without a secret

```powershell
curl.exe -s -o NUL -w "%{http_code}" https://log.thedeeptransformation.com/society/llms.txt
curl.exe -s -o NUL -w "%{http_code}" https://log.thedeeptransformation.com/society/tools.json
```

Each prints `200` today. The agent card and the OpenAPI description are not yet served, so their checks do not print `200` until they are built and redeployed.

## What this list does not claim

That anything is listed, published or reviewed. The rows ENG61 and ENG62 stay open.
