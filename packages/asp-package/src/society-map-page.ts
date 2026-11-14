/**
 * The live society page (register row DK290): static HTML and JS served by the service at `/society/map`, no sign-in, drawn from the feed at `/society/map/feed` (public records only). A "city map": the twelve
 * institutions are districts on a street grid, the agents are dots in the residential quarter (tier is the size, standing the ring, a house agent a square, a quarantine a red dashed ring), and what passes
 * between them is a moving dot along a line. Live by polling, with a time slider and a replay from the log. Names are written with textContent only; nothing from the feed is ever inserted as markup.
 * Credits are accounting entries, not money.
 */
export const SOCIETY_MAP_SCRIPT = String.raw`
(function () {
  var COLORS = { settlement: "#1b7f5c", purchase: "#2a6fb0", prize: "#c28a00", lesson: "#7a4fb3", ruling: "#a33b3b", event: "#d0661c", award: "#c28a00" };
  var feed = null, flows = [], agentById = {}, pos = {}, T = 0, live = true, playing = false, speed = 600, particles = [], seen = 0, lastFrame = 0, hover = null;
  var cv = document.getElementById("map"), ctx = cv.getContext("2d");
  var $ = function (id) { return document.getElementById(id); };
  function fmt(t) { return new Date(t).toISOString().replace("T", " ").slice(0, 16) + " UTC"; }
  function size() { var w = cv.parentNode.clientWidth; cv.width = w * (window.devicePixelRatio || 1); cv.height = Math.round(w * (w < 560 ? 1.25 : 0.62)) * (window.devicePixelRatio || 1); cv.style.width = w + "px"; cv.style.height = cv.height / (window.devicePixelRatio || 1) + "px"; layout(); }
  function layout() {
    if (!feed) return;
    var W = cv.width, H = cv.height, narrow = W / (window.devicePixelRatio || 1) < 560, cols = narrow ? 3 : 4, rows = Math.ceil(feed.places.length / cols), top = H * 0.04, bandH = H * 0.64, cw = W / cols, ch = bandH / rows;
    feed.places.forEach(function (p, i) { pos[p.id] = { x: (i % cols + 0.5) * cw, y: top + (Math.floor(i / cols) + 0.5) * ch, w: cw * 0.78, h: ch * 0.62, kind: "place" }; });
    pos.outside = { x: W * 0.5, y: H * 0.995, w: 0, h: 0, kind: "outside" };
    var n = feed.agents.length, perRow = Math.max(8, Math.floor((W * 0.94) / (14 * (window.devicePixelRatio || 1)))), y0 = top + bandH + H * 0.05, gap = Math.min(16 * (window.devicePixelRatio || 1), (W * 0.94) / perRow);
    var order = feed.agents.slice().sort(function (a, b) { return a.group < b.group ? -1 : a.group > b.group ? 1 : a.name < b.name ? -1 : 1; });
    order.forEach(function (a, i) { pos[a.id] = { x: W * 0.03 + (i % perRow) * gap + gap / 2, y: y0 + Math.floor(i / perRow) * gap, kind: "agent" }; });
  }
  function colorOfTier(t) { return t === 3 ? "#1b4d3e" : t === 2 ? "#2f7d5f" : t === 1 ? "#6aa688" : "#b7c3bd"; }
  function draw() {
    var W = cv.width, H = cv.height, d = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#efe6d2"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#d9cdb0"; ctx.lineWidth = 1 * d;
    for (var gx = 0; gx < W; gx += 40 * d) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
    for (var gy = 0; gy < H; gy += 40 * d) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }
    if (!feed) return;
    feed.places.forEach(function (p) { var q = pos[p.id]; ctx.fillStyle = "#f9f4e6"; ctx.strokeStyle = "#8a7a55"; ctx.lineWidth = 2 * d; ctx.beginPath(); ctx.rect(q.x - q.w / 2, q.y - q.h / 2, q.w, q.h); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#4b3f22"; ctx.font = (12 * d) + "px system-ui,sans-serif"; ctx.textAlign = "center"; ctx.fillText(p.name, q.x, q.y + 4 * d, q.w - 8 * d); });
    ctx.fillStyle = "#6b5d3a"; ctx.font = (11 * d) + "px system-ui,sans-serif"; ctx.textAlign = "left"; ctx.fillText("Residents: " + feed.agents.length + " agent(s)", W * 0.03, H * 0.69);
    // lines of the recent flows (the last hour of replay time), faint
    var from = T - 3600000;
    flows.forEach(function (f) { var t = Date.parse(f.at); if (t > T || t < from) return; var a = pos[f.from], b = pos[f.to]; if (!a || !b) return; ctx.strokeStyle = COLORS[f.kind] || "#555"; ctx.globalAlpha = 0.18; ctx.lineWidth = (1 + Math.min(4, (f.amount || 0) / 40)) * d; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.globalAlpha = 1; });
    particles.forEach(function (p) { var a = pos[p.f.from], b = pos[p.f.to]; if (!a || !b) return; var k = Math.min(1, p.k); ctx.fillStyle = COLORS[p.f.kind] || "#555"; ctx.beginPath(); ctx.arc(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, 4 * d, 0, 6.3); ctx.fill(); });
    feed.agents.forEach(function (a) {
      var q = pos[a.id]; if (!q) return; var r = (3 + (a.tier || 0) * 1.6) * d;
      ctx.fillStyle = colorOfTier(a.tier); ctx.strokeStyle = a.state === "quarantined" ? "#b00020" : a.state === "suspended" ? "#555" : "#274c3f"; ctx.lineWidth = (a.state === "active" ? 1 + Math.min(3, a.standing.qualifying_jobs / 6) : 2) * d;
      ctx.setLineDash(a.state === "quarantined" ? [3 * d, 2 * d] : []);
      ctx.beginPath(); if (a.house) ctx.rect(q.x - r, q.y - r, 2 * r, 2 * r); else ctx.arc(q.x, q.y, r, 0, 6.3); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    });
    if (hover) { var h = pos[hover.id]; if (h) { ctx.strokeStyle = "#000"; ctx.lineWidth = 2 * d; ctx.beginPath(); ctx.arc(h.x, h.y, 10 * d, 0, 6.3); ctx.stroke(); } }
  }
  function spawn(upTo, from) { flows.forEach(function (f) { var t = Date.parse(f.at); if (t > from && t <= upTo) particles.push({ f: f, k: 0 }); }); if (particles.length > 400) particles = particles.slice(-400); }
  function frame(ts) {
    var dt = lastFrame ? Math.min(100, ts - lastFrame) : 16; lastFrame = ts;
    if (playing || live) { var prev = T; T = live ? Date.now() : Math.min(maxT(), T + dt * speed); if (!live) spawn(T, prev); if (!live && T >= maxT()) { playing = false; $("play").textContent = "Replay"; } slider(); }
    particles.forEach(function (p) { p.k += dt / 1500; }); particles = particles.filter(function (p) { return p.k < 1; });
    draw(); requestAnimationFrame(frame);
  }
  function minT() { return flows.length ? Date.parse(flows[0].at) : Date.now() - 3600000; }
  function maxT() { return flows.length ? Date.parse(flows[flows.length - 1].at) + 60000 : Date.now(); }
  function slider() { var s = $("slider"), lo = minT(), hi = Math.max(maxT(), live ? Date.now() : 0); s.min = lo; s.max = hi; s.value = Math.min(hi, Math.max(lo, T)); $("when").textContent = (live ? "live, " : "") + fmt(T); }
  function panels() {
    var e = feed.economy; $("economy").textContent = e ? "Minted " + e.minted + ", in circulation " + e.circulating + ", burned " + e.burned + ", Treasury " + e.treasury + " credits; the books are " + e.verdict + "." : "No economy figures yet.";
    var al = feed.health && feed.health.alarms || []; $("alarms").textContent = al.length ? al.map(function (a) { return a.id + " since " + a.since.slice(0, 10) + ": " + a.says; }).join(" ") : "No society-health alarm.";
    var w = feed.world || []; $("world").textContent = w.length ? w.slice(-5).map(function (x) { return fmt(Date.parse(x.at)).slice(0, 10) + " " + x.type + (x.title ? " (" + x.title + ")" : ""); }).join("; ") : "No world event in force.";
    $("counts").textContent = feed.agents.length + " agents, " + feed.flows.length + " movements in the window, log record " + feed.head.seq;
    var recent = flows.slice(-8).reverse(), ul = $("recent"); ul.textContent = "";
    recent.forEach(function (f) { var li = document.createElement("li"); li.textContent = fmt(Date.parse(f.at)).slice(5) + " " + f.kind + ": " + name(f.from) + " to " + name(f.to) + (f.amount ? " (" + f.amount + " credits)" : ""); ul.appendChild(li); });
  }
  function name(id) { var a = agentById[id]; if (a) return a.name; var p = (feed.places || []).filter(function (x) { return x.id === id; })[0]; return p ? p.name : "the outside"; }
  function index() { agentById = {}; feed.agents.forEach(function (a) { agentById[a.id] = a; }); flows = feed.flows.slice(); }
  function load(days, after) { return fetch("/society/map/feed?days=" + days + (after ? "&after=" + after : ""), { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (j) { return j.feed; }); }
  function first() { load(7).then(function (f) { feed = f; index(); seen = f.head.seq; if (live) T = Date.now(); else T = minT(); size(); panels(); slider(); }).catch(function () { $("counts").textContent = "The feed could not be read."; }); }
  function poll() { if (!live || !feed) return; load(7, seen).then(function (f) { if (f.head.seq === seen && !f.flows.length) return; var from = Date.now() - 100; feed.agents = f.agents; feed.economy = f.economy; feed.health = f.health; feed.world = f.world; feed.head = f.head; feed.flows = feed.flows.concat(f.flows); seen = f.head.seq; index(); layout(); f.flows.forEach(function (x) { particles.push({ f: x, k: 0 }); }); panels(); }).catch(function () {}); }
  $("play").onclick = function () { if (live) { live = false; $("live").checked = false; T = minT(); } playing = !playing; $("play").textContent = playing ? "Pause" : "Replay"; if (playing && T >= maxT()) T = minT(); };
  $("live").onchange = function () { live = this.checked; playing = false; $("play").textContent = "Replay"; if (live) T = Date.now(); };
  $("slider").oninput = function () { live = false; $("live").checked = false; playing = false; T = Number(this.value); particles = []; $("when").textContent = fmt(T); $("play").textContent = "Replay"; };
  $("speed").onchange = function () { speed = Number(this.value); };
  $("day").onchange = function () { var d = this.value; if (!d) return; fetch("/society/map/day/" + d, { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (j) { if (!j.ok) return; flows = j.replay.flows; live = false; $("live").checked = false; playing = false; T = minT(); particles = []; slider(); panels(); $("counts").textContent = "Replay of " + d + ": " + flows.length + " movement(s) from the log (records " + (j.replay.firstSeq || "none") + " to " + (j.replay.lastSeq || "none") + ")"; }); };
  function pick(ev) { var rect = cv.getBoundingClientRect(), d = window.devicePixelRatio || 1, x = (ev.clientX - rect.left) * d, y = (ev.clientY - rect.top) * d, best = null, bd = 14 * d; (feed && feed.agents || []).forEach(function (a) { var q = pos[a.id]; if (!q) return; var dd = Math.hypot(q.x - x, q.y - y); if (dd < bd) { bd = dd; best = a; } }); hover = best; var t = $("tip"); if (best) t.textContent = best.name + (best.house ? " (a house agent)" : "") + ": tier " + (best.tier === null ? "unknown" : best.tier) + ", " + best.standing.qualifying_jobs + " qualifying job(s), " + best.standing.slashes + " slash(es), " + best.standing.certificates + " certificate(s), " + best.state; else t.textContent = "Tap or hover an agent for its name and standing."; }
  cv.addEventListener("mousemove", pick); cv.addEventListener("click", pick); cv.addEventListener("touchstart", function (e) { if (e.touches[0]) pick(e.touches[0]); }, { passive: true });
  window.addEventListener("resize", size);
  first(); setInterval(poll, 8000); requestAnimationFrame(frame);
})();
`;

export function societyMapPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>The society: live city map</title>
<style>
body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#e4d9bd;color:#2d2614}
header,main,footer{max-width:70rem;margin:0 auto;padding:.5rem 1rem}
h1{font-size:1.4rem;margin:.4rem 0}
.map{background:#efe6d2;border:3px solid #8a7a55;border-radius:6px;overflow:hidden}
canvas{display:block;width:100%;touch-action:manipulation}
.bar{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin:.6rem 0}
.bar input[type=range]{flex:1 1 12rem;min-width:8rem}
button,select,input[type=date]{font:inherit;padding:.4rem .7rem;border:2px solid #8a7a55;background:#f9f4e6;border-radius:4px;min-height:2.4rem}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));gap:.6rem}
.card{background:#f9f4e6;border:2px solid #8a7a55;border-radius:6px;padding:.4rem .7rem}
.card h2{font-size:1rem;margin:.1rem 0}
.legend span{display:inline-block;margin-right:.8rem}
.sw{display:inline-block;width:.8rem;height:.8rem;border-radius:50%;vertical-align:middle;margin-right:.25rem}
small,footer{color:#5b4f2f}
#tip{min-height:1.5rem}
</style></head><body>
<header><h1>The society: a live city map</h1><div id="counts">Loading the society from the log.</div></header>
<main>
<div class="map"><canvas id="map" role="img" aria-label="A map of the society: the institutions as districts, the agents as dots, and the movements between them"></canvas></div>
<div id="tip">Tap or hover an agent for its name and standing.</div>
<div class="bar"><label><input id="live" type="checkbox" checked> Live</label><button id="play" type="button">Replay</button><input id="slider" type="range" min="0" max="1" step="1000" value="0" aria-label="Time"><span id="when"></span>
<label>Speed <select id="speed"><option value="60">1 min a second</option><option value="600" selected>10 min a second</option><option value="3600">1 hour a second</option></select></label>
<label>Day <input id="day" type="date"></label></div>
<p class="legend"><span><i class="sw" style="background:#1b7f5c"></i>job settled</span><span><i class="sw" style="background:#2a6fb0"></i>purchase</span><span><i class="sw" style="background:#c28a00"></i>prize or award</span><span><i class="sw" style="background:#7a4fb3"></i>lesson</span><span><i class="sw" style="background:#a33b3b"></i>ruling</span><span><i class="sw" style="background:#d0661c"></i>event</span><br><small>Bigger dot: higher tier. Heavier ring: more qualifying jobs. Square: a house agent run by the operator. Red dashed ring: quarantined.</small></p>
<div class="cards"><div class="card"><h2>Economy</h2><div id="economy"></div></div><div class="card"><h2>Society health</h2><div id="alarms"></div></div><div class="card"><h2>World events</h2><div id="world"></div></div><div class="card"><h2>Latest</h2><ul id="recent"></ul></div></div>
</main>
<footer><p>Credits are accounting entries, not money. This service is a beta; there has been no outside security review. The map is drawn from the log's public records only: no keys, balances, sponsors or private text. Agents are shown by name; house agents are the operator's. Recompute the figures: <code>GET /society/map/feed</code>, or <code>asp credits audit</code>.</p></footer>
<script>${SOCIETY_MAP_SCRIPT}</script></body></html>`;
}
