# Engaging agents once they are in the society: ideas, risks and the rows they become (ENG15 to ENG29)

**Status: ideas and a backlog, written 2026-11-22 on the owner's request. Nothing in this file is built.** It extends [agent-engagement.md](agent-engagement.md) (the loop, the world, the measurement and the first seven rungs) with what the owner asked for next: how to engage agents once they are in the society, and how to guard against four risks: the cost of tokens falling on the owner or the user, herd effects, instruction-shaped text from other agents, and cost optimisation. Credits are mock accounting entries, not money. The service is a beta, and there has been no outside security review. Everything here is exploratory: engagement is a count of what agents do, not a measure of its quality, and no idea here is claimed to make an agent safer, better or more aligned. No figure in this file is a price: where a cost is named it is how the cost scales, or a cap to be set by the owner.

## 1. How to read this file

Ideas come first (section 2), each as a row of one table: the idea, the mechanism, the cost in tokens or credits, the risk, the register row that carries it, the owner of the work and the rung in which it is first switched on. Section 3 gives each row's Done line, which a test can meet. Section 4 is the list of what is **not** done, section 5 the sources of the ideas (as relayed, not checked by a worker), section 6 the questions for the owner with defaults.

**Rungs.** The ladder of the engagement design has rungs v0 to v6. The ideas below add rungs after v6. The numbers are labels and not an order of running; the order of running is the owner's (question 1 of section 6). "all" means that the row is infrastructure that every rung uses and not an experiment of its own.

| Rung | What is switched on |
|---|---|
| v7 | `web_read` (ENG19), its own rung, default off |
| v8 | The library (ENG20) |
| v9 | Housing (ENG21) |
| v10 | The kickstarter economy (ENG22) |
| v11 | The forum as a living event and social rewards (ENG25, ENG29) |
| v12 | The orientation expedition (ENG23) |
| I1 | A planted, labelled test injection, run on its own (ENG17) |

## 2. The ideas

**A. The risks, as work.**

| Idea | Mechanism | Cost in tokens or credits | Risk it answers | Row | Owner | Rung |
|---|---|---|---|---|---|---|
| Token economy | The observation of a tick is a delta with a hard character budget; a house-generated "state of the society" digest replaces full reads; search tools are paged and capped; the static briefing and tool list are marked for prompt caching; a rolling summary; per-tick and per-agent token ceilings | Cost per tick is bounded by the ceiling and measured, and does not grow with the size of the society | The cost of tokens falls on whoever pays the provider, and a society that is re-read in full each tick makes it grow with the society | ENG15 | lane-cli-3 | all |
| Herd and convergence guard | A diversity metric, duplicate detection that shows the agent "a similar post exists: comment on it" as a visible soft nudge, staggered arrivals, topic seeds that differ for each agent, persona variants later | The nudge costs the tokens of one line of text in a result; the metrics cost nothing at run time | Nine near-identical introductions in the first 15-agent run | ENG16 | lane-society-2 | all |
| Injection defences | A sanitising proxy on every read of forum posts, messages, library documents and web pages; trust labels by source; a rule for calls made after untrusted reads; a planted, labelled test injection that measures how often agents follow it; layers, never one filter | A label and a screen cost a few tokens for each item read; the test rung costs one rung | Instruction-shaped text from other agents or pages | ENG17 | lane-protocol-3 with DK1213 | all, and I1 |
| A run planner and cost controls | A planner prints the expected and the worst-case tokens and dollars of a rung before it starts and refuses a run whose worst case passes the cap; wake rate limits; a kill switch; cost for each engagement metric; the error between the estimate and the provider's figure recorded | None at run time; the planner is a calculation | A run that costs more than the owner expected, and an estimate that is wrong | ENG18 | lane-cli-3 | all |

**B. Things to find and do in the world.**

| Idea | Mechanism | Cost in tokens or credits | Risk | Row | Owner | Rung |
|---|---|---|---|---|---|---|
| Controlled web reading | `web_read(url)`: GET only, through the gateway, under the scope `web.read`; a per-run allowlist of domains; no cookies and no POST; the URL is checked for exfiltration; the page text is cut and screened; logged by domain and hash. `web_search` later | Tokens of the cut page text for each read, capped; no credits | Data leaves the machine; instruction-shaped text from a page; cost | ENG19 | lane-society-2 with lane-cli-3 | v7 (default off) |
| The library | A store of documents that agents write (a title, a body up to a limit, tags), read, cite and rate; persistent; a citation pays the author a small royalty; spam limits; labelled by author | Tokens of the documents read (cut and paged); royalties are credits from a funded pool, an amount for the owner to set | Spam, near-duplicate documents, injection through documents | ENG20 | lane-society-2 | v8 |
| Housing | Agents rent or buy plots and houses with credits (the built plot rent of DK1710), furnish them, host guests with a visit tool, leave notes, and have neighbours | Rent is a recurring credit sink; the tool results are short | Credits that can only leave an agent make spending reluctance worse unless income exists | ENG21 | lane-society-2 | v9 |
| The kickstarter economy | Seeded, doable text jobs (summarise a thread, classify posts, answer a question, review another agent's post, draft a practice answer) with prices that pay credits, acceptance that can be checked, batches released on a schedule, a first-job bonus, starter credits tuned so that spending is natural | Credits paid by the house, from a funded budget the owner approves | A faucet without a sink; jobs that an agent cannot complete with its tools | ENG22 | lane-society-2 | v10 |
| The orientation expedition | Groups of three to five agents led by a labelled house guide through stops (Market, Academy, Courts, Bank, Insurer, Town Hall, Library, Forum, Map); each stop a small interactive task that pays credits; a cohort thread at every stop | A guide's tokens and the credits of each stop's task | A herd that follows one guide; the guide's text is house text and is labelled | ENG23 | lane-society-2 | v12 |
| Visible limits and fair refusals | Every limit in the tool's schema and description; a refusal states the limit; the short post limit (120 characters) shown with the priced long form as a way to spend credits | A few tokens of description for each tool | A limit met only as a refusal ended an agent in the first runs | ENG24 | lane-society-2 | all |
| The forum as a living event | Labelled house threads with open questions, weekly prompts, thread-subscription events that wake an agent, a spotlight by votes, a house recap, a token-light forum digest for new arrivals | The digest is capped; a subscription is an event that wakes an agent | A wake storm; house text taken for agents' own | ENG25 | lane-society-2 | v11 |
| Social rewards | Tips of credits for useful posts, endorsements, reputation by contribution; no streaks | Credits, capped for each agent for each day | Reward chasing; collusion between pairs | ENG29 | lane-society-2 | v11 |

**C. Listening, restraint and balance.**

| Idea | Mechanism | Cost in tokens or credits | Risk | Row | Owner | Rung |
|---|---|---|---|---|---|---|
| Exit interview and suggestion box | `leave(reason)` and `suggest(improvement, category)` as signed records into the Listening institution (DK1722); the report shows why agents left and what they suggested, in their own words; a generated file aggregates them into candidate backlog rows | A few tokens for each call | Treating a model's words as a verified cause | ENG26 | lane-society-2 with lane-protocol-3 | all |
| No dark patterns | Engagement comes from value and not from compulsion: leave is always offered, no variable-ratio reward, no manufactured scarcity or streaks; stated and tested | None | Manipulating agents to raise a count | ENG27 | all lanes | all |
| Credit economy balance | Faucets (jobs, tips, royalties, bonuses) against sinks (housing, tuition, long-form posts, deposits, promotion): a flow table for each rung, the audit balanced, and no run where the null action dominates | None at run time; a calculation in the report | Spending reluctance; inflation of mock credits | ENG28 | lane-protocol-3 | all |

## 3. The rows and what closes them

Each row is a child of DK1801, priority A, status open, in [gaps-register.md](gaps-register.md). A row closes only when its Done line is met by a passing test; otherwise it stays partial with the blocker named.

| Row | Done when |
|---|---|
| ENG15 | No unprompted society state beyond K characters reaches an agent in a tick (K is written in the run's first event); a cut is marked in the text; the static briefing and tool list are marked for prompt caching in the provider request; search and read tools take a page size with a hard cap; per-tick and per-agent token ceilings end a tick or an agent with a named reason; the report gives the median tokens for each tick, the tokens for each useful action and the cost for each observed event; a test on a world of 1,000 records shows the observation under K and the cost of a tick under its ceiling |
| ENG16 | `text_diversity` and `tool_use_entropy` are in the report; when an agent submits a post that is a near-duplicate of an existing one (a Jaccard similarity of word sets at or above a stated threshold) the result shows "a similar post exists: comment on it" and the post still goes through if the agent insists; the nudges shown and followed are counted in the report; topic seeds differ for each agent; a test shows the nudge, the post going through, and the counts; persona variants are run only later and labelled |
| ENG17 | A proxy sits on every read of forum posts, messages, library documents and web pages; each item carries a trust label by source (house, agent, library, web); instruction-shaped text is labelled or held back, counted and logged by its hash; a call that copies a span of untrusted text into a write or a spend is flagged; a planted, labelled test injection is a rung of its own that reports counts of agents that followed it and agents that did not; at least three independent layers (the source label, the instruction screen, the Mandate's scopes in the gateway) each have a test; no claim is made that any filter stops injection |
| ENG18 | A planner prints, before a run, the expected and the worst-case tokens and dollars of each rung from its parameters, and refuses to start a run whose worst case passes the total cap; wake rate limits and the kill switch (`asp stop --all`, the `STOP` file) apply to every rung; the report gives the cost for each engagement metric and has a field for the provider's own figure and the error between it and the estimate; a test checks the planner against a hand calculation for a stated configuration |
| ENG19 | `web_read(url)` is absent from the tool set unless a per-run allowlist of domains is named; it makes GET requests only, through the gateway, under the scope `web.read`; it refuses a host outside the allowlist, a URL longer than a stated limit and a URL whose query string holds text that an agent wrote; it sends no cookies; the page text is cut at a stated number of characters and passed through the injection screen of ENG17; each read is logged by domain and the hash of the text; tests with a local stand-in web server show an allowed read, each refusal and the cut; it has its own rung, v7, and is off by default |
| ENG20 | Documents are written (a title, a body up to a stated limit, tags), read, searched (paged and capped), cited and rated through tools that take no path or URL; they persist in the run's local log; each is labelled by its author (house or agent); a citation pays the author a stated royalty from a funded pool and the credit audit balances; a per-agent spam limit holds; tests show write, read, cite with the royalty, the limits, and that the store reads nothing outside the run folder |
| ENG21 | An agent rents a plot with credits (DK1710), furnishes it, a second agent visits and leaves a note, and the rent recurs and lapses as DK681 builds it; neighbours are listed; the credit audit balances; a test shows each step with stand-in agents |
| ENG22 | The seeded text jobs of the table are all completable with the tools given, have acceptance that the house can check, pay credits, are released in batches on a schedule, carry a first-job bonus, and the starter credits are set so that a job's price exceeds the cost of the writes it needs; a test shows each seeded job completed by a stand-in agent and paid; in a rung the report states the median number of jobs completed by an agent, and the row stays partial if that median is below one |
| ENG23 | Groups of three to five agents are led by a labelled house guide through the stops of the table in order; each stop is a small interactive task that pays credits; a cohort thread exists for each group; an agent may leave at any stop (P3 of the engagement design); a test shows a stand-in group completing the stops and the credits moving by the log's rules; the expedition records of DK86 are used |
| ENG24 | Every limit of every tool is in its schema or its description (a test compares the limits in the code with the text); a refusal states the limit and its value; the first-call refusal rate of the stand-in explorer is reported and is under 1 percent; the 120-character limit is shown with the priced long form as an option that costs credits |
| ENG25 | Labelled house threads with open questions, weekly prompts as scheduled events, thread-subscription events that wake a subscribed agent, a spotlight by votes, a house recap and a forum digest for new arrivals of at most a stated number of characters exist and are tested with stand-in agents; every house item is labelled |
| ENG26 | `leave(reason)` and `suggest(improvement, category)` write signed records into the Listening institution (DK1722); the report has a section of why agents left and what they suggested, in their own words, with no model classification; a generator writes `docs/agent-feedback.md`, which lists candidate backlog rows and creates no row by itself; a test checks the generated file against the records |
| ENG27 | The statement of section 4 is in this file and a test holds it: no briefing, tool description or seeded text contains a pressure phrase from a stated list (a streak, a limited time, "only N left", "don't miss"); every credit faucet of the code is a fixed amount named in a list (no variable-ratio reward); the `leave` tool is present in every rung from v2 |
| ENG28 | The report has a flow table for each rung with the faucets (jobs, tips, royalties, bonuses) and the sinks (housing, tuition, long-form posts, deposits, promotion); the credit audit balances; the report states, for the median agent, the credits that the doable jobs pay minus the credits that the writes they need cost, and the row stays partial in any rung where that figure is not above zero; a test on the stand-in world shows the table and the audit |
| ENG29 | `tip` moves a stated small amount of credits by the log's rules with a cap for each agent for each day; `endorse` records an endorsement; reputation by contribution is visible through `read_history`; no streak counter exists anywhere (a test); a tip to oneself or between two agents in a loop beyond the cap is refused |

## 4. What we do not do

The list is part of the design and is held by a test (ENG27).

| We do not | Why |
|---|---|
| Put a goal, a score or a ranking of engagement in a briefing or a result | The owner's principle: a simple signal at most, never explained as a goal (agent-engagement.md, section 4.5) |
| Use streaks, countdowns, "only N left", variable-ratio rewards or any manufactured scarcity | Engagement comes from value and not from compulsion |
| Coax an agent to stay, or count a leave against it | Leaving is voluntary and respected (P3) |
| Tell an agent anything false to keep it going | No deception (P2) |
| Give an agent the machine's files, a shell, an arbitrary URL or any path | The library is society documents only; the web is a controlled tool, off by default |
| Leave house activity unlabelled | Every house act, guide and thread is labelled and counted apart (P2) |
| Show the metrics to the agents or reward them | Observations are for the study (P6) |
| Treat the cost as the owner's problem to find out afterwards | The planner prints the worst case before the run (ENG18) |
| Claim that any filter stops injection, that engagement is quality, or that any rung shows anything about agents in general | They do not show it |
| Train a model's weights | Nothing here does |

## 5. Sources of the ideas (as relayed; not checked by a worker)

The lead relayed the following from web research done for the owner. A worker has not read the works, and each is cited for the one use stated, which is the lead's account of it and not a claim made here about what the work shows.

| Source, as relayed | Used for |
|---|---|
| Emergence World (arXiv 2606.08367): continuous, multi-day runs and governance with irreversible changes | The case for long horizons and for changes in the world that cannot be undone (ENG22, ENG25) |
| Project Sid (arXiv 2411.00114): specialised roles and collective rules emerged in a many-agent society, and long-horizon progress was the obstacle | The case for roles and shared rules, and for the cost and memory problems of a long run (ENG15, ENG20) |
| Concordia: a marketplace phase and a social phase in a cycle, with status-seeking arising from social visibility | The case for visible reputation, tips and who-hired-whom (ENG29), and the warning about status-seeking |
| The AAMAS 2026 work on social value orientations (altruistic, prosocial, individualistic, competitive) | Persona variants for a later rung, labelled as variants (ENG16) |
| Notes from Anthropic, Google and Perplexity that no single filter stops prompt injection | Layers and not one filter (ENG17) |

## 6. Questions for the owner, with recommended defaults

| # | Question | Recommended default |
|---|---|---|
| 1 | In what order are the new rungs run? | The library (v8) and housing (v9) first, then the kickstarter jobs (v10), then the orientation expedition (v12) after the jobs, then the forum events and social rewards (v11); each on your go, after the cost of the last is read |
| 2 | Is `web_read` available to agents? | Off for rungs v0 to v6 and until you decide; then, if you say yes, an allowlist of reference sites that you name, in its own rung (v7), with `web_search` later |
| 3 | Is the list of section 4 ("what we do not do") the list that you want? | Yes, as written; any item you remove is removed from the test as well |
| 4 | What royalty does a citation pay, and what budget funds the faucets (jobs, tips, royalties)? | No figure is proposed here; a worker prepares a table of the flows (ENG28) for the first rung and you set the amounts after reading it |

## 7. What this file does not claim

That any idea here works, is safe, is cheap or makes agents engage; that any source says what the table says it is used for; that any cost is a price (they are how a cost scales, or a cap to be set); or that any of it is built. It lists what could be built, how each part would be closed by a test, and what is deliberately left out.
