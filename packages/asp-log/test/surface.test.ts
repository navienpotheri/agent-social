// Row DK734: the public surface list: every route in the service's route code is in the table, with the right auth and writes flag; no admin-only route is public; the list is deterministic; the routes serve it. Fake data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_LIMITS, SURFACE, frontDoorRoutes, publicSurface, surfaceListing, surfaceText } from "../src/index.ts";

const pkgs = fileURLToPath(new URL("../../", import.meta.url));
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : []; });
// Routes that belong to something else than the service: the local dashboard (`asp dashboard`), the local gateway (model traffic, MCP) and the log's own transport.
const LOCAL = /(gateway|dashboard)/;
const NOT_SERVICE = new Set(["/", "/index.html", "/asp/health", "/asp/summary"]);

function routesInCode(): { path: string; prefix: boolean; file: string }[] {
  const out: { path: string; prefix: boolean; file: string }[] = [];
  for (const dir of ["asp-log/src", "asp-package/src"]) for (const f of walk(join(pkgs, dir))) {
    const rel = relative(pkgs, f).split(String.fromCharCode(92)).join("/");
    if (LOCAL.test(rel) || /society-map-page|front-door|surface/.test(rel)) continue;
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/(?:pathname|path|req\.url|url|\bp) (?:===|!==) "(\/[A-Za-z0-9_\/.:-]*)"/g)) out.push({ path: m[1], prefix: false, file: rel });
    for (const m of src.matchAll(/(?:pathname|path|req\.url|url|\bp)\.startsWith\("(\/[A-Za-z0-9_\/.-]*)"\)/g)) out.push({ path: m[1], prefix: true, file: rel });
  }
  return out;
}
const covers = (path: string, prefix: boolean): boolean => SURFACE.some((r) => {
  const base = r.path.replace(/<[^>]+>/g, "").replace(/\/\*$/, "/");
  return prefix ? r.path.startsWith(path) || base.startsWith(path) : r.path === path || (r.path.endsWith("/*") && path.startsWith(r.path.slice(0, -1))) || base.replace(/\/$/, "") === path;
});

test("DK734: every route the service's code names is in the surface table (a new route that is not listed fails here)", () => {
  const missing = routesInCode().filter((x) => !NOT_SERVICE.has(x.path) && x.path !== "/rpc" && !covers(x.path, x.prefix)).map((x) => `${x.path}${x.prefix ? "*" : ""} (${x.file})`);
  assert.deepEqual([...new Set(missing)], [], "add these to packages/asp-log/src/surface.ts");
  assert.ok(routesInCode().length > 40, "the scan found the route code");
});

test("DK734: the table is well formed, tenant routes need a token, admin routes are never public, writes are the methods that change things, the limits are the service's defaults", () => {
  const seen = new Set<string>();
  for (const r of SURFACE) {
    const key = `${r.method} ${r.path}`;
    assert.ok(!seen.has(key), `${key} is listed once`);
    seen.add(key);
    assert.ok(r.path.startsWith("/") && r.what.length > 5 && r.limit.length > 3, key);
    if (["PUT", "DELETE"].includes(r.method)) assert.equal(r.writes, true, `${key} writes`);
    if (r.method === "GET" && r.auth === "none") assert.equal(r.writes, r.path === "/mail/unsubscribe", `${key}: a public GET writes nothing (but the signed unsubscribe link)`);
  }
  assert.ok(SURFACE.filter((r) => r.path.startsWith("/admin/") || r.path === "/hosted/backup").every((r) => r.auth === "admin"));
  const pub = publicSurface();
  assert.ok(pub.every((r) => r.auth !== "admin"), "no admin-only route is public");
  assert.ok(!JSON.stringify(surfaceListing()).includes("/admin/"));
  assert.ok(!surfaceText().includes("/admin/"));
  assert.ok(SURFACE.some((r) => r.limit.includes(String(DEFAULT_LIMITS.addressPerMinute))), "the address limit is the service's default");
  assert.ok(SURFACE.some((r) => r.limit.includes(String(DEFAULT_LIMITS.tenantPerMinute))));
  for (const g of ["become someone", "look around", "learn", "spend", "play"]) assert.ok(surfaceListing().groups.some((x) => x.group === g), `a group for ${g}`);
  assert.equal(JSON.stringify(surfaceListing()), JSON.stringify(surfaceListing()), "deterministic");
  assert.deepEqual(surfaceListing().groups.map((g) => g.group), ["become someone", "look around", "learn", "spend", "play", "your account"]);
});

test("DK734: a route that needs a flag says whether it is on here; the routes serve the list as JSON and as text", async () => {
  const l = surfaceListing({ flags: { forum: true } });
  const forum = l.groups.flatMap((g) => g.routes).find((x) => x.path === "/forum")!;
  assert.equal((forum as { enabled?: boolean }).enabled, true);
  const known = l.groups.flatMap((g) => g.routes).find((x) => x.path === "/known-bad")!;
  assert.equal((known as { enabled?: boolean }).enabled, false);
  const route = frontDoorRoutes({ keyOnly: () => true, publicUrl: "https://society.example", flags: () => ({ forum: true }) });
  const server: Server = createServer(async (req, res) => { if (!(await route(req, res))) { res.writeHead(404); res.end(); } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const j = (await (await fetch(`${base}/society/surface`)).json()) as { count: number; groups: unknown[] };
    assert.equal(j.count, publicSurface().length);
    const t = await fetch(`${base}/society/surface?format=text`);
    assert.match(t.headers.get("content-type")!, /text\/plain/);
    assert.match(await t.text(), /GET +https:..society.example.society.surface +.auth: none; reads only;/);
    assert.equal((await fetch(`${base}/society/surface`, { method: "POST" })).status, 405);
  } finally { server.close(); }
});
