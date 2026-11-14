/**
 * The help desk (register row GV15; spec-delta S484): a citizen with a passport opens a ticket, the operator replies and closes it, the one who opened it rates the answer once it is closed. The log keeps the
 * state (so a replica agrees), and every figure the status page shows is derived from the records: tickets open, how long the first reply took, whether the published target was met, and how satisfied
 * the people who rated were. Credits are accounting entries, not money; nothing here moves any.
 */
import { AspError, type AspRecord } from "@agent-social/asp-core";
import type { LogTx } from "./store.ts";

const rule = (name: string, message: string) => new AspError("GUARD_FAILED", message, name);
const DAY = 86_400_000;
/** The published response target: a first reply within 48 hours (proposal; the owner may change it). */
export const SUPPORT_TARGET_HOURS = 48;
export const SUPPORT_TICKETS_PER_DAY = 5;
export const SUPPORT_MAX_OPEN = 3;

interface Ticket { opener: string; at: string; state: "open" | "closed"; firstReply?: string; rated?: boolean }
const read = async (tx: Pick<LogTx, "getMarker">, id: string): Promise<Ticket | undefined> => { const raw = await tx.getMarker(`support:${id}`); return raw ? (JSON.parse(raw) as Ticket) : undefined; };

export async function projectSupport(tx: LogTx, r: AspRecord, env: { operator?: string }): Promise<void> {
  const b = r.body as { act: string; ticket?: string; topic?: string; resolution?: string; score?: number };
  if (r.prev !== null) throw rule("support_not_chained", "a support record starts its own chain (prev is null)");
  const isOperator = !!env.operator && r.issuer === env.operator;
  if (b.act === "ticket") {
    if (!(await tx.getPassport(r.issuer))) throw rule("support_no_passport", `${r.issuer} has no passport in this log: a ticket names who asks`);
    const dayKey = `support_day:${r.issuer}|${r.issued_at.slice(0, 10)}`;
    const today = Number((await tx.getMarker(dayKey)) ?? 0);
    if (today >= SUPPORT_TICKETS_PER_DAY) throw rule("support_rate", `${r.issuer} has opened ${today} tickets today; the limit is ${SUPPORT_TICKETS_PER_DAY} a day`);
    const openKey = `support_open:${r.issuer}`;
    const open = Number((await tx.getMarker(openKey)) ?? 0);
    if (open >= SUPPORT_MAX_OPEN) throw rule("support_too_many_open", `${r.issuer} has ${open} open tickets; the limit is ${SUPPORT_MAX_OPEN}: close one first`);
    await tx.putMarker(dayKey, String(today + 1));
    await tx.putMarker(openKey, String(open + 1));
    await tx.putMarker(`support:${r.id}`, JSON.stringify({ opener: r.issuer, at: r.issued_at, state: "open" } satisfies Ticket));
    return;
  }
  const t = b.ticket ? await read(tx, b.ticket) : undefined;
  if (!t) throw rule("support_ticket_unknown", `${b.ticket} is not a ticket in this log`);
  if (b.act === "reply") {
    if (!isOperator) throw rule("support_reply_wrong_issuer", `${r.issuer} is not the operator (${env.operator ?? "none set"}): only the operator answers a ticket`);
    if (t.state !== "open") throw rule("support_closed", "the ticket is closed");
    if (!t.firstReply) await tx.putMarker(`support:${b.ticket}`, JSON.stringify({ ...t, firstReply: r.issued_at }));
    return;
  }
  if (b.act === "close") {
    if (!isOperator && r.issuer !== t.opener) throw rule("support_close_wrong_issuer", "a ticket is closed by the operator or by the one who opened it");
    if (t.state !== "open") throw rule("support_closed", "the ticket is already closed");
    await tx.putMarker(`support:${b.ticket}`, JSON.stringify({ ...t, state: "closed" }));
    await tx.putMarker(`support_open:${t.opener}`, String(Math.max(0, Number((await tx.getMarker(`support_open:${t.opener}`)) ?? 1) - 1)));
    return;
  }
  if (b.act === "rating") {
    if (r.issuer !== t.opener) throw rule("support_rating_not_opener", "only the one who opened a ticket rates the answer");
    if (t.state !== "closed") throw rule("support_rating_not_closed", "a ticket is rated once it is closed");
    if (t.rated) throw rule("support_rated", "a ticket is rated once");
    await tx.putMarker(`support:${b.ticket}`, JSON.stringify({ ...t, rated: true }));
    return;
  }
  throw rule("support_bad_act", `unknown act ${b.act}`);
}

export interface SupportStatus {
  at: string;
  targetHours: number;
  tickets: { total: number; open: number; closed: number; openedLast30Days: number };
  firstReply: { answered: number; medianHours: number | null; withinTarget: number; shareWithinTarget: number | null; overdueOpen: number };
  satisfaction: { ratings: number; mean: number | null; fiveOrFour: number; oneOrTwo: number } | null;
  method: string;
}

export const SUPPORT_METHOD = `Tickets are support records of act ticket; a ticket is answered when the operator's first reply is signed; the response time is that reply's time less the ticket's, and the median is over answered tickets. The share within target counts first replies within ${SUPPORT_TARGET_HOURS} hours. Overdue open tickets are open ones older than ${SUPPORT_TARGET_HOURS} hours with no reply. Satisfaction is the mean of the 1 to 5 ratings given by the people who opened closed tickets; it is null until someone rates, and a rating is voluntary, so it describes those who rated.`;

/** The status page's figures, from the support records alone. */
export function supportStatus(records: AspRecord[], at: string): SupportStatus {
  const t = Date.parse(at);
  const tickets = new Map<string, { at: number; first?: number; closed: boolean }>();
  const scores: number[] = [];
  const sorted = [...records].filter((r) => r.type === "asp.support/v0.2" && Date.parse(r.issued_at) <= t).sort((a, b) => Date.parse(a.issued_at) - Date.parse(b.issued_at));
  for (const r of sorted) {
    const b = r.body as { act: string; ticket?: string; score?: number };
    const when = Date.parse(r.issued_at);
    if (b.act === "ticket") tickets.set(r.id, { at: when, closed: false });
    else if (b.ticket && tickets.has(b.ticket)) {
      const k = tickets.get(b.ticket)!;
      if (b.act === "reply" && k.first === undefined) k.first = when;
      else if (b.act === "close") k.closed = true;
      else if (b.act === "rating" && typeof b.score === "number") scores.push(b.score);
    }
  }
  const all = [...tickets.values()];
  const hours = all.filter((x) => x.first !== undefined).map((x) => (x.first! - x.at) / 3_600_000).sort((a, b) => a - b);
  const within = hours.filter((h) => h <= SUPPORT_TARGET_HOURS).length;
  const median = hours.length ? Math.round((hours.length % 2 ? hours[(hours.length - 1) / 2] : (hours[hours.length / 2 - 1] + hours[hours.length / 2]) / 2) * 10) / 10 : null;
  return {
    at, targetHours: SUPPORT_TARGET_HOURS,
    tickets: { total: all.length, open: all.filter((x) => !x.closed).length, closed: all.filter((x) => x.closed).length, openedLast30Days: all.filter((x) => t - x.at <= 30 * DAY).length },
    firstReply: { answered: hours.length, medianHours: median, withinTarget: within, shareWithinTarget: hours.length ? Math.round((within / hours.length) * 1000) / 1000 : null, overdueOpen: all.filter((x) => !x.closed && x.first === undefined && t - x.at > SUPPORT_TARGET_HOURS * 3_600_000).length },
    satisfaction: scores.length ? { ratings: scores.length, mean: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100, fiveOrFour: scores.filter((s) => s >= 4).length, oneOrTwo: scores.filter((s) => s <= 2).length } : null,
    method: SUPPORT_METHOD,
  };
}
