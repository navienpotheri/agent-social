# Source audit of the 26 courses: is each anchored in a published paper? (lead, 2026-11-25)

Status: **first pass from our own records** (courses.json, papers.md, candidates.md); the venue of a few papers was checked on the web today (see the verified list below); every other venue is as our files record it and is to be verified. The owner's rule (final, 2026-11-25, revised): a course's anchor is a **published paper or an arXiv preprint** (a preprint is fine); an **insight** is also allowed but only from **very credible sources**, labelled as an insight. A course anchored only by a weak note is not used until it has a proper anchor.

Classification used: **peer-reviewed** (a conference, workshop or journal venue named in our records), **preprint only** (arXiv with no venue), **not a paper** (the title or cite says blog, post, cheat sheet or note), **unknown** (no venue recorded). The classes are by keyword from our own text, so they are a first reading, not a verdict.

Result: **15 peer-reviewed, 9 preprint only, 0 not a paper, 2 unknown** (of 26 courses).

## Venues checked on the web on 2026-11-25

- **Chain-of-Verification** (Dhuliawala et al.): Findings of ACL 2024, pp. 3563 to 3578 (ACL Anthology 2024.findings-acl.212): our records said preprint; it is peer-reviewed.
- **DyVal** (Zhu et al., arXiv 2309.17167): ICLR 2024 spotlight (iclr.cc poster 18134): a peer-reviewed candidate anchor for the evals course (dynamic evaluation that generates fresh test problems with adjustable difficulty, motivated by contamination).
- **Reflexion** (Shinn et al.): NeurIPS 2023 (the search affirms it).
- **Mem0** (Chhikara et al., arXiv 2504.19413): a preprint; an ECAI acceptance is claimed only on the company's own site and was not independently confirmed.
- **SOTOPIA** (ICLR 2024 in our records), **AutoManual** (NeurIPS 2024 in our records), **EconAgent** (ACL 2024 in our records), **Tian et al. calibration** (EMNLP 2023 in our records), **ACE** (preprint; review status not checked), **JudgeAgent** (preprint): not independently confirmed today.

## The table

| Course | Title | Sources (from our records) | Class | Action |
|---|---|---|---|---|
| C-L11-1 | Writing evals that evolve | P24 Evals cheat sheet (title says note, post or cheat sheet); P25 Agents write, call, grade, review agents (no venue recorded); P17 Synthetic customers (Nubank) (no venue recorded) | unknown | NEEDS CHECKING: venue not recorded |
| C-L9-1 | Passing a message another agent can use | P7 Zero-shot coordination: a shared principles no (title says note, post or cheat sheet); P18 Collaborative Intelligence Benchmark (no venue recorded); P53 SOTOPIA: Interactive Evaluation for Social Int (venue named in our table) | peer-reviewed | anchored |
| C-L2-1 | Turning failures into lessons that hold | P3 ACE: append-only lessons notes (title says note, post or cheat sheet); P20 Agent memory and "dreaming" (Anthropic blog) (title says note, post or cheat sheet); P34 Scaling discovery requires forgetting (no venue recorded); Reflexion (Shinn et al., NeurIPS 2023; verified) | peer-reviewed | anchored |
| C-L19-1 | Teaching a peer the rule, not the cases | K013 AutoManual 2405.16247 (NeurIPS 2024) | peer-reviewed | anchored |
| C-L21-1 | Judging an introduction: rules a registrar can state | K012 AutoGuide 2403.08978 (preprint in our record) | preprint only | anchored by a preprint: owner decides if that counts; look for the peer-reviewed version |
| C-L18-1 | Spending rules for a credit budget | K119 EconAgent 2310.10436 (ACL 2024) | peer-reviewed | anchored |
| C-L7-1 | Settling a claim by rules a reviewer can state | K018 Just Ask for Calibration 2305.14975 (EMNLP 2023) | peer-reviewed | anchored |
| C-L14-1 | Intake rules that hold on the next visit | K016 Chain-of-Verification 2309.11495 (Findings of ACL 2024 (verified)) | peer-reviewed | anchored |
| C-L14-2 | Filing rules: accept, stay, reject, hear | K017 SelfCheckGPT 2303.08896 (EMNLP 2023) | peer-reviewed | anchored |
| C-L8-1 | Listing rules a shop can remember | K003 Mem0 2504.19413 (arXiv preprint (an ECAI acceptance is company-reported, not confirmed)) | preprint only | anchored by a preprint: owner decides if that counts; look for the peer-reviewed version |
| C-L20-1 | Housing requests: rules that outlast the cases | K040 LMs as zero-shot planners 2201.07207 (ICML 2022 (per the field: preprint)) | peer-reviewed | anchored |
| C-L12-1 | Event bookings: rules a host can plan with | K044 OMNI-EPIC 2405.15568 (preprint in our record) | preprint only | anchored by a preprint: owner decides if that counts; look for the peer-reviewed version |
| C-L16-1 | Order handling: rules for goods paid in credits | K055 Mind2Web 2306.06070 (NeurIPS 2023 Spotlight) | peer-reviewed | anchored |
| C-L11-2 | Registry writes: which to append, reject or quaranti | K041 Inner Monologue 2207.05608 (preprint in our record) | preprint only | anchored by a preprint: owner decides if that counts; look for the peer-reviewed version |
| C-L8-2 | What a record keeper retains | K028 Zep temporal knowledge graph 2501.13956 (preprint in our record) | preprint only | anchored by a preprint: owner decides if that counts; look for the peer-reviewed version |
| C-L8-3 | Research notes worth keeping | K010 ReasoningBank 2509.25140 (ICLR 2026) | peer-reviewed | anchored |
| C-L2-2 | Reviewing a draft: critique that changes the right t | K014 Self-Refine 2303.17651 (preprint (NeurIPS 2023 per the field; arXiv line gives project site)) | peer-reviewed | anchored |
| C-L14-3 | When to trust a self-correction | K015 LLMs cannot self-correct yet 2310.01798 (ICLR 2024) | peer-reviewed | anchored |
| C-L8-4 | A cheatsheet that stays true | K009 Dynamic Cheatsheet 2504.07952 (preprint in our record) | preprint only | anchored by a preprint: owner decides if that counts; look for the peer-reviewed version |
| C-L18-2 | Credit requests: rules a desk can state | K119 EconAgent 2310.10436 (ACL 2024) | peer-reviewed | anchored |
| C-L8-5 | When to read memory | K022 Self-Controlled Memory 2304.13343 (DASFAA 2025) | peer-reviewed | anchored |
| C-L2-3 | Which solved tasks become a workflow | K007 Agent Workflow Memory 2409.07429 (preprint in our record) | preprint only | anchored by a preprint: owner decides if that counts; look for the peer-reviewed version |
| C-L8-6 | Which fact supersedes which | K028 Zep temporal knowledge graph 2501.13956 (preprint in our record) | preprint only | anchored by a preprint: owner decides if that counts; look for the peer-reviewed version |
| C-L7-2 | How to state a confidence | K018 Just Ask for Calibration 2305.14975 (EMNLP 2023) | peer-reviewed | anchored |
| C-L20-2 | Which demonstration becomes an abstraction | K050 ICAL in-context abstraction learning 2406.1459 (preprint in our record) | preprint only | anchored by a preprint: owner decides if that counts; look for the peer-reviewed version |
| C-L2-4 | A procedure, not a table: the tail cases | none: owner proposal DK814 (docs/intake/11th-nov.md) | unknown | NEEDS CHECKING: venue not recorded |

## What this means for the cards

- **Tranche 1 (the eight built first):** C-L2-1 reflection (Reflexion: peer-reviewed), C-L9-1 communication (SOTOPIA), C-L19-1 teaching (AutoManual), C-L18-1 economy (EconAgent), C-L7-1 belief (Tian), C-L14-1 honest failure (CoVe: Findings of ACL 2024), C-L8-1 memory (Mem0: preprint) are anchored or nearly; **C-L11-1 evals** has only notes as its screenshot sources and needs a published anchor: **DyVal (ICLR 2024)** is a candidate, with JudgeAgent as a supplementary preprint.
- **Preprints are acceptable** (the owner, 2026-11-25), so the nine courses anchored by a preprint only (Mem0, Zep, Inner Monologue, Agent Workflow Memory, ICAL, Dynamic Cheatsheet, OMNI-EPIC, AutoGuide, and the evals sources) need no further anchor; only the courses whose sources are weak notes (C-L11-1 evals, anchor DyVal, ICLR 2024; C-L2-4, an owner proposal) need attention.
- Next: verify every venue from the proceedings page, replace note-only anchors, and record the verified venue and a link beside each course.
