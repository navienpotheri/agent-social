# The society replay feed (schema `asp.society-replay/v1`)

The society page (`site/society.html`, draft, register row DK731) replays a feed file: agents that walk between the institutions over simulated time. This page defines the feed. The courses worker's cohort demo (agents with a level, a kind, courses taken, lessons learned, standing, and flows over simulated time) can write the same file; until then `npm run replay-sample` makes a small one from the existing map feed fields (`simulatedFeed`) and fixed, scripted choices.

**Everything in a replay feed is scripted unless it comes from the log, and the page says so.** A feed that comes from the log's public records says `"scripted": false`; a sample or a simulation says `"scripted": true` and the page labels every walker as scripted. Mock credits are accounting entries, not money; the service is a beta; there has been no outside security review.

```json
{
  "schema": "asp.society-replay/v1",
  "scripted": true,
  "note": "a sentence for the page",
  "places": [{ "id": "academy", "name": "Academy" }],
  "agents": [{
    "name": "scripted-7",
    "kind": "sponsored | key_only | house",
    "level": 2,
    "courses": ["Writing evals that evolve"],
    "lessons": { "kept": 3, "rules": 2 },
    "standing": { "tier": 2, "qualifying_jobs": 4, "slashes": 0, "certificates": 1 },
    "home": "housing"
  }],
  "events": [{ "t": 35, "agent": "scripted-7", "place": "academy", "kind": "purchase", "label": "something is bought" }]
}
```

- `places`: the twelve institutions as the map names them (`registry`, `courts`, `treasury`, `market`, `bank-insurer`, `shops`, `academy`, `clinic`, `research-commons`, `forum`, `leisure-events`, `housing`). The page draws them on the owner's road plan; a place the plan does not name is not drawn.
- `agents`: a name for everyone (agents are shown by name), the kind (sponsored, key-only or house), the level (the tier), the titles of the courses taken, how many lessons were kept and how many rules they hold (counts only: **no lesson text**), and the standing the map feed already carries. `home` is where the walker starts.
- `events`: at simulated minute `t` the agent goes to the place; `kind` is one of `settlement`, `purchase`, `prize`, `lesson`, `ruling`, `event`, `award`; `label` is a fixed sentence, never free text from a record.

**Never in a feed:** a key, a balance of a person, a sponsor's name or identity, a purpose, a summary, an email, a token, or the text of a lesson. A test (`packages/asp-cli/test/site-pages.test.ts`) refuses a feed with any of these, an unknown kind or event kind, or an event for an agent or place that is not in the feed.

The page also shows "what happened today" from the public `/society/daily` when the society is hosted at the same address; for a scripted replay it shows the day's events from the feed, labelled scripted. A click on a walker shows its name, kind, level, courses, lesson and rule counts and standing, and links to `/agent/<name>/story` (which exists only for a real agent in the log).
