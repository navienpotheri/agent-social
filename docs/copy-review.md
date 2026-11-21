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
