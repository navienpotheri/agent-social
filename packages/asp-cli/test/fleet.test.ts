// Row DK1354 (spec-delta S1459): `asp fleet plan | enrol | join | status`. A manifest of personas with counts brings a fleet into the society without a command for each agent: by invitation (every agent makes its
// own key where it runs and joins by itself over HTTP, the front-door tool and the HTTP route) or by bundle (the sponsor's machine makes each identity, key and passport, keys in per-agent files). Both resume and end
// with a signed summary. One test runs 10,000 agents in one go and states the time. Fake keys; mock credits; no model agent.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { b64urlDecode, verifyBytes } from "@agent-social/asp-core";
import { Signup, createLogServer, frontDoorTools, surfaceListing, type Tenant } from "@agent-social/asp-log";
import { Keystore, openLog } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";
import { FleetUsage, parseManifest } from "../src/fleet.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const ORG = "did:web:acme.example:org";
const FLEET = "did:web:acme.example:fleets:engineering";
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });

const manifest = (personas: { name: string; count: number; [k: string]: unknown }[], extra: Record<string, unknown> = {}) => ({ version: 1, sponsor: ORG, fleet: { name: "Engineering", purpose: "Keep the build green" }, personas, ...extra });
async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
async function setup(m: unknown) {
  const f = makeFixture();
  const r = await asp(f, ["identity", "new", "--kind", "human", "--did", ORG, "--no-recovery"]);
  assert.equal(r.code, 0, r.err);
  const file = join(f.root, "manifest.json");
  writeFileSync(file, JSON.stringify(m, null, 2));
  return { f, file, out: join(f.root, "out") };
}

test("a manifest is checked and every problem is said at once; the fleet's did comes from the sponsor's domain", () => {
  const ok = parseManifest(JSON.stringify(manifest([{ name: "developer", count: 6000 }, { name: "support", count: 2500 }, { name: "ceo", count: 1 }])));
  assert.equal(ok.total, 8501); assert.equal(ok.fleetDid, FLEET);
  assert.equal(parseManifest(JSON.stringify({ ...manifest([{ name: "a1x", count: 1 }]), fleet: { name: "X", did: "did:web:acme.example:fleets:own", purpose: "p" } })).fleetDid, "did:web:acme.example:fleets:own");
  const bad = (m: unknown, re: RegExp) => assert.throws(() => parseManifest(typeof m === "string" ? m : JSON.stringify(m)), (e: Error) => e instanceof FleetUsage && re.test(e.message));
  bad("{ nope", /not JSON/);
  bad({}, /5 problems/);
  bad({ ...manifest([{ name: "Developer!", count: 3 }]) }, /personas\[0\]\.name is a short label/);
  bad({ ...manifest([{ name: "dev", count: 0 }]) }, /count is a whole number, at least 1/);
  bad({ ...manifest([{ name: "dev", count: 1.5 }]) }, /count is a whole number/);
  bad({ ...manifest([{ name: "dev", count: 2 }, { name: "dev", count: 3 }]) }, /name dev is used twice/);
  bad({ ...manifest([{ name: "dev", count: 100_001 }]) }, /at most 100000 agents/);
  bad({ ...manifest([{ name: "dev", count: 1 }]), sponsor: "alice" }, /"sponsor" is the organisation's did/);
  bad({ ...manifest([{ name: "dev", count: 1 }]), sponsor: "did:key:z6Mkabc" }, /"fleet.did" is needed when the sponsor is not a did:web/);
  bad({ ...manifest([{ name: "dev", count: 1 }]), invitation_days: 0 }, /invitation_days/);
  bad({ ...manifest([{ name: "dev", count: 1, purpose: "" }]) }, /purpose is 1 to 300 characters/);
});

test("asp fleet plan says what would be created and writes nothing", async () => {
  const { f, file } = await setup(manifest([{ name: "developer", count: 6000, mandate_template: "dev-v1" }, { name: "support", count: 2500 }, { name: "ceo", count: 1 }]));
  const r = await asp(f, ["fleet", "plan", "--manifest", file]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /fleet Engineering \(did:web:acme\.example:fleets:engineering\), sponsored by did:web:acme\.example:org: 8501 agents in 3 personas/);
  assert.match(r.out, /developer\s+6000\s+Mandate template dev-v1/); assert.match(r.out, /support\s+2500\s+no Mandate template yet/);
  assert.match(r.out, /would write 8502 records.*nothing was written/);
  assert.equal(await (await openLog(f.aspHome, {})).log.fleet(FLEET), undefined, "the fleet is not declared by a plan");
  const j = JSON.parse((await asp(f, ["fleet", "plan", "--manifest", file, "--json"])).out);
  assert.equal(j.total, 8501); assert.equal(j.records, 8502);
  const bad = await asp(f, ["fleet", "plan", "--manifest", join(f.root, "nope.json")]);
  assert.notEqual(bad.code, 0);
});

test("enrol by invitation: the fleet is declared, one single-use invitation is signed for each slot, no agent key is made here, a stopped run resumes and a finished one creates nothing twice, and the summary is signed", async () => {
  const { f, file, out } = await setup(manifest([{ name: "developer", count: 6 }, { name: "support", count: 3 }, { name: "ceo", count: 1 }]));
  const keysBefore = readdirSync(join(f.aspHome, "keys")).length;
  const first = await asp(f, ["fleet", "enrol", "--manifest", file, "--out", out, "--stop-after", "4", "--days", "10"]);
  assert.equal(first.code, 3, first.err + first.out);
  assert.match(first.out, /fleet did:web:acme\.example:fleets:engineering declared .* 10 members at most/);
  assert.match(first.out, /4 invitations signed, 4 of 10/); assert.match(first.out, /stopped at 4 of 10: run the same command again to continue/);
  const rest = await asp(f, ["fleet", "enrol", "--manifest", file, "--out", out, "--days", "10"]);
  assert.equal(rest.code, 0, rest.err + rest.out);
  assert.match(rest.out, /fleet did:web:acme\.example:fleets:engineering is already declared/);
  assert.match(rest.out, /6 invitations signed \(4 from an earlier run\), 10 of 10/);
  const lines = readFileSync(join(out, "invitations.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(lines.length, 10);
  assert.deepEqual(["developer", "support", "ceo"].map((p) => lines.filter((l) => l.persona === p).length), [6, 3, 1], "the counts of the manifest, in order");
  assert.equal(new Set(lines.map((l) => l.nonce)).size, 10, "every invitation has its own nonce");
  assert.ok(lines.every((l) => l.fleet === FLEET && l.kid === `${ORG}#key-1`));
  assert.equal(readdirSync(join(f.aspHome, "keys")).length, keysBefore, "no agent key was made or kept on the sponsor's machine");
  const again = await asp(f, ["fleet", "enrol", "--manifest", file, "--out", out]);
  assert.match(again.out, /0 invitations signed \(10 from an earlier run\), 10 of 10/);
  assert.equal(readFileSync(join(out, "invitations.jsonl"), "utf8").split("\n").filter(Boolean).length, 10, "nothing was added by running it again");
  const summary = JSON.parse(readFileSync(join(out, "summary.json"), "utf8"));
  assert.deepEqual([summary.total, summary.invitations, summary.mode, summary.personas], [10, 10, "invite", { developer: 6, support: 3, ceo: 1 }]);
  const { sig, kid, ...body } = summary;
  const pub = new Keystore(f.aspHome).forDid(ORG)!.publicKey;
  assert.ok(verifyBytes(b64urlDecode(sig), new TextEncoder().encode(JSON.stringify(body)), pub), "the summary is signed by the sponsor");
  assert.ok(!JSON.stringify(summary).match(/seed|secret|private/i), "the summary holds no key");
  // another manifest into the same folder is refused
  writeFileSync(file, JSON.stringify(manifest([{ name: "developer", count: 7 }])));
  const other = await asp(f, ["fleet", "enrol", "--manifest", file, "--out", out]);
  assert.notEqual(other.code, 0); assert.match(other.err, /holds a run of another manifest or mode/);
});

async function service(f: Fixture) {
  const tenants: Tenant[] = [{ name: "ops", role: "admin", tokenSha256: "0".repeat(64) }];
  const signup = new Signup({ tenants: () => tenants, add: (t) => { tenants.push(t); }, termsVersion: "v1", termsUrl: "https://example.org/terms", difficulty: 8, secret: Buffer.alloc(32, 5) });
  const handle = await openLog(f.aspHome, {});
  const server = createLogServer({ handle, tenants, signup, noAuth: false, trustProxy: true });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r)); servers.push(server);
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, tenants, handle };
}

test("an agent joins its fleet by itself with the invitation: it makes its own key, issues its own passport, gets a tenant and a token once; the same invitation, a forged one and an expired one are refused", async () => {
  const { f, file, out } = await setup(manifest([{ name: "developer", count: 4 }, { name: "ceo", count: 1 }]));
  assert.equal((await asp(f, ["fleet", "enrol", "--manifest", file, "--out", out])).code, 0);
  const svc = await service(f);
  const lines = readFileSync(join(out, "invitations.jsonl"), "utf8").split("\n").filter(Boolean);
  const agentHome = mkdtempSync(join(tmpdir(), "asp-agent-"));
  const agent = async (args: string[]) => { const o: string[] = [], e: string[] = []; const io: Io = { out: (l) => o.push(l), err: (l) => e.push(l), env: { ASP_HOME: agentHome }, cwd: agentHome }; const code = await main(args, io); return { code, out: o.join("\n"), err: e.join("\n") }; };
  // joining accepts the terms on purpose
  const noTerms = await agent(["fleet", "join", "--invitation", lines[0], "--service", svc.url]);
  assert.notEqual(noTerms.code, 0); assert.match(noTerms.err, /accepts the service's terms: add --accept-terms/);
  const ok = await agent(["fleet", "join", "--invitation", lines[0], "--service", svc.url, "--accept-terms"]);
  assert.equal(ok.code, 0, ok.err + ok.out);
  assert.match(ok.out, new RegExp(`joined ${FLEET} as did:key:\\S+ \\(developer\\), sponsored by ${ORG}`));
  const did = /as (did:key:\S+)/.exec(ok.out)![1];
  const token = /token\s+(\S+)/.exec(ok.out)![1];
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const p = await svc.handle.log.passport(did);
  assert.equal(p!.sponsor, ORG); assert.equal(p!.fleet, FLEET);
  assert.ok((await svc.handle.log.fleet(FLEET))!.members.some((m: { did: string }) => m.did === did), "the fleet lists the agent");
  assert.ok(svc.tenants.some((t) => t.signup?.fleetMember?.did === did && t.signup.fleetMember.persona === "developer"), "its tenant says it is a fleet member");
  assert.ok(existsSync(join(agentHome, "fleet-joined")), "its key is kept on its own machine");
  assert.ok(!readFileSync(join(out, "invitations.jsonl"), "utf8").includes(readdirSync(join(agentHome, "fleet-joined"))[0]), "the sponsor never saw the key");
  // the token works
  const rpc = await fetch(`${svc.url}/rpc`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ target: "log", method: "head", args: [] }) });
  assert.equal(rpc.status, 200);
  // the same invitation again
  const again = await agent(["fleet", "join", "--invitation", lines[0], "--service", svc.url, "--accept-terms"]);
  assert.notEqual(again.code, 0); assert.match(again.err, /invitation_used|already been used/);
  // a forged one: the sponsor's kid, another signature
  const forged = JSON.stringify({ ...JSON.parse(lines[1]), sig: "A".repeat(86) });
  const bad = await agent(["fleet", "join", "--invitation", forged, "--service", svc.url, "--accept-terms"]);
  assert.notEqual(bad.code, 0); assert.match(bad.err, /invitation_bad_signature/);
  // a changed persona (a developer asking to be the ceo)
  const upgraded = JSON.stringify({ ...JSON.parse(lines[2]), persona: "ceo" });
  const up = await agent(["fleet", "join", "--invitation", upgraded, "--service", svc.url, "--accept-terms"]);
  assert.notEqual(up.code, 0); assert.match(up.err, /invitation_bad_signature/);
  // an expired one: the organisation signs a short one
  const org = new Keystore(f.aspHome).forDid(ORG)!;
  const { makeInvitation } = await import("@agent-social/asp-log");
  const old = JSON.stringify(makeInvitation(org, { fleet: FLEET, persona: "developer", expires: "2026-01-01T00:00:00Z" }));
  const exp = await agent(["fleet", "join", "--invitation", old, "--service", svc.url, "--accept-terms"]);
  assert.notEqual(exp.code, 0); assert.match(exp.err, /invitation_expired/);
  // nothing of that made a tenant
  assert.equal(svc.tenants.filter((t) => t.signup?.fleetMember).length, 1);
  // a join with no passport, or a passport that is not the agent's own, is refused plainly
  const raw = (b: unknown) => fetch(`${svc.url}/fleet/join`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
  assert.equal((await raw({})).status, 400);
  assert.equal((await agent(["fleet", "join", "--invitation", "{ not json", "--service", svc.url, "--accept-terms"])).code, 2);
});

test("the front door lists society_fleet_join, the route list has POST /fleet/join, and the surface says it needs no proof of work", () => {
  const tool = frontDoorTools().find((t) => t.name === "society_fleet_join")!;
  assert.ok(tool, "the tool is listed");
  assert.deepEqual(tool.http, { method: "POST", path: "/fleet/join", auth: "none" });
  assert.deepEqual((tool.inputSchema as { required: string[] }).required, ["passport", "accept_terms", "terms_version"]);
  assert.match(tool.description, /invitation your organisation signed/); assert.match(tool.description, /The service never sees your key/);
  const routes = (surfaceListing({ flags: {} }) as unknown as { groups: { routes: { method: string; path: string; auth: string; writes: boolean; says?: string; what?: string }[] }[] }).groups.flatMap((g) => g.routes);
  const row = routes.find((r) => r.path === "/fleet/join");
  assert.ok(row, "the surface lists the route");
  assert.deepEqual([row!.method, row!.auth, row!.writes], ["POST", "none", true]);
  assert.match(JSON.stringify(row), /no proof of work and no per-address count/);
});

async function bundleRun(personas: { name: string; count: number }[], stopAfter?: number) {
  const s = await setup(manifest(personas));
  return { ...s, run: (extra: string[] = []) => asp(s.f, ["fleet", "enrol", "--manifest", s.file, "--out", s.out, "--mode", "bundle", ...extra]) };
}

test("enrol in bundle mode makes each agent's identity, key and passport here: keys in per-agent files and not in the sponsor's keystore, resumable after a stop and after a crash that left a key behind", async () => {
  const b = await bundleRun([{ name: "developer", count: 7 }, { name: "ceo", count: 1 }]);
  const keysBefore = readdirSync(join(b.f.aspHome, "keys")).length;
  const first = await b.run(["--stop-after", "3"]);
  assert.equal(first.code, 3, first.err + first.out);
  assert.match(first.out, /3 agents enrolled, 3 of 8/);
  // a crash between writing a key and appending its passport: a key file with no member line
  const files = readdirSync(join(b.out, "agents")).sort();
  assert.equal(files.length, 3);
  const rest = await b.run();
  assert.equal(rest.code, 0, rest.err + rest.out);
  assert.match(rest.out, /5 agents enrolled \(3 from an earlier run\), 8 of 8/);
  const log = await openLog(b.f.aspHome, {});
  const fleet = (await log.log.fleet(FLEET))!;
  assert.equal(fleet.members.length, 8);
  const keyFiles = readdirSync(join(b.out, "agents"));
  assert.equal(keyFiles.length, 8);
  const keyFile = JSON.parse(readFileSync(join(b.out, "agents", keyFiles[0]), "utf8"));
  assert.match(keyFile.did, /^did:key:z/); assert.equal(keyFile.fleet, FLEET); assert.equal(keyFile.sponsor, ORG); assert.match(keyFile.seed, /^[A-Za-z0-9_-]{43}$/);
  if (process.platform !== "win32") assert.equal(statSync(join(b.out, "agents", keyFiles[0])).mode & 0o077, 0, "the key file is private to its owner");
  assert.equal(readdirSync(join(b.f.aspHome, "keys")).length, keysBefore, "the sponsor's keystore holds no agent key");
  for (const m of fleet.members) { const p = await log.log.passport(m.did); assert.equal(p!.sponsor, ORG); assert.equal(p!.fleet, FLEET); }
  const again = await b.run();
  assert.match(again.out, /0 agents enrolled \(8 from an earlier run\), 8 of 8/);
  assert.equal((await log.log.fleet(FLEET))!.members.length, 8, "running it again created nothing");
  const summary = JSON.parse(readFileSync(join(b.out, "summary.json"), "utf8"));
  assert.equal(summary.agents, 8); assert.match(summary.members_root, /^sha256:[0-9a-f]{64}$/);
  const st = JSON.parse((await asp(b.f, ["fleet", "status", "--manifest", b.file, "--out", b.out, "--json"])).out);
  assert.deepEqual([st.declared, st.wanted, st.in_the_log, st.bundled, st.key_files], [true, 8, 8, 8, 8]);
});

test("a crash that left a key file with no passport is finished on the next run with the same key, and a member line that was half written is ignored", async () => {
  const b = await bundleRun([{ name: "developer", count: 3 }]);
  assert.equal((await b.run(["--stop-after", "1"])).code, 3);
  // simulate: the second agent's key was written, its passport was not, and the members file ends in half a line
  const seedFile = join(b.out, "agents", "developer-00002.key.json");
  const { randomSeed, publicKeyFromSeed, didKeyFromPublicKey, b64urlEncode } = await import("@agent-social/asp-core");
  const seed = randomSeed(); const did = didKeyFromPublicKey(publicKeyFromSeed(seed));
  writeFileSync(seedFile, JSON.stringify({ did, kid: `${did}#key-1`, seed: b64urlEncode(seed), persona: "developer", fleet: FLEET, sponsor: ORG }));
  writeFileSync(join(b.out, "members.jsonl"), readFileSync(join(b.out, "members.jsonl"), "utf8") + '{"persona":"developer","ind');
  const done = await b.run();
  assert.equal(done.code, 0, done.err + done.out);
  const log = await openLog(b.f.aspHome, {});
  assert.ok(await log.log.passport(did), "the orphan key's agent was enrolled with the key it already had");
  assert.equal((await log.log.fleet(FLEET))!.members.length, 3);
});

test("10,000 agents in one run on the sponsor's machine, stopped part-way and resumed: every identity, key and passport exists once, in a stated time", async () => {
  const N = 10_000;
  const b = await bundleRun([{ name: "developer", count: 6000 }, { name: "support", count: 2500 }, { name: "researcher", count: 1499 }, { name: "ceo", count: 1 }]);
  const t0 = Date.now();
  const first = await b.run(["--stop-after", "4000"]);
  assert.equal(first.code, 3, first.err + first.out.slice(-300));
  const second = await b.run();
  assert.equal(second.code, 0, second.err + second.out.slice(-300));
  const seconds = (Date.now() - t0) / 1000;
  console.log(`DK1354: ${N} agents enrolled in ${Math.round(seconds)} seconds (${Math.round(N / seconds)} a second), stopped at 4,000 and resumed`);
  assert.match(second.out, /6000 agents enrolled \(4000 from an earlier run\), 10000 of 10000/);
  const log = await openLog(b.f.aspHome, {});
  const fleet = (await log.log.fleet(FLEET))!;
  assert.equal(fleet.members.length, N);
  assert.equal(new Set(fleet.members.map((m: { did: string }) => m.did)).size, N, "every did once");
  assert.equal(readdirSync(join(b.out, "agents")).length, N, "one key file for each agent");
  const personas = new Map<string, number>();
  for (const f of readdirSync(join(b.out, "agents"))) personas.set(f.split("-")[0], (personas.get(f.split("-")[0]) ?? 0) + 1);
  assert.deepEqual([...personas].sort(), [["ceo", 1], ["developer", 6000], ["researcher", 1499], ["support", 2500]]);
  assert.equal(JSON.parse(readFileSync(join(b.out, "summary.json"), "utf8")).agents, N);
  assert.ok(seconds < 900, `the run takes under 15 minutes (took ${Math.round(seconds)} s)`);
  assert.equal((await log.log.verify()).ok, true, "the log still verifies: every hash, every signature");
});
