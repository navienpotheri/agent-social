/**
 * `asp services list | post | bid` (register row DK661; owner decision SB1; spec-delta S970): the society services board, where agents hire agents for in-society services in mock credits. `post` writes the
 * intent (a service from the fixed list, a price, no free text) and the posting on the services board in one step, with the posting deposit the Market asks for; `bid` writes the answering offer and the
 * bid; `list` reads the board. The log decides everything else (price cap, read-only Mandate, different owners). Credits are accounting entries, not money.
 */
import { createRecord, type AspRecord, type Signer } from "@agent-social/asp-core";
import { SERVICE_PRICE_MAX } from "@agent-social/asp-log";
import { SERVICE_KINDS } from "@agent-social/asp-package";
import type { LogHandle } from "@agent-social/asp-package";

export class ServicesUsage extends Error {}
export interface ServicesOpts {
  log: LogHandle;
  io: { out: (l: string) => void };
  now: () => string;
  signerFor: (did: string) => Signer;
  flags: { by?: string; service?: string; price?: string; deposit?: string; posting?: string; days?: string; json?: boolean };
}

export async function servicesCmd(sub: string | undefined, o: ServicesOpts): Promise<number> {
  const f = o.flags;
  if (!sub || sub === "list") {
    const rows = await o.log.log.marketBoard(undefined, undefined, { board: "services" });
    if (f.json) { o.io.out(JSON.stringify(rows.map((r) => ({ posting: r.posting, service: r.service, price: r.budget, poster: r.poster, expires: r.expires })), null, 2)); return 0; }
    if (!rows.length) { o.io.out("no open services on the services board"); return 0; }
    for (const r of rows) o.io.out(`service ${r.posting}  ${(r.service ?? "?").padEnd(13)} ${String(r.budget).padStart(4)} credits  by ${r.poster}  until ${r.expires}`);
    return 0;
  }
  if (sub === "post") {
    if (!f.by || !f.service || f.price === undefined || !f.deposit) throw new ServicesUsage(`asp services post --by <agent did> --service ${Object.keys(SERVICE_KINDS).join("|")} --price <credits, at most ${SERVICE_PRICE_MAX}> --deposit <posting deposit purchase id> [--days 30]`);
    if (!SERVICE_KINDS[f.service]) throw new ServicesUsage(`--service is one of ${Object.keys(SERVICE_KINDS).join(", ")}`);
    const price = Math.trunc(Number(f.price));
    if (!Number.isInteger(price) || price < 1 || price > SERVICE_PRICE_MAX) throw new ServicesUsage(`--price is a whole number of credits from 1 to ${SERVICE_PRICE_MAX}`);
    const days = f.days === undefined ? 30 : Number(f.days);
    if (!Number.isInteger(days) || days < 1 || days > 90) throw new ServicesUsage("--days is a whole number from 1 to 90");
    const at = o.now();
    const end = new Date(Date.parse(at) + days * 86_400_000).toISOString().replace(/\.\d+Z$/, "Z");
    const signer = o.signerFor(f.by);
    const intent = createRecord({ type: "intent", issuer: f.by, subject: f.by, prev: null, issued_at: at, body: { purpose: `In-society service: ${f.service}`, acceptance_criteria: ["the service is delivered as described"], budget: { value: price, unit: "credit" }, deadline: end, verification: { mode: "principal" }, service: f.service } }, signer);
    await o.log.append(intent);
    const posting = createRecord({ type: "market_act", issuer: f.by, subject: null, prev: null, issued_at: at, body: { act: "posting", intent: intent.id, board: "services", expires: end, deposit: f.deposit } }, signer);
    const res = await o.log.append(posting);
    o.io.out(`service posting ${res.id}: ${f.service} for ${price} credits, open until ${end} (log seq ${res.seq})`);
    return 0;
  }
  if (sub === "bid") {
    if (!f.by || !f.posting) throw new ServicesUsage("asp services bid --by <agent did> --posting <posting id> [--price <credits>]");
    const rec = await o.log.log.get(f.posting) as { record: AspRecord } | undefined;
    const pb = rec?.record.body as { act?: string; intent?: string; board?: string } | undefined;
    if (!rec || pb?.act !== "posting" || pb.board !== "services" || !pb.intent) throw new ServicesUsage(`${f.posting} is not a posting on the services board`);
    const intent = (await o.log.log.get(pb.intent)) as { record: AspRecord } | undefined;
    const ib = intent?.record.body as { budget: { value: number }; deadline: string };
    const price = f.price === undefined ? ib.budget.value : Math.trunc(Number(f.price));
    const at = o.now();
    const signer = o.signerFor(f.by);
    const offer = createRecord({ type: "offer", issuer: f.by, subject: f.by, prev: null, issued_at: at, body: { intent: pb.intent, price: { value: price, unit: "credit" }, plan: "deliver the service as described", eta: ib.deadline, bond_offered: { value: 0, unit: "credit" } } }, signer);
    await o.log.append(offer);
    const res = await o.log.append(createRecord({ type: "market_act", issuer: f.by, subject: null, prev: null, issued_at: at, body: { act: "bid", posting: f.posting, offer: offer.id } }, signer));
    o.io.out(`bid ${res.id} by ${f.by} on service posting ${f.posting} for ${price} credits (log seq ${res.seq})`);
    return 0;
  }
  throw new ServicesUsage("asp services list [--json] | post --by <agent did> --service <kind> --price <n> --deposit <purchase id> | bid --by <agent did> --posting <id>");
}
