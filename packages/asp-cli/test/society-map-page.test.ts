/**
 * The live society page (register row DK290; spec-delta S361): static HTML and JS served at /society/map. The script is run here against a stand-in browser (a canvas that records its drawing calls, a document of
 * elements, a fetch that answers with a feed) so the page is tested rendering a simulated society and a real log, updating live, replaying a day and handling a hostile name. Fake keys only.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import vm from "node:vm";
import { SOCIETY_MAP_SCRIPT, societyMapPage } from "../../asp-package/src/society-map-page.ts";
import { societyMapRoutes } from "../../asp-package/src/society-map-routes.ts";
import { PLACES, simulatedFeed, societyMap, type MapFeed, type RepLike } from "../../asp-log/src/index.ts";
import { kit, nowIso, operator } from "../../asp-log/test/society-kit.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });

interface El { id: string; textContent: string; value: string; min?: string | number; max?: string | number; checked: boolean; children: El[]; onclick?: () => void; oninput?: () => void; onchange?: () => void; parentNode?: { clientWidth: number }; style: Record<string, string>; width: number; height: number; clientWidth: number; appendChild(c: El): void; getContext?(t: string): unknown; addEventListener(n: string, f: (e: unknown) => void): void; getBoundingClientRect(): { left: number; top: number }; innerHTML: string }

/** A stand-in browser: elements by id, a recording canvas, a fetch backed by `answers`, and the timers captured so a test can drive them. */
function browser(answers: (url: string) => unknown, width = 800) {
  const calls: { fn: string; args: unknown[] }[] = [];
  const texts: string[] = [];
  const rec = (fn: string) => (...args: unknown[]) => { calls.push({ fn, args }); if (fn === "fillText") texts.push(String(args[0])); };
  const ctx: Record<string, unknown> = new Proxy({}, { get: (_t, k) => (typeof k === "string" ? rec(k) : undefined), set: () => true });
  const els = new Map<string, El>();
  const make = (id: string): El => {
    const e: El = {
      id, textContent: "", value: "", checked: id === "live", children: [], style: {}, width: 0, height: 0, clientWidth: width, parentNode: { clientWidth: width },
      appendChild(this: El, c: El) { this.children.push(c); }, getContext: () => ctx, addEventListener: () => {}, getBoundingClientRect: () => ({ left: 0, top: 0 }),
      get innerHTML() { return ""; }, set innerHTML(_v: string) { throw new Error("the page must never write markup from the feed (innerHTML)"); },
    } as unknown as El;
    return e;
  };
  const doc = { getElementById: (id: string) => { if (!els.has(id)) els.set(id, make(id)); return els.get(id)!; }, createElement: () => make("li") };
  const timers: { cb: () => void; ms?: number }[] = []; const frames: ((t: number) => void)[] = [];
  const fetched: string[] = [];
  const win = { devicePixelRatio: 1, addEventListener: () => {} };
  const sandbox: Record<string, unknown> = {
    document: doc, window: win, Date, Math, JSON, Number, Object, Array, Promise, console,
    fetch: (url: string) => { fetched.push(url); return Promise.resolve({ json: () => Promise.resolve(answers(url)) }); },
    setInterval: (cb: () => void, ms: number) => { timers.push({ cb, ms }); return timers.length; }, requestAnimationFrame: (cb: (t: number) => void) => { frames.push(cb); return frames.length; },
  };
  return { sandbox, doc, calls, texts, els, timers, frames, fetched };
}
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };

async function run(feed: MapFeed, extra: (url: string) => unknown = () => ({ ok: false }), width = 800, feedFor?: (url: string) => MapFeed) {
  const b = browser((url) => (url.startsWith("/society/map/feed") ? { ok: true, feed: structuredClone(feedFor ? feedFor(url) : feed) } : extra(url)), width);
  vm.runInNewContext(SOCIETY_MAP_SCRIPT, b.sandbox);
  await settle();
  b.frames.shift()?.(100); // one animation frame draws the map
  b.frames.length = 0;
  return b;
}

async function realFeed(): Promise<MapFeed> {
  const k = await kit();
  await k.withPrices();
  const bot = await k.agent("page-bot", await k.person("page-sponsor", 300), { tier: 2, funds: 100 });
  await k.agent("page-house", operator, { tier: 1, funds: 10 });
  await k.cert(bot.did, "code");
  await k.runJob(await k.person("page-poster", 300), bot, 60);
  const h = await k.log.head();
  const rep = new Map<string, RepLike>();
  for (const a of ["page-bot", "page-house"]) { const did = `did:web:example.com:agents:${a}`; const r = await k.log.reputationOf(did); if (r) rep.set(did, r as never); }
  return societyMap({ stored: (await k.log.since(0, 100000)) as never, head: { seq: h.seq, hash: h.logHash }, now: nowIso(), rep, operator: operator.did, economy: { minted: 1000, circulating: 800, burned: 5, treasury: 40, verdict: "balanced" }, alarms: [] });
}

test("the page is served at /society/map with no sign-in: HTML with a phone viewport, no external resource, the credits note, a locked-down content policy", async () => {
  const route = societyMapRoutes({ stored: async () => [], head: async () => ({ seq: 0, logHash: "h" }), rep: async () => null, now: nowIso });
  const server = createServer(async (req, res) => { if (!(await route(req, res))) { res.writeHead(404); res.end(); } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r)); servers.push(server);
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const r = await fetch(`${url}/society/map`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") ?? "", /text\/html/);
  const csp = r.headers.get("content-security-policy") ?? "";
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /connect-src 'self'/);
  assert.doesNotMatch(csp, /\*|https?:/, "no outside origin may be loaded or contacted");
  const html = await r.text();
  assert.match(html, /<meta name="viewport" content="width=device-width,initial-scale=1">/);
  assert.match(html, /Credits are accounting entries, not money/);
  assert.match(html, /<canvas id="map"/);
  for (const id of ["live", "play", "slider", "speed", "day", "economy", "alarms", "world", "recent", "tip"]) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.equal(/(src|href)=["']https?:/i.test(html), false, "no external script, image, font or link");
  assert.equal(/\b(eval|document\.write)\b|innerHTML/.test(SOCIETY_MAP_SCRIPT), false, "no eval, no document.write, no innerHTML in the script");
  assert.doesNotThrow(() => new vm.Script(SOCIETY_MAP_SCRIPT), "the script parses");
  assert.equal((await fetch(`${url}/society/map`, { method: "POST" })).status, 405);
});

test("it renders a simulated society: every place is drawn and named, every agent is a dot (a square for a house agent), and the panels are filled from the feed", async () => {
  const feed = simulatedFeed(3, 30, 120);
  const b = await run(feed);
  for (const p of PLACES) assert.ok(b.texts.includes(p.name), `the district ${p.name} is labelled`);
  assert.equal(b.calls.filter((c) => c.fn === "arc").length >= feed.agents.filter((a) => !a.house).length, true, "a circle for each ordinary agent");
  assert.equal(b.calls.filter((c) => c.fn === "rect").length >= PLACES.length + feed.agents.filter((a) => a.house).length, true, "a block for each district and a square for each house agent");
  assert.match(b.els.get("economy")!.textContent, /Minted 100000.*burned 900.*books are balanced/);
  assert.match(b.els.get("alarms")!.textContent, /No society-health alarm/);
  assert.match(b.els.get("world")!.textContent, /price_change/);
  assert.match(b.els.get("counts")!.textContent, /30 agents, 120 movements/);
  assert.equal(b.els.get("recent")!.children.length, 8, "the latest eight movements are listed in words");
  assert.match(b.els.get("recent")!.children[0].textContent, /simulated|settlement|purchase|prize|lesson|ruling|event|award/);
  assert.equal(b.timers[0].ms, 8000, "it polls the feed every 8 seconds");
});

test("it renders a real log the same way: the agents by name, the flows in words, the economy; a phone-width screen lays the districts out in three columns", async () => {
  const feed = await realFeed();
  const wide = await run(feed, undefined, 900);
  for (const p of PLACES) assert.ok(wide.texts.includes(p.name));
  assert.ok(wide.texts.some((t) => /Residents: \d+ agent/.test(t)));
  const lines = Array.from({ length: wide.els.get("recent")!.children.length }, (_, i) => wide.els.get("recent")!.children[i].textContent);
  assert.ok(lines.some((l) => /settlement: the outside to page-bot \(60 credits\)/.test(l)), lines.join(" | "));
  assert.ok(lines.some((l) => /purchase: page-bot to Academy/.test(l)));
  const phone = await run(feed, undefined, 360);
  const fills = (b: typeof phone) => b.calls.filter((c) => c.fn === "fillText" && PLACES.some((p) => p.name === c.args[0])).map((c) => Math.round(c.args[1] as number));
  assert.ok(new Set(fills(phone)).size <= new Set(fills(wide)).size + 4);
  const xs = (b: typeof phone) => new Set(b.calls.filter((c) => c.fn === "fillText" && PLACES.some((p) => p.name === c.args[0])).map((c) => Math.round((c.args[1] as number) / 10))).size;
  assert.equal(xs(wide), 4, "four columns on a wide screen");
  assert.equal(xs(phone), 3, "three columns on a phone");
  assert.equal(phone.els.get("map")!.height > phone.els.get("map")!.width, true, "the map is taller than wide on a phone");
});

test("a name from the feed is only ever text: a hostile agent name never reaches markup, and the page does not break", async () => {
  const feed = simulatedFeed(1, 5, 10);
  feed.agents[0].name = "<img src=x onerror=alert(1)>";
  feed.flows[feed.flows.length - 1].from = feed.agents[0].id;
  const b = await run(feed); // a throwing innerHTML setter is in the stand-in: any write of markup fails the test
  const li = b.els.get("recent")!.children.map((c) => c.textContent).join(" ");
  assert.match(li, /<img src=x onerror=alert\(1\)>/, "shown as the characters it is");
  assert.ok(b.calls.length > 0);
});

test("live: a poll after the head asks for only what is new, adds the new flows and updates the figures; a failed poll changes nothing", async () => {
  const feed = simulatedFeed(2, 10, 20);
  const newer: MapFeed = { ...simulatedFeed(2, 10, 20), head: { seq: 25, hash: "h" }, flows: [{ seq: 21, at: "2026-11-12T04:00:00Z", kind: "prize", from: "academy", to: feed.agents[0].id, label: "a prize", amount: 9 }], economy: { minted: 5, circulating: 5, burned: 0, treasury: 0, verdict: "balanced" } };
  const b = await run(feed, undefined, 800, (u) => (u.includes("after=20") ? newer : u.includes("after=25") ? { ...newer, flows: [] } : feed));
  b.timers[0].cb();
  await settle();
  assert.ok(b.fetched.some((u) => u === "/society/map/feed?days=7&after=20"), b.fetched.join(", "));
  assert.match(b.els.get("economy")!.textContent, /Minted 5,/);
  assert.match(b.els.get("counts")!.textContent, /21 movements.*log record 25/);
  const before = b.els.get("counts")!.textContent;
  b.timers[0].cb(); await settle(); // the same head again: nothing new
  assert.equal(b.els.get("counts")!.textContent, before);
  let calls = 0;
  const down = await run(feed, undefined, 800, () => { if (++calls > 1) throw new Error("offline"); return feed; });
  down.timers[0].cb(); await settle();
  assert.match(down.els.get("counts")!.textContent, /20 movements/, "the page keeps what it had");
});

test("time slider and replay: the slider spans the feed's time, moving it stops live mode, Replay plays from the start, and a day from the log replaces the movements", async () => {
  const feed = simulatedFeed(4, 12, 60);
  const day = (url: string) => (url.startsWith("/society/map/day/") ? { ok: true, replay: { day: "2026-11-12", flows: feed.flows.slice(0, 5), firstSeq: 1, lastSeq: 5 } } : { ok: false });
  const b = await run(feed, day);
  const slider = b.els.get("slider")!, live = b.els.get("live")!;
  b.frames.length = 0;
  assert.equal(Number(slider.min), Date.parse(feed.flows[0].at), "the slider starts at the first movement");
  assert.ok(Number(slider.max) >= Date.parse(feed.flows.at(-1)!.at));
  slider.value = String(Date.parse(feed.flows[30].at)); slider.oninput!();
  assert.equal(live.checked, false, "moving the slider leaves live mode");
  assert.match(b.els.get("when")!.textContent, /2026-11-12/);
  b.els.get("play")!.onclick!();
  assert.equal(b.els.get("play")!.textContent, "Pause");
  b.els.get("play")!.onclick!();
  assert.equal(b.els.get("play")!.textContent, "Replay");
  b.els.get("day")!.value = "2026-11-12"; b.els.get("day")!.onchange!();
  await settle();
  assert.match(b.els.get("counts")!.textContent, /Replay of 2026-11-12: 5 movement\(s\) from the log \(records 1 to 5\)/);
  assert.ok(b.fetched.includes("/society/map/day/2026-11-12"));
});

test("DK553: the page shows the city's growth stage, what it unlocks and the tournaments from /society/growth, as text only", async () => {
  const feed = simulatedFeed(3, 30, 120);
  const b = await run(feed, (url) => url === "/society/growth" ? { ok: true, stage: 2, population: 12, acts: 140, unlocked: ["the town square", "a second road ring"], next: { stage: 3, agents: 50, acts: 1000 }, tournaments: [{ arena: "refactoring", season: "2026-q4", seats: 3, results: 3, opens: "x", closes: "y", replay: [{ rank: 1, name: "ada", score: 900 }] }], expeditions: [] } : { ok: false });
  assert.ok(b.fetched.includes("/society/growth"), "the page reads the growth view");
  assert.match(b.els.get("growth")!.textContent, /Stage 2: 12 agents, 140 acts\. Next stage at 50 agents and 1000 acts\. Unlocked: the town square; a second road ring\./);
  assert.match(b.els.get("tournaments")!.children[0]!.textContent, /refactoring 2026-q4: 3 seat\(s\), 3 result\(s\), won by ada/);
  assert.match(societyMapPage(), /id="growth"/);
  // A failing or hostile answer changes nothing and throws nothing.
  const quiet = await run(feed, () => ({ ok: false }));
  assert.equal(quiet.els.get("growth")?.textContent ?? "", "", "nothing is written when the view does not answer");
});

// DK1301: each agent is a figure that goes where its records go: to the district of its latest movement, smoothly, and again when a new record arrives; at rest it is at home. Tier 0 draws a circle of radius 3, so a figure is found by that radius.
async function frames(feedFor: (u: string) => MapFeed, n = 30) {
  const b = browser((url) => (url.startsWith("/society/map/feed") ? { ok: true, feed: structuredClone(feedFor(url)) } : { ok: false }));
  vm.runInNewContext(SOCIETY_MAP_SCRIPT, b.sandbox);
  await settle();
  return { b, step: (k = n) => { let from = 0; for (let i = 0; i < k; i++) { from = b.calls.length; b.frames.shift()?.(1000 + i * 300); } return b.calls.slice(from); } };
}
const figure = (calls: { fn: string; args: unknown[] }[]) => { const a = calls.filter((c) => c.fn === "arc" && c.args[2] === 3).at(-1)!.args as number[]; return { x: a[0], y: a[1] }; };
const block = (calls: { fn: string; args: unknown[] }[], placeIndex: number) => { const r = calls.filter((c) => c.fn === "rect")[placeIndex].args as number[]; return { x0: r[0], y0: r[1], x1: r[0] + r[2], y1: r[1] + r[3] }; };
const inside = (p: { x: number; y: number }, r: { x0: number; y0: number; x1: number; y1: number }) => p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;

test("DK1301: a figure rests at home until its first record, goes to the district of its latest movement, moves again when a new record arrives, and a house agent is labelled", async () => {
  const base = simulatedFeed(1, 1, 0);
  const id = base.agents[0].id;
  const agent = { ...base.agents[0], tier: 0, house: false };
  const academy = PLACES.findIndex((p) => p.id === "academy"), market = PLACES.findIndex((p) => p.id === "market");
  const at = (h: number) => `2026-11-12T0${h}:00:00Z`;
  const quiet: MapFeed = { ...base, agents: [agent], flows: [] };
  const q = await frames(() => quiet);
  const homeCalls = q.step();
  assert.ok(!inside(figure(homeCalls), block(homeCalls, academy)), "no movement: at home, not in a district");
  const f1: MapFeed = { ...quiet, head: { seq: 2, hash: "h" }, flows: [{ seq: 1, at: at(1), kind: "lesson", from: id, to: "academy", label: "enrolled in a course" }] };
  const a = await frames(() => f1);
  const c1 = a.step();
  assert.ok(inside(figure(c1), block(c1, academy)), "after enrolling it stands in the Academy");
  // a new record arrives with the next poll: the figure leaves the Academy for the Market
  const f2: MapFeed = { ...f1, head: { seq: 5, hash: "h2" }, flows: [{ seq: 4, at: at(2), kind: "purchase", from: id, to: "market", label: "bought a thing", amount: 5 }] };
  const live = await frames((u) => (u.includes("after=2") ? f2 : f1));
  const first = live.step();
  assert.ok(inside(figure(first), block(first, academy)));
  live.b.timers[0].cb(); await settle();
  const early = live.step(1), late = live.step();
  assert.notDeepEqual(figure(early), figure(first), "the figure moves when the record arrives");
  assert.ok(inside(figure(late), block(late, market)), "and ends in the Market");
  // a settlement between two agents happens at the Market, for both
  const two = simulatedFeed(1, 2, 0);
  const ag = two.agents.map((x) => ({ ...x, tier: 0, house: false }));
  const s = await frames(() => ({ ...two, agents: ag, flows: [{ seq: 1, at: at(1), kind: "settlement", from: ag[0].id, to: ag[1].id, label: "a job settled", amount: 10 }] }));
  const sc = s.step();
  const arcs = sc.filter((c) => c.fn === "arc" && c.args[2] === 3).slice(-2).map((c) => ({ x: (c.args as number[])[0], y: (c.args as number[])[1] }));
  for (const p of arcs) assert.ok(inside(p, block(sc, market)), "both parties are at the Market");
  // a house agent is a square, labelled as one when picked
  const house = simulatedFeed(1, 1, 0);
  const h = await frames(() => ({ ...house, agents: [{ ...house.agents[0], house: true }], flows: [] }));
  const hc = h.step(2);
  assert.ok(hc.filter((c) => c.fn === "rect").length >= PLACES.length + 1, "a square for the house agent");
});

test("DK1301: the picked figure offers its journey as a link built from the name, and the page links the day's front page; a hostile name stays text and is encoded in the link", async () => {
  const feed = simulatedFeed(2, 3, 0);
  feed.agents = feed.agents.map((a) => ({ ...a, house: false }));
  feed.agents[0] = { ...feed.agents[0], name: "<img src=x onerror=alert(1)>/../x" };
  const b = browser((url) => (url.startsWith("/society/map/feed") ? { ok: true, feed: structuredClone(feed) } : { ok: false }));
  const clicks: ((e: unknown) => void)[] = [];
  b.doc.getElementById("map").addEventListener = ((n: string, cb: (e: unknown) => void) => { if (n === "click") clicks.push(cb); }) as never;
  const links: { href?: string; textContent?: string }[] = [];
  (b.doc as { createElement: () => unknown }).createElement = () => { const l: { href?: string; textContent?: string } = {}; links.push(l); return l as never; };
  b.doc.getElementById("tip").appendChild = (() => {}) as never;
  vm.runInNewContext(SOCIETY_MAP_SCRIPT, b.sandbox);
  await settle();
  b.frames.shift()?.(100);
  // click at the first agent's home position: the nearest figure within reach is picked
    const a0 = b.calls.filter((c) => c.fn === "arc").at(0)!.args as number[];
  clicks[0]({ clientX: a0[0], clientY: a0[1] });
  const l = links.at(-1)!;
  assert.ok(l && /^\/agent\/[^/<>"' ]+\/journey$/.test(l.href ?? ""), l?.href);
  assert.match(l.textContent ?? "", /Follow this agent/);
  assert.match(societyMapPage(), /href="\/society\/daily"/);
});

test("DK1301: on a seeded real log the figure of an agent that did a job stands in the Market, its flows are in the feed, and no private field reaches the page", async () => {
  const feed = await realFeed();
  const market = PLACES.findIndex((p) => p.id === "market");
  assert.ok(feed.flows.some((f) => f.kind === "settlement"), "the seeded log has a settlement");
  const r = await frames(() => feed);
  const calls = r.step();
  const bot = feed.agents.find((a) => a.name.includes("page-bot"))!;
  assert.ok(bot, "the agent is in the feed by name");
  const radius = 3 + (bot.tier ?? 0) * 1.6;
  const arc = calls.filter((c) => c.fn === "arc" && Math.abs((c.args[2] as number) - radius) < 1e-9).at(-1)!.args as number[];
  assert.ok(inside({ x: arc[0], y: arc[1] }, block(calls, market)), "the working agent is in the Market");
  const keys = new Set<string>();
  const walkKeys = (v: unknown) => { if (Array.isArray(v)) v.forEach(walkKeys); else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { keys.add(k); walkKeys(x); } };
  walkKeys(feed);
  for (const secret of ["sponsor", "token", "private_key", "email", "keys", "public_key", "purpose", "temperament"]) assert.ok(!keys.has(secret), `${secret} is not a feed field`);
});

test("DK1367: a fleet's district is drawn on the map and its members stand in it at rest; the picked figure offers a link to the fleet's page", async () => {
  const base = simulatedFeed(1, 2, 0);
  const mark = { id: "did:web:example.com:fleets:payments", name: "Payments" };
  const agents = base.agents.map((a, i) => ({ ...a, tier: 0, house: false, ...(i === 0 ? { fleet: mark } : {}) }));
  const feed: MapFeed = { ...base, agents, places: [...base.places, { id: `fleet:${mark.id}`, name: "Fleet: Payments", fleet: true }], flows: [] };
  const fleetIndex = feed.places.length - 1;
  const r = await frames(() => feed);
  const calls = r.step();
  assert.ok(r.b.texts.includes("Fleet: Payments"), "the fleet district is labelled");
  const figures = calls.filter((c) => c.fn === "arc" && c.args[2] === 3).slice(-2).map((c) => ({ x: (c.args as number[])[0], y: (c.args as number[])[1] }));
  const members = figures.filter((f) => inside(f, block(calls, fleetIndex)));
  assert.equal(members.length, 1, "exactly the fleet's member stands in the fleet district; the other stays at home");
});
