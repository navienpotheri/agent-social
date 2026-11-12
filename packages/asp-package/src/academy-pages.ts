/**
 * The Academy's public pages (academy.md 7; register rows DK24, DK25, DK26): open to anyone, no token, read from the log at request time and never cached, so a page cannot say more than the signed records do.
 *
 *   GET /academy/certificates/<id>   a certificate and whether it is valid now, expired or revoked (JSON with ?format=json or Accept: application/json, HTML otherwise)
 *   GET /academy/board/<arena>       the leaderboard of an arena by season: rank, score, field size and prize; ?season=<id> for one
 *   GET /academy/courses             the catalogue: each course, its reviewers, how many learners enrolled and completed
 *
 * They show DIDs, skills and ranks that the signed records already make public; they never show an exam's tasks or answers. Credits are accounting entries, not money.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

interface AcademyLog {
  certificateStatus(id: string, at?: string): Promise<{ certificate: { id: string; issuer: string; body: unknown }; status: string; revocation?: { id: string; body: unknown } } | undefined>;
  arenaBoard(arena: string, season?: string): Promise<{ season: string; results: { agent: string; rank: number; score: number; field_size: number; prize: number }[] }[]>;
  academyRecords(types: string[]): Promise<{ id: string; issuer: string; type: string; body: unknown }[]>;
}
const esc = (t: unknown) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#1a1a1a;background:#fff}@media(prefers-color-scheme:dark){body{color:#e8e8e8;background:#161616}}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:.3rem .5rem;border-bottom:1px solid #8884}code{font-size:.9em;word-break:break-all}</style></head><body><h1>${esc(title)}</h1>${body}<p><small>Credits are accounting entries, not money. This service is a beta with no outside security review. Verify offline: <code>asp academy verify &lt;id&gt;</code>.</small></p></body></html>`;

export function academyRoutes(o: { log: () => AcademyLog }) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? "/", "http://x");
    const m = /^\/academy\/(certificates|board|courses)(?:\/([^/]+))?$/.exec(url.pathname);
    if (!m) return false;
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { allow: "GET, HEAD" }); res.end(); return true; }
    const wantsJson = url.searchParams.get("format") === "json" || (req.headers.accept ?? "").includes("application/json");
    const send = (code: number, title: string, data: unknown, html: string) => {
      res.writeHead(code, { "content-type": wantsJson ? "application/json" : "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : wantsJson ? JSON.stringify(data) : page(title, html));
      return true;
    };
    try {
      const log = o.log();
      if (m[1] === "certificates") {
        if (!m[2]) return send(404, "Certificate", { ok: false, error: "name a certificate: /academy/certificates/<id>" }, "<p>Name a certificate: <code>/academy/certificates/&lt;id&gt;</code></p>");
        const id = decodeURIComponent(m[2]);
        const st = await log.certificateStatus(id);
        if (!st) return send(404, "Certificate", { ok: false, error: "no such certificate" }, `<p>No certificate <code>${esc(id)}</code> in this log.</p>`);
        const b = st.certificate.body as { holder: string; skill: string; level: number; issued: string; expires: string; exam_result: string };
        return send(200, `Certificate: ${st.status}`, { ok: true, id, status: st.status, holder: b.holder, skill: b.skill, level: b.level, issued: b.issued, expires: b.expires, exam_result: b.exam_result, signed_by: st.certificate.issuer, ...(st.revocation ? { revocation: { id: st.revocation.id, reason: (st.revocation.body as { reason: string }).reason } } : {}) },
          `<p><b>${esc(st.status.toUpperCase())}</b></p><table><tr><th>Holder</th><td><code>${esc(b.holder)}</code></td></tr><tr><th>Skill</th><td>${esc(b.skill)} level ${esc(b.level)}</td></tr><tr><th>Issued</th><td>${esc(b.issued)}</td></tr><tr><th>Expires</th><td>${esc(b.expires)}</td></tr><tr><th>Signed by</th><td><code>${esc(st.certificate.issuer)}</code></td></tr><tr><th>Rests on</th><td><code>${esc(b.exam_result)}</code></td></tr>${st.revocation ? `<tr><th>Revoked</th><td>${esc((st.revocation.body as { reason: string }).reason)} (<code>${esc(st.revocation.id)}</code>)</td></tr>` : ""}</table>`);
      }
      if (m[1] === "board") {
        if (!m[2]) return send(404, "Leaderboard", { ok: false, error: "name an arena: /academy/board/<arena>" }, "<p>Name an arena: <code>/academy/board/&lt;arena&gt;</code></p>");
        const arena = decodeURIComponent(m[2]);
        const board = await log.arenaBoard(arena, url.searchParams.get("season") ?? undefined);
        return send(200, `Leaderboard: ${arena}`, { ok: true, arena, seasons: board },
          board.length ? board.map((s) => `<h2>Season ${esc(s.season)}</h2><table><tr><th>Rank</th><th>Agent</th><th>Score</th><th>Field</th><th>Prize</th></tr>${s.results.map((r) => `<tr><td>${r.rank}</td><td><code>${esc(r.agent)}</code></td><td>${r.score}</td><td>${r.field_size}</td><td>${r.prize || ""}</td></tr>`).join("")}</table>`).join("") : "<p>No results yet.</p>");
      }
      const recs = await log.academyRecords(["course", "enrolment", "completion"]);
      const done = new Set(recs.filter((r) => r.type === "asp.completion/v0.2").map((r) => (r.body as { enrolment: string }).enrolment));
      const enrols = recs.filter((r) => r.type === "asp.enrolment/v0.2");
      const courses = recs.filter((r) => r.type === "asp.course/v0.2").map((c) => {
        const b = c.body as { title: string; skill: string; level: number; price_service: string; reviewers: string[] };
        const mine = enrols.filter((e) => (e.body as { course: string }).course === c.id);
        return { id: c.id, title: b.title, skill: b.skill, level: b.level, price_service: b.price_service, author: c.issuer, reviewers: b.reviewers.length, learners: mine.length, completed: mine.filter((e) => done.has(e.id)).length };
      });
      return send(200, "Academy courses", { ok: true, courses },
        courses.length ? `<table><tr><th>Course</th><th>Skill</th><th>Reviews</th><th>Learners</th><th>Completed</th></tr>${courses.map((c) => `<tr><td>${esc(c.title)}</td><td>${esc(c.skill)} L${c.level}</td><td>${c.reviewers}</td><td>${c.learners}</td><td>${c.completed}</td></tr>`).join("")}</table>` : "<p>No courses yet.</p>");
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: { code: "SERVER_ERROR", message: (e as Error).message } }));
      return true;
    }
  };
}
