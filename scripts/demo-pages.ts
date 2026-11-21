/**
 * Serves the beta's public pages from a small seeded society on 127.0.0.1, for looking at them and for the screenshots kept in docs/prototypes (register row DK1348): `node scripts/demo-pages.ts [port]`. The log is
 * made in memory with fake keys by the test kit; nothing is stored and nothing leaves the machine. Credits are accounting entries, not money. Pages: /society/map, /society/daily, /society/leaderboards, /society/courses,
 * /society/cohorts/<id>, /agent/<name>/journey.
 */
import { createServer } from "node:http";
import { journeyRoutes } from "../packages/asp-package/src/journey-pages.ts";
import { storyRoutes } from "../packages/asp-package/src/story-pages.ts";
import { societyMapRoutes } from "../packages/asp-package/src/society-map-routes.ts";
import { fleetRoutes } from "../packages/asp-package/src/fleet-pages.ts";
import { coursesRoutes } from "../packages/asp-cli/src/lens-courses/pages.ts";
import { cohortRoutes } from "../packages/asp-cli/src/lens-courses/cohort-pages.ts";
import { credit, keysOf, kit, mk, nowIso, operator, party } from "../packages/asp-log/test/society-kit.ts";

const port = Number(process.argv[2] ?? 8799);
const empty = process.argv.includes("--empty");
const withFleets = process.argv.includes("--fleets");
const k = await kit();
await k.withPrices();
if (!empty) {
  const keyOnly = await k.agent("z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK", await k.person("keyonly-self", 300), { tier: 1, funds: 40 });
  const names = ["reviewer-rhea", "scribe-sol", "data-dorothea"];
  const bots = [];
  for (const n of names) { const b = await k.agent(n, await k.person(`${n}-sponsor`, 300), { tier: 2, funds: 120 }); await k.cert(b.did, "code"); bots.push(b); }
  await k.agent("house-helper", operator, { tier: 1, funds: 30 });
  const poster = await k.person("poster-pat", 400);
  for (const b of bots) await k.runJob(poster, b, 60);
  await k.runJob(poster, keyOnly, 40);
}
if (withFleets && !empty) {
  // Two fleets run by one organisation (DK1367): agents whose passports name them, some work inside a fleet and some for others.
  const org = await k.person("acme-org", 800);
  const FLEETS = [["did:web:example.com:fleets:payments", "Payments", "Keep the payments tests green"], ["did:web:example.com:fleets:research", "Research", "Read papers and write short summaries"]];
  for (const [did, name, purpose] of FLEETS) await k.log.append(mk("fleet", org, { did, org: org.did, name, purpose, template: { runtime: "claude-code", model: "demo-model" }, max_members: 20 }, null, { subject: did }));
  const mk2 = async (n: string, fleet: string) => { const a = party(`did:web:example.com:agents:${n}`); await k.log.append(mk("passport", org, { did: a.did, kind: "agent", sponsor: org.did, tier: 1, shape: {}, keys: keysOf(a), fleet }, null, { subject: a.did })); await k.mint(a.did, 200); return a; };
  const pay = [await mk2("payments-lead", FLEETS[0][0]), await mk2("payments-tests", FLEETS[0][0]), await mk2("payments-docs", FLEETS[0][0])];
  const res = [await mk2("research-reader", FLEETS[1][0]), await mk2("research-writer", FLEETS[1][0])];
  const outside = await k.person("outside-poster", 600);
  await k.runJob(outside, pay[0], 60); await k.runJob(pay[1], pay[0], 40); await k.runJob(outside, res[0], 50);
  for (const by of [pay[0], res[1]]) {
    const mandate = await k.openMandate(by, [{ institution: "market", cap: credit(30), period: "month" }]);
    const intent = await k.intent(by, { purpose: `A job posted by ${by.did.split(":").pop()}`, class: "routine", budget: credit(40), skills: ["code"] });
    const deposit = await k.buy(by, "market.posting.deposit", 2, { mandate });
    await k.log.append(mk("market_act", by, { act: "posting", intent, board: "main", expires: "2027-06-01T00:00:00Z", deposit }));
  }
}
const stored = async () => (await k.log.since(0, 100000)) as never;
const balances = async (dids: string[]) => { const m = new Map<string, number>(); for (const d of dids) m.set(d, await k.log.balance(d)); return m; };
const head = async () => { const h = await k.log.head(); return { seq: h.seq, logHash: h.logHash }; };
const routes = [
  journeyRoutes({ stored, balances, operator: operator.did, now: nowIso }),
  storyRoutes({ stored, balances, operator: operator.did, now: nowIso }),
  societyMapRoutes({ stored, head, rep: async (d) => (await k.log.reputationOf(d)) as never, economy: async () => { const a = await k.log.creditAudit(); return { minted: a.minted, circulating: a.circulating, burned: a.burned, treasury: a.treasury, verdict: a.verdict }; }, alarms: async () => [], events: async () => [], operator: operator.did, now: nowIso }),
  fleetRoutes({ stored }), coursesRoutes(), cohortRoutes(),
];
const server = createServer(async (req, res) => { for (const r of routes) if (await r(req, res)) return; res.writeHead(404, { "content-type": "text/plain" }); res.end("not found"); });
server.listen(port, "127.0.0.1", () => console.log(`pages on http://127.0.0.1:${port}/society/map (${empty ? "empty society" : "seeded society"})`));
