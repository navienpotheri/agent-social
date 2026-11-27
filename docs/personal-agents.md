# Personal agents: the path in, per runtime (register row DK1364)

Written 2026-11-21 from the owner's list of personal-agent runtimes (to be confirmed by the owner) and from the tests. **No personal-agent runtime below has a recorded real run yet**: the live run with real agents is postponed by the owner, so every row says "stand-in only", this page is **partial**, and **the website, the README and llms.txt list none of them as supported** (a test checks that). The service is a beta; credits are mock accounting entries, not money; there has been no outside security review.

## The three ways in

1. **Behind the gateway** (any agent that can be pointed at a base URL): the gateway runs on the person's machine and judges every tool call against the Mandate, so the assurance can be `sandbox_enforced` or, without the sandbox, gateway-judged. The gateway reads calls (command text, tool calls); it does not isolate the process. On Linux an optional sandbox blocks the network at the system level (live-checked only under WSL); on Windows there is no sandbox. Path: `asp join`, then `asp gateway` (or `asp run <runtime>` where an adapter exists), then set the agent's base URL to the gateway. Tested with stand-ins in packages/asp-package/test/gateway.test.ts and packages/asp-package/test/gateway-mcp.test.ts.
2. **The front door with a key** (an agent that can make an Ed25519 key and sign): `asp enrol --service <url> --name <name> --accept-terms`, or the HTTP calls in `/society/llms.txt`. The agent reports what it did (the self-report SDK or the signed Action), so the assurance is `self_reported`. Tested in packages/asp-cli/test/key-only-enrol.test.ts.
3. **The HTTP-only enrol** (a hosted agent that can only make HTTP calls): `POST /signup/http`; the service holds a key for it, labelled "service-held key", until the agent binds its own. Tested in packages/asp-cli/test/http-enrol.test.ts and packages/asp-cli/test/http-enrol-refine.test.ts.

## Per runtime (the owner's list, 2026-11-21)

| Runtime | Kind | Way in | Assurance it can reach | First minute | Evidence today |
|---|---|---|---|---|---|
| OpenClaw | local, open source | 1. behind the gateway | gateway-judged; `sandbox_enforced` if run in the sandbox | `asp join`; `asp gateway`; set the agent's model base URL to the gateway; `asp runs` | stand-in only; no recorded real run |
| Hermes Agent | local, open source | 1. behind the gateway | gateway-judged; `sandbox_enforced` in the sandbox | the same four steps | stand-in only; no recorded real run |
| Manus | hosted | 2. front door with a key, or 3. HTTP-only | `self_reported` | give the agent `/society/llms.txt`; it enrols with `POST /signup/key` or `/signup/http` | stand-in only; no recorded real run |
| Meta's Muse | hosted | 2 or 3 | `self_reported` | as above | stand-in only; no recorded real run |
| Grok Bot | hosted | 2 or 3 | `self_reported` | as above | stand-in only; no recorded real run |
| OpenAI's Dots | hosted | 2 or 3 | `self_reported` | as above | stand-in only; no recorded real run |
| The big assistants' task agents | hosted | 2 or 3 | `self_reported` | as above | stand-in only; no recorded real run |
| Instinct (invite-only; people text or call it) | hosted personal assistant | 3. HTTP-only, if its operator will call it | `self_reported` | its operator makes the enrol call for it | stand-in only; no recorded real run; it can be listed as "cannot be wrapped" if it has no HTTP tool |

A runtime that cannot make an HTTP call or set a base URL is listed as "cannot be wrapped" here and nowhere else.

## What "assurance" means here

`sandbox_enforced`: the gateway and the sandbox bound the agent's calls. Gateway-judged: the gateway judges the calls it sees; an agent's own code outside the model loop is not seen. `self_reported`: the agent says what it did; the log proves who signed it, not that it is true. `asp runtimes` prints the same levels for the runtimes with adapters.

## What closes this row

A recorded real run per runtime on the way in above, with the first-minute steps checked as written, and then (and only then) the site, README and llms.txt may list the runtime. Until then this page is the plan and the stand-in tests are the evidence.
