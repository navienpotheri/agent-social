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

---

# Owner checklist: things that need your accounts or your hands (numbered; answered 2026-11-21 as recommended, so these are steps, not questions)

The lead recorded your decisions (H4, O2, T12, DK1341, DK270). What is left needs your accounts. Each step says what to do, what to paste back, and the row it lets a worker close.

**OP-1. Deploy the production start line and the monitor (O2, T12, DK1341).** On the server: `cd /opt/asp && sudo git pull && sudo GOOGLE_CLIENT_ID=<id> bash docs/deploy/setup-server.sh`. The script now refuses to finish without Google configured (unless `ALLOW_NO_GOOGLE=1`), starts the service with `--signup-require-google --limits-state --rate-limit 600 --write-limit 120`, installs the `asp-monitor` unit and the `/status` page. Then `asp serve raise-limits --tokens /var/lib/asp/tokens.json --rate-limit 600`. Paste back: the last 20 lines of the script and `systemctl is-active asp-log asp-monitor postgresql caddy`.

**OP-2. An outside uptime ping (DK1341).** The monitor runs on the same machine, so if the machine dies nobody is told. Make a free account at an uptime service you choose (any that can check an HTTPS URL every minute and message your phone or mail) and add two checks: `https://<domain>/health` (must answer 200) and `https://<domain>/status.json` (must contain `"checked_at"`, and alert if it does not change for 10 minutes). Paste back: the service's name and a screenshot of the two checks. Until this is done the site must not say the platform is independently monitored.

**OP-3. The alert destinations (DK1341).** In `/etc/asp/asp.env` set `ALERT_WEBHOOK=<a chat or phone webhook URL>` (optional) and make sure `RESEND_API_KEY` and `MAIL_OPERATOR` are set (deploy/README.md, "Turning on mail"). Rerun the setup script (it restarts the monitor). Then run live check 06. Paste back: the two alerts you received (subject lines only).

**OP-4. On-call hours and the support address (DK1341, SC2).** Decide and tell the lead: the hours you will answer an alert (the incident runbook promises "within 1 hour of the first alert, on-call hours") and the exact public support and grievance address (a role mailbox on the project's domain is recommended). Until you confirm the string, nothing publishes an address.

**OP-5. Revoke the OpenRouter key on this machine (O11).** In the OpenRouter dashboard, delete the key that was used for the early tests, and delete it from any `.env` on this machine. Paste back: "revoked".

**OP-6. GitHub settings (O12, O13).** Repository Settings, Branches: protect `main` (require the gate to pass, no force pushes). Settings, Code security: turn on private vulnerability reporting, and set the repository description and topics. Paste back: a screenshot of each page.

**OP-7. The live checks (docs/live-check-cli.md).** Two hours: checks 1 to 6, in that order. Paste back each report block.

**OP-8. The adoption of unsigned mints (DK95).** After the deploy, on the server as the operator with the owner's key: `asp credits adopt ...` as in docs/owner-checklist.md, then `asp credits audit --require-signed` must pass. Paste back its output.

## DK1359, DK1373, DK1374: enterprise tenancy, provisioning, audit export (worker lane-cli, 2026-11-21)

- **Needs:** each Done line ends with a live check by a real identity provider (DK1359, DK1373) or a check by a person from a security team (DK1374). A worker can build and test roles, OIDC and SAML against a test identity provider, SCIM-style provisioning and a signed audit export, but cannot do the live check.
- **Question:** Build these now to `partial` (everything but the live check, the live check written into docs/live-run-checklist.md), or hold them until there is a real identity provider and a security reviewer to check with?

## DK1371: guided fleet onboarding (worker lane-cli, 2026-11-21)

- **Needs:** the Done line includes a timed walkthrough that a person with no prior knowledge completes. A worker can build and test `asp fleet init|plan|apply|rollback`, the blueprints with Mandate templates, imports, the skill library and a 10,000-agent plan and apply, but not the walkthrough with a person.
- **Question:** Is the row to close when everything else passes with the walkthrough listed as the one open live item, or does the row stay `partial` until a person has done it?
