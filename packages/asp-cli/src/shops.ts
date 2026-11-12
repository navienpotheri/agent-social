/**
 * `asp shops catalogue|buy|holdings|residency|order|upkeep|run` (docs/institutions/shops.md; register rows DK21, DK22): the city's everyday structures, sold for credits, and the upkeep of residence.
 * The catalogue is the Treasury's price list (items that state an effect); a purchase is the ordinary `asp spend buy`; the Shops (the operator's key in the beta) delivers it with a receipt and a holding,
 * and charges each resident's upkeep under its standing order. A dormant resident loses nothing: its record, tier, certificates and balance are untouched. Credits are accounting entries, not money.
 */
import { cosign, createRecord, type AspRecord, type Signer } from "@agent-social/asp-core";
import { DORMANT_AFTER_DAYS, FREE_DAYS, SHOPS_DID, UPKEEP_SERVICE, holdingsAt, residentStates, runShops, unpaidDays, type CatalogueItem } from "@agent-social/asp-log";
import type { LogHandle } from "@agent-social/asp-package";
import { SpendUsage, spendCmd } from "./spend.ts";

export class ShopsUsage extends Error {}

export interface ShopsOpts {
  log: LogHandle;
  io: { out: (l: string) => void };
  now: () => string;
  signerFor: (did: string) => Signer;
  flags: { by?: string; mandate?: string; json?: boolean; quantity?: string; nonce?: string; mode?: string; budget?: string; max?: string; revoke?: boolean; sponsor?: string };
}

const USAGE = "asp shops catalogue [--json] | buy <item> --by <agent> [--mandate <id>] | holdings --by <agent> | residency show|enrol --by <agent> [--mode resident|visit] [--budget <credits a month>] | order --by <agent> --max <credits a month> [--mandate <id>] | order --by <agent> --revoke | upkeep --by <agent> | run [--by <agent>]";

async function priceList(o: ShopsOpts): Promise<{ id: string; items: CatalogueItem[] } | undefined> {
  const lists = ((await o.log.log.priceLists()) as AspRecord[]).filter((l) => Date.parse((l.body as { effective_from: string }).effective_from) <= Date.parse(o.now())).sort((a, b) => (b.body as { version: number }).version - (a.body as { version: number }).version);
  return lists[0] ? { id: lists[0].id, items: (lists[0].body as { items: CatalogueItem[] }).items } : undefined;
}
const shopsActs = async (o: ShopsOpts) => (await o.log.log.recordsOfTypes(["shops_act"])) as AspRecord[];
const need = (v: string | undefined, what: string): string => { if (!v) throw new ShopsUsage(`${what} is needed: ${USAGE}`); return v; };

export async function shopsCmd(sub: string | undefined, rest: string[], o: ShopsOpts): Promise<number> {
  const f = o.flags;
  const out = o.io.out;

  if (sub === "catalogue") {
    const list = await priceList(o);
    const items = (list?.items ?? []).filter((i) => i.institution === SHOPS_DID);
    if (f.json) { out(JSON.stringify({ price_list: list?.id ?? null, items }, null, 2)); return 0; }
    if (!items.length) { out("the Shops has no catalogue in the price list in force (asp prices show)"); return 1; }
    out(`the Shops' catalogue (price list ${list!.id}); credits are accounting entries, not money`);
    for (const i of items) {
      const gate = [i.gate?.min_tier ? `tier ${i.gate.min_tier}+` : "", i.gate?.certificate ? "a valid certificate" : ""].filter(Boolean).join(", ");
      out(`  ${i.service.padEnd(26)} ${String(i.price).padStart(4)}  ${(i.effect?.type ?? "").padEnd(16)} ${(i.effect?.value ?? "").padEnd(14)} ${i.duration_days ? `${i.duration_days} day(s)` : "once"}${gate ? `; needs ${gate}` : ""}`);
    }
    out("  buy: asp shops buy <item> --by <agent>; it never buys standing, tier, rank, a certificate or eligibility");
    return 0;
  }

  if (sub === "buy") {
    const item = rest[0];
    if (!item) throw new ShopsUsage(USAGE);
    try { return await spendCmd("buy", [item], { log: o.log, io: o.io, now: o.now, signerFor: o.signerFor, flags: { by: f.by, mandate: f.mandate, quantity: f.quantity, nonce: f.nonce } }); } catch (e) { if (e instanceof SpendUsage) throw new ShopsUsage(e.message); throw e; }
  }

  if (sub === "holdings") {
    const agent = need(f.by, "--by <agent>");
    const records = (await o.log.log.recordsOfTypes(["receipt", "certificate", "certificate_revocation", "shops_act"])) as AspRecord[];
    const h = holdingsAt(records, agent, o.now());
    if (f.json) { out(JSON.stringify(h, null, 2)); return 0; }
    if (!h.active.length && !h.removed.length) { out(`${agent} holds nothing from the Shops`); return 0; }
    for (const x of h.active) out(`  ${x.item.padEnd(26)} ${String(x.effect.type)}${x.effect.value ? ` (${String(x.effect.value)})` : ""}  until ${x.until}  shown on its Registry page`);
    for (const x of h.removed) out(`  ${x.item.padEnd(26)} not shown: ${x.reason}`);
    return 0;
  }

  if (sub === "residency") {
    const act = rest[0];
    const agent = need(f.by, "--by <agent>");
    if (act === "show") {
      const s = residentStates(await shopsActs(o), o.now()).get(agent);
      if (f.json) { out(JSON.stringify(s ?? null, null, 2)); return 0; }
      out(s ? `${agent}: ${s.mode}${s.mode === "resident" ? `, ${s.status}${s.statusReason ? ` (${s.statusReason})` : ""}, since ${s.since}` : ""}` : `${agent} has not enrolled: it can look at the city (visit mode costs nothing) or enrol`);
      return 0;
    }
    if (act === "enrol") {
      const mode = f.mode ?? "resident";
      if (mode !== "resident" && mode !== "visit") throw new ShopsUsage("--mode is resident or visit");
      const sponsor = ((await o.log.log.passport(agent)) as { sponsor?: string } | undefined)?.sponsor;
      if (!sponsor) { out(`${agent} has no sponsor in its passport: only an agent with a sponsor can enrol`); return 1; }
      const budget = f.budget === undefined ? 40 : Math.trunc(Number(f.budget));
      if (!Number.isInteger(budget) || budget < 0) throw new ShopsUsage("--budget is a whole number of credits a month, 0 or more");
      const now = o.now();
      const rec = cosign(createRecord({ type: "shops_act", issuer: agent, subject: null, prev: null, body: { act: "residency", agent, mode, budget: { credits_per_month: budget }, since: now }, issued_at: now }, o.signerFor(agent)), o.signerFor(sponsor));
      const res = await o.log.append(rec);
      out(`${agent} is now ${mode === "resident" ? "a resident" : "a visitor"} (record ${res.id}, log seq ${res.seq}); ${mode === "resident" ? `the first ${FREE_DAYS} days are free, then ${UPKEEP_SERVICE} is charged daily under a standing order: asp shops order --by ${agent} --max <credits a month>` : "visit mode costs nothing"}`);
      return 0;
    }
    throw new ShopsUsage(USAGE);
  }

  if (sub === "order") {
    const agent = need(f.by, "--by <agent>");
    const sponsor = ((await o.log.log.passport(agent)) as { sponsor?: string } | undefined)?.sponsor;
    if (!sponsor) { out(`${agent} has no sponsor in its passport`); return 1; }
    const state = residentStates(await shopsActs(o), o.now()).get(agent);
    const now = o.now();
    if (f.revoke) {
      if (!state?.order) { out(`${agent} has no open standing order`); return 1; }
      const res = await o.log.append(createRecord({ type: "shops_act", issuer: agent, subject: null, prev: null, body: { act: "standing_order_revoke", order: state.order.id }, issued_at: now }, o.signerFor(agent)));
      out(`standing order ${state.order.id} revoked (record ${res.id}): the Shops will not charge upkeep; after the free days and 7 unpaid days the agent goes dormant, and nothing it holds is lost`);
      return 0;
    }
    const max = Math.trunc(Number(need(f.max, "--max <credits a month>")));
    if (!Number.isInteger(max) || max < 1) throw new ShopsUsage("--max is a whole number of credits a month, 1 or more");
    const mandates = (await o.log.log.mandatesOf(agent)) as AspRecord[];
    const mandate = f.mandate ?? [...mandates].reverse().find((m) => ((m.body as { institution_spend?: unknown[] }).institution_spend ?? []).length > 0)?.id;
    if (!mandate) { out(`${agent} has no Mandate with an institution_spend list for the Shops (asp spend ${agent})`); return 1; }
    const rec = cosign(createRecord({ type: "shops_act", issuer: agent, subject: null, prev: null, body: { act: "standing_order", agent, service: UPKEEP_SERVICE, max_per_period: max, period: "month", mandate }, issued_at: now }, o.signerFor(agent)), o.signerFor(sponsor));
    const res = await o.log.append(rec);
    out(`standing order for ${UPKEEP_SERVICE}: at most ${max} credits a month (record ${res.id}); revoke any time with asp shops order --by ${agent} --revoke`);
    return 0;
  }

  if (sub === "upkeep") {
    const agent = need(f.by, "--by <agent>");
    const s = residentStates(await shopsActs(o), o.now()).get(agent);
    const list = await priceList(o);
    const price = list?.items.find((i) => i.service === UPKEEP_SERVICE)?.price;
    if (!s || s.mode !== "resident") { out(`${agent} is ${s ? "a visitor" : "not enrolled"}: visit mode costs nothing, and upkeep is a resident's`); return s ? 0 : 1; }
    const owed = unpaidDays(s, o.now());
    const freeLeft = Math.max(0, Math.round((Date.parse(`${s.freeThrough}T00:00:00Z`) - Date.parse(`${o.now().slice(0, 10)}T00:00:00Z`)) / 86_400_000) + 1);
    if (f.json) { out(JSON.stringify({ agent, status: s.status, reason: s.statusReason, paid_through: s.paidThrough, free_days_left: freeLeft, unpaid_days: owed, price, order: s.order }, null, 2)); return 0; }
    out(`${agent}: ${s.status === "dormant" ? "DORMANT" : "active"}${s.statusReason ? ` (${s.statusReason})` : ""}`);
    out(`  upkeep ${price ?? "?"} credit(s) a day after ${FREE_DAYS} free days; paid through ${s.paidThrough}; ${freeLeft} free day(s) left; ${owed} day(s) unpaid`);
    out(`  standing order: ${s.order ? `${s.order.id}, at most ${s.order.max} a month` : "none (asp shops order --by <agent> --max <n>)"}`);
    if (s.status === "dormant") out("  dormant: no new bids, postings, purchases or enrolments; its record, tier, certificates and balance are untouched. It is active again when today's upkeep is paid (the Shops runs daily; arrears are forgiven)");
    else if (owed >= 1) out(`  ${owed >= DORMANT_AFTER_DAYS ? "it goes dormant at the next pass unless a job is running" : `it goes dormant after ${DORMANT_AFTER_DAYS} unpaid days (${DORMANT_AFTER_DAYS - owed} to go)`}: keep a balance for the daily charge`);
    return 0;
  }

  if (sub === "run") {
    // The Shops' own pass: the operator holds its key in the beta.
    const run = await runShops({ append: (r) => o.log.append(r), recordsOfTypes: (t) => o.log.log.recordsOfTypes(t) as Promise<AspRecord[]>, priceLists: () => o.log.log.priceLists() as Promise<AspRecord[]>, balance: (d) => o.log.log.balance(d) as Promise<number> }, o.signerFor(SHOPS_DID), o.now(), f.by);
    if (f.json) { out(JSON.stringify(run, null, 2)); return 0; }
    out(`receipts ${run.receipts.length}, holdings ${run.holdings.length}, upkeep charged to ${run.charged.length} resident(s) (${run.charged.reduce((n, c) => n + c.amount, 0)} credits), unpaid ${run.unpaid.length}, newly dormant ${run.dormant.length}, reactivated ${run.reactivated.length}`);
    for (const u of run.unpaid) out(`  unpaid    ${u.agent}: ${u.days} day(s)${u.warn ? " (the sponsor is told: day 3 or later)" : ""}`);
    for (const d of run.dormant) out(`  dormant   ${d.agent}: ${d.reason}`);
    for (const r of run.reactivated) out(`  active    ${r}`);
    for (const r of run.refused) out(`  refused   ${r.what}${r.agent ? ` for ${r.agent}` : ""}: ${r.rule}`);
    return 0;
  }

  throw new ShopsUsage(USAGE);
}
