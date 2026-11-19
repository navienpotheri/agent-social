/**
 * The abuse-report intake on the hosted service (register row DK351; spec-delta S430, S502): an outsider (a site or a person with no passport here) files a signed report by `POST /abuse/report` with no
 * account and no token, instead of sending a file to the operator. The route runs the admission check the operator's `asp abuse admit` runs: the report is a did:web identity's own signed `abuse_report`, the
 * proof url is where that identity's DID document lives, the document is the one the report hashes, and it publishes the key the report is signed with. If all hold, the route countersigns with the operator's
 * key (held by this process, never sent anywhere) and appends. Per address it allows a few reports a day, on top of the log's own limits (5 a day for a reporter, one per accused a week). The fetch is an
 * admission check and never part of the log, so replay stays offline. A report is a lead for the Registry and the Courts, not a finding.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { b64urlEncode, cosign, didWebUrl, fetchDidWebKeys, fetchSmallText, type AspRecord, type FetchLike, type Signer } from "@agent-social/asp-core";
import type { LogHandle } from "@agent-social/asp-log";

const sha = (t: string) => "sha256:" + createHash("sha256").update(t).digest("hex");
const send = (res: ServerResponse, code: number, body: unknown) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
const fail = (res: ServerResponse, code: number, c: string, message: string) => send(res, code, { ok: false, error: { code: c, message } });

export function abuseIntakeRoutes(o: { handle: LogHandle; operator: Signer; fetch?: FetchLike; perAddressPerDay?: number; now?: () => number; trustProxy?: boolean }) {
  const limit = o.perAddressPerDay ?? 5;
  const seen = new Map<string, number[]>();
  const clock = o.now ?? Date.now;
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname !== "/abuse/report") return false;
    if (req.method !== "POST") { res.writeHead(405, { allow: "POST" }); res.end(); return true; }
    // A few reports a day from one address (a salted hash is not needed here: the map lives in memory and is dropped with the day).
    const addr = (o.trustProxy ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0]!.trim() : "") || req.socket.remoteAddress || "?";
    const day = clock() - 86_400_000;
    const mine = (seen.get(addr) ?? []).filter((t) => t > day);
    if (mine.length >= limit) { fail(res, 429, "RATE_LIMITED", `at most ${limit} reports a day from one address`); return true; }
    seen.set(addr, [...mine, clock()]);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) { size += (c as Buffer).length; if (size > 64_000) { fail(res, 413, "TOO_LARGE", "a report is under 64 KB"); return true; } chunks.push(c as Buffer); }
    let rec: AspRecord;
    try { rec = JSON.parse(Buffer.concat(chunks).toString("utf8")) as AspRecord; } catch { fail(res, 400, "BAD_JSON", "send the signed report as JSON (asp abuse file writes it)"); return true; }
    const b = rec?.body as { reporter_key?: { id: string; public_key: string }; proof?: { url: string; sha256: string }; accused?: string } | undefined;
    if (rec?.type !== "asp.abuse_report/v0.2" || !b?.reporter_key || !b.proof) { fail(res, 400, "NOT_A_REPORT", "that is not a signed abuse report"); return true; }
    if (!String(rec.issuer).startsWith("did:web:")) { fail(res, 400, "NOT_DID_WEB", "a reporter is a did:web identity: its domain's own DID document is the proof of control"); return true; }
    try {
      const want = didWebUrl(rec.issuer);
      if (b.proof.url !== want) { fail(res, 422, "PROOF_URL", `the proof url must be where ${rec.issuer}'s document lives (${want})`); return true; }
      const doc = await fetchSmallText(want, { ...(o.fetch ? { fetch: o.fetch } : {}) });
      if (sha(doc) !== b.proof.sha256) { fail(res, 422, "DOC_CHANGED", "the document at that address is not the one the report states (hash differs): file again"); return true; }
      const keys = (await fetchDidWebKeys(rec.issuer, { ...(o.fetch ? { fetch: o.fetch } : {}) })).map((k) => b64urlEncode(k));
      if (!keys.includes(b.reporter_key.public_key)) { fail(res, 422, "KEY_NOT_PUBLISHED", "that domain's DID document does not publish the key the report is signed with"); return true; }
    } catch (e) { fail(res, 422, "ADMISSION", (e as Error).message); return true; }
    try {
      const r = await o.handle.append(cosign(rec, o.operator));
      send(res, 200, { ok: true, id: r.id, seq: r.seq, note: "recorded as a lead for the Registry and the Courts, not a finding" });
    } catch (e) { fail(res, 422, "REFUSED", (e as Error).message); }
    return true;
  };
}
