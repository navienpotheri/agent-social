/**
 * `asp abuse file | admit | list` (register row H3; spec-delta S430): a third party's abuse report. `file` is run by the reporter, a did:web identity with no passport here: it signs the report with its own key
 * and writes a file (nothing is sent). `admit` is run by the operator: it fetches the reporter's DID document, checks that the document publishes the key the report names and that the document's hash is the one
 * the report states, then countersigns and appends. The fetch is an admission check here and never part of the log, so replay stays offline. `list` shows the reports against an agent.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { b64urlEncode, cosign, createRecord, didWebUrl, fetchDidWebKeys, fetchSmallText, type AspRecord, type FetchLike, type Signer } from "@agent-social/asp-core";
import type { LogHandle } from "@agent-social/asp-package";

export class AbuseUsage extends Error {}
export interface AbuseOpts { log: LogHandle; io: { out: (l: string) => void; err: (l: string) => void }; now: () => string; signerFor: (did: string) => Signer; fetch?: FetchLike; flags: { by?: string; accused?: string; kind?: string; description?: string; about?: string; out?: string; "cosign-by"?: string } }
const KINDS = ["network_abuse", "data_exposure", "harassment", "spam", "other"];
const sha = (t: string) => "sha256:" + createHash("sha256").update(t).digest("hex");

export async function abuseCmd(sub: string | undefined, file: string | undefined, o: AbuseOpts): Promise<number> {
  const f = o.flags;
  if (sub === "file") {
    if (!f.by || !f.accused || !f.kind || !f.description) throw new AbuseUsage("asp abuse file --by <your did:web> --accused <agent did> --kind network_abuse|data_exposure|harassment|spam|other --description <what happened> [--about <record id>] [--out <file>]");
    if (!KINDS.includes(f.kind)) throw new AbuseUsage(`--kind is one of ${KINDS.join(", ")}`);
    if (!f.by.startsWith("did:web:")) throw new AbuseUsage("a reporter is a did:web identity: its domain's own DID document is the proof of control");
    const signer = o.signerFor(f.by);
    const url = didWebUrl(f.by);
    const doc = await fetchSmallText(url, { fetch: o.fetch });
    const rec = createRecord({ type: "abuse_report" as never, issuer: f.by, subject: f.accused, prev: null, issued_at: o.now(), body: {
      accused: f.accused, kind: f.kind, description: f.description, ...(f.about ? { about: f.about } : {}),
      reporter_key: { id: signer.kid, public_key: b64urlEncode((signer as Signer & { publicKey: Uint8Array }).publicKey) }, proof: { url, sha256: sha(doc) },
    } }, signer);
    const out = f.out ?? `abuse-report-${rec.id.slice(7, 15)}.json`;
    writeFileSync(out, JSON.stringify(rec, null, 2) + "\n");
    o.io.out(`signed report ${rec.id} against ${f.accused}, written to ${out}; send it to the operator, who checks ${url} and admits it (nothing is recorded yet)`);
    return 0;
  }
  if (sub === "admit") {
    if (!file || !f["cosign-by"]) throw new AbuseUsage("asp abuse admit <report.json> --cosign-by <operator did>");
    const rec = JSON.parse(readFileSync(file, "utf8")) as AspRecord;
    const b = rec.body as { reporter_key?: { id: string; public_key: string }; proof?: { url: string; sha256: string } };
    if (rec.type !== "asp.abuse_report/v0.2" || !b.reporter_key || !b.proof) throw new Error(`${file} is not an abuse report`);
    if (!rec.issuer.startsWith("did:web:")) throw new Error(`${rec.issuer} is not a did:web identity`);
    const url = didWebUrl(rec.issuer);
    if (b.proof.url !== url) throw new Error(`the report's proof url ${b.proof.url} is not where ${rec.issuer}'s document lives (${url})`);
    const doc = await fetchSmallText(url, { fetch: o.fetch });
    if (sha(doc) !== b.proof.sha256) throw new Error(`the document at ${url} is not the one the report states (hash differs): ask the reporter to file again`);
    const keys = (await fetchDidWebKeys(rec.issuer, { fetch: o.fetch })).map((k) => b64urlEncode(k));
    if (!keys.includes(b.reporter_key.public_key)) throw new Error(`${url} does not publish the key the report is signed with: the reporter does not control that domain's key`);
    const res = await o.log.append(cosign(rec, o.signerFor(f["cosign-by"])));
    o.io.out(`abuse report ${res.id} admitted: ${rec.issuer} controls its domain's key; filed against ${(rec.body as { accused: string }).accused} (log seq ${res.seq}); it is a lead for the Registry and the Courts, not a finding`);
    return 0;
  }
  if (sub === "list") {
    if (!f.accused) throw new AbuseUsage("asp abuse list --accused <agent did>");
    const rows = await (o.log as unknown as { log: { abuseReportsAbout(d: string): Promise<{ id: string; reporter: string; kind: string; at: string }[]> } }).log.abuseReportsAbout(f.accused);
    o.io.out(`${rows.length} abuse report(s) against ${f.accused}`);
    for (const r of rows) o.io.out(`  ${r.at}  ${r.kind.padEnd(14)} ${r.reporter}  ${r.id}`);
    return 0;
  }
  throw new AbuseUsage("asp abuse file | admit | list: file --by <did:web> --accused <did> --kind <kind> --description <text>; admit <report.json> --cosign-by <operator did>; list --accused <did>");
}
