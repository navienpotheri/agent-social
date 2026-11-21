/**
 * The beta pages look finished and read as one place (register row DK1348): the journey, Society Daily, the leaderboards, the cohort dashboard, the course catalogue and the map entry page share one shell, one set of
 * tokens in light and dark, a colour per institution, short readable names for key-only agents, empty and error states, a sharing card per journey, contrast that meets 4.5 to 1 in both schemes, keyboard access, and no
 * outside script, font or image. Run on a seeded fake log. Credits are accounting entries, not money.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { INSTITUTION_STYLE, UI_CSS, errorState, emptyState, hero, institutionBadge, shell, shortAgentName } from "../../asp-log/src/index.ts";
import { journeyRoutes } from "../../asp-package/src/journey-pages.ts";
import { storyRoutes } from "../../asp-package/src/story-pages.ts";
import { societyMapRoutes } from "../../asp-package/src/society-map-routes.ts";
import { coursesRoutes } from "../src/lens-courses/pages.ts";
import { cohortRoutes } from "../src/lens-courses/cohort-pages.ts";
import { kit, nowIso, operator } from "../../asp-log/test/society-kit.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });

async function society(seed: boolean) {
  const k = await kit();
  await k.withPrices();
  if (seed) {
    const keyOnly = await k.agent("z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK", await k.person("bp-keyonly", 300), { tier: 1, funds: 40 });
    const bot = await k.agent("reviewer-rhea", await k.person("bp-sponsor", 300), { tier: 2, funds: 120 });
    await k.cert(bot.did, "code");
    const poster = await k.person("bp-poster", 400);
    await k.runJob(poster, bot, 60);
    await k.runJob(poster, keyOnly, 40);
  }
  const stored = async () => (await k.log.since(0, 100000)) as never;
  const balances = async (dids: string[]) => { const m = new Map<string, number>(); for (const d of dids) m.set(d, await k.log.balance(d)); return m; };
  const routes = [
    journeyRoutes({ stored, balances, operator: operator.did, now: nowIso, publicUrl: "https://beta.example" }),
    storyRoutes({ stored, balances, operator: operator.did, now: nowIso }),
    societyMapRoutes({ stored, head: async () => { const h = await k.log.head(); return { seq: h.seq, logHash: h.logHash }; }, rep: async () => null, now: nowIso }),
    coursesRoutes(), cohortRoutes(),
  ];
  const server = createServer(async (req, res) => { for (const r of routes) if (await r(req, res)) return; res.writeHead(404); res.end(); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r)); servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const get = (path: string, accept = "text/html") => fetch(base + path, { headers: { accept } });
  return { get, k };
}

const PAGES = [
  { path: "/agent/reviewer-rhea/journey", here: "/society/map", name: "journey" },
  { path: "/society/daily?day=2026-11-01", here: "/society/daily", name: "daily" },
  { path: "/society/leaderboards?week=2026-10-26", here: "/society/leaderboards", name: "leaderboards" },
  { path: "/society/cohorts/demo", here: "/society/courses", name: "cohort" },
  { path: "/society/courses", here: "/society/courses", name: "courses" },
  { path: "/society/map", here: "/society/map", name: "map" },
];

test("DK1348: every beta page uses the one shell: top bar with the navigation, a skip link, one h1, one main, the standing note, light and dark tokens, a phone viewport and a description", async () => {
  const s = await society(true);
  for (const p of PAGES) {
    const r = await s.get(p.path);
    assert.equal(r.status, 200, p.name);
    const html = await r.text();
    assert.match(html, /<meta name="viewport" content="width=device-width,initial-scale=1">/, p.name);
    assert.match(html, /<meta name="description" content="[^"]{20,}"/, `${p.name}: a description`);
    assert.match(html, /<meta property="og:title"/, p.name);
    assert.match(html, /class="skip" href="#main"/, `${p.name}: skip link`);
    assert.equal((html.match(/<main\b/g) ?? []).length, 1, `${p.name}: one main`);
    assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1, `${p.name}: one h1`);
    for (const l of ["/society/map", "/society/daily", "/society/leaderboards", "/society/courses"]) assert.ok(html.includes(`href="${l}"`), `${p.name} links ${l}`);
    assert.ok(html.includes(`href="${p.here}" aria-current="page"`), `${p.name}: marks where you are`);
    assert.match(html, /prefers-color-scheme:dark/, `${p.name}: dark tokens`);
    assert.match(html, /data-theme="dark"/, `${p.name}: a forced theme`);
    assert.match(html, /mock accounting entries, not money/, `${p.name}: the standing note`);
    assert.match(html, /no outside security review/, p.name);
  }
});

test("DK1348: no page loads anything from another host: no script src, stylesheet link, import, font, remote url or image, so the content policy needs no outside origin", async () => {
  const s = await society(true);
  for (const p of PAGES) {
    const html = await (await s.get(p.path)).text();
    assert.doesNotMatch(html, /<script[^>]+src=/i, `${p.name}: no script src`);
    assert.doesNotMatch(html, /<link\b/i, `${p.name}: no link element`);
    assert.doesNotMatch(html, /@import|@font-face|url\(\s*["']?https?:/i, `${p.name}: no import or remote url`);
    assert.doesNotMatch(html, /<img\b|<iframe\b|<object\b|<embed\b/i, `${p.name}: no image or frame`);
    assert.doesNotMatch(html, /\bsrc=["']https?:/i, p.name);
    assert.doesNotMatch(html, /tabindex=["'][1-9]/, `${p.name}: no positive tabindex`);
    assert.doesNotMatch(html, /onclick=|onerror=|javascript:/i, `${p.name}: no inline handler`);
  }
});

test("DK1348: contrast: every text and background pair of the tokens, and every institution's badge, is at least 4.5 to 1 in light and in dark", () => {
  const lum = (rgb: number[]) => { const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const hsl = (h: number, s: number, l: number) => { s /= 100; l /= 100; const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return [f(0), f(8), f(4)].map((v) => Math.round(v * 255)); };
  const scheme = (block: RegExp) => { const m = block.exec(UI_CSS)!; const t: Record<string, string> = {}; for (const x of m[1].matchAll(/--([a-z-]+):(#[0-9a-f]{6})/g)) t[x[1]] = x[2]; return t; };
  const light = scheme(/^:root\{([^}]*)\}/m), dark = scheme(/^:root\[data-theme="dark"\]\{([^}]*)\}/m);
  for (const [label, t] of [["light", light], ["dark", dark]] as const) {
    for (const [fg, bg] of [["fg", "bg"], ["fg", "card"], ["mut", "bg"], ["mut", "card"], ["acc", "bg"], ["acc", "card"], ["acc", "acc-bg"], ["warn", "warn-bg"]] as const)
      assert.ok(ratio(hex(t[fg]), hex(t[bg])) >= 4.5, `${label}: ${fg} on ${bg} is ${ratio(hex(t[fg]), hex(t[bg])).toFixed(2)}`);
  }
  // the institution badge: text hsl(h 60% 24%) on hsl(h 60% 91%) in light; hsl(h 70% 80%) on hsl(h 32% 20%) in dark
  for (const [id, { hue }] of Object.entries(INSTITUTION_STYLE)) {
    assert.ok(ratio(hsl(hue, 60, 24), hsl(hue, 60, 91)) >= 4.5, `${id} light badge`);
    assert.ok(ratio(hsl(hue, 70, 80), hsl(hue, 32, 20)) >= 4.5, `${id} dark badge`);
  }
});

test("DK1348: each institution has its own colour and name; a badge always carries the name, so the colour never carries meaning alone", () => {
  const hues = Object.values(INSTITUTION_STYLE).map((x) => x.hue);
  assert.equal(new Set(hues).size, hues.length, "no two institutions share a hue");
  for (const [id, v] of Object.entries(INSTITUTION_STYLE)) { const b = institutionBadge(id); assert.ok(b.includes(`--h:${v.hue}`) && b.includes(`>${v.name}<`), id); }
  assert.match(institutionBadge("not-an-institution"), />not-an-institution</, "an unknown kind still shows its name");
  assert.match(institutionBadge("<b>x</b>"), /&lt;b&gt;/, "a name is escaped");
});

test("DK1348: a key-only agent reads as a short name, in the hero, the leaderboards and the map's lists; the full name stays in a title; ordinary names are left alone", async () => {
  assert.equal(shortAgentName("z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK"), "key-ta2doK");
  assert.equal(shortAgentName("0123456789abcdef0123456789abcdef"), "key-abcdef");
  assert.equal(shortAgentName("reviewer-rhea"), "reviewer-rhea");
  assert.equal(shortAgentName("g".repeat(40)), `${"g".repeat(27)}…`);
  const s = await society(true);
  const journey = await (await s.get("/agent/z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK/journey")).text();
  assert.match(journey, /<h1>key-ta2doK<\/h1>/);
  const lb = await (await s.get("/society/leaderboards?week=2026-10-26")).text();
  assert.match(lb, /<span title="z6Mkha[^"]*">key-/, "a short name with the whole one in a title");
  assert.ok(!/>z6MkhaXgBZ/.test(lb), "the long name is not the visible text");
});

test("DK1348: the hero summary of a journey is a good screenshot: the kicker, the name, the badges, one line of facts and six figures above the fold; the rest of the figures follow", async () => {
  const s = await society(true);
  const html = await (await s.get("/agent/reviewer-rhea/journey")).text();
  const heroBlock = /<section class="hero">(.*?)<\/section>/s.exec(html)![1];
  assert.match(heroBlock, /class="kicker">Journey</);
  assert.match(heroBlock, /<h1>reviewer-rhea<\/h1>/);
  assert.match(heroBlock, /public view/);
  assert.match(heroBlock, /steps across \d+ institutions/);
  assert.equal((heroBlock.match(/class="tile"/g) ?? []).length, 6);
  assert.match(html, /<h2>In numbers<\/h2>/);
  assert.match(html, /class="inst" style="--h:\d+">Market</, "each step carries its institution's colour and name");
  assert.match(html, /<button type="button" class="chip on" aria-pressed="true"/, "the filters are buttons a keyboard can use");
});

test("DK1348: empty states say what is missing and what fills it; an error is words and a way on, never a stack: a browser gets a page, a program gets JSON", async () => {
  const s = await society(false);
  const daily = await (await s.get("/society/daily?day=2026-11-01")).text();
  assert.match(daily, /class="empty" role="status"><b>A quiet day<\/b>/);
  const lb = await (await s.get("/society/leaderboards?week=2026-10-26")).text();
  assert.match(lb, /class="empty" role="status"><b>Nobody yet<\/b>/);
  // an unknown agent: a page for a browser, JSON for a program
  const page = await s.get("/agent/nobody-here/journey");
  assert.equal(page.status, 404);
  assert.match(page.headers.get("content-type") ?? "", /text\/html/);
  const words = await page.text();
  assert.match(words, /class="err" role="alert"/);
  assert.match(words, /href="\/society\/map"/);
  assert.ok(!/Error:|at .*\.ts|stack/i.test(words), "no stack or file name");
  const json = await s.get("/agent/nobody-here/journey", "application/json");
  assert.equal(json.status, 404);
  assert.equal((await json.json() as { error: { code: string } }).error.code, "NO_SUCH_AGENT");
  const star = await fetch((await s.get("/agent/nobody-here/journey")).url, { headers: { accept: "*/*" } });
  assert.match(star.headers.get("content-type") ?? "", /json/, "a client that asks for anything gets JSON, as before");
  // a bad day
  const badDay = await s.get("/society/daily?day=nope");
  assert.equal(badDay.status, 400);
  assert.match(await badDay.text(), /class="err"/);
  assert.equal((await s.get("/society/daily?day=nope", "application/json")).headers.get("content-type"), "application/json");
  // the kit's own states escape what they are given
  assert.match(errorState("<x>", "<y>", { href: "/a\"b", label: "<z>" }), /&lt;x&gt;.*&lt;y&gt;.*href="\/a&quot;b".*&lt;z&gt;/s);
  assert.match(emptyState("<x>", "<y>"), /&lt;x&gt;.*&lt;y&gt;/s);
  assert.match(hero({ title: "<t>", tiles: [{ label: "<l>", value: "<v>" }] }), /&lt;t&gt;.*&lt;v&gt;.*&lt;l&gt;/s);
});

test("DK1348: every journey has a sharing card: an SVG drawn from the public view (name, counts, institutions), named in the page's sharing tags, with no step text and an escaped name", async () => {
  const s = await society(true);
  const html = await (await s.get("/agent/reviewer-rhea/journey")).text();
  assert.match(html, /<meta property="og:image" content="https:\/\/beta\.example\/agent\/reviewer-rhea\/journey\/card\.svg">/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  const card = await s.get("/agent/reviewer-rhea/journey/card.svg");
  assert.equal(card.status, 200);
  assert.equal(card.headers.get("content-type"), "image/svg+xml");
  const svg = await card.text();
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="1200" height="630"/);
  assert.match(svg, />reviewer-rhea</);
  assert.match(svg, /mock accounting entries, not money/);
  assert.doesNotMatch(svg, /<script|onload|href=/i);
  assert.doesNotMatch(svg, /received 120 mock credits|was hired by/, "no step text on the card");
  assert.equal((await s.get("/agent/nobody-here/journey/card.svg")).status, 404);
  const key = await (await s.get("/agent/z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK/journey/card.svg")).text();
  assert.match(key, />key-ta2doK</);
});

test("DK1348: the shell is deterministic and carries a page's own style and script only when given; a table scrolls inside its own box on a phone", () => {
  const a = shell({ title: "T", body: "<p>x</p>" }), b = shell({ title: "T", body: "<p>x</p>" });
  assert.equal(a, b);
  assert.doesNotMatch(a, /<script/);
  assert.match(shell({ title: "T", body: "", script: "var a=1" }), /<script>var a=1<\/script>/);
  assert.match(UI_CSS, /\.table-wrap\{overflow-x:auto/);
  assert.match(UI_CSS, /:focus-visible/);
  assert.match(UI_CSS, /prefers-reduced-motion/);
  assert.match(UI_CSS, /@media \(max-width:560px\)/);
});
