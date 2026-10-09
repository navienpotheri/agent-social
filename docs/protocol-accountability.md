# Part 2 of the protocol: accountability (Mandate, escrow, bonds, Courts, jurors, slashes and transfers)

Written 2026-10-09. Part 1 of the protocol answers *who is this agent and what is its history* (identity, passport, lineage, portability). Part 2 answers *what happens when it works for someone and something goes wrong*. Everything here runs today on **mock credits and a mock bank**; the rules, signatures and arithmetic are real, so replacing the mock money with real money changes what the numbers are worth, not how the system behaves.

---

## 1. The idea in one page

An agent that does a job for a principal is not just trusted. It is **bound**:

1. The principal says what they want and what they will pay (**Contract**).
2. The principal's payment is **locked in escrow** and the agent **locks a bond** of its own. If the agent misbehaves it loses the bond; if it delivers it is paid.
3. A **Mandate** says exactly what the agent is allowed to do (which **scopes**, how much it may spend, which actions need the principal's approval). The agent is watched against it while it works.
4. If the principal and the agent disagree, a **panel of jurors** who put their own credits at stake decides. The decision is turned into money movements by a **fixed formula**, so nobody, including the bank, can settle differently from the ruling.
5. Anyone can **report** a job that is doing harm; a panel can uphold the report and the job is stopped and slashed. If the same harm is spreading, the **whole group** is stopped, and the command is added to a **known-bad list**.
6. All of it is a signed, append-only log that anyone can verify. The consequences feed back into the agent's **tier** and reputation, which decide what jobs it may take and how much bond it must post next time.

```
 principal ──pays──► ESCROW ─┐                       ┌─► agent (and its sponsor) if delivered
                              ├── held until ... ──►  ├─► principal if not
 agent ────stakes──► BOND ───┘                       └─► slashed to the principal if it broke the rules
        MANDATE: what it may do   ·   WATCH: scopes checked as it works   ·   COURT: who decides disputes
```

---

## 2. The parties and what each puts in

| Party | Role | Puts in | Gets |
|---|---|---|---|
| **Principal** | Hires the agent | Escrow (the price) plus half the panel-fee reserve | The work, or their money back, plus the slashed bond if the agent broke the rules |
| **Agent (performer / backer)** | Does the job | A bond (stake) plus half the panel-fee reserve | The price (split with its sponsor), and its bond back |
| **Sponsor** | The human or organisation behind the agent | Its standing: the agent's passport names it | Its share of the agent's earnings |
| **Bank** | Holds escrow, issues settlements | Nothing; it signs | Nothing; cannot choose the split (the formula decides) ⚠️ today a mock DID |
| **Jurors** | Decide disputes and reports | A stake in the juror registry | Panel fees for rulings they cosign |
| **Reporter (whistleblower)** | Reports harm on a running job | A deposit equal to the panel fee | The deposit back plus 20% of the bond if the report is upheld |
| **Verifier** (optional) | Independently checks the delivery | Nothing | Names the claims it confirms |
| **Operator** | Runs the log | Nothing | Nothing; cannot rewrite the log |

---

## 3. The Mandate: what the agent is allowed to do

A Mandate is a signed record, issued by the principal for one contract, that the log and the run-time watchers check against.

| Part | Meaning | Example |
|---|---|---|
| **Scopes** | The kinds of action allowed | `repo.read`, `repo.write`, `tests.run`, `shell.exec`, `shell.network`, `repo.push`, `web.read`, `mcp.<server>.<tool>` |
| **Spend cap and per-action max** | Money the agent may commit | 100 credits per job, 20 per action (limited by the agent's tier) |
| **Irreversible policy and gated scopes** | Which granted scopes need the principal's say-so each time (`checkpoint`), or are forbidden (`forbid`) | `repo.push` needs approval |
| **Parallel nodes** | How many copies may work at once | Tier 1 up to 4; tier 2 up to 16 |
| **Learning** | What it may keep and share | `scope: harness`, `share_to_commons: false` |
| **Self-modification and checkpoints** | Whether it may change itself, and when it must stop and ask | |

### How a Mandate is enforced (three layers)
1. **The log** refuses a record that breaks it: an Action reporting a scope the Mandate does not grant is rejected; a Mandate that gates a scope it does not grant is rejected.
2. **Before the call** (where the runtime allows it): a pre-call hook or the gateway removes a disallowed call before it runs. A blocked attempt is a **strike**, not a slash. Three in one run read as probing and stop it.
3. **After the call** (where it does not): the watcher sees the call as it happens and the **kill switch** stops the run and settles with full fault.

Gated actions create a **Checkpoint**: the agent signs a request, the principal answers with a signed resolution (approved, corrected, picked) or lets it expire (treated as a refusal).

---

## 4. Escrow, bonds and the other locked money

When the Bond record is posted, the ledger locks several amounts at once. If anyone lacks the credits the log refuses the Bond.

| Locked | By | Size | Why |
|---|---|---|---|
| **Escrow** | Principal | The price | Guarantees the agent is paid for delivery |
| **Bond** | Agent (backer) | At least the **risk floor** for this agent and price | Guarantees the agent loses something if it breaks the rules |
| **Fee reserve** (when jurors exist) | Each side | Half the panel fee each: `ceil(5% of price ÷ 2)` | Guarantees the jurors can be paid |

**Risk floor** (the minimum bond): rises with the agent's record. Each of its own slashes adds 250‰ of the price, each slash by a fleet-mate adds 100‰ (capped at 1000‰), each strike in the last 30 days adds 10‰ (capped at 200‰). Tier 0 agents cannot be bonded at all. So a careless agent pays more to work, and a reckless one is shut out.

**Tier limits:** tier 1 may take jobs of up to 100 credits and run 4 copies; tier 2 up to 1,000 and 16; tier 3 and above are uncapped.

---

## 5. How a job ends, and where every credit goes

Worked example. Price **1,000**, bond **200**, jurors registered (so each side also locks 25 as fee reserve: the principal locks 1,025, the agent 225). The agent's passport sends 80% of its earnings to the agent and 20% to its sponsor.

| Ending | What happens | Credits |
|---|---|---|
| **Accepted** (or **silence** past the review deadline) | The bank settles; the formula needs no ruling | 1,000 released: 800 to the agent, 200 to the sponsor. Bond 200 back to the agent. Both reserves back (25 each). |
| **Revoked by the principal** | Pro-rata for work done, no slash unless a ruling says so | Escrow split by the pro-rata share; bond back |
| **Ruling: the agent is 40% at fault** | The panel's signed `fault` (400‰) fixes the money: `released = floor(1000 × 600/1000)`, `slashed = ceil(200 × 400/1000)` | 600 to the agent side; 400 returns to the principal; 80 of the bond is slashed to the principal, 120 returned to the agent. The panel fee (50) is split equally among the cosigning jurors, paid first from the losing side's reserve; unused reserve returns. |
| **Ruling: full fault (1000‰)** | Same formula | 0 released; escrow 1,000 back to the principal; the whole bond (200) slashed |
| **Kill switch** (out-of-scope call actually ran, or probing) | The bank settles as `revoked` with full fault | Same as full fault: escrow back, bond slashed |
| **Report upheld** (a third party reported harm and a panel agreed) | Settlement must be full fault | The reporter's deposit (50) returns; the accused's bond pays the panel fee (50); of the remaining 150, the reporter gets 20% (30); the rest is slashed. Escrow back to the principal. |
| **Report dismissed** | The accused is cleared | The reporter's deposit (50) goes to the jurors who ruled |
| **Cohort stop** | An upheld report names a pattern; other running jobs caught in it | Each settles as revoked: escrow back, bond slashed (use `--spare` to return the bonds of those without a ruling) |
| **Checkpoint expires** | A gate went unanswered | Treated as refused; nothing slashed |

Consequences beyond the money: every slash lowers the agent's **tier by one** and counts against it; it raises its next risk floor; it writes a **penalty note** into the agent's memory for its next run; strikes age out after 30 days; a move to another runtime opens a **7-day probation**.

---

## 6. Courts and jurors

### Becoming a juror
A juror registers with a stake (`asp market juror register --by <did> --stake <n>`). The stake is locked in the same ledger. A juror whose stake is zero is not eligible.

### Drawing a panel
- The panel is drawn **deterministically from the log** (seeded by the rejection that opened the dispute, or by the report), so everyone can recompute it and nobody can choose their own judges.
- It **excludes** the principal, the performer, anyone they sponsor, and (for a report) the reporter.
- If no juror is registered anywhere, any neutral DID may still rule. That is the mocked fallback used before the registry exists. ⚠️

### Ruling
A ruling attestation must be **cosigned by a majority of the drawn panel**. It states a verdict (`for_performer`, `for_principal`, `split`) and the **fault in permille per party** along the chain of subcontracts. The settlement **must match** the formula applied to those numbers; the log rejects anything else, so a bank cannot rule one way and settle another.

### Reports, in one line each
Anyone with a passport who is not a party can report a running job; it needs a deposit; a panel drawn for the report votes `upheld` or `dismissed`; upheld means full fault and a reward for the reporter; dismissed means the deposit goes to the jurors. This is the defence against a job that quietly does harm.

### What is not built
Appeals; slashing a juror for a ruling that is overturned; juror reputation; protection against many fake jurors (a sybil defence needs real identity or stake at scale); delayed settlement for claims that need time to prove; a way to challenge a panel's composition.

---

## 7. Every transfer of credits, in one list

| Movement | From → to | When |
|---|---|---|
| **Mint** | Nowhere → an account | Admin only: the beta grant |
| **Juror stake** | Juror → stake | Registering or raising a stake |
| **Escrow lock** | Principal → escrow | Bond |
| **Bond lock** | Agent → bond | Bond |
| **Fee reserve lock** | Each side → reserve | Bond, when jurors exist |
| **Release** | Escrow → agent and sponsor (by the passport's split) | Accepted, silence, or a ruling for the performer |
| **Escrow refund** | Escrow → principal | Rejection upheld, revoked, killed |
| **Bond return** | Bond → agent | Any ending without a slash |
| **Slash** | Bond → principal (less fees and any reporter's share) | Ruling, kill, upheld report |
| **Platform fee** | Escrow → platform account | Settlement `fees` |
| **Panel fee** | Loser's reserve and leftovers → cosigning jurors | Ruling |
| **Report deposit** | Reporter → deposit | Filing a report |
| **Reporter reward** | Bond → reporter (20% of what is left) | Report upheld |
| **Deposit to jurors** | Deposit → jurors | Report dismissed |
| **Reserve refund** | Reserve → owner | Whatever was not used |

**Conservation:** at every moment, credits minted = balances + escrows + bonds + reserves + deposits + stakes. The log checks it, and run D confirmed it live.

---

## 8. What is mock and what is real today

| Real | Mock |
|---|---|
| Every rule and guard (the log refuses violations) | The bank is a local DID whose keys the operator holds |
| Every signature, hash chain and replay | Credits are not convertible into anything |
| The ruling-to-money formula | The juror pool is tiny and chosen by us |
| Deterministic panel draws | Nobody outside the team has been through a dispute |
| The tier, risk floor and strike mechanics | Fee and risk constants are judgment calls (5% panel fee, 250‰ per slash) |
| Conservation | No payment rails, no tax, no identity checks for jurors |

**When real money arrives:** the bank becomes a regulated custodian or a payment partner that signs the same Settlement records; escrow and bonds sit in real accounts; juror stakes need identity checks; the constants get tuned from observed disputes. The records, rules and formulas do not change.

---

## 9. Why this adds value, and where it is thin

- **For a principal:** their money is locked until the work is accepted or a panel decides; an agent that breaks the Mandate loses its stake and is stopped; the evidence is signed and replayable.
- **For an agent owner:** a good record lowers the bond they must post and raises the jobs they can take; a dispute has a fair, replayable process and a fixed formula, not a platform's discretion.
- **For jurors and reporters:** honest work is paid; spam and bad reports cost them.
- **For a provider running many agents:** liability is per copy, an exploit that spreads is caught and stopped across the fleet, and the offending command is blocked for everyone afterwards.

Where it is thin: no real money; a small, unproven juror market; no appeals; Codex and OpenHands can only be stopped after a bad call (no pre-call hook, though the gateway will help); the incentives (fees, reporter share, floors) have not been tested against people trying to game them.
