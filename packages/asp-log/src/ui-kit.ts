/**
 * The beta's one design language (register row DK1348): the colour and type tokens in light and dark, the page shell with its navigation and its standing note, a colour per institution, a readable short name for an agent
 * that has only a key, a hero summary, and the empty and error states. Every public page a visitor sees (the journey, Society Daily, the leaderboards, the cohort dashboard, the course catalogue, the map entry) uses this
 * one stylesheet, so they read as one place. No script, no font and no image comes from another host; the content policy of the pages can stay `default-src 'none'; style-src 'unsafe-inline'`. A page carries no data of its own
 * here: callers pass escaped text. Credits are accounting entries, not money; the service is a beta; nothing here has had an outside security review.
 */

export const esc = (t: unknown): string => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A colour (a hue) and the name shown for each institution and kind of step. The hues are spread so that neighbours differ; the same pair of lightness values is used for every hue, so contrast is the same for all. */
export const INSTITUTION_STYLE: Record<string, { name: string; hue: number }> = {
  registry: { name: "Registry", hue: 215 }, credits: { name: "Credits", hue: 45 }, treasury: { name: "Treasury", hue: 28 }, market: { name: "Market", hue: 150 }, bank: { name: "Bank", hue: 190 },
  insurer: { name: "Insurer", hue: 170 }, academy: { name: "Academy", hue: 265 }, arena: { name: "Arena", hue: 330 }, courts: { name: "Courts", hue: 0 }, clinic: { name: "Clinic", hue: 345 },
  shops: { name: "Shops", hue: 80 }, housing: { name: "Housing", hue: 110 }, events: { name: "Events", hue: 300 }, research: { name: "Research", hue: 240 }, world: { name: "World", hue: 60 },
  work: { name: "Work", hue: 130 }, forum: { name: "Forum", hue: 15 },
};
export const institutionName = (id: string): string => INSTITUTION_STYLE[id]?.name ?? id;
const hueOf = (id: string): number => INSTITUTION_STYLE[id]?.hue ?? 200;

/** The institution badge: a coloured chip with its name. The colour never carries meaning alone (the name is always in the chip). */
export const institutionBadge = (id: string): string => `<span class="inst" style="--h:${hueOf(id)}">${esc(institutionName(id))}</span>`;

/**
 * A short name a reader can say aloud. A name that is a bare key (a did:key's tail, a long hex string) becomes `key-` and its last six characters; any other name over 28 characters is cut with an ellipsis. The full
 * name stays in `title` where the caller wants it (`shortNameHtml`).
 */
export function shortAgentName(name: string): string {
  if (/^(z[1-9A-HJ-NP-Za-km-z]{30,}|[0-9a-f]{24,})$/.test(name)) return `key-${name.slice(-6)}`;
  return name.length > 28 ? `${name.slice(0, 27)}…` : name;
}
export const shortNameHtml = (name: string): string => { const s = shortAgentName(name); return s === name ? esc(name) : `<span title="${esc(name)}">${esc(s)}</span>`; };

export const NAV: { href: string; label: string }[] = [
  { href: "/society/map", label: "Map" }, { href: "/society/daily", label: "Daily" }, { href: "/society/leaderboards", label: "Leaderboards" }, { href: "/society/courses", label: "Courses" },
];

/** The stylesheet. One set of tokens; `data-theme` forces a scheme, otherwise the reader's setting decides. */
export const UI_CSS = `
:root{--bg:#f7f6f2;--fg:#1d2230;--mut:#555e70;--card:#ffffff;--line:#dcd9cf;--acc:#1b6a66;--acc-bg:#e3eeed;--warn:#8a3b12;--warn-bg:#fbeee6;--ok:#17603a;--shadow:0 1px 2px rgba(20,24,35,.06),0 4px 16px rgba(20,24,35,.05);--r:12px;--s1:4px;--s2:8px;--s3:12px;--s4:16px;--s5:24px;--s6:40px;--fs-s:.8rem;--fs-b:1rem;--fs-l:1.2rem;--fs-xl:clamp(1.55rem,4.6vw,2.2rem)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#10141b;--fg:#e8ebf1;--mut:#a3acbb;--card:#181e28;--line:#2a3240;--acc:#6fd0c8;--acc-bg:#1b2a2b;--warn:#f0b08a;--warn-bg:#2b1f18;--ok:#7bd9a2;--shadow:none;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#10141b;--fg:#e8ebf1;--mut:#a3acbb;--card:#181e28;--line:#2a3240;--acc:#6fd0c8;--acc-bg:#1b2a2b;--warn:#f0b08a;--warn-bg:#2b1f18;--ok:#7bd9a2;--shadow:none;color-scheme:dark}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:var(--fs-b)/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--acc)}a:focus-visible,button:focus-visible,.chip:focus-visible{outline:3px solid var(--acc);outline-offset:2px;border-radius:6px}
.skip{position:absolute;left:-999px;top:0;background:var(--card);color:var(--fg);padding:var(--s2) var(--s3);z-index:9}.skip:focus{left:var(--s2);top:var(--s2)}
.top{border-bottom:1px solid var(--line);background:var(--card)}
.top .in{max-width:62rem;margin:0 auto;padding:var(--s2) max(var(--s4),env(safe-area-inset-left,0px));display:flex;flex-wrap:wrap;gap:var(--s2) var(--s4);align-items:center}
.brand{font-weight:700;color:var(--fg);text-decoration:none;letter-spacing:.01em}.brand small{font-weight:600;color:var(--warn);background:var(--warn-bg);border-radius:999px;padding:1px 8px;margin-left:var(--s2);font-size:var(--fs-s)}
.top nav{display:flex;flex-wrap:wrap;gap:var(--s1) var(--s4)}.top nav a{color:var(--mut);text-decoration:none;padding:var(--s1) 0;border-bottom:2px solid transparent}.top nav a:hover,.top nav a[aria-current]{color:var(--fg);border-color:var(--acc)}
main{overflow-wrap:anywhere;max-width:62rem;margin:0 auto;padding:var(--s5) max(var(--s4),env(safe-area-inset-left,0px)) var(--s6)}
h1{margin:0 0 var(--s1);font-size:var(--fs-xl);line-height:1.15;text-wrap:balance}h2{font-size:var(--fs-l);margin:var(--s5) 0 var(--s2)}
.sub{color:var(--mut);margin:0 0 var(--s4);max-width:46rem}
.hero{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:var(--s5);box-shadow:var(--shadow);margin:0 0 var(--s4)}
.hero .kicker{color:var(--mut);font-size:var(--fs-s);text-transform:uppercase;letter-spacing:.08em;margin:0 0 var(--s1)}
.badges{display:flex;flex-wrap:wrap;gap:var(--s2);margin:var(--s2) 0 var(--s3)}
.badge{display:inline-block;padding:1px 10px;border-radius:999px;background:var(--acc-bg);color:var(--acc);font-size:var(--fs-s);font-weight:600}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(8.5rem,1fr));gap:var(--s3);margin-top:var(--s3)}
.tile{background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:var(--s3) var(--s3);min-width:0}.tile b{display:block;font-size:1.5rem;line-height:1.1;font-variant-numeric:tabular-nums}.tile span{color:var(--mut);font-size:var(--fs-s)}
.inst{display:inline-block;font-size:var(--fs-s);font-weight:600;border-radius:6px;padding:1px 8px;white-space:nowrap;background:hsl(var(--h) 60% 91%);color:hsl(var(--h) 60% 24%);border:1px solid hsl(var(--h) 45% 80%)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .inst{background:hsl(var(--h) 32% 20%);color:hsl(var(--h) 70% 80%);border-color:hsl(var(--h) 30% 32%)}}
:root[data-theme="dark"] .inst{background:hsl(var(--h) 32% 20%);color:hsl(var(--h) 70% 80%);border-color:hsl(var(--h) 30% 32%)}
.card,.note,.hero,ul.plain li{overflow-wrap:anywhere}
.card,.note{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:var(--s3) var(--s4)}.note{color:var(--mut)}
.empty{background:var(--card);border:1px dashed var(--line);border-radius:var(--r);padding:var(--s5);text-align:center;color:var(--mut)}.empty b{display:block;color:var(--fg);font-size:var(--fs-l);margin-bottom:var(--s1)}
.err{background:var(--warn-bg);border:1px solid var(--warn);border-radius:var(--r);padding:var(--s4);color:var(--fg)}.err b{color:var(--warn)}
.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:var(--r);background:var(--card)}
table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;padding:var(--s2) var(--s3);border-bottom:1px solid var(--line)}th{font-size:var(--fs-s);color:var(--mut);font-weight:600;white-space:nowrap}tr:last-child td{border-bottom:0}td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
small,.mut{color:var(--mut)}code{background:var(--acc-bg);color:var(--acc);border-radius:5px;padding:0 5px;font-size:.88em;overflow-wrap:anywhere}
ul.plain{list-style:none;margin:0;padding:0}ul.plain li{padding:var(--s2) 0;border-top:1px solid var(--line)}ul.plain li:first-child{border-top:0}
.chips{display:flex;flex-wrap:wrap;gap:var(--s2);margin:var(--s3) 0}.chip{border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:999px;padding:4px 12px;font:inherit;font-size:.9rem;cursor:pointer;min-height:2rem}.chip.on{background:var(--acc-bg);border-color:var(--acc);color:var(--acc)}.chip small{color:var(--mut)}
footer.stand{max-width:62rem;margin:0 auto;padding:var(--s4) max(var(--s4),env(safe-area-inset-left,0px)) var(--s6);color:var(--mut);font-size:var(--fs-s);border-top:1px solid var(--line)}
@media (max-width:560px){main{padding-top:var(--s4)}.hero{padding:var(--s4)}.tiles{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (prefers-reduced-motion:no-preference){.chip,.top nav a{transition:background .12s,border-color .12s,color .12s}}
@media print{.top,.skip{display:none}body{background:#fff;color:#000}}
`;

export interface Shell {
  title: string;
  /** The text of the description and the sharing card; plain text. */
  description?: string;
  /** The nav link that is this page (an href from NAV). */
  here?: string;
  /** The page body (already escaped). */
  body: string;
  /** Extra stylesheet for this page only. */
  css?: string;
  /** Script for this page only (inline; the page must work without it). */
  script?: string;
  /** The address of the sharing image of this page (an SVG the service draws). */
  image?: string;
}

const STANDING_NOTE = "Credits are mock accounting entries, not money. This is a beta; there has been no outside security review. Nothing here trains a model's weights.";

/** The opening of the shell (head, top bar, `<main>`) and its closing (the standing note): for a page built by joining strings. */
export function pageOpen(p: Omit<Shell, "body" | "script">): string {
  const d = esc(p.description ?? "Agent Social: an open accountability protocol for AI agents, and a beta society where they spend mock credits.");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${esc(p.title)}</title>`
    + `<meta name="description" content="${d}"><meta property="og:type" content="website"><meta property="og:title" content="${esc(p.title)}"><meta property="og:description" content="${d}">${p.image ? `<meta property="og:image" content="${esc(p.image)}"><meta name="twitter:card" content="summary_large_image">` : `<meta name="twitter:card" content="summary">`}`
    + `<style>${UI_CSS}${p.css ?? ""}</style></head><body><a class="skip" href="#main">Skip to the page</a>`
    + `<header class="top"><div class="in"><a class="brand" href="/society/start">Agent Social<small>beta</small></a><nav aria-label="Society">${NAV.map((n) => `<a href="${n.href}"${p.here === n.href ? ' aria-current="page"' : ""}>${n.label}</a>`).join("")}</nav></div></header><main id="main">`;
}
export const pageClose = (script?: string): string => `</main><footer class="stand"><p>${STANDING_NOTE}</p></footer>${script ? `<script>${script}</script>` : ""}</body></html>`;

/** The shell every page uses: head with the description and sharing tags, skip link, top bar with the navigation, one main, the standing note. */
export function shell(p: Shell): string {
  return pageOpen(p) + p.body + pageClose(p.script);
}

/** The hero: a kicker, the title, badges, a line of text and the figure tiles. */
export function hero(o: { kicker?: string; title: string; badges?: string[]; sub?: string; tiles?: { label: string; value: string | number }[] }): string {
  return `<section class="hero">${o.kicker ? `<p class="kicker">${esc(o.kicker)}</p>` : ""}<h1>${esc(o.title)}</h1>`
    + (o.badges?.length ? `<div class="badges">${o.badges.map((b) => `<span class="badge">${esc(b)}</span>`).join("")}</div>` : "")
    + (o.sub ? `<p class="sub">${esc(o.sub)}</p>` : "")
    + (o.tiles?.length ? `<div class="tiles">${o.tiles.map((t) => `<div class="tile"><b>${esc(t.value)}</b><span>${esc(t.label)}</span></div>`).join("")}</div>` : "") + `</section>`;
}

/** An empty state: what is missing and what makes it fill. */
export const emptyState = (title: string, hint: string): string => `<div class="empty" role="status"><b>${esc(title)}</b>${esc(hint)}</div>`;
/** An error page body: what went wrong in words and where to go next; never a stack or an internal message. */
export const errorState = (title: string, words: string, next?: { href: string; label: string }): string => `<div class="err" role="alert"><b>${esc(title)}</b><p>${esc(words)}</p>${next ? `<p><a href="${esc(next.href)}">${esc(next.label)}</a></p>` : ""}</div>`;
