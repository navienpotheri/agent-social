/**
 * did:web key fetching (https://w3c-ccg.github.io/did-method-web/): find out which public keys a
 * did:web identity really publishes, so a registry can check that a passport's keys belong to whoever
 * controls that domain.
 *
 * This does network I/O, so it must never run inside the log's append (replay would depend on the
 * network). It is an admission check, run by whoever operates a registry before appending a foreign
 * passport (`asp identity register`); the log itself only ever sees the result as a passport.
 *
 * Only Ed25519 keys are read (publicKeyMultibase, or an OKP/Ed25519 publicKeyJwk). Redirects are
 * refused, the response is size-limited and time-limited, and the document's `id` must equal the DID.
 * https is required, except for localhost, 127.0.0.1 and [::1], which use http so the fetch path can
 * be tested for real without certificates.
 */
import { AspError } from "./errors.ts";
import { b64urlDecode, b64urlEncode } from "./crypto.ts";
import { publicKeyFromDidKey } from "./didkey.ts";

const MAX_BYTES = 64 * 1024;
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/** The URL a did:web document lives at: `did:web:host` is /.well-known/did.json, extra segments are a path. */
export function didWebUrl(did: string): string {
  const m = /^did:web:([^:]+)((?::[^:]+)*)$/.exec(did);
  if (!m) throw new AspError("SCHEMA_INVALID", `not a did:web: ${did}`);
  const host = decodeURIComponent(m[1]);
  const path = m[2] ? m[2].slice(1).split(":").map(decodeURIComponent).join("/") : "";
  const scheme = LOCAL.test(host) ? "http" : "https";
  return `${scheme}://${host}/${path ? `${path}/did.json` : ".well-known/did.json"}`;
}

export type FetchLike = (url: string, init: { signal: AbortSignal; redirect: "error" }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

function keyOf(method: any): Uint8Array | undefined {
  try {
    if (typeof method?.publicKeyMultibase === "string" && method.publicKeyMultibase.startsWith("z")) {
      return publicKeyFromDidKey(`did:key:${method.publicKeyMultibase}`);
    }
    const jwk = method?.publicKeyJwk;
    if (jwk?.kty === "OKP" && jwk?.crv === "Ed25519" && typeof jwk.x === "string") {
      const k = b64urlDecode(jwk.x);
      return k.length === 32 ? k : undefined;
    }
  } catch { /* not an Ed25519 key we can read */ }
  return undefined;
}

/** The Ed25519 public keys a did:web document publishes for that DID. Throws if it cannot be fetched or is not that DID's document. */
export async function fetchDidWebKeys(did: string, opts: { fetch?: FetchLike; timeoutMs?: number } = {}): Promise<Uint8Array[]> {
  const url = didWebUrl(did);
  const doFetch = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 5000);
  let text: string;
  try {
    const res = await doFetch(url, { signal: ctl.signal, redirect: "error" });
    if (!res.ok) throw new AspError("SCHEMA_INVALID", `${url} answered ${res.status}`);
    text = await res.text();
  } catch (e) {
    if (e instanceof AspError) throw e;
    throw new AspError("SCHEMA_INVALID", `could not fetch ${url}: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
  if (text.length > MAX_BYTES) throw new AspError("SCHEMA_INVALID", `${url} is larger than ${MAX_BYTES} bytes`);
  let doc: any;
  try { doc = JSON.parse(text); } catch { throw new AspError("SCHEMA_INVALID", `${url} is not JSON`); }
  if (doc?.id !== did) throw new AspError("SCHEMA_INVALID", `${url} describes ${doc?.id}, not ${did}`);
  const methods: any[] = Array.isArray(doc.verificationMethod) ? doc.verificationMethod : [];
  return methods.filter((m) => m?.controller === undefined || m.controller === did).map(keyOf).filter((k): k is Uint8Array => !!k);
}

/** Which of a passport's keys the DID's own document does not publish (empty = every key is vouched for). */
export async function passportKeysNotPublished(did: string, passportKeys: { id: string; public_key: string }[], opts: { fetch?: FetchLike; timeoutMs?: number } = {}): Promise<string[]> {
  const published = (await fetchDidWebKeys(did, opts)).map((k) => b64urlEncode(k));
  return passportKeys.filter((k) => !published.includes(k.public_key)).map((k) => k.id);
}
