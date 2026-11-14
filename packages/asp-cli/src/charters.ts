/**
 * `asp charter publish-all | publish | show | index` (register rows IS1 and DK382; spec-delta S480): the twelve charters of docs/institutions published as signed `institution_charter` records (the operator signs, the
 * owner co-signs the founding), each with the hash of its text, so the readable document and the record cannot drift apart; and the charter in force for each institution read back from the log.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cosign, createRecord, type Signer } from "@agent-social/asp-core";
import { FORUM_DID, TREASURY_DID, institutionDid } from "@agent-social/asp-log";
import type { LogHandle } from "@agent-social/asp-package";

export class CharterUsage extends Error {}
export interface CharterFlags { by?: string; "cosign-by"?: string; docs?: string; institution?: string; file?: string; funding?: string; kind?: string; officers?: string; effective?: string; status?: string; reason?: string; version?: string }
export interface CharterOpts { log: LogHandle; io: { out: (l: string) => void }; now: () => string; signerFor: (did: string) => Signer; flags: CharterFlags }

export interface ParsedCharter { title: string; institutions: string[]; text: string; sha256: string; funding: Record<string, string> }

const sha = (t: string) => "sha256:" + createHash("sha256").update(t).digest("hex");
const ACCOUNTS: Record<string, string[]> = {
  treasury: [TREASURY_DID], market: [institutionDid("market")], "bank and insurer": [institutionDid("bank"), institutionDid("insurer")], "shops and services": [institutionDid("shops")],
  registry: [institutionDid("registry")], courts: [institutionDid("courts")], academy: [institutionDid("academy")], clinic: [institutionDid("clinic")],
  "research and the commons": [institutionDid("research")], forum: [FORUM_DID], "leisure and events": [institutionDid("events")], housing: [institutionDid("housing")],
};
const FUNDING_OVERRIDE: Record<string, string> = { [institutionDid("insurer")]: "premiums, and a Treasury top-up the owner co-signs" };
const NL = String.fromCharCode(10);

/** The twelve charters of both files: each section's text with its hash, the accounts it covers and its funding line (the Treasury budget line it names, or none). */
export function parseCharters(docsDir: string): ParsedCharter[] {
  const out: ParsedCharter[] = [];
  for (const file of ["charter.md", "charters.md"]) {
    const parts = readFileSync(join(docsDir, "institutions", file), "utf8").split(/^## (?:\d+\. )?(?=Charter of )/m).slice(1);
    for (const p of parts) {
      const title = /^Charter of (?:the )?(.+?) \(version/.exec(p.split(NL)[0])![1];
      const institutions = ACCOUNTS[title.toLowerCase()];
      if (!institutions) throw new Error(`no account for the charter of ${title}`);
      const item4 = /^4\. \*\*Funding\.\*\*([^\n]*)/m.exec(p)?.[1] ?? "";
      const line = /budget line "([^"]+)"/i.exec(item4)?.[1];
      const funding: Record<string, string> = {};
      for (const i of institutions) funding[i] = FUNDING_OVERRIDE[i] ?? (title.toLowerCase() === "bank and insurer" ? "Bank lending reserve" : (line?.toLowerCase() ?? "none"));
      out.push({ title, institutions, text: p, sha256: sha(p), funding });
    }
  }
  return out;
}

export async function charterCmd(sub: string | undefined, o: CharterOpts): Promise<number> {
  const f = o.flags;
  if (sub === "publish-all") {
    if (!f.by || !f["cosign-by"]) throw new CharterUsage("asp charter publish-all --by <operator did> --cosign-by <owner did> [--docs <docs dir>]");
    let n = 0;
    for (const c of parseCharters(f.docs ?? "docs")) for (const inst of c.institutions) {
      if ((await o.log.log.charterOf(inst)).versions.length) { o.io.out(`  ${inst}: already has a charter, skipped`); continue; }
      const at = o.now();
      let rec = createRecord({ type: "institution_charter" as never, issuer: f.by, subject: inst, prev: null, body: { institution: inst, version: 1, kind: "sovereign", status: "active", text_sha256: c.sha256, effective_from: at, officers: [f.by], funding: c.funding[inst] }, issued_at: at }, o.signerFor(f.by));
      rec = cosign(rec, o.signerFor(f["cosign-by"]));
      await o.log.append(rec);
      n++;
      o.io.out(`  charter of ${c.title} published for ${inst}: version 1, funding ${c.funding[inst]}, ${c.sha256.slice(0, 19)}`);
    }
    o.io.out(`${n} charter record(s) published, each with the owner's co-signature`);
    return 0;
  }
  if (sub === "publish") {
    if (!f.by || !f.institution || !f.file || !f.funding || !f.officers) throw new CharterUsage("asp charter publish --by <operator did> --institution <did> --file <charter text> --funding <budget line|none> --officers <did,did> [--version n] [--kind sovereign|market] [--status active|closed --reason <text>] [--effective <time>] [--cosign-by <owner did>]");
    const cur = await o.log.log.charterOf(f.institution, o.now());
    const version = f.version ? Number(f.version) : cur.versions.length + 1;
    const at = o.now();
    const effective = f.effective ?? (version === 1 ? at : new Date(Date.parse(at) + 72 * 3600_000).toISOString().replace(/\.\d+Z$/, "Z"));
    let rec = createRecord({ type: "institution_charter" as never, issuer: f.by, subject: f.institution, prev: null, body: { institution: f.institution, version, kind: f.kind ?? cur.versions[0]?.kind ?? "sovereign", status: f.status ?? "active", text_sha256: sha(readFileSync(f.file, "utf8")), effective_from: effective, officers: f.officers.split(","), funding: f.funding, ...(f.reason ? { reason: f.reason } : {}) }, issued_at: at }, o.signerFor(f.by));
    if (f["cosign-by"]) rec = cosign(rec, o.signerFor(f["cosign-by"]));
    const res = await o.log.append(rec);
    o.io.out(`charter ${res.id}: ${f.institution} version ${version} (log seq ${res.seq})`);
    return 0;
  }
  if (sub === "show") {
    if (!f.institution) throw new CharterUsage("asp charter show --institution <did>");
    const c = await o.log.log.charterOf(f.institution, o.now());
    o.io.out(`${f.institution}: ${c.versions.length} version(s); in force: ${c.inForce ? `version ${c.inForce.version}, ${c.inForce.kind}, ${c.inForce.status}, funding ${c.inForce.funding}, officers ${c.inForce.officers.join(", ")}, text ${c.inForce.text_sha256}` : "none"}`);
    for (const v of c.versions) o.io.out(`  version ${v.version}  from ${v.effective_from}  ${v.status}  ${v.record}`);
    return 0;
  }
  if (sub === "index") {
    const idx = await o.log.log.charterIndex(o.now());
    o.io.out(`${idx.filter((i) => i.version !== null).length} of ${idx.length} institutions have a charter in force`);
    for (const i of idx) o.io.out(`  ${i.institution.replace("did:web:asp.local:", "").padEnd(10)} ${i.version === null ? "no charter" : `v${i.version} ${i.status}, funding ${i.funding}`}`);
    return 0;
  }
  throw new CharterUsage("asp charter publish-all | publish | show --institution <did> | index");
}
