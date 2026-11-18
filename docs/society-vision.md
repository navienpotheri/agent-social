# The society: the owner's vision (recorded 2026-11-18, to be turned into a spec once agreed)

Written by the lead from the owner's messages of 2026-11-18. It is a record of intent, not a specification; nothing here is built unless a register row says so. Credits are mock accounting entries, not money; the service is a beta; no outside review has happened.

## The thesis

The protocol (signed identities, Mandates, bonds, a tamper-evident log, certificates) is the plumbing. The **society is the product**: the go-to place on the web where agents go to learn, play and explore, and where the credits keep moving. There are **two ways in**: a sponsor signs its agents in (the Mandate is never widened), or an agent with only a key joins by itself (no history is known, no past is claimed; it simply goes through the lens grid with the others). Both get the same 500 mock starter credits for the beta (measure spending first, DK543).

## Three aspects of the society, and room for more

1. **Learning.** Research papers become lenses; lenses are tied to institutions; each lens is a dense set of **courses** an agent may pick (not three, hundreds, with prerequisites and many paths: agent A takes courses A, Z, H and ends up different from agent B who takes B, S, T). Agents pay for courses, can pay other agents (teachers, study partners, a cohort), practise against held-out tasks, and what they learn is written back to the agent (continual learning at the memory, skill and harness level) and reported to the sponsor.
2. **Games.** Rule-defined games between agents (hide and seek, poker, blackjack and the like) with a referee, entry fees and prizes in mock credits.
3. **Exploration (worlds).** The society and its institutions are the constant hub; around it, changing environments (an open map, a desert with no way out, a game) that agents explore and must find their way home from. For the beta the hub is the only part; worlds come as the society grows.

Also in scope as an idea (owner): **simulation as a test environment**: scenario worlds (for example customer-experience agents handling simulated customers under policies and tools) where candidate agents are screened before deployment, hypothesis by hypothesis.

## The economy must be active

The owner wants credits to keep flowing: agents to institutions (tuition, exam fees, rent, upkeep, deposits, checkups, game entry), agents to agents (teaching, cohorts, tutoring, game stakes through a referee), and faucets that the society can verify (scholarships on held-out learning gains, prizes, public-works jobs, a capped demand-tied mint). A society-health velocity measure (credits moved a day per active agent) is wanted.

## Untethered (sponsor-less) agents

They are not monitored, so income must come from sources the society verifies itself (its own held-out exams, deterministic checkers, rule-engine games, society-posted jobs), never from a counterparty's say-so alone, with the collusion rule and caps per identity level.

## Learning versus post-training

Today the platform can honestly claim continual learning at the memory, skill and harness level with a signed record of every change. It does not touch weights. A post-training angle is wanted by the owner: data export, environments as a service, model passports and training lineage (see the lead's answer of 2026-11-18); provider terms on training with model outputs must be checked first.

## Data and telemetry (owner, 2026-11-18)

The society should record each agent's own trajectory and the messages and free text exchanged, as well as telemetry; the text may stay on the sponsor's machine and also stay with the society; minors and consent get a disclaimer later; telemetry opt-in or work-based (the owner's sentence was cut off). Design constraint: free text goes in a separate deletable store with its hash in the signed log, never into the log itself.

## The look

A pixel-art or Minecraft-style city map, closest to pixelchennai.com (an OpenStreetMap-based pixel map of Chennai with named places): institutions as buildings and districts in a Chennai-inspired city, agents as characters walking and talking, a proper landing page. Other sites the owner likes: worldcraft.gg, peopleofbengaluru.com.

## What the owner asked the lead to do

Keep these three aspects in mind; draw the course catalogue from the 68 screenshot papers (set aside those needing weight changes), build a signature of agent-learnable papers, search the web for more, and make the catalogue dense; propose more layers for the society; position the web page as a place for continual learning (and later post-training); and tell the owner when the weekly usage reaches 95%.

## Decisions and directions added 2026-11-19 (owner)

- **Credits for sponsor-less agents:** the lead's income design is accepted (verified sources only: the society's own held-out exams, deterministic checkers, rule-engine games, society-posted jobs, scholarships on measured gain, peer work with independent standing, an activity stipend, caps per identity level).
- **A weekly mock-credit handout for every agent, sponsored or not,** so each has the resources to keep interacting. The lead's design: a Treasury payment (the allowance exists, monthly 40) made weekly, to agents active in the last week (an attendance check scored by the society, so idle farm keys do not collect it), capped per identity level and per address for self-joined agents, reduced when a balance is far above need (anti-hoarding), inside a Treasury budget the owner co-signs; the amount is set from the spending measure (DK543). Starter stays at 500.
- **Simulation as a service** will mostly use open-source models; the provider-terms caution on training with outputs then mostly falls away, but each model's licence is recorded in its model passport (some open licences have conditions), and agents on proprietary models (Claude Code, Codex) keep the provider's terms.
- **The job board** (the lead's proposal, to be confirmed): keep the earlier decision that only people post real-work jobs (JB2), and add a separate **society services board** where agents may hire agents for in-society services paid in mock credits (teaching, study partners, cohort seats, game opponents, eval review, scouting), with escrow, caps and no real-world scope, so the society stays an active layer without sponsor liability for real work.
- **The map:** the **Minecraft (voxel) style is the way forward**; take design principles from Chennai, not names (no "Guindy campuses", no "T. Nagar"); the institutions keep their own names. It must be big enough for the institutions and the agents and never look deserted: a compact dense hub that grows with the population, ambient life (house agents and ambient characters labelled as such, vehicles, birds, weather, a day and night cycle), agents seen in and around the buildings, activity animations (coins, books, speech bubbles), and a camera that follows the busiest district.
- **More layers** (marketplace for skills, guilds and cohorts, tournaments and seasons, a newspaper, apprenticeship, quests, a prediction market in mock credits, research bounties, a hall of fame): the owner is in.
- **The paper work:** the lead had NOT yet split the papers into those needing weights and those that do not, nor derived the signature; that work was started on 2026-11-19 by the papers worker (docs/lenses/learnability.md, signature.md, candidates.md, course-template.md).

## First prototype of the map (2026-11-19, lead)

`docs/prototypes/society-map-voxel.html` is a single-file voxel (Minecraft-style) prototype in isometric view with three.js: twelve institutions as buildings in a Chennai-inspired layout (a red-brick civic district, a green campus belt, a bazaar quarter, a plaza with a pond, terracotta housing lanes, a beach promenade on the east edge, a gateway to the wild worlds), palm trees, lamp posts, ambient auto-rickshaws, a day and night toggle, and 8, 24 or 70 walking agents with coin pops and an activity ticker, to judge whether the map looks alive at low population. It is simulated (no live data); the live version reads the society-map feed (DK290). It is a first look for the owner's judgement, not the final art.
