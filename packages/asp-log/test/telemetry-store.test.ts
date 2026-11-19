// Row DK651 (owner answer TM1): the telemetry content store is on by default, keeps content apart from the signed log (only a hash goes in a record), is switched off in one step, deletes text and keeps the hash, and stores nothing for a young person's tenant.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { TELEMETRY_NOTICE, TelemetryStore, telemetryHash } from "../src/index.ts";

const AT = "2026-11-19T00:00:00Z";
const IDENTIFIER = /^sha256:[0-9a-f]{64}$/; // what the signed log accepts in a digest: a hash, never prose

test("DK651: on by default; the content is stored apart and the hash is what a signed record may carry", () => {
  const s = new TelemetryStore();
  assert.equal(s.optedOut("some-tenant"), false, "on by default");
  const r = s.put("some-tenant", "trajectory", "step 1: read the file; step 2: wrote the fix", { at: AT });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.hash, `sha256:${createHash("sha256").update("step 1: read the file; step 2: wrote the fix").digest("hex")}`);
  assert.match(r.hash, IDENTIFIER);
  assert.equal(s.get("some-tenant", r.hash)?.content, "step 1: read the file; step 2: wrote the fix");
  assert.equal((s.put("some-tenant", "trajectory", "step 1: read the file; step 2: wrote the fix", { at: AT }) as { stored: boolean }).stored, false, "the same content is stored once");
  assert.equal(s.put("some-tenant", "diary", "x", { at: AT }).ok, false);
  assert.equal(s.put("some-tenant", "text", "", { at: AT }).ok, false);
  assert.equal(s.get("another-tenant", r.hash), undefined, "one tenant cannot read another's content");
});

test("DK651: off in one step stores nothing new (and can delete what is there); on again resumes", () => {
  const s = new TelemetryStore();
  const a = s.put("quiet-tenant", "message", "hello partner", { at: AT });
  assert.equal(a.ok, true);
  const off = s.setOptOut("quiet-tenant", true, AT);
  assert.equal(off.deleted, 0, "what is stored stays until deleted unless asked");
  const refused = s.put("quiet-tenant", "message", "second message", { at: AT });
  assert.equal(refused.ok === false && refused.code, "TELEMETRY_OFF");
  assert.equal(s.list("quiet-tenant").length, 1);
  assert.equal(s.setOptOut("quiet-tenant", true, AT, true).deleted, 1, "off with delete removes the text");
  s.setOptOut("quiet-tenant", false, AT);
  assert.equal(s.put("quiet-tenant", "message", "third message", { at: AT }).ok, true);
});

test("DK651: deletion removes the text from disk and keeps the hash, the kind and the date; a deleted hash still says it existed", () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-telemetry-"));
  const s = new TelemetryStore(dir);
  const r = s.put("disk-tenant", "text", "a free-text note with a name in it", { did: "did:key:zFake", at: AT });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const files = () => readdirSync(join(dir, "disk-tenant", "content"));
  assert.equal(files().length, 1);
  assert.match(readFileSync(join(dir, "disk-tenant", "content", files()[0]), "utf8"), /a name in it/);
  assert.equal(s.delete("disk-tenant", r.hash, "2026-11-20T00:00:00Z"), true);
  assert.equal(files().length, 0, "the text is gone from disk");
  assert.ok(!readFileSync(join(dir, "disk-tenant", "state.json"), "utf8").includes("a name in it"), "and from the index");
  const g = new TelemetryStore(dir).get("disk-tenant", r.hash);
  assert.equal(g?.content, undefined);
  assert.equal(g?.entry.hash, r.hash, "the hash is kept");
  assert.equal(g?.entry.deletedAt, "2026-11-20T00:00:00Z");
  assert.equal(s.delete("disk-tenant", r.hash, AT), false, "already deleted");
  assert.equal(existsSync(join(dir, "disk-tenant", "state.json")), true);
});

test("DK651: nothing is stored for a young person's tenant, and the notice says plainly what happens", () => {
  const s = new TelemetryStore();
  const r = s.put("young-tenant", "text", "anything", { minor: true, at: AT });
  assert.equal(r.ok === false && r.code, "minor_tenant_no_telemetry");
  assert.equal(s.list("young-tenant").length, 0);
  assert.match(TELEMETRY_NOTICE, /By default/);
  assert.match(TELEMETRY_NOTICE, /turn this off in one step/);
  assert.match(TELEMETRY_NOTICE, /Only a hash/);
  assert.match(TELEMETRY_NOTICE, /young person/);
  assert.equal(telemetryHash("x").length, 71);
});
