/**
 * The inspectorate page and the view behind it (DK1744; GET /society/inspectorate): warrants, custody chains with their check, the number of decoys (never their text) and the findings, from the signed records, each as a
 * table, no script. Equal to the log's records; the decoy text is never shown. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { INSPECTORATE_DID, itemHash } from "../src/index.ts";
import { publicReply } from "../src/public-pages.ts";
import { courts, kit, keysOf, mk, nowIso, party, type Party } from "./society-kit.ts";

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

async function world() {
  const k = await kit();
  const insp = party(INSPECTORATE_DID);
  await k.log.append(mk("passport", insp, { did: INSPECTORATE_DID, kind: "human", keys: keysOf(insp) }, null, { subject: INSPECTORATE_DID }));
  const sponsor = await k.person("insp-sponsor");
  const agent = await k.agent("insp-agent", sponsor);
  const j1 = await k.person("insp-j1"), j2 = await k.person("insp-j2");
  const warrant = (over: Record<string, unknown> = {}, by: Party = courts) => mk("warrant", by, { subject: agent.did, sponsor: sponsor.did, requested_by: INSPECTORATE_DID, granted_by: [j1.did, j2.did], panel_size: 3, grounds: "two runs read a decoy the Mandate forbade, and the sponsor was told", data: ["run_log"], expires_at: iso(Date.parse(nowIso()) + 48 * HOUR), scope: "the run log of the two runs that touched the decoy, nothing else", ...over }, null, { subject: agent.did });
  const decoy = (over: Record<string, unknown> = {}, by: Party = courts) => mk("decoy_registration", by, { decoy: "decoy-1", text: "notes/old-backup.txt (a file of no value)", carries_real_secret: false, forbidden_by_mandate: true, scope: "open_investigation", ...over }, null, { subject: null });
  const finding = (decoyId: string, touches: unknown[], over: Record<string, unknown> = {}, by: Party = insp) => mk("inspectorate_finding", by, { decoy: decoyId, agent: agent.did, touches, summary: "touched the decoy", ...over }, null, { subject: agent.did });
  return { k, insp, sponsor, agent, j1, j2, warrant, decoy, finding };
}


test("DK1744: the inspectorate page: empty, then a warrant, a custody chain, a decoy and a finding; equal to the records, a table for each, no script, no decoy text", async () => {
  const w = await world();
  const { k } = w;
  const empty = (await publicReply(k.log, "/society/inspectorate", true) as { html: string }).html;
  assert.match(empty, /No warrant has been granted/);
  assert.match(empty, /No evidence is held/);
  assert.match(empty, /No decoy is registered/);
  assert.match(empty, /No finding has been filed/);
  const at = (h: number) => iso(Date.parse(nowIso()) + h * HOUR);
  await k.log.append(w.warrant({ data: ["run_log", "private_memory"], produced_by: w.sponsor.did, notified_at: at(0), expires_at: at(48) }));
  const stamp = nowIso();
  const item = (by: Party, n: number, what: string, prev: string) => mk("custody_item", by, { case: "case-7", n, what, sha256: "e".repeat(64), held_by: by.did, at: stamp, prev_item: prev }, null, { subject: null });
  await k.log.append(item(w.insp, 0, "copy of the run log", "genesis"));
  const reg = await k.log.append(w.decoy());
  const read = (run: string) => ({ run, kind: "read", forbidden: true });
  await k.log.append(w.finding(reg.id, [read("r1"), { run: "r2", kind: "copied", forbidden: true }]));
  const v = await k.log.inspectorateView(at(1)); // while the warrant is in force
  assert.deepEqual([v.warrants.length, v.custody.length, v.decoys.registered, v.findings.length], [1, 1, 1, 1]);
  assert.deepEqual([v.warrants[0]!.data, v.warrants[0]!.grantedBy, v.warrants[0]!.panel, v.warrants[0]!.state, v.warrants[0]!.noticed], [["run_log", "private_memory"], 2, 3, "in force", "within the hour"]);
  assert.deepEqual([v.custody[0]!.items, v.custody[0]!.unbroken], [1, true]);
  assert.deepEqual([v.findings[0]!.runs, v.findings[0]!.kinds], [2, ["read", "copied"]]);
  const wallClock = await k.log.inspectorateView();
  assert.equal(wallClock.warrants[0]!.state, "expired", "read now, the 48 hours have long passed");
  const records = await k.log.recordsOfTypes(["warrant", "custody_item", "decoy_registration", "inspectorate_finding"]);
  assert.equal(records.length, 4, "the page's counts are the log's records");
  const html = (await publicReply(k.log, "/society/inspectorate", true) as { html: string }).html;
  for (const cap of ["Warrants granted by a Court", "Chains of custody of evidence", "Decoys registered with a Court, by scope", "Findings of deliberate touches"]) assert.ok(html.includes(`<caption>${cap}</caption>`), cap);
  assert.match(html, /<td>unbroken<\/td>/);
  assert.match(html, /run_log, private_memory/);
  assert.ok(!html.includes("<script"), "no script");
  assert.ok(!html.includes("a file of no value") && !JSON.stringify(v).includes("a file of no value"), "the decoy text is not shown");
  // the page as it stood before the warrant expired and after
  const later = await k.log.inspectorateView(at(60));
  assert.equal(later.warrants[0]!.state, "expired");
  const json = await publicReply(k.log, "/society/inspectorate", false) as { json: { ok: boolean; result: { warrants: unknown[] } } };
  assert.equal(json.json.result.warrants.length, 1);
  assert.equal((await publicReply(k.log, "/society/inspectorate?at=nonsense", false))!.status, 400);
  assert.equal((await k.log.verify()).ok, true);
  void itemHash;
});
