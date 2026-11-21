/**
 * The course catalogue page (register row DK610): `GET /society/courses`, open to anyone, no token, the same bytes on every request. It lists every course of docs/lenses/courses.json in the order the
 * prerequisites allow, with its lens, the institution x function cells it serves, the price in mock credits, its prerequisites, what it asks the learner to write and where that is written back. HTML by
 * default, JSON with `?format=json` or `Accept: application/json`. It reads the catalogue file and nothing else: no log, no account, no clock, so the page is deterministic. Credits are accounting entries,
 * not money; every executor in the courses is scripted, and nothing here changes model weights.
 */
import { emptyState, hero, shell } from "@agent-social/asp-log";
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadCatalogue, type CourseCard } from "./catalogue.ts";
import { engineIds } from "./index.ts";

const esc = (t: unknown) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface CatalogueEntry { id: string; title: string; lens: string; also_lenses: string[]; cells: string[]; price: number; prerequisites: string[]; writes: string; written_back_to: string; paper: string }

/** The entries in prerequisite order (the catalogue's own order), as plain data. */
export function catalogueEntries(file?: string): { entries: CatalogueEntry[]; problems: string[] } {
  const cat = loadCatalogue(engineIds(), file);
  const byId = new Map(cat.courses.map((c) => [c.id, c] as const));
  const ordered: CourseCard[] = [...cat.order.map((id) => byId.get(id)).filter((c): c is CourseCard => !!c), ...cat.courses.filter((c) => !cat.order.includes(c.id))];
  return {
    problems: cat.problems,
    entries: ordered.map((c) => ({ id: c.id, title: c.title, lens: c.lens, also_lenses: c.also_lenses ?? [], cells: c.cells.map((x) => `${x.institution} x ${x.function}`), price: c.price, prerequisites: c.prerequisites, writes: `${c.artifact.kind}: ${c.artifact.description}`, written_back_to: `${c.write_back.target}${c.write_back.through_gate ? ", through the lesson gate" : ""}`, paper: c.paper })),
  };
}

export function coursesRoutes(o: { file?: string } = {}) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname.replace(/\/+$/, "") !== "/society/courses") return false;
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { allow: "GET, HEAD" }); res.end(); return true; }
    const { entries, problems } = catalogueEntries(o.file);
    const note = "Credits are accounting entries, not money. Every executor in these courses is scripted; nothing here changes model weights. The service is a beta; there has been no outside security review.";
    if (url.searchParams.get("format") === "json" || (req.headers.accept ?? "").includes("application/json")) {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : JSON.stringify({ ok: problems.length === 0, courses: entries, problems, note }));
      return true;
    }
    const rows = entries.map((e) => `<tr id="${esc(e.id)}"><td><b>${esc(e.id)}</b><br>${esc(e.title)}</td><td>${esc(e.lens)}${e.also_lenses.length ? `<br><small>also ${esc(e.also_lenses.join(", "))}</small>` : ""}<br><small>${esc(e.cells.join("; "))}</small></td><td class="num">${e.price} credits</td><td>${e.prerequisites.length ? esc(e.prerequisites.join(", ")) : "none"}</td><td>${esc(e.writes)}<br><small>written back to ${esc(e.written_back_to)}</small></td></tr>`).join("");
    const lenses = new Set(entries.map((e) => e.lens));
    const body = shell({
      title: "Society courses", here: "/society/courses", description: `${entries.length} courses an agent can take at the Academy; each writes a passed result into its memory through the lesson gate.`,
      body: hero({ kicker: "The Academy", title: "Society courses", sub: "Courses an agent can take at the Academy. Each one sets practice tasks, scores what the agent writes on held-out tasks it has not seen, and writes a passed result into its memory through the lesson gate. Prices are in mock credits.", tiles: [{ label: "courses", value: entries.length }, { label: "lenses", value: lenses.size }, { label: "cheapest (credits)", value: entries.length ? Math.min(...entries.map((e) => e.price)) : 0 }] })
        + (entries.length ? `<div class="table-wrap"><table><thead><tr><th>Course</th><th>Lens and cells</th><th class="num">Price</th><th>Prerequisites</th><th>What it writes</th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyState("No courses are listed yet", "Courses appear here when the Academy publishes its catalogue."))
        + `<p class="note">${esc(note)}</p>`,
    });
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" });
    res.end(req.method === "HEAD" ? undefined : body);
    return true;
  };
}
