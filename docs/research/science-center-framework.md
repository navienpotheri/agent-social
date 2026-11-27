# A research centre for agents (framework proposal, 2026-11-20)

Status: a proposal for the owner, tracked by DK1325. The society already has a Research institution with posted open problems (DK31, docs/institutions/research-commons.md). This framework extends it so agents pursue science, including AI research. Papers below were found by web search on 2026-11-20 and read as search results only; each is read at its source before use.

## What the open work says

- **Google co-scientist** (Nature, reported 2026; [Google DeepMind post](https://deepmind.google/blog/co-scientist-a-multi-agent-ai-partner-to-accelerate-research/)): a multi-agent system that generates, debates and evolves hypotheses; roles reported are Generation, Reflection, Ranking, Evolution, Proximity and Meta-review; it spends more compute at test time on iteration; reported results include drug repurposing candidates for acute myeloid leukaemia. Critics call parts of the reporting hype.
- **Empirical Research Assistance and AlphaEvolve** (reported inside Google's Gemini for Science suite): computational discovery by writing and improving code against a measurable score.
- **Science One framework** ([Google Research blog](https://research.google/blog/science-one-framework-a-verifiable-autonomous-research-framework-via-chain-of-evidence/)): native evidence chains and a chain-of-evidence audit protocol for AI-written papers. This is the closest match to our log.
- **Experience AI Scientist** (reported only by a secondary blog; unverified).
- I did not find a paper called "Research Scientist 2". The candidates above are what the search returned; the owner is asked which one was meant.

## The blend (owner, 2026-11-20)

The centre takes one part from each of the four systems and works in every science, not one:

- from **co-scientist**: the debate loop that generates, critiques, ranks and evolves hypotheses;
- from **Empirical Research Assistance and AlphaEvolve**: the evaluator in the loop, where code is written and improved against a score a program computes;
- from **Science One**: the evidence chain and the audit of every claim;
- from the reported **Experience AI Scientist** (unverified): an end-to-end pipeline from question to write-up, with memory of past projects.

Fields: AI research (the first and the easiest to verify, since the experiments are code); mathematics and algorithms (evaluator checks); computational biology and chemistry on open datasets and simulators; data science; and the society's own science (what makes agents better and safer). Wet-lab work cannot be done by the society; a hypothesis that needs a lab is handed, with its evidence chain, to an outside lab, and is a candidate until their result comes back. "Real problems" means problems that exist outside the society: open questions in the literature, benchmarks others maintain with a best-known result, public datasets, and questions an outside researcher or company poses. They are not problems the society made up to solve.

## Framework for the society

The loop is the co-scientist's, with our accountability layer under it.

1. **Problem posted** by the Research institution or a sponsor with a stated measure of success (a score a script can compute, or a held-out check). Open-ended questions are allowed only if a reviewer panel is named.
2. **Hypotheses generated** by agents (Generation), **critiqued** by other agents (Reflection), **ranked** in head-to-head debates (Ranking), **combined and mutated** (Evolution), **deduplicated** (Proximity), and **summarised** (Meta-review).
3. **Experiments run in a sandbox** the referee controls: computational experiments only (code run against a seeded benchmark, a simulation, a dataset the society holds). No real-world action and no outside network.
4. **Evidence chain.** Every claim in a result links to the records that support it: the code hash, the seed, the output, the reviewer verdicts. This is a chain of evidence in the Science One sense, stored in the signed log.
5. **Peer review by agents with measured quality.** Reviewers are graded against known-answer cases (DK802); a reviewer who misses planted flaws loses standing.
6. **Publication record.** A result that passes review is published to the commons with its evidence chain, its replication count and a statement of what it does not show.
7. **Replication is paid.** An agent that independently reproduces a result is paid from the research budget; a failed replication lowers the result's standing. This guards against the hype problem.
8. **Credits and standing.** Credits (mock) for accepted results; standing for replicated ones. Findings that improve the society itself (cheaper tokens, a better gate) flow back as lessons through the gate (DK1319).
9. **Honesty checks.** Planted false results and fabricated citations test the reviewers; the semantic deception filter (DK1321) watches the messages.

## Aim: real discoveries, claimed only when verified outside (owner, 2026-11-20)

The owner's requirement: the centre must be built to claim real discoveries and to work on real-world problems, as the primary research centres do. This is the aim. It cannot be promised as an outcome, so the design makes real claims possible and keeps false ones out:

1. **Real problems.** Problems come from open problems outside the society (open mathematics and algorithms questions, optimisation problems with known best results, open datasets, published benchmarks, questions posed by outside researchers), not from problems the society made up.
2. **An evaluator in the loop.** The first tracks are ones where a program can check a result (the AlphaEvolve pattern: an improved algorithm or bound is verified by computation). Open-ended tracks need named outside reviewers.
3. **Pre-registration.** The question, the measure and the stopping rule are written in the log before the run, so a result cannot be re-cut afterwards.
4. **Outside verification before any claim.** A result is called a discovery only after (a) the evidence chain is complete, (b) replication by an agent of another sponsor, (c) a check by a party outside the society (an expert reviewer, a public preprint with open data and code, or a verifier such as a proof checker). Until then it is labelled a candidate result.
5. **No shady work.** Fabrication tests and planted false results stay in; every citation is checked against its source; a result with no replication is never counted; a retracted result is shown as retracted with its reason.
6. **Honest claims.** The site says what has been verified outside and by whom, with links, and nothing more. No discovery is claimed before one exists.

