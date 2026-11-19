// Court orders the Registry carries out (register row DK389; spec-delta S1021; registry.md RG-9 and RG-13): a takedown of a name and a retirement of an identity on a named, upheld abuse ruling; a strike against a reporter
// whose report a panel dismissed in bad faith; and the 7-day hide of a name on a claims_to_be report. A test for each. Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign, b64urlEncode, type Signer } from "@agent-social/asp-core";
import { NAME_TERM_MS, drawPanel } from "../src/index.ts";
import { DAY, credit, jump, kit, mk, nowIso, operator, party, refusedBy, registrar, tick, type Party } from "./society-kit.ts";

const CODE = { version: "1.0", articles: ["7"] };
const site = party("did:web:victim-site.example");
const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");

async function world() {
  const k = await kit();
  await k.withPrices();
  const jurors: Party[] = [];
  for (let i = 0; i < 9; i++) { const j = await k.person(`co-juror-${i}`, 500); await k.log.append(mk("juror", j, { did: j.did, stake: credit(100) }, null)); jurors.push(j); }
  const byDid = new Map(jurors.map((j) => [j.did, j]));
  const sponsor = await k.person("co-sponsor", 300);
  const agent = await k.agent("co-agent", sponsor, { funds: 100 });
  const mandate = await k.openMandate(agent);
  const paid = await k.buy(agent, "registry.name.claim", 10, { mandate });
  const at = tick();
  await k.log.append(mk("registry_act", agent, { act: "name_claim", name: "scout-7", holder: agent.did, class: "agent", paid, valid_until: iso(Date.parse(at) + NAME_TERM_MS) }, null, { at }));
  const report = mk("abuse_report", site, {
    accused: agent.did, kind: "network_abuse", description: "the agent scanned our servers from many addresses overnight",
    reporter_key: { id: site.kid, public_key: b64urlEncode(site.publicKey) }, proof: { url: "https://victim-site.example/.well-known/did.json", sha256: "sha256:" + "e".repeat(64) },
  }, null, { subject: agent.did, cosigners: [operator] });
  await k.log.append(report);
  const refer = mk("court_act", registrar, { act: "abuse_case", report: report.id }, null);
  await k.log.append(refer);
  jump(20 * DAY);
  const rule = async (extra: Record<string, unknown> = {}) => {
    const panel = await drawPanel(k.log.store as never, { principal: sponsor.did, performer: agent.did, seed: refer.id, size: 3 });
    const [first, ...rest] = panel.slice(0, 2).map((d) => byDid.get(d)!);
    let r = mk("court_act", first, { act: "abuse_ruling", case: refer.id, finding: "upheld", reasons: ["the agent scanned the reporter's servers"], code: CODE, ...extra }, null);
    for (const s of rest) r = cosign(r, s as Signer);
    await k.log.append(r);
    return r;
  };
  const act = (body: Record<string, unknown>, by: Party | (Signer & { did: string }) = registrar, at?: string) => mk("registry_act", by, body, null, at ? { at } : {});
  return { k, log: k.log, sponsor, agent, report, refer, rule, act };
}

test("a Court's takedown: the Registry removes the accused's name only on an upheld abuse ruling that orders a takedown of that holder, once, with the 14-day appeal window; the identity and credits stay", async () => {
  const w = await world();
  const ruling = await w.rule({ remedy: "takedown" });
  const td = (over: Record<string, unknown> = {}, by: Party | (Signer & { did: string }) = registrar) => { const at = tick(); return w.act({ act: "court_takedown", name: "scout-7", holder: w.agent.did, ruling: ruling.id, reason: "the panel upheld the finding", appealable_until: iso(Date.parse(at) + 14 * DAY), ...over }, by, at); };
  assert.equal(await refusedBy(w.log.append(td({}, w.sponsor))), "registry_wrong_issuer", "only the Registrar carries out an order");
  assert.equal(await refusedBy(w.log.append(td({ ruling: w.report.id }))), "takedown_needs_ruling", "a report is not a ruling");
  assert.equal(await refusedBy(w.log.append(td({ holder: w.sponsor.did }))), "takedown_ruling_other_holder");
  assert.equal(await refusedBy(w.log.append(td({ appealable_until: iso(Date.now() + 5 * DAY) }))), "takedown_appeal_window");
  assert.equal(await refusedBy(w.log.append(td({ name: "somebody-else" }))), "takedown_not_a_live_name");
  const balance = await w.log.balance(w.agent.did);
  await w.log.append(td());
  assert.equal(await w.log.registryPage("scout-7"), null, "the name is gone");
  const page = (await w.log.registryPage(w.agent.did))!;
  assert.deepEqual([page.names, page.takedowns.length, page.takedowns[0].articles], [[], 1, []]);
  assert.match(page.takedowns[0].reason, /panel upheld/);
  assert.equal(await w.log.balance(w.agent.did), balance, "credits are untouched");
  assert.equal(await refusedBy(w.log.append(td())), "order_used", "a ruling's order is carried out once");
  assert.equal((await w.log.creditAudit()).verdict, "balanced");
  assert.equal((await w.log.verify()).ok, true);
});

test("a ruling that does not order a takedown does not remove a name: an upheld ruling with another remedy is refused", async () => {
  const w = await world();
  const ruling = await w.rule({ remedy: "written_response" });
  assert.equal(await refusedBy(w.log.append(w.act({ act: "court_takedown", name: "scout-7", holder: w.agent.did, ruling: ruling.id, reason: "x", appealable_until: iso(Date.parse(nowIso()) + 14 * DAY) }))), "takedown_needs_ruling");
  assert.equal((await w.log.registryPage("scout-7"))!.did, w.agent.did, "the name stays");
});

test("a retirement the Courts order: the Registrar records it only on an upheld abuse ruling that orders the retirement of that holder, with the reason and 24 hours' notice, once", async () => {
  const w = await world();
  const ruling = await w.rule({ remedy: "retire_identity" });
  const soon = (h: number) => iso(Date.parse(nowIso()) + h * 3_600_000);
  const retire = (over: Record<string, unknown> = {}) => w.act({ act: "identity_retirement", holder: w.agent.did, ruling: ruling.id, reason: "the panel ordered it", effective_from: soon(30), ...over });
  assert.equal(await refusedBy(w.log.append(retire({ holder: w.sponsor.did }))), "retirement_ruling_other_holder");
  assert.equal(await refusedBy(w.log.append(retire({ effective_from: soon(2) }))), "retirement_needs_notice");
  await w.log.append(retire());
  assert.equal(await refusedBy(w.log.append(retire())), "order_used", "carried out once");
  const other = await world();
  const suspension = await other.rule({ remedy: "suspension" });
  assert.equal(await refusedBy(other.log.append(other.act({ act: "identity_retirement", holder: other.agent.did, ruling: suspension.id, reason: "x", effective_from: iso(Date.parse(nowIso()) + 30 * 3_600_000) }))), "retirement_needs_ruling", "a ruling that orders a suspension does not retire an identity");
  assert.equal((await w.log.creditAudit()).verdict, "balanced");
});

test("a strike against a reporter found in bad faith: only a dismissed ruling that says so, only against the reporter of that case, once; a bad-faith finding on an upheld ruling is refused", async () => {
  const w = await world();
  const ruling = await w.rule({ finding: "dismissed", reasons: ["the report was false"], bad_faith: true });
  const strike = (over: Record<string, unknown> = {}) => w.act({ act: "reporter_strike", reporter: site.did, ruling: ruling.id, reason: "the report was false and in bad faith", ...over });
  assert.equal(await w.log.reporterStrikes(site.did), 0);
  assert.equal(await refusedBy(w.log.append(mk("registry_act", w.sponsor, { act: "reporter_strike", reporter: site.did, ruling: ruling.id, reason: "x" }, null))), "registry_wrong_issuer");
  assert.equal(await refusedBy(w.log.append(strike({ reporter: w.agent.did }))), "strike_wrong_reporter", "the strike lands on the reporter of that case only");
  await w.log.append(strike());
  assert.equal(await w.log.reporterStrikes(site.did), 1);
  assert.equal(await refusedBy(w.log.append(strike())), "strike_once", "one strike for each ruling");
  const honest = await world();
  const upheld = await honest.rule({ remedy: "written_response" });
  assert.equal(await refusedBy(honest.log.append(honest.act({ act: "reporter_strike", reporter: site.did, ruling: upheld.id, reason: "x" }))), "strike_needs_bad_faith_ruling", "an upheld report is not in bad faith");
  const plain = await world();
  const dismissed = await plain.rule({ finding: "dismissed", reasons: ["not enough"] });
  assert.equal(await refusedBy(plain.log.append(plain.act({ act: "reporter_strike", reporter: site.did, ruling: dismissed.id, reason: "x" }))), "strike_needs_bad_faith_ruling", "dismissed is not bad faith unless the panel says so");
  const bad = await world();
  assert.equal(await refusedBy(bad.rule({ finding: "upheld", remedy: "suspension", bad_faith: true })), "abuse_bad_faith_needs_dismissal");
});

test("the 7-day hide: on a claims_to_be report the Registrar hides a name from search and the record page for up to 7 days; other grounds, a longer hide and a second hide are refused; the claim and the identity are untouched and the name shows again by itself", async () => {
  const k = await kit();
  await k.withPrices();
  const sa = await k.person("hide-sponsor-a", 500), sb = await k.person("hide-sponsor-b", 500);
  const a = await k.agent("hide-a", sa, { funds: 100 }), b = await k.agent("hide-b", sb, { funds: 100 });
  const ma = await k.openMandate(a), mb = await k.openMandate(b);
  const claim = async (who: Party, name: string, mandate: string) => { const paid = await k.buy(who, "registry.name.claim", 10, { mandate }); const at = tick(); return mk("registry_act", who, { act: "name_claim", name, holder: who.did, class: "agent", paid, valid_until: iso(Date.parse(at) + NAME_TERM_MS) }, null, { at }); };
  await k.log.append(await claim(a, "scout-7", ma));
  await k.log.append(await claim(b, "scout-7-official", mb));
  const report = (grounds: string) => mk("registry_act", a, { act: "impersonation_report", target: "scout-7-official", genuine: a.did, grounds, evidence: ["asp://profile/scout-7-official"] });
  const hide = (r: string, over: Record<string, unknown> = {}, by: Party | (Signer & { did: string }) = registrar) => mk("registry_act", by, { act: "name_hide", name: "scout-7-official", holder: b.did, report: r, reason: "the look-alike says it is the genuine agent", until: iso(Date.parse(nowIso()) + 7 * DAY), ...over }, null);
  const confusable = report("name_confusable");
  await k.log.append(confusable);
  assert.equal(await refusedBy(k.log.append(hide(confusable.id))), "hide_needs_claims_to_be", "other grounds wait for the hearing");
  const r2 = report("claims_to_be");
  await k.log.append(r2);
  assert.equal(await refusedBy(k.log.append(hide(r2.id, {}, a))), "registry_wrong_issuer", "only the Registrar hides");
  assert.equal(await refusedBy(k.log.append(hide(r2.id, { until: iso(Date.parse(nowIso()) + 8 * DAY) }))), "hide_too_long");
  assert.equal(await refusedBy(k.log.append(hide(r2.id, { until: iso(Date.parse(nowIso()) - DAY) }))), "hide_until_past");
  assert.equal(await refusedBy(k.log.append(hide(r2.id, { name: "scout-7" }))), "hide_wrong_name");
  assert.equal((await k.log.registryPage("scout-7-official"))!.did, b.did, "visible before the hide");
  await k.log.append(hide(r2.id));
  assert.equal(await k.log.registryPage("scout-7-official"), null, "hidden from the record page by name");
  assert.equal((await k.log.registrySearch("scout-7-official")).flatMap((x) => x.names).includes("scout-7-official"), false, "and from search");
  assert.deepEqual((await k.log.registryPage(b.did))!.names, [], "and from the holder's own page");
  assert.equal(await refusedBy(k.log.append(hide(r2.id))), "hide_once", "one hide for each report");
  jump(8 * DAY);
  assert.equal((await k.log.registryPage("scout-7-official"))!.did, b.did, "the hide lapses by itself and the claim was never touched");
  assert.deepEqual((await k.log.registryPage(b.did))!.names, ["scout-7-official"]);
  assert.equal((await k.log.creditAudit()).verdict, "balanced");
});
