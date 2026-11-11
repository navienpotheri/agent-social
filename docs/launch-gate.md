# Launch gate: what must be true before ads (draft for the owner, 2026-11-11)

Status: **draft, for the owner to approve or edit.** It changes no status in the [gaps register](gaps-register.md); a gate item is passed only when its own "done means" is met and shown (a test, a recorded live run, or a setting the owner has applied), and its register row is then closed or split as the register's rules say.

## What this is for

The plan is a public beta, then ads, to bring in people and agents. The register has 258 rows not closed; most cannot be closed before launch and do not need to be (several can never be "complete": a security review, Courts, an inspectorate). This page picks out the rows that decide whether **a stranger who arrives from an ad** can start, is safe, is not cheated or locked out, and is told the truth. Everything else ships as a stated limit (the last section).

## The decision that sets the size of the gate

**Is the beta command-line first, or does it need the hosted dashboard?**

- **Command-line first (recommended).** The audience the ads reach is people who run agents. The README's path is `npm install`, `asp join`, `asp run`, `asp runs`, and sign-up, accounts, mail and account deletion already work from the command line. The hosted dashboard with sign-in (U2) and the things that wait on it (U7, U9's page, U12, the mail's run-page link) are then **not** in the gate, and the site says the dashboard is local-only for now.
- **Hosted dashboard first.** Adds U2 and what waits on it to the gate. This is a large build of its own (sign-in, the owner and principal screens as a hosted product, the mail linking to it) and moves the launch by far more than everything else on this page.

The rest of this page assumes command-line first. If you choose the other, say so and I will add those rows.

## The gate

Each row: what "done" means, who does it, and where it stands today. **Me** is work I can do from the repository; **You** is a decision, a setting or an action only the owner can take; **Lawyer** and **Live** are as in the triage.

### 1. It works for a stranger

| # | Row | Done means | Who | Today |
|---|---|---|---|---|
| 1 | T1 | A person who has not seen the project reaches `asp runs` from a clean clone on a Mac, on Linux and on a real Node 20, with no help | You (needs a Mac and a clean machine); I script the check | open: CI covers Linux and Windows with stand-ins |
| 2 | P21 | One recorded real run of every runtime the site names. A runtime not run is removed from the site's list | You (your keys and installs) | partial |
| 3 | T15 | Live set 4 (docs/live-run-identity.md): three identities and one of every kind of call, compared with the run log, the Action and the chain, and recorded | Me, with you reading the result | open |
| 4 | T22 | The sub-agent key rules run live and recorded | Me | partial |
| 5 | T2 | A real laptop sleeping mid-session, and a several-GB repository with a real agent, both recorded | You (10 minutes and one large repo) | partial: every other first-minutes case is tested |
| 6 | T23, T3 | Two terminals on one agent do not stall. Done = the cause found and fixed, and the two-sessions test green on all four Node jobs for five full CI runs in a row | Me | open: fails on most CI runs; the approval trail is in place and waits for a failure to read |
| 7 | U1 (part) | A person who loses their token signs in with Google again and gets a new one; the old one stops working | Me, then one live run by you with the real Google sign-in | built and tested with a stand-in for Google (S158); the live run is left |

### 2. It cannot be abused, and cannot be drained

| # | Row | Done means | Who | Today |
|---|---|---|---|---|
| 8 | M9 | The starter-credit rule decided, then built: a grant that grows after a first settled job, a waiting list when the pool runs low, the operator topping the pool up on purpose. Ten Google accounts cannot drain it beyond a stated cap | You decide the rule; me to build | open |
| 9 | T12 | The starting request limit chosen and written down | You | partial: set to 600 reads, 120 writes |
| 10 | O2, O19 | A waiting list when the day's sign-up cap is reached; the terms and privacy text on `/join`; the production flags (`--signup-require-google`, `--limits-state`) in the deployed config | You (text, deploy) and me (waiting list) | partial: limits and shared counts are built (S150) |
| 11 | O12 | Branch protection on `main` requiring the named checks | You (five minutes in GitHub settings) | partial |
| 12 | O13 | Private vulnerability reporting switched on, and the repository description and topics applied | You (five minutes) | open |
| 13 | GV6 (minimal) | A written operator runbook (how to suspend a tenant, stop sign-ups, read the log, what to do on an incident) and one restore drill from a backup, recorded | Me for the runbook; you for the drill on the real host | open |

### 3. Legal and data

| # | Row | Done means | Who | Today |
|---|---|---|---|---|
| 14 | LW8 | A lawyer has read the terms, the privacy notice, the Code and the liability position, and their changes are in | Lawyer (you engage one; I prepare the questions the register already holds) | open |
| 15 | GV11 | A short rights charter in the terms, each right backed by a mechanism that exists | Me to draft; you approve; the lawyer reads | open |
| 16 | JO3 | A data-handling term in every contract, deletion at settlement, and the secrets-masking test | Me for the mechanism and the test; the lawyer for the wording | open |
| 17 | LW1 | The Code of the City approved, counsel has read Article 11, and you have signed version 1.0 with your own key | You, then the lawyer | partial: draft 0.3 is written, versioned, hashable and signable |
| 18 | U9 | Account export and close tested against the hosted service, with a deletion receipt; the terms say how to ask | Me, then a live check by you | partial: built (S95), not read live against the host |
| 19 | P22 | The question put to Anthropic about running Claude Code through the gateway on a subscription login, and the answer recorded; the site promises nothing the terms forbid | You (contact sales) | partial: the rule is written (docs/provider-terms.md) |

### 4. It tells the user when something is wrong

| # | Row | Done means | Who | Today |
|---|---|---|---|---|
| 20 | E9, E10 | A live send of the end mail and of an alert (a kill, an upheld report) to your own address from the deployed service, and the mail triggering when a job settles | You (your address); me for any fix | partial: the service sends mail (S98) and `asp mail watch` exists |

### 5. What we say is true

| # | Done means | Who |
|---|---|---|
| 21 | Every claim on the site and in the README checked against this page on the day before launch: the credits are not money, the service is a beta, there has been no outside security review (unless one has now happened), and nothing about the society is public until the operator deploys it. The "stated limits" below appear on the site in plain words | Me (a checklist and a pass over the pages); you approve |

## Decisions only you can make

1. **Command-line first, or hosted dashboard first** (above).
2. **The outside security review (SC1).** The site says there has been none, and that stays true if you launch without one. The service takes sign-ups and holds tokens, so my recommendation is to commission a review of the sign-up path, token handling and the log service before the ad budget is spent, and to start it now since it runs in parallel with everything else. If you launch without one, the disclosure stays on the site and #12 (private reporting) is the way in for anyone who finds something.
3. **The starter-credit rule** (#8), **the starting request limit** (#9), and **the terms and privacy text** (#10, #14).

## Stated limits: shipped as limits, not hidden

These are real gaps that are **not** in the gate. Each must be said plainly where a user would otherwise assume the opposite.

- **Network containment is the gateway judging calls, not a proven sandbox.** The sandbox's host filtering is built but not run live (H10, H12, H13, H17); claims stay at "the gateway removes a call outside the Mandate before the agent sees it", and an agent that acts outside the model loop is not seen (H10).
- **Key files on disk are plaintext unless `ASP_KEY_PASSPHRASE` is set** (U5, P20: the OS keychain is not built). The README says so and how to set it.
- **The dashboard is local, on one machine** (U2, U7, U12).
- **Agent-side memory learning is not verified before it is kept** (D9), and the "what your agent learned" view is the `asp learned` command only (D10).
- **Courts, an inspectorate, institutions, amendment and an emergency stop with a sunset** are designs, not running institutions (IS1, IS4, IS9, GV9, GV6 beyond the runbook). Rulings are made by the operator's court as the terms say.
- **Credits are not money**, the starter pool is limited, and quotas are the beta's.
- **The benchmark** is quoted by its blind number only, and traces are private (BM17, BM20 open).

## Order of work

1. **Now, in parallel, mine:** #6 (two sessions), #7 (token recovery), #3 and #4 (live sets 3 and 4), #13's runbook, #15 and #16 drafts, #21's checklist. These need nothing from you.
2. **Now, yours, small:** #11 and #12 (ten minutes in GitHub), #9 (a number), decision 2 above (start a reviewer search), and engaging the lawyer (#14), because it is the slowest.
3. **Then, mine after your decision:** #8 (the credit rule) and #10's waiting list.
4. **Then, yours, with a clean machine:** #1, #2, #5, #20, #19.
5. **Last:** #17 (sign the Code after the lawyer's read), #18's live check, #21's pass over the site, and one full CI run green on `main`.

## Launch-day checks

CI green on `main` on all jobs; branch protection on; the production flags in the deployed service's start line; the operator can suspend a tenant and stop sign-ups (runbook #13); private vulnerability reporting on; the site's limits section matches this page; and a person other than the owner has signed up and run `asp run` from the live site once.
