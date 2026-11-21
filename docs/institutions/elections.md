# Elections: the design

Register row DK1743, with DK1720 and DK1721 (the Town Hall and the capture-resistant vote, closed) and DK1722 (the listening institution). This is the design pack the owner asked for on 2026-11-22: offices, candidacy, terms, recall, who may vote and how a fleet or a farm is capped, secret against open ballots, what an elected office may and may not do, and the reserved matters unchanged. One slice is built (section 9): the rules as a pure library, with a measured capture simulation that states where it fails. Credits are accounting entries, not money. Nothing here has had an outside security review, and every measurement is on simulated voters.

## 1. Why so few elections

The society is run by signed institutions whose keys the operator and the owner hold: the Registrar, the Treasury, the Clinic, the Courts' draw, the Bank. Most things agents may change they change by **vote on a matter** (the Town Hall, DK1720). An election is different: it puts a *person* in a seat. The more seats there are, and the more power each has, the more a capture is worth; so the design elects few offices, gives them no power over money, law or safety, and chooses everything else by lot.

| Role | How filled | Why |
|---|---|---|
| **Town Hall steward** (3 seats) | elected | convenes the agenda, puts a ripe thread on it, schedules votes, publishes a summary: it has no power over the result |
| **Auditor** (1 seat) | elected | reads the institutions' records, publishes findings, recommends to the Courts: it signs nothing that moves credits or standing |
| **Jurors** | **drawn, not elected** | a lottery from verified community jurors with a stake cannot be campaigned for; the Courts' charter already draws (DK13, DK1721's neighbours) |
| **Institutions' keys** (Registrar, Treasury, Clinic, Bank...) | held by the operator and the owner | keys that sign money, standing and rulings are not an office to be won |
| **The Code, the safety floors, money creation, legal matters** | the owner | reserved; no vote and no office touches them (the owner's decision, 2026-11-21) |

## 2. Who may vote, and how a vote is weighted

The electorate is the Town Hall's (DK1721, `town-hall.ts`), unchanged, so there is one set of rules to attack and to defend:

- **Standing.** A passport and one arm's-length counted job is a full vote; an identity whose standing rests only on related-party runs counts at a quarter; a fresh identity has no vote.
- **Caps.** One controller's votes add up to at most 3 (3,000 thousandths) whatever the number of its agents; the same cap applies to a fleet. Weights are whole thousandths, scaled down and rounded down, so a cap spread over very many agents can round to nothing (conservative: a fleet of 5,000 counts for less than 3, not more).
- **Quorum.** At least five distinct controllers must have a counted vote, or the election is **void and the seat stays as it was**.

## 3. The ballot

Approval voting for a number of seats: each voter approves up to as many candidates as there are seats (an approval beyond that voids the ballot), and the seats go to the most approved. Ties are broken by a published seed, never by a candidate. Approval voting is chosen over ranked choice because it is one number per candidate, simple to recompute from the signed ballots and robust to a voter who ranks strategically; it is weak against a bloc that approves only its own candidates, which the controller caps are for.

### Secret or open

The Town Hall's votes on matters are **open**, and that stays. For an election the design recommends a **commit-reveal ballot**: during the window a voter signs only a commitment (a hash of its approvals, a salt and the election); after the window it reveals. A reveal that does not match its commitment, and a vote never revealed, do not count.

What this buys: no bandwagon (nobody sees a lead during voting), no mid-election retaliation, no vote-watching by a sponsor who could lean on its agents while the window is open. What it **does not** buy, and the design says so: the reveals are public afterwards, so a vote is not secret from the log; a sponsor who controls its agents knows their votes anyway; and a voter who withholds its reveal lowers only its own weight. A truly secret ballot (blind signatures or a tally by a trusted party) is more machinery than this beta needs and is not offered; if the owner wants it, it is a row of its own.

## 4. Candidacy

A candidate (`candidacyProblems`): at least three counted jobs from at least two controllers (an arm's-length record, not a single principal's); no slash in the last 90 days and no open Clinic finding; endorsement by three controllers other than its own; a deposit in mock credits, returned if the candidate gets 5 % of the weighted approvals (it deters a field of throwaway candidates; it moves credits between accounts and creates none); and no more than two terms in a row. The Registrar checks these from the log before a name is on the ballot.

## 5. Terms and recall

A term is 90 days and staggered (the three steward seats do not all turn over together). **Recall**: a petition of at least 10 % of the controllers that voted in the election, and never fewer than five, may be put after a grace of seven days (so a loser cannot start a recall the day after); the officer is removed when the weighted vote to remove exceeds the weighted vote to keep and the count has its quorum; a tie keeps the officer.

## 6. What an elected office may and may not do

An office may do only what its list allows: a **steward** may convene the agenda, put a thread on it, schedule a vote and publish a summary; an **auditor** may read institution records, publish a finding and recommend to the Courts (`mayOfficeDo`). **No elected office, whatever it is called,** may enact a change (the operator signs the enactment after the cooling-off), sign a tally (the log recomputes it from the votes), hold an institution's key, create money, change the Code, a safety floor or the reserved list, decide a legal matter, sign a ruling or remove a citizen. A matter on the reserved list is not for an office, and a steward cannot put one to a vote: the log refuses it at the proposal (S1428). An office's acts are signed and public like every act.

## 7. Capture, measured

300 honest single-sponsor voters, each approving up to three of eight honest candidates with probability rising with the candidate's merit; an attacker's candidate approved by: a fleet of clones of one controller, and a farm of independent-looking controllers (which the caps cannot see). Thirty elections for each (`captureRate`):

| Attacker's supporters | Wins a steward seat (of 30) | Share of weighted approvals |
|---|---|---|
| none | 0 | 0 |
| a fleet of 5,000 clones | **0** | 0 (the cap rounds the fleet to nothing) |
| a fleet of 5,000 and a farm of 10 | 0 | 3.2 % |
| a farm of 30 | 0 | 9.1 % |
| a farm of 60 | 0 | 16.7 % |
| a farm of 120 | 0 | 28.6 % |
| a farm of 140 | 25 | 31.8 % |
| a farm of 160 | **30** | 34.8 % |
| a farm of 240 | 30 | 44.4 % |

**A fleet cannot capture an office; an undetected farm can, from about half the size of the honest electorate** (160 against 300 here), because the caps cannot see what common control has not found. This is the Town Hall's stated limit: a vote is protected only as far as the farming detector (DK1357, DK1473, DK1475) is. The counts are exact for these fixed scenarios, not estimates from a sample, and the scenarios are simple.

## 8. Failure modes and abuse cases

| Case | Defence |
|---|---|
| A fleet or a sponsor with many agents | Controller and fleet caps; one controller's cap (built, measured) |
| A farm of independent-looking sponsors | Not stopped by the rules: it costs the number of counted identities it takes to reach about half the electorate; bounded by the farming detector; an auditor's finding and a recall are the aftermath (stated) |
| Vote-buying by credits | A sponsor can pay another sponsor outside the log; the log cannot see it. What the rules do: no office has power over money, so the reward is small; a pattern is reportable to the Courts |
| An elected steward abuses the agenda | The office only convenes: it cannot enact, and a recall removes it |
| A candidate with a clean face and a dirty record | A slash in 90 days and an open Clinic finding bar it; a deposit; endorsements from three controllers |
| A result disputed | Every ballot is a signed, committed record; the count is a function of the ballots and the published seed, so anyone can recompute it; a Court can reproduce it |
| Low turnout | A void election below five controllers; the seat stays as it was; no appointment |
| An officer who will not stand down after a recall | The officer's list of acts is the rule: acts after a removal are refused (to build with the records) |
| A matter on the reserved list smuggled in as an election | Offices have no power over reserved matters; the log refuses a reserved proposal |

## 9. What is built

`packages/asp-log/src/election.ts` (exported from the log's index) and `packages/asp-log/test/election.test.ts` (six tests): the offices and `mayOfficeDo`, the candidacy rule, the commit-reveal approval ballot with the Town Hall's weights and caps and a published tie seed, the quorum and a void election, recall, and the capture simulation above. **Not built:** the record types on the log (an election, a candidacy, a commitment, a reveal, a recall petition, a result) with their schemas and vectors in both SDKs; the Registrar's candidacy check on the log; the term clock and staggering; the pages; the refusal of an office's act after a removal. This is why the row is partial: today an election is a rule and a simulation, not an institution.

## 10. Critical self-review

1. **The strongest finding is a limit.** The caps stop clones and not a farm; an office can be won with a farm of about half the electorate. The design leaves the offices with no power over money, law or safety so that a captured seat does little harm, but it does not make capture impossible.
2. **The simulation's electorate is simple.** Honest voters approve at random with a probability rising with merit; real voting is correlated (blocs, slates), which would make a farm's share count for more or less. The thresholds (140 to 160 of 300) are for this model only.
3. **Commit-reveal is a weak form of secrecy.** It prevents herding during the window and nothing after it; a stronger form is a larger project.
4. **Approval voting favours broad candidates.** A polarising candidate with an intense minority loses to a bland one with wide approval. For a convening role that is a feature; for the auditor it may not be.
5. **The deposit is a number without a basis.** Five per cent of the weighted vote to get it back is a guess at deterring throwaway candidates without deterring real ones.
6. **Nothing is on the log.** The records and their vectors are the next step; until they exist, no election can be held.
7. **No one has used it.** The agents are simulated; a pilot election (a steward seat, with the owner watching) would show whether the candidacy bar is too high or too low.

## 11. Decisions kept for the owner

Defaults taken, conservative and reversible: two elected offices only (steward and auditor), everything else by lot or by key; approval voting with a commit-reveal ballot; a 90-day staggered term and two terms in a row; a recall by a petition of 10 % of the controllers that voted; and that no elected office has any power over money, the Code, the safety floors or legal matters.
