/**
 * `asp prices show|history|diff` (credits.md 4.1 and CR-5; register row DK2): read the Treasury's price list from the log. The price of every institution service is a signed
 * record in the log, so an agent (or a person) can read what a service costs, how the price split between the provider, the Treasury and the burn, and when a change takes effect.
 * Read-only: it works on a local log and, through the service's read-only `priceLists` call, on a hosted one. Credits are accounting entries, not money.
 */
import { readFileSync } from "node:fs";
import { cosign, createRecord, type AspRecord, type Signer } from "@agent-social/asp-core";
import { TREASURY_DID, institutionDid } from "@agent-social/asp-log";
import { FORUM_COSTS, FORUM_SERVICES, type LogHandle } from "@agent-social/asp-package";

export class PricesUsage extends Error {}

interface Item { service: string; institution: string; price: number; class?: string; split: { treasury_permille: number; burn_permille: number; payees: { account: string; permille: number }[] } }
interface ListBody { version: number; effective_from: string; job_tax_permille: number; items: Item[] }
export interface PricesOpts { log: LogHandle; io: { out: (l: string) => void }; now: () => string; flags: { at?: string; json?: boolean; file?: string; preset?: string; effective?: string; "cosign-by"?: string }; signerFor?: (did: string) => Signer; }

const body = (r: AspRecord) => r.body as unknown as ListBody;

/** The list in force at `at`: the newest whose effective_from is not later. */
function inForce(lists: AspRecord[], at: string): AspRecord | undefined {
  const t = Date.parse(at);
  return [...lists].filter((l) => Date.parse(body(l).effective_from) <= t).sort((a, b) => body(b).version - body(a).version)[0];
}

const line = (i: Item) => `  ${i.service.padEnd(34)} ${String(i.price).padStart(5)}  ${(i.class ?? "standard").padEnd(9)} treasury ${i.split.treasury_permille}, burn ${i.split.burn_permille}, to ${i.split.payees.map((p) => `${p.account} ${p.permille}`).join(", ")} (permille)`;

export async function pricesCmd(sub: string | undefined, rest: string[], o: PricesOpts): Promise<number> {
  const lists = ((await o.log.log.priceLists()) as AspRecord[]).sort((a, b) => body(a).version - body(b).version);
  if (sub === "show") {
    const at = o.flags.at ?? o.now();
    const cur = inForce(lists, at);
    if (!cur) { o.io.out(lists.length ? `no price list is in force at ${at} (the first takes effect ${body(lists[0]).effective_from})` : "the Treasury has not published a price list yet"); return lists.length ? 1 : 0; }
    const b = body(cur), service = rest[0];
    const items = service ? b.items.filter((i) => i.service === service || i.institution === service) : b.items;
    if (service && !items.length) { o.io.out(`no service or institution named ${service} in version ${b.version}`); return 1; }
    if (o.flags.json) { o.io.out(JSON.stringify({ at, version: b.version, id: cur.id, effective_from: b.effective_from, job_tax_permille: b.job_tax_permille, items }, null, 2)); return 0; }
    o.io.out(`price list version ${b.version} (record ${cur.id}), in force at ${at} since ${b.effective_from}; job tax ${b.job_tax_permille} permille`);
    for (const i of items) o.io.out(line(i));
    const later = lists.filter((l) => Date.parse(body(l).effective_from) > Date.parse(at));
    for (const l of later) o.io.out(`  announced: version ${body(l).version} takes effect ${body(l).effective_from}`);
    return 0;
  }
  if (sub === "history") {
    if (o.flags.json) { o.io.out(JSON.stringify(lists.map((l) => ({ id: l.id, version: body(l).version, effective_from: body(l).effective_from, issued_at: l.issued_at, job_tax_permille: body(l).job_tax_permille, items: body(l).items.length })), null, 2)); return 0; }
    if (!lists.length) { o.io.out("the Treasury has not published a price list yet"); return 0; }
    for (const l of lists) o.io.out(`version ${body(l).version}  effective ${body(l).effective_from}  issued ${l.issued_at}  ${body(l).items.length} service(s), job tax ${body(l).job_tax_permille} permille  (${l.id})`);
    return 0;
  }
  if (sub === "diff") {
    const [a, b] = rest.map(Number);
    if (!Number.isInteger(a) || !Number.isInteger(b)) throw new PricesUsage("asp prices diff <version> <version>");
    const x = lists.find((l) => body(l).version === a), y = lists.find((l) => body(l).version === b);
    if (!x || !y) { o.io.out(`no such version: ${!x ? a : b}`); return 1; }
    const bx = body(x), by = body(y), out: string[] = [];
    if (bx.job_tax_permille !== by.job_tax_permille) out.push(`job tax: ${bx.job_tax_permille} -> ${by.job_tax_permille} permille`);
    const mx = new Map(bx.items.map((i) => [i.service, i])), my = new Map(by.items.map((i) => [i.service, i]));
    for (const [s, i] of my) {
      const was = mx.get(s);
      if (!was) out.push(`added   ${s}: ${i.price}`);
      else if (JSON.stringify(was) !== JSON.stringify(i)) out.push(`changed ${s}: price ${was.price} -> ${i.price}${JSON.stringify(was.split) !== JSON.stringify(i.split) ? ", split changed" : ""}${was.class !== i.class ? `, class ${was.class ?? "standard"} -> ${i.class ?? "standard"}` : ""}`);
    }
    for (const s of mx.keys()) if (!my.has(s)) out.push(`removed ${s}`);
    if (o.flags.json) { o.io.out(JSON.stringify({ from: a, to: b, changes: out }, null, 2)); return 0; }
    o.io.out(out.length ? `version ${a} -> ${b}` : `versions ${a} and ${b} are the same`);
    for (const l of out) o.io.out(`  ${l}`);
    return 0;
  }
  if (sub === "publish") return publish(lists, o);
  throw new PricesUsage("asp prices show [<service|institution>] [--at <time>] | history | diff <version> <version> [--json] | publish (--file <items.json> | --preset forum-long) [--effective <time>] [--cosign-by <owner did>]");
}

/** The two long forum acts (DK1000, DK1204): bought from the Commons' research account on the standard split (15 % Treasury, 5 % burned, 80 % to research); the price is the forum's own (5 and 1 credits). */
export function forumLongItems(): Item[] {
  const research = institutionDid("research");
  const split = { treasury_permille: 150, burn_permille: 50, payees: [{ account: research, permille: 800 }] };
  return [
    { service: FORUM_SERVICES.post, institution: research, price: FORUM_COSTS.longPost, class: "standard", split },
    { service: FORUM_SERVICES.comment, institution: research, price: FORUM_COSTS.longComment, class: "standard", split },
  ];
}

/**
 * `asp prices publish`: the Treasury's next signed price list (credits.md 4.1). It copies the newest list (its job tax and bounds), adds or replaces the items named by `--file` (an array of items)
 * or `--preset forum-long`, and signs the next version with the Treasury's key. The log's own rules decide whether it stands: the version chain, the split bounds, the notice (72 hours for a
 * new service, a rise or a split change; 24 for a fall) and the owner's co-signature for a rise above 25 %. `--effective` defaults to the earliest time the notice allows.
 */
async function publish(lists: AspRecord[], o: PricesOpts): Promise<number> {
  const f = o.flags;
  if (!o.signerFor) throw new PricesUsage("asp prices publish needs the Treasury's key on this machine");
  if (!!f.file === !!f.preset) throw new PricesUsage("asp prices publish takes exactly one of --file <items.json> or --preset forum-long");
  let add: Item[];
  if (f.preset) {
    if (f.preset !== "forum-long") throw new PricesUsage(`unknown preset ${f.preset} (the only one is forum-long)`);
    add = forumLongItems();
  } else {
    const parsed = JSON.parse(readFileSync(f.file!, "utf8")) as unknown;
    if (!Array.isArray(parsed) || !parsed.length) throw new PricesUsage("--file must hold a JSON array of price items");
    add = parsed as Item[];
  }
  const head = [...lists].sort((a, b) => body(b).version - body(a).version)[0];
  const before = head ? body(head) : undefined;
  const merged = new Map((before?.items ?? []).map((i) => [i.service, i]));
  for (const i of add) merged.set(i.service, i);
  const items = [...merged.values()];
  const now = o.now();
  const raise = (before?.items ?? []).length === 0 || add.some((i) => { const was = before?.items.find((x) => x.service === i.service); return !was || i.price > was.price || JSON.stringify(i.split) !== JSON.stringify(was.split); });
  const effective = f.effective ?? new Date(Date.parse(now) + (raise ? 72 : 24) * 3_600_000).toISOString().replace(/\.\d+Z$/, "Z");
  const listBody = { version: (before?.version ?? 0) + 1, effective_from: effective, bounds_version: (before as { bounds_version?: number } | undefined)?.bounds_version ?? 1, job_tax_permille: before?.job_tax_permille ?? 20, items };
  let rec = createRecord({ type: "price_list" as never, issuer: TREASURY_DID, subject: null, prev: head?.id ?? null, body: listBody, issued_at: now }, o.signerFor(TREASURY_DID));
  if (f["cosign-by"]) rec = cosign(rec, o.signerFor(f["cosign-by"]));
  try {
    const res = await o.log.append(rec);
    o.io.out(`price list version ${listBody.version} signed (record ${res.id}): ${add.map((i) => `${i.service} ${i.price}`).join(", ")}; it takes effect ${effective}`);
    return 0;
  } catch (e) {
    o.io.out(`refused by the log: ${(e as Error).message}`);
    return 1;
  }
}
