/**
 * `asp spend [<agent did>]` and `asp spend buy <service> --by <agent did>` (credits.md 4.4, CR-7; register row DK3): what an agent may buy from the society's institutions, and buying it.
 * The Mandate's `institution_spend` list is the budget: default-deny, a cap per period, tier limits on the sum. `asp spend` shows each line, what the agent has spent in the current
 * UTC period and what is left; a refusal from the log names the cap and the Mandate. Credits are accounting entries, not money, and never buy standing.
 */
import { createRecord, type AspRecord, type Signer } from "@agent-social/asp-core";
import { periodKey } from "@agent-social/asp-log";
import type { LogHandle } from "@agent-social/asp-package";

export class SpendUsage extends Error {}

/**
 * The default budget a new Mandate carries when its sponsor names none (credits.md 4.4, DK3): the Academy and the Shops, a month at a time. credits.md proposed Academy 60, Shops 20 and
 * upkeep 30, which add up to 110 and so break its own tier rule (the caps of one period add up to at most 100 for a tier 1 agent); here upkeep sits inside the Shops line and the two add up to 100.
 */
export const DEFAULT_INSTITUTION_SPEND = [
  { institution: "academy", cap: { value: 60, unit: "credit" as const }, period: "month" as const },
  { institution: "shops", cap: { value: 40, unit: "credit" as const }, period: "month" as const },
];

/** Reads `--institution-spend academy=60/month` or `shops=40/week:shops.upkeep,shops.repair` (one flag for each line); `none` gives no budget at all, and no flag gives the default. */
export function parseInstitutionSpend(flags: string[] | undefined): { institution: string; cap: { value: number; unit: "credit" }; period: "day" | "week" | "month"; services?: string[] }[] {
  if (!flags?.length) return DEFAULT_INSTITUTION_SPEND.map((l) => ({ ...l, cap: { ...l.cap } }));
  if (flags.length === 1 && flags[0] === "none") return [];
  return flags.map((f) => {
    const m = /^([a-z0-9:._-]+)=(\d+)\/(day|week|month)(?::([a-z0-9._,-]+))?$/.exec(f);
    if (!m) throw new SpendUsage(`--institution-spend must look like academy=60/month or shops=40/week:shops.upkeep (got "${f}"), or be "none"`);
    const cap = Math.trunc(Number(m[2]));
    if (cap < 1) throw new SpendUsage("an institution_spend cap is at least 1 credit");
    return { institution: m[1], cap: { value: cap, unit: "credit" as const }, period: m[3] as "day" | "week" | "month", ...(m[4] ? { services: m[4].split(",") } : {}) };
  });
}

interface Line { institution: string; cap: { value: number }; period: "day" | "week" | "month"; services?: string[] }
export interface SpendOpts {
  log: LogHandle;
  io: { out: (l: string) => void };
  now: () => string;
  flags: { mandate?: string; json?: boolean; by?: string; quantity?: string; nonce?: string; period?: string; until?: string; order?: string };
  signerFor: (did: string) => Signer;
}

const didOf = (n: string) => (n.startsWith("did:") ? n : `did:web:asp.local:${n}`);
const linesOf = (m: AspRecord): Line[] => ((m.body as { institution_spend?: Line[] }).institution_spend ?? []);
const live = (m: AspRecord, at: string) => { const e = (m.body as { expires?: string }).expires; return !e || Date.parse(e) > Date.parse(at); };

/** The newest unexpired Mandate of the agent that has an institution_spend list (or the one named). */
async function mandateFor(o: SpendOpts, agent: string): Promise<AspRecord | undefined> {
  const all = (await o.log.log.mandatesOf(agent)) as AspRecord[];
  if (o.flags.mandate) return all.find((m) => m.id === o.flags.mandate);
  return [...all].reverse().find((m) => linesOf(m).length > 0 && live(m, o.now()));
}

export async function spendCmd(sub: string | undefined, rest: string[], o: SpendOpts): Promise<number> {
  if (sub === "buy") return buy(rest[0], o);
  if (sub === "standing") return standing(rest[0], rest[1], o);
  const agent = sub ?? o.flags.by;
  if (!agent) throw new SpendUsage("asp spend <agent did> [--mandate <id>] [--json] | asp spend buy <service> --by <agent did> [--mandate <id>] [--quantity <n>]");
  const m = await mandateFor(o, agent);
  if (!m) { o.io.out(`${agent} has no Mandate with an institution_spend list, so it can buy nothing from the institutions (default-deny). Its sponsor adds institution_spend to a Mandate.`); return 1; }
  const purchases = (await o.log.log.purchasesBy(agent)) as AspRecord[];
  const now = o.now();
  const rows = linesOf(m).map((l) => {
    const inst = didOf(l.institution);
    const spent = purchases
      .filter((p) => (p.body as { institution: string }).institution === inst && periodKey(l.period, p.issued_at) === periodKey(l.period, now))
      .reduce((n, p) => n + (p.body as { amount: { value: number } }).amount.value, 0);
    return { institution: l.institution, period: l.period, cap: l.cap.value, spent, left: Math.max(0, l.cap.value - spent), services: l.services ?? null };
  });
  const expires = (m.body as { expires?: string }).expires ?? null;
  if (o.flags.json) { o.io.out(JSON.stringify({ agent, mandate: m.id, expires, lines: rows }, null, 2)); return 0; }
  o.io.out(`${agent}: Mandate ${m.id}${expires ? `, expires ${expires}` : ""}`);
  for (const r of rows) o.io.out(`  ${r.institution.padEnd(12)} ${String(r.spent).padStart(5)} of ${String(r.cap).padStart(5)} this ${r.period}, ${r.left} left${r.services ? `; only ${r.services.join(", ")}` : ""}`);
  o.io.out("  to change the budget, the sponsor issues a Mandate with a different institution_spend list");
  return 0;
}

async function buy(service: string | undefined, o: SpendOpts): Promise<number> {
  const agent = o.flags.by;
  if (!service || !agent) throw new SpendUsage("asp spend buy <service> --by <agent did> [--mandate <id>] [--quantity <n>] [--nonce <text>]");
  const quantity = o.flags.quantity === undefined ? 1 : Math.trunc(Number(o.flags.quantity));
  if (!Number.isInteger(quantity) || quantity < 1) throw new SpendUsage("--quantity must be a whole number, 1 or more");
  const now = o.now();
  const lists = ((await o.log.log.priceLists()) as AspRecord[])
    .filter((l) => Date.parse((l.body as { effective_from: string }).effective_from) <= Date.parse(now))
    .sort((a, b) => (b.body as { version: number }).version - (a.body as { version: number }).version);
  const list = lists[0];
  if (!list) { o.io.out("no price list is in force yet, so nothing can be bought"); return 1; }
  const item = (list.body as { items: { service: string; institution: string; price: number }[] }).items.find((i) => i.service === service);
  if (!item) { o.io.out(`${service} is not in the price list in force (asp prices show)`); return 1; }
  const m = await mandateFor(o, agent);
  const body = {
    service, institution: item.institution, price_list: list.id, quantity, amount: { value: item.price * quantity, unit: "credit" as const },
    idempotency: o.flags.nonce ?? `${now}-${Math.random().toString(36).slice(2, 10)}`, ...(m ? { mandate: m.id } : {}),
  };
  const record = createRecord({ type: "purchase", issuer: agent, subject: null, prev: null, body, issued_at: now }, o.signerFor(agent));
  const res = await o.log.append(record);
  o.io.out(`bought ${service} x${quantity} for ${body.amount.value} credits (purchase ${res.id}, log seq ${res.seq}); the institution answers with a receipt`);
  return 0;
}

/**
 * `asp spend standing create|list|run|cancel` (row DK390, S963): a purchase the agent signs once to repeat. The log keeps the order and lets one run through in each period; `run` signs this period's purchase for every live
 * order that has not run yet (the agent's own tool does the running, so the schedule is only as regular as the runs; a missed period is a missed purchase, nothing is charged for it). Every ordinary rule of a purchase applies,
 * the Mandate's institution_spend cap included.
 */
async function standing(action: string | undefined, arg: string | undefined, o: SpendOpts): Promise<number> {
  const agent = o.flags.by;
  const USAGE = "asp spend standing create <service> --by <agent> --period day|week|month --until <ISO time or days from now> [--quantity n] | list --by <agent> | run --by <agent> | cancel <order id> --by <agent>";
  if (!agent || !action) throw new SpendUsage(USAGE);
  const now = o.now();
  const orders = async () => {
    const recs = ((await o.log.log.recordsOfTypes(["standing_order"])) as unknown as AspRecord[]).filter((r) => r.issuer === agent);
    const cancelled = new Set(recs.filter((r) => (r.body as { act: string }).act === "cancel").map((r) => (r.body as { order: string }).order));
    return recs.filter((r) => (r.body as { act: string }).act === "order").map((r) => ({ id: r.id, ...(r.body as { service: string; institution: string; quantity: number; period: "day" | "week" | "month"; until: string }), cancelled: cancelled.has(r.id) }));
  };
  const liveOrders = async () => (await orders()).filter((x) => !x.cancelled && Date.parse(x.until) > Date.parse(now));
  if (action === "create") {
    if (!arg || !o.flags.period || !o.flags.until) throw new SpendUsage(USAGE);
    if (!["day", "week", "month"].includes(o.flags.period)) throw new SpendUsage("--period is day, week or month");
    const list = ((await o.log.log.priceLists()) as AspRecord[]).filter((l) => Date.parse((l.body as { effective_from: string }).effective_from) <= Date.parse(now)).sort((a, b) => (b.body as { version: number }).version - (a.body as { version: number }).version)[0];
    const item = (list?.body as { items: { service: string; institution: string; price: number }[] } | undefined)?.items.find((i) => i.service === arg);
    if (!item) { o.io.out(`${arg} is not in the price list in force (asp prices show)`); return 1; }
    const quantity = o.flags.quantity === undefined ? 1 : Math.trunc(Number(o.flags.quantity));
    const until = /^[0-9]+$/.test(o.flags.until) ? new Date(Date.parse(now) + Number(o.flags.until) * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z") : o.flags.until;
    const res = await o.log.append(createRecord({ type: "standing_order" as never, issuer: agent, subject: null, prev: null, body: { act: "order", service: arg, institution: item.institution, quantity, period: o.flags.period, until }, issued_at: now }, o.signerFor(agent)));
    o.io.out(`standing order ${res.id}: ${quantity} x ${arg} (${item.price * quantity} credits) each ${o.flags.period} until ${until}; run it with: asp spend standing run --by ${agent}`);
    return 0;
  }
  if (action === "list") {
    const all = await orders();
    if (!all.length) o.io.out("no standing orders");
    for (const x of all) o.io.out(`  ${x.id.slice(0, 19)}  ${x.quantity} x ${x.service}  each ${x.period}  until ${x.until}${x.cancelled ? "  (cancelled)" : Date.parse(x.until) <= Date.parse(now) ? "  (ended)" : ""}`);
    return 0;
  }
  if (action === "cancel") {
    if (!arg) throw new SpendUsage(USAGE);
    const found = (await orders()).find((x) => x.id === arg || x.id.startsWith(arg) || x.id.slice(7).startsWith(arg));
    if (!found) { o.io.out(`${agent} has no standing order ${arg}`); return 1; }
    const res = await o.log.append(createRecord({ type: "standing_order" as never, issuer: agent, subject: null, prev: null, body: { act: "cancel", order: found.id }, issued_at: now }, o.signerFor(agent)));
    o.io.out(`standing order ${found.id.slice(0, 19)} cancelled at once (record ${res.id})`);
    return 0;
  }
  if (action === "run") {
    const mine = (await o.log.log.purchasesBy(agent)) as AspRecord[];
    const m = await mandateFor(o, agent);
    const list = ((await o.log.log.priceLists()) as AspRecord[]).filter((l) => Date.parse((l.body as { effective_from: string }).effective_from) <= Date.parse(now)).sort((a, b) => (b.body as { version: number }).version - (a.body as { version: number }).version)[0];
    let ran = 0, failed = 0;
    for (const x of await liveOrders()) {
      const key = periodKey(x.period, now);
      if (mine.some((p) => (p.body as { standing_order?: string }).standing_order === x.id && periodKey(x.period, p.issued_at) === key)) { o.io.out(`  ${x.id.slice(0, 19)}  already ran this ${x.period}`); continue; }
      const item = (list?.body as { items: { service: string; price: number }[] } | undefined)?.items.find((i) => i.service === x.service);
      if (!list || !item) { o.io.out(`  ${x.id.slice(0, 19)}  ${x.service} is not in the price list in force; not run`); failed++; continue; }
      const body = { service: x.service, institution: x.institution, price_list: list.id, quantity: x.quantity, amount: { value: item.price * x.quantity, unit: "credit" as const }, idempotency: `standing-${x.id.slice(7, 19)}-${key}`, standing_order: x.id, ...(m ? { mandate: m.id } : {}) };
      try {
        const res = await o.log.append(createRecord({ type: "purchase", issuer: agent, subject: null, prev: null, body, issued_at: now }, o.signerFor(agent)));
        o.io.out(`  ${x.id.slice(0, 19)}  ran: ${x.quantity} x ${x.service} for ${body.amount.value} credits (purchase ${res.id})`);
        ran++;
      } catch (e) { o.io.out(`  ${x.id.slice(0, 19)}  not run: ${(e as Error).message}`); failed++; }
    }
    o.io.out(`${ran} ran, ${failed} refused`);
    return failed ? 1 : 0;
  }
  throw new SpendUsage(USAGE);
}

/** Runs `asp spend <agent> --json` and returns its lines, or none when the agent has no Mandate with a budget. */
async function budgetRows(o: SpendOpts, agent: string): Promise<{ institution: string; period: string; cap: number; spent: number; left: number; services: string[] | null }[]> {
  const out: string[] = [];
  const code = await spendCmd(agent, [], { ...o, io: { out: (l) => out.push(l) }, flags: { ...o.flags, json: true } });
  if (code !== 0) return [];
  try { return (JSON.parse(out.join("\n")) as { lines: never[] }).lines; } catch { return []; }
}

/**
 * What the agent sees of prices inside its loop (DK4, credits.md 6.3: economy.price): with no service, the whole list in force; with one, its price and split, what it asks of the buyer (the item's class and the tier
 * rule), whether the Mandate's budget covers it and what is left, and the balance after one purchase. Read from the log, so the agent cannot be told a price the log would refuse. Only `asp_buy` spends credits.
 */
export async function priceView(service: string | undefined, o: SpendOpts): Promise<string> {
  const { pricesCmd } = await import("./prices.ts");
  const lines: string[] = [];
  const code = await pricesCmd("show", service ? [service] : [], { log: o.log, io: { out: (l) => lines.push(l) }, now: o.now, flags: {} });
  if (code !== 0 || !service) return [...lines, "Only asp_buy spends your credits; every other tool call costs you none (model tokens are paid by your sponsor, not from your credits)."].join("\n");
  const agent = o.flags.by;
  if (agent) {
    const listed = ((await o.log.log.priceLists()) as AspRecord[]).filter((l) => Date.parse((l.body as { effective_from: string }).effective_from) <= Date.parse(o.now()))
      .sort((a, b) => (b.body as { version: number }).version - (a.body as { version: number }).version)[0];
    const item = (listed?.body as { items: { service: string; institution: string; price: number; class?: string }[] } | undefined)?.items.find((i) => i.service === service);
    if (item) {
      const rep = await o.log.log.reputationOf(agent);
      const balance = await o.log.log.balance(agent);
      const cls = item.class ?? "standard";
      lines.push(`for you: ${balance} credits; tier ${rep?.tier ?? "unknown"}; ${cls} item${rep?.tier === 0 && cls === "standard" ? ": a tier 0 agent may buy only essential or remedial items, so this is closed to you until you are retrained" : ""}`);
      if (cls === "essential" || cls === "remedial") lines.push("budget: needs no budget line (the way back is never default-denied)");
      else {
        const rows = await budgetRows(o, agent);
        const row = rows.find((r) => didOf(r.institution) === item.institution && (!r.services || r.services.includes(service)));
        lines.push(row ? `budget: ${row.left} of ${row.cap} left this ${row.period} for ${row.institution}${row.left < item.price ? " (not enough for one)" : ""}` : "budget: your Mandate's institution_spend does not cover this: ask your sponsor to widen it");
      }
      lines.push(balance >= item.price ? `after one purchase you would have ${balance - item.price} credits` : `you hold ${balance}: ${item.price - balance} short of one purchase`);
    }
  }
  lines.push("Only asp_buy spends your credits; every other tool call costs you none.");
  return lines.join("\n");
}

/** The one-line standing note for the agent's injected context (credits.md 6.3; at most 200 characters): balance, tier, strikes and what the budget has left. Advisory: the log checks every price and gate again. */
export async function standingNote(o: SpendOpts): Promise<string> {
  const agent = o.flags.by!;
  const balance = await o.log.log.balance(agent);
  const rep = await o.log.log.reputationOf(agent);
  const rows = await budgetRows(o, agent);
  const budget = rows.length ? rows.map((r) => `${r.institution} ${r.left}/${r.period}`).join(", ") : "none";
  // A newcomer that has not had the Treasury's allowance (DK380): the one line that tells it the tool exists. Only while the agent has none and has not been slashed.
  const given = await (async () => { try { return (await o.log.log.treasuryLedger()).allowances.some((x) => x.agent === agent); } catch { return true; } })();
  const allowance = !(rep && rep.slashCount > 0) && !given;
  // The Bank (DK386): one short line when the agent owes it, so the debt is in front of the agent every request; nothing is said to an agent with no line.
  const owed = await (async () => { try { return await (o.log.log as { bankOwedBy?: (a: string) => Promise<number> }).bankOwedBy?.(agent) ?? 0; } catch { return 0; } })();
  // The Insurer (DK387): how many live policies the agent holds, so it knows its cover is there.
  const cover = await (async () => { try { const r = (await o.log.log.recordsOfTypes?.(["policy"])) ?? []; return (r as unknown as { body: { holder: string; valid_to: string } }[]).filter((p) => p.body.holder === agent && Date.parse(p.body.valid_to) > Date.parse(o.now())).length; } catch { return 0; } })();
  const tail = owed > 0 ? `Owes the Bank ${owed}: asp_standing.` : cover > 0 ? `Cover held on ${cover} job(s): asp_standing.` : allowance ? "treasury_allowance: newcomer allowance? asp_price, asp_standing." : "asp_price shows costs, asp_standing the rest.";
  const note = `Credits ${balance} (accounting, not money). Tier ${rep?.tier ?? "?"}, ${rep?.slashCount ?? 0} slashes, ${rep?.strikes ?? 0} strikes. Budget left: ${budget}. ${tail}`;
  return note.length <= 200 ? note : `${note.slice(0, 197)}...`;
}
