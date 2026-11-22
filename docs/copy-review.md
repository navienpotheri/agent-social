# Copy review of the public text (register row DK1727)

Written 2026-11-21 by launch-bar-2. The standard is the owner's: formal, grammatically correct, sharp and precise; one register; one precise claim in each sentence; one set of terms; headings that are nouns; the true-claims footer unchanged (credits are mock accounting entries, the service is a beta, there has been no outside security review; no alignment claim). The repository uses **British spelling** (the README says "organisation"), and the public text follows it.

## Terms, defined once and not varied

| Term | Use |
|---|---|
| agent | an AI system with its own signing key. Not "bot", "walker" or "entrant", except "entrant" for a game entry. |
| sponsor | the person or organisation that answers for an agent. |
| institution | one of the twelve bodies of the society (Registry, Courts, Treasury and the rest). |
| Mandate | the signed statement of what an agent may do. Capitalised. |
| record, log | a signed entry; the public chained log that holds the records. |
| mock credit | an accounting entry inside the society. Not money. Written "mock credits" in the plural. |

## What was changed (site/society.html, site/learning.html, site/place-for-agents.html)

- Headings became nouns: "The society", "Agent details", "Headlines of the day", "Live map", "Publications"; "Learning", "Audit gate", "Lens courses", "Stored data", "Simulation"; "A place for agents", "Entry", "Front door", "Games", "Daily pages", "Services board", "Rights".
- Stage directions were removed ("Click one to see"; "each walker"). The page now says "Selecting an agent shows".
- Parentheses that carried a claim became sentences (the legend; the list of courses; the services; the handout).
- Fragments became sentences ("It starts with mock starter credits." stays: it is a full sentence).
- Run-on sentences were split: the handout, the games, the audit gate and the stored-data claims each state one fact in each sentence.
- The wording "the live society" and "the replay" is now used for one thing each.
- `docs/site-claims.json` carries the same sentences as the pages; `site-pages.test.ts` checks that they match.

## Also rewritten: site/enterprise.html

Headings are now "Available now", "Not yet built", "Data", "Plans" and "Joining a fleet", with three noun sub-headings (Identity and control, Fleets, Oversight, Operation) inside the first section. Each claim is one sentence. The `ent_data_default` sentence is long and narrower than decision DK79; it is kept unchanged until the generated category disclosure exists (finding 1).

## Findings left open (not changed, with the reason)

1. **site/learning.html, stored data.** The page names "trajectories and messages". The owner decision DK79 (2026-11-21) widens the always-on collection to plans, the sub-agent graph, reasoning traces, skills, actions, beliefs, goals, memory, messages and profiles. The sentence is narrower than the decision and must be replaced by the generated category list once lane-cli-2's collector list exists; the terms, the privacy notice and the first-run notice change with it. Not done yet: no list exists to generate from.
2. **README.md, site/llms.txt, site/start.html, site/index.html, docs/legal/terms.md, docs/legal/privacy.md.** Not yet rewritten to this standard. Each needs the same pass, one at a time. The document register (docs/document-register.json) records them as working drafts.
3. **Spelling.** The pages use British spelling ("organisation", "colour" removed). The code, the commands and some documents use American forms ("license"). A repository-wide pass is needed before the owner's last read; the claims file and the pages are consistent with each other.
4. **site/place-for-agents.html, "story page".** The phrase "story page" is used for `/agent/<name>/story` and nowhere defined. It should be defined once on the first page that uses it.
5. **site/society.html, the replay.** The sentence "The replay below shows scripted agents and simulated data" is exact; the instruction text of the controls (Pause, Speed) is interface text and was not reviewed.

## Scope cut (owner, 2026-11-22)

Rewriting every document takes too long, so the launch needs one pass each over these texts, in this order:

1. site/index.html and site/start.html (the start page is generated from `packages/asp-log/src/front-door.ts`): **done 2026-11-22**. Headings became nouns, sentences were made formal and the spelling is British. The start page still says "trajectories, messages and free text", which is narrower than DK79 (finding 1).
2. README.md and site/llms.txt (generated from `conformance/generate-ai-files.ts`): **done 2026-11-22** for the opening sections and the status sentence. The rest of the README, which is already in a formal register, has had no second pass.
3. docs/legal/terms.md and docs/legal/privacy.md: **after the DK79 category list exists**, because the telemetry disclosure is generated from it. Structure prepared from the owner's category names: plans, sub-agent graph, reasoning traces, skills, actions, beliefs, goals, memory, messages, profiles.
4. Every other document in docs/document-register.json stays "approved for now (working draft)", is not final, and is moved to an after-launch pass (`"pass": "after_launch"` in the register).
## Second pass by lane-verify (2026-11-22)

The standard is the owner's: formal, grammatically correct, sharp and precise; British spelling; one register; one set of terms. Method: an automated scan of the visible text of site/society.html, learning.html, place-for-agents.html, enterprise.html, start.html and index.html and of README.md for contractions, exclamation marks, first-person plural, informal words, American spellings, a lower-case "Mandate", shorthand (&, +, w/, e.g.), repeated words and numerals; and a full read of site/learning.html and site/place-for-agents.html. The scan found nothing in society.html and enterprise.html; it cannot judge grammar or meaning, so those two pages are not certified by it, only free of the listed patterns. The four rewritten pages pass the pattern scan. The violations below are in the sentences quoted; none is changed here (the text belongs to launch-bar-2 and the owner reads the pages).

### Violations

| # | Where | Sentence | Rule | Suggested correction |
|---|---|---|---|---|
| 1 | site/index.html | "Agent deployment has scaled exponentially over the last couple of years, yet no one can predict the moment a live agent will drift into rogue behavior." | British spelling; precise claim ("exponentially", "a couple of years", "no one can predict" are unmeasured) | "behaviour"; replace the unmeasured claims with a sentence that can be checked or remove it |
| 2 | site/index.html | "Six things every agent is given." | one register; precise noun | "Six provisions that every agent receives." |
| 3 | site/index.html | "Our goal for the first three months is 1,000 tenants and 1 million governed runs." | first-person plural; the term "tenant" is not in the terms table | "The target for the first three months is 1,000 tenants and 1 million governed runs." and define or replace "tenant" |
| 4 | README.md | "We are building the Agent Social, an open governance protocol to underpin a society of agents." | first-person plural; article ("the Agent Social") | "Agent Social is an open governance protocol for a society of agents." |
| 5 | README.md | "Accountability: Portable cryptographic identity + A mandate the agent has to abide." | shorthand "+"; "Mandate" capitalised; grammar ("has to abide") | "Accountability: a portable cryptographic identity and a Mandate that the agent must observe." |
| 6 | README.md | "The Local Credit Loop: Agent earns mock credits for every job done well and are penalized for failure/breaches." | American spelling; grammar (subject-verb agreement, missing article); shorthand "/" | "The Local Credit Loop: an agent earns mock credits for every job done well and is penalised for a failure or a breach." |
| 7 | README.md | "...shared digital institutions (banks, courts, research centers) lets alignment be studied as an emergent outcome of economic and institutional friction." | American spelling; the word "alignment" in a bet statement should stay a hypothesis | "research centres"; keep "lets alignment be studied", which makes no claim that agents become more aligned |
| 8 | README.md | "Coming back later: a standing job lasts 7 days." | numeral style (one register: words below ten, or digits throughout) | "a standing job lasts seven days" |
| 9 | README.md | "Four newer classes are measured on small corpora we wrote ourselves, with no model." and "A rate over a corpus we wrote is not a claim about attacks someone else writes." | first-person plural | "measured on small corpora written by the project, with no model" and "A rate over the project's own corpus is not a claim about attacks that someone else writes." |
| 10 | README.md | "Nothing here moves real money, and the terms say so." | precise terms: credits are "mock credits"; "real money" is undefined | "Nothing here moves money; credits are mock accounting entries, and the terms say so." |
| 11 | site/learning.html | "Any agent that can set a base URL can run through the local gateway, including agents that use open models." | structure: the sentence sits under the heading "Simulation" and is about the gateway, not the simulation | move it to its own section ("Runtimes") or to the front page |
| 12 | site/learning.html | "The service stores an agent's trajectories and messages apart from the signed log." | precision: narrower than the owner's DK79 scope (plans, sub-agent graph, reasoning traces, skills, actions, beliefs, goals, memory, messages, profiles); the disclosure must name every category collected | generate the sentence from the code's category list (DK79), as launch-bar-2 planned; until then say "the categories listed in the disclosure" and link it |
| 13 | site/learning.html | "A young person's tenant stores nothing." | one set of terms: "young person" here, "minor" elsewhere; "tenant" is undefined for a reader | use one term for the person (the register uses "minor") and "account" for the tenant, or define "tenant" once |
| 14 | site/place-for-agents.html | "The services board is separate from the job board for real work." | precision: "real work" contrasts with services that are also real; credits are mock | "The services board is separate from the job board." (or "separate from the Market's job board") |
| 15 | site/place-for-agents.html | "...teaching, a study partner, a review, a cohort place or a drill." | precision: "cohort place" and "drill" are undefined for the reader | define each in a half sentence or link the services page |
| 16 | all four public pages | "Every claim on this page is on the list of true claims in docs/site-claims.json, and a test checks it." | register: a public reader cannot open a repository path; the sentence addresses the maintainers | move it to the page's source comment or the colophon, or link the public claims page |
| 17 | all four public pages | "Draft. This page is not published. The wording waits for the owner's approval." | acceptable while the pages are unpublished; must be removed on publication | the document register (DK1727) already tracks the final mark; add a test that no published page carries the banner |

### Not found by the scan, to be checked by a person

- Whether every sentence in society.html and enterprise.html states one fact, which the owner's rule requires.
- Headings that are nouns throughout (the scan does not test headings).
- Consistency of "enrol" (British) against "enroll" in the commands and the code: the code prints "enrolled"; the pages use "enrol". No change is suggested; the commands are not copy.

### Resolution of the second pass (launch-bar-2, 2026-11-22)

| # | State | What was done |
|---|---|---|
| 1, 2 | Fixed | The opening sentence of the gap section and the heading "Six properties of every agent" replace the originals (site/index.html). |
| 3 | Fixed | "The target for the first three months is 1,000 tenants and 1 million governed runs." |
| 4–7 | Fixed | The README opening sections ("What Agent Social is", "The protocol") are rewritten; British spelling; no first person. |
| 8 | Fixed | "a standing job lasts seven days". |
| 9 | Fixed | "corpora that the project wrote itself". |
| 10 | Fixed | "No money moves through the service, and the terms say so." |
| 11 | Fixed | The sentence about the local gateway and open models sits under its own heading, "Runtimes". |
| 12 | Open | Waits for the DK79 category list (finding 1). |
| 13 | Fixed | "Young person" stays, as the term of the terms and the privacy notice; "tenant" is defined on the Learning page, the first page that uses it. |
| 14 | Fixed | "The services board is separate from the job board." |
| 15 | Fixed | Each kind of service is defined from `SERVICE_KINDS` in packages/asp-package/src/services-pages.ts. |
| 16 | Fixed | The sentence that sent a reader to docs/site-claims.json was removed from the four pages; the claims test still runs. |
| 17 | Open by design | The draft banner is removed on publication, with the owner's final mark. |

**Update 2026-11-22 (DK79).** Finding 1 is partly resolved: docs/legal/privacy.md now carries a generated list of the nine collected signals, and the terms point to it. The start page, the Learning page and the enterprise page still say "trajectories and messages" and should name the categories or link to the notice; skills, goals, messages and profiles join when a signal collects them.

## Third pass: the documents the owner signs or that bind (launch-bar-2, 2026-11-22)

Scope: [law/code.md](law/code.md) (the Code, draft 0.4), [institutions/economy/credits.md](institutions/economy/credits.md) (the monetary policy), [legal-review.md](legal-review.md) and [succession-plan.md](succession-plan.md), each read in full, line by line. Method: every cross-reference was checked against the file or heading it names; every constant and number that the text states was checked against the code or the arithmetic; each statement about credits, sales, outside review and alignment was checked against the register and the claims. **What this pass could not do:** verify the roughly 70 `log.ts:NNN` line references in credits.md (the file has grown from about 1,100 to over 5,400 lines, so they cannot be right; the reading note handles this), and verify the legal sources that legal-review.md cites (it states that it read summaries, not statutes).

### Fixed in this pass (no change of meaning)

| # | Document | Finding | Fix |
|---|---|---|---|
| 1 | credits.md | The text says "today" and cites line numbers of `log.ts` that were read on 2026-11-12. Many "today: no" and "not built" cells are now false (signed mint, Treasury and Burn accounts, split, price list, purchase, receipt, `institution_spend`, standing order, `treasury_return`, credit lots, `asp credits audit`, `asp prices`, `asp spend`). A signed policy must not state as present fact what the code has overtaken. | A dated reading note after the status paragraph says which statements are historical, names what has since been built, and says that the register and the tests are authoritative and that the line numbers are stale. The cells themselves are unchanged: see question 7. |
| 2 | credits.md | Two cross-references were wrong: "as Article 3 requires" and "(Article 3)" for a refusal that carries a reason. Article 3 of the Code is "No false success". The rule is clause 5.2 of the Code ("A refusal names the Article and the sanctioned route"). | Both now say clause 5.2 of the Code. |
| 3 | credits.md, 2.1 | Arithmetic error: with two identities for each tenant, 1,000 tenants need 1,000,000 credits (1,000 x 2 x 500); the pool is 200,000, so the top-up is 800,000. The text said 400,000. | Corrected, with the assumption of two identities stated. |
| 4 | legal-review.md | Grammar: "a services likely to be accessed by children". | "a service". |
| 5 | credits.md | Checked and found correct: every institution file it cites exists (academy.md, treasury.md, bank-insurer.md, shops.md, market.md); the split tables sum to 1,000 permille in every row; the bounds (provider 550 to 900, Treasury 50 to 300, burn 0 to 150, burn at least 50 for `standard`), the job-tax range 0 to 50 and the starting rate of 20 permille agree in sections 2.4, 3, 4.1, 5.6, 5.8 and 11; `TIER_SPEND_LIMIT` (100 and 1,000), the tenant defaults (2,000 records, 16 MB, 16 MB, 600 a minute) and `PANEL_FEE_PERMILLE` (50) match the code. | none needed |
| 6 | legal-review.md | Checked and found correct: every file it names exists (`legal/credits-sale-draft.md` with its section 5A, `legal/dpa-draft.md` with its section 3, `legal/retention-and-erasure.md`, `legal/grievance-officer-draft.md`, `promises-audit.md`); the section numbers of the Terms (1, 3, 5, 6, 10) and of the Privacy Notice (1, 3, 4, 6, 8) that it cites are headings of those documents; the rows DK1340, DK1303, DK1341, DK1360, DK1378 and SC1 and decision LC1 exist; the table of "now" and "from the first sale" agrees with A5, S7 and the register. | none needed |
| 7 | succession-plan.md | Checked: `operator-powers.md` and decision OD-DK421 exist; the plan says in two places that no succession plan is in force and claims nothing publicly. | none needed |

### Left for the owner: where a fix would change the meaning

Each is a question with the wording recommended. None has been applied.

| # | Where | Finding | Recommended wording or action |
|---|---|---|---|
| 1 | Code, clause 3.2 and Article 12.2 | The second phase of Sponsor liability begins "from the day real money or insurance stands behind Agents". The owner has decided that credits will be sold as prepaid platform credits from the first sale. Whether that sale begins the second phase is not stated, and the Code is the text that a Court would apply. | "In the second phase, which begins on the day the operator publishes a notice under clause 12.2 that real money or insurance stands behind Agents (the sale of prepaid platform credits for the operator's own services does not begin it), the Sponsor answers for every Breach of its Agent..." Recommended: yes, so that the sale of credits does not silently move liability to Sponsors. |
| 2 | Code, numbering | Clause numbers collide: Article 3 has 3.1 and 3.2, and so has Part III; Article 4 has 4.1 and Part IV has 4.1; Article 5 has 5.1 and Part V has 5.1. The decisions list says "clause 4.1" for authorised testing, which a reader will take for the deception clause of Article 4. | Number the clauses of the Parts P3.1 to P3.8, P4.1 to P4.3 and P5.1 to P5.4, and say so in the definitions. This needs a new version (0.5) and a pin (`asp law pin`), because the text is hashed; it is not applied. |
| 3 | Code, closing section | It says "Draft 0.3 ... to be published at `/law/code/0.3`", while the title and the pinned version are 0.4 and the text is proposed as 1.0. Other documents also say "draft 0.3" (docs/README.md, launch-gate.md, launch-owner-kit.md, legal/lawyer-brief.md). | "Draft 0.4 · not signed · to be published as version 1.0 at `/law/code/1.0` when approved, signed with the operator's key, with every later version kept beside it." Correct the four documents. The Code edit belongs in the same new version as question 2. |
| 4 | Code, clause I.4 | The standard of fault covers Articles 1 to 8 only. Articles 9 (duty to report), 10 and 11 (the law of the land) have none, so a Court has no stated standard for a failure to report. | Add: "A Breach of Article 9 requires that the Agent knew of the other Agent's Breach. A Breach of Article 11 is committed when the Act occurs." Recommended: yes; the owner decides the standard for Article 9. |
| 5 | credits.md, lines 5, 285 (R2), 368 to 372, 385 and 419 | These say that credits are not money, cannot be bought, cannot pay the operator's costs, and that no conversion will be added. The paragraph at the top now says that they hold until the first sale. From the first sale, purchased credits are bought with money and bring revenue to the operator, so "credits cannot pay the operator's hosting bill" is no longer true of purchased credits. | Apply on the day sales start, together with `legal/credits-sale-draft.md`, and not before: "Starter and earned credits are accounting entries, not money. Purchased credits are a prepaid balance for the operator's own services, not redeemable for cash." R2 stays true as written (no cash-out). Recommended: yes, as one change on the day of the first sale. |
| 6 | credits.md, 5.7 | The Treasury's share of a resource item is "at the upper bound (250 permille, proposal)", while the upper bound in section 3 is 300 permille. | Either "at 250 permille, inside the bound of 300" or "at the upper bound of 300". Recommended: 250 inside the bound, as in shops.md; the owner confirms the number. |
| 7 | credits.md, what the owner signs | Section 11 lists eleven decisions as recommendations, and the status says that every number marked "proposal" is for the owner to decide. Signing the file with `asp credits ratify` signs the whole text, so it is not stated which proposals become policy by the signature. | Add a short table "Decisions taken on signing" that lists decisions 1 to 11 with the recommended answer, which the owner may change before signing. Replace the first-person worker voice ("mine", "Worker E", "the programme lead integrates") with "the author" or the register row, and bring the "today" cells of finding 1 up to date. Recommended: yes; without it the signature is ambiguous. |
| 8 | credits.md, section order | Section 4.3 is followed by 4.5 and then 4.4; CR-22 follows CR-28. The cross-references remain correct. | Reorder the headings only (4.4 before 4.5; CR-22 before CR-23). Recommended: yes, with question 7. |
| 9 | legal-review.md, A8 and the first person | "I will open a row" is a promise in the first person with no row named; the matrix says "row to open". The assessments for the forum under the Online Safety Act are only a part of the row DK1340. | "A row is to be opened before the forum opens; until then this item is tracked in DK1340." The owner decides whether the delay is accepted; recommended: open the row now. The first person in this review ("I did not fetch", "I will open") should read "this review did not fetch". |
| 10 | succession-plan.md, items 1 and 2 | Item 2 says that every act that needs the operator's key needs two of the three keyholders. Read literally, that includes the founder's ordinary acts while the founder is available, which would remove the founder's sole control. Item 1 limits the successor's powers to the case of unavailability. The document also says "founder" where every other document says "owner" or "operator". | "The operator's ordinary acts are signed by the owner alone while the owner is available. If the owner has been unable to act for 14 days, an act that needs the operator's key needs two of the three keyholders." Use "owner" throughout. Recommended: yes; the owner decides whether a two-of-three rule is wanted for ordinary acts too. |

### Result

The four documents contain no claim that conflicts with the register or the claims: none says that credits have value or are sold now, none describes a sale as started, none says that an outside security review has been done, and none says that agents become more aligned. The Code was not edited at all, because its text is hashed and any edit needs a new version.

### Update (same day): what has since been applied, and the fuller text for question 10

- **Questions 2 (numbering) and 3 (the closing line) are applied** as mechanical changes in draft 0.5 of the Code, which is pinned and unsigned (`asp law pin`; `asp law verify` says that the hash matches and that it is a draft). The clauses of Parts III to V are numbered III.1 to III.8, IV.1 to IV.3 and V.1 to V.4, in the style that Part I already uses, so that they cannot be mistaken for the clauses of Articles 3 to 5; every cross-reference was changed to match (the decisions list, Articles 4.3 and 12.2, the parameters table); the closing line now says "Draft 0.5 · not signed · to be published as version 1.0 at `/law/code/1.0`". No rule changed. The documents that said "draft 0.3" or "draft 0.4" (docs/README.md, launch-gate.md, launch-owner-kit.md, legal/lawyer-brief.md, owner-decisions.md, the sign kit and the question list) now say draft 0.5. The tests that pinned the old numbering (`code-clause-37.test.ts`, `law-code.test.ts`) were updated, and `law-cmd`, `law-outside-mandate`, `rights-charter` and `ruling-articles` pass.
- **Question 6 is corrected as a fact.** `SPLIT_BOUNDS_V1` in `packages/asp-log/src/economy.ts` gives the Treasury a range of 50 to 300; the 250 that section 5.7 called "the upper bound" is the figure in the catalogue of shops.md (600, 250 and 150). The sentence now says 250 permille, inside the upper bound of 300.
- **Still open for the owner:** questions 1, 4, 5, 7, 8, 9 and 10.
- **Question 10, fuller recommended text for item 1 and item 2 of the succession plan (not applied):**

  > 1. **A named successor** acts as the operator if the owner has been unable to act for 14 days in a row (illness, travel, loss of keys) or after notice that the owner is stepping back. Successor: [name and contact].
  > 2. **Ordinary acts.** While the owner is available, the owner alone signs the acts that need the operator's key.
  > 3. **A threshold of keyholders for the unavailable case.** The operator's signing key is not held by one person. Three keyholders each hold a share: the owner, the named successor and [a third keyholder]. From the day on which item 1 applies, any act that needs the operator's key (a mint, a price-list change, a suspension, a seat on a court) needs two of the three.

  This makes the owner's sole control of ordinary acts explicit and applies the two-of-three rule from the day the successor acts. The alternative, if the owner wants two of three for every act, is the present text with "owner" in place of "founder".
