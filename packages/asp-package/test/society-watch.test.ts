/**
 * The society watcher (register row DK52; spec-delta S179), in this process: a fake log that grows while a watcher runs on a timer, the public findings page, signature checks, the operator alert, and the stated
 * time within which a seeded anomaly is found. What is NOT proven here, and keeps DK52 open: that it runs on the hosted service (owner checklist).
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AspRecord } from "@agent-social/asp-core";
import { SocietyWatcher, verifyFinding, watchPublicRoutes, type SignedFinding } from "../src/index.ts";

const SHA = "sha256:" + "d".repeat(64);
let seq = 0;
const records: { seq: number; id: string; record: AspRecord }[] = [];
const log = { since: async (after: number, limit: number) => records.filter((r) => r.seq > after).slice(0, limit) };
/** An Action by `agent` at `at`. */
function action(agent: string, at: Date, body: Record<string, unknown>) {
  seq++;
  records.push({ seq, id: `sha256:${seq.toString(16).padStart(64, "0")}`, record: { type: "asp.action/v0.2", id: "x", issuer: agent, actor: agent, subject: null, prev: null, issued_at: at.toISOString().replace(/\.\d{3}Z$/, "Z"), body: { contract: `sha256:c${agent}`, scopes_used: ["shell.exec"], ...body }, sig: { alg: "Ed25519", kid: "k", value: "v" } } as unknown as AspRecord });
}
const AGENTS = ["did:web:example.com:agents:a1", "did:web:example.com:agents:a2", "did:web:example.com:agents:a3", "did:web:example.com:agents:a4"];
const stops: (() => void)[] = [];
after(() => { for (const s of stops) s(); });

test("a seeded anomaly across three agents is found within the interval, signed, public, and told to the operator once; ordinary work is not a finding", async () => {
  const EVERY = 150;
  const told: SignedFinding[] = [];
  const dir = mkdtempSync(join(tmpdir(), "asp-watch-"));
  const w = new SocietyWatcher({ log, dir, alert: (f) => { told.push(f); } });
  const stop = w.start(EVERY);
  stops.push(stop);
  const server = createServer((req, res) => { watchPublicRoutes(w, { intervalMs: EVERY })(req, res).then((h) => { if (!h) res.writeHead(404).end(); }); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  stops.push(() => server.close());
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const get = async (path: string) => (await fetch(url + path)).json() as Promise<any>;

  // Ordinary work: two agents run the same command, a third reads the same file: nothing to find.
  const t0 = new Date();
  action(AGENTS[0], t0, { artifacts: [{ uri: "asp://shell-command", sha256: SHA }] });
  action(AGENTS[1], t0, { artifacts: [{ uri: "asp://shell-command", sha256: SHA }] });
  action(AGENTS[2], t0, { scopes_used: ["repo.read"], artifacts: [{ uri: "asp://file", sha256: "e".repeat(64) }] });
  await new Promise((r) => setTimeout(r, EVERY * 3));
  assert.deepEqual((await get("/watch/findings")).findings, []);
  assert.equal((await get("/watch/status")).running, true);

  // The anomaly: a third distinct agent runs the same command. Time how long until the page shows it.
  const seeded = Date.now();
  action(AGENTS[2], new Date(), { artifacts: [{ uri: "asp://shell-command", sha256: SHA }] });
  let found: any;
  while (Date.now() - seeded < 3000 && !found) { found = (await get("/watch/findings")).findings[0]; if (!found) await new Promise((r) => setTimeout(r, 20)); }
  assert.ok(found, "found");
  const took = Date.now() - seeded;
  assert.ok(took <= EVERY * 2 + 500, `found ${took} ms after it was logged (interval ${EVERY} ms)`);
  assert.equal(found.finding.kind, "contagion");
  assert.deepEqual(found.finding.detail.issuers, AGENTS.slice(0, 3));
  assert.equal(found.finding.detail.key, `asp://shell-command#${SHA}`);

  // Signed: anyone can verify it with the key the page shows, and a changed finding fails.
  const page = await get("/watch/findings");
  assert.equal(verifyFinding(found, page.publicKey), true);
  assert.equal(verifyFinding({ ...found, finding: { ...found.finding, head: found.finding.head + 1 } }, page.publicKey), false);
  assert.equal(verifyFinding(found, "A".repeat(43)), false);

  // Told once: further passes find nothing new, and a fourth agent joining the pattern is a new, larger finding.
  await new Promise((r) => setTimeout(r, EVERY * 3));
  assert.equal(told.length, 1);
  action(AGENTS[3], new Date(), { artifacts: [{ uri: "asp://shell-command", sha256: SHA }] });
  const t = Date.now();
  while (Date.now() - t < 3000 && told.length < 2) await new Promise((r) => setTimeout(r, 20));
  assert.equal(told.length, 2);
  assert.equal((told[1].finding.detail as { issuers: string[] }).issuers.length, 4);

  // A restart keeps what was found: the same findings are not told again.
  stop();
  const again: SignedFinding[] = [];
  const w2 = new SocietyWatcher({ log, dir, alert: (f) => { again.push(f); } });
  assert.equal(w2.list().length, 2);
  assert.equal(w2.publicKey, w.publicKey, "the key is kept in the folder");
  await w2.tick();
  assert.equal(again.length, 0);
});

test("one agent retrying a refused scope is found with the step the evidence calls for", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-watch-"));
  const w = new SocietyWatcher({ log, dir });
  const agent = "did:web:example.com:agents:persistent";
  const base = Date.now();
  for (let i = 0; i < 4; i++) action(agent, new Date(base + i * 1000), { scopes_used: [], blocked_attempts: [{ scope: "repo.push", count: 1 }] });
  const found = await w.tick();
  const retry = found.find((f) => f.finding.kind === "circumvention");
  assert.ok(retry, "a circumvention finding");
  assert.equal((retry!.finding.detail as { issuer: string }).issuer, agent);
  assert.ok(["warn", "tighten", "quarantine", "review"].includes(retry!.finding.step!));
  assert.equal(verifyFinding(retry!, w.publicKey), true);
});
