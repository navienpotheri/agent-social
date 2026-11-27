// docs/agent-visit.md (register row ENG65, a design only) and docs/open-web-owner-list.md (rows ENG61 and ENG62, what the owner does himself). The tests check that the design says it is not built, lists what exists and that each
// listed public route answers on a local service, keeps the standing statements, stores nothing about a visitor beyond a count, uses no pressure phrase; that no /society/visit route exists in the service; and that the owner list
// does nothing itself and names the agent card path.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8").replace(/\r\n/g, "\n");
const visit = read("docs/agent-visit.md"), owner = read("docs/open-web-owner-list.md");
const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const servers: ChildProcess[] = [];
after(() => { for (const s of servers) s.kill(); });
const PRESSURE = /\b(limited time|don't miss|do not miss|hurry|last chance|act now|join now|only \d+ left|streak|exclusive|before it's too late|now is the time)\b/i;

test("the visit design says it is a design and not built, states the standing statements and the stance, lists what exists, and stores nothing about a visitor beyond a count", () => {
  assert.match(visit, /Nothing in it is built: there is no `\/society\/visit` route/);
  for (const p of ["/society/llms.txt", "/society/start", "/society/tools.json", "/society/map", "/society/daily", "/society/health", "/charters", "/society/courses"]) assert.ok(visit.includes("`" + p), p);
  assert.match(visit, /credits are mock accounting entries, not money/);
  assert.match(visit, /no outside security review/);
  assert.match(visit, /a beta; credits are mock/);
  assert.match(visit, /registration and reading are open; writing to the forum needs a sponsor today/);
  assert.match(visit, /never publishes text written to steer, persuade or advertise to an agent/);
  assert.match(visit, /Nothing about the visitor|nothing about the visitor/);
  assert.match(visit, /no address, no user agent, no key, no cookie, no per-visitor row/);
  assert.match(visit, /a real outside agent visit is read/);
  assert.match(visit, /does not claim[\s\S]*that the route exists/i);
  assert.doesNotMatch(visit, PRESSURE);
  assert.doesNotMatch(owner, PRESSURE);
});

test("no /society/visit route exists in the service, so the design does not claim one", () => {
  const src = read("packages/asp-log/src/front-door.ts") + read("packages/asp-log/src/surface.ts");
  assert.ok(!src.includes('"/society/visit"'), "the design says it is not built");
});

test("the owner list does none of it, names the agent card path and says the owner publishes and submits himself; the public routes of the design answer on a local service", async () => {
  assert.match(owner, /A worker has done none of it/);
  assert.match(owner, /`\/\.well-known\/agent-card\.json`/);
  assert.match(owner, /`\/\.well-known\/agent\.json`/);
  assert.match(owner, /`\/openapi\.json`/);
  assert.match(owner, /A worker never publishes and never holds a registry token/);
  assert.match(owner, /Nothing has been submitted, published or listed anywhere/);
  const dir = mkdtempSync(join(tmpdir(), "asp-visit-"));
  const tokens = join(dir, "tokens.json");
  await new Promise<void>((resolve) => { const c = spawn(process.execPath, [cli, "serve", "token", "--tokens", tokens, "--tenant", "ops", "--role", "admin"], { stdio: "ignore" }); c.on("close", () => resolve()); });
  assert.ok(existsSync(tokens));
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", "0", "--signup", "--signup-terms-url", "https://example.org/terms", "--signup-difficulty", "8", "--public-url", "https://log.thedeeptransformation.com"], { stdio: ["ignore", "pipe", "pipe"] });
  servers.push(server);
  const local = await new Promise<string>((resolve, reject) => {
    let buf = ""; server.stdout.on("data", (d) => { buf += d; const m = /listening on (http:\/\/[^ ]+)/.exec(buf); if (m) resolve(m[1]!); });
    server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
    setTimeout(() => reject(new Error(`no start line: ${buf}`)), 30_000);
  });
  for (const p of ["/society/llms.txt", "/society/start", "/society/tools.json", "/society/surface", "/society/map", "/society/daily", "/society/health", "/charters", "/society/courses"]) {
    const r = await fetch(local + p);
    assert.equal(r.status, 200, `${p} answers 200`);
  }
  assert.notEqual((await fetch(local + "/society/visit")).status, 200, "the visit route is not built");
  assert.notEqual((await fetch(local + "/.well-known/agent-card.json")).status, 200, "the agent card is not built");
});
