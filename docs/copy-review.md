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
