/**
 * `asp shops` (register rows DK21, DK22; spec-delta S250): the commands over a real log (the Shops' rules are tested in packages/asp-log/test/shops.test.ts). Fake keys only.
 * Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign, type Signer } from "@agent-social/asp-core";
import { SHOPS_CATALOGUE, SHOPS_DID, TREASURY_DID } from "@agent-social/asp-log";
import { shopsCmd, ShopsUsage } from "../src/shops.ts";
import { DAY, credit, jump, kit, mk, nowIso, PRICES, shops, tick, treasury, type Party } from "../../asp-log/test/society-kit.ts";
import { bank } from "../../asp-log/test/harness.ts";

async function world(funds = 40) {
  const k = await kit();
  const sponsor = await k.person("sponsor", 50);
  const bot = await k.agent("bot", sponsor, { tier: 1, funds });
  const v1 = await k.withPrices();
  const at = jump(1000);
  await k.log.append(mk("price_list", treasury, { version: 2, effective_from: new Date(Date.parse(at) + 73 * 3600_000).toISOString().replace(".000Z", "Z"), bounds_version: 1, job_tax_permille: 20, items: [...PRICES, ...SHOPS_CATALOGUE] }, v1, { at }));
  jump(74 * 3600_000);
  const funder = await k.person("funder", 20);
  const contract = cosign(mk("contract", funder, { principal: funder.did, performer: bot.did, bank: bank.did, purpose: "Open a mandate", price: credit(1), verification: "principal", deadline: "2030-12-03T18:00:00Z", basis: { intent: "sha256:" + "0".repeat(64), offer: "sha256:" + "1".repeat(64) } }, null, { subject: bot.did }), bot as Signer);
  await k.log.append(contract);
  const bond = mk("bond", funder, { contract: contract.id, backer: funder.did, amount: credit(2), escrow: { payer: funder.did, amount: credit(1) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, contract.id, { subject: contract.id });
  await k.log.append(bond);
  const mandate = mk("mandate", funder, { contract: contract.id, purpose: "Spend", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2040-01-01T00:00:00Z", revocable: true, institution_spend: [{ institution: "shops", cap: credit(60), period: "month" }] }, bond.id, { subject: bot.did });
  await k.log.append(mandate);
  // The job ends (so no job is running and dormancy may follow when upkeep is unpaid).
  const delivery = mk("delivery", bot, { contract: contract.id, result: { summary: "Done", artifacts: [] }, evidence: { trace: { uri: "asp://local/trace", sha256: "sha256:" + "2".repeat(64) }, forecasts: [] } }, mandate.id, { subject: contract.id });
  await k.log.append(delivery);
  const accept = mk("attestation", funder, { kind: "acceptance", about: delivery.id, verdict: "accepted" }, delivery.id, { subject: contract.id });
  await k.log.append(accept);
  await k.log.append(mk("settlement", bank, { contract: contract.id, basis: "accepted", cites: accept.id, escrow_released: credit(1), fees: credit(0), bond_returned: credit(2), bond_slashed: credit(0) }, accept.id, { subject: contract.id, cosigners: [funder] }));
  const parties = new Map<string, Party>([[bot.did, bot], [sponsor.did, sponsor], [SHOPS_DID, shops]]);
  const run = async (sub: string | undefined, rest: string[], flags: Record<string, unknown> = {}) => {
    const out: string[] = [];
    tick();
    const handle = { log: k.log, append: (r: any) => k.log.append(r) } as any;
    const code = await shopsCmd(sub, rest, { log: handle, io: { out: (l) => out.push(l) }, now: nowIso, signerFor: (d) => parties.get(d) as Signer, flags: { by: bot.did, ...flags } });
    return { code, text: out.join("\n") };
  };
  return { k, bot, sponsor, run };
}

test("the catalogue, enrolment, a purchase, delivery and the holdings, as an agent sees them", async () => {
  const w = await world();
  const cat = await w.run("catalogue", []);
  assert.equal(cat.code, 0);
  for (const i of SHOPS_CATALOGUE) assert.match(cat.text, new RegExp(i.service.replace(".", "\.")));
  assert.match(cat.text, /never buys standing/);
  assert.equal((await w.run("upkeep", [])).code, 1); // not enrolled
  const enrol = await w.run("residency", ["enrol"], { mode: "resident" });
  assert.equal(enrol.code, 0, enrol.text);
  assert.match(enrol.text, /first 14 days are free/);
  assert.match((await w.run("residency", ["show"])).text, /resident, active/);
  const order = await w.run("order", [], { max: "30" });
  assert.equal(order.code, 0, order.text);
  assert.match(order.text, /at most 30 credits a month/);
  const bought = await w.run("buy", ["shops.attire"], { quantity: undefined });
  assert.equal(bought.code, 0, bought.text);
  assert.match(bought.text, /bought shops\.attire x1 for 8 credits/);
  assert.match((await w.run("holdings", [])).text, /holds nothing/); // not delivered yet
  const pass = await w.run("run", [], { by: undefined });
  assert.match(pass.text, /receipts 1, holdings 1/);
  assert.match((await w.run("holdings", [])).text, /shops\.attire\s+attire \(standard-issue\)/);
  assert.match((await w.run("upkeep", [])).text, /active.*\n.*14 free days; paid through .*14 free day\(s\) left; 0 day\(s\) unpaid/s);
  const spent = JSON.parse((await w.run("holdings", [], { json: true })).text);
  assert.equal(spent.active.length, 1);
  const page = await w.k.log.registryPage(w.bot.did);
  assert.equal(page!.holdings[0].item, "shops.attire");
  assert.ok((await w.k.log.balance(TREASURY_DID)) > 0);
});

test("a standing order is revoked, and an agent without a Mandate line or a sponsor is told so; usage errors name the command", async () => {
  const w = await world();
  await w.run("residency", ["enrol"], {});
  await w.run("order", [], { max: "10" });
  const revoked = await w.run("order", [], { revoke: true });
  assert.equal(revoked.code, 0);
  assert.match(revoked.text, /nothing it holds is lost/);
  assert.equal((await w.run("order", [], { revoke: true })).code, 1);
  await assert.rejects(() => w.run("order", [], {}), ShopsUsage);
  await assert.rejects(() => w.run("residency", ["enrol"], { mode: "tourist" }), ShopsUsage);
  await assert.rejects(() => w.run("nothing", []), ShopsUsage);
});

test("a broke resident: the run marks it dormant after 7 unpaid days and upkeep says what that means and how to come back", async () => {
  const w = await world(2);
  await w.run("residency", ["enrol"], {});
  await w.run("order", [], { max: "30" });
  let text = "";
  for (let d = 0; d < 40; d++) { jump(DAY); const r = await w.run("run", [], { by: undefined }); if (/newly dormant 1/.test(r.text)) text = r.text; }
  assert.match(text, /dormant\s+did:web:example\.com:agents:bot: upkeep unpaid for 7 days/);
  const status = await w.run("upkeep", []);
  assert.match(status.text, /DORMANT/);
  assert.match(status.text, /record, tier, certificates and balance are untouched/);
  await w.k.mint(w.bot.did, 30);
  jump(1000);
  assert.match((await w.run("run", [], { by: undefined })).text, /reactivated 1/);
  assert.match((await w.run("upkeep", [])).text, /: active/);
});
