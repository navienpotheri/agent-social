/**
 * The service-held signer for hosted bots (register row DK532; spec-delta S956; owner decision 2026-11-18, CY8). A hosted bot is an agent with no machine of its own that its sponsor asks the service to
 * run. For it, and only it, the service makes and holds the signing key and signs records on its behalf; the agent's passport says `custody: service`, so the record shows the mode. A local agent's key
 * never reaches this store: `create` is the only way a key enters it, it makes the key here, and `sign` refuses any DID it did not create. The store is one file, encrypted with AES-256-GCM under a
 * key derived (scrypt) from a passphrase the operator supplies from the environment, never a flag and never written beside the file.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { b64urlDecode, b64urlEncode, createRecord, publicKeyFromSeed, randomSeed, signerFromSeed, type AspRecord, type Signer } from "@agent-social/asp-core";

export class HostedSignerError extends Error {}

interface Sealed { v: 1; salt: string; iv: string; tag: string; data: string }

export class HostedSigner {
  private readonly file: string;
  private readonly passphrase: string;
  private seeds = new Map<string, string>();

  constructor(file: string, passphrase: string) {
    if (!passphrase || passphrase.length < 12) throw new HostedSignerError("the hosted signer needs a passphrase of at least 12 characters from the environment");
    this.file = file;
    this.passphrase = passphrase;
    if (existsSync(file)) {
      const s = JSON.parse(readFileSync(file, "utf8")) as Sealed;
      const key = scryptSync(passphrase, b64urlDecode(s.salt), 32);
      const d = createDecipheriv("aes-256-gcm", key, b64urlDecode(s.iv));
      d.setAuthTag(b64urlDecode(s.tag));
      try { this.seeds = new Map(Object.entries(JSON.parse(Buffer.concat([d.update(b64urlDecode(s.data)), d.final()]).toString("utf8")))); }
      catch { throw new HostedSignerError("the hosted signer file does not open with this passphrase"); }
    }
  }

  private save(): void {
    const salt = randomBytes(16), iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", scryptSync(this.passphrase, salt, 32), iv);
    const data = Buffer.concat([c.update(JSON.stringify(Object.fromEntries(this.seeds)), "utf8"), c.final()]);
    const sealed: Sealed = { v: 1, salt: b64urlEncode(salt), iv: b64urlEncode(iv), tag: b64urlEncode(c.getAuthTag()), data: b64urlEncode(data) };
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(sealed) + "\n", { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  has(did: string): boolean { return this.seeds.has(did); }

  /** Makes a key for a new hosted bot here and returns only the public half, for its passport. The private half never leaves this store. */
  create(did: string): { kid: string; publicKey: Uint8Array } {
    if (this.seeds.has(did)) throw new HostedSignerError(`${did} already has a hosted key`);
    const seed = randomSeed();
    this.seeds.set(did, b64urlEncode(seed));
    this.save();
    return { kid: `${did}#key-1`, publicKey: publicKeyFromSeed(seed) };
  }

  /** The signer of a hosted bot; refuses any identity this store did not make (a local agent's key is never here). */
  signerFor(did: string): Signer {
    const seed = this.seeds.get(did);
    if (!seed) throw new HostedSignerError(`${did} is not a hosted bot: its key is on its owner's machine, and this service holds no key for it`);
    return signerFromSeed(`${did}#key-1`, b64urlDecode(seed));
  }

  /** Signs a record for a hosted bot as its issuer. */
  sign(did: string, init: { type: string; subject: string | null; body: Record<string, unknown>; prev: string | null; issued_at: string }): AspRecord {
    return createRecord({ type: init.type as never, issuer: did, subject: init.subject, body: init.body, prev: init.prev, issued_at: init.issued_at }, this.signerFor(did));
  }
}
