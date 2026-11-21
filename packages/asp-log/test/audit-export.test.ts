/**
 * The audit export of an organisation (register row DK1374; spec-delta S1417): complete (every record the organisation or its agents signed or are named in), self-contained (the signers' passports travel with it),
 * checkable offline (each id and signature and the manifest's hash), incremental (a scheduled run exports only what is new), and served to the owning tenant only. Fake keys only.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { kit, keysOf, mk, party, credit } from "./society-kit.ts";
import { createLogServer, hashToken, verifyAuditExport, type Tenant } from "../src/index.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const listen = async (s: Server) => { await new Promise<void>((r) => s.listen(0, "127.0.0.1", r)); servers.push(s); return `http://127.0.0.1:${(s.address() as { port: number }).port}`; };

async function world() {
  const k = await kit();
  await k.withPrices();
  const org = party("did:web:example.com:orgs:audit-co");
  await k.log.append(mk("passport", org, { did: org.did, kind: "org", keys: keysOf(org) }, null, { subject: org.did }));
  const FLEET = "did:web:example.com:orgs:audit-co:fleets:all";
  await k.log.append(mk("fleet", org, { did: FLEET, org: org.did, name: "All", purpose: "everything" }, null, { subject: FLEET }));
  const agents = [] as ReturnType<typeof party>[];
  for (let i = 0; i < 3; i++) { const a = party(`did:web:example.com:agents:audit-a${i}`); agents.push(a); await k.log.append(mk("passport", org, { did: a.did, kind: "agent", sponsor: org.did, tier: 1, shape: {}, keys: keysOf(a), fleet: FLEET }, null, { subject: a.did })); await k.mint(a.did, 100); }
  const client = await k.person("audit-client", 500);
  const outsider = await k.person("audit-outsider", 500);
  const outsiderAgent = await k.agent("audit-oa", outsider, { funds: 100 });
  await k.runJob(client, agents[0], 60);
  await k.runJob(client, agents[1], 60);
  await k.runJob(outsider, outsiderAgent, 60); // nothing to do with the organisation
  return { ...k, org, FLEET, agents, client, outsider, outsiderAgent };
}

test("the export has every record of the organisation and its agents, the signers' passports, and nothing of an outsider; it verifies offline", async () => {
  const w = await world();
  const { manifest, text } = await w.log.auditExport(w.org.did);
  const v = verifyAuditExport(text);
  assert.deepEqual([v.ok, v.problems], [true, []]);
  assert.ok(v.unverified.every((u) => u.kid.startsWith("did:web:asp.local:operator")), "only the operator's own mints cannot be checked from the file: its key is held by the log, not in a passport");
  const exported = new Set(text.split("\n").filter(Boolean).slice(1).map((l) => (JSON.parse(l) as { record: { id: string } }).record.id));
  const all = await w.log.since(0, 100000);
  const mine = new Set([w.org.did, w.FLEET, ...w.agents.map((a) => a.did)]);
  for (const s of all) {
    const r = s.record as { issuer: string; subject: string | null; body: Record<string, string> };
    const involves = mine.has(r.issuer) || (r.subject && mine.has(r.subject)) || ["performer", "principal", "agent", "fleet"].some((f) => mine.has(r.body[f]));
    if (involves) assert.ok(exported.has(s.id), `${s.record.type} ${s.id} of the organisation is in the export`);
    if (r.issuer === w.outsider.did && !involves) assert.ok(!exported.has(s.id), "an outsider's own record is not in the export");
  }
  assert.ok(![...exported].some((id) => all.find((s) => s.id === id)?.record.issuer === w.outsiderAgent.did), "no record signed by the outsider's agent");
  assert.ok(manifest.records > 10 && manifest.passports >= 1, `${manifest.records} records, ${manifest.passports} signer passports`);
  assert.equal(manifest.format, "asp.audit-export/v1");
  assert.match(manifest.note, /Sign-ins and roles are not in the log/);
});

test("a changed record, a removed record or an added one is found by the check", async () => {
  const w = await world();
  const { text } = await w.log.auditExport(w.org.did);
  const lines = text.split("\n").filter(Boolean);
  const edit = (i: number, f: (o: { seq: number; record: { body: Record<string, unknown> } }) => void) => { const o = JSON.parse(lines[i]); f(o); const copy = [...lines]; copy[i] = JSON.stringify(o); return copy.join("\n"); };
  const changed = verifyAuditExport(edit(5, (o) => { o.record.body.tampered = true; }));
  assert.equal(changed.ok, false);
  assert.match(changed.problems.join(" "), /does not verify/);
  const dropped = verifyAuditExport([...lines.slice(0, 5), ...lines.slice(6)].join("\n"));
  assert.equal(dropped.ok, false);
  assert.match(dropped.problems.join(" "), /manifest says .* records/);
  const swapped = verifyAuditExport(lines[0] + "\n" + lines.slice(1).reverse().join("\n"));
  assert.equal(swapped.ok, false, "out of order");
  assert.equal(verifyAuditExport("not json").ok, false);
});

test("a scheduled export keeps its position: the second run holds only what came after the first, and the two together are the whole", async () => {
  const w = await world();
  const first = await w.log.auditExport(w.org.did);
  await w.runJob(w.client, w.agents[2], 60);
  const second = await w.log.auditExport(w.org.did, { afterSeq: first.manifest.last_seq! });
  const ids = (t: string) => t.split("\n").filter(Boolean).slice(1).map((l) => (JSON.parse(l) as { record: { id: string } }).record.id);
  assert.ok(ids(second.text).length > 0);
  assert.deepEqual(ids(second.text).filter((id) => ids(first.text).includes(id) && !(JSON.parse(second.text.split("\n")[0]).passports)), [], "no record twice (apart from signers' passports)");
  const whole = await w.log.auditExport(w.org.did);
  const union = new Set([...ids(first.text), ...ids(second.text)]);
  for (const id of ids(whole.text)) assert.ok(union.has(id), "every record is in one of the two runs");
  assert.ok(verifyAuditExport(second.text).unverified.length > 0, "an incremental file lacks the passports of earlier signers and lists them as unverified");
});

test("GET /audit/export serves the owning tenant and an operator, and refuses another tenant", async () => {
  const w = await world();
  const tenants: Tenant[] = [{ name: "ops", role: "admin", tokenSha256: hashToken("op") }, { name: "alpha", role: "tenant", tokenSha256: hashToken("ta") }, { name: "bravo", role: "tenant", tokenSha256: hashToken("tb") }];
  const owners = { of: (t: string) => (t === "alpha" ? [w.org.did] : []), flush: () => undefined };
  const server = createLogServer({ handle: { append: async () => ({ id: "x", seq: 1 }), log: w.log } as never, tenants, noAuth: false, owners: owners as never });
  const url = await listen(server);
  const get = (tok: string, q: string) => fetch(`${url}/audit/export?${q}`, { headers: { authorization: `Bearer ${tok}` } });
  const ok = await get("ta", `org=${encodeURIComponent(w.org.did)}`);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get("content-type") ?? "", /ndjson/);
  assert.equal(verifyAuditExport(await ok.text()).ok, true);
  assert.equal((await get("tb", `org=${encodeURIComponent(w.org.did)}`)).status, 403);
  assert.equal((await get("op", `org=${encodeURIComponent(w.org.did)}`)).status, 200);
  assert.equal((await get("ta", "")).status, 400);
  void credit;
});

test("one reader serves both the audit export and the offboarding export: the signed records are a subset of the audit view, and both see the same identities", async () => {
  const { readOrgRecords } = await import("../src/audit-export.ts");
  const w = await world();
  const all = (await w.log.since(0, 100000)).map((s) => ({ seq: s.seq, id: s.id, record: s.record }));
  const signed = readOrgRecords(all, w.org.did, "signed"), involving = readOrgRecords(all, w.org.did, "involving");
  assert.deepEqual(signed.identities, involving.identities, "the same identities");
  assert.deepEqual(signed.fleets, [w.FLEET]);
  const inv = new Set(involving.records.map((r) => r.id));
  assert.ok(signed.records.length > 0 && signed.records.every((r) => inv.has(r.id)), "everything the organisation's identities signed is in the audit view");
  assert.ok(involving.records.length > signed.records.length, "the audit view also holds what names them (the client's contracts and settlements)");
  assert.ok(signed.records.every((r) => signed.identities.includes(r.record.issuer)));
});
