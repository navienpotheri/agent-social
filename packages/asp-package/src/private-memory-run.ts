/**
 * Private memory in a run (register rows DK272 and D12; docs/private-memory-run-design.md). The sealing is private-memory.ts; this is the custody and the run: where the two memory keys live, how the agent's key
 * is sealed to the principal, and the store the gateway opens for the length of a run, so that the agent reads and writes a scope through tools and never sees a key or the sealed file.
 *
 *   principal's key  <home>/keys/<did>.memory.json         sealed with the key passphrase when one is set (the same scrypt seal as the signing keys), mode 0600
 *   agent's key      <package>/keys/memory.json            the private half sealed to the principal's PUBLIC memory key, so a host that holds only the node key cannot read it
 *   a scope          <package>/memory/private/<scope>.sealed.json   replaced atomically; limits 256 KiB, 16 scopes, names a-z 0-9 - _ (1 to 64)
 *
 * Not here: the public halves in the passports (a passport entry type, a protocol change) and the Mandate field that names a run's private scopes (`learning.private_scopes`): a run names them with a flag for now.
 */
import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isSealed, open as openSeal, seal as sealText, type Sealed } from "./at-rest.ts";
import { newMemoryKey, openPrivateScope, sealPrivateScope, type MemoryKey, type PrivateScope, type ScopePair } from "./private-memory.ts";

export const SCOPE_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const MAX_SCOPE_BYTES = 256 * 1024;
export const MAX_SCOPES = 16;
const slug = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_");

// ---- the principal's key ----

/** The principal's memory key, made on first use and kept beside the signing keys. Sealed with the passphrase when one is given. */
export function principalMemoryKey(home: string, did: string, passphrase?: string): MemoryKey {
  const dir = join(home, "keys");
  const file = join(dir, `${slug(did)}.memory.json`);
  if (existsSync(file)) {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { sealed?: unknown; key?: MemoryKey };
    if (isSealed(raw.sealed)) { if (!passphrase) throw new Error("the principal's memory key is protected with a passphrase: set ASP_KEY_PASSPHRASE to it (not on a command line) and try again"); return JSON.parse(openSeal(raw.sealed as Sealed, passphrase)) as MemoryKey; }
    return raw.key as MemoryKey;
  }
  mkdirSync(dir, { recursive: true });
  const key = newMemoryKey();
  writeFileSync(`${file}.part`, JSON.stringify(passphrase ? { did, sealed: sealText(JSON.stringify(key), passphrase) } : { did, key }, null, 2), { mode: 0o600 });
  renameSync(`${file}.part`, file);
  return key;
}

// ---- the agent's key, sealed to the principal ----

interface SealedToPrincipal { v: 1; ephemeral: string; nonce: string; tag: string; ct: string }
const privKey = (b64: string) => createPrivateKey({ key: Buffer.from(b64, "base64"), format: "der", type: "pkcs8" });
const pubKey = (b64: string) => createPublicKey({ key: Buffer.from(b64, "base64"), format: "der", type: "spki" });
const kdf = (shared: Buffer, info: string) => Buffer.from(hkdfSync("sha256", shared, Buffer.from("asp-agent-memory-key-v1"), Buffer.from(info), 32));

function sealToPublic(plain: string, theirPublic: string): SealedToPrincipal {
  const eph = generateKeyPairSync("x25519");
  const key = kdf(diffieHellman({ privateKey: eph.privateKey, publicKey: pubKey(theirPublic) }), "agent-key");
  const nonce = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, nonce);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return { v: 1, ephemeral: eph.publicKey.export({ type: "spki", format: "der" }).toString("base64"), nonce: nonce.toString("base64"), tag: c.getAuthTag().toString("base64"), ct: ct.toString("base64") };
}
function openFromPrincipal(s: SealedToPrincipal, myPrivate: string): string {
  try {
    const key = kdf(diffieHellman({ privateKey: privKey(myPrivate), publicKey: pubKey(s.ephemeral) }), "agent-key");
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(s.nonce, "base64"));
    d.setAuthTag(Buffer.from(s.tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(s.ct, "base64")), d.final()]).toString("utf8");
  } catch { throw new Error("the agent's memory key cannot be opened with this principal's key"); }
}

/** The agent's memory key for a package: made on first use, with the private half sealed to the principal's public key. Returns the public half (it is not secret). */
export function ensureAgentMemoryKey(packageDir: string, principalPublic: string): { publicKey: string } {
  const file = join(packageDir, "keys", "memory.json");
  if (existsSync(file)) return { publicKey: (JSON.parse(readFileSync(file, "utf8")) as { publicKey: string }).publicKey };
  mkdirSync(join(packageDir, "keys"), { recursive: true });
  const key = newMemoryKey();
  writeFileSync(`${file}.part`, JSON.stringify({ v: 1, publicKey: key.publicKey, sealedPrivate: sealToPublic(key.privateKey, principalPublic) }, null, 2), { mode: 0o600 });
  renameSync(`${file}.part`, file);
  return { publicKey: key.publicKey };
}

/** Opens the agent's memory key with the principal's private key (the gateway does this once at the start of a run and holds the result in memory only). */
export function unsealAgentMemoryKey(packageDir: string, principalPrivate: string): MemoryKey {
  const raw = JSON.parse(readFileSync(join(packageDir, "keys", "memory.json"), "utf8")) as { publicKey: string; sealedPrivate: SealedToPrincipal };
  return { publicKey: raw.publicKey, privateKey: openFromPrincipal(raw.sealedPrivate, principalPrivate) };
}

// ---- the run's store ----

export interface PrivateMemoryEvent { kind: "read" | "write" | "refused" | "list"; scope?: string; bytes?: number; sha256?: string; reason?: string }
export interface PrivateMemoryOptions {
  /** `<package>/memory/private` */ dir: string;
  pair: ScopePair;
  /** The agent's memory key (private and public), opened for this run. */
  agentKey: MemoryKey;
  principalPublic: string;
  /** The scopes this run may use; undefined or empty means none. */
  allowed?: string[];
  /** Told of every read, write and refusal: the scope name, the size and a hash of the plaintext, never the plaintext. */
  onEvent?: (e: PrivateMemoryEvent) => void;
}

export class PrivateMemoryRun {
  private o: PrivateMemoryOptions;
  blocked = 0;
  constructor(o: PrivateMemoryOptions) { this.o = o; }
  private file(scope: string) { return join(this.o.dir, `${scope}.sealed.json`); }
  private refuse(scope: string, reason: string): never { this.blocked++; this.o.onEvent?.({ kind: "refused", scope: scope.slice(0, 64), reason }); throw new Error(reason); }
  private check(scope: unknown): string {
    if (typeof scope !== "string" || !SCOPE_NAME.test(scope)) this.refuse(String(scope).slice(0, 64), "a scope name is 1 to 64 characters from a-z, 0-9, - and _");
    if (!this.o.allowed?.includes(scope as string)) this.refuse(scope as string, `the private scope ${scope} is not one this run's Mandate names`);
    return scope as string;
  }
  /** The scopes that exist on disk. */
  existing(): string[] { return existsSync(this.o.dir) ? readdirSync(this.o.dir).filter((f) => f.endsWith(".sealed.json")).map((f) => f.slice(0, -".sealed.json".length)).sort() : []; }

  read(scopeArg: unknown): string {
    const scope = this.check(scopeArg);
    if (!existsSync(this.file(scope))) { this.o.onEvent?.({ kind: "read", scope, bytes: 0 }); return ""; }
    const sealed = JSON.parse(readFileSync(this.file(scope), "utf8")) as PrivateScope;
    const text = openPrivateScope(sealed, this.o.agentKey.privateKey, this.o.principalPublic, this.o.pair, scope).toString("utf8");
    this.o.onEvent?.({ kind: "read", scope, bytes: Buffer.byteLength(text), sha256: createHash("sha256").update(text).digest("hex") });
    return text;
  }

  write(scopeArg: unknown, text: unknown): { bytes: number } {
    const scope = this.check(scopeArg);
    if (typeof text !== "string") this.refuse(scope, "the text to write is a string");
    const bytes = Buffer.byteLength(text as string);
    if (bytes > MAX_SCOPE_BYTES) this.refuse(scope, `a private scope is at most ${MAX_SCOPE_BYTES / 1024} KiB (this write is ${Math.ceil(bytes / 1024)} KiB)`);
    if (!existsSync(this.file(scope)) && this.existing().length >= MAX_SCOPES) this.refuse(scope, `an agent has at most ${MAX_SCOPES} private scopes`);
    const sealed = sealPrivateScope(text as string, this.o.agentKey.privateKey, this.o.principalPublic, this.o.pair, scope);
    mkdirSync(this.o.dir, { recursive: true });
    const f = this.file(scope);
    writeFileSync(`${f}.part`, JSON.stringify(sealed), { mode: 0o600 });
    renameSync(`${f}.part`, f);
    this.o.onEvent?.({ kind: "write", scope, bytes, sha256: createHash("sha256").update(text as string).digest("hex") });
    return { bytes };
  }
  list(): string[] { const names = this.existing().filter((s) => this.o.allowed?.includes(s)); this.o.onEvent?.({ kind: "list", bytes: names.length }); return names; }
}

/** The tool names of the gateway's private memory (the MCP tools of the asp server). A model's call may carry a prefix such as `mcp__asp__`. */
export const PRIVATE_TOOL = /memory_private_(read|write|list)$/;
/** What a call to a private tool may be shown as in a log: the scope, the size and a hash, never the text. */
export function privateCallSummary(args: unknown): Record<string, unknown> {
  const a = (args ?? {}) as { scope?: unknown; text?: unknown };
  return { scope: typeof a.scope === "string" ? a.scope.slice(0, 64) : undefined, ...(typeof a.text === "string" ? { bytes: Buffer.byteLength(a.text), sha256: createHash("sha256").update(a.text).digest("hex") } : {}) };
}
