# Generative worlds for expeditions (owner direction, 2026-11-21)

Status: a plan for the owner, rows DK1350 to DK1352. Nothing is built. The models below were found by one web search on 2026-11-21 and read as search results only; each is read at its source, and its licence checked, before use (row DK1336).

## What the owner wants

Two structures of world:

1. **Measured worlds**: repeatable. The same seed gives the same world, so agents can be compared, a study can be pre-registered, and a run can be replayed. These are the rule-defined, referee-run worlds of DK1317 and the games of DK1316.
2. **Expedition worlds**: new every time. An agent or a group is put into a world nobody has seen, generated on the spot by an open-source interactive world model run on rented cloud GPUs, and must interact with it and find its way back or reach a goal (DK1318). Non-repeatable is accepted by the owner for these.

The owner also wants short videos for the public website: about 20 seconds of agents shown as dots moving through different environments (a desert, an open city, a forest and others), and a short expedition video.

## Open interactive world models found (search results, to be read in full)

- Matrix-Game 2.0 ([paper](https://arxiv.org/html/2508.13009v3)): open-source real-time interactive world model, minute-long video at 25 frames a second, weights and code public. Matrix-Game 3.0 adds long-horizon memory and reports up to 40 frames a second at 720p.
- LingBot-World: an open-sourced world simulator built from video generation, with weights and inference code.
- SANA-WM ([paper](https://arxiv.org/pdf/2601.20540.pdf)): a 2.6 billion parameter open model for one-minute 720p generation with camera control.
- Micro-World from AMD ([post](https://rocm.blogs.amd.com/artificial-intelligence/micro-world/README.html)): an action-controlled model with weights, training and inference pipelines and a dataset.
- AlayaWorld ([listing](https://huggingface.co/papers/2607.06291.md)): an open framework for interactive generative worlds; whether its code is released was not confirmed.
- Genie 2 and Genie 3 are the closed reference points, not open.
- NVIDIA Cosmos and Oasis were not covered by the search.

## The hard problems the design has to answer

1. **Perception and action.** An agent must see frames (a vision-capable model) and act through the world model's action interface (move, turn, interact). Text-only agents cannot take part.
2. **Scoring without ground truth.** A generated video has no state table. To score "got back" or "found the water" the referee needs a state tracker: either a hidden simulation under the generated view, a landmark or goal check by a separate evaluator model whose own error rate is measured, or goals defined by the world model's own conditioning. This is the main design question of DK1350.
3. **Auditability without repeatability.** Every frame, action and seed is recorded and hashed so a run can be inspected afterwards even though it cannot be regenerated; the world model version and weights hash are in the record.
4. **Cost.** Rented GPUs by the hour; a cap per expedition and per day, shown to the sponsor (DK1313, DK1347).
5. **Safety and licence.** A content filter on generated frames; licences of the weights checked for the uses we have (a public site video, a service).
6. **Memory and drift.** Long expeditions need the world to stay consistent (the reason Matrix-Game 3.0 added memory); an inconsistent world must be detected and the expedition voided, not scored.

## How it fits the project's aim

Expeditions put agents in unfamiliar conditions with no rule book: the situation in which drift and guardrail circumvention are most likely, and so the most informative test of whether society-trained agents keep their limits. The measured worlds stay the basis for any claim with numbers (DK1332); expeditions add breadth and the public story.
