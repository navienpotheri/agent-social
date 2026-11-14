/**
 * Third-party abuse reports (register row H3; spec-delta S430). A site or a person an agent harmed has no passport here and cannot use the market's report (which needs a passport and a deposit). It files an
 * `abuse_report` as its own did:web identity, signing with a key it names in the record. The log cannot fetch the reporter's DID document (replay stays offline), so the operator does at admission, checks the key
 * and the document's hash, and countersigns; the log requires that countersignature. Rate limits keep it from becoming a harassment tool: 5 reports a day for one reporter and one per accused a week.
 * A report is a lead for the Registry and the Courts: it has no automatic effect on the accused.
 */
import { AspError, type AspRecord } from "@agent-social/asp-core";
import type { LogTx } from "./store.ts";

const rule = (name: string, message: string) => new AspError("GUARD_FAILED", message, name);
const DAY = 86_400_000;
export const ABUSE_PER_DAY = 5;
export const ABUSE_PER_ACCUSED_DAYS = 7;
const MAX_LISTED = 200;

export interface AbuseEnv { operator?: string; cosignedBy(r: AspRecord, did: string | undefined): boolean }
export interface AbuseEntry { id: string; reporter: string; kind: string; at: string }

export async function projectAbuseReport(tx: LogTx, r: AspRecord, env: AbuseEnv): Promise<void> {
  const b = r.body as { accused: string; kind: string; reporter_key: { id: string; public_key: string }; proof: { url: string } };
  if (r.prev !== null) throw rule("abuse_not_chained", "an abuse report starts its own chain (prev is null)");
  if (!r.issuer.startsWith("did:web:")) throw rule("abuse_reporter_not_web", "a reporter is a did:web identity: the proof of control is the domain's own DID document");
  if (await tx.getPassport(r.issuer)) throw rule("abuse_reporter_has_passport", `${r.issuer} has a passport here: it reports through the market's report, not this route`);
  if (r.sig.kid !== b.reporter_key.id || !b.reporter_key.id.startsWith(`${r.issuer}#`)) throw rule("abuse_key_not_reporters", "the record is signed with the key it names, and that key's id is under the reporter's DID");
  if (!env.operator || !env.cosignedBy(r, env.operator)) throw rule("abuse_not_admitted", `the operator (${env.operator ?? "none set"}) countersigns a report after it checks the reporter's DID document`);
  const accused = await tx.getPassport(b.accused);
  if (!accused) throw rule("abuse_accused_unknown", `${b.accused} has no passport in this log`);
  if (b.accused === r.issuer) throw rule("abuse_self", "a reporter does not report itself");
  const now = Date.parse(r.issued_at);
  const pairKey = `abuse_pair:${r.issuer}|${b.accused}`;
  const last = Number((await tx.getMarker(pairKey)) ?? 0);
  if (last && now < last + ABUSE_PER_ACCUSED_DAYS * DAY) throw rule("abuse_repeat", `${r.issuer} already reported ${b.accused} in the last ${ABUSE_PER_ACCUSED_DAYS} days: add to that report instead`);
  const dayKey = `abuse_day:${r.issuer}|${r.issued_at.slice(0, 10)}`;
  const today = Number((await tx.getMarker(dayKey)) ?? 0);
  if (today >= ABUSE_PER_DAY) throw rule("abuse_rate", `${r.issuer} has filed ${today} reports today; the limit is ${ABUSE_PER_DAY} a day`);
  await tx.putMarker(pairKey, String(now));
  await tx.putMarker(dayKey, String(today + 1));
  const listKey = `abuse_about:${b.accused}`;
  const list = JSON.parse((await tx.getMarker(listKey)) ?? "[]") as AbuseEntry[];
  list.push({ id: r.id, reporter: r.issuer, kind: b.kind, at: r.issued_at });
  await tx.putMarker(listKey, JSON.stringify(list.slice(-MAX_LISTED)));
}
