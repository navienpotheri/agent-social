// An abuse report becomes a case (register rows LW5 and DK350; spec-delta S502): the Registrar refers an admitted third-party report, a quorum of a drawn panel hears it, an upheld finding pays restitution to the
// reporter from the accused and then its sponsor (up to the cap), and the outcome shows on the accused's page. Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign, b64urlEncode, type Signer } from "@agent-social/asp-core";
import { ABUSE_RESTITUTION_CAP, REGISTRAR_DID, drawPanel } from "../src/index.ts";
import { DAY, credit, jump, kit, mk, nowIso, operator, party, refusedBy, registrar, type Party } from "./society-kit.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CODE = { version: "1.0", articles: ["7"] };
const site = party("did:web:victim-site.example");

async function world(funds: { agent: number; sponsor: number }) {
  const k = await kit();
  const jurors: Party[] = [];
  for (let i = 0; i < 9; i++) { const j = await k.person(`ac-juror-${i}`, 500); await k.log.append(mk("juror", j, { did: j.did, stake: credit(100) }, null)); jurors.push(j); }
  const byDid = new Map(jurors.map((j) => [j.did, j]));
  const sponsor = await k.person("ac-sponsor", funds.sponsor);
  const agent = await k.agent("ac-agent", sponsor, { funds: funds.agent });
  const report = mk("abuse_report", site, {
    accused: agent.did, kind: "network_abuse", description: "the agent scanned our servers from many addresses overnight",
    reporter_key: { id: site.kid, public_key: b64urlEncode(site.publicKey) }, proof: { url: "https://victim-site.example/.well-known/did.json", sha256: "sha256:" + "e".repeat(64) },
  }, null, { subject: agent.did, cosigners: [operator] });
  await k.log.append(report);
  const refer = (by: Party | Signer & { did: string } = registrar, rep = report.id) => mk("court_act", by, { act: "abuse_case", report: rep }, null);
  const rule = async (caseId: string, extra: Record<string, unknown> = {}, n = 2, by?: Party[]) => {
    const panel = await drawPanel(k.log.store as never, { principal: sponsor.did, performer: agent.did, seed: caseId, size: 3 });
    const signers = by ?? panel.slice(0, n).map((d) => byDid.get(d)!);
    const [first, ...rest] = signers;
    let r = mk("court_act", first, { act: "abuse_ruling", case: caseId, finding: "upheld", reasons: ["the agent scanned the reporter's servers"], code: CODE, ...extra }, null);
    for (const s of rest) r = cosign(r, s as Signer);
    return r;
  };
  return { k, sponsor, agent, report, refer, rule };
}

test("LW5 and DK350: the Registrar refers a report, a quorum of the panel upholds it, restitution comes from the accused and then its sponsor, and the page shows it", async () => {
  const w = await world({ agent: 50, sponsor: 300 });
  const log = w.k.log;
  // Only the Registrar or the operator refers; only an abuse report; once.
  assert.equal(await refusedBy(log.append(w.refer(w.sponsor))), "abuse_case_wrong_issuer");
  assert.equal(await refusedBy(log.append(w.refer(registrar, "sha256:" + "4".repeat(64)))), "abuse_case_not_a_report");
  const theCase = w.refer();
  await log.append(theCase);
  assert.equal(await refusedBy(log.append(mk("court_act", registrar, { act: "abuse_case", report: w.report.id }, null, { at: "2026-12-01T00:00:00Z" }))), "abuse_case_once");
  // The accused's page says the lead has been referred.
  assert.equal((await log.registryPage(w.agent.did))!.abuse![0].outcome!.state, "referred");

  // The panel: a quorum of the drawn three, none of whom is the accused, its sponsor, the reporter or the Registrar; restitution within the cap and only on an upheld finding.
  assert.equal(await refusedBy(log.append(await w.rule(theCase.id, {}, 1))), "panel_quorum");
  assert.equal(await refusedBy(log.append(await w.rule(theCase.id, {}, 2, [w.sponsor]))), "abuse_panel_conflict", "the sponsor does not sit");
  assert.equal(await refusedBy(log.append(await w.rule(theCase.id, { restitution: { amount: credit(ABUSE_RESTITUTION_CAP + 1) } }))), "abuse_restitution_cap");
  assert.equal(await refusedBy(log.append(await w.rule(theCase.id, { finding: "dismissed", restitution: { amount: credit(10) } }))), "abuse_restitution_needs_finding");

  const before = { agent: await log.balance(w.agent.did), sponsor: await log.balance(w.sponsor.did), site: await log.balance(site.did) };
  const ruling = await w.rule(theCase.id, { restitution: { amount: credit(120) } });
  await log.append(ruling);
  assert.equal(await refusedBy(log.append(await w.rule(theCase.id))), "abuse_case_decided", "ruled once");
  // 50 from the accused's own balance, the other 70 from its sponsor, 120 to the reporter: a transfer, so supply is unchanged.
  assert.equal(await log.balance(w.agent.did), before.agent - 50);
  assert.equal(await log.balance(w.sponsor.did), before.sponsor - 70);
  assert.equal(await log.balance(site.did), before.site + 120);
  assert.equal((await log.creditAudit()).verdict, "balanced");
  // DK365 (S1200): the reporter was funded by the accused and by its sponsor: the funding sources the v2 draw reads.
  const raw = (log as unknown as { store: { transaction<T>(f: (tx: { getMarker(k: string): Promise<string | undefined> }) => Promise<T>): Promise<T> } }).store;
  assert.deepEqual(JSON.parse((await raw.transaction((tx) => tx.getMarker(`funders:${site.did}`))) ?? "[]").sort(), [w.agent.did, w.sponsor.did].sort());

  const out = (await log.registryPage(w.agent.did))!.abuse![0].outcome!;
  assert.deepEqual([out.state, out.finding, out.requested, out.paid, out.shortfall], ["ruled", "upheld", 120, 120, 0]);
  assert.equal((await log.verify()).ok, true, "replay reproduces the ruling and the transfer");
});

test("what the accused and its sponsor do not hold is not paid, and the shortfall is on the record; a dismissed finding pays nothing", async () => {
  const w = await world({ agent: 0, sponsor: 30 });
  const log = w.k.log;
  const c = w.refer();
  await log.append(c);
  await log.append(await w.rule(c.id, { restitution: { amount: credit(100) } }));
  assert.equal(await log.balance(site.did), 30);
  const out = (await log.registryPage(w.agent.did))!.abuse![0].outcome!;
  assert.deepEqual([out.paid, out.shortfall], [30, 70]);

  const d = await world({ agent: 40, sponsor: 100 });
  const c2 = d.refer();
  await d.k.log.append(c2);
  await d.k.log.append(await d.rule(c2.id, { finding: "dismissed" }));
  assert.equal(await d.k.log.balance(site.did), 0);
  assert.equal(await d.k.log.balance(d.agent.did), 40);
  assert.equal((await d.k.log.registryPage(d.agent.did))!.abuse![0].outcome!.finding, "dismissed");
  void REGISTRAR_DID;
});

test("DK530 (S952): from 2026-11-19 no credits reach an outside victim; an upheld finding names the operator's remedy, and the docs promise no payment", async () => {
  const w = await world({ agent: 50, sponsor: 300 });
  const log = w.k.log;
  const c = w.refer();
  await log.append(c);
  jump(20 * DAY); // past the switch-off
  const before = { agent: await log.balance(w.agent.did), sponsor: await log.balance(w.sponsor.did), site: await log.balance(site.did) };
  assert.equal(await refusedBy(log.append(await w.rule(c.id, { restitution: { amount: credit(100) }, remedy: "suspension" }))), "abuse_restitution_off");
  assert.equal(await refusedBy(log.append(await w.rule(c.id))), "abuse_remedy_needed", "an upheld finding must name the remedy");
  assert.equal(await refusedBy(log.append(await w.rule(c.id, { finding: "dismissed", remedy: "takedown" }))), "abuse_remedy_needs_finding");
  await log.append(await w.rule(c.id, { remedy: "suspension" }));
  assert.deepEqual([await log.balance(w.agent.did), await log.balance(w.sponsor.did), await log.balance(site.did)], [before.agent, before.sponsor, before.site], "nobody paid anybody");
  const out = (await log.registryPage(w.agent.did))!.abuse![0].outcome!;
  assert.deepEqual([out.finding, out.remedy, out.paid], ["upheld", "suspension", 0]);
  assert.equal((await log.creditAudit()).verdict, "balanced");
  assert.equal((await log.verify()).ok, true);
  const docs = readFileSync(fileURLToPath(new URL("../../../docs/commands.md", import.meta.url)), "utf8");
  assert.match(docs, /no credits are paid to an outside party/);
  assert.doesNotMatch(docs, /with restitution to the reporter from the accused/);
});

test("DK535 (S971): a retirement a Court ordered rests on its ruling, states its reason and gives 24 hours' notice before it takes effect; the holder's own retirement still takes effect at once", async () => {
  const w = await world({ agent: 100, sponsor: 100 });
  const log = w.k.log;
  const c = w.refer();
  await log.append(c);
  jump(20 * DAY);
  const rulingRec = await w.rule(c.id, { remedy: "retire_identity" });
  await log.append(rulingRec);
  const retire = (over: Record<string, unknown>, by: Party | Signer & { did: string } = registrar) => mk("registry_act", by, { act: "identity_retirement", holder: w.agent.did, ...over }, null);
  const soon = (hours: number) => new Date(Date.parse(nowIso()) + hours * 3_600_000).toISOString().replace(/\.\d+Z$/, "Z");
    assert.equal(await refusedBy(log.append(retire({ reason: "x" }, w.sponsor))), "registry_wrong_issuer", "only the Registrar records a Court's order, and the holder its own");
  assert.equal(await refusedBy(log.append(retire({ reason: "ordered", effective_from: soon(30) }))), "retirement_needs_ruling");
  await assert.rejects(() => log.append(retire({ ruling: rulingRec.id, effective_from: soon(30) })), /reason/, "the schema already asks for a reason");
  assert.equal(await refusedBy(log.append(retire({ ruling: rulingRec.id, reason: "ordered", effective_from: soon(2) }))), "retirement_needs_notice");
  assert.equal(await refusedBy(log.append(retire({ ruling: rulingRec.id, reason: "ordered" }))), "retirement_needs_notice");
  await log.append(retire({ ruling: rulingRec.id, reason: "the panel upheld the finding", effective_from: soon(30) }));
  // Inside the notice period the identity is free; after it, it takes no new purchase.
  await w.k.withPrices();
  await w.k.buy(w.agent, "academy.exam_sitting", 20);
  jump(31 * 3_600_000);
  assert.equal(await refusedBy(w.k.buy(w.agent, "academy.exam_sitting", 20)), "identity_retired");
  assert.equal((await log.creditAudit()).verdict, "balanced");
  assert.equal((await log.verify()).ok, true);
});
