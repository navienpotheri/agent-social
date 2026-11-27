/**
 * The audit export of an organisation (register row DK1374; spec-delta S1417): every signed record that is the organisation's or one of its agents' (sponsored, or in its fleets), with the passports of every signer so
 * the file checks offline, as JSON lines: a manifest line first (the organisation, the range, the count, the hash of the record ids, the log position), then one signed record per line, in log order. The records are
 * the log's own signed form, so nothing is summarised; a security team verifies each signature and the manifest's hash with `verifyAuditExport`. Pure: records in, text out. Not covered (DK1359): sign-ins and roles,
 * which the log does not hold. Credits are accounting entries, not money.
 */
import { createHash } from "node:crypto";
import { resolverFromPassports, verifyRecord, type AspRecord } from "@agent-social/asp-core";

export interface AuditManifest {
  format: "asp.audit-export/v1"; org: string; from: string | null; to: string | null; records: number; passports: number; ids_sha256: string; first_seq: number | null; last_seq: number | null; head_seq: number;
  note: string;
}
export interface Stored { seq: number; id: string; record: AspRecord }

const FIELDS = ["agent", "member", "performer", "principal", "holder", "buyer", "fleet", "to", "contract_party"];
const NOTE = "Every record is the log's own signed form. Check each signature and this manifest with `asp audit-export verify`. Sign-ins and roles are not in the log (DK1359). Credits are accounting entries, not money.";

/**
 * THE one reader of an organisation's signed records (S1417; shared by `asp audit-export` and `asp offboard`): the identities that are the organisation's (itself and every agent it sponsors, found in log order, so an
 * agent sponsored by a sponsored identity counts), its fleets, and the records that belong to it. Two modes: `signed` is every record one of its identities signed (what an offboarding hands over); `involving` adds every
 * record that is about them (a contract, a Mandate or a settlement that names one as performer, principal, agent, holder or member, or a fleet of theirs): the audit view. Pure: records in, records out.
 */
export function readOrgRecords(all: Stored[], org: string, mode: "signed" | "involving"): { identities: string[]; fleets: string[]; records: Stored[] } {
  const ids = new Set<string>([org]);
  const fleets = new Set<string>();
  for (const s of all) {
    const r = s.record;
    if (r.type === "asp.passport/v0.2") { const b = r.body as { did: string; sponsor?: string }; if (ids.has(String(b.sponsor)) || ids.has(r.issuer)) ids.add(b.did); }
    else if (r.type === "asp.fleet/v0.2") { const b = r.body as { did: string; org: string }; if (b.org === org) fleets.add(b.did); }
  }
  const mine = new Set<string>([...ids, ...fleets]);
  const records = all.filter((s) => (mode === "signed" ? ids.has(s.record.issuer) : touches(s.record, mine)));
  return { identities: [...ids], fleets: [...fleets], records };
}
/** The identities and fleets of the organisation (kept for callers that want the scope alone). */
export function orgScope(all: Stored[], org: string): Set<string> { const r = readOrgRecords(all, org, "signed"); return new Set([...r.identities, ...r.fleets]); }

const touches = (r: AspRecord, mine: Set<string>): boolean => {
  if (mine.has(r.issuer) || (r.subject && mine.has(r.subject))) return true;
  const b = r.body as Record<string, unknown>;
  for (const f of FIELDS) { const v = b[f]; if (typeof v === "string" && mine.has(v)) return true; }
  return false;
};

/** The records of the organisation in a range of times (ISO strings, inclusive from, exclusive to) and after a sequence number, with the passports of everyone who signed them. */
export function buildAuditExport(all: Stored[], org: string, o: { from?: string; to?: string; afterSeq?: number; headSeq: number }): { manifest: AuditManifest; lines: string[] } {
  const inRange = (s: Stored) => s.seq > (o.afterSeq ?? 0) && (!o.from || s.record.issued_at >= o.from) && (!o.to || s.record.issued_at < o.to);
  const picked = readOrgRecords(all, org, "involving").records.filter(inRange);
  const signers = new Set<string>();
  for (const s of picked) { signers.add(s.record.issuer); for (const sig of [s.record.sig, ...(s.record.cosigs ?? [])]) signers.add(sig.kid.split("#")[0]); }
  const have = new Set(picked.map((s) => s.id));
  const passports = all.filter((s) => s.record.type === "asp.passport/v0.2" && signers.has((s.record.body as { did: string }).did) && !have.has(s.id));
  const body = [...picked, ...passports].sort((a, b) => a.seq - b.seq);
  const manifest: AuditManifest = {
    format: "asp.audit-export/v1", org, from: o.from ?? null, to: o.to ?? null, records: body.length, passports: passports.length,
    ids_sha256: createHash("sha256").update(body.map((s) => s.id).join("\n")).digest("hex"), first_seq: body[0]?.seq ?? null, last_seq: body[body.length - 1]?.seq ?? null, head_seq: o.headSeq, note: NOTE,
  };
  return { manifest, lines: [JSON.stringify(manifest), ...body.map((s) => JSON.stringify({ seq: s.seq, record: s.record }))] };
}

/** Checks an export offline: the manifest, the count, the hash of the ids, and every record's id and signatures (keys from the passports inside the file). Returns what is wrong, or nothing. */
export function verifyAuditExport(text: string): { ok: boolean; problems: string[]; unverified: { seq: number; kid: string }[]; manifest?: AuditManifest; records: number } {
  const lines = text.split("\n").filter((l) => l.trim());
  const problems: string[] = [];
  let manifest: AuditManifest | undefined;
  try { manifest = JSON.parse(lines[0]) as AuditManifest; } catch { return { ok: false, problems: ["the first line is not a manifest"], unverified: [], records: 0 }; }
  if (manifest.format !== "asp.audit-export/v1") return { ok: false, problems: [`unknown format ${String(manifest.format)}`], unverified: [], records: 0 };
  const recs: { seq: number; record: AspRecord }[] = [];
  for (const [i, l] of lines.slice(1).entries()) { try { recs.push(JSON.parse(l)); } catch { problems.push(`line ${i + 2} is not JSON`); } }
  if (recs.length !== manifest.records) problems.push(`the manifest says ${manifest.records} records, the file has ${recs.length}`);
  const resolve = resolverFromPassports(recs.map((r) => r.record).filter((r) => r.type === "asp.passport/v0.2"));
  const ids: string[] = [];
  const unverified: { seq: number; kid: string }[] = [];
  let last = 0;
  for (const r of recs) {
    if (r.seq <= last) problems.push(`record ${r.seq} is out of order`);
    last = r.seq;
    try { verifyRecord(r.record, resolve); ids.push(r.record.id); } catch (e) {
      const err = e as { code?: string; message: string };
      ids.push(r.record?.id ?? "");
      // a signer whose key is not in the file (the operator or an institution, whose keys the log holds apart from a passport) cannot be checked here: listed, not called wrong
      if (err.code === "UNKNOWN_KEY") unverified.push({ seq: r.seq, kid: /no key for (\S+)/.exec(err.message)?.[1] ?? "?" });
      else problems.push(`record ${r.seq} (${r.record?.id ?? "?"}) does not verify: ${err.message}`);
    }
  }
  if (createHash("sha256").update(ids.join("\n")).digest("hex") !== manifest.ids_sha256) problems.push("the hash of the record ids does not match the manifest: a record was added, removed or changed");
  return { ok: !problems.length, problems, unverified, manifest, records: recs.length };
}
