/**
 * Both kinds of fleet work end to end and the template's record is computed and shown (register row DK1366): a fleet of copies (one template, no persona) and a fleet of different agents (a persona each), the record of a fleet, of
 * each persona and of everyone who runs one template (across fleets), the fleet page and the Registry page that show them, (a fleet-mate's slash raising the bond floor is the log's rule, tested in packages/asp-log/test/reputation.test.ts). Fake keys only. Credits are accounting
 * entries, not money.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { fleetDirectory, findFleet, publicReply } from "../../asp-log/src/index.ts";
import { renderFleet, fleetRoutes } from "../../asp-package/src/fleet-pages.ts";
import { keysOf, kit, mk, party, type Party } from "../../asp-log/test/society-kit.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const T = { runtime: "claude-code", model: "model-one" };
const CLONES = "did:web:example.com:fleets:clones", STUDIO = "did:web:example.com:fleets:studio", OTHER = "did:web:example.com:fleets:other";

async function world() {
  const k = await kit();
  await k.withPrices();
  const org = await k.person("fk-org", 800);
  const poster = await k.person("fk-poster", 900);
  for (const [did, name, template] of [[CLONES, "Clones", T], [STUDIO, "Studio", T], [OTHER, "Other", { runtime: "claude-code", model: "model-two" }]] as const)
    await k.log.append(mk("fleet", org, { did, org: org.did, name, purpose: `The ${name} fleet`, template }, null, { subject: did }));
  const agent = async (n: string, fleet: string, persona?: string): Promise<Party> => {
    const a = party(`did:web:example.com:agents:${n}`);
    await k.log.append(mk("passport", org, { did: a.did, kind: "agent", sponsor: org.did, tier: 1, shape: {}, keys: keysOf(a), fleet, ...(persona ? { persona } : {}) }, null, { subject: a.did }));
    await k.mint(a.did, 200);
    return a;
  };
  const clones = [await agent("fk-clone-1", CLONES), await agent("fk-clone-2", CLONES), await agent("fk-clone-3", CLONES)];
  const studio = [await agent("fk-dev-1", STUDIO, "developer"), await agent("fk-dev-2", STUDIO, "developer"), await agent("fk-pm", STUDIO, "project-manager"), await agent("fk-ceo", STUDIO, "ceo")];
  const other = await agent("fk-other-1", OTHER);
  for (const a of [...clones, studio[0], studio[2]]) await k.runJob(poster, a, 40);
  await k.runJob(poster, other, 40);
  return { k, org, clones, studio, other, stored: async () => (await k.log.since(0, 100000)) as never };
}

test("DK1366: both fleet kinds are read from the log: a fleet of copies has one group and no persona; a fleet of different agents has a record for each persona", async () => {
  const w = await world();
  const dir = fleetDirectory((await w.stored()) as never);
  const clones = findFleet(dir, "Clones")!, studio = findFleet(dir, "Studio")!;
  assert.deepEqual(clones.personas, [], "copies: no persona");
  assert.deepEqual([clones.record.members, clones.record.settled, clones.record.accepted, clones.record.slashes, clones.record.slashPermille], [3, 3, 3, 0, 0]);
  assert.deepEqual(studio.personas.map((p) => [p.persona, p.members, p.accepted]), [["ceo", 1, 0], ["developer", 2, 1], ["project-manager", 1, 1]]);
  assert.deepEqual([studio.record.members, studio.record.accepted], [4, 2]);
  assert.deepEqual(studio.members.map((m) => [m.name, m.persona]), [["fk-ceo", "ceo"], ["fk-dev-1", "developer"], ["fk-dev-2", "developer"], ["fk-pm", "project-manager"]]);
});

test("DK1366: the template's record covers everyone who runs the same runtime and model, across fleets, and keeps a different template apart", async () => {
  const w = await world();
  const dir = fleetDirectory((await w.stored()) as never);
  const a = findFleet(dir, "Clones")!.templateRecord!, b = findFleet(dir, "Studio")!.templateRecord!, o = findFleet(dir, "Other")!.templateRecord!;
  assert.deepEqual(a, b, "two fleets with one template share one record");
  assert.deepEqual([a.fleets, a.members, a.settled, a.accepted, a.slashes], [2, 7, 5, 5, 0], "seven agents in two fleets; five jobs, all accepted");
  assert.deepEqual([o.fleets, o.members, o.accepted], [1, 1, 1], "another model is another template");
  assert.notEqual(a.key, o.key);
  assert.equal(JSON.parse(a.key).model, "model-one");
});

test("DK1366: a slash counts in the fleet, the persona and the template record, as a share of settled jobs; a fleet with no template has no template record", () => {
  // synthetic records: three copies with one slash among five settled jobs
  const recs: { seq: number; id: string; record: { type: string; issuer: string; subject?: string | null; issued_at: string; body: Record<string, unknown> } }[] = [];
  let seq = 0;
  const push = (type: string, issuer: string, body: Record<string, unknown>) => { seq++; const id = `sha256:${String(seq).padStart(64, "0")}`; recs.push({ seq, id, record: { type: `asp.${type}/v0.2`, issuer, subject: null, issued_at: "2026-11-02T10:00:00Z", body } }); return id; };
  push("fleet", "org", { did: "f1", org: "org", name: "Plain", purpose: "no template" });
  push("fleet", "org", { did: "f2", org: "org", name: "Templated", purpose: "p", template: { runtime: "r", model: "m" } });
  for (const [n, f] of [["a", "f1"], ["b", "f2"], ["c", "f2"]] as const) push("passport", "org", { did: n, kind: "agent", sponsor: "org", fleet: f, tier: 1, shape: {}, keys: [] });
  const jobs: [string, boolean][] = [["b", false], ["b", true], ["c", true], ["c", true], ["a", true]];
  for (const [who, ok] of jobs) { const c = push("contract", "client", { principal: "client", performer: who, price: { value: 30 } }); push("settlement", "bank", { contract: c, basis: ok ? "accepted" : "ruling", bond_slashed: { value: ok ? 0 : 5 } }); }
  const dir = fleetDirectory(recs as never);
  const t = findFleet(dir, "Templated")!;
  assert.deepEqual([t.record.settled, t.record.accepted, t.record.slashes, t.record.slashPermille], [4, 3, 1, 250]);
  assert.deepEqual([t.templateRecord!.slashes, t.templateRecord!.slashPermille], [1, 250]);
  assert.equal(findFleet(dir, "Plain")!.templateRecord, null, "no template, no template record");
  assert.deepEqual([findFleet(dir, "Plain")!.record.settled, findFleet(dir, "Plain")!.record.slashPermille], [1, 0]);
  const none = fleetDirectory([recs[0]] as never);
  assert.equal(findFleet(none, "Plain")!.record.slashPermille, null, "nothing settled: no rate");
});

test("DK1366: the fleet page shows the record, each persona and the template's record; the Registry page of a member shows its fleet, persona and template", async () => {
  const w = await world();
  const server = createServer(async (req, res) => { if (!(await fleetRoutes({ stored: w.stored })(req, res))) { res.writeHead(404); res.end(); } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r)); servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const studio = await (await fetch(`${base}/society/fleets/Studio`, { headers: { accept: "text/html" } })).text();
  assert.match(studio, /<h2>Record<\/h2>/);
  assert.match(studio, /2 of 2 settled jobs accepted; 0 slashes \(0% of settled jobs\)/);
  assert.match(studio, /<td>developer<\/td><td class="num">2<\/td><td class="num">1<\/td><td class="num">1<\/td><td class="num">0<\/td>/);
  assert.match(studio, /Everyone who runs this template \(claude-code, model-one\): 7 agents in 2 fleets; 5 of 5 settled jobs accepted/);
  assert.match(studio, /A slash on one copy raises the bond floor of its fleet-mates/);
  const clones = await (await fetch(`${base}/society/fleets/Clones`, { headers: { accept: "text/html" } })).text();
  assert.match(clones, /A fleet of copies: one template, no persona/);
  const json = (await (await fetch(`${base}/society/fleets/Studio`, { headers: { accept: "application/json" } })).json()) as { fleet: { personas: unknown[]; templateRecord: { members: number } } };
  assert.equal(json.fleet.personas.length, 3);
  assert.equal(json.fleet.templateRecord.members, 7);
  assert.match(renderFleet(findFleet(fleetDirectory((await w.stored()) as never), "Other")!), /1 agent in 1 fleet/);
  // the Registry page of a member
  const page = await publicReply(w.k.log as never, `/registry/agents/${encodeURIComponent(w.studio[0].did)}`, true);
  assert.match(page!.html ?? "", /<th>persona<\/th><td>developer<\/td>/);
  assert.match(page!.html ?? "", /<th>template<\/th><td>claude-code \/ model-one/);
  assert.match(page!.html ?? "", /\/society\/fleets\/did%3Aweb%3Aexample\.com%3Afleets%3Astudio/);
  const data = (await publicReply(w.k.log as never, `/registry/agents/${encodeURIComponent(w.studio[0].did)}`, false))!.json as { result: { persona: string; template: { model: string } } };
  assert.deepEqual([data.result.persona, data.result.template.model], ["developer", "model-one"]);
  // a member of a copies fleet: a template and no persona
  const copy = (await publicReply(w.k.log as never, `/registry/agents/${encodeURIComponent(w.clones[0].did)}`, false))!.json as { result: { persona: string | null; template: { model: string } } };
  assert.deepEqual([copy.result.persona, copy.result.template.model], [null, "model-one"]);
});
