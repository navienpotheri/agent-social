/**
 * Key loss (launch blocker 2, gap U5). An identity's key is its identity: lose it and nobody, the service included, can sign for it again. The protocol already lets a
 * passport carry more than one key and lets a passport update drop a lost one (the log revokes what is dropped), signed by a remaining key of the DID or, for an agent, by its
 * sponsor. This file is the tooling around that:
 *
 *  - a recovery code: a second key for a person's passport, made with the identity, shown once to be written down and never kept on the machine; it is a full key, kept offline;
 *  - an encrypted backup file of an identity's keys (a passphrase through scrypt, AES-256-GCM) to restore them on another machine;
 *  - the code's format: Crockford base32 of the 32-byte seed plus a two-character check, in groups, so a typo is caught before anything is signed.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function base32(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
function unbase32(text: string): Uint8Array {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of text) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error("the recovery code has a character that cannot be in one");
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Uint8Array.from(out);
}
const check = (payload: string) => base32(createHash("sha256").update("asp-recovery:" + payload).digest().subarray(0, 2)).slice(0, 2);

/** A new recovery code for a 32-byte seed: "ASP-" and 54 characters in groups of six, the last two being a check. */
export function recoveryCodeFor(seed: Uint8Array): string {
  const payload = base32(seed); // 52 characters
  const all = payload + check(payload);
  return "ASP-" + all.match(/.{1,6}/g)!.join("-");
}

/** The seed a recovery code stands for; throws when the code is mistyped (wrong length, a bad character or a failed check). */
export function seedFromRecoveryCode(code: string): Uint8Array {
  const clean = code.trim().toUpperCase().replace(/^ASP[-\s]/, "").replace(/[\s-]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
  if (clean.length !== 54) throw new Error("the recovery code has the wrong length; copy it exactly as it was shown (ASP- and nine groups of six)");
  const payload = clean.slice(0, 52);
  if (check(payload) !== clean.slice(52)) throw new Error("the recovery code does not check out: a character is wrong; compare it with what you wrote down");
  return unbase32(payload).subarray(0, 32);
}

export interface KeyEntry { kid: string; seed_hex: string }
export interface KeyBackup { v: 1; kdf: "scrypt"; N: number; r: number; p: number; salt: string; iv: string; tag: string; ct: string; did: string; createdAt: string }

const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
export const MIN_PASSPHRASE = 10;

/** Encrypts an identity's keys with a passphrase. The DID is in the clear (it is public); the keys are not. */
export function encryptKeys(did: string, keys: KeyEntry[], passphrase: string, createdAt: string): KeyBackup {
  if (passphrase.length < MIN_PASSPHRASE) throw new Error(`the passphrase must be at least ${MIN_PASSPHRASE} characters`);
  const salt = randomBytes(16), iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32, SCRYPT);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(did));
  const ct = Buffer.concat([c.update(JSON.stringify(keys), "utf8"), c.final()]);
  return { v: 1, kdf: "scrypt", N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, salt: salt.toString("base64"), iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), ct: ct.toString("base64"), did, createdAt };
}

export function decryptKeys(b: KeyBackup, passphrase: string): KeyEntry[] {
  if (b?.v !== 1 || b.kdf !== "scrypt") throw new Error("this is not an asp key backup");
  try {
    const key = scryptSync(passphrase, Buffer.from(b.salt, "base64"), 32, { N: b.N, r: b.r, p: b.p, maxmem: 128 * 1024 * 1024 });
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(b.iv, "base64"));
    d.setAAD(Buffer.from(b.did));
    d.setAuthTag(Buffer.from(b.tag, "base64"));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(b.ct, "base64")), d.final()]).toString("utf8")) as KeyEntry[];
  } catch { throw new Error("the passphrase is wrong, or the backup file was changed"); }
}
