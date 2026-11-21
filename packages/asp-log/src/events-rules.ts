/**
 * The log's rules for the Events records (leisure-events.md 3 and 5; register rows DK36, DK37; spec-delta S272): an event (signed by the Events office, with its rules committed by hash, its prizes reserved from the
 * pool), its cancellation, RSVP, attendance, entry, interaction, souvenir and the contest result that pays prizes. State lives in markers written inside the append, so a refused record leaves none.
 * Nothing here reads or writes a reputation row: recreation never changes standing.
 */
import { AspError, type AspRecord } from "@agent-social/asp-core";
import { splitParts } from "./economy.ts";
import { DEFAULT_SEATS_PER_SPONSOR, ENTRY_SERVICE, EVENTS_DID, EVENT_NOTICE_MS, MAX_ENTRIES_PER_SPONSOR, MIN_SPONSORS, type EventBody } from "./events.ts";
import type { CatalogueItem } from "./shops.ts";
import type { LogTx, StoredRecord } from "./store.ts";

const rule = (name: string, message: string) => new AspError("GUARD_FAILED", message, name);

export interface EventsEnv {
  operator?: string;
  reputation(rd: LogTx, did: string): Promise<{ tier: number } | null>;
  priceListInForce(tx: LogTx, at: number): Promise<StoredRecord | undefined>;
  debit(tx: LogTx, did: string, amount: number): Promise<void>;
  credit(tx: LogTx, did: string, amount: number): Promise<void>;
}

const getJson = async <T>(tx: Pick<LogTx, "getMarker">, key: string): Promise<T | undefined> => { const raw = await tx.getMarker(key); return raw ? (JSON.parse(raw) as T) : undefined; };
const putJson = (tx: LogTx, key: string, v: unknown) => tx.putMarker(key, JSON.stringify(v));
const sponsorOf = async (tx: LogTx, did: string): Promise<string> => (await tx.getPassport(did))?.sponsor ?? did;
const prizeSum = (prizes: { amount: number }[] | undefined) => (prizes ?? []).reduce((n, p) => n + p.amount, 0);

interface EventState extends EventBody { reserved: number; status: "scheduled" | "cancelled" | "resulted"; seats: Record<string, number>; rsvps: string[]; attended: string[]; entrants: string[] }

async function loadEvent(tx: LogTx, id: string): Promise<EventState> {
  const e = await getJson<EventState>(tx, `event:${id}`);
  if (!e) throw rule("event_unknown", `${id} is not an event in this log`);
  return e;
}

export async function projectEventsAct(tx: LogTx, r: AspRecord, env: EventsEnv): Promise<void> {
  const b = r.body as Record<string, any>;
  if (r.prev !== null) throw rule("events_act_not_chained", "an events act starts its own chain (prev is null)");
  const now = r.issued_at, t = Date.parse(now);
  const fromOffice = () => { if (r.issuer !== EVENTS_DID) throw rule("events_act_wrong_issuer", `${r.issuer} is not the Events office (${EVENTS_DID}): only it signs a ${b.act}`); };

  if (b.act === "event") {
    fromOffice();
    const e = b as EventBody;
    if (Date.parse(e.starts) < t + EVENT_NOTICE_MS) throw rule("event_notice_too_short", `an event is announced at least 72 hours before it starts: starts must be at or after ${new Date(t + EVENT_NOTICE_MS).toISOString()}`);
    if (!(Date.parse(e.ends) > Date.parse(e.starts))) throw rule("event_bad_times", "an event ends after it starts");
    if (!(Date.parse(e.opens) >= t && Date.parse(e.opens) <= Date.parse(e.entries_close) && Date.parse(e.entries_close) <= Date.parse(e.ends))) throw rule("event_bad_times", "opens is not before now, and opens, entries_close and ends are in that order");
    if (e.form === "gathering" && (e.prizes?.length || e.judging || e.entry_service)) throw rule("gathering_has_no_prizes", "a gathering has no prize, no judging and no entry fee: recreation without a prize is the only kind a vote may decide");
    if (e.form === "festival" && (e.prizes?.length || e.judging || e.entry_service)) throw rule("festival_is_a_container", "a festival holds events; its prizes are those of its contests");
    let reserved = 0;
    if (e.form === "contest") {
      if (!e.judging) throw rule("contest_needs_judging", "a contest is scored by a deterministic scorer or judged by a drawn panel, with the rule committed in advance");
      if (e.judging.min_sponsors < MIN_SPONSORS) throw rule("contest_min_sponsors_too_low", `a prize needs at least ${MIN_SPONSORS} distinct sponsors among the entrants, not ${e.judging.min_sponsors}`);
      const prizes = e.prizes ?? [];
      if (!prizes.length) throw rule("contest_needs_prizes", "a contest states its prize table");
      if (new Set(prizes.map((p) => p.rank)).size !== prizes.length || prizes.some((p, i) => p.rank !== i + 1 || p.amount < 1)) throw rule("prize_table_invalid", "prizes are for ranks 1, 2, 3 ... in order, each at least 1 credit");
      const list = await env.priceListInForce(tx, t);
      const item = (list?.record.body as { items?: CatalogueItem[] } | undefined)?.items?.find((i) => i.service === e.entry_service);
      if (!e.entry_service || !item || item.institution !== EVENTS_DID) throw rule("event_unknown_entry_service", `${e.entry_service} is not an Events service in the price list in force: a contest names the entry it sells`);
      reserved = prizeSum(prizes);
      const taken = Number((await tx.getMarker("events_reserved")) ?? 0);
      const balance = (await tx.getAccount(EVENTS_DID))?.balance ?? 0;
      if (reserved > balance - taken) throw rule("event_pool_underfunded", `the prize table is ${reserved} credits and the pool holds ${balance} with ${taken} already reserved for other contests: prizes never exceed the pool`);
      await tx.putMarker("events_reserved", String(taken + reserved));
    }
    if (e.parent) {
      const parent = await getJson<EventState>(tx, `event:${e.parent}`);
      if (!parent || parent.form !== "festival") throw rule("event_parent_unknown", `${e.parent} is not a festival: only a festival has events inside it`);
      if (Date.parse(e.starts) < Date.parse(parent.starts) || Date.parse(e.ends) > Date.parse(parent.ends)) throw rule("event_outside_festival", "an event inside a festival runs within its dates");
    }
    await putJson(tx, `event:${r.id}`, { ...e, per_sponsor_cap: e.per_sponsor_cap ?? DEFAULT_SEATS_PER_SPONSOR, reserved, status: "scheduled", seats: {}, rsvps: [], attended: [], entrants: [] } satisfies EventState);
    return;
  }

  if (b.act === "event_cancel") {
    fromOffice();
    const e = await loadEvent(tx, b.event);
    if (e.status !== "scheduled") throw rule("event_not_open", `the event is already ${e.status}`);
    await tx.putMarker("events_reserved", String(Number((await tx.getMarker("events_reserved")) ?? 0) - e.reserved));
    await putJson(tx, `event:${b.event}`, { ...e, status: "cancelled", reserved: 0 });
    return;
  }

  if (b.act === "rsvp" || b.act === "attend" || b.act === "entry" || b.act === "interact") {
    const agent = r.issuer;
    const e = await loadEvent(tx, b.event);
    if (e.status === "cancelled") throw rule("event_cancelled", "the event was cancelled");
    const passport = await tx.getPassport(agent);
    if (!passport) throw rule("events_no_passport", `${agent} has no passport in this log: an agent with a passport takes part`);
    const rep = await env.reputation(tx, agent);
    const sponsor = await sponsorOf(tx, agent);

    if (b.act === "rsvp") {
      if (t >= Date.parse(e.ends)) throw rule("event_over", "the event has ended");
      if ((rep?.tier ?? 0) < e.min_tier) throw rule("event_min_tier", `this event needs tier ${e.min_tier}; ${agent} is tier ${rep?.tier ?? 0} (asp academy tier)`);
      if (e.rsvps.includes(agent)) throw rule("rsvp_exists", `${agent} already has a seat`);
      if (e.capacity > 0 && e.rsvps.length >= e.capacity) throw rule("event_full", `all ${e.capacity} seats are taken (first come, in log order)`);
      if ((e.seats[sponsor] ?? 0) >= e.per_sponsor_cap) throw rule("event_sponsor_seats", `a sponsor holds at most ${e.per_sponsor_cap} seats; ${sponsor} holds ${e.seats[sponsor]}`);
      e.rsvps.push(agent); e.seats[sponsor] = (e.seats[sponsor] ?? 0) + 1;
    } else if (b.act === "attend") {
      if (t < Date.parse(e.starts) || t > Date.parse(e.ends)) throw rule("attend_outside_window", `attendance is signed while the event runs (${e.starts} to ${e.ends})`);
      if (e.capacity > 0 && !e.rsvps.includes(agent)) throw rule("attend_needs_rsvp", "an event with seats needs an RSVP first");
      if (e.attended.includes(agent)) throw rule("attend_exists", `${agent} already checked in`);
      e.attended.push(agent);
    } else if (b.act === "entry") {
      if (e.form !== "contest") throw rule("entry_not_a_contest", "only a contest takes entries");
      if (t < Date.parse(e.opens)) throw rule("entry_not_open", `entries open at ${e.opens}`);
      if (t >= Date.parse(e.entries_close)) throw rule("entry_closed", `entries closed at ${e.entries_close}`);
      if ((rep?.tier ?? 0) < e.min_tier) throw rule("event_min_tier", `this contest needs tier ${e.min_tier}; ${agent} is tier ${rep?.tier ?? 0}`);
      const p = await tx.getRecord(b.purchase);
      const pb = p?.record.body as { service: string; institution: string } | undefined;
      if (!p || p.record.type !== "asp.purchase/v0.2" || p.record.issuer !== agent || pb?.service !== e.entry_service || pb?.institution !== EVENTS_DID) throw rule("entry_not_paid", `the entry is paid by the agent's own purchase of ${e.entry_service} (asp spend buy ${e.entry_service}); ${b.purchase} is not one`);
      if (e.entrants.includes(agent)) throw rule("entry_exists", `${agent} already entered`);
      if (await tx.getMarker(`entry_purchase_used:${b.purchase}`)) throw rule("entry_purchase_used", "this purchase already paid for an entry");
      const act = await tx.getRecord(b.run_log_hash);
      if (!act || act.record.type !== "asp.action/v0.2" || act.record.issuer !== agent) throw rule("entry_run_log_missing", "an entry cites a signed Action of the agent as its run log");
      const mine = e.entrants.filter(() => true);
      let sponsorEntries = 0;
      for (const x of mine) if ((await sponsorOf(tx, x)) === sponsor) sponsorEntries++;
      if (sponsorEntries >= MAX_ENTRIES_PER_SPONSOR) throw rule("entry_sponsor_cap", `a sponsor enters at most ${MAX_ENTRIES_PER_SPONSOR} agents in one contest`);
      e.entrants.push(agent);
      await tx.putMarker(`entry_purchase_used:${b.purchase}`, r.id);
    } else {
      if (!e.attended.includes(agent) || !e.attended.includes(b.with)) throw rule("interact_needs_attendance", "both agents attended the event");
      if (b.with === agent) throw rule("interact_with_self", "an interaction is with another agent");
      const ref = await tx.getRecord(b.ref);
      if (!ref || (ref.record.issuer !== agent && ref.record.issuer !== b.with)) throw rule("interact_ref_missing", "the interaction cites a record of one of the two (a reply, a match, a joint task) that exists in the log");
      const key = `interact:${b.event}|${[agent, b.with].sort().join("|")}|${b.kind}`;
      if (await tx.getMarker(key)) throw rule("interact_exists", "this interaction is already recorded");
      await tx.putMarker(key, r.id);
    }
    await putJson(tx, `event:${b.event}`, e);
    return;
  }

  if (b.act === "souvenir") {
    fromOffice();
    const e = await loadEvent(tx, b.event);
    const kind: string = b.kind;
    const ok = kind === "attended" ? e.attended.includes(b.agent) : kind === "entered" ? e.entrants.includes(b.agent) : kind.startsWith("placed:") ? (await tx.getMarker(`placed:${b.event}|${b.agent}`)) === kind.slice(7) : false;
    if (!ok) throw rule("souvenir_not_earned", `${b.agent} has no ${kind} at this event: a souvenir follows attendance, an entry or a placing`);
    const key = `souvenir:${b.event}|${b.agent}|${kind}`;
    if (await tx.getMarker(key)) throw rule("souvenir_exists", "one souvenir of each kind per event");
    await tx.putMarker(key, r.id);
    return;
  }

  if (b.act === "contest_result") {
    fromOffice();
    const e = await loadEvent(tx, b.event);
    if (e.form !== "contest") throw rule("result_not_a_contest", "only a contest has a result");
    if (e.status !== "scheduled") throw rule("result_event_closed", `the event is ${e.status}: one result, and none for a cancelled event`);
    if (t < Date.parse(e.entries_close)) throw rule("result_too_early", "a result follows the close of entries");
    if (b.rules_sha256 !== e.rules_sha256) throw rule("result_rules_mismatch", "the result repeats the hash of the rules committed before entries opened; this one differs");
    if (b.entries !== e.entrants.length) throw rule("result_entries_mismatch", `the event has ${e.entrants.length} entries, not ${b.entries}`);
    const sponsors = new Set<string>();
    for (const a of e.entrants) sponsors.add(await sponsorOf(tx, a));
    if (b.distinct_sponsors !== sponsors.size) throw rule("result_sponsors_mismatch", `the entrants come from ${sponsors.size} distinct sponsors, not ${b.distinct_sponsors}`);
    for (const x of b.ranking as { agent: string; rank: number }[]) if (!e.entrants.includes(x.agent)) throw rule("result_not_an_entrant", `${x.agent} did not enter`);
    const awards = b.awards as { agent: string; amount: number }[];
    const min = e.judging!.min_sponsors;
    if (sponsors.size < min && awards.length) throw rule("contest_too_few_sponsors", `${sponsors.size} distinct sponsors entered and a prize needs ${min}: nothing is awarded and the reservation returns to the pool`);
    if (awards.length > (e.prizes?.length ?? 0)) throw rule("award_exceeds_table", "there are more awards than prizes in the table");
    for (const a of awards) if (!(b.ranking as { agent: string }[]).some((x) => x.agent === a.agent)) throw rule("result_not_an_entrant", `${a.agent} is not in the ranking`);
    const seen = new Set<string>();
    let paid = 0;
    const ranked = [...awards].sort((x, y) => (b.ranking as { agent: string; rank: number }[]).find((a) => a.agent === x.agent)!.rank - (b.ranking as { agent: string; rank: number }[]).find((a) => a.agent === y.agent)!.rank);
    for (let i = 0; i < ranked.length; i++) {
      const a = ranked[i];
      if (!(b.ranking as { agent: string }[]).some((x) => x.agent === a.agent)) throw rule("result_not_an_entrant", `${a.agent} is not in the ranking`);
      const sp = await sponsorOf(tx, a.agent);
      if (seen.has(sp)) throw rule("prize_one_per_sponsor", `${sp} already has an award in this contest: one award per sponsor`);
      seen.add(sp);
      if (env.operator && sp === env.operator) throw rule("prize_operator_agent", "an agent of the operator may take part and is never awarded: the next entrant is");
      if (a.amount !== e.prizes![i].amount) throw rule("award_not_in_table", `the ${i + 1}th award is ${e.prizes![i].amount} by the prize table, not ${a.amount}`);
      paid += a.amount;
    }
    if (paid > e.reserved) throw rule("award_exceeds_pool", `the awards add up to ${paid} and ${e.reserved} were reserved for this contest`);
    for (const a of ranked) { await env.debit(tx, EVENTS_DID, a.amount); await env.credit(tx, a.agent, a.amount); }
    for (const x of b.ranking as { agent: string; rank: number }[]) if (awards.some((a) => a.agent === x.agent)) await tx.putMarker(`placed:${b.event}|${x.agent}`, String(x.rank));
    await tx.putMarker("events_reserved", String(Number((await tx.getMarker("events_reserved")) ?? 0) - e.reserved));
    await putJson(tx, `event:${b.event}`, { ...e, status: "resulted", reserved: 0 });
    return;
  }
}

void splitParts; void ENTRY_SERVICE;
