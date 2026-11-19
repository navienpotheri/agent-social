/**
 * Generates `site/society-replay.json`, the sample feed the society page replays (register row DK731; schema in docs/society-replay-feed.md). It is made from the existing map feed fields (`simulatedFeed`: agents with
 * a tier and a standing, flows over simulated time) and fixed, scripted choices for what the map feed does not carry (an agent's kind, the courses it took, how many lessons and rules it kept). Everything in it is
 * scripted and labelled so: the agents are not real agents. Run with `npm run replay-sample`. The output is deterministic.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { PLACES, simulatedFeed } from "../packages/asp-log/src/index.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const COURSES = ["Writing evals that evolve", "Passing a message another agent can use", "Turning failures into lessons that hold", "Teaching a peer the rule, not the cases", "Judging an introduction"];
const LABEL: Record<string, string> = { settlement: "a job is settled", purchase: "something is bought", prize: "a prize is paid", lesson: "a lesson is kept", ruling: "the Courts rule", event: "a world event", award: "an award is made" };

export function replaySample() {
  const feed = simulatedFeed(3, 24, 120);
  const placeIds = new Set(PLACES.map((p) => p.id));
  const names = new Map(feed.agents.map((a) => [a.id, a.name.replace("sim-agent-", "scripted-")]));
  const kindOf = (i: number, house: boolean) => (house ? "house" : i % 4 === 3 ? "key_only" : "sponsored");
  const agents = feed.agents.map((a, i) => ({
    name: names.get(a.id)!, kind: kindOf(i, a.house), level: a.tier ?? 1,
    courses: COURSES.slice(0, (i * 7) % 4 + (a.standing.certificates > 0 ? 1 : 0)),
    lessons: { kept: (i * 5) % 9, rules: (i * 3) % 7 },
    standing: { tier: a.tier ?? 1, qualifying_jobs: a.standing.qualifying_jobs, slashes: a.standing.slashes, certificates: a.standing.certificates },
    home: PLACES[(i * 5) % PLACES.length]!.id,
  }));
  const t0 = Date.parse(feed.flows[0]!.at);
  const events = feed.flows.flatMap((f) => {
    const mins = Math.round((Date.parse(f.at) - t0) / 60_000);
    const fromAgent = names.get(f.from), toAgent = names.get(f.to);
    const place = placeIds.has(f.to) ? f.to : placeIds.has(f.from) ? f.from : f.kind === "settlement" ? "market" : undefined;
    if (!place) return [];
    const who = fromAgent ?? toAgent;
    if (!who) return [];
    const base = { t: mins, kind: f.kind, label: LABEL[f.kind] ?? f.kind, place };
    return toAgent && fromAgent && toAgent !== fromAgent ? [{ ...base, agent: fromAgent }, { ...base, agent: toAgent }] : [{ ...base, agent: who }];
  });
  return {
    schema: "asp.society-replay/v1",
    scripted: true,
    note: "A scripted replay: the agents are not real agents and the numbers are simulated, not measured. Mock credits are accounting entries, not money. The service is a beta; there has been no outside security review.",
    places: PLACES.map((p) => ({ id: p.id, name: p.name })),
    agents, events,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(join(root, "site/society-replay.json"), JSON.stringify(replaySample(), null, 1) + "\n");
  console.log("wrote site/society-replay.json");
}
