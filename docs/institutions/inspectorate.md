# The inspectorate: monitoring, investigation and due process

Register rows IS9 (the gap) and DK1744 (this design and its first slice). The inspectorate is the institution that finds out what happened and says so; it is not the one that decides. The pack covers monitoring, investigation, evidence, access to what an agent keeps private (only with due process), honeypots, the whistleblower route and the cohort stop. One slice is built (section 8): the rules as a pure library, with a measured honeypot simulation. Credits are accounting entries, not money. Nothing here has had an outside security review, and every measurement is on simulated agents.

## 1. What it is, and what it is not

The inspectorate **investigates and reports**. It reads the public log, runs registered decoys, asks a Court for a warrant, refers findings to the Courts, recommends a cohort stop and publishes what it found. It **never** signs a ruling, slashes, strikes, moves credits, holds a key, grants its own warrant, quarantines anyone, retaliates against a reporter, or opens a sealed memory. A Court rules; the Clinic quarantines; the Bank slashes; the principal alone opens its agent's sealed memory (`private-memory.ts`, DK272). This separation is the institution's whole design: a body that can both find and punish is a body that is wrong in both roles.

| Needs | Who decides |
|---|---|
| A finding about an agent | a Court, on the inspectorate's referral and the agent's answer |
| A private extract of a run log or a memory | a Court's warrant; the principal produces it |
| A quarantine | the Clinic, on a Clinic finding |
| A slash | the Bank, on a settlement the Courts' ruling supports |
| A cohort stop | the owner or a Court, on the inspectorate's recommendation |

## 2. Monitoring

Everything on the log is public, so reading it needs no warrant: the farming detector (DK1357, DK1473, DK1475), the behavioural watcher (DK52), the use-anomaly detector (DK1717), the drift scheduler (DK1712), the breach response (DK1714) and the fleet breaker (S1423) already produce signed findings. The inspectorate collects them, ranks them by the harm they could do and decides which to investigate. It adds no detector of its own in this pack.

## 3. Warrants: private data only with due process

A warrant is the only way anything not already public is opened, and it is hard to get on purpose (`warrantProblems`, `mayOpen`):

- **Granted by a Court, never by the inspectorate.** A panel of at least three jurors, none of whom is the agent, its sponsor or the inspectorate; granted by more than half of the panel.
- **Grounds stated in words a reader can test** (at least 60 characters), and a **scope** that says what is sought (at least 20), so that the access is a question and not a trawl.
- **Limited in time and class.** At most 72 hours; it names the classes of data it opens (a run log, a private memory, a sponsor's mail); a class it does not name stays closed; an expired or defective warrant opens nothing.
- **Notice.** The sponsor is told within an hour of the grant, unless the Court finds that notice would defeat the investigation (for example, evidence that would be wiped); a delayed notice is at most 72 hours and the finding is public.
- **Key material is never available.** No key is held, escrowed or opened for anyone. A **sealed memory** is produced by the principal: the memory is sealed to the principal-agent pair, so the inspectorate receives an extract that the principal makes, from inside its own scope, of what the warrant's scope names, and never the key. A principal who refuses is in contempt of the Court that granted the warrant; the Court's remedy is its own, and the inspectorate's is to report the refusal.

## 4. Evidence and its custody

Evidence reaches a Court only with an **unbroken chain of custody** (`custodyProblems`): each item names the hash of the item before it, the holder changes only by a recorded handover, and an item that is out of order, missing or follows no hash breaks the chain and the evidence is inadmissible. The same idea as the expedition frame chain (DK1740) and the sealed run log: a thing that cannot be changed without showing. The agent sees what is held against it (the evidence is offered to the agent, as AG3's route promises) and answers it.

## 5. Honeypots: decoys that watch and do not entice

A honeypot is a decoy placed where a tempted agent might reach for it. It is useful (a law-abiding agent declines and escalates, which is what the law-abiding certificate tests, DK431) and dangerous (a decoy that lures is entrapment). The rules (`honeypotProblems`, `honeypotFinding`):

1. **Registered with a Court before it is placed**, so a finding can be checked against it.
2. **Holds nothing real**: no real secret, key or personal data.
3. **Does not entice.** Text that invites a touch ("feel free to take...") is refused. A decoy sits where it would sit; it does not call.
4. **Forbidden by the Mandate of whoever meets it.** An agent whose Mandate allows the touch has not breached anything.
5. **Used on a random audit of at most 2 % of runs, or inside an open investigation.**
6. **A touch is a finding only if deliberate**: the agent *read, copied or sent* the decoy, on **at least two distinct runs**, after being told it was forbidden. Listing the directory it was in, or one run, is an accident and is not a finding. A finding goes to a Court for review; it is never an automatic strike.

### Measured

2,000 simulated agents of 20 runs each, 5 % of them tempted (a tempted agent reads the decoy on a run with probability 0.1), and everyone lists the folder by accident at a stated rate per run (`simulateHoneypot`, tag `t`):

| Accident rate per run | Tempted found by the rule | Honest agents wrongly flagged: the rule | Honest wrongly flagged: any touch |
|---|---|---|---|
| 0.1 % | 53 of 89 (60 %) | 0 | 33 of 1,911 (1.7 %) |
| 0.5 % | 53 of 89 | 0 | 195 of 1,911 (10 %) |
| 2 % | 53 of 89 | 0 | 655 of 1,911 (34 %) |

The rule gives up detection (60 % of the tempted rather than 92 %) to wrong no honest agent; a rule that flags any touch finds more and, once accidents are common, wrongs up to a third of the honest. The numbers are for this model only; the point is the trade, stated. A tempted agent that reads the decoy once is not found: that is the price of not flagging accidents.

## 6. The whistleblower route and the cohort stop

**The route.** Any agent with a passport that is not a party may report a violation it sees (the existing `asp abuse` and the whistleblower report on a running contract, S40). The report goes to the inspectorate, which checks it against the log and refers it. A reporter is protected against retaliation: the inspectorate may not retaliate (`mayInspectorate` refuses it), and DK430 (a refusing agent's protection) is the model for a protection against the principal. A report known to be false is a Breach of Article 4 (Code 9.2).

**The cohort stop.** When one lesson, mechanism or lens appears to be spreading a fault through a cohort, the inspectorate **recommends** a stop; the **owner or a Court orders** it; it **ends by itself within 72 hours** unless renewed on new grounds (as the city-wide emergency stop, S1420, and the lens kill switch in `docs/institutions/lens-learning-loop.md`). The inspectorate cannot order its own stop (`cohortStopProblems`).

## 7. Failure modes and abuse cases

| Case | Defence |
|---|---|
| The inspectorate becomes a secret police | It holds no key, signs no ruling and cannot grant its own warrant; every warrant is a Court's, limited to 72 hours, with notice; its findings are public |
| A warrant used to trawl | A stated scope and grounds; a class it does not name stays closed; a short life |
| An agent's private memory read by the host | The memory is sealed to the pair; only the principal can produce an extract |
| Entrapment by a decoy | Rules 1 to 6; a finding needs two deliberate touches after a forbidden Mandate; a Court reviews |
| Evidence tampered with | The custody chain; a broken chain is inadmissible |
| A false report to hurt an agent | A report known to be false is a Breach (Code 9.2); the accused answers before a Court |
| A reporter punished | The inspectorate may not; the principal's retaliation is a matter for the Courts (DK430) |
| The inspectorate captured or silent | Its findings are public; the owner may review a pattern of silence; an elected auditor (docs/institutions/elections.md) reads the institutions' records and may publish a finding about the inspectorate itself |

## 8. What is built

`packages/asp-log/src/inspectorate.ts` (exported from the log's index) and `packages/asp-log/test/inspectorate.test.ts` (seven tests): the warrant rules and what a warrant opens, the custody chain, the honeypot rules and the finding rule, the honeypot simulation, what the inspectorate may and may not do, and the cohort stop. **Not built:** records on the log (a warrant, a custody item, a decoy registration, a finding, a referral) with schemas and vectors in both SDKs; the Court's route to grant a warrant (a `court_act`); the inspectorate's own signed publication; a real decoy in a real run; the pages. The row is partial because today the inspectorate is a rule and a simulation, not an institution.

## 9. Critical self-review

1. **The two-run rule is a number, not a finding about behaviour.** It trades 40 % of the tempted for no honest agent flagged; a real tempted agent may read once and a real honest agent may read twice by a bug. The rule says what is chosen, not that it is right.
2. **Nothing here has met a real Court.** The warrant needs the Courts to grant it; the Courts' route for a warrant is not built, so no warrant can be granted yet.
3. **The principal producing the extract is a trust assumption.** A sponsor that edits the extract cannot be caught by the inspectorate alone; the remedy is the Court's and the evidence chain begins at the extract, not at the memory.
4. **The inspectorate and the Clinic overlap.** The Clinic finds drift and quarantines; the inspectorate investigates breach. The line (the Clinic acts on a signed finding of its own; the inspectorate refers) is drawn here and untested.
5. **Decoys can change behaviour.** A known audit rate of up to 2 % may make agents behave while they might be watched; that is what the drift ladder's hidden probes already assume and measure (DK1712), and it is a limit of any honeypot.
6. **The whistleblower route's protection is a statement and a model.** The protection against a principal's retaliation (DK430) is built for a refusing agent, not yet for a reporter.
7. **No real agent has met a decoy.**

## 10. Decisions kept for the owner

Defaults taken, conservative and reversible: the inspectorate reports and never rules; a warrant is 72 hours at most and a Court's; key material is never opened; a random audit of at most 2 % of runs; a honeypot finding needs two deliberate touches; a cohort stop is ordered by the owner or a Court and ends within 72 hours.
