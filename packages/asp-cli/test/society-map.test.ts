/**
 * The live society routes (register row DK290; spec-delta S360): served without a sign-in by `asp serve`, drawn from the log's public records only. Fake keys only.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { societyMapRoutes } from "../../asp-package/src/society-map-routes.ts";
import { kit, nowIso, operator } from "../../asp-log/test/society-kit.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

async function serveLog() {
  const k = await kit();
  await k.withPrices();
  const sponsor = await k.person("route-sponsor", 300);
  const bot = await k.agent("route-bot", sponsor, { tier: 1, funds: 100 });
  const house = await k.agent("route-house", operator, { tier: 1, funds: 10 });
  await k.cert(bot.did, "code");
  await k.runJob(await k.person("route-poster", 300), bot, 60);
  const route = societyMapRoutes({
    stored: async () => (await k.log.since(0, 100000)) as never, head: async () => k.log.head(), rep: async (d) => (await k.log.reputationOf(d)) as never,
    economy: async () => { const a = await k.log.creditAudit(); return { minted: a.minted, circulating: a.circulating, burned: a.burned, treasury: a.treasury, verdict: a.verdict }; },
    operator: operator.did, now: nowIso,
  });
  const server = createServer(async (req, res) => { if (!(await route(req, res))) { res.writeHead(404); res.end(); } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, bot, house };
}

test("GET /society/map/feed answers with no sign-in: twelve places, agents by name, house agents labelled, flows, the economy; JSON only public fields", async () => {
  const s = await serveLog();
  const r = await fetch(`${s.url}/society/map/feed`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") ?? "", /application\/json/);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const j = await r.json() as { ok: boolean; feed: { places: unknown[]; agents: { id: string; name: string; house: boolean }[]; flows: { kind: string }[]; economy: { verdict: string } } };
  assert.equal(j.ok, true);
  assert.equal(j.feed.places.length, 12);
  assert.deepEqual(j.feed.agents.map((a) => [a.name, a.house]).sort(), [["coder-1", false], ["route-bot", false], ["route-house", true]]);
  assert.ok(j.feed.flows.some((f) => f.kind === "settlement"));
  assert.equal(j.feed.economy.verdict, "balanced");
  const text = JSON.stringify(j);
  assert.equal(/public_key|"keys"|"sponsor"|"balance"/.test(text), false);
  // A live poll after the head gives nothing new; days and after are bounded numbers.
  const head = (await (await fetch(`${s.url}/society/map/feed?after=${(await (await fetch(`${s.url}/society/map/feed`)).json() as any).feed.head.seq}`)).json() as any).feed;
  assert.deepEqual(head.flows, []);
  assert.equal((await fetch(`${s.url}/society/map/feed?days=banana&after=-4`)).status, 200);
});

test("the day replay endpoint returns that day's flows, an empty day is empty, a bad day is a 400, and only GET and HEAD are answered", async () => {
  const s = await serveLog();
  const day = nowIso().slice(0, 10);
  const r = await (await fetch(`${s.url}/society/map/day/${day}`)).json() as { ok: boolean; replay: { day: string; flows: { seq: number }[]; firstSeq: number; lastSeq: number } };
  assert.equal(r.ok, true);
  assert.ok(r.replay.flows.length > 0);
  assert.equal(r.replay.firstSeq, r.replay.flows[0].seq);
  const feed = (await (await fetch(`${s.url}/society/map/feed?days=30`)).json() as any).feed;
  assert.deepEqual(r.replay.flows.map((f) => f.seq), feed.flows.filter((f: { at: string }) => f.at.slice(0, 10) === day).map((f: { seq: number }) => f.seq), "the replay of the day is the feed's flows of that day");
  assert.deepEqual(((await (await fetch(`${s.url}/society/map/day/2020-01-01`)).json()) as any).replay.flows, []);
  assert.equal((await fetch(`${s.url}/society/map/day/yesterday`)).status, 400);
  assert.equal((await fetch(`${s.url}/society/map/feed`, { method: "POST" })).status, 405);
  assert.equal((await fetch(`${s.url}/society/map/feed`, { method: "HEAD" })).status, 200);
  assert.equal((await fetch(`${s.url}/society/other`)).status, 404);
});

test("`asp serve` publishes /society/map/feed without a sign-in, from the log it serves: an empty log is twelve places and no agents", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-map-e2e-"));
  const tokens = join(dir, "tokens.json");
  await new Promise<void>((resolve) => { const c = spawn(process.execPath, [cli, "serve", "token", "--tokens", tokens, "--tenant", "ops", "--role", "admin"], { stdio: "ignore" }); c.on("close", () => resolve()); });
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", "0"], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let buf = "";
      server.stdout.on("data", (d) => { buf += d; const m = /listening on (http:\/\/[^ ]+)/.exec(buf); if (m) resolve(m[1]); });
      server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
      setTimeout(() => reject(new Error(`no start line: ${buf}`)), 20_000);
    });
    const j = await (await fetch(`${url}/society/map/feed`)).json() as any;
    assert.equal(j.ok, true);
    assert.equal(j.feed.places.length, 12);
    assert.deepEqual(j.feed.agents, []);
    assert.equal(j.feed.economy.verdict, "balanced");
    assert.equal(typeof j.feed.health.alarms.length, "number");
    assert.equal((await fetch(`${url}/society/map/day/2026-11-12`)).status, 200);
  } finally { server.kill(); }
});
