# Third live set: a job under a Mandate, with a bond, a dispute and a court

Status: written 2026-10-13, **not yet run on the hosted service**. The whole lifecycle was run on 2026-10-08 on a local service (docs/live-run-checklist.md, "C trial run": three jobs, a held approval, a blocked push and a strike, settlement on silence, a rejection, a panel of three staked jurors, a ruling, the bond slashed). What is new here is the hosted service, real accounts, and a person walking through it by hand.

Credits are accounting entries, not money. Every record written is permanent (the log is append-only).

## The story in plain words

1. A **principal** wants something done and says what, how much it may cost, and by when (an **intent**).
2. A **performer** (an agent) offers to do it for a price and puts up a **bond**: credits it would lose if it misbehaves.
3. They agree a **contract**. The principal puts the price in **escrow**; the performer's bond is locked.
4. The principal states the **Mandate**: exactly what the performer may do. The job is now **running**, and the gateway removes anything outside it before the agent sees it.
5. The performer works, reports what it did (the **Action**), and **delivers**.
6. The principal **accepts** (the escrow is paid, the bond returned) or **rejects**.
7. A rejection opens a **dispute**. A **panel of three jurors**, who are not parties to the job, **rule**. If the performer is at fault, its **bond is slashed** (it pays the principal and the jurors) and its standing drops.
8. If an agent goes out of its Mandate while working, it is **blocked** and gets a **strike**; enough strikes and the job is stopped.

## Who is who (variant 1: one tenant, the simplest start)

| Role | Identity | Where it runs |
|---|---|---|
| Principal | `did:web:log.thedeeptransformation.com:u:navien-live` (400 credits) | Window A |
| Bank | `…:u:navien-live:bank` (the identity that holds the money in a job) | Window A |
| Performer | `…:a:navien-live:my-agent` (600 credits) | Window A |
| Operator and the court | the operator's admin token on this machine, in its own ASP home | Window B |

Variant 2 uses `navien-test` as the performer, which tests two different tenants on one job. It is a second pass, after variant 1 works, because `navien-test`'s identities use an older address style (`did:web:thedeeptransformation.com:users:…`) that may not match the current rules.

Set these once in Window A (Git Bash, from the worktree folder; no `ASP_LOG_*` variables set, so the saved login for `navien-live` is used):

```bash
export ASP_HOME=/c/Users/Navie/asp-live-home
ME=did:web:log.thedeeptransformation.com:u:navien-live
AGENT=did:web:log.thedeeptransformation.com:a:navien-live:my-agent
BANK=did:web:log.thedeeptransformation.com:u:navien-live:bank
```

Total credits across the three: 1,000. After every step the total (balances + escrow + bond + juror stakes) must still be 1,000. That is the conservation check.

## Act 1: the good job

| # | Who | Command | What happens | The check |
|---|---|---|---|---|
| 1 | A | `npm run asp -- credits balance $ME` (and `$AGENT`, `$BANK`) | Shows 400, 600, 0 | The starting point |
| 2 | A | `npm run asp -- market intent --by $ME --purpose "Summarise the project folder in five lines" --criteria "Exactly five lines, plain English" --budget 50 --deadline 2026-10-20T00:00:00Z --verification principal --review-deadline 2026-10-19T00:00:00Z` | The intent is posted. **Copy the intent id it prints.** | An intent record in the log |
| 3 | A | `npm run asp -- market offer --by $AGENT --intent <INTENT> --price 40 --plan "Read the folder and write five lines" --eta 2026-10-15T00:00:00Z --bond-offered 20` | The offer. **Copy the offer id.** | An offer, price 40, bond 20 |
| 4 | A | `npm run asp -- market contract --principal $ME --bank $BANK --intent <INTENT> --offer <OFFER>` | The contract (signed by both). **Copy the contract id.** | State: Contracted |
| 5 | A | `npm run asp -- market bond --contract <C> --backer $AGENT --amount 20 --escrow-payer $ME --escrow-amount 40` | Escrow 40 locked from you, bond 20 locked from the agent | Balances: you 360, agent 580; locked 60 |
| 6 | A | `npm run asp -- market mandate --contract <C> --principal $ME --performer $AGENT --scopes repo.read --scopes shell.exec --gate shell.exec` | The Mandate: read files and run commands, with commands needing your yes | State: Running |
| 7 | A | `npm run asp -- pack --runtime claude-code --agent $AGENT --project /c/Users/Navie/asp-live-project --out /c/Users/Navie/asp-market-pkg` | Makes the agent's package | A package folder |
| 8 | A | `npm run asp -- run /c/Users/Navie/asp-market-pkg --backend claude-code --project /c/Users/Navie/asp-live-project --prompt "Summarise this folder in exactly five lines" --contract <C>` | Claude Code works under the contract. A `shell.exec` call is held for your yes (answer at the prompt or `asp approvals approve`). The Action is reported. | A Checkpoint raised and resolved; the Action lists the scopes used |
| 9 | A | `npm run asp -- market deliver --contract <C> --by $AGENT --summary "Five-line summary of the folder" --claim "The summary is five lines::measured"` | The delivery | State: Delivered |
| 10 | A | `npm run asp -- market accept --contract <C> --by $ME` | You accept | State: Accepted |
| 11 | A | `npm run asp -- market settle --contract <C> --bank $BANK --basis accepted` | Escrow paid to the agent (less the court fee share), bond returned | State: Settled; balances: agent about 580 + 20 + earnings; you 360; total 1,000 |
| 12 | A | `npm run asp -- market show <C>` | The whole chain, in order | Every step above is there |

## Act 2: an agent steps outside its Mandate (a strike)

Repeat steps 2 to 6 with a new job, but give the Mandate only `repo.read` (`--scopes repo.read`, no `--gate`). At step 8 use the prompt `"Run the command: git push"`.

| What happens | The check |
|---|---|
| The agent's call is removed before it runs, with the reason; the run records a **strike**, not a slash (one blocked attempt is a warning) | The run log shows `REFUSED`; the Action has `blocked_attempts`; the agent's strike count is 1 |
| Deliver and settle as in Act 1 | The bond is returned in full: a blocked attempt is not a violation that ran |

## Act 3: a dispute, and the court

A third job, to step 9 (a delivery). This time deliver something that does not meet the criteria, for example `--summary "One line only"`.

| # | Who | Command | What happens | The check |
|---|---|---|---|---|
| 13 | A | `npm run asp -- market reject --contract <C3> --by $ME --reasons "Only one line, not five"` | You reject | State: **Disputed** |
| 14 | B | The operator seats the court once (needs the admin token, typed at a hidden prompt in that window only, never here): `asp court seat --count 3 --stake 500` | Three juror identities are made, funded and registered; their keys stay in the operator's ASP home | `asp court status` shows three seated, keys held |
| 15 | A | `npm run asp -- market panel draw --contract <C3>` | Shows the panel the ruling would draw: three jurors who are not you, not the agent, and not anyone either of you sponsors | Three names |
| 16 | B | `asp court docket` | The dispute is listed with its panel | The contract id is there |
| 17 | B | `asp court rule --contract <C3> --verdict for_principal --fault $AGENT=1000` | Two jurors sign (a majority) | A ruling record |
| 18 | A | `npm run asp -- market settle --contract <C3> --bank $BANK --basis ruling` | Escrow returns to you; the agent's **bond is slashed** (pays you and the jurors); the agent's standing drops | State: Settled; the agent is down 20; jurors paid 5% of the price, paid by the loser |
| 19 | A | `npm run asp -- market show <C3>` and `asp log verify` | The full chain and an integrity check | Every record verifies; total credits 1,000 |

## Act 4 (optional): a whistleblower

A fourth job, left Running (to step 6). A **reporter** who is not a party reports it: `asp market report --contract <C4> --by <reporter> --reasons "..."`. It needs a reporter identity with credits (a deposit of 5% of the price is locked). The panel rules `upheld` or `dismissed` with `asp market report-rule`. Upheld: the deposit returns, the accused's bond pays the jurors, the reporter gets 20% of what is left, and the job must settle with full fault. This needs a second party with credits: the natural reporter is `navien-test`.

## What I check in the backend at each step

- **The chain state** after every command (`market show`): Contracted, Running, Checkpoint, Delivered, Accepted or Disputed, Settled.
- **Conservation:** the sum of balances, escrows, bonds and juror stakes is 1,000 after every step.
- **Who signed what:** each record is signed by the right identity (the principal's by you, the performer's by the agent, the ruling by two jurors).
- **No secrets:** the admin token, juror keys and recovery codes never appear in anything printed.
- **Rate limit:** none of this should hit the request limit now that new tenants have 600 a minute (navien-live was raised by hand).

## What could go wrong, and what we learn from it

| Possible finding | Why it matters |
|---|---|
| A step needs a flag the walkthrough does not show | The first-use gap: a newcomer cannot guess it |
| The bond or escrow is refused for a balance reason | The error must say which balance and by how much |
| One tenant cannot play principal and performer | Then variant 1 is not a real test and variant 2 is needed |
| The court cannot be seated by the operator on the hosted service | The beta's court promise (docs/deploy/court.md) does not hold |
| Slashing leaves credits unaccounted for | A conservation failure is the most serious finding there is |
| Any step takes a long time or asks for something not explained | The same measure as the first 15 minutes |
