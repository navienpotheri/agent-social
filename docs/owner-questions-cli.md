# Owner questions from the CLI lane (worker lane-cli, 2026-11-21)

One block per row. Each is a row in the CLI, gateway, runtime, accounts or operations lane that cannot be closed by a worker alone. Nothing here changes a status. Each block says what is needed and the exact question.

## E5: a run log for every runtime (Antigravity and OpenHands output formats)

- **Needs:** a live run of Antigravity (`agy`) and of OpenHands with a real model agent, to capture their real output once and write the readers for text and results against it. A reader written against a guessed format would be a stand-in and the row would stay unproven.
- **Question:** Is the live run with a real model agent for Antigravity and OpenHands allowed now, or does it stay postponed with the other live runs (T15, T22, DK650, P21)? If it stays postponed, may the register row say "read in full for Claude Code and Codex; for Antigravity and OpenHands the scope verdict of each call only", and the site say the same?
- Left too: `asp orchestrate` nodes are not checked by the compliance bridge; that part needs no owner answer and is next in the queue.

## T4: no service or no network at a venue

- **Needs:** a real "wifi off" test on a clean machine (a person's hands, or a clean VM with the network disabled), and an owner choice between two behaviours when both an environment login and a saved login exist.
- **Question:** When `ASP_LOG_URL` and `ASP_LOG_TOKEN` are set in the environment and a different login is saved by `asp login`, which wins? (Today: the environment. The usual convention for command-line tools, and what the code does. Confirm, and I write it into the docs and test it.) And: may a worker run the wifi-off test in a throwaway Windows Sandbox or VM, or does the row need a person at a venue?

## T3: two sessions at once for one agent

- **Needs:** the cause of T23, the unreliable Linux CI test (`run-concurrent.test.ts`), which has not been found. A worker can chase it, but only on a Linux machine with the CI timings.
- **Question:** Is a Linux machine (WSL2 or a CI re-run with debug logs turned on, `ASP_DEBUG_APPROVALS=1`) available for a worker to reproduce T23? If not, may T3 stay partial and the claim "two sessions on one agent are safe" be withdrawn?

## DK740 and DK854: a service-held agent's bond

- **Needs:** the owner's answer to KO2 (docs/owner-decisions.md): should a bond backed by a service-held (custody: service) agent be refused, or counted at a discount, and at what size?
- **Question:** For a bond or a Mandate above a stated size, backed by an identity whose key the service holds: refuse it, or count it at a discount (say 50 percent), and above how many credits? It is a protocol rule (schema and conformance vectors in both SDKs), so I will not build it until you choose.

## DK241: telemetry wired into a live run

- **Needs:** the owner's approval of the privacy text (instrumentation.md section 7) and a live run with a real agent and the owner's consent. DK1303 (telemetry always on) changed the consent model after this row was written.
- **Question:** Does DK1303 replace the consent step of DK241, so that the row is reduced to "the gateway collects exactly the signals the Mandate lists, and a run without the field produces `telemetry: off`"? If yes, I rewrite the row and build that part, which needs no live run.

## DK95: unsigned mints on the live service

- **Needs:** the operator and the owner to sign the adoption records on the live database (`asp credits adopt`), then the service's migration `017_mint_adoption.sql` applied on its next start.
- **Question:** When may the adoption be run on the live database, and by whom? The command and the check (`asp credits audit --require-signed`) are ready; nothing else is missing.

## DK380: the newcomer allowance inside `asp join`

- **Needs:** the hosted join flow and a live run of `asp join` with a newcomer agent.
- **Question:** Is the hosted join flow stable enough to build the offer into `asp join` now, or should it wait until the sign-up flow has been run live (U1)?

## O18: suspend and block routes verified live

- **Needs:** a recorded live run of the admin routes against the deployed service (the operator's token).
- **Question:** May a worker run the suspend, resume, block and unblock routes against the deployed service with a throwaway tenant, or does the operator run them and paste the audit trail?

## DK1341: operations plan (monitoring, status page, incident runbook, backups)

- **Needs:** an uptime service account, a status page host and a backup destination (outside parties and owner actions). The runbook text and the checks the service can answer (`/health`, the ledger invariant) need no owner action and are in the queue.
- **Question:** Which uptime service and which status page host (the cheapest that is not the deployed service itself), and where do backups go (a bucket in the owner's account)? Until then the website must not say "monitored" or "backed up".
