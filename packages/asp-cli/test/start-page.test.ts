// Row DK732: "agents, start here": the site serves the page as plain text and HTML, /llms.txt links to it and to the society's own file, the service serves the same page, every route it names is on the surface list, its claims are the true ones,
// and it is in the sitemap and the smoke script. Fake data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { SURFACE, frontDoorRoutes, startPageHtml, startPageText } from "@agent-social/asp-log";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const SERVICE = "https://log.thedeeptransformation.com";

test("DK732: the site has the page as plain text and as HTML, /llms.txt links to it and to the society's own file, and both are in the sitemap", () => {
  assert.ok(existsSync(new URL("site/start.txt", root)) && existsSync(new URL("site/start.html", root)));
  const llms = read("site/llms.txt");
  assert.match(llms, /\(https:\/\/agentsocial\.thedeeptransformation\.com\/start\.txt\)/);
  assert.match(llms, new RegExp(`\(${SERVICE.replace(/\./g, "\.")}/society/llms\.txt\)`));
  const map = read("site/sitemap.xml");
  assert.match(map, /\/start\.txt</);
  assert.match(map, /\/start\.html</);
  assert.equal(read("site/start.txt"), startPageText({ publicUrl: SERVICE, keyOnly: () => true }), "generated, not hand-edited (npm run ai-files)");
  assert.match(read("site/start.html"), /<a href="https:\/\/log\.thedeeptransformation\.com\/society\/surface">/);
  assert.ok(!/<script/i.test(read("site/start.html")), "no script needed to read it");
});

test("DK732: every route the page names exists on the surface list, with the method an agent would use", () => {
  const text = startPageText({ publicUrl: SERVICE, keyOnly: () => true, flags: () => ({ "http-enrol": true }) });
  const named = [...text.matchAll(/(?:GET|POST) (https:\/\/log\.thedeeptransformation\.com(\/[A-Za-z0-9_\/.-]*))/g)].map((m) => ({ method: /(GET|POST) $/.exec(text.slice(m.index! - 5, m.index! + 5))?.[1], path: m[2] }));
  const links = [...text.matchAll(/(https:\/\/log\.thedeeptransformation\.com(\/[A-Za-z0-9_\/.-]*))/g)].map((m) => m[2].replace(/[.:]+$/, ""));
  assert.ok(links.length >= 10);
  for (const path of new Set(links)) assert.ok(SURFACE.some((r) => r.method === "GET" && r.path === path) || SURFACE.some((r) => r.path === path), `${path} is on the surface list`);
  assert.ok(named.length >= 2);
  for (const p of ["/signup", "/signup/challenge", "/signup/key", "/signup/http"]) assert.ok(SURFACE.some((r) => r.path === p), p);
});

test("DK732: its claims are the true ones and none of the false ones", () => {
  const t = read("site/start.txt");
  for (const re of [/credits are mock accounting entries, not money/i, /beta/i, /no outside security review/i, /nothing here trains a model's weights/i]) assert.match(t, re);
  for (const re of [/real money/i, /trained weights|we train|fine-tun/i, /audited|security reviewed/i, /guarantee/i]) assert.doesNotMatch(t.replace(/no outside security review/gi, ""), re);
  assert.match(t, /When enrolment is open/);
});

test("DK732: the service serves the page as plain text and as HTML, and it is in the smoke script", async () => {
  const o = { keyOnly: () => true, publicUrl: "https://society.example" };
  const route = frontDoorRoutes(o);
  const server: Server = createServer(async (req, res) => { if (!(await route(req, res))) { res.writeHead(404); res.end(); } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const t = await fetch(`${base}/society/start`);
    assert.equal(t.status, 200);
    assert.match(t.headers.get("content-type")!, /text\/plain/);
    assert.equal(await t.text(), startPageText(o));
    const h = await fetch(`${base}/society/start`, { headers: { accept: "text/html" } });
    assert.match(h.headers.get("content-type")!, /text\/html/);
    assert.equal(await h.text(), startPageHtml(o));
  } finally { server.close(); }
  assert.match(read("scripts/smoke-serve.mjs"), /"\/society\/start"/);
  assert.match(read("scripts/smoke-serve.mjs"), /"\/society\/surface"/);
});
