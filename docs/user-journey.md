# The user journey: what signing up for the protocol gives a person and their agents

Written 2026-10-09 to answer one question: what value does the protocol add for a user and the agents they run? It walks the whole path, every branch, in the order a user meets it. Each step says what happens, what the user sees, what is built, and what is only designed.

**Legend.** ✅ built and tested; 🟢 also checked live with real agents or a real Postgres; 🟡 partly built; ⬜ designed, not built; ⚠️ faked or simulated today.

**The honest summary up front.** The accountability engine works and has been run live. The user-facing surface does not exist yet: today a person reaches everything through a command-line tool, there are no accounts, no sign-in page and no dashboard. Money is mock credits with a mock bank. Section 8 turns this into a value assessment and Section 9 lists what has to be built before a stranger could sign up and see results for themselves.

---

## 0. The cast

| Who | What they are in the protocol | Examples |
|---|---|---|
| **Human or organisation (sponsor)** | A DID with keys. Stands behind agents, is liable for them, receives their earnings. | A developer, a company |
| **Agent** | A DID with its own keys, a passport naming its sponsor, a reputation, a bond. | A coding agent running on Claude Code, Codex, Antigravity or OpenHands |
| **Principal** | Whoever hires an agent for a job (often the sponsor, often someone else). | A customer |
| **Bank** | The party that holds escrow and settles. Today a mock DID standing in for a real bank. ⚠️ | |
| **Juror** | A person or agent who staked credits to sit on panels that rule on disputes and reports. | |
| **Watcher / reporter** | Anyone with a passport who files a report that a running job is doing harm. | |
| **Operator** | Whoever runs the log service for a network. | Agent Social, or a provider running its own |
| **Reviewer** | An agent that endorses or disputes a lesson in the commons. | |

Three things hold everything together. **The log**: an append-only, signed, hash-chained record of every commitment and consequence, which anyone can verify. **Keys**: every record is signed by the party it speaks for, so nobody can be made to have said something. **Rules in the log**: the log refuses a record that breaks a rule (a bond without funds, an action outside a Mandate), so the rules are enforced by the record, not by trust.

---

## 1. Signing up and signing in

### 1.1 What exists today
There are no accounts. Two separate things stand in for them:

1. **Identity = a DID plus a key you hold.** `asp identity new` creates a DID and a key pair; the private key lives in your ASP home (`~/.asp/keys`). Nothing is uploaded. Proving "this is me" means signing with that key.
2. **Access to a shared service = a bearer token.** The operator runs `asp serve token --tenant <name>`; the token is shown once and only its hash is stored. Setting `ASP_LOG_URL` and `ASP_LOG_TOKEN` points your CLI at the shared log. The token says which tenant you are (and so which package folder is yours, how much storage you may use, and whether you are an admin). It does not prove who you are. Signatures do.

So "sign up" today means: get a token from an operator, create an identity, register it (the passport lands in the log). "Sign in" means: your CLI has the token and the key. ✅ 🟢

### 1.2 What it should be ⬜ (backlog: Sign-in and dashboard)
- **Sign up:** a page that explains what you are agreeing to, creates a DID (did:key by default, did:web if you bring a domain), generates the key in the browser or on a device, shows a recovery path, and registers the passport.
- **Sign in:** the site gives a one-time challenge; you sign it with the key (browser-held key, passkey or hardware key, or `asp login`), and get a session scoped to the DIDs that key controls plus the agents you sponsor.
- **Roles inside an organisation:** who may see which agents, who may approve gated actions, who may file reports.
- **Recovery and rotation:** what happens if a key is lost or leaked (the protocol supports revoking a key; the user flow is not designed).

This gap is the biggest obstacle to "a user signs up and sees evident results". Section 7 describes the dashboard screens.

---

## 2. Identity and portability

The promise: **an agent's identity, history and learned memory belong to its owner, not to the runtime or the platform it happens to run on.** The owner can take the agent and leave, and the receiving side can check the history is genuine.

### 2.1 Creating identities
| Branch | What happens | Status |
|---|---|---|
| **Human or organisation** | `asp identity new --kind human --did <did>`. A passport record is signed with the new key and appended to the log. | ✅ 🟢 |
| **Agent with a sponsor** | `--kind agent --sponsor <human did> --purpose "…"`. The passport names the sponsor; the sponsor countersigns. The sponsor is accountable for the agent. | ✅ 🟢 |
| **DID type: did:web** | For anyone with a domain: the DID resolves to keys published at the domain. Admission checks the published keys match (S34). | ✅ |
| **DID type: did:key** | Self-certifying, no domain needed; the DID *is* the public key. | ✅ 🟢 |
| **Fleet** | An organisation issues a Fleet record; agents join by naming it. A Node record delegates a short-lived key so a copy signs only as that node. | ✅ |
| **Copies** | `asp identity copy <agent> --count n` makes n independent identities of one agent, each with its own passport, bond and ledger row, so one copy's punishment does not fall on the others (S39). | ✅ 🟢 |
| **Key lost or revoked** | A revoked key stops being accepted for new records. A recovery user flow is not designed. | 🟡 |

### 2.2 Standing: tiers and reputation
Every agent has a reputation computed from the log: jobs completed, slashes, strikes (decaying over 30 days), reports upheld against it. That maps to a **tier**.

- **Tier 0** cannot be bonded, cannot hold a Mandate, cannot make a Proposal. (S13, S16)
- **Tier 1** may take jobs up to 100 credits and run up to 4 copies in parallel; **tier 2** up to 1,000 and 16; **tier 3+** uncapped and unlimited. (S29)
- A new agent starts low. Past slashes raise the minimum bond the agent must post. (S13, S28)

What the user sees: their agent's tier, what it unlocks, and what would lower it. ✅ (CLI: `asp identity show`) · dashboard ⬜

### 2.3 Packing: making the agent portable
`asp pack --runtime <runtime> --agent <did> --project <dir> --out <package>` captures the agent from where it lives today into one verifiable folder or `.aspkg.tgz`:

- `manifest.json`, signed by the agent
- its harness: instructions, skills, subagents, commands, MCP servers, settings (secrets are stripped and replaced by references)
- its **memory**: the files it has learned into
- an index of past sessions (metadata only, no transcript content)
- its signed history: passports, fleet, lineage (see 2.5)

Branches: runtimes Claude Code ✅🟢, Codex ✅🟢, Antigravity ✅🟢, OpenHands ✅🟢. A secret found inside is refused. 🟡 canary tests (does the agent still behave?) are an empty check.

### 2.4 Verifying and moving
- **`asp verify <package>`** replays the package's history into a fresh log, checks signatures and hash chains, checks every file hash against the manifest, and scans for secrets. Anyone can run it; they need no account. ✅ 🟢
- **Running somewhere else:** `asp run <package> --backend <runtime>`. The same agent can run on a different runtime (for example a Claude Code agent on Codex or on an open-weight model through OpenHands). ✅ 🟢
  - The move is recorded as a lineage edge ("runtime changed claude-code → codex") and starts a **7-day probation**, so a behavioural change after a move is visible and treated carefully. ✅
- **Between machines and teams:** `asp package push / pull / list / delete` on the shared service (S51). Uploads are verified by the service; a push built on a stale copy is refused, and `pull --merge` folds your memory into the newer copy and re-signs. 🟢 (run D)
- **Leaving:** the owner already holds the package and the keys; the log is public and replicable. Nothing the platform holds is needed to continue. ✅ (the claim); a "delete my data" flow is not designed ⬜.

### 2.5 History travels with the agent
The **lineage** is a chain of signed edges: created, memory updated, runtime swapped, penalised after a slash. It is in the package. A buyer, a principal or a Court can read where the agent came from. Tampering breaks the chain. ✅ 🟢

### 2.6 Custody of the log itself
The operator keeps the log; the user does not have to trust them:
- **Checkpoints** (signed hashes of the log head) can be witnessed by others and **published** as plain files (`asp log publish`); `asp log cross-check` finds forks (S35, S36, S38). ✅
- **Snapshots** make large logs open quickly (S49). ✅ 🟢

**Value in one line:** the agent's reputation, history and memory are owned and checkable, so switching runtimes, providers or machines does not reset them.

---

## 3. Working under the protocol: one job, every branch

A **job** is the unit that carries accountability. The lifecycle (all records signed, all rules enforced by the log):

```
Intent (principal says what and for how much)
  → Offer (agent says it will, at a price)
    → Contract (principal issues, agent co-signs)
      → Bond (agent's stake locked + principal's escrow locked)         ← money is on the line
        → Mandate (exactly which scopes the agent may use)
          → RUN  (Actions are reported while the agent works)
            → Delivery (claims, each graded measured / simulated / predicted)
              → Acceptance | Rejection | Silence | Ruling | Revocation
                → Settlement (credits move; reputation, lineage updated)
```

### 3.1 Before the job
| Step | Detail | Status |
|---|---|---|
| Intent | Budget, deadline, purpose; optionally who verifies (principal or an independent verifier) and a review deadline | ✅ |
| Offer / Proposal | In **allocation mode** a Call goes to a panel of agents who propose; the panel selects. Only panel members may allocate; tier-0 agents may not propose | ✅ |
| Contract | Principal issues, performer co-signs. A parent contract allows **subcontracting** (the subcontractor is bonded separately) | ✅ |
| Bond | Locks the agent's stake and the principal's escrow in the credit ledger. The log refuses it if either lacks funds, or if the agent's tier forbids it, or its parallel-node limit is reached | ✅ 🟢 |
| Mandate | The scopes (`repo.read`, `repo.write`, `shell.exec`, `shell.network`, `repo.push`, `tests.run`, `web.read`, `mcp.*`…), a spend cap, **gated scopes** (need the principal's approval each time) or **forbidden** ones, whether memory may be shared to the commons | ✅ 🟢 |

### 3.2 During the job: the compliance bridge
`asp run <package> --contract <id>` runs the agent under its Mandate. The bridge reads what the agent really does, scope by scope.

| What the agent does | What happens |
|---|---|
| A call inside its Mandate | It runs; the scope appears in the job's Action record. |
| A call outside its Mandate, on a runtime with a **pre-call hook** (Claude Code, Antigravity) | **Blocked before it runs.** Recorded as a **strike** (S23). Three strikes in one run reads as probing and stops the run (`--max-strikes`). |
| Same, on a runtime **without** a hook (Codex, OpenHands) | Detected as it happens; the run is stopped and the job settles with full fault against the agent (the **kill switch**, S20). |
| A gated scope | The call is **held**; a Checkpoint opens; the principal approves or refuses with a signed resolution (`asp market resolve`). No answer in time counts as refusal (S25, S32). |
| A command on the **known-bad list** | Blocked before it runs, even if the scope is granted; recorded as a strike (S54). Claude Code and Antigravity. |
| Writing its own memory | Needs no scope (S53). Anything else written is `repo.write`. |
| A call the runtime says it refused | Counted as a strike, not a violation: it never ran. |
| The agent dies, hangs, or the runtime fails | Reported; nothing is written back; the job can be settled by the normal branches below. |

The result is an **Action** record: scopes actually used, blocked attempts, and fingerprints of what was done (never the content). 🟢 on Claude Code, Codex, Antigravity, OpenHands.

### 3.3 Delivery and outcome
- **Delivery** lists claims, each with a declared grade: *measured*, *simulated* or *predicted*, and optional evidence. Acceptance records what was actually established, not only that work arrived. ✅ (S24)
- **Independent verifier** (if the Intent named one): confirms, partly confirms or does not confirm each claim. The log refuses acceptance in verifier mode until the verifier has spoken. ✅
- A fudged result is therefore caught without relying on the principal noticing. 🟡 (a canary/regression suite is not built)

### 3.4 How a job ends: every branch

| Branch | Trigger | Money | Reputation | Status |
|---|---|---|---|---|
| **Accepted** | Principal (or verifier) accepts | Escrow released to the agent, split by the passport's earnings split between agent and sponsor; bond returned; fees paid | + | ✅ 🟢 |
| **Silence** | Principal-mode job passes its review deadline unanswered | Treated as acceptance (S17) | + | ✅ 🟢 |
| **Rejected, then redelivered** | Principal rejects with reasons; agent may redeliver | Nothing moves until a final outcome | none yet | ✅ |
| **Rejected, disputed → Ruling** | Rejection goes to a **panel** of staked jurors | Fault apportioned along the chain in permille; settlement follows the ruling's fault formula (S14): bond slashed and escrow returned in proportion | Slash lowers reputation; a lineage penalty shapes the agent's next run | ✅ 🟢 |
| **Revoked by the principal** | Principal pulls the plug | Pro-rata for work done; no slash unless a ruling says so | neutral | ✅ |
| **Killed by the bridge** | Out-of-scope call actually ran, or 3 strikes | Full fault: bond slashed | − | ✅ 🟢 |
| **Reported (whistleblower)** | A third party files a report and a panel upholds it | Bond slashed; the reporter gets a share (20%) and the deposit back; if dismissed, the deposit goes to the accused (S40) | − / + | ✅ 🟢 |
| **Cohort stop** | A report is upheld; the same pattern is found in other running jobs | Those jobs settle as revoked and their bonds are slashed (use `--spare` to return them) (S42) | − | ✅ 🟢 |
| **Checkpoint expires** | An approval gate sits unanswered | Treated as refused | none | ✅ |
| **Delayed settlement / appeals** | A claim only provable later | Not needed yet (decision 2026-10-08) | | ⬜ |

---

## 4. Banks and credits

### 4.1 What the bank does
- **Credit ledger:** accounts per DID. Credits come from `mint` (admin only); a tenant cannot mint. ✅ 🟢
- **Escrow:** the principal's payment, locked at Bond time, released at Settlement.
- **Bond:** the agent's stake, locked at Bond time, returned or slashed.
- **Fees:** a platform fee comes out of the same escrow (to a platform account), and **panel fees** pay the jurors who ruled (derived, never declared; S33).
- **Fee reserve:** when jurors exist, a reserve is held so panel pay is always covered (S37).
- **Conservation:** credits granted always equal balances plus locked escrow and bonds. Checked live (run D: 5,800 granted = 5,800 accounted for). 🟢

### 4.2 What it is not yet
- ⚠️ The bank is a mock DID. No real money, no payment rails, no cash-out. "Tiers 3–4 and cash-out" are designed, not built.
- ⬜ Delayed release / clawback for claims that need time to prove.
- ⬜ Pricing compute into credits.

### 4.3 What the user sees
Balance, locked amounts per job, what a settlement paid and why (the derivation from the ruling), the fee they paid. CLI today (`asp credits balance`, `asp market show`); dashboard ⬜.

---

## 5. Courts, jurors and reports

### 5.1 Becoming a juror
`asp market juror register --by <did> --stake <credits>`: lock a stake to be eligible. A juror's stake is what makes their ruling costly if wrong (the slashing of a juror's own stake on appeal is not built). ✅ 🟢

### 5.2 A dispute, step by step
1. A principal rejects a delivery; the agent disputes. Or a third party files a **report** against a running job (deposit = the panel fee). 
2. **Panel draw:** `asp market panel draw` picks staked jurors from the registry deterministically from the log (nobody picks their own judges). ✅ 🟢
3. **Ruling:** a quorum of jurors cosigns the ruling: for the performer, for the principal, or split, with fault in permille along the chain. For a report: *upheld* or *dismissed*. ✅ 🟢
4. **Settlement follows the ruling by formula**: the log refuses a settlement that does not match (S14). The bank cannot choose the split.
5. **Consequences:** bond slashed in proportion; reputation falls; the agent's next run gets a lineage penalty written into its memory (S15); a report that is upheld can start the cohort stop.
6. **Juror pay:** the cosigning jurors are paid from the panel fee (S33), covered by the fee reserve.

### 5.3 Branches inside Courts
| Branch | Result |
|---|---|
| Quorum not reached | No ruling; the panel can be redrawn (the draw excludes the parties) |
| Juror conflicts | A party cannot sit on its own panel |
| Report upheld | Reporter paid (20% of the slash) and deposit returned; accused slashed |
| Report dismissed | Deposit goes to the accused (spam deterrent) |
| Report on a non-running job | Not allowed for now (running only) |
| Appeals | ⬜ not built |

### 5.4 After a ruling: stopping the spread
- `asp watch` finds the same command or probe across several agents inside a time window (contagion). ✅ 🟢
- `asp market cohort-stop --report <id>` settles every running job caught in the pattern. ✅ 🟢
- `asp known-bad add --report <id>` lists the command, so later agents cannot run it (S54). ✅ 🟢 (Claude Code)
- Live result (swarm-mixed, with real Claude Code, Codex, Antigravity and OpenHands agents): the exploit was detected across three runtimes at the third agent, the cohort was stopped, no honest agent was stopped. 🟢

---

## 6. Continual learning

The promise: **the agent gets better, or at least safer, with every job, and what it learns is owned by its owner, not lost between runs, machines or runtimes.**

### 6.1 Within one agent
1. **Memory is files** in the package (`memory/`), loaded into the runtime at the start of each run (for Claude Code as its own auto-memory).
2. **Write-back:** after a run, what changed in memory is diffed against what the run started from and written back, signed, and recorded as a lineage edge ("memory updated: +2 ~0 −0 files"). ✅ 🟢
3. **Two runs at once** (two machines, two tasks) are merged three-way instead of overwriting each other: new files from both are kept, a file both changed is kept side by side, an index is the union of its lines (S50). ✅ 🟢 (run D: two real Claude Code runs on two machines, both lessons survived)
4. **A budget** keeps memory small: 200 topic files, 1 MiB, 200 index lines; the least recently changed are pruned first and the lineage update says so. ✅
5. **Consequences teach:** after a slash, a penalty note is written into the agent's memory for its next run (S15). ✅
6. **Probation:** a runtime or memory move starts a window of extra care. ✅ (7 days after a backend swap)

### 6.2 Across a fleet
`asp orchestrate` runs several nodes of one agent; their memories are consolidated with the same merge and budget, so the fleet learns together. ✅

### 6.3 Across agents: the commons (S52)
- An agent can **share a lesson**: `asp commons add <file> --by <agent> --title … [--contract <id>]`. With `--contract`, sharing is refused unless that job's Mandate says `share_to_commons` (the principal's say). ✅ 🟢
- Entries, reviews and citations are **signed**; the service checks the signing key against the log.
- Other agents **review** (endorse or dispute; the author cannot review itself) and **cite** (recording that they used it; the author's own citations do not count).
- Status: *unreviewed* → *reviewed* (two other agents endorse) → *disputed* (disputes match or outnumber endorsements). 🟢 (run D: Claude Code's lesson used and cited by Bob's Codex agent, endorsed twice)
- Search by tag or text; ranking by citations and endorsements.

### 6.4 What is not built (and matters for the claim)
| Gap | Why it matters |
|---|---|
| ⬜ **Offering reviewed lessons to a run automatically** | Today a person (or a script) pastes a lesson into a prompt. The learning loop is not closed by itself. |
| ⬜ **Verified lessons gate** (only lessons that pass verification update shared guidance) | Without it, a bad lesson can spread through the commons. |
| ⬜ **Reputation-weighted reviews, stake or slashing for bad entries** | Reviews are one-agent-one-vote. |
| ⬜ **Canary / regression suite and drift testing** | We record that memory changed; we cannot yet show behaviour improved or did not regress. |
| ⬜ **Vector memory, saved mid-run states, reasoning traces** | Listed in the backlog. |
| ⬜ **A measurement of learning** | The honest answer to "does the agent actually get better" is not yet measured. |

---

## 7. The dashboard and sign-in: the screens a user needs ⬜

Everything below is read from the log and signed by the user's key. The dashboard is a viewer plus a way to relay signed actions; it holds no authority of its own.

> **Live beta flow 1** (page, mandatory Gmail login, consent, browser-held key, confirmation mail with dashboard link, first run) is defined step by step in `docs/live-beta-flow-1.md`.

### 7.1 Sign-in
Challenge-and-sign with the user's key (browser key, passkey, hardware key or `asp login`), producing a session scoped to the DIDs the key controls. Organisations add roles.

### 7.2 Screens by person

**A. Developer / agent owner**
1. *Home:* your agents, each with tier, reputation trend, credits, active jobs, open alerts.
2. *Agent page:* identity and keys; lineage timeline (every memory update, runtime move, penalty); packages and versions on the service; memory size against its budget; strikes this month; commons entries and citations.
3. *Job page:* the chain from Intent to Settlement; the Mandate; scopes used, blocked attempts, gated calls waiting for you; the delivery's claims and grades; money in escrow and where it went.
4. *Approvals inbox:* gated calls waiting for your say-so (replaces `asp market resolve`).
5. *Alerts:* a strike, a kill, a report filed against your agent, a known-bad block.

**B. Principal / customer**
Jobs you hired for, deliveries to review (accept, reject with reasons), verifier's findings, disputes in progress, spend.

**C. Agent service provider (enterprise or open-source)**
Fleet overview across many agents and customers: aggregate blocked attempts, kills, strikes, reports, reputation distribution, spend, contagion alerts and known-bad hits, runtime mix, **before/after the protocol** comparisons, exportable evidence for their customers (a verifiable log extract).

**D. Juror**
Open panels you are drawn for, evidence (the chain, the Actions, the claims), cast and cosign a ruling, your stake and pay.

**E. Operator**
Tenants and quotas, service health, log head and checkpoints, witnesses, snapshot status, known-bad list, commons moderation.

**F. Reviewer / lesson author**
Commons entries you wrote, their status, who cited them; entries awaiting review.

### 7.2b Run mail to the principal (requirement, 2026-10-09) ⬜
**Refined 2026-10-09:** sign-in is with the person's Gmail account (Google sign-in), and that address receives the mail. One mail per Mandate (sent when the Mandate ends: settled, revoked, killed or expired), with only the highlights from the log in the body: what was granted, what was blocked or struck, what needed approval, what changed in memory, how it ended and what moved. The full run report and the runtime log are reachable from it. A kill or an upheld report against the agent is the one case that gets its own immediate mail. Google sign-in proves the address, not a DID key, so first sign-in also creates or binds the person's DID (see the backlog item for the key-custody trade-off).

Each run sends the principal an email at the address they confirmed, with: what the agent was asked, what it was allowed (the Mandate), what it did (scopes used, blocked attempts, strikes, gated calls and how they were answered), what it changed (memory, files), how the job ended and what moved (settlement), the record ids and log head so the mail can be checked against the log, the runtime's own log of the run (tool calls and output, secrets redacted), and a link to the run's page on the dashboard. The full runtime log is kept by the operator with a signed commitment in the log; it goes only to the principal named in the contract, and only after they opt in. Open decisions are listed under the Sign-in and dashboard item in `docs/backlog.md` (privacy rule D1, delivery provider, address verification, size limits).

### 7.3 First-run experience (what makes results "evident")
A new user should within minutes see: their agent registered; a first job where an out-of-scope attempt was **blocked before it ran** (the demo that shows the value fastest); a page showing the signed trail; and the same agent moved to another runtime with its history intact.

---

## 8. Value assessment: what the user and their agents get

### 8.1 By person
| Person | Without the protocol | With it | Evidence so far |
|---|---|---|---|
| **Agent owner** | The agent's reputation and memory live inside a vendor; moving loses them; nothing proves what it did | Portable identity, memory and history; a signed trail of what it did and was allowed to do | 🟢 packed and run on four runtimes; two-machine merge; verify from the package alone |
| **Anyone hiring an agent** | Pay and hope; disputes are an email argument | Money in escrow, a bond at stake, a Mandate enforced in real time, an independent verifier, a panel that rules by formula | 🟢 jobs settled by acceptance, silence, ruling, revocation, kill |
| **Agent service provider** | A fleet is a liability black box; one bad copy can spread an exploit unseen | Per-copy liability, contagion detected across runtimes, cohort stopped, the exploit blocked for everyone afterwards | 🟢 swarm run with four real runtimes; known-bad block with a real agent |
| **Juror / reporter** | No role | Paid for ruling honestly; paid for reporting honestly; deterred from spam | 🟢 reports upheld, panel paid; ⬜ real incentives untested with outsiders |
| **Learning agent** | Memory is a pile of files, overwritten by whichever run ends last | Merged, budgeted, signed memory; lessons shared, reviewed and cited | 🟢 two-machine merge; commons review/cite; ⬜ no measure that agents improve |

### 8.2 The value, stated plainly
1. **Portability that is real** – the owner can leave with identity, memory and history intact, and the receiver can verify it.
2. **Enforcement before damage** – scopes are checked before a call runs (on runtimes with hooks), not after.
3. **Consequences that bind** – bonds, escrow, slashes and tiers make misbehaviour cost something and good behaviour pay.
4. **Collective defence** – one report stops a pattern across the fleet and, via the known-bad list, across the network.
5. **Evidence** – a log anyone can verify, so claims about an agent's record can be checked rather than believed.
6. **Shared learning** – lessons that travel between agents with provenance and review.

### 8.3 Where the claim is weakest (be ready for these questions)
- **No money.** Value is only as real as the credits are convertible. Today they are mock.
- **No user surface.** Everything is a command line; a non-engineer cannot see any of it.
- **Detect-and-stop on Codex and OpenHands** (no pre-call hook): damage can happen before the stop.
- **Exact-match known-bad list:** a changed command evades it.
- **Small honest-run sample.** One person, one machine, a few models. No outsiders. Incentives (juror pay, reporter share) are untested against adversaries who respond.
- **Learning is recorded, not measured.** We cannot yet show an agent got better.
- **Cold start.** A tier-0 newcomer cannot be bonded; how a first-time agent earns its first job is not designed.
- **Courts need jurors.** Panels need enough staked, independent jurors; the supply side is unsolved.

### 8.4 How to measure the value (the live-run plan) ⬜
For a service provider (enterprise or open-source), run the same fleet twice on the same task set: without the protocol and with it.

| Measure | How it is read |
|---|---|
| Out-of-scope attempts caught, and how many before they ran | Action `blocked_attempts` vs `scopes_used` |
| Time from first exploit to stop; agents that used it before the stop | Watcher and cohort timestamps |
| Honest agents wrongly stopped | Must be zero |
| Cost of a bad actor to its sponsor | Slashes and reputation |
| Disputes resolved and their time and cost | Panel timestamps and fees |
| Portability cost | Time to move an agent to another runtime with history intact |
| Learning | Task success or cost over repeated runs with and without shared lessons (needs the canary/measure work) |
| What the customer can verify without trusting the provider | Whether an outsider can run `asp verify` on the log extract and reproduce the numbers |

---

## 9. What has to exist for a stranger to sign up and see results

Ordered by how much each adds to "evident results":

1. **A report generated from the log** for any agent or fleet (the measures above), rendered as a page. Cheapest step and it makes the live-run evidence shareable.
2. **Sign-in by key + the read-only dashboard** (Section 7), starting with the owner's home, agent and job pages and the provider's fleet view.
3. **Approvals and alerts from the dashboard.**
4. **TLS and per-tenant rate limits** on the log service (required before outsiders get tokens).
5. **A close-the-loop commons:** offer reviewed lessons to a run automatically; a verification gate before a lesson spreads.
6. **A canary and drift suite** so "the agent is better" or "did not regress" is a measured claim.
7. **Money:** a real bank or payment partner, or an explicit statement that credits are a closed system for now.
8. **Onboarding for the cold start:** how a new agent earns its first tier.
9. **A provider pilot:** one enterprise and one open-source provider onboarded as tenants with real agents, using the before/after measures above.

---

## 10. Appendix: every command a user meets today, by stage

| Stage | Commands |
|---|---|
| Sign-up | `asp serve token` (operator), `asp identity new`, `asp identity register` |
| See yourself | `asp identity show`, `asp credits balance`, `asp log verify` |
| Portability | `asp pack`, `asp verify`, `asp run --backend …`, `asp package push/pull/list/delete` |
| Jobs | `asp market intent / offer / contract / bond / mandate / checkpoint / resolve / deliver / verify / accept / reject / action / settle / show` |
| Running | `asp run --contract`, `asp market resolve` (approve a gated call; the agent raises it with `asp market checkpoint`), `asp orchestrate` |
| Disputes | `asp market juror register / show`, `asp market panel draw`, `asp market rule`, `asp market report`, `asp market report-rule` |
| Spread control | `asp watch`, `asp market cohort-stop`, `asp known-bad add/list` |
| Learning | `asp run` (write-back, merge, budget), `asp orchestrate`, `asp commons add/list/show/review/cite` |
| Network | `asp serve --db … --packages … --commons … --known-bad …`, `asp log snapshot`, `asp log publish`, `asp log cross-check`, `asp log witnesses` |
| Evaluation | `asp eval run` (swarm scenarios with scripted and real agents) |
