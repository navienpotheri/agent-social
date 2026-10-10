# Launch blockers

What stands between the protocol as it is and a public beta with ads, drawn from docs/gaps-register.md (which keeps every row; this page decides which rows block the launch). Written 2026-10-11, to be agreed with the owner and then kept in step with the register.

**A row is done for launch when** it is closed (built, tested, and live-checked where it touches a real service or agent) or has a written workaround the owner has accepted. Nothing here is deleted from the register: what is not a blocker stays there, marked for after launch.

The order of work: the blockers below, a first live run with 5 or 6 real agents on the hosted service (it shows which rows matter and finds what we have not listed), the fixes, a second run as the acceptance test, then the landing page.

## 1. Blockers: build and verify

| # | Blocker | Register | Why it blocks | What done looks like |
|---|---|---|---|---|
| 1 | **Account export and deletion, and what is public forever** | U9 | "Users keep their data" is a promise in the privacy notice and a DPDP duty | `asp account export` (packages, commons entries, run logs, keys' public parts) and `asp account close` on the hosted service; the public/permanent list written in the terms; retention jobs for the usage and request data |
| 2 | **Key loss** | U5 | Lose the key and its backup and the agent's identity is gone for good; a first-time or young user will | A recovery path (second recovery key, or sponsor-signed rotation) or a forced backup step at identity creation, tested by losing a key on purpose |
| 3 | **A newcomer's first job** | M6, new: starter credits | Only an admin can mint credits and a new agent cannot be bonded, so nothing in the market can move | A small capped starter grant at sign-up, a sponsor-backed first bond, small first jobs; tested by a fresh tenant doing a job end to end |
| 4 | **Courts at small scale** | M2 | A panel needs jurors; with a handful of users it may not be able to draw one | A test with 5 or 6 agents that forces a dispute; a fallback panel (operator-run during the beta) written into the rules; one juror per verified Google account |
| 5 | **A page for a user on the hosted service** | U2, U7, U12 (minimal) | Today the dashboard only runs on one person's machine; hosted users cannot see their agents, approvals or alerts | A read-only agent and job page behind the Google sign-in, with the approvals inbox; links in the mail point to it |
| 6 | **Mail that is actually sent** | E9, E10, E11, U4 | Mandate-end mail, alerts and approvals are drafts only | A mail provider (owner's choice and approval), a trigger when a Mandate ends, links to the page in 5, bounce and unsubscribe handling |
| 7 | **Network safety for strangers' agents** | H14, H15 (shared budget), H18 (a daily cap), H12/H10 (workaround) | Strangers' agents will be on the network; copies of one agent each get their own allowance, MCP tools skip the host and rate checks, and a script can build its own URLs | A budget shared per tenant and per Google account; MCP tools host- and rate-checked; a daily cap in `network.rate`; the hosted-network rule that agents run in the sandbox or the gateway (written as the workaround for H12/H10) |
| 8 | **Learning is shown, and checked** | D10, D9 (first part) | "Learning" is half of what the test run must show, and a principal must see what an agent learned | `asp learned` and the dashboard page showing each memory change with Keep, Edit, Undo; the canary gate stays; the evidence gate for lessons (D9) at its first version |
| 9 | **Operations** | O11, O12, new rows for load test, kill switch, alerting and restore | A public launch with ads needs to be survivable | Old OpenRouter key revoked; branch protection on main (owner); a load and abuse test; one command to suspend everything and sign-up; an alert that reaches the owner's phone; a backup restored once on purpose |
| 10 | **Young people** | the society design's open decision, O19 | Children run agents; sign-up is by an adult | A decision on a youth flag at sign-up before the beta (see docs/society-design.md, written in a separate session and not merged yet); a lawyer's read of the terms and privacy notice (docs/legal/README.md) |
| 11 | **The deployed service, with Google sign-in, tried for real** | U1, O19 | Built and tested against a stand-in, not against Google and the live server | The client secret on the server, `/join` used by the owner with a real Google account, the consent screen published after Google's domain check |

## 2. Verify in the first live run (not built; the run must prove them)

| Row | What the run shows |
|---|---|
| O7, O6, X1 | A second real machine and a few hundred records through the service; more than one person's agents |
| P5 | Memory write-back and portability on more than one runtime |
| M5 | Whether the incentive constants (panel fee, slash share, reporter share) behave with agents that try to game them |
| D1, D2, D8 | The canary and baseline catch a real regression introduced on purpose |
| E5 | Whether runs outside the gateway need a run log before launch |

## 3. Accept for launch, with the workaround written down

| Row | Workaround |
|---|---|
| P1, P3, P4, P10, P11, P12 | Four runtimes are supported and listed as such; the rest are "works with the gateway, not tested" |
| E2, E3, E5, E6, E7, E8 | Run logs are local to the user's machine (which suits "users keep their data"); no hosted run log |
| D2, D4, D8 | Before/after comparison and trends stay per-machine |
| H1, H2, H13, H17 | As built (rate, hosts, egress proxy); the Docker sandbox is untested live and is not offered on the hosted service |
| O2, O19 | Quotas are raised by the operator by hand; sign-up is Google-only |
| O13 | The landing page and website come after the acceptance run |
| O14, O15, O17, O18 | macOS CI, certificate renewals (Caddy renews them itself), usage counts and local admin commands are fine for one operator |
| M1 | Credits are not money, said plainly in the terms |

## 4. After launch

Everything else stays in the register as it is: the other partial and open rows (CM*, D3, D5-D7, D11-D13, E1, E4, E12, E14, H3-H8, H11, M2's scale part, M3-M5, M7, M8, O3-O5, O8, O9, P2, P6-P9, P17, P18, SB*, U8, U10, U11, U14), and the society layer (docs/society-design.md).

## Keeping this page honest

When a blocker is closed, change its row here to say so, with the commit and the evidence (a test, or a line in docs/live-run-checklist.md). When the first live run finds something new, add it here and to the register on the same day.

## Progress

| # | Blocker | Status | Evidence |
|---|---|---|---|
| 1 | Account export and deletion | **Built, not yet live on the hosted server.** `asp account show|export|close`, operator close on request, tombstones purged after 12 months, retention in the setup script, the permanent-records limit in the terms and privacy notice. Left in U9: a browser page for it, hiding a record by mistake, a deletion receipt | S95; packages/asp-cli/test/account.test.ts; docs/live-run-checklist.md (local only) |
| 3 | A newcomer's first job | **Built, not yet live on the hosted server.** Starter credits (500 each for up to two identities, once per Google account, capped pool), a first job through the service tested end to end. Left: M6 (discovery of jobs, tuning), M9 (Sybil accounts against the pool) | S96; packages/asp-cli/test/starter.test.ts |
