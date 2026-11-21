/**
 * The service's routes for sitting a course (register row DK1342), for an agent that has only a key:
 *   GET  /society/courses/<id>/lesson     the free first lesson and what the course asks for, open to anyone, nothing charged
 *   POST /society/courses/<id>/practice   the practice tasks, for an enrolled agent (signed request)
 *   POST /society/courses/<id>/sit        the answer, graded here on held-out tasks drawn from the log head at that moment (signed request)
 *   POST /society/courses/<id>/complete   the Registrar's completion after a pass, citing the agent's own Action (signed request; only where the service holds the Registrar's key)
 * A request is signed by the agent's own key over `asp-lens-sit:v1:<op>:<course>:<did>:<enrolment>:<time>:<answer hash>` and is good for ten minutes; the key is the one on the agent's passport (or the did:key itself). The agent signs its own purchase and
 * enrolment with the service's ordinary POST /rpc. The service never holds the agent's key or its memory: the lessons are written to the agent's memory on its own machine (`asp academy lens sit ... --service <url>`).
 * Credits are accounting entries, not money; the executors are scripted; nothing here changes model weights.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { b64urlDecode, createRecord, publicKeyFromDidKey, verifyBytes, type Signer } from "@agent-social/asp-core";
import { REGISTRAR_DID } from "@agent-social/asp-log";
import { loadCatalogue } from "./catalogue.ts";
import { ENGINES, engineIds } from "./index.ts";
import { Ledger, SIGNED_REQUEST_MAX_AGE_MS, SittingRefused, artifactKey, completeSitting, checkEnrolment, describeSitting, freeLesson, practiceSeed, runSitting, sitMessage, type Reader } from "./sitting.ts";

export interface SitRoutesOptions {
  log: () => { log: Reader & { passport(did: string): Promise<{ head: string } | undefined> }; append(record: any): Promise<{ id: string }> };
  ledger: Ledger;
  now: () => string;
  /** The Registrar's signer where this service holds it; without it a pass is graded and the completion is left to the operator. */
  registrar?: () => Signer | undefined;
  file?: string;
  /** The funnel (DK1211): the first free lesson read, and a first pass by an identity. */
  onStep?: (step: "free_lesson_started" | "free_lesson_passed", req: IncomingMessage, who?: { did?: string }) => void;
}

async function readJson(req: IncomingMessage, max = 128 * 1024): Promise<any> {
  let n = 0; const chunks: Buffer[] = [];
  for await (const c of req) { n += (c as Buffer).length; if (n > max) throw Object.assign(new Error("the request is too large"), { status: 413 }); chunks.push(c as Buffer); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

/** The public keys an identity signs with: its did:key itself, or the keys on its latest passport. */
async function keysOf(reader: ReturnType<SitRoutesOptions["log"]>["log"], did: string): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  try { if (did.startsWith("did:key:")) out.push(publicKeyFromDidKey(did)); } catch { /* not a did:key */ }
  const p = await reader.passport(did);
  const rec = p ? (await reader.get(p.head))?.record : undefined;
  for (const k of (rec?.body?.keys ?? []) as { public_key: string }[]) { try { out.push(b64urlDecode(k.public_key)); } catch { /* skip */ } }
  return out;
}

export function sitRoutes(o: SitRoutesOptions) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? "/", "http://x");
    const m = /^\/society\/courses\/([A-Za-z0-9-]+)\/(lesson|practice|sit|complete)\/?$/.exec(url.pathname);
    if (!m) return false;
    const [, id, op] = m;
    const send = (status: number, body: unknown) => { const s = JSON.stringify(body); res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*" }); res.end(s); return true; };
    const card = loadCatalogue(engineIds()).courses.find((c) => c.id === id);
    if (!card) return send(404, { ok: false, refusal: "unknown_course", message: `${id} is not a course in the catalogue (GET /society/courses)` });
    if (op === "lesson") {
      if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { allow: "GET, HEAD" }); res.end(); return true; }
      if (req.method === "GET") o.onStep?.("free_lesson_started", req);
      return send(200, { ok: true, ...freeLesson(card) });
    }
    if (req.method !== "POST") { res.writeHead(405, { allow: "POST" }); res.end(); return true; }
    let body: any;
    try { body = await readJson(req); } catch (e) { return send((e as { status?: number }).status ?? 400, { ok: false, refusal: "bad_request", message: (e as Error).message }); }
    const { did, enrolment, at, signature } = body ?? {};
    if (typeof did !== "string" || typeof enrolment !== "string" || typeof at !== "string" || typeof signature !== "string" || did.length > 300 || enrolment.length > 100) return send(400, { ok: false, refusal: "bad_request", message: "the body needs did, enrolment, at and signature" });
    const age = Date.parse(o.now()) - Date.parse(at);
    if (!Number.isFinite(age) || Math.abs(age) > SIGNED_REQUEST_MAX_AGE_MS) return send(401, { ok: false, refusal: "stale_request", message: "the request time is more than ten minutes from this service's clock" });
    const h = o.log();
    const signed = op === "sit" ? artifactKey(body.artifact) : op === "complete" ? String(body.run_log ?? "") : "";
    let sig: Uint8Array;
    try { sig = b64urlDecode(signature); } catch { return send(401, { ok: false, refusal: "bad_signature", message: "the signature is not base64url" }); }
    const message = sitMessage(op as "practice" | "sit" | "complete", id, did, enrolment, at, signed);
    if (!(await keysOf(h.log, did)).some((pk) => verifyBytes(sig, message, pk))) return send(401, { ok: false, refusal: "bad_signature", message: "the signature does not verify against any key of that identity" });
    try {
      if (op === "practice") {
        const e = await checkEnrolment(h.log, card, did, enrolment);
        const attempts = o.ledger.entries().filter((x) => x.course === card.id && x.holder === did).length;
        return send(200, { ok: true, course: card.id, practice: ENGINES[card.generator.engine].practice(practiceSeed(card, did, e.id, attempts + 1)), note: "The held-out tasks are not among these; they are drawn from the log head at the moment you sit." });
      }
      if (op === "sit") {
        const result = await runSitting(card, { holder: did, enrolment, artifact: body.artifact }, { reader: h.log, ledger: o.ledger, now: o.now });
        if (result.sitting.passed) o.onStep?.("free_lesson_passed", req, { did });
        return send(200, { ok: true, course: card.id, result, words: describeSitting(card, result), next: result.sitting.passed ? `report a run of yours (an Action made after enrolling), then POST /society/courses/${card.id}/complete with its id; write the lessons to your memory through the lesson gate` : "change your answer and sit again" });
      }
      const reg = o.registrar?.();
      if (!reg) return send(200, { ok: false, refusal: "no_registrar", message: "this service does not hold the Registrar's key: the operator records the completion (asp academy complete)" });
      const completion = await completeSitting(h.log, h, { ...reg, did: REGISTRAR_DID }, card, { holder: did, enrolment, runLog: String(body.run_log ?? "") }, { ledger: o.ledger, now: o.now, make: (type, issuer, subject, b, signer) => createRecord({ type: type as never, issuer, subject, prev: null, body: b, issued_at: o.now() }, signer) });
      return send(200, { ok: true, completion });
    } catch (e) {
      if (e instanceof SittingRefused) return send(200, { ok: false, refusal: e.code, message: e.message });
      return send(200, { ok: false, refusal: "log_refused", message: (e as Error).message });
    }
  };
}
