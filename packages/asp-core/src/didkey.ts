/**
 * did:key for Ed25519 (https://w3c-ccg.github.io/did-method-key/): a self-certifying DID derived
 * directly from a public key, with no domain, server or registry to depend on or lose access to.
 * Unlike did:web, nothing about it can be taken away by whoever hosts the domain it might otherwise
 * live under — the point raised when did:web-only identity was checked against "take your agent and
 * leave" (2026-09-27, see docs/spec-deltas.md). Recommended for anyone who doesn't want to run their
 * own domain; did:web remains supported for anyone who does.
 */
import { AspError } from "./errors.ts";

/** multicodec varint prefix for "ed25519-pub" (0xed), then the raw 32-byte key: 34 bytes total. */
const ED25519_PUB_CODEC = new Uint8Array([0xed, 0x01]);

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_INDEX = new Map([...BASE58].map((c, i) => [c, i]));

function base58encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  let num = 0n;
  for (const b of bytes) num = (num << 8n) | BigInt(b);
  let out = "";
  while (num > 0n) {
    out = BASE58[Number(num % 58n)] + out;
    num /= 58n;
  }
  return "1".repeat(zeros) + out;
}

function base58decode(s: string): Uint8Array {
  let zeros = 0;
  while (zeros < s.length && s[zeros] === "1") zeros++;
  let num = 0n;
  for (const c of s) {
    const v = BASE58_INDEX.get(c);
    if (v === undefined) throw new AspError("SCHEMA_INVALID", `not base58: character ${JSON.stringify(c)}`);
    num = num * 58n + BigInt(v);
  }
  const out: number[] = [];
  while (num > 0n) {
    out.unshift(Number(num & 0xffn));
    num >>= 8n;
  }
  return new Uint8Array([...new Array(zeros).fill(0), ...out]);
}

/** Derives a did:key from a 32-byte Ed25519 public key. The DID itself proves the key belongs to it. */
export function didKeyFromPublicKey(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) throw new AspError("SCHEMA_INVALID", `an Ed25519 public key is 32 bytes, got ${publicKey.length}`);
  const prefixed = new Uint8Array(ED25519_PUB_CODEC.length + 32);
  prefixed.set(ED25519_PUB_CODEC, 0);
  prefixed.set(publicKey, ED25519_PUB_CODEC.length);
  return `did:key:z${base58encode(prefixed)}`;
}

/** Recovers the Ed25519 public key a did:key was derived from — decoding, not a network lookup. */
export function publicKeyFromDidKey(did: string): Uint8Array {
  const m = /^did:key:z([1-9A-HJ-NP-Za-km-z]+)$/.exec(did);
  if (!m) throw new AspError("SCHEMA_INVALID", `not a did:key: ${did}`);
  const decoded = base58decode(m[1]);
  if (decoded.length !== 34 || decoded[0] !== ED25519_PUB_CODEC[0] || decoded[1] !== ED25519_PUB_CODEC[1]) {
    throw new AspError("SCHEMA_INVALID", `${did} is not an Ed25519 did:key`);
  }
  return decoded.slice(2);
}

/** True if a did:key's own encoding actually matches this public key — the whole point of did:key. */
export function isDidKeyFor(did: string, publicKey: Uint8Array): boolean {
  try {
    const embedded = publicKeyFromDidKey(did);
    return embedded.length === publicKey.length && embedded.every((b, i) => b === publicKey[i]);
  } catch {
    return false;
  }
}
