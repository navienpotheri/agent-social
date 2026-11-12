/**
 * A kit for the Shops, Housing and Events tests: a log with the society kit's parties, the catalogues of the Shops and Housing published as price list version 2 (with the 72 hours' notice a new service needs),
 * agents whose Mandate lists institution_spend, and the institutions' own passes. Fake keys only. Credits are accounting entries, not money.
 */
import { cosign, type AspRecord, type Signer } from "@agent-social/asp-core";
import { EVENTS_CATALOGUE, HOUSING_CATALOGUE, HOUSING_DID, SHOPS_CATALOGUE, SHOPS_DID, runEvents, runHousing, runShops, type CatalogueItem } from "../src/index.ts";
import { credit, jump, kit, mk, nowIso, PRICES, shops, housing, events, tick, treasury, type Party } from "./society-kit.ts";
import { bank } from "./harness.ts";
export { housing, events };

export async function shopsWorld(o: { late?: boolean; extraItems?: unknown[] } = {}) {
  const k = await kit();
  const { log } = k;
  const sponsor = await k.person("sponsor", 100);
  const v1 = await k.withPrices();
  let list = v1;
  const items = () => [...PRICES, ...SHOPS_CATALOGUE, ...HOUSING_CATALOGUE, ...EVENTS_CATALOGUE, ...(o.extraItems ?? [])];
  /** Publishes the catalogues (price list version 2) and waits out the notice. */
  const activate = async () => {
    const at = jump(1000);
    list = (await log.append(mk("price_list", treasury, { version: 2, effective_from: new Date(Date.parse(at) + 73 * 3600_000).toISOString().replace(".000Z", "Z"), bounds_version: 1, job_tax_permille: 20, items: items() }, v1, { at }))).id;
    jump(74 * 3600_000);
  };
  if (!o.late) await activate();
  let n = 0;
  const catalogue = (service: string): CatalogueItem => [...SHOPS_CATALOGUE, ...HOUSING_CATALOGUE, ...EVENTS_CATALOGUE].find((i) => i.service === service)!;

  /** An agent with a settled job that opened its Mandate (so no job is running), or one still running; optionally a resident of the Shops. */
  const agentWith = async (name: string, a: { spend?: { institution: string; cap: number }[]; funds?: number; tier?: number; running?: boolean; resident?: boolean; agent?: Party } = {}) => {
    const ag = a.agent ?? await k.agent(name, sponsor, { tier: a.tier ?? 1, funds: a.funds ?? 100 });
    const funder = await k.person(`funder-${name}`, 20);
    const contract = cosign(mk("contract", funder, { principal: funder.did, performer: ag.did, bank: bank.did, purpose: `A job that opens a mandate for ${name}`, price: credit(1), verification: "principal", deadline: "2030-12-03T18:00:00Z", basis: { intent: "sha256:" + "0".repeat(64), offer: "sha256:" + "1".repeat(64) } }, null, { subject: ag.did }), ag as Signer);
    await log.append(contract);
    const bond = mk("bond", funder, { contract: contract.id, backer: funder.did, amount: credit(2), escrow: { payer: funder.did, amount: credit(1) }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] }, contract.id, { subject: contract.id });
    await log.append(bond);
    const spend = (a.spend ?? [{ institution: "shops", cap: 50 }, { institution: "housing", cap: 50 }]).map((s) => ({ institution: s.institution, cap: credit(s.cap), period: "month" }));
    const mandate = mk("mandate", funder, { contract: contract.id, purpose: "Spend within the budget", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2040-01-01T00:00:00Z", revocable: true, institution_spend: spend }, bond.id, { subject: ag.did });
    await log.append(mandate);
    if (!a.running) {
      const delivery = mk("delivery", ag, { contract: contract.id, result: { summary: "Done", artifacts: [] }, evidence: { trace: { uri: "asp://local/trace", sha256: "sha256:" + "2".repeat(64) }, forecasts: [] } }, mandate.id, { subject: contract.id });
      await log.append(delivery);
      const accept = mk("attestation", funder, { kind: "acceptance", about: delivery.id, verdict: "accepted" }, delivery.id, { subject: contract.id });
      await log.append(accept);
      await log.append(mk("settlement", bank, { contract: contract.id, basis: "accepted", cites: accept.id, escrow_released: credit(1), fees: credit(0), bond_returned: credit(2), bond_slashed: credit(0) }, accept.id, { subject: contract.id, cosigners: [funder] }));
    }
    if (a.resident) {
      const at = jump(1000);
      await log.append(cosign(mk("shops_act", ag, { act: "residency", agent: ag.did, mode: "resident", budget: { credits_per_month: 40 }, since: at }, null, { at }), sponsor as Signer));
    }
    return { a: ag, mandate: mandate.id, contract: contract.id };
  };
  const buy = async (a: Party, service: string, mandate: string, quantity = 1) => {
    const item = catalogue(service);
    const p = mk("purchase", a, { service, institution: item.institution, price_list: list, quantity, amount: credit(item.price * quantity), idempotency: `n-${++n}`, ...(mandate ? { mandate } : {}) });
    await log.append(p);
    return p;
  };
  const io = () => ({ append: (r: AspRecord) => log.append(r), recordsOfTypes: (t: string[]) => log.recordsOfTypes(t), priceLists: () => log.priceLists(), balance: (d: string) => log.balance(d) });
  const runShopsPass = (only?: string) => runShops(io(), shops, nowIso(), only);
  const runHousingPass = (only?: string) => runHousing(io(), housing, nowIso(), only);
  const runEventsPass = () => runEvents(io(), events, nowIso());
  return { k, log, sponsor, runEventsPass, activate, agentWith, buy, io, runShopsPass, runHousingPass, catalogue, listId: () => list, jump, tick, SHOPS_DID };
}
