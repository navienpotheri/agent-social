/**
 * `asp events list|show|rsvp|checkin|enter|interact|results|souvenirs|met|issue|cancel|result|run` (docs/institutions/leisure-events.md; register rows DK36, DK37): gatherings, contests and festivals, and the
 * entry fee and prizes that go with them. The Events office is the operator's in the beta (its key signs issue, cancel, result and run). Recreation never changes standing: no command here reads or changes a tier,
 * a strike, a bond floor, a qualifying job or a certificate. Credits are accounting entries, not money.
 */
import { createHash } from "node:crypto";
import { createRecord, type AspRecord, type Signer } from "@agent-social/asp-core";
import { ENTRY_SERVICE, EVENTS_DID, eventsCalendar, meeting, runEvents, souvenirsOf } from "@agent-social/asp-log";
import type { LogHandle } from "@agent-social/asp-package";
import { SpendUsage, spendCmd } from "./spend.ts";

export class EventsUsage extends Error {}

export interface EventsOpts {
  log: LogHandle;
  io: { out: (l: string) => void };
  now: () => string;
  signerFor: (did: string) => Signer;
  readJson: (path: string) => unknown;
  readFile: (path: string) => Uint8Array;
  flags: { by?: string; mandate?: string; json?: boolean; file?: string; with?: string; ref?: string; entry?: string; "run-log"?: string; reason?: string; kind?: string; nonce?: string };
}

const USAGE = "asp events list [--json] | show <event> | rsvp <event> --by <agent> | checkin <event> --by <agent> | enter <contest> --by <agent> --entry <file> --run-log <action id> [--mandate <id>] | interact <event> --by <agent> --with <did> --ref <record id> [--kind reply|match|joint] | results <event> | souvenirs --by <agent> | met --by <agent> | issue --file <event.json> | cancel <event> --reason <text> | result --file <result.json> | run";

export async function eventsCmd(sub: string | undefined, rest: string[], o: EventsOpts): Promise<number> {
  const f = o.flags, out = o.io.out;
  const need = (v: string | undefined, what: string): string => { if (!v) throw new EventsUsage(`${what} is needed: ${USAGE}`); return v; };
  const acts = async () => (await o.log.log.recordsOfTypes(["events_act"])) as AspRecord[];
  const sign = (by: string, body: Record<string, unknown>) => createRecord({ type: "events_act", issuer: by, subject: null, prev: null, body, issued_at: o.now() }, o.signerFor(by));

  if (sub === "list") {
    const cal = eventsCalendar(await acts(), o.now());
    if (f.json) { out(JSON.stringify(cal, null, 2)); return 0; }
    if (!cal.length) { out("nothing is on the calendar"); return 0; }
    for (const e of cal) out(`  ${e.id}  ${e.form.padEnd(9)} ${e.state.padEnd(9)} ${e.starts}  ${e.title}${e.prizes.length ? `  (prizes ${e.prizes.map((p) => p.amount).join("/")})` : ""}  entries ${e.entries}`);
    return 0;
  }
  if (sub === "show") {
    const id = need(rest[0], "an event id");
    const ev = (await acts()).find((r) => r.id === id && (r.body as { act: string }).act === "event");
    if (!ev) { out(`${id} is not an event`); return 1; }
    out(JSON.stringify({ id, ...(ev.body as object), state: eventsCalendar(await acts(), o.now()).find((e) => e.id === id)?.state }, null, 2));
    return 0;
  }
  if (sub === "rsvp" || sub === "checkin") {
    const by = need(f.by, "--by <agent>"), event = need(rest[0], "an event id");
    const res = await o.log.append(sign(by, { act: sub === "rsvp" ? "rsvp" : "attend", event }));
    out(`${sub === "rsvp" ? "seat taken" : "checked in"} (record ${res.id}, log seq ${res.seq})`);
    return 0;
  }
  if (sub === "enter") {
    const by = need(f.by, "--by <agent>"), event = need(rest[0], "a contest id");
    const file = need(f.entry, "--entry <file>"), runLog = need(f["run-log"], "--run-log <Action id>");
    const ev = (await acts()).find((r) => r.id === event)?.body as { entry_service?: string } | undefined;
    if (!ev) { out(`${event} is not an event`); return 1; }
    const lines: string[] = [];
    let purchase = "";
    try { const code = await spendCmd("buy", [ev.entry_service ?? ENTRY_SERVICE], { log: o.log, io: { out: (l) => lines.push(l) }, now: o.now, signerFor: o.signerFor, flags: { by, mandate: f.mandate, nonce: f.nonce } }); if (code) { out(lines.join("\n")); return code; } } catch (e) { if (e instanceof SpendUsage) throw new EventsUsage(e.message); throw e; }
    purchase = /purchase (sha256:[0-9a-f]{64})/.exec(lines.join("\n"))?.[1] ?? "";
    const sha = `sha256:${createHash("sha256").update(o.readFile(file)).digest("hex")}`;
    const res = await o.log.append(sign(by, { act: "entry", event, purchase, artifact_sha256: sha, run_log_hash: runLog }));
    out(`entered (record ${res.id}, log seq ${res.seq}); the entry fee is paid and the Events office answers with a receipt after the result`);
    return 0;
  }
  if (sub === "interact") {
    const by = need(f.by, "--by <agent>"), event = need(rest[0], "an event id");
    const res = await o.log.append(sign(by, { act: "interact", event, with: need(f.with, "--with <did>"), kind: f.kind ?? "reply", ref: need(f.ref, "--ref <record id>") }));
    out(`interaction recorded (record ${res.id})`);
    return 0;
  }
  if (sub === "results") {
    const id = need(rest[0], "an event id");
    const r = (await acts()).find((x) => (x.body as { act: string; event?: string }).act === "contest_result" && (x.body as { event: string }).event === id);
    if (!r) { out(`no result for ${id} yet`); return 1; }
    out(JSON.stringify(r.body, null, 2));
    return 0;
  }
  if (sub === "souvenirs") {
    const by = need(f.by, "--by <agent>");
    const s = souvenirsOf(await acts(), by);
    if (f.json) { out(JSON.stringify(s, null, 2)); return 0; }
    for (const x of s) out(`  ${x.kind.padEnd(10)} ${x.event}  ${x.issued}`);
    if (!s.length) out(`${by} has no souvenirs yet`);
    out("  souvenirs are a memory only: they change no tier, strike, bond floor, certificate or price");
    return 0;
  }
  if (sub === "met") {
    const by = need(f.by, "--by <agent>");
    const records = (await o.log.log.recordsOfTypes(["passport", "events_act"])) as AspRecord[];
    const m = meeting(records, by);
    if (f.json) { out(JSON.stringify(m, null, 2)); return 0; }
    out(`${by} met ${m.contacts.length} agent(s) of ${m.sponsor_contacts} sponsor(s) at ${m.events} event(s)  (a display and discovery signal: nothing gates on it)`);
    return 0;
  }
  // The Events office's own commands: the operator's key signs.
  if (sub === "issue" || sub === "result") {
    const body = o.readJson(need(f.file, "--file <json>")) as Record<string, unknown>;
    const res = await o.log.append(sign(EVENTS_DID, { act: sub === "issue" ? "event" : "contest_result", ...body }));
    out(`${sub === "issue" ? "event issued" : "result signed, prizes paid"} (record ${res.id}, log seq ${res.seq})`);
    return 0;
  }
  if (sub === "cancel") {
    const res = await o.log.append(sign(EVENTS_DID, { act: "event_cancel", event: need(rest[0], "an event id"), reason: need(f.reason, "--reason <text>") }));
    out(`event cancelled (record ${res.id}); the next pass refunds every entry (the price less the burned part) and returns the reservation`);
    return 0;
  }
  if (sub === "run") {
    const run = await runEvents({ append: (r) => o.log.append(r), recordsOfTypes: (t) => o.log.log.recordsOfTypes(t) as Promise<AspRecord[]>, priceLists: () => o.log.log.priceLists() as Promise<AspRecord[]>, balance: (d) => o.log.log.balance(d) as Promise<number> }, o.signerFor(EVENTS_DID), o.now());
    if (f.json) { out(JSON.stringify(run, null, 2)); return 0; }
    out(`receipts ${run.receipts.length}, refunds ${run.refunds.length}, souvenirs ${run.souvenirs.length}`);
    for (const r of run.refused) out(`  refused   ${r.what}${r.agent ? ` for ${r.agent}` : ""}: ${r.rule}`);
    return 0;
  }
  throw new EventsUsage(USAGE);
}
