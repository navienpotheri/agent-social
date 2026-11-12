/**
 * The log's rules for the Shops' records (shops.md 3 to 5; register rows DK21, DK22; spec-delta S250): what makes a holding, a residency, a standing order, an upkeep charge and a residency status valid,
 * and the checks a purchase of a catalogue item must pass. Called from `EventLog`; state lives in markers written inside the append, so a refused record leaves none.
 */
import { AspError, type AspRecord } from "@agent-social/asp-core";
import { TREASURY_DID, BURN_DID, splitParts, type Split } from "./economy.ts";
import { CAPACITY_LEDGER, DAY_MS, DORMANT_AFTER_DAYS, HOUSING_DID, RESOURCE_EFFECTS, SHOPS_DID, UPKEEP_SERVICE, addDays, dayOf, daysBetween, freeThrough, isoAt, type CatalogueItem } from "./shops.ts";
import type { LogTx, StoredRecord } from "./store.ts";

const rule = (name: string, message: string) => new AspError("GUARD_FAILED", message, name);

export interface ShopsEnv {
  reputation(rd: LogTx, did: string): Promise<{ tier: number } | null>;
  priceListInForce(tx: LogTx, at: number): Promise<StoredRecord | undefined>;
  debit(tx: LogTx, did: string, amount: number): Promise<void>;
  credit(tx: LogTx, did: string, amount: number): Promise<void>;
  /** The most an agent of this tier may budget a month (credits.md 4.4): tier 0 none, tier 3 no limit. */
  tierSpendLimit(tier: number): number;
}

interface Resident { mode: "visit" | "resident"; since: string; paid_through: string; status: "active" | "dormant"; order: string | null }
const readResident = async (tx: Pick<LogTx, "getMarker">, did: string): Promise<Resident | undefined> => { const raw = await tx.getMarker(`resident:${did}`); return raw ? (JSON.parse(raw) as Resident) : undefined; };
const writeResident = (tx: LogTx, did: string, r: Resident) => tx.putMarker(`resident:${did}`, JSON.stringify(r));
const iso = (ms: number) => isoAt(ms);

async function cosignedBy(tx: LogTx, r: AspRecord, did: string): Promise<boolean> {
  for (const c of r.cosigs ?? []) if ((await tx.getKey(c.kid))?.did === did) return true;
  return false;
}

/** A dormant resident may not post, bid, enrol, visit or buy (except an essential item); its record, tier, certificates and balance are untouched (shops.md 5). */
export async function assertNotDormant(tx: Pick<LogTx, "getMarker">, did: string, what: string): Promise<void> {
  const res = await readResident(tx, did);
  if (res?.status === "dormant") throw rule("agent_dormant", `${did} is dormant (upkeep unpaid): it may not ${what} until today's upkeep is paid (asp shops upkeep shows where it stands); nothing it holds is lost`);
}

/** The checks on a purchase of a catalogue item of the Shops: not dormant, a resident, the gate (tier, certificate), no second active holding. Called from the purchase rule with the item's price-list entry. */
export async function checkShopsPurchase(tx: LogTx, buyer: string, item: CatalogueItem, at: string, tier: number | undefined): Promise<void> {
  const shops = item.institution === SHOPS_DID;
  if (item.service === UPKEEP_SERVICE) throw rule("upkeep_by_standing_order", "upkeep is charged by the Shops under the agent's standing order, not bought: asp shops upkeep shows where it stands");
  if (item.class !== "essential") await assertNotDormant(tx, buyer, "buy");
  const res = await readResident(tx, buyer);
  if (shops && res?.mode !== "resident") throw rule("shops_needs_residency", `${buyer} is not a resident: a visitor looks and cannot hold items (asp shops residency enrol --mode resident, with the sponsor's countersignature)`);
  const gate = item.gate;
  if (gate?.min_tier !== undefined && (tier ?? 0) < gate.min_tier) throw rule("gate_tier", `${item.service} needs tier ${gate.min_tier}; ${buyer} is tier ${tier ?? 0} (asp academy tier shows what is missing)`);
  if (gate?.certificate) {
    let ok = false;
    for (const id of ((await tx.getMarker(`certs_of:${buyer}`)) ?? "").split(",").filter(Boolean)) {
      const c = await tx.getRecord(id);
      const cb = c?.record.body as { skill: string; issued: string; expires: string } | undefined;
      if (!cb || (await tx.getMarker(`cert_revoked:${id}`))) continue;
      if ((gate.certificate === "*" || cb.skill === gate.certificate) && Date.parse(cb.issued) <= Date.parse(at) && Date.parse(cb.expires) > Date.parse(at)) ok = true;
    }
    if (!ok) throw rule("gate_certificate", `${item.service} needs a valid ${gate.certificate === "*" ? "" : `${gate.certificate} `}certificate, and ${buyer} has none`);
  }
  const until = await tx.getMarker(`holding_active:${buyer}|${item.service}`);
  if (until && Date.parse(until) > Date.parse(at)) throw rule("holding_active", `${buyer} already holds ${item.service} until ${until}: one active holding of an item at a time`);
  // A resource effect (DK75): the sum over all the sponsor's agents stays within the per-sponsor cap, and all sponsors together within the capacity ledger. Both are checked at purchase and written with it.
  const e = item.effect;
  if (e && (RESOURCE_EFFECTS as readonly string[]).includes(e.type) && e.amount) {
    const sponsor = (await tx.getPassport(buyer))?.sponsor ?? buyer;
    const live = async (key: string) => (JSON.parse((await tx.getMarker(key)) ?? "[]") as { until: string; amount: number }[]).filter((x) => Date.parse(x.until) > Date.parse(at));
    const mine = await live(`res:${sponsor}|${e.type}`);
    const held = mine.reduce((n, x) => n + x.amount, 0);
    if (held + e.amount > (e.cap_per_sponsor ?? 0)) throw rule("resource_cap_reached", `the sponsor ${sponsor} already holds ${held} of ${e.type} through its agents and the cap is ${e.cap_per_sponsor}: ${e.amount} more would pass it (the per-sponsor cap is shared by all its agents)`);
    const ledger = e.unit_cost_ref ? CAPACITY_LEDGER[e.unit_cost_ref] : undefined;
    const all = await live(`res_all:${e.unit_cost_ref}`);
    if (!ledger || all.reduce((n, x) => n + x.amount, 0) + e.amount > ledger.capacity_units) throw rule("capacity_exhausted", `the capacity the operator can grant of ${e.type} is used up`);
    const until2 = new Date(Date.parse(at) + (item.duration_days ?? 0) * DAY_MS).toISOString();
    await tx.putMarker(`res:${sponsor}|${e.type}`, JSON.stringify([...mine, { until: until2, amount: e.amount }]));
    await tx.putMarker(`res_all:${e.unit_cost_ref}`, JSON.stringify([...all, { until: until2, amount: e.amount }]));
  }
}

/** Remembers which contracts an agent performs, so dormancy can wait while one runs. */
export async function notePerformer(tx: LogTx, contract: AspRecord): Promise<void> {
  const perf = (contract.body as { performer?: string }).performer;
  if (!perf) return;
  const key = `perf:${perf}`;
  await tx.putMarker(key, [...((await tx.getMarker(key)) ?? "").split(",").filter(Boolean), contract.id].join(","));
}

async function runningJob(tx: LogTx, agent: string): Promise<string | undefined> {
  for (const id of ((await tx.getMarker(`perf:${agent}`)) ?? "").split(",").filter(Boolean)) {
    const chain = await tx.getChain(id);
    if (chain?.state === "Running" || chain?.state === "Checkpoint") return id;
  }
  return undefined;
}

/** A holding (shops.md 3, housing.md 3): the seller (the Shops or Housing) signs that a delivered purchase of its own catalogue item gives the buyer the item's effect until a date. */
export async function projectHolding(tx: LogTx, r: AspRecord, seller: string): Promise<void> {
  const b = r.body as Record<string, any>;
  if (r.issuer !== seller) throw rule("shops_act_wrong_issuer", `${r.issuer} is not ${seller}: only the seller signs a holding`);
  const p = await tx.getRecord(b.purchase);
  const pb = p?.record.body as { service: string; institution: string; price_list: string } | undefined;
  if (!p || p.record.type !== "asp.purchase/v0.2" || !pb) throw rule("holding_purchase_unknown", `${b.purchase} is not a purchase in this log`);
  if (p.record.issuer !== b.holder) throw rule("holding_not_holders", `the purchase ${b.purchase} was made by ${p.record.issuer}, not ${b.holder}`);
  if (pb.service !== b.item || pb.institution !== seller) throw rule("holding_wrong_item", `the purchase is for ${pb.service}, not ${b.item} from ${seller}`);
  const rc = await tx.getRecord(b.receipt);
  const rb = rc?.record.body as { status: string } | undefined;
  if (!rc || rc.record.type !== "asp.receipt/v0.2" || rc.record.prev !== p.id || rc.record.issuer !== seller || rb?.status !== "delivered") throw rule("holding_receipt_missing", `${b.receipt} is not a delivered receipt of the seller for the purchase ${p.id}: a holding follows a delivery`);
  const item = ((await tx.getRecord(pb.price_list))?.record.body as { items?: CatalogueItem[] } | undefined)?.items?.find((i) => i.service === pb.service);
  if (!item?.effect || !item.duration_days || item.service === UPKEEP_SERVICE) throw rule("holding_no_effect", `${pb.service} has no durable effect in the price list the purchase relied on`);
  if (JSON.stringify(b.effect) !== JSON.stringify(item.effect)) throw rule("holding_effect_mismatch", `the effect stated is not the one the price list gives ${pb.service}: ${JSON.stringify(item.effect)}`);
  const from = p.record.issued_at, until = iso(Date.parse(from) + item.duration_days * DAY_MS);
  if (b.from !== from || b.until !== until) throw rule("holding_dates_wrong", `a holding runs from the purchase (${from}) for ${item.duration_days} days, to ${until}`);
  if ((item.gate?.certificate ?? undefined) !== b.gate_certificate) throw rule("holding_gate_mismatch", "a holding carries the certificate gate of its item, so the badge goes when the certificate does");
  if (await tx.getMarker(`holding_of_purchase:${p.id}`)) throw rule("holding_exists", `the purchase ${p.id} already gave a holding: one purchase, one holding`);
  const active = await tx.getMarker(`holding_active:${b.holder}|${b.item}`);
  if (active && Date.parse(active) > Date.parse(from)) throw rule("holding_active", `${b.holder} already holds ${b.item} until ${active}`);
  await tx.putMarker(`holding_of_purchase:${p.id}`, r.id);
  await tx.putMarker(`holding_active:${b.holder}|${b.item}`, until);
}

export async function projectShopsAct(tx: LogTx, r: AspRecord, env: ShopsEnv): Promise<void> {
  const b = r.body as Record<string, any>;
  if (r.prev !== null) throw rule("shops_act_not_chained", "a shops act starts its own chain (prev is null)");
  const now = r.issued_at;
  const fromShops = () => { if (r.issuer !== SHOPS_DID) throw rule("shops_act_wrong_issuer", `${r.issuer} is not the Shops (${SHOPS_DID}): only the Shops signs a ${b.act}`); };

  if (b.act === "holding") return projectHolding(tx, r, SHOPS_DID);

  if (b.act === "residency") {
    if (r.issuer !== b.agent) throw rule("residency_not_agents", "an agent signs its own residency");
    const passport = await tx.getPassport(b.agent);
    if (!passport?.sponsor) throw rule("residency_needs_sponsor", `${b.agent} has no sponsor in its passport: only an agent with a sponsor becomes a resident`);
    if (!(await cosignedBy(tx, r, passport.sponsor))) throw rule("residency_needs_sponsor_cosign", `the residency is countersigned by the sponsor ${passport.sponsor}`);
    if (b.since !== now) throw rule("residency_since_wrong", `since is the day it is signed (${now})`);
    const rep = await env.reputation(tx, b.agent);
    const limit = env.tierSpendLimit(rep?.tier ?? 0);
    if (b.budget.credits_per_month > limit) throw rule("residency_budget_over_limit", `a tier ${rep?.tier ?? 0} agent's budget is at most ${limit} credits a month, not ${b.budget.credits_per_month}`);
    const was = await readResident(tx, b.agent);
    if (was && !(was.mode === "visit" && b.mode === "resident")) throw rule("residency_exists", `${b.agent} is already ${was.mode === "visit" ? "a visitor" : "a resident"}: one residency per agent (a visitor may become a resident)`);
    await writeResident(tx, b.agent, { mode: b.mode, since: now, paid_through: freeThrough(now), status: "active", order: was?.order ?? null });
    return;
  }

  if (b.act === "standing_order") {
    if (r.issuer !== b.agent) throw rule("standing_order_not_agents", "an agent signs its own standing order");
    const passport = await tx.getPassport(b.agent);
    if (!passport?.sponsor || !(await cosignedBy(tx, r, passport.sponsor))) throw rule("standing_order_needs_sponsor_cosign", "a standing order is countersigned by the agent's sponsor");
    const res = await readResident(tx, b.agent);
    if (res?.mode !== "resident") throw rule("standing_order_not_resident", `${b.agent} is not a resident: upkeep is a resident's`);
    if (res.order) throw rule("standing_order_exists", `${b.agent} already has an open standing order (${res.order}): revoke it first`);
    const m = await tx.getRecord(b.mandate);
    const mb = m?.record.body as { expires?: string; institution_spend?: { institution: string; cap: { value: number }; period: "day" | "week" | "month" }[] } | undefined;
    if (!m || m.record.type !== "asp.mandate/v0.2" || m.record.subject !== b.agent) throw rule("standing_order_mandate", `${b.mandate} is not a Mandate of ${b.agent}`);
    if (mb?.expires && Date.parse(mb.expires) <= Date.parse(now)) throw rule("standing_order_mandate", `the Mandate ${b.mandate} has expired`);
    const line = mb?.institution_spend?.find((e) => e.institution === "shops" || e.institution === SHOPS_DID);
    const monthly = line ? line.cap.value * (line.period === "day" ? 30 : line.period === "week" ? 4 : 1) : 0;
    if (!line || b.max_per_period > monthly) throw rule("standing_order_over_budget", `the order allows ${b.max_per_period} a month but the Mandate's institution_spend for the Shops allows ${monthly}: the order stays inside the budget`);
    await tx.putMarker(`order:${r.id}`, JSON.stringify({ agent: b.agent, max: b.max_per_period }));
    await writeResident(tx, b.agent, { ...res, order: r.id });
    return;
  }

  if (b.act === "standing_order_revoke") {
    const o = await tx.getMarker(`order:${b.order}`);
    if (!o) throw rule("standing_order_unknown", `${b.order} is not a standing order in this log`);
    const { agent } = JSON.parse(o) as { agent: string };
    const sponsor = (await tx.getPassport(agent))?.sponsor;
    if (r.issuer !== agent && r.issuer !== sponsor) throw rule("revoke_not_a_party", "the agent or its sponsor revokes a standing order");
    const res = await readResident(tx, agent);
    if (!res || res.order !== b.order) throw rule("standing_order_closed", `${b.order} is already revoked`);
    await writeResident(tx, agent, { ...res, order: null });
    return;
  }

  if (b.act === "upkeep_charge") {
    fromShops();
    const res = await readResident(tx, b.agent);
    if (res?.mode !== "resident") throw rule("upkeep_not_resident", `${b.agent} is not a resident`);
    if (!res.order || res.order !== b.order) throw rule("upkeep_no_order", `${b.agent} has no open standing order ${b.order}: the Shops charges only under one`);
    const info = JSON.parse((await tx.getMarker(`order:${b.order}`))!) as { max: number };
    const list = await env.priceListInForce(tx, Date.parse(now));
    if (!list || list.id !== b.price_list) throw rule("price_list_not_in_force", `the price list in force is ${list?.id}, not ${b.price_list}`);
    const item = (list.record.body as { items: { service: string; price: number; split: Split }[] }).items.find((i) => i.service === UPKEEP_SERVICE);
    if (!item) throw rule("unknown_service", `${UPKEEP_SERVICE} is not in the price list in force`);
    if (b.amount.value !== item.price * b.days) throw rule("price_mismatch", `upkeep is ${item.price} a day, so ${b.days} days are ${item.price * b.days}, not ${b.amount.value}`);
    const today = dayOf(now);
    const expected = res.status === "dormant" ? today : addDays(res.paid_through, 1);
    if (b.from_day !== expected) throw rule("upkeep_wrong_days", `the next day to charge is ${expected}${res.status === "dormant" ? " (a dormant resident pays today only: the arrears are forgiven)" : ` (paid through ${res.paid_through}; the first ${14} days are free)`}`);
    if (res.status === "dormant" && b.days !== 1) throw rule("upkeep_wrong_days", "a dormant resident reactivates by paying one day, today's");
    const last = addDays(b.from_day, b.days - 1);
    if (daysBetween(last, today) < 0) throw rule("upkeep_future", `${last} has not begun: upkeep is charged for days that have begun`);
    const spentKey = `upkeep_spent:${b.agent}|${now.slice(0, 7)}`;
    const spent = Number((await tx.getMarker(spentKey)) ?? 0);
    if (spent + b.amount.value > info.max) throw rule("standing_order_exceeded", `the standing order allows ${info.max} credits a month and ${spent} are charged, so ${b.amount.value} more would be ${spent + b.amount.value}`);
    await env.debit(tx, b.agent, b.amount.value);
    const parts = splitParts(b.amount.value, item.split);
    for (const p of parts.payees) await env.credit(tx, p.account, p.amount);
    await env.credit(tx, TREASURY_DID, parts.treasury);
    await env.credit(tx, BURN_DID, parts.burn);
    await tx.putMarker(spentKey, String(spent + b.amount.value));
    await writeResident(tx, b.agent, { ...res, paid_through: last });
    return;
  }

  if (b.act === "residency_status") {
    fromShops();
    const res = await readResident(tx, b.agent);
    if (res?.mode !== "resident") throw rule("status_not_resident", `${b.agent} is not a resident`);
    const today = dayOf(now);
    if (b.status === "dormant") {
      if (res.status === "dormant") throw rule("status_unchanged", `${b.agent} is already dormant`);
      const unpaid = daysBetween(res.paid_through, today);
      if (unpaid < DORMANT_AFTER_DAYS) throw rule("dormancy_too_early", `dormancy follows ${DORMANT_AFTER_DAYS} unpaid days; ${b.agent} has ${Math.max(0, unpaid)} (paid through ${res.paid_through})`);
      const job = await runningJob(tx, b.agent);
      if (job) throw rule("dormancy_job_running", `${b.agent} has a job that is running (${job}): dormancy waits until it settles`);
      await writeResident(tx, b.agent, { ...res, status: "dormant" });
    } else {
      if (res.status !== "dormant") throw rule("status_unchanged", `${b.agent} is not dormant`);
      if (daysBetween(res.paid_through, today) > 0) throw rule("reactivation_unpaid", `${b.agent} reactivates when today's upkeep is paid (paid through ${res.paid_through})`);
      await writeResident(tx, b.agent, { ...res, status: "active" });
    }
  }
}
