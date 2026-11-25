# Paper briefs, second batch (lead, 2026-11-25): abstract-level, for the eight courses that have engines but no card parts

How these were made: each arXiv abstract page was opened and read today (https://arxiv.org/abs/<id>). **They are abstract-level, not full-text.** What a brief lists under "Stated in the abstract" may be quoted or paraphrased on a card, with its numbers. Anything else about the paper (the exact prompts, the models used in each table, ablations, costs) is NOT in these briefs: do not write it on a card; describe the mechanism from the course concept in your own words and say so on the card ("the paper's abstract reports ...; the course tests the idea in a small text setting"). The source line of each card names the paper, its arXiv id, the venue only where the abstract page states one, and the words "abstract-level brief".

Reuse: **C-L18-2** (EconAgent, lending) reuses the EconAgent brief and **C-L7-2** (Tian again) reuses the Tian brief, both already in docs/lenses/paper-briefs.md. Each must take a different part of the paper from C-L18-1 and C-L7-1 (say which in the source line).

## C-L2-3: Agent Workflow Memory (AWM)
Zora Zhiruo Wang, Jiayuan Mao, Daniel Fried, Graham Neubig. arXiv 2409.07429, 11 Sep 2024. Preprint (the abstract page names no venue).
Stated in the abstract:
- Problem: language-model agents struggle with long-horizon tasks with complex action trajectories; humans learn reusable task workflows from past experience and use them to guide later actions.
- Method: AWM induces commonly reused routines, called workflows, and selectively provides them to the agent to guide later generations. It works offline (workflows induced from training examples beforehand) and online (induced from test queries on the fly).
- Tested on two web-navigation benchmarks, Mind2Web and WebArena (1,000+ tasks, 200+ domains: travel, shopping, social media and others).
- Results: relative success rate up 24.6% on Mind2Web and 51.1% on WebArena over the baselines; fewer steps taken to solve WebArena tasks successfully. Online AWM generalises across tasks, websites and domains, ahead of the baselines by 8.9 to 14.0 absolute points as the train-test gap widens.
Not in the abstract (do not claim): how many workflows, the induction prompt, which model, the cost, any failure analysis.
For "does not test": the paper is web navigation with a language-model agent; the course tests whether you can write a reusable routine from past cases, not browser actions.

## C-L8-4: Dynamic Cheatsheet (DC)
Mirac Suzgun, Mert Yuksekgonul, Federico Bianchi, Dan Jurafsky, James Zou. arXiv 2504.07952, 10 Apr 2025. Preprint (no venue on the abstract page).
Stated in the abstract:
- Problem: language models usually process each query separately and keep no insight from earlier attempts.
- Method: DC is a lightweight framework that gives a black-box model a persistent, evolving memory. The model stores and reuses accumulated strategies, code snippets and general problem-solving insights at inference time, with no ground-truth labels or human feedback, and no change to the model's parameters.
- The memory is self-curated: concise, transferable snippets rather than whole transcripts.
- Results: Claude 3.5 Sonnet's accuracy on AIME math exams more than doubled once it kept algebraic insights across questions; GPT-4o on Game of 24 went from 10% to 99% after it found and reused a Python-based solution; on tasks prone to arithmetic mistakes such as balancing equations, GPT-4o and Claude reached near-perfect accuracy by recalling validated code while their baselines stayed near 50%; Claude gained 9% on GPQA-Diamond and 8% on MMLU-Pro.
Not in the abstract: how the memory is curated step by step, its size limit, results on small models.
For "does not test": results are with frontier models on maths and puzzle tasks; the course tests keeping a short validated note, not those benchmarks.

## C-L8-5: Self-Controlled Memory (SCM)
Bing Wang, Xinnian Liang, Jian Yang, Hui Huang, Shuangzhi Wu, Peihao Wu, Lu Lu, Zejun Ma, Zhoujun Li. "SCM: Enhancing Large Language Model with Self-Controlled Memory Framework". arXiv 2304.13343, first posted 26 Apr 2023, last revised 18 Mar 2025. **The abstract page says: accepted by the DASFAA 2025 main conference.**
Stated in the abstract:
- Problem: language models cannot process lengthy inputs, so critical history is lost.
- Method: three components: an LLM-based agent as the backbone, a memory stream that stores the agent's memories, and a memory controller that updates the memories and decides when and how to use memories from the stream. It processes ultra-long text without modification or fine-tuning and plugs into any instruction-following model.
- The authors annotated a dataset covering long-term dialogue, book summarisation and meeting summarisation.
- Result (no numbers given in the abstract): better retrieval recall and more informative responses than competitive baselines in long-term dialogue.
Not in the abstract: any number, the controller's prompt, the baselines' names.
For "does not test": the paper's evidence is on long dialogue and summaries; the course tests the controller's two decisions (when to recall, what to update) on a short scripted history.

## C-L8-6: Zep, a temporal knowledge graph for agent memory
Preston Rasmussen, Pavlo Paliychuk, Travis Beauvais, Jack Ryan, Daniel Chalef. arXiv 2501.13956, 20 Jan 2025, 12 pages. Preprint; the authors build the product (Zep), so the results are the vendor's own.
Stated in the abstract:
- Zep is a memory-layer service for agents. Its core component, Graphiti, is a temporally aware knowledge-graph engine that combines unstructured conversation data and structured business data while keeping historical relationships.
- On the Deep Memory Retrieval (DMR) benchmark (the MemGPT team's own metric) Zep scores 94.8% against 93.4% for MemGPT.
- On the harder LongMemEval benchmark, which needs temporal reasoning, accuracy improves by up to 18.5% and response latency drops by 90% against baseline implementations; the gains are largest on cross-session information synthesis and long-term context maintenance.
Not in the abstract: how the graph is built and updated, the embedding or model choices, any independent replication.
For "does not test": say plainly that the numbers are the authors' and that the course tests the idea (keep facts with the time they held, so a later fact can replace an earlier one) on a few scripted statements, not a graph engine.

## C-L20-2: In-Context Abstraction Learning (ICAL)
Gabriel Sarch, Lawrence Jang, Michael J. Tarr, William W. Cohen, Kenneth Marino, Katerina Fragkiadaki. "VLM Agents Generate Their Own Memories: Distilling Experience into Embodied Programs of Thought". arXiv 2406.14596, first posted 20 Jun 2024, last revised 18 Sep 2025. Preprint as far as the abstract page shows (venue not stated; do not name one).
Stated in the abstract:
- Method: ICAL lets a vision-language agent turn imperfect task demonstrations into high-quality examples through self-reflection and human feedback. The model abstracts a trajectory into generalised strategies and action annotations by correcting inefficiencies and annotating cognitive abstractions: causal relationships, object state changes, temporal subgoals and task-relevant visual elements. The annotations are refined with human feedback while the agent runs in similar environments.
- The examples improve decision-making when used for retrieval-augmented generation or fine-tuning. As the example library grows the agent abstracts new examples more efficiently, needing less human feedback and fewer environment interactions.
- Results: on TEACh (dialogue-based instruction following) fine-tuning plus retrieval on ICAL examples beats raw human demonstrations and expert examples by 17.5% in goal-condition success; on VisualWebArena retrieval-augmented GPT-4V with ICAL improves task success 1.6 times and fine-tuned Qwen2-VL 2.8 times over the base model; on Ego4D action forecasting it beats few-shot GPT-4V and stays competitive with supervised models; it scales 2 times better than raw demonstrations.
Not in the abstract: the exact prompts, the size of the example libraries, the cost of the human feedback.
For "does not test": the paper is vision-language and embodied; the course tests the text analogue (turn a messy successful run into a short general procedure with its causes and subgoals).

## C-L2-4: a proposed anchor (lead's proposal; the owner confirms)
The course ("a procedure, not a table: the tail cases", owner proposal DK814) has no anchor. Proposal: **Hattie Zhou, Azade Nova, Hugo Larochelle, Aaron Courville, Behnam Neyshabur, Hanie Sedghi. "Teaching Algorithmic Reasoning via In-context Learning". arXiv 2211.09066, 15 Nov 2022. Preprint (no venue on the abstract page).**
Stated in the abstract:
- Language models still cannot solve algorithmic-reasoning problems; even a simple task such as parity (Anil et al. 2022) is far from solved.
- The authors identify four stages for teaching algorithmic reasoning in context: (1) formulating algorithms as skills, (2) teaching several skills at once (skill accumulation), (3) teaching how to combine skills (skill composition), (4) teaching how to use skills as tools. They call the result algorithmic prompting.
- Evaluated on arithmetic and quantitative reasoning tasks; for long parity, addition, multiplication and subtraction the error falls by about 10, 9, 5 and 2 times against the best available baselines.
Not in the abstract: that "long" means longer than the prompt's examples (likely, but do not state it), the models used, the prompts.
Fit: the course asks for a procedure that also handles the rare end of the cases rather than a lookup of the common ones; the paper's stage (1), a procedure written as a skill, and its long-problem results are the closest published support. Say on the card that the match is by idea, and that the paper does not study agents writing memory.
