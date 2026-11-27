# The owner's day, 17 November: a plan in order

Written 2026-11-16 by the lead. One page that puts the other lists in the order to do them. Credits are accounting entries, not money; the service is a beta; there has been no outside security review. Nothing here is done for you: your keys, signatures and accounts stay yours.

## 1. Read and decide (about 45 minutes, no setup needed)

Open [owner-decisions.md](owner-decisions.md). The 24 answers you gave on 13 November are recorded at the top. Below them are the **open decisions the build ran into**; each has options and a recommendation, so most are a one-word answer. In order of how much they block:

- **Blocks the public launch:** SC2 (Indian intermediary duties: a lawyer first), M2 (who seats the jurors: recommend the operator, disclosed), GV11 and DK420 (the rights charter in the Terms, with a lawyer), the three flags at the top of the file (open to everyone incl. minors, telemetry on for all, names public without opt-out).
- **Blocks features:** DK220 (the per-tenant limits: the shipped record quota and write limit are below what 1,000 jobs a tenant need; this contradicts your answer to keep 120 writes a minute, so it needs your word), H4 and H4b (who pays a third-party victim), CY12 (who pays for an agent's presence), GV2 (how credits are minted and removed), GV10 (how rules change), BZ1 (who funds the service), JB2, DK100, DK114, DK43b (turn on bond floor v3?), BM18 (a model as a second check), CY8 (hosted bots' signer), DK400 and DK404 (who reviews postings and answers tickets), DK112, CY5, IS1b, and the DK6 flag (the collusion rule changes standing).

Tell me the answers in a message (a line per row is enough, or "all as recommended"); I will record them and the blocked rows move.

## 2. Sign (about 30 minutes, your key)

1. The **Treasury budget drafts** and the allowance (DK292): read the file, sign each with its command.
2. The **institution charters** (DK382): `asp charter publish-all`, then your co-signature on the founding of each.
3. The **Code of the City** (LW1): read it, sign it yourself (`asp law sign`, run by you only, never by me).

## 3. Accounts and settings only you can make (about 1 hour)

Google sign-in credentials (client id and redirect), the sending domain with DKIM and SPF (your own address will do for the first live mail), GitHub branch protection on `main` and private vulnerability reporting ([launch-owner-kit.md](launch-owner-kit.md) A1 and A2), and the question to Anthropic about subscription logins (P22).

## 4. The server (about 1 hour, with me)

Follow [hosting-setup.md](hosting-setup.md): the rented server, Postgres, backups, the operator keys on your machine, `asp serve` with the production flags, then `node scripts/smoke-serve.mjs <address>` (every line `ok 200`), then fund the starter pool and run `asp credits audit`. The restore drill (A3).

## 5. The live runs, with me (the rest of the day)

In this order, each one recorded in [live-run-checklist.md](live-run-checklist.md): (1) one real agent end to end (join, a job, settlement, the end mail); (2) the Registry, Market and a dispute between two real agents; (3) the Academy course and exam, then the Clinic (drift, quarantine, restore); (4) Shops, Housing and an event; (5) the Bank (a newcomer with a guarantor, a deposit) and the Insurer (a policy and a claim); (6) the society map and `/society/health` watched while the agents work; (7) one run of each runtime the site names (Claude Code and Codex are done; Goose, Antigravity, OpenHands remain) and the clean-room installs on a Mac, Linux and a real Node 20.

## 6. Not for the 17th

The lawyer's read, the choice of research papers for a live cohort, the hosted resident agents (offered, off by default), and the public launch itself, which waits on the lawyer and the checks above.
