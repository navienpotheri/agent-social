import { canonicalBytes } from "./canonical.ts";
import { b64urlDecode, b64urlEncode, publicKeyFromSeed, sha256Id, signBytes, verifyBytes } from "./crypto.ts";
import { AspError } from "./errors.ts";
import { defaultSchemas, fullType, shortType, type RecordType, type SchemaSet } from "./schema.ts";

export interface Signature {
  alg: "Ed25519";
  kid: string;
  value: string;
}

/** The ASP envelope: {type, id, issuer, actor, subject, body, prev, sig} plus issued_at and optional cosigs. */
export interface AspRecord<B = Record<string, unknown>> {
  type: string;
  id: string;
  issuer: string;
  actor: string;
  subject: string | null;
  body: B;
  prev: string | null;
  issued_at: string;
  sig: Signature;
  cosigs?: Signature[];
}

export interface Signer {
  /** DID URL of the key, e.g. did:web:example.com:agents:coder-1#key-1 */
  kid: string;
  /** 32-byte Ed25519 seed. */
  seed: Uint8Array;
}

/** Returns the raw 32-byte public key for a kid, or undefined if unknown. */
export type KeyResolver = (kid: string) => Uint8Array | undefined;

export interface RecordDraft<B = Record<string, unknown>> {
  type: RecordType;
  issuer: string;
  actor?: string;
  subject: string | null;
  body: B;
  prev: string | null;
  issued_at: string;
}

export function didOf(didUrl: string): string {
  const i = didUrl.indexOf("#");
  return i < 0 ? didUrl : didUrl.slice(0, i);
}

/** The fields covered by id and every signature: everything except id, sig and cosigs. */
export function unsignedView(r: Pick<AspRecord, "type" | "issuer" | "actor" | "subject" | "body" | "prev" | "issued_at">) {
  return {
    type: r.type,
    issuer: r.issuer,
    actor: r.actor,
    subject: r.subject,
    body: r.body,
    prev: r.prev,
    issued_at: r.issued_at,
  };
}

export function signingBytes(r: Parameters<typeof unsignedView>[0]): Uint8Array {
  return canonicalBytes(unsignedView(r));
}

function makeSig(bytes: Uint8Array, signer: Signer): Signature {
  return { alg: "Ed25519", kid: signer.kid, value: b64urlEncode(signBytes(bytes, signer.seed)) };
}

export function createRecord<B extends Record<string, unknown>>(draft: RecordDraft<B>, signer: Signer): AspRecord<B> {
  if (didOf(signer.kid) !== draft.issuer) {
    throw new AspError("KID_NOT_ISSUER", `${signer.kid} does not belong to ${draft.issuer}`);
  }
  const base = {
    type: fullType(draft.type),
    issuer: draft.issuer,
    actor: draft.actor ?? draft.issuer,
    subject: draft.subject,
    body: draft.body,
    prev: draft.prev,
    issued_at: draft.issued_at,
  };
  const bytes = signingBytes(base);
  return { ...base, id: sha256Id(bytes), sig: makeSig(bytes, signer) };
}

/** Adds a co-signature over the same bytes (e.g. the performer on a Contract). */
export function cosign<B>(record: AspRecord<B>, signer: Signer): AspRecord<B> {
  const sig = makeSig(signingBytes(record as AspRecord), signer);
  return { ...record, cosigs: [...(record.cosigs ?? []), sig] };
}

export function signerFromSeed(kid: string, seed: Uint8Array): Signer & { publicKey: Uint8Array } {
  return { kid, seed, publicKey: publicKeyFromSeed(seed) };
}

export function staticResolver(keys: Record<string, Uint8Array | string>): KeyResolver {
  return (kid) => {
    const k = keys[kid];
    if (k === undefined) return undefined;
    return typeof k === "string" ? b64urlDecode(k) : k;
  };
}

/** Builds a resolver from passport records (keys listed in passport bodies). */
export function resolverFromPassports(passports: AspRecord[]): KeyResolver {
  const keys: Record<string, string> = {};
  for (const p of passports) {
    const body = p.body as { keys?: { id: string; public_key: string; revoked_at?: string }[] };
    for (const k of body.keys ?? []) if (!k.revoked_at) keys[k.id] = k.public_key;
  }
  return staticResolver(keys);
}

function checkSig(sig: Signature, bytes: Uint8Array, resolve: KeyResolver): void {
  const pub = resolve(sig.kid);
  if (!pub) throw new AspError("UNKNOWN_KEY", `no key for ${sig.kid}`);
  if (!verifyBytes(b64urlDecode(sig.value), bytes, pub)) {
    throw new AspError("BAD_SIGNATURE", `signature by ${sig.kid} does not verify`);
  }
}

/**
 * Verifies one record in isolation. Check order is normative (conformance vectors depend on it):
 * envelope schema, known type, body schema, canonical form, id, actor, kid-issuer binding, signature, cosignatures.
 */
export function verifyRecord(record: unknown, resolve: KeyResolver, schemas: SchemaSet = defaultSchemas()): AspRecord {
  schemas.assert("envelope", record);
  const r = record as AspRecord;
  const short = shortType(r.type);
  if (!short) throw new AspError("UNKNOWN_TYPE", `unknown record type ${r.type}`);
  schemas.assert(short, r.body);

  const bytes = signingBytes(r);
  const id = sha256Id(bytes);
  if (id !== r.id) throw new AspError("BAD_ID", `id should be ${id}`);

  if (didOf(r.actor) !== r.issuer) throw new AspError("BAD_ACTOR", `${r.actor} is not ${r.issuer} or one of its nodes`);
  if (didOf(r.sig.kid) !== r.issuer) throw new AspError("KID_NOT_ISSUER", `${r.sig.kid} does not belong to ${r.issuer}`);
  checkSig(r.sig, bytes, resolve);
  for (const c of r.cosigs ?? []) checkSig(c, bytes, resolve);
  return r;
}
