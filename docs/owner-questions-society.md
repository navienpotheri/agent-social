# Owner questions from the society lane

One block per row. These rows were not started because closing them needs a decision, a live run with a real model agent, a lawyer or an outside party. Written by the society worker, 2026-11-21.

## DK1342: an agent can sit a course (ANSWERED 2026-11-21 via the lead: closed on the tested flow; the live demonstration is row DK1600)

The command and the service routes are built and tested with scripted agents (`lens-course-sit.test.ts`, `lens-course-sit-service.test.ts`). The row's Done line also asks for "a short live demonstration with a real model agent that sits one course end to end through the command and, separately, over the service". You postponed the live run with real model agents.

**Question:** keep DK1342 `partial` until the live run, and until then word the site's "an agent can sit a course" as "built and tested with scripted agents, not yet run live with a real model agent"? Or accept the tested flow as closing the row and track the live demonstration in the live-run checklist only?

Default if you do not answer: the row stays `partial`, and the claim stays in the "withdraw until done" bucket.

## DK1348: the beta pages look finished (ANSWERED: stays partial until the owner approves the screenshots in docs/prototypes/dk1348; the owner will review them)

The Done line includes "the owner's approval of the look". I can build the visual pass (one design language, light and dark, an icon or colour per institution, readable short names, hero summaries, empty and error states) and keep before and after screenshots in docs/prototypes, but the row cannot close without you looking at them.

**Question:** when the pass is built, will you review the screenshots in docs/prototypes and approve or send notes? Until then the row stays `partial` (built, not approved).

## DK740: a service-held agent's bond (ANSWERED: (b), counted at 50% until the agent binds its own key; a bond made after the bind counts in full; the label is shown either way)

The row needs a protocol rule: a bond backed by a service-held agent is refused, or counted at a stated discount. DK854's note says it waits on your answer to KO2.

**Question (KO2):** should a bond backed by a service-held agent be (a) refused, (b) counted at a discount (say what share, for example 50%), or (c) allowed with only the label shown? And does a bond created after the agent binds its own key count in full?

Default if you do not answer: not started; the label stays the only difference. This row is shared with the protocol lane.

## DK1302: agents hiring agents (ANSWERED: the first accepted job that unlocks the starter credits must come from a non-house principal of another sponsor at the existing minimum price of 20 credits; the live run stays postponed)

A built behaviour is possible (any enrolled agent posts a job, another offers, both balances move; a sponsor cluster that settles its own jobs does not unlock the starter credits), but the Done line also asks for "a live run with two spawned agents", which is a real-model-agent run you postponed. The row also says "a design choice on what counts as an accepted job is inside this row".

**Question:** (1) should the first accepted job that unlocks the starter credits have to come from a non-house principal of another sponsor, with at least some minimum price? (2) Is the live run with two spawned agents still postponed, so the row stays `partial` after the tests?

## DK380: the newcomer allowance offered inside `asp join` (ANSWERED: build it after the join text is final, before launch; do it last)

The gateway tool and the standing note's line are built. The remaining part is "the offer in `asp join` after a first course", which the row says needs the hosted join flow and a live run.

**Question:** is the hosted join flow final enough to build the offer into, or should the offer wait until after the launch?

## DK1358: the related-party track record (status open; protocol and economy, shared with lane-protocol)

The row asks for a clean-run record built from work inside a fleet (Actions and runs under the fleet's Mandate, attested by the sponsor) that "counts toward tier and toward the unlocking of the second tranche at a stated weight", never mixed with independent jobs. docs/enterprise-fleets.md says the opposite for the second tranche: "a job between agents of one sponsor, one organisation or one fleet never counts toward standing or unlocks the second 400". The two cannot both hold, and a rule that lets a fleet's own jobs release credits is a farming route (8 jobs of 20 credits between a fleet's agents release 400 starter credits at no net cost).

**Question:** (1) may related-party clean runs count toward TIER at a stated weight (for example 1 related run = 1/4 of an independent job), while never releasing the second tranche (the doc's rule)? (2) or should they also count toward the second tranche (with what weight and what farming guard)? (3) which of the three associations (full, related-party only, private) is the default for an enterprise?

Default if you do not answer: not started; related-party work stays labelled and counts for nothing, as today.

## DK1345, DK1346, DK1347: sources still to join the journey (status open)

The journey page lists each missing source with its row. DK1346 (direct messages) is a protocol change and its Done line asks for a live run with two agents; DK1347 (the sponsor's token and compute cost) asks for a live run on one real agent; DK1345 closes when the others do. All three Done lines name a live run with real model agents, which you postponed.

**Question:** may DK1347 close on the Action records' own token metrics (tested: a step's cost sums to the summary, the public view has no cost, the sponsor view shows the cap and a refusal past it), with the live run moved to a new row as for DK1342? If yes I will build it; DK1346 stays a protocol design for after the launch unless you want it at launch.

## Queue of 2026-11-21: what is left of DK731, DK290, DK1345, DK270, T2, U16 and US7 (all need something outside the society worker's lane)

I checked each row against the code and the register; nothing below can be closed by code and tests alone.

- **DK290 (live view of the society), status partial.** The feed, the replay and the page are built and tested (S360, S361). Left by its Done line: the recorded live run on the hosted service. **Question:** may the live run move to its own new row (as for DK1342 and DK1347) so DK290 closes on the tests? Default: it stays partial.
- **DK731 (the map on the website), status partial.** The draft page, the replay feed and the script test exist. Left: the page in the sitemap and the smoke script (both in `site/`, which this lane does not edit), the owner's approval of wording and look, and the three-dimensional prototype, which needs a self-hosted copy of three.js. **Question:** (1) shall the worker that owns `site/` add the page to the sitemap and the smoke script? (2) do you approve the wording and look, and may a self-hosted copy of three.js (about 600 KB, MIT licence) be added to the repository? Default: the 2D page only, not published.
- **DK1345 (journey shows every source), status open.** It closes when its sources close: reasoning (DK790, DK79), goals and beliefs (DK1315, DK60), worlds and expeditions (DK1317, DK1318), direct messages (DK1346), the compute meter (DK1313) and trajectory text (DK651). Those rows are open or in other lanes, and the journey page already lists each in 'Not on this page yet'. Nothing to build until one of them lands; when it does, its line leaves `NOT_YET` in `packages/asp-log/src/journey.ts` with a test.
- **DK270 (house agents run), status open.** The runner needs the hosted service and DK290's live view for its Done line. **Question:** may the runner and its test (a house agent posts, bids, delivers and settles on the test ledger; the stop switch halts it mid-run) be built now, with the hosted run in its own row? Default: not started.
- **T2 (first-minute failure modes), partial.** Left: a real laptop sleeping mid-session and a repository of several GB with a real agent. Both are live runs by you (docs/live-run-checklist.md).
- **U16 (newcomer finds the commands), partial.** Left: the landing page (O13, `site/`), trying it with people who have not seen the tool, more phrasings and languages for `asp ask`, the shim for Codex and Goose (the CLI lane's files). Nothing here is the society lane's.
- **US7 (safe presets for non-experts), open.** Permission presets `review`, `develop` and `full` already exist for `asp run`. The row also asks for presets by kind of work (coding, research, writing), tutorials, translations and a screen app. **Question:** which of these do you want for the beta? Default: presets by kind of work only (each a named bundle of the existing scopes, with a plain sentence of what it allows), the rest later.
