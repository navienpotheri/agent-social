/**
 * The live society page against the owner's decisions (docs/owner-decisions.md, DK290), one test per point: every agent is shown by name with no opt-out, house agents are labelled, the look is a city map,
 * and the page reads on a phone. Each test fails if the page drifts from the decision. Fake keys only. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SOCIETY_MAP_SCRIPT, societyMapPage } from "../../asp-package/src/society-map-page.ts";
import { PLACES, societyMap, type RepLike } from "../../asp-log/src/index.ts";
import { kit, nowIso, operator } from "../../asp-log/test/society-kit.ts";

const decisions = readFileSync(fileURLToPath(new URL("../../../docs/owner-decisions.md", import.meta.url)), "utf8");
const html = societyMapPage();

async function feedOf() {
  const k = await kit();
  const sponsor = await k.person("od-sponsor", 300);
  await k.agent("od-ordinary", sponsor, { tier: 2, funds: 50 });
  await k.agent("od-quiet", sponsor, { tier: 1, funds: 5 });
  await k.agent("od-house", operator, { tier: 1, funds: 10 });
  const h = await k.log.head();
  const rep = new Map<string, RepLike>();
  for (const a of ["od-ordinary", "od-quiet", "od-house"]) { const did = `did:web:example.com:agents:${a}`; const r = await k.log.reputationOf(did); if (r) rep.set(did, r as never); }
  return societyMap({ stored: (await k.log.since(0, 100000)) as never, head: { seq: h.seq, hash: h.logHash }, now: nowIso(), rep, operator: operator.did });
}

test("the decision is recorded: names for everyone with no opt-out, house agents labelled, a city-map look (so these tests have something to hold the page to)", () => {
  assert.match(decisions, /Agents shown by name to everyone, no opt-out; house agents labelled/);
  assert.match(decisions, /distinct "city map" look/);
});

test("names for everyone: every registered agent is in the feed by its name, whatever its tier, funds or activity, and nothing in the feed's inputs can hide one", async () => {
  const feed = await feedOf();
  assert.deepEqual(feed.agents.map((a) => a.name).sort(), ["coder-1", "od-house", "od-ordinary", "od-quiet"], "the quiet agent with no activity is shown too");
  const params = readFileSync(fileURLToPath(new URL("../../asp-log/src/society-map.ts", import.meta.url)), "utf8");
  const input = params.slice(params.indexOf("export interface MapInput"), params.indexOf("const body ="));
  assert.equal(/opt|hide|hidden|private|anonym|exclude|mask/i.test(input), false, "the feed has no input that leaves an agent out");
});

test("no opt-out: the page has no control, setting or text that lets an agent or sponsor remove or hide a name", () => {
  const controls = [...html.matchAll(/<(button|input|select|label)[^>]*>[^<]*/gi)].map((m) => m[0]).join(" ");
  assert.equal(/opt[ -]?out|hide|remove me|anonym|forget/i.test(controls + SOCIETY_MAP_SCRIPT), false);
  assert.match(html, /Agents are shown by name/);
});

test("house agents are labelled: a square on the map, '(a house agent)' in the tooltip, the feed's house flag set only for the operator's agents, and the footer says what a house agent is", async () => {
  const feed = await feedOf();
  assert.deepEqual(feed.agents.filter((a) => a.house).map((a) => a.name), ["od-house"]);
  assert.match(SOCIETY_MAP_SCRIPT, /\(a house agent\)/);
  assert.match(SOCIETY_MAP_SCRIPT, /if \(a\.house\) ctx\.rect/);
  assert.match(html, /house agents are the operator's/);
});

test("the city-map look: districts on a street grid, a parchment map board with a framed border, drawn on a canvas, every one of the twelve institutions a named district", () => {
  assert.match(html, /<canvas id="map"/);
  assert.match(html, /\.map\{background:#efe6d2;border:3px solid #8a7a55/);
  assert.ok(SOCIETY_MAP_SCRIPT.includes("gx += 40 * d") && SOCIETY_MAP_SCRIPT.includes("gy += 40 * d"), "a street grid is drawn under the districts");
  assert.equal(PLACES.length, 12);
  for (const p of PLACES) assert.match(SOCIETY_MAP_SCRIPT + JSON.stringify(PLACES), new RegExp(p.name));
});

test("phone layout: a device-width viewport, a flowing grid of cards, touch-sized controls, no fixed-width element wider than a phone, and no horizontal scroll rule", () => {
  assert.match(html, /<meta name="viewport" content="width=device-width,initial-scale=1">/);
  assert.match(html, /grid-template-columns:repeat\(auto-fit,minmax\(15rem,1fr\)\)/);
  assert.match(html, /min-height:2\.4rem/);
  const widths = [...html.matchAll(/(?<![-a-z])width:(\d+)px/g)].map((m) => Number(m[1]));
  assert.equal(widths.every((w) => w <= 360), true, `fixed widths: ${widths.join(", ")}`);
  assert.match(html, /max-width|overflow/);
});
