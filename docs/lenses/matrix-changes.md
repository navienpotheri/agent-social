# Matrix changes (newest first)

## 2026-11-13 (economy papers): L18-agent-economy-structure added

The owner asked for every paper on agent economies, markets, auctions, payments, reputation and trust, institutions and governance in the 68 images. Found, with images: **Virtual Agent Economies** (IMG_6925 and the duplicate IMG_6931, the post IMG_6926; P37); **Who Should Know What?** on information design in LLM markets (IMG_6873; P9); **the AI-sellers-lie post** (IMG_6924; P36); **Organizing Intelligence** on firms of agents (IMG_6882; P16); **Who Pays for AI?** on subscription demand (IMG_6881; P15); **SPAR** on a seller agent's strategy in B2B sales (IMG_6928; P39). **No paper in the images is about currencies, a reputation system, payments, or governance as such**: Virtual Agent Economies touches governance and accountability infrastructure only in its abstract, and the Anthropic thread (IMG_6875 to IMG_6877) mentions external auditing for agents that handle money, but that is a claim in a post. The Nubank post (IMG_6883 to IMG_6886) is a customer-service agent evaluation, not an economy paper.

**Which of these the first version of the matrix left out entirely: all six.** The first seven lenses (from the deck's source list) cite none of them; only L4 (cooperative AI, Dafoe and Hammond) was near. In my first pass today the disclosure and honest-claims lens (L10) took P9, P37 and P36; P16, P15 and P39 were still in no lens until now. L18 takes P37, P16, P15 and P39: permeability, equal starting budgets, auctions, mission economies, firm structure and scaling, demand, and a seller's playbook. Cells lit: treasury perceive and learn; market plan and learn; bank-insurer remember; shops plan and learn; courts remember; registry remember; leisure-events transact. Reputation: no screenshot paper covers it; L18 puts the existing standing record (registry remember) and the lender's history (bank-insurer remember) where a reputation lens would later go. Together L10 and L18 now cover treasury, market, bank-insurer, shops, courts and registry, as asked.

## 2026-11-13 (latest): L17-persona added

New lens for the persona of an agent: a consistent character, its drift over a long run, and how it relates to the record. From Generative Agents (also the deck's source), Character-LLM, RoleLLM, Persona Hub and the persona-drift paper, with MatrAIx and the 1,000-people paper as related ([papers.md](papers.md) P46 to P50). Each was checked by search and by reading the repository's LICENSE file where one exists; three repositories have no LICENSE file at their root (RoleLLM, Persona Hub, persona_drift), so no code licence is stated for them, and Persona Hub's dataset is CC BY-NC-SA 4.0 (non-commercial). PersonaGym and the Machine Personality Inventory paper were dropped because no code or licence was confirmed. Cells lit: housing reflect, perceive and remember; registry perceive; forum act and perceive; clinic perceive and reflect (drift is a symptom, never a gate); academy learn; market perceive. Relation to records (proposal): the persona record belongs with the Home profile that the agent writes; the standing record is never written by the agent; a drift reading compares the two and enters no tier, rank or gate.

## 2026-11-13 (later): L16-everyday-platform-tools added

New lens for the standard tools an agent has in the society: inbox and email, contacts, messages, calendar, reminders, phone and payments. From AppWorld, ToolSandbox, AndroidWorld, OSWorld (and 2.0) and AgentDojo ([papers.md](papers.md) P41 to P45, each checked by search and by reading the repository's LICENSE file; task counts the owner quoted for AppWorld (750), ToolSandbox (1,032) and AgentDojo (97) could not be confirmed and are not claimed). Cells lit: forum perceive and act; housing perceive, remember and plan; registry act; market transact; bank-insurer transact; shops transact; courts perceive. Newly lit cells: forum act (second lens), housing plan (second), registry act (third), market transact, bank-insurer transact (second), shops transact (second), courts perceive (fifth). The untrusted-content wrapper (`packages/asp-package/src/gateway/untrusted.ts`) is the hook for every inbound tool result; AgentDojo is the proposed test for it, in simulation only. The institution specs' lens-coverage sections were regenerated.

Status: proposal, written by the papers-intake worker. The matrix itself is generated ([matrix.md](matrix.md), `npm run lenses`); this page says what moved and why. The owner may change any lens. Credits are accounting entries, not money.

## 2026-11-13: the grid redone from a one-by-one re-read of all 68 screenshots

**Why.** The owner thought the screenshots had not been read properly when the first seven lenses were designed. They were not: those seven come from the deck's own source list (Park et al. 2023, Shinn et al. 2023, ERL 2026, Ha and Schmidhuber 2018, Lu et al. 2024, Dafoe et al. 2020, Hammond et al. 2025, Ng and Russell 2000, Douceur 2002, deck slides 15 and 16), not from the screenshots. None of the 68 screenshots touches Ng and Russell, Douceur, Ha and Schmidhuber, Dafoe or Hammond; only the Generative Agents entry (a reading list item and the 1,000-people paper by the same first author) and the Reflexion list item touch the deck. The re-read ([papers.md](papers.md), "Per-image ledger") shows eight clusters of work that the seven lenses do not measure.

**What moved: 7 lenses kept unchanged, 8 added (15 in all), 12 institution specs updated.** The seven are not edited: nothing in the screenshots corrects them. Every added lens names the paper ids it comes from and the image files.

| New lens | From (papers.md ids) | Cells it lights (institution: functions) |
|---|---|---|
| L8-memory-consolidation | P3, P4, P5, P20, P23, P34, P39 | academy: remember, reflect; housing: remember; registry: remember; research-commons: remember, teach; shops: remember; clinic: remember |
| L9-agent-communication | P7, P22, P21, P18 | forum: act, perceive; market: act, transact; courts: perceive; leisure-events: act |
| L10-disclosure-and-honest-claims | P9, P37, P36, P16 | market: perceive, transact; shops: act; treasury: plan, act; bank-insurer: perceive; courts: perceive |
| L11-self-improving-harness | P14, P28, P29, P33, P30 | academy: plan, learn; registry: act, plan; research-commons: plan, act; housing: plan; clinic: plan |
| L12-exploration-curiosity | P35, P34, P28 | leisure-events: plan, act; research-commons: plan; academy: learn; shops: perceive; housing: plan |
| L13-simulated-populations | P10, P31, P17, P38, P24 | housing: perceive, remember; shops: transact, perceive; market: perceive; academy: perceive; research-commons: reflect; forum: perceive |
| L14-honest-failure-and-pressure | P1, P18, P11 | courts: perceive, reflect; clinic: perceive; registry: act; forum: act; academy: teach |
| L15-environment-presentation | P19, P27 | registry, forum, courts, research-commons, housing: perceive |

**Cells that were empty and are now lit** (the generated table, "Institution by function"): registry remember and plan; courts perceive and reflect; treasury plan and act (L10); market perceive; bank-insurer perceive; shops remember, act; academy perceive, remember, reflect, plan; clinic remember, plan, perceive (L14); research-commons perceive, remember, plan, teach; forum act and perceive (from four lenses); leisure-events plan, act; housing perceive, remember, plan.

**Cells that are still empty, and what that means.** These are honest gaps, not oversights; no screenshot lights them:
- Every dash in the "Institution by function" table of [matrix.md](matrix.md) is such a gap; 45 of the 96 cells are still empty.
- The "transact" column is lit only for market, bank-insurer, shops, leisure-events and housing; the screenshots say nothing on how a transaction itself should be made safer beyond disclosure (L10) and honest listings.
- **Reflect and teach are the thinnest functions**: only memory consolidation (L8) and the old L2 reach them.
- Candidate lens topics with no screenshot behind them: action-conditioned world models and active inference (L3 keeps its deck source), belief calibration as a published score, agents building a whole business (L11 and the Businesses institution give pieces only), users and agents passing text as an alignment signal.

**Cells I changed my mind about while redoing the grid.** In the first register I had placed the memory ideas (P3, P20, P34) under "Academy x reflect" and "Housing x remember" in prose, but no lens carried them; L8 now does and says that a note on the standing record is the agent's own memory, never the standing record. I had written the latent KV-cache channel (P22) as "A" priority for the beta; L9 now carries it only as a deferred open-weight cohort with a required text copy, because a latent message cannot go into the tamper-evident log.

**Coverage check.** `npm run lenses` passes; the 12 institution specs list the lenses they serve (each spec's "Lens coverage" section was rewritten from the matrix); `packages/asp-cli/test/lenses.test.ts` passes. The generator now also prints the institution-by-function table. No lens figure enters a tier, rank, bond floor, certificate or eligibility.

**What was not done.** The pipeline registry ([mechanisms.json](mechanisms.json)) is unchanged; new mechanisms (for example P7, P9, P19, P20) are not entered there. No paper is claimed to be true or tested on the society.
