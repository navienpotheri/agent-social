/**
 * `asp abuse due` (register row H4; spec-delta S1457; owner decision of 2026-11-21, H4 approved as recommended): the operator's remedy for an outside victim has a clock. A credible report of abuse gets a takedown or
 * a suspension within 2 working days, and a written response within 7 days. The remedy itself is built (DK530, S952: an upheld finding names the operator's remedy; no credits are paid to an outside party). This reads the
 * log and says, for every admitted report, where each clock stands, so a report cannot sit unseen:
 *   - ACTION (2 working days after the report): done when the Registrar's interim suspension of the accused is in the log after the report, or when the case has a finding (a dismissal needs none; an upheld finding names its
 *     remedy); otherwise due on a date, or overdue;
 *   - RESPONSE (7 days after the report): done when the case has a finding with its reasons, which is the written response the accused's page and the reporter can read; otherwise due on a date, or overdue.
 * Working days are Monday to Friday in UTC; the operator's holidays are not known to the log, so the date is the latest and the operator may act sooner. Nothing is sent to anyone by this command.
 */
import type { LogHandle } from "@agent-social/asp-package";

export interface DueRow { report: string; accused: string; reporter: string; kind: string; filedAt: string; action: ClockState; response: ClockState; outcome?: string }
export interface ClockState { state: "done" | "not_needed" | "due" | "overdue"; due: string; doneAt?: string; how?: string }
export const ACTION_WORKING_DAYS = 2;
export const RESPONSE_DAYS = 7;

const DAY = 86_400_000;
/** The moment `n` working days (Monday to Friday, UTC) after `from`, at the same time of day. */
export function addWorkingDays(from: string, n: number): string {
  let t = Date.parse(from);
  for (let left = n; left > 0;) { t += DAY; const wd = new Date(t).getUTCDay(); if (wd !== 0 && wd !== 6) left--; }
  return new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
}
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

interface Seen { type: string; issued_at: string; body: Record<string, unknown>; issuer: string; id: string }

/** Pure: the clocks for each report, from the records of the log. */
export function abuseClocks(records: Seen[], now: string): DueRow[] {
  const reports = records.filter((r) => r.type === "asp.abuse_report/v0.2");
  const cases = records.filter((r) => r.type === "asp.court_act/v0.2" && r.body.act === "abuse_case");
  const rulings = records.filter((r) => r.type === "asp.court_act/v0.2" && r.body.act === "abuse_ruling");
  const suspensions = records.filter((r) => r.type === "asp.registry_act/v0.2" && r.body.act === "identity_suspension");
  const nowMs = Date.parse(now);
  const rows: DueRow[] = [];
  for (const rep of reports) {
    const accused = String(rep.body.accused);
    const c = cases.find((x) => x.body.report === rep.id);
    const ruling = c ? rulings.find((x) => x.body.case === c.id) : undefined;
    const susp = suspensions.find((s) => s.body.holder === accused && Date.parse(s.issued_at) >= Date.parse(rep.issued_at));
    const actionDue = addWorkingDays(rep.issued_at, ACTION_WORKING_DAYS), responseDue = iso(Date.parse(rep.issued_at) + RESPONSE_DAYS * DAY);
    const clock = (due: string, done?: { at: string; how: string }, notNeeded?: { at: string; how: string }): ClockState =>
      done ? { state: "done", due, doneAt: done.at, how: done.how } : notNeeded ? { state: "not_needed", due, doneAt: notNeeded.at, how: notNeeded.how } : { state: nowMs > Date.parse(due) ? "overdue" : "due", due };
    const dismissed = ruling?.body.finding === "dismissed";
    const action = clock(actionDue,
      ruling && ruling.body.finding === "upheld" ? { at: ruling.issued_at, how: `upheld, remedy ${String(ruling.body.remedy ?? "not named")}` } : susp ? { at: susp.issued_at, how: "the accused was suspended" } : undefined,
      dismissed ? { at: ruling!.issued_at, how: "the finding is dismissed: nothing to take down" } : undefined);
    const response = clock(responseDue, ruling ? { at: ruling.issued_at, how: `${String(ruling.body.finding)} with reasons` } : undefined);
    rows.push({ report: rep.id, accused, reporter: rep.issuer, kind: String(rep.body.kind), filedAt: rep.issued_at, action, response, ...(ruling ? { outcome: `${String(ruling.body.finding)}${ruling.body.remedy ? `, remedy ${String(ruling.body.remedy)}` : ""}` } : {}) });
  }
  return rows.sort((a, b) => a.filedAt.localeCompare(b.filedAt));
}

export async function readAbuseRecords(log: LogHandle): Promise<Seen[]> {
  const out: Seen[] = [];
  const want = new Set(["asp.abuse_report/v0.2", "asp.court_act/v0.2", "asp.registry_act/v0.2"]);
  for (let after = 0; ;) {
    const page = await log.log.since(after, 500);
    if (!page.length) break;
    for (const s of page) { after = s.seq; if (want.has(s.record.type)) out.push({ type: s.record.type, issued_at: s.record.issued_at, body: s.record.body as Record<string, unknown>, issuer: s.record.issuer, id: s.id }); }
  }
  return out;
}

export async function abuseDueCmd(o: { log: LogHandle; io: { out: (l: string) => void }; now: () => string; json?: boolean; all?: boolean }): Promise<number> {
  const rows = abuseClocks(await readAbuseRecords(o.log), o.now());
  const open = rows.filter((r) => r.action.state === "due" || r.action.state === "overdue" || r.response.state === "due" || r.response.state === "overdue");
  const shown = o.all ? rows : open;
  const overdue = rows.filter((r) => r.action.state === "overdue" || r.response.state === "overdue");
  if (o.json) { o.io.out(JSON.stringify({ now: o.now(), total: rows.length, open: open.length, overdue: overdue.length, reports: shown }, null, 2)); return overdue.length ? 1 : 0; }
  o.io.out(`${rows.length} admitted abuse report(s); ${open.length} with a clock still running, ${overdue.length} overdue (a takedown or suspension within ${ACTION_WORKING_DAYS} working days, a written response within ${RESPONSE_DAYS} days)`);
  const word = (c: ClockState) => c.state === "done" ? `done (${c.how})` : c.state === "not_needed" ? `not needed (${c.how})` : c.state === "overdue" ? `OVERDUE since ${c.due}` : `due ${c.due}`;
  for (const r of shown) {
    o.io.out(`  ${r.report.slice(0, 15)}  ${r.kind}  against ${r.accused}  filed ${r.filedAt}`);
    o.io.out(`    action    ${word(r.action)}`);
    o.io.out(`    response  ${word(r.response)}`);
  }
  if (overdue.length) o.io.out("An overdue report is the operator's to act on today: asp house stop / the Registrar's suspension, or asp abuse refer and rule; then write the response (docs/incident-runbook.md section 3).");
  return overdue.length ? 1 : 0;
}
