/**
 * The public course catalogue page, GET /society/courses (register row DK610; spec-delta S929): open to anyone, the same bytes every time, every course of docs/lenses/courses.json with its lens, cells, price,
 * prerequisites and what it writes back; HTML or JSON; read-only; nothing about any agent. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { coursesRoutes, catalogueEntries } from "../src/lens-courses/pages.ts";
import { CATALOGUE_FILE } from "../src/lens-courses/catalogue.ts";
// @ts-expect-error the smoke script is plain JavaScript
import { ROUTES } from "../../../scripts/smoke-serve.mjs";

test("the page lists every course of the catalogue file in prerequisite order with lens, cells, price, prerequisites and write-back; HTML and JSON agree and the bytes do not move", async () => {
  const cards = JSON.parse(readFileSync(CATALOGUE_FILE, "utf8")) as { id: string; price: number; lens: string }[];
  const route = coursesRoutes();
  const server = createServer(async (req, res) => { if (!(await route(req, res))) { res.writeHead(404); res.end(); } });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/society/courses`;
    const j = await (await fetch(base, { headers: { accept: "application/json" } })).json() as { ok: boolean; courses: { id: string; price: number; lens: string; cells: string[]; prerequisites: string[]; written_back_to: string }[]; problems: string[]; note: string };
    assert.equal(j.ok, true, JSON.stringify(j.problems));
    assert.equal(j.courses.length, cards.length);
    assert.deepEqual([...j.courses.map((c) => c.id)].sort(), cards.map((c) => c.id).sort());
    const pos = new Map(j.courses.map((c, i) => [c.id, i] as const));
    for (const c of j.courses) { assert.equal(c.price, cards.find((x) => x.id === c.id)!.price); assert.ok(c.cells.length > 0); assert.match(c.written_back_to, /(memory_rules|skill_library), through the lesson gate/); for (const p of c.prerequisites) assert.ok(pos.get(p)! < pos.get(c.id)!, `${p} comes before ${c.id}`); }
    assert.match(j.note, /not money/);
    const html = await (await fetch(base)).text();
    for (const c of cards) assert.match(html, new RegExp(`id="${c.id}"`));
    assert.match(html, /not money/);
    assert.match(html, /scripted/);
    assert.equal(html, await (await fetch(base)).text(), "the same bytes on every request");
    assert.equal(html, await (await fetch(`${base}/`)).text());
    assert.equal((await fetch(base, { method: "POST" })).status, 405);
    assert.equal((await fetch(`${base}x`)).status, 404);
    assert.equal(catalogueEntries().entries.length, cards.length);
  } finally { server.close(); }
});

test("the page is in the smoke script's list of public routes", () => {
  assert.ok((ROUTES as string[][]).some(([p]) => p === "/society/courses"));
});
