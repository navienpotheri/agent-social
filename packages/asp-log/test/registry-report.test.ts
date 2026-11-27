/**
 * The Registry's monthly report (DK125, registry.md RG-16; GET /registry/report?month=YYYY-MM): identities first seen, names claimed and released, impersonation reports, names taken down and reports dismissed,
 * suspensions and their lifting, renewals and retirements, each equal to a hand count of the records and counted in the month the act was issued. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { NAME_TERM_MS } from "../src/registry.ts";
import { publicReply } from "../src/public-pages.ts";
import { DAY, jump, kit, mk, nowIso, registrar, tick, type Party } from "./society-kit.ts";

const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");
const CODE = { version: "1.0", articles: ["4.1"] };

async function world() {
  const k = await kit(); // the clock starts on 2026-11-01
  await k.withPrices();
  const sponsorA = await k.person("rr-sponsor-a", 500);
  const sponsorB = await k.person("rr-sponsor-b", 500);
  const a = await k.agent("rr-agent-a", sponsorA, { funds: 100 });
  const b = await k.agent("rr-agent-b", sponsorB, { funds: 100 });
  const ma = await k.openMandate(a);
  const mb = await k.openMandate(b);
  const claim = async (holder: Party, name: string, mandate: string) => {
    const paid = await k.buy(holder, "registry.name.claim", 10, { mandate });
    const at = tick();
    return mk("registry_act", holder, { act: "name_claim", name, holder: holder.did, class: "agent", paid, valid_until: iso(Date.parse(at) + NAME_TERM_MS) }, null, { at });
  };
  return { k, sponsorA, sponsorB, a, b, ma, mb, claim };
}

test("DK125: the report counts the month's identities and acts, as a hand count would", async () => {
  const w = await world();
  const handCount = async (m: string) => new Set((await w.k.log.recordsOfTypes(["passport"])).filter((r) => r.issued_at.startsWith(m)).map((r) => (r.body as { did: string }).did)).size;
  const before = (await w.k.log.registryReport("2026-11")).newIdentities;
  assert.equal(before, await handCount("2026-11"), "equal to the distinct identities the passports name");
  assert.ok(before >= 4, "at least the two sponsors and two agents");
  const c1 = await w.claim(w.a, "scout-7", w.ma); await w.k.log.append(c1);
  const c2 = await w.claim(w.b, "scout-7-official", w.mb); await w.k.log.append(c2);
  const rel = (await w.k.log.registryPage("scout-7"))!; void rel;
  const report = mk("registry_act", w.a, { act: "impersonation_report", target: "scout-7-official", genuine: w.a.did, grounds: "name_confusable", evidence: ["asp://profile/scout-7-official"] });
  await w.k.log.append(report);
  jump(8 * DAY); // the holder is heard first: a week
  const at = tick();
  await w.k.log.append(mk("registry_act", registrar, { act: "name_takedown", name: "scout-7-official", holder: w.b.did, report: report.id, reason: "the name presents itself as the genuine agent's", code: CODE, effect: "name_removed", appealable_until: iso(Date.parse(at) + 14 * DAY) }, null, { at }));
  const sus = mk("registry_act", registrar, { act: "identity_suspension", holder: w.a.did, reason: "credible harm to a third party was reported", code: CODE, until: iso(Date.parse(tick()) + 3 * DAY) });
  await w.k.log.append(sus);
  await w.k.log.append(mk("registry_act", registrar, { act: "suspension_lift", suspension: sus.id, reason: "the harm stopped" }));
  await w.k.log.append(mk("registry_act", registrar, { act: "identity_suspension", holder: w.b.did, reason: "credible harm to a third party was reported", code: CODE, until: iso(Date.parse(tick()) + 2 * DAY) })); // not lifted
  const rep = await w.k.log.registryReport("2026-11");
  assert.equal(rep.namesClaimed, 2);
  assert.equal(rep.reportsFiled, 1);
  assert.equal(rep.namesTakenDown, 1);
  assert.equal(rep.suspensions, 2);
  assert.equal(rep.suspensionsLifted, 1);
  assert.equal(rep.reportsDismissed, 0);
  assert.equal(rep.namesReleased, 0);
  assert.equal(rep.from, "2026-11-01T00:00:00Z");
  assert.equal(rep.to, "2026-12-01T00:00:00Z");
});

test("DK125: an act counts in the month it was issued; another month is empty; a release and a dismissal are counted", async () => {
  const w = await world();
  const c1 = await w.claim(w.a, "scout-7", w.ma); await w.k.log.append(c1);
  const c2 = await w.claim(w.b, "scout-7-official", w.mb); await w.k.log.append(c2);
  jump(40 * DAY); // into December
  const reportDec = mk("registry_act", w.a, { act: "impersonation_report", target: "scout-7-official", genuine: w.a.did, grounds: "name_confusable", evidence: ["asp://profile/scout-7-official"] });
  await w.k.log.append(reportDec);
  await w.k.log.append(mk("registry_act", registrar, { act: "takedown_dismissal", report: reportDec.id, reason: "a nickname is not impersonation" }));
  await w.k.log.append(mk("registry_act", w.a, { act: "name_release", name: "scout-7", claim: c1.id }));
  const oct = await w.k.log.registryReport("2026-10");
  const hand = async (m: string) => new Set((await w.k.log.recordsOfTypes(["passport"])).filter((r) => r.issued_at.startsWith(m)).map((r) => (r.body as { did: string }).did)).size;
  assert.deepEqual([oct.namesClaimed, oct.reportsFiled], [0, 0]);
  assert.equal(oct.newIdentities, await hand("2026-10"), "the institutions' own passports are counted where they were issued");
  const nov = await w.k.log.registryReport("2026-11");
  assert.deepEqual([nov.namesClaimed, nov.reportsFiled, nov.namesReleased, nov.reportsDismissed], [2, 0, 0, 0]);
  const dec = await w.k.log.registryReport("2026-12");
  assert.deepEqual([dec.namesClaimed, dec.reportsFiled, dec.namesReleased, dec.reportsDismissed, dec.newIdentities], [0, 1, 1, 1, await hand("2026-12")]);
});

test("DK125: GET /registry/report serves a month without a token, defaults to the current one, and refuses a bad month", async () => {
  const w = await world();
  const r = await publicReply(w.k.log, "/registry/report?month=2026-11", false) as { status: number; json: { ok: boolean; result: { month: string; newIdentities: number } } };
  assert.equal(r.status, 200);
  assert.equal(r.json.result.month, "2026-11");
  assert.ok(r.json.result.newIdentities >= 4);
  assert.equal(((await publicReply(w.k.log, "/registry/report?month=2026-00", false)) as { status: number }).status, 400);
  assert.equal(((await publicReply(w.k.log, "/registry/report", false)) as { status: number }).status, 200);
  await assert.rejects(() => w.k.log.registryReport("Nov 2026"), /YYYY-MM/);
  void nowIso;
});
