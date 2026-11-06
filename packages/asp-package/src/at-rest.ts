/**
 * Secrets at rest (gaps U5, P20, MOCKS #10): a key file and the saved login were plain text on disk, readable by anything that can read the person's folder (a stolen laptop, a
 * backup, another program). With a passphrase they are sealed: scrypt makes a key from the passphrase and a random salt, and AES-256-GCM encrypts and authenticates the secret, so a
 * wrong passphrase or a changed file is refused, not read as garbage.
 *
 * The passphrase comes from the environment (`ASP_KEY_PASSPHRASE`), never from a command line, where other programs can see it. With none set, nothing changes: plain files still
 * work and are still written. This is a first step; the OS keychain (which needs no passphrase to be typed) is still to do.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

export interface Sealed { v: 1; kdf: "scrypt"; N: number; r: number; p: number; salt: string; nonce: string; tag: string; ct: string }

/** The passphrase the person set, if any. An empty string is no passphrase. */
export function passphraseFrom(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const p = env.ASP_KEY_PASSPHRASE;
  return p && p.length > 0 ? p : undefined;
}

const N = 1 << 15;
const keyCache = new Map<string, Buffer>();
function derive(passphrase: string, salt: Buffer, n: number, r: number, p: number): Buffer {
  const id = `${salt.toString("hex")}:${n}:${r}:${p}:${passphrase}`;
  let k = keyCache.get(id);
  if (!k) {
    k = scryptSync(passphrase, salt, 32, { N: n, r, p, maxmem: 128 * n * r * 2 });
    if (keyCache.size > 64) keyCache.clear();
    keyCache.set(id, k);
  }
  return k;
}

export const isSealed = (x: unknown): x is Sealed => !!x && typeof x === "object" && (x as Sealed).v === 1 && (x as Sealed).kdf === "scrypt" && typeof (x as Sealed).ct === "string";

/** Encrypts `plain` under the passphrase. */
export function seal(plain: string, passphrase: string): Sealed {
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", derive(passphrase, salt, N, 8, 1), nonce);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return { v: 1, kdf: "scrypt", N, r: 8, p: 1, salt: salt.toString("base64"), nonce: nonce.toString("base64"), tag: c.getAuthTag().toString("base64"), ct: ct.toString("base64") };
}

/** Decrypts; throws a plain-words error when the passphrase is wrong or the file was changed. */
export function open(s: Sealed, passphrase: string): string {
  try {
    const d = createDecipheriv("aes-256-gcm", derive(passphrase, Buffer.from(s.salt, "base64"), s.N, s.r, s.p), Buffer.from(s.nonce, "base64"));
    d.setAuthTag(Buffer.from(s.tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(s.ct, "base64")), d.final()]).toString("utf8");
  } catch {
    throw new Error("wrong passphrase, or the protected file was changed");
  }
}

/** What to tell a person whose secret is sealed and who has not set the passphrase. */
export const NEEDS_PASSPHRASE = "it is protected with a passphrase: set ASP_KEY_PASSPHRASE to it (not on a command line) and try again";
