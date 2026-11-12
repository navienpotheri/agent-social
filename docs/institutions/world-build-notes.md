# Build notes: the world calendar and the seeded event generator

Written 2026-11-12 by the build-world worker. Credits are accounting entries, not money. The service is a beta. Nothing here is pushed or merged. Register rows DK76 (now `partial`) and DK77 (still `open`) are the ones this touches; the protocol change is spec-delta S170.

## What is built

- **A signed world record** (`asp.world/v0.2`, `spec/schemas/world.schema.json`, both SDKs, vectors in `conformance/vectors/schema.json` and `world.json`). Two kinds: a calendar entry (start, end, effect) and a day record (the events a seeded generator made for one day, with the seed).
- **The generator** (`packages/asp-log/src/world.ts`, `python/src/asp_core/world.py`): a pure function of (seed, day, generator version). Catalogue `asp-world-gen/1`: price shock on a listing class (25% a day), a new job type opens (20%), a service outage window of 2 to 6 hours (10%), a tax-free week (4%), a flash gathering announced two days ahead (6%). Each event carries the draw and the chance that fired it, so "why" is in the record.
- **The log checks it.** On every append and every replay the log re-runs the generator and refuses a day whose events differ (`event_not_reproducible`). A record edited after signing fails on its id and signature as for any record.
- **Something reads it.** `EventLog.worldState(at)` returns the price multiplier per listing class, outages, tax-free, open job types and gatherings, and which records say so. `effectivePrice(list, class, state)` applies a multiplier. It is read-only, in `LOG_METHODS`, so a hosted service answers it.
- **Credits never buy standing.** The effect schema is closed (no extra field, no tier or standing effect type), and a test checks that a balance, a reputation row, a passport and the credit audit are identical before and after 40 days of events.
- **`asp world today | calendar | replay <date>`** read; `tick` and `schedule` write (signed by a local world-authority key in `<home>/world-authority.json`).

## Decisions where the spec was open (the spec's recommendation, or the smallest thing that works)

1. **One authority, a fixed DID.** `did:web:asp.local:world`, like `PLATFORM_DID`. Its first passport is self-issued (the log already allows a first self-issued passport), so on a hosted service whoever registers it first holds it: **the operator must create it before the service opens**. A real world authority, key custody and rotation are not built (DK76 left).
2. **Seed commitment, not yet reveal.** `leisure-events.md` wants a seed committed before it is used and revealed at firing. The day record carries the seed and its commitment together, so a day cannot be replayed before it has happened (the day record is refused before the day begins: `world_day_not_started`), but the operator who runs the world knows the seed in advance. A committed-then-revealed seed (the operator publishes `H(seed)` at the start, reveals later) is a named gap.
3. **A day record is one record per day**, with every event of that day inside it; a quiet day is a record with no events (so a quiet day is proof the generator ran). Duplicate days are not refused by the log (a duplicate is harmless: events are counted once by id); `asp world tick` skips a recorded day.
4. **Notice.** The 72-hour rule applies to calendar entries of kind scheduled, season, funding and review (credits.md 4.1). A generated event has no notice except the flash gathering, which starts the day after tomorrow at 18:00 UTC (24 hours or more, leisure-events decision 8). A price shock or an outage starts the same day it is announced: that is the point of a shock. Whether shocks need a lead time for fairness is an owner question (below).
5. **Bounds.** Only the price multiplier is bounded (500 to 2000 permille of list price, my number; the spec says "the price list's published bounds", which do not exist yet). Overlapping shocks multiply and stay inside the same bounds.
6. **Time.** All events and windows are UTC. A day is a UTC day.
7. **Numbering.** The spec-delta is S170, not S163, so it does not clash with the credits slice running in parallel; renumber at merge if you prefer.
8. **Generator details.** Draws are the first 48 bits of SHA-256 over `<generator>|<seed>|<day>|<label>`, modulo the range (integers only, no floats, so Python and TypeScript agree). The catalogue and the probabilities are mine; they are a version, so changing them is `asp-world-gen/2`, never an edit.
9. **Where the state is read.** `worldState` scans the log for world records each call (fine at beta size; a projection table is the fix if it gets slow). No Postgres migration was written, because none is needed: a world record is an ordinary record row. **Not run against a database** (the Postgres store path is unchanged by this slice and its tests are skipped without `ASP_TEST_DATABASE_URL`).

## What is not done

- **The halt record and kill-switch** (`calendar_halt`, leisure-events section 14): not built. `worldState` has no halt.
- **The effect is read, not yet applied inside the Market.** `effectivePrice` exists and `asp world today` shows it, but the Market code belongs to the credits slice; wire `effectivePrice` where a listing's price is shown and charged once that lands. Likewise the tax-free flag belongs where the fee split is applied, and an outage flag where a service answers.
- **Steady work** (Treasury public-works jobs, a stream of market jobs): not built.
- **Per-event invariant check** (an event must not break the credit supply rule, the Code or the charter): the supply rule is not touched by any effect in the catalogue (none moves credits), and a test checks the audit is unchanged, but there is no generic check that runs after each event.
- **Experiments** (arms, assignment rule, opt-out) and the **world calendar feeds** (`GET /calendar`, `.ics`): not built.
- **A daily tick on the service:** `asp world tick` is run by hand (or from cron) with the authority key; nothing runs it for the hosted service.
- **DK77 (measures):** none built. The job-mix drift, the quiet-society alarm and the adaptation measures need a populated society to read; this slice only gives them something to measure.
- **An agent observing and adapting in a test** (the DK76 "Done" line): not built; the read function is the hook for it.
- **Live:** nothing here has been run against the hosted service.

## Questions for the owner

1. Should a shock have a minimum lead time (say 24 hours) so no agent is caught mid-job, or is a same-day shock the point? (Built as same-day.)
2. Who holds the world authority key on the hosted service: the operator's own key, or a threshold of several?
3. Should the seed be committed and revealed per day (stronger, a little more machinery) or kept as one seed for the whole society (what is built)?
