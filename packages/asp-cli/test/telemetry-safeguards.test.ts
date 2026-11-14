/**
 * Telemetry's safeguards (register row DK195; spec-delta S342; instrumentation.md 7 and 13): no consent or Mandate field is accepted from a tenant held for a young person; the local raw store masks secrets and
 * personal data before it writes, expires on retention, and `purge --raw` removes the text and its salt so the remaining hash cannot be matched; a probe runs on a copy and leaves the package hash unchanged and
 * takes no free text. Fake keys, fake secrets and fake personal data only.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { createRecord, signerFromSeed } from "@agent-social/asp-core";
import { createLogServer, hashToken, type Tenant } from "@agent-social/asp-log";
import { LocalLog, LocalRawStore, packageDigest, redactTelemetryText, runReadOnlyProbe } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const MINOR = "minor-token", ADULT = "adult-token";
const tenants: Tenant[] = [{ name: "young", role: "tenant", tokenSha256: hashToken(MINOR), minor: true }, { name: "grown", role: "tenant", tokenSha256: hashToken(ADULT) }];

test("a tenant held for a young person is refused a telemetry consent and a Mandate with a telemetry field, with the rule's name; its other records and an adult tenant's are not stopped by it", async () => {
  const handle = await LocalLog.open(mkdtempSync(join(tmpdir(), "asp-tm-log-")));
  const server = createLogServer({ handle, tenants });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/rpc`;
  const signer = signerFromSeed("did:web:example.com:users:kid#key-1", new Uint8Array(32).fill(9));
  const sign = (type: string, body: Record<string, unknown>) => createRecord({ type: type as never, issuer: "did:web:example.com:users:kid", subject: null, prev: null, body, issued_at: "2026-11-14T00:00:00Z" }, signer);
  const post = async (token: string, record: unknown) => {
    const res = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ target: "handle", method: "append", args: [record] }) });
    return { status: res.status, json: (await res.json()) as { ok: boolean; error?: { code?: string; message?: string } } };
  };
  const consent = sign("telemetry_act", { act: "consent", sponsor: "did:web:example.com:users:kid", agent: "did:web:example.com:agents:a", signals: ["calibration"], purposes: ["own_use"], retention_days: 30, from: "2026-11-01T00:00:00Z", until: "2026-12-01T00:00:00Z" });
  const young = await post(MINOR, consent);
  assert.equal(young.status, 403);
  assert.equal(young.json.error?.code, "minor_tenant_no_telemetry");
  assert.match(young.json.error!.message!, /held for a young person.*does not collect cognition telemetry/);
  const mandateWith = sign("mandate", { contract: "sha256:" + "1".repeat(64), purpose: "x", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2028-01-01T00:00:00Z", revocable: true, telemetry: { signals: ["calibration"], purposes: ["own_use"], retention_days: 30, raw: "local" } });
  assert.equal((await post(MINOR, mandateWith)).json.error?.code, "minor_tenant_no_telemetry");
  // The adult tenant is not stopped by this rule: its record reaches the log, which judges it by its own rules.
  const adult = await post(ADULT, consent);
  assert.notEqual(adult.json.error?.code, "minor_tenant_no_telemetry");
  // A record of the young tenant that has nothing to do with telemetry is not refused by it either.
  const plain = await post(MINOR, sign("attestation", { kind: "acceptance", about: "sha256:" + "2".repeat(64), verdict: "accepted" }));
  assert.notEqual(plain.json.error?.code, "minor_tenant_no_telemetry");
});

test("the local raw store masks secrets and personal data before it writes, expires on retention, and purge --raw removes the text and its salt so the hash cannot be matched", () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-tm-raw-"));
  const store = new LocalRawStore(dir);
  const secret = "sk-ant-api03-FAKEFAKEFAKEFAKEFAKEFAKEFAKE";
  const text = `I reasoned about the invoice. Contact dana.fake@example.com or +44 20 7946 0958, account 4111 1111 1111 1111, key ${secret}.`;
  const { id, hash, masked } = store.add("reasoning_trace", text, "2026-11-01T00:00:00Z");
  const stored = readdirSync(join(dir, "raw")).map((f) => readFileSync(join(dir, "raw", f), "utf8")).join("\n");
  for (const leak of [secret, "dana.fake@example.com", "7946 0958", "4111 1111 1111 1111"]) assert.ok(!stored.includes(leak), `${leak} was masked before it was stored`);
  assert.match(stored, /\[email\]/); assert.match(stored, /\[phone\]/); assert.match(stored, /\[account\]/);
  assert.ok(masked.secrets >= 1 && masked.personal >= 3, JSON.stringify(masked));
  assert.ok(!hash.includes("reasoned"), "the hash carries no text");
  assert.equal(redactTelemetryText("x".repeat(5000)).text.length < 2100, true, "the text is cut");

  // While the raw row exists a candidate text can be checked against the hash; the same text with another record's salt gives another hash.
  assert.equal(store.matches(id, text, hash), true);
  assert.notEqual(store.add("reasoning_trace", text, "2026-11-01T00:00:00Z").hash, hash, "a per-record salt: the same text hashes differently");
  // Retention: rows older than the consent's days go, text and salt together.
  store.add("calibration", "an old note", "2026-08-01T00:00:00Z");
  assert.equal(store.expire(30, "2026-11-10T00:00:00Z"), 1, "only the August row is older than 30 days on 10 November; the two from 1 November are nine days old");
  const fresh = store.add("calibration", "a fresh note", "2026-11-09T00:00:00Z");
  assert.equal(store.expire(30, "2026-11-10T00:00:00Z"), 0, "a row inside the retention stays");
  // purge --raw: every text and salt is removed; the hash that went into a digest can no longer be matched to any candidate.
  assert.equal(store.purgeRaw(), 3, "the two from 1 November and the fresh one");
  assert.equal(existsSync(join(dir, "raw")), false);
  assert.equal(store.matches(fresh.id, "a fresh note", fresh.hash), false, "after the purge the same text no longer matches its hash: no salt");
  assert.deepEqual(store.rows(), []);
});

test("a probe runs on a copy of the package: it leaves the package hash unchanged even when the agent writes into its working copy, and it takes a number of permille, never free text", async () => {
  const f = makeFixture();
  const run = async (args: string[]) => { const out: string[] = [], err: string[] = []; const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root }; const code = await main(args, io); assert.equal(code, 0, err.join("\n")); };
  const AGENT = "did:web:example.com:agents:probe-agent", SPONSOR = "did:web:example.com:users:probe-sponsor";
  await run(["identity", "new", "--kind", "human", "--did", SPONSOR]);
  await run(["identity", "new", "--kind", "agent", "--did", AGENT, "--sponsor", SPONSOR, "--purpose", "Answer probes"]);
  const pkg = join(f.root, "probe.aspkg");
  await run(["pack", "--runtime", "claude-code", "--agent", AGENT, "--project", f.project, "--user-home", f.home, "--out", pkg]);
  const before = packageDigest(pkg, AGENT);
  const props = [{ id: "P1" }, { id: "P2" }];
  const { answers, digest } = runReadOnlyProbe(pkg, AGENT, props, (work, p) => {
    writeFileSync(join(work, "memory-scribble.md"), `the agent tries to remember its answer to ${p.id}`); // a write into the probe's copy
    return p.id === "P1" ? 730 : 120;
  });
  assert.deepEqual(answers, { P1: 730, P2: 120 });
  assert.equal(digest, before);
  assert.equal(packageDigest(pkg, AGENT), before, "the package hash is unchanged");
  assert.equal(existsSync(join(pkg, "memory-scribble.md")), false, "nothing the probe wrote reached the package");
  for (const bad of ["probably yes", 0.7, -1, 1001, null]) assert.throws(() => runReadOnlyProbe(pkg, AGENT, [{ id: "P1" }], () => bad), /whole number of permille|takes no free text/, String(bad));
  assert.equal(packageDigest(pkg, AGENT), before);
});
