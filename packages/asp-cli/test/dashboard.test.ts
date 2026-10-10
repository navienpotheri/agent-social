import { after, test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import type { Server } from "node:http";
import { Keystore, LocalLog, openLog } from "@agent-social/asp-package";
import { createDashboard } from "../src/dashboard-server.ts";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const ALICE = "did:web:example.com:users:alice";
const CODER = "did:web:example.com:agents:coder";
const OTHER = "did:web:example.com:agents:other";
const BANK = "did:web:example.com:bank";
const TOKEN = "dashboard-test-token";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };

async function job(f: Fixture, agent: string, purpose: string, scopes: string[], extra: string[] = []) {
  const intent = /^intent (\S+)/.exec((await ok(f, ["market", "intent", "--by", ALICE, "--purpose", purpose, "--budget", "500", "--deadline", "2026-12-01T00:00:00Z"])).out)![1];
  const offer = /^offer (\S+)/.exec((await ok(f, ["market", "offer", "--by", agent, "--intent", intent, "--price", "500", "--plan", "go", "--eta", "2026-11-01T00:00:00Z"])).out)![1];
  const contract = /^contract (\S+):/.exec((await ok(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1];
  await ok(f, ["market", "bond", "--contract", contract, "--backer", agent, "--amount", "100", "--escrow-payer", ALICE, "--escrow-amount", "500"]);
  await ok(f, ["market", "mandate", "--contract", contract, "--principal", ALICE, "--performer", agent, ...scopes.flatMap((s) => ["--scopes", s]), ...extra]);
  return contract;
}

async function setup() {
  const f = makeFixture();
  await ok(f, ["identity", "new", "--kind", "human", "--did", ALICE]);
  await ok(f, ["identity", "new", "--kind", "human", "--did", BANK]);
  for (const a of [CODER, OTHER]) await ok(f, ["identity", "new", "--kind", "agent", "--did", a, "--sponsor", ALICE, "--purpose", "Work"]);
  await ok(f, ["credits", "grant", "--to", ALICE, "--amount", "3000"]);
  for (const a of [CODER, OTHER]) await ok(f, ["credits", "grant", "--to", a, "--amount", "500"]);
  // One accepted job (with fees), one stopped by the kill switch, one waiting for an approval, one running with a blocked attempt.
  const accepted = await job(f, CODER, "Fix the flaky test", ["repo.read"]);
  await ok(f, ["market", "deliver", "--contract", accepted, "--by", CODER, "--summary", "Fixed it"]);
  await ok(f, ["market", "accept", "--contract", accepted, "--by", ALICE]);
  await ok(f, ["market", "settle", "--contract", accepted, "--bank", BANK, "--basis", "accepted", "--escrow-released", "450", "--bond-returned", "100", "--bond-slashed", "0", "--fees", "50"]);
  const killed = await job(f, OTHER, "Review the migration", ["repo.read"]);
  await ok(f, ["market", "settle", "--contract", killed, "--bank", BANK, "--basis", "revoked", "--principal", ALICE, "--escrow-released", "0", "--bond-slashed", "100", "--bond-returned", "0", "--pro-rata", "0"]);
  const waiting = await job(f, CODER, "Migrate the orders table", ["repo.read", "shell.exec"], ["--gate", "shell.exec"]);
  await ok(f, ["market", "checkpoint", "--contract", waiting, "--by", CODER, "--question", "May I run the migration?", "--summary", "npm run migrate"]);
  const running = await job(f, CODER, "Summarise tickets", ["repo.read"]);
  await ok(f, ["market", "action", "--contract", running, "--by", CODER, "--scopes-used", "repo.read", "--blocked", "shell.exec=2"]);

  const keys = new Keystore(f.aspHome);
  const server = createDashboard({
    token: TOKEN, openLog: () => openLog(f.aspHome, {}), runLogFor: () => undefined, signerFor: (did) => keys.forDid(did), now: () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const port = (server.address() as { port: number }).port;
  const get = async (path: string, token: string | null = TOKEN) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers: token ? { "x-dashboard-token": token } : {} });
    return { status: res.status, body: (res.headers.get("content-type") ?? "").includes("json") ? await res.json() : await res.text() } as { status: number; body: any };
  };
  const post = async (path: string, body: unknown) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", headers: { "x-dashboard-token": TOKEN, "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as any };
  };
  return { f, port, get, post, ids: { accepted, killed, waiting, running } };
}

test("the dashboard answers only on this machine and only with its token; the page itself is served without one", async () => {
  const { port, get } = await setup();
  const page = await get("/", null);
  assert.equal(page.status, 200);
  assert.match(page.body, /<title>Agent Social<\/title>/);
  assert.match(page.body, /id="app"/);
  assert.equal((await get("/api/home", null)).status, 401);
  assert.equal((await get("/api/home", "not-the-token")).status, 401);
  assert.equal((await get("/api/home")).status, 200);
  assert.equal((await get("/nothing")).status, 404);
  // A request that names another host (a web page reaching it through a DNS trick) is refused before anything else.
  const status = await new Promise<number>((resolve, reject) => {
    const r = request({ host: "127.0.0.1", port, path: "/api/home", headers: { host: "evil.example", "x-dashboard-token": TOKEN } }, (res) => { res.resume(); resolve(res.statusCode!); });
    r.on("error", reject); r.end();
  });
  assert.equal(status, 403);
});

test("home: agents with credits, strikes and blocked calls, jobs with their state, and counts that match the log", async () => {
  const { get, ids } = await setup();
  const h = (await get("/api/home")).body;
  assert.deepEqual([h.counts.jobs, h.counts.settled, h.counts.waiting], [4, 2, 1]);
  assert.equal(h.counts.running, 2, "a job waiting on an approval is still running");
  const byId = new Map<string, any>(h.jobs.map((j: any) => [j.id, j]));
  assert.equal(byId.get(ids.accepted).state, "Settled");
  assert.equal(byId.get(ids.waiting).state, "Checkpoint");
  assert.equal(byId.get(ids.running).blocked, 2);
  const coder = h.agents.find((a: any) => a.did === CODER);
  assert.equal(coder.jobs, 3);
  assert.equal(coder.blocked, 2);
  assert.equal(coder.strikes, 2);
  const other = h.agents.find((a: any) => a.did === OTHER);
  assert.equal(other.tier, 0, "the agent the kill switch stopped is demoted");
  assert.ok(h.head.seq > 20);
});

test("a job's page: what it was allowed, what it did, what was blocked, its chain and the money it holds", async () => {
  const { get, ids } = await setup();
  const j = (await get(`/api/job?id=${encodeURIComponent(ids.running)}`)).body;
  assert.equal(j.facts.mandate.scopes.join(), "repo.read");
  assert.equal(j.facts.activity.strikes, 2);
  assert.deepEqual(j.facts.activity.blocked, [{ scope: "shell.exec", count: 2 }]);
  assert.deepEqual(j.chain.map((c: any) => c.kind), ["contract", "bond", "mandate"]);
  assert.equal(j.money.escrowLocked, 500);
  assert.equal(j.actions.length, 1);
  assert.equal(j.runLog, undefined);
  const done = (await get(`/api/job?id=${encodeURIComponent(ids.accepted)}`)).body;
  assert.equal(done.facts.ending.basis, "accepted");
  assert.deepEqual(done.chain.map((c: any) => c.kind), ["contract", "bond", "mandate", "delivery", "acceptance", "settlement"]);
  assert.deepEqual(done.flows.at(-1).lines.map((l: any) => [l.label, l.amount]), [["escrow paid out", 450], ["bond returned", 100], ["fees", 50]]);
  assert.equal((await get("/api/job?id=sha256:nothing")).status, 404);
});

test("approvals: a call waiting for the principal is listed and can be answered from the dashboard with the principal's own key, once", async () => {
  const { f, get, post, ids } = await setup();
  const inbox = (await get("/api/inbox")).body;
  assert.equal(inbox.waiting.length, 1);
  assert.deepEqual([inbox.waiting[0].contract, inbox.waiting[0].question, inbox.waiting[0].proposed], [ids.waiting, "May I run the migration?", "npm run migrate"]);

  assert.equal((await post("/api/resolve", { contract: ids.waiting, verdict: "maybe" })).status, 400);
  assert.equal((await post("/api/resolve", { contract: ids.running, verdict: "approved" })).status, 409, "no approval is waiting on this job");
  const done = await post("/api/resolve", { contract: ids.waiting, verdict: "approved" });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.state, "Running");
  assert.equal((await get("/api/inbox")).body.waiting.length, 0);
  assert.equal((await post("/api/resolve", { contract: ids.waiting, verdict: "approved" })).status, 409, "answering twice is refused");
  // It is a real signed record from the principal, in the log.
  const local = await LocalLog.open(f.aspHome);
  const res = (await local.log.since(0, 1000)).filter((s) => s.record.type === "asp.attestation/v0.2" && (s.record.body as any).kind === "checkpoint_resolution");
  assert.equal(res.length, 1);
  assert.equal(res[0].record.issuer, ALICE);
  assert.equal((res[0].record.body as any).verdict, "approved");
});

test("a refusal from the dashboard carries the reason, and without the principal's key here the dashboard cannot answer for them", async () => {
  const { f, get, post, ids } = await setup();
  const refused = await post("/api/resolve", { contract: ids.waiting, verdict: "refused", reason: "run it tomorrow" });
  assert.equal(refused.status, 200);
  const local = await LocalLog.open(f.aspHome);
  const rec = (await local.log.since(0, 1000)).find((s) => s.record.type === "asp.attestation/v0.2" && (s.record.body as any).kind === "checkpoint_resolution")!;
  assert.deepEqual([(rec.record.body as any).verdict, (rec.record.body as any).correction], ["corrected", "run it tomorrow"]);
  const j = (await get(`/api/job?id=${encodeURIComponent(ids.waiting)}`)).body;
  assert.equal(j.facts.approvals[0].answer, "corrected");

  // Another machine, where the principal's key is not.
  const bare = createDashboard({ token: TOKEN, openLog: () => openLog(f.aspHome, {}), runLogFor: () => undefined, signerFor: () => undefined, now: () => "2026-10-10T00:00:00Z" });
  await new Promise<void>((r) => bare.listen(0, "127.0.0.1", r));
  servers.push(bare);
  const none = await fetch(`http://127.0.0.1:${(bare.address() as { port: number }).port}/api/resolve`, { method: "POST", headers: { "x-dashboard-token": TOKEN, "content-type": "application/json" }, body: JSON.stringify({ contract: ids.waiting, verdict: "approved" }) });
  assert.ok([409].includes(none.status));
});

test("alerts list a kill with its reason and the latest blocked attempts; money shows where every credit is and that none was lost", async () => {
  const { get, ids } = await setup();
  const a = (await get("/api/alerts")).body;
  assert.deepEqual(a.alerts.map((x: any) => [x.kind, x.contract]), [["killed", ids.killed]]);
  assert.match(a.alerts[0].detail, /100 credit of the agent's bond was slashed/);
  assert.deepEqual(a.blocked.map((b: any) => [b.scope, b.count, b.agent]), [["shell.exec", 2, CODER]]);

  const m = (await get("/api/money")).body;
  assert.equal(m.conserved, true, `off by ${m.difference}`);
  assert.equal(m.minted, 4000);
  assert.equal(m.minted, m.totals.balances + m.totals.lockedEscrow + m.totals.lockedBond);
  assert.equal(m.locked.length, 2, "the waiting and the running job still hold their escrow and bond");
  assert.equal(m.totals.lockedEscrow, 1000);
  const platform = m.accounts.find((x: any) => x.did === "did:web:asp.local:platform");
  assert.equal(platform.balance, 50, "the fees went to the platform account");
  assert.deepEqual(m.feed.filter((x: any) => x.kind === "settlement").flatMap((x: any) => x.lines.map((l: any) => l.label)).sort(), ["bond returned", "bond slashed", "escrow paid out", "fees"]);
});

test("verify replays the whole log", async () => {
  const { get } = await setup();
  const v = (await get("/api/verify")).body;
  assert.equal(v.ok, true);
  assert.ok(v.records > 20);
});

test("the page's script compiles (a syntax error in it would blank every screen)", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync(new URL("../src/dashboard-ui.html", import.meta.url), "utf8");
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1];
  assert.doesNotThrow(() => new Function(script));
  // Anything an agent or a person can write shows up through esc(), never as raw markup.
  assert.match(script, /const esc = /);
});

test("an agent's page: who stands behind it, keys, what it did and was blocked from, jobs, the penalty its kill left in its lineage, and its tier", async () => {
  const { get, ids } = await setup();
  const o = (await get(`/api/agent?did=${encodeURIComponent(OTHER)}`)).body;
  assert.equal(o.kind, "agent");
  assert.equal(o.sponsor, ALICE);
  assert.equal(o.tier, 0, "stopped by the kill switch, so tier 0");
  assert.equal(o.slashCount, 1);
  assert.equal(o.record.slashed, 100);
  assert.deepEqual([o.record.asPerformer, o.record.settled, o.record.revoked, o.record.accepted], [1, 1, 1, 0]);
  assert.equal(o.keys.length, 1);
  assert.equal(o.keys[0].revoked, false);
  assert.deepEqual(o.jobs.map((j: any) => [j.id, j.role, j.state, j.counterparty]), [[ids.killed, "performer", "Settled", ALICE]]);
  assert.equal(o.lineage.length, 1);
  assert.deepEqual([o.lineage[0].edge, o.lineage[0].layer], ["update", "memory"]);
  assert.match(o.lineage[0].description, /^Penalized: bond slashed 100 credits/);
  assert.equal(o.credits, 400, "500 granted, 100 bond forfeited");

  const c = (await get(`/api/agent?did=${encodeURIComponent(CODER)}`)).body;
  assert.deepEqual([c.record.asPerformer, c.record.accepted, c.record.paid], [3, 1, 450]);
  assert.deepEqual(c.record.scopesUsed, ["repo.read"]);
  assert.deepEqual(c.record.scopesBlocked, ["shell.exec"]);
  assert.equal(c.record.blocked, 2);
  assert.equal(c.strikes, 2);
  assert.deepEqual(c.lineage, []);
  assert.equal((await get(`/api/agent?did=${encodeURIComponent("did:web:example.com:agents:nobody")}`)).status, 404);
});

test("a person's page lists the agents they sponsor and the jobs they hired for; a canary certificate on a lineage edge shows as a verdict", async () => {
  const { f, get } = await setup();
  const a = (await get(`/api/agent?did=${encodeURIComponent(ALICE)}`)).body;
  assert.equal(a.kind, "human");
  assert.deepEqual(a.sponsored.map((s: any) => s.did).sort(), [CODER, OTHER].sort());
  assert.ok(a.jobs.every((j: any) => j.role === "principal"));
  assert.equal(a.jobs.length, 4);

  // A change to the agent with the canary's certificate cited as its gate.
  const { createRecord } = await import("@agent-social/asp-core");
  const handle = await openLog(f.aspHome, {});
  const signer = new Keystore(f.aspHome).forDid(CODER)!;
  const cert = createRecord({ type: "attestation", issuer: CODER, subject: CODER, prev: null, issued_at: "2026-10-10T00:00:00Z", body: { kind: "certificate", about: "sha256:" + "a".repeat(64), verdict: "passed", score: 1000, skill: "canary:default" } }, signer);
  await handle.append(cert);
  await handle.append(createRecord({ type: "lineage", issuer: CODER, subject: CODER, prev: null, issued_at: "2026-10-10T00:00:05Z", body: { edge: "update", child: CODER, parents: [CODER], change: { layer: "memory", description: "memory updated: +2 files", gates: [cert.id] } } }, signer));
  const c = (await get(`/api/agent?did=${encodeURIComponent(CODER)}`)).body;
  assert.equal(c.lineage.length, 1);
  assert.deepEqual(c.lineage[0].gates, [{ id: cert.id, verdict: "passed", scorePercent: 100, skill: "canary:default" }]);
});

test("a copy's page says what it was copied from, and the original lists its copies", async () => {
  const { f, get } = await setup();
  const out = (await ok(f, ["identity", "copy", CODER, "--count", "2"])).out.split("\n").filter((l) => /^did:/.test(l.trim())).map((l) => l.trim().split(/\s+/)[0]);
  assert.equal(out.length, 2, `two copies were made: ${out.join(", ")}`);
  const c = (await get(`/api/agent?did=${encodeURIComponent(out[0])}`)).body;
  assert.equal(c.copiedFrom, CODER, "the page says which agent it was copied from");
  assert.equal(c.sponsor, ALICE, "a copy has the same sponsor");
  assert.equal(c.credits, 0, "a copy has its own account, not its parent's");
  const parent = (await get(`/api/agent?did=${encodeURIComponent(CODER)}`)).body;
  assert.deepEqual([...parent.copies].sort(), [...out].sort(), "the parent lists its copies");
});

// ---------- packages and commons on the agent's page (U13) ----------

async function dashboardWith(f: Fixture, extras: ReturnType<typeof import("../src/dashboard-server.ts").makeExtras>) {
  const keys = new Keystore(f.aspHome);
  const server = createDashboard({ token: TOKEN, openLog: () => openLog(f.aspHome, {}), runLogFor: () => undefined, signerFor: (did) => keys.forDid(did), now: () => "2026-10-10T00:00:00Z", extras });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const port = (server.address() as { port: number }).port;
  return async (path: string) => (await (await fetch(`http://127.0.0.1:${port}${path}`, { headers: { "x-dashboard-token": TOKEN } })).json()) as any;
}

test("an agent's page says when it cannot show packages and commons, instead of an empty list that looks like the whole truth", async () => {
  const { get } = await setup();
  const a = (await get(`/api/agent?did=${encodeURIComponent(CODER)}`)).body;
  assert.deepEqual([a.packages, a.commons], [[], []]);
  assert.match(a.notes[0], /no package folder or service is configured/);
});

test("packages found in a folder show the agent's runtime, skills and memory against its budget", async () => {
  const { f } = await setup();
  const { makeExtras } = await import("../src/dashboard-server.ts");
  const { mkdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const folder = join(f.root, "packages");
  mkdirSync(folder, { recursive: true });
  await ok(f, ["pack", "--runtime", "claude-code", "--agent", CODER, "--project", f.project, "--user-home", f.home, "--out", join(folder, "coder.aspkg")]);
  await ok(f, ["pack", "--runtime", "claude-code", "--agent", OTHER, "--project", f.project, "--user-home", f.home, "--out", join(folder, "other.aspkg.tgz")]);
  const get = await dashboardWith(f, makeExtras({ folder }));
  const a = await get(`/api/agent?did=${encodeURIComponent(CODER)}`);
  assert.equal(a.packages.length, 1, "only this agent's package, not the other agent's");
  const p = a.packages[0];
  assert.deepEqual([p.source, p.name, p.runtime.name], ["this machine", "coder", "claude-code"]);
  assert.ok(p.memory.files >= 0 && p.memory.bytes >= 0);
  assert.deepEqual(p.memory.budget, { maxFiles: 200, maxBytes: 1048576, maxIndexLines: 200 });
  assert.ok(Number.isInteger(p.skills));
  const other = await get(`/api/agent?did=${encodeURIComponent(OTHER)}`);
  assert.deepEqual(other.packages.map((x: any) => x.name), ["other"], "an archive is read too");
  assert.deepEqual(a.notes, [], "nothing was missing");
});

test("through a log service: the agent's packages and the lessons it shared, with who endorsed and cited them", async () => {
  const { f } = await setup();
  const { makeExtras } = await import("../src/dashboard-server.ts");
  const { createLogServer, hashToken } = await import("@agent-social/asp-log");
  const { PackagesClient, packageRoutes, commonsRoutes } = await import("@agent-social/asp-package");
  const { mkdtempSync, readFileSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const handle = await LocalLog.open(f.aspHome);
  const root = mkdtempSync(join(tmpdir(), "asp-u13-"));
  const routes = [packageRoutes({ root: join(root, "packages") }), commonsRoutes({ root: join(root, "commons"), handle })];
  const service = createLogServer({
    handle, tenants: [{ name: "ops", role: "admin", tokenSha256: hashToken("svc-token") }],
    extra: async (req: any, res: any, ctx: any) => { for (const r of routes) if (await r(req, res, ctx)) return true; return false; },
  });
  await new Promise<void>((r) => service.listen(0, "127.0.0.1", r));
  servers.push(service);
  const url = `http://127.0.0.1:${(service.address() as { port: number }).port}`;

  // The agent's package goes up, and the agent shares a lesson.
  const archive = join(root, "coder.aspkg.tgz");
  await ok(f, ["pack", "--runtime", "claude-code", "--agent", CODER, "--project", f.project, "--user-home", f.home, "--out", archive]);
  await new PackagesClient(url, "svc-token").push("coder", readFileSync(archive));
  const lesson = join(root, "lesson.md");
  writeFileSync(lesson, "Run migrations before seeding test data, or the seed fails on a missing column.\n");
  const out: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => out.push(l), env: { ASP_HOME: f.aspHome, ASP_LOG_URL: url, ASP_LOG_TOKEN: "svc-token" }, cwd: f.root };
  assert.equal(await main(["commons", "add", lesson, "--by", CODER, "--title", "Migrations first", "--tag", "testing,database"], io), 0, out.join("\n"));

  const get = await dashboardWith(f, makeExtras({ serviceUrl: url, serviceToken: "svc-token" }));
  const a = await get(`/api/agent?did=${encodeURIComponent(CODER)}`);
  assert.equal(a.packages.length, 1);
  assert.deepEqual([a.packages[0].source, a.packages[0].name, a.packages[0].runtime.name], ["the log service", "coder", "claude-code"]);
  assert.equal(a.commons.length, 1);
  assert.deepEqual([a.commons[0].title, a.commons[0].status, a.commons[0].citations], ["Migrations first", "unreviewed", 0]);
  assert.deepEqual(a.commons[0].tags, ["testing", "database"]);
  assert.deepEqual(a.notes, []);
  // The service wrote a sidecar at upload, and a second listing reads it.
  assert.equal((await new PackagesClient(url, "svc-token").list()).packages[0].meta?.agent, CODER);

  // A service that is down is said so, not shown as an empty agent.
  const down = await dashboardWith(f, makeExtras({ serviceUrl: "http://127.0.0.1:9", serviceToken: "x" }));
  const d = await down(`/api/agent?did=${encodeURIComponent(CODER)}`);
  assert.deepEqual([d.packages, d.commons], [[], []]);
  assert.ok(d.notes.length >= 1 && /could not read/.test(d.notes[0]), JSON.stringify(d.notes));
});
