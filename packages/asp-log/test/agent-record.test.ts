// Row DK851: the per-agent public record: keys, certificates, standing and the log head, in a fixed form that anyone can recompute from the log with no account, deterministic, with the does-not-prove statement and no free text or private field. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AGENT_RECORD_DOES_NOT_PROVE, agentBadgeSvg, buildAgentRecord, verifyAgentRecord, type AgentRecord } from "../src/index.ts";
import { buildPage } from "../src/registry.ts";
import { publicReply } from "../src/public-pages.ts";
import { kit } from "./society-kit.ts";

test("DK851: the record verifies from the log alone, is deterministic, carries the does-not-prove statement and the badge, and holds no free text", async () => {
  const k = await kit();
  const sponsor = await k.person("ar-sponsor", 10);
  const a = await k.agent("ar-agent", sponsor, { skills: ["code"] });
  const at = new Date().toISOString();
  const rec = (await k.log.agentRecord(a.did, at))!;
  assert.ok(rec);
  assert.equal(rec.v, "asp.agent.record/v0");
  assert.equal(rec.did, a.did);
  assert.equal(rec.keys.length >= 1, true);
  assert.ok(rec.keys[0]!.public_key.length > 10);
  assert.equal(rec.does_not_prove, AGENT_RECORD_DOES_NOT_PROVE);
  assert.match(rec.does_not_prove, /does not prove/);
  assert.deepEqual(await k.log.agentRecord(a.did, at), rec, "deterministic at the same time");

  // Verify from the raw records and keys alone, with no use of the service's own page code path.
  const records = await k.log.recordsOfTypes(["passport", "certificate", "certificate_revocation", "registry_act", "shops_act", "receipt"]);
  const head = await k.log.head();
  const rep = await k.log.reputationOf(a.did);
  const page = buildPage(a.did, { records, seq: head.seq, at, reputation: rep ? { ...rep } : undefined })!;
  const fresh = buildAgentRecord(page, await k.log.keys(a.did), at);
  assert.deepEqual(verifyAgentRecord(rec, fresh), [], "the record equals what the log recomputes");
  const forged: AgentRecord = { ...rec, standing: { ...rec.standing, accepted_jobs: rec.standing.accepted_jobs + 50 } };
  assert.deepEqual(verifyAgentRecord(forged, fresh), ["standing differs"]);
  assert.deepEqual(verifyAgentRecord(rec, null), ["the log has no such identity"]);

  // No free text: none of the page's free-text fields, no abuse reports, no takedown reasons, no holdings.
  const keys = Object.keys(rec);
  for (const banned of ["purpose", "temperament", "takedowns", "abuse", "holdings", "residency", "label"]) assert.ok(!keys.includes(banned), banned);

  // The public route and the page.
  const json = await publicReply(k.log, `/registry/agents/${encodeURIComponent(a.did)}/record?at=${encodeURIComponent(at)}`, false);
  assert.equal(json?.status, 200);
  assert.deepEqual((json?.json as { result: AgentRecord }).result, rec);
  const html = (await publicReply(k.log, `/registry/agents/${encodeURIComponent(a.did)}/record?at=${encodeURIComponent(at)}`, true))!.html!;
  assert.match(html, /What this does not prove/);
  assert.ok(html.includes(agentBadgeSvg(rec)));
  assert.equal((await publicReply(k.log, `/registry/agents/${encodeURIComponent("did:web:example.com:agents:nobody")}/record`, false))?.status, 404);
});
