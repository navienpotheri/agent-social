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
  flags: { mandate?: string; json?: boolean; by?: string; quantity?: string; nonce?: string };
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
