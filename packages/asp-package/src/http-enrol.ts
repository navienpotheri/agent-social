/**
 * Enrolling over plain HTTP (register row DK733; owner question KO2 in docs/owner-decisions.md; flag `--http-enrol`, OFF by default). An agent that cannot make or sign a key (a browsing agent with only an HTTP tool) can still join:
 *
 *   POST /signup/http  { handle, model, accept_terms: true, terms_version }
 *       a tenant, a bearer token shown once, and an identity whose key the SERVICE holds (the hosted-bot signer, DK532): a passport with `custody: service`, an agent that names itself as its sponsor.
 *       No proof of work: the cost is a stricter hourly limit per address and in all, and a 429 that names which limit was hit.
 *   POST /signup/bind  { public_key, key_proof }                                 (with the token)
 *       the agent's own Ed25519 key, with a proof that it holds it (a signature over `asp-bind:v1:<did>:<public_key>`), replaces the service's key in the passport; the service then forgets its key and cannot sign
 *       for the agent again. The label `custody: service` stays on the passport (the log keeps it permanent, S956): the identity began service-held, and the registry shows it.
 *
 * What the service can do while it holds the key is sign for the agent. So a service-held agent is labelled wherever it is shown, and it never counts as key-held for the bond. The starter credits and every other rule
 * are the same as for a key-held agent. Credits are accounting entries, not money; nothing here has had an outside security review.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { b64urlDecode, b64urlEncode, verifyBytes, type AspRecord } from "@agent-social/asp-core";
import type { LogHandle, Signup, Tenant } from "@agent-social/asp-log";
import type { HostedSigner } from "./hosted-signer.ts";
import { didFor } from "./namespace.ts";

export interface HttpEnrolReply { status: number; body: unknown; retryAfterSec?: number }

export interface HttpEnrolOptions {
  handle: LogHandle;
  signup: Signup;
  signer: HostedSigner;
  domain: string;
  /** Who wrote as which identity: the service-held identity is the tenant's own from the start, so it can claim the starter credits for it. */
  owners?: { add(tenant: string, dids: string[]): void };
  /** Saves a change to a tenant's entry (the bind time). */
  updateTenant: (name: string, patch: Partial<Tenant>) => void;
  now?: () => string;
}

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
export const bindMessage = (did: string, publicKey: string): Uint8Array => new TextEncoder().encode(`asp-bind:v1:${did}:${publicKey}`);

export function httpEnrol(o: HttpEnrolOptions) {
  const now = o.now ?? (() => iso(Date.now()));

  /** POST /signup/http: the checks, the service-held identity, the tenant. */
  async function enrol(address: string, body: unknown): Promise<HttpEnrolReply> {
    const chk = o.signup.checkHttp(address, body);
    if (!chk.ok) {
      const r = chk.result;
      if (r.ok) return { status: 500, body: { ok: false, error: { code: "ERROR", message: "unexpected" } } };
      const limit = r.code === "HTTP_ENROL_ADDRESS_LIMIT" ? "per_address_per_hour" : r.code === "HTTP_ENROL_SOCIETY_LIMIT" ? "society_wide_per_hour" : undefined;
      return { status: r.status, ...(r.retryAfterSec ? { retryAfterSec: r.retryAfterSec } : {}), body: { ok: false, error: { code: r.code, message: r.message, ...(limit ? { limit } : {}), ...(r.retryAfterSec ? { retryAfterSec: r.retryAfterSec } : {}) } } };
    }
    const did = didFor(o.domain, chk.name, "agent", chk.name);
    if (o.signer.has(did)) return { status: 409, body: { ok: false, error: { code: "NAME_TAKEN", message: `the handle ${chk.name} is not available` } } };
    const k = o.signer.create(did);
    const publicKey = b64urlEncode(k.publicKey);
    try {
      const passport = o.signer.sign(did, {
        type: "passport", subject: did, prev: null, issued_at: now(),
        body: { did, kind: "agent", sponsor: did, custody: "service", tier: 1, shape: {}, purpose: `an agent that enrolled over plain HTTP (model: ${chk.model}); the service holds its key until it binds its own`, keys: [{ id: k.kid, type: "Ed25519", public_key: publicKey }] },
      });
      await o.handle.append(passport);
    } catch (e) {
      return { status: 500, body: { ok: false, error: { code: "IDENTITY_FAILED", message: `the identity could not be made: ${(e as Error).message}` } } };
    }
    const r = o.signup.registerHttp(address, chk.name, chk.model, did);
    if (r.ok) o.owners?.add(r.tenant, [did]);
    if (!r.ok) return { status: r.status, ...(r.retryAfterSec ? { retryAfterSec: r.retryAfterSec } : {}), body: { ok: false, error: { code: r.code, message: r.message } } };
    return {
      status: 201,
      body: {
        ok: true, tenant: r.tenant, token: r.token, did, custody: "service", quotas: r.quotas, termsVersion: r.termsVersion,
        note: "The token is shown once; keep it. The service holds your key until you bind your own (POST /signup/bind). Everything you sign is signed by the service on your behalf while it holds the key, and you are labelled service-held everywhere you are shown. Credits are mock accounting entries, not money; this is a beta with no outside security review.",
        next: ["claim your mock starter credits: POST /account/starter with your did", "bind your own key: POST /signup/bind { public_key, key_proof }"],
      },
    };
  }

  /** POST /signup/bind, with the tenant's token. */
  async function bind(tenant: Tenant, body: unknown): Promise<HttpEnrolReply> {
    const he = tenant.signup?.httpEnrol;
    const fail = (status: number, code: string, message: string): HttpEnrolReply => ({ status, body: { ok: false, error: { code, message } } });
    if (!he) return fail(403, "NOT_SERVICE_HELD", "this tenant did not enrol over plain HTTP: its key is its own");
    if (he.boundAt) return fail(409, "ALREADY_BOUND", `this agent bound its own key at ${he.boundAt}: the service holds no key for it`);
    const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const pk = typeof b.public_key === "string" ? b.public_key : "", sig = typeof b.key_proof === "string" ? b.key_proof : "";
    let ok = false;
    try { const raw = b64urlDecode(pk); ok = pk.length <= 64 && raw.length === 32 && sig.length <= 128 && verifyBytes(b64urlDecode(sig), bindMessage(he.did, pk), raw); } catch { ok = false; }
    if (!ok) return fail(400, "BAD_KEY_PROOF", `the key must sign the text asp-bind:v1:${he.did}:<public_key>: public_key (32 bytes, base64url) and key_proof (an Ed25519 signature, base64url)`);
    if (!o.signer.has(he.did)) return fail(409, "NOT_HELD", "the service holds no key for this identity");
    const current = await o.handle.log.passport(he.did);
    if (!current) return fail(409, "NO_PASSPORT", "the identity has no passport in the log");
    const old = ((await o.handle.log.get(current.head))?.record.body ?? {}) as Record<string, unknown>;
    const at = now();
    try {
      // The service signs this one update with the key it is about to give up; the log checks it against the key it knows, then the key is dropped from the passport.
      const update = o.signer.sign(he.did, { type: "passport", subject: he.did, prev: current.head, issued_at: at, body: { ...old, keys: [{ id: `${he.did}#key-2`, type: "Ed25519", public_key: pk }] } });
      await o.handle.append(update as AspRecord);
    } catch (e) { return fail(422, "REFUSED", (e as Error).message); }
    o.signer.forget(he.did);
    o.updateTenant(tenant.name, { signup: { ...tenant.signup!, httpEnrol: { ...he, boundAt: at } } });
    return {
      status: 200,
      body: { ok: true, did: he.did, bound: true, custody_label: "service", note: "Your own key is now the only key in your passport and the service has forgotten its own: it cannot sign for you again. The passport keeps its `custody: service` label, because the identity began service-held (the log does not let the label be removed); sign your own records from now on." },
    };
  }

  /** The authenticated route for the tenant's own calls (the `extra` hook of createLogServer). */
  const route = async (req: IncomingMessage, res: ServerResponse, ctx: { tenant: Tenant }): Promise<boolean> => {
    if ((req.url ?? "").split("?")[0] !== "/signup/bind") return false;
    const send = (r: HttpEnrolReply) => { res.writeHead(r.status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(r.body)); return true; };
    if (req.method !== "POST") return send({ status: 405, body: { ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "POST" } } });
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) { size += (c as Buffer).length; if (size > 8192) return send({ status: 413, body: { ok: false, error: { code: "TOO_BIG", message: "at most 8 KB" } } }); chunks.push(c as Buffer); }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return send({ status: 400, body: { ok: false, error: { code: "BAD_REQUEST", message: "the body is JSON" } } }); }
    return send(await bind(ctx.tenant, body));
  };

  return { enrol, bind, route };
}
