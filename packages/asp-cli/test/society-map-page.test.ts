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
