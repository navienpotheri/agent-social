/**
 * Fleets are clearly demarcated in the society (register row DK1367): the fleet page and the list, the fleet mark on the journey, the leaderboards and the job board, the fleet's district on the map feed, the filters, the
 * registry page's pointer, and the work inside a fleet. Run on seeded fleets (a record of the fleet and the passports' `fleet` field). Credits are accounting entries, not money.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { fleetDirectory, fleetOfAgent, findFleet, publicReply, societyMap } from "../../asp-log/src/index.ts";
import { journeyRoutes } from "../../asp-package/src/journey-pages.ts";
import { storyRoutes } from "../../asp-package/src/story-pages.ts";
import { fleetRoutes } from "../../asp-package/src/fleet-pages.ts";
import { credit, keysOf, kit, mk, nowIso, operator, party, type Party } from "../../asp-log/test/society-kit.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const PAY = "did:web:example.com:fleets:payments", RES = "did:web:example.com:fleets:research";

async function society(seed = true) {
  const k = await kit();
  await k.withPrices();
  const org = await k.person("fl-org", 600);
  const other = await k.person("fl-other", 600);
  const poster = await k.person("fl-poster", 900);
  const names: Record<string, string> = {};
  if (seed) {
    await k.log.append(mk("fleet", org, { did: PAY, org: org.did, name: "Payments", purpose: "Keep payments tests green", template: { runtime: "claude-code", model: "test-model" }, max_members: 5 }, null, { subject: PAY }));
    await k.log.append(mk("fleet", org, { did: RES, org: org.did, name: "Research", purpose: "Read papers and summarise them" }, null, { subject: RES }));
  }
  /** An agent whose passport names a fleet (the kit's own `agent` does not set one). */
  const mkAgent = async (n: string, sponsor: Party = org, fleet?: string): Promise<Party> => {
    const a = party(`did:web:example.com:agents:${n}`);
    await k.log.append(mk("passport", sponsor, { did: a.did, kind: "agent", sponsor: sponsor.did, tier: 1, shape: {}, keys: keysOf(a), ...(fleet ? { fleet } : {}) }, null, { subject: a.did }));
    await k.mint(a.did, 300);
    return a;
  };
  const pa = await mkAgent("fl-pay-a", org, seed ? PAY : undefined);
  const pb = await mkAgent("fl-pay-b", org, seed ? PAY : undefined);
  const ra = await mkAgent("fl-res-a", org, seed ? RES : undefined);
  const lone = await mkAgent("fl-lone", other);
  void names;
  if (seed) {
    await k.runJob(poster, pa, 60);   // work for a principal outside the fleet
    await k.runJob(pb, pa, 40);       // work inside the fleet
    await k.runJob(poster, ra, 50);
    await k.runJob(poster, lone, 30);
  }
  const expires = "2027-06-01T00:00:00Z";
  for (const by of [pa, ra, lone]) {
    const mandate = await k.openMandate(by, [{ institution: "market", cap: credit(30), period: "month" }]);
    const intent = await k.intent(by, { purpose: `A job from ${by.did.split(":").pop()}`, class: "routine", budget: credit(40), skills: ["code"] });
    const deposit = await k.buy(by, "market.posting.deposit", 2, { mandate });
    await k.log.append(mk("market_act", by, { act: "posting", intent, board: "main", expires, deposit }));
  }
  const stored = async () => (await k.log.since(0, 100000)) as never;
  const balances = async (dids: string[]) => { const m = new Map<string, number>(); for (const d of dids) m.set(d, await k.log.balance(d)); return m; };
  const routes = [journeyRoutes({ stored, balances, operator: operator.did, now: nowIso }), storyRoutes({ stored, balances, operator: operator.did, now: nowIso }), fleetRoutes({ stored })];
  const server = createServer(async (req, res) => { for (const r of routes) if (await r(req, res)) return; res.writeHead(404); res.end(); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r)); servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const get = (path: string, accept = "text/html") => fetch(base + path, { headers: { accept } });
  return { k, get, pa, pb, ra, lone, org, stored };
}

test("DK1367: the directory reads fleets, members, the work inside a fleet and the work for others from the records; an agent whose passport names no declared fleet is in none", async () => {
  const w = await society();
  const dir = fleetDirectory((await w.stored()) as never);
  assert.deepEqual(dir.fleets.map((f) => [f.name, f.members.map((m) => m.name)]), [["Payments", ["fl-pay-a", "fl-pay-b"]], ["Research", ["fl-res-a"]]]);
  const pay = findFleet(dir, "Payments")!;
  assert.equal(pay.id, PAY);
  assert.equal(findFleet(dir, PAY), pay, "by did or by name");
  assert.equal(findFleet(dir, "Nope"), undefined);
  assert.deepEqual([pay.inside.contracts, pay.inside.accepted, pay.outside.accepted], [1, 1, 1], "one job inside, one accepted job for a principal outside");
  assert.equal(pay.maxMembers, 5);
  assert.deepEqual(pay.template, { runtime: "claude-code", model: "test-model" });
  assert.equal(pay.orgName, "fl-org");
  assert.deepEqual(fleetOfAgent(dir, w.pa.did), { id: PAY, name: "Payments" });
  assert.equal(fleetOfAgent(dir, w.lone.did), null);
  assert.ok(pay.not_yet.some((x) => /personas/.test(x)), "what is not carried yet is said");
});

test("DK1367: the fleet page: hero, members linked to their journeys, the work inside the fleet in words, the public record, the filter links; the list; JSON; an unknown fleet", async () => {
  const w = await society();
  const list = await (await w.get("/society/fleets")).text();
  assert.match(list, /<h1>Fleets<\/h1>/);
  assert.ok(list.includes('href="/society/fleets" aria-current="page"'), "the nav marks the Fleets page");
  assert.match(list, /Payments/);
  assert.match(list, /Research/);
  assert.match(list, /2 members of at most 5|2 members/);
  const page = await (await w.get(`/society/fleets/${encodeURIComponent(PAY)}`)).text();
  assert.match(page, /<h1>Payments<\/h1>/);
  assert.match(page, /Keep payments tests green/);
  assert.match(page, /\/agent\/did%3Aweb%3Aexample\.com%3Aagents%3Afl-pay-a\/journey/, "members link to their journeys");
  assert.match(page, /fl-pay-b/);
  assert.ok(!page.includes("fl-res-a"), "another fleet's member is not listed");
  assert.match(page, /Work between members of one fleet is related-party work/);
  assert.match(page, /1 contract between members of this fleet \(1 settled accepted\)/);
  assert.match(page, /\/society\/leaderboards\?fleet=/);
  assert.match(page, /\/market\/board\?fleet=/);
  assert.match(page, /Template: claude-code, test-model/);
  assert.match(page, /Not on this page yet/);
  const byName = await (await w.get("/society/fleets/Payments")).text();
  assert.match(byName, /<h1>Payments<\/h1>/, "a fleet is found by its name too");
  const json = (await (await w.get("/society/fleets/Payments", "application/json")).json()) as { ok: boolean; fleet: { id: string; members: { name: string }[] } };
  assert.equal(json.fleet.id, PAY);
  assert.deepEqual(json.fleet.members.map((m) => m.name), ["fl-pay-a", "fl-pay-b"]);
  const listJson = (await (await w.get("/society/fleets?format=json")).json()) as { fleets: { name: string; members: number }[] };
  assert.deepEqual(listJson.fleets.map((f) => [f.name, f.members]), [["Payments", 2], ["Research", 1]]);
  const missing = await w.get("/society/fleets/Nope", "application/json");
  assert.equal(missing.status, 404);
  assert.equal(((await missing.json()) as { error: { code: string } }).error.code, "NO_SUCH_FLEET");
  const missingPage = await w.get("/society/fleets/Nope");
  assert.equal(missingPage.status, 404);
  assert.match(await missingPage.text(), /class="err" role="alert"/);
});

test("DK1367: with no fleet declared the list says so and offers no member; an agent with no fleet is unmarked", async () => {
  const w = await society(false);
  assert.match(await (await w.get("/society/fleets")).text(), /class="empty" role="status"><b>No fleet yet<\/b>/);
  const j = await (await w.get("/agent/fl-pay-a/journey")).text();
  assert.ok(!/class="fleet"/.test(j), "no mark without a declared fleet");
});

test("DK1367: the journey carries the fleet mark for a member, in the page and the data, and none for an agent outside a fleet", async () => {
  const w = await society();
  const html = await (await w.get("/agent/fl-pay-a/journey")).text();
  assert.match(html, /<a class="fleet" href="\/society\/fleets\/did%3Aweb%3Aexample\.com%3Afleets%3Apayments"[^>]*>fleet: Payments<\/a>/);
  assert.match(html, /work inside a fleet is related-party work and never counts toward standing/);
  const data = (await (await w.get("/agent/fl-pay-a/journey?format=json")).json()) as { fleet?: { id: string; name: string } };
  assert.deepEqual(data.fleet, { id: PAY, name: "Payments" });
  const lone = await (await w.get("/agent/fl-lone/journey")).text();
  assert.ok(!/class="fleet"/.test(lone));
  const loneData = (await (await w.get("/agent/fl-lone/journey?format=json")).json()) as { fleet?: unknown };
  assert.equal(loneData.fleet, undefined);
  // a hire inside the fleet is shown as related-party in the member's journey (S1300)
  const inside = (await (await w.get("/agent/fl-pay-a/journey?format=json")).json()) as { steps: { related?: unknown }[] };
  assert.ok(inside.steps.some((s) => s.related), "work between two members of a fleet carries the related-party label");
});

test("DK1367: the leaderboards mark each fleet agent, offer a filter chip for every fleet, and ?fleet= shows only that fleet's agents; an unknown fleet is a 404", async () => {
  const w = await society();
  const all = await (await w.get("/society/leaderboards?week=2026-10-26")).text();
  assert.match(all, /role="group" aria-label="Filter by fleet"/);
  assert.match(all, />All agents</);
  assert.match(all, />Payments</);
  assert.match(all, /fl-pay-a[\s\S]{0,200}class="fleet"/, "the row of a fleet agent carries the mark");
  assert.match(all, /fl-lone/);
  const pay = await (await w.get(`/society/leaderboards?week=2026-10-26&fleet=${encodeURIComponent(PAY)}`)).text();
  assert.match(pay, /Leaderboards, fleet Payments/);
  assert.match(pay, /fl-pay-a/);
  assert.match(pay, /fl-pay-b/);
  assert.ok(!pay.includes("fl-res-a") && !pay.includes("fl-lone"), "only the fleet's own agents");
  assert.match(pay, /class="chip on" href="[^"]*fleet=did%3Aweb%3Aexample\.com%3Afleets%3Apayments"/);
  const byName = await (await w.get("/society/leaderboards?week=2026-10-26&fleet=Research")).text();
  assert.match(byName, /fl-res-a/);
  assert.ok(!byName.includes("fl-pay-a"));
  const json = (await (await w.get(`/society/leaderboards?week=2026-10-26&fleet=Payments`, "application/json")).json()) as { fleet: { name: string }; boards: { rows: { name: string; fleet?: { name: string } }[] }[] };
  assert.equal(json.fleet.name, "Payments");
  assert.ok(json.boards.every((b) => b.rows.every((r) => !r.fleet || r.fleet.name === "Payments")));
  const bad = await w.get("/society/leaderboards?week=2026-10-26&fleet=Nope", "application/json");
  assert.equal(bad.status, 404);
});

test("DK1367: the job board marks a posting by a fleet agent and filters by fleet (id or name), on the log and on the public route", async () => {
  const w = await society();
  const all = await w.k.log.marketBoard();
  assert.equal(all.length, 3);
  const mark = (did: string) => all.find((e) => e.poster === did)?.posterFleet;
  assert.deepEqual(mark(w.pa.did), { id: PAY, name: "Payments" });
  assert.deepEqual(mark(w.ra.did), { id: RES, name: "Research" });
  assert.equal(mark(w.lone.did), undefined, "a posting by an agent outside a fleet carries no mark");
  for (const q of [PAY, "Payments"]) assert.deepEqual((await w.k.log.marketBoard(undefined, undefined, { fleet: q })).map((e) => e.poster), [w.pa.did]);
  assert.deepEqual(await w.k.log.marketBoard(undefined, undefined, { fleet: "Nope" }), []);
  const reply = await publicReply(w.k.log as never, "/market/board?fleet=Research", false);
  const result = (reply!.json as { result: { poster: string; posterFleet: { name: string } }[] }).result;
  assert.deepEqual(result.map((e) => [e.poster, e.posterFleet.name]), [[w.ra.did, "Research"]]);
});

test("DK1367: the map feed has a district for each fleet that has members and puts the fleet mark on each member; the registry page points to the fleet's page", async () => {
  const w = await society();
  const h = await w.k.log.head();
  const feed = societyMap({ stored: (await w.stored()) as never, head: { seq: h.seq, hash: h.logHash }, now: nowIso(), rep: new Map(), operator: operator.did });
  const districts = feed.places.filter((p) => p.fleet);
  assert.deepEqual(districts.map((p) => [p.id, p.name]), [[`fleet:${PAY}`, "Fleet: Payments"], [`fleet:${RES}`, "Fleet: Research"]]);
  assert.equal(feed.places.filter((p) => !p.fleet).length, 12, "the twelve institutions are unchanged");
  assert.deepEqual(feed.agents.find((a) => a.id === w.pa.did)!.fleet, { id: PAY, name: "Payments" });
  assert.equal(feed.agents.find((a) => a.id === w.lone.did)!.fleet, undefined);
  const page = await publicReply(w.k.log as never, `/registry/agents/${encodeURIComponent(w.pa.did)}`, true);
  assert.match(page!.html ?? "", /\/society\/fleets\/did%3Aweb%3Aexample\.com%3Afleets%3Apayments/);
});
