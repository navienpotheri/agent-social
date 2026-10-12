/**
 * Run-log custody (gap E16, launch blocker 12 item 7). A run log (the redacted record of what an agent was asked, answered and did) is on the person's machine. This file is the
 * optional second copy and the way a court can be given it:
 *
 *  - the person seals the log on their own machine: AES-256-GCM under a random data key, and the data key wrapped to the person (and to anyone they name) with X25519. The service
 *    holds only the sealed envelope (ciphertext and public header), never a key, and cannot read it;
 *  - the person's wrapping key is derived from their identity key (the Ed25519 seed, the same conversion libsodium uses), so a person who restores their identity from the
 *    recovery code or a backup can open their sealed logs again, with nothing new to keep;
 *  - a disclosure wraps the data key to a panel's jurors (or the operator's court) and is signed by the person, naming the log by its hash, who it is for and why. The ciphertext is
 *    not re-encrypted and the service sees nothing change but a longer recipient list;
 *  - whoever opens it checks the log's hash against what the Actions committed to (asp run-log verify), so a disclosed log cannot be swapped for another.
 */
import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { b64urlDecode, b64urlEncode, canonicalBytes, signBytes, verifyBytes } from "@agent-social/asp-core";
import type { Tenant } from "@agent-social/asp-log";

const P = (1n << 255n) - 19n;
const PKCS8_X25519 = Buffer.from("302e020100300506032b656e04220420", "hex");
const SPKI_X25519 = Buffer.from("302a300506032b656e032100", "hex");
const sha256hex = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

function powmod(b: bigint, e: bigint, m: bigint): bigint {
  let r = 1n; b %= m;
  while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; }
  return r;
}
const leToBig = (b: Uint8Array) => { let n = 0n; for (let i = b.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(b[i]); return n; };
const bigToLe = (n: bigint) => { const out = Buffer.alloc(32); for (let i = 0; i < 32; i++) { out[i] = Number(n & 255n); n >>= 8n; } return out; };

/** The X25519 public key for an Ed25519 public key (the birational map u = (1 + y) / (1 - y)). */
export function x25519PublicFromEd25519(edPublic: Uint8Array): Buffer {
  if (edPublic.length !== 32) throw new Error("an Ed25519 public key is 32 bytes");
  const copy = Buffer.from(edPublic); copy[31] &= 0x7f;
  const y = leToBig(copy);
  if (y >= P || y === 1n) throw new Error("this public key cannot be used for encryption");
  const u = ((1n + y) * powmod((P + 1n - y) % P, P - 2n, P)) % P;
  return bigToLe(u);
}

/** The X25519 private key (clamped scalar) for an Ed25519 seed: SHA-512 of the seed, first half, as in libsodium's crypto_sign_ed25519_sk_to_curve25519. */
export function x25519PrivateFromEd25519Seed(seed: Uint8Array): Buffer {
  const h = createHash("sha512").update(seed).digest().subarray(0, 32);
  const k = Buffer.from(h);
  k[0] &= 248; k[31] &= 127; k[31] |= 64;
  return k;
}
const privKey = (raw: Buffer) => createPrivateKey({ key: Buffer.concat([PKCS8_X25519, raw]), format: "der", type: "pkcs8" });
const pubKey = (raw: Buffer) => createPublicKey({ key: Buffer.concat([SPKI_X25519, raw]), format: "der", type: "spki" });

export interface Recipient { did: string; kid: string; epk: string; iv: string; tag: string; wrapped: string }
export interface Disclosure { v: 1; type: "asp.runlog.disclosure"; contract: string; owner: string; run_log_sha256: string; to: string[]; reason: string; at: string; signature: string }
export interface SealedRunLog {
  v: 1;
  kind: "asp.runlog.sealed";
  /** One per run: the contract and the first event's hash (a standing job has a run log for each session). */
  id: string;
  contract: string;
  owner: string;
  /** SHA-256 of the run-log file as it was sealed (the file's bytes). */
  run_log_sha256: string;
  /** The log's own hash chain head and event count (what the Actions commit to), so a reader can check it against the log without opening it. */
  head?: { events: number; hash: string };
  bytes: number;
  createdAt: string;
  iv: string; tag: string; ct: string;
  recipients: Recipient[];
  disclosures: Disclosure[];
}

const headerAad = (e: Pick<SealedRunLog, "v" | "kind" | "id" | "contract" | "owner" | "run_log_sha256" | "bytes" | "createdAt">) =>
  Buffer.from(JSON.stringify({ v: e.v, kind: e.kind, id: e.id, contract: e.contract, owner: e.owner, run_log_sha256: e.run_log_sha256, bytes: e.bytes, createdAt: e.createdAt }));

function wrapKey(dataKey: Buffer, id: string, did: string, kid: string, edPublic: Uint8Array): Recipient {
  const rpk = x25519PublicFromEd25519(edPublic);
  const eph = generateKeyPairSync("x25519");
  const epkRaw = (eph.publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(-32);
  const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: pubKey(rpk) });
  const kek = Buffer.from(hkdfSync("sha256", shared, Buffer.concat([epkRaw, rpk]), "asp-runlog-wrap-v1", 32));
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", kek, iv);
  c.setAAD(Buffer.from(`${id}|${did}`));
  const wrapped = Buffer.concat([c.update(dataKey), c.final()]);
  return { did, kid, epk: b64urlEncode(epkRaw), iv: b64urlEncode(iv), tag: b64urlEncode(c.getAuthTag()), wrapped: b64urlEncode(wrapped) };
}

function unwrapKey(env: SealedRunLog, did: string, seed: Uint8Array): Buffer {
  const mine = env.recipients.filter((r) => r.did === did);
  if (!mine.length) throw new Error(`this sealed log was not sealed for ${did}`);
  const priv = x25519PrivateFromEd25519Seed(seed);
  const rpkRaw = (createPublicKey(privKey(priv)).export({ format: "der", type: "spki" }) as Buffer).subarray(-32);
  for (const r of mine) {
    try {
      const shared = diffieHellman({ privateKey: privKey(priv), publicKey: pubKey(Buffer.from(b64urlDecode(r.epk))) });
      const kek = Buffer.from(hkdfSync("sha256", shared, Buffer.concat([Buffer.from(b64urlDecode(r.epk)), rpkRaw]), "asp-runlog-wrap-v1", 32));
      const d = createDecipheriv("aes-256-gcm", kek, Buffer.from(b64urlDecode(r.iv)));
      d.setAAD(Buffer.from(`${env.id}|${did}`));
      d.setAuthTag(Buffer.from(b64urlDecode(r.tag)));
      return Buffer.concat([d.update(Buffer.from(b64urlDecode(r.wrapped))), d.final()]);
    } catch { /* another of this identity's keys may be the one */ }
  }
  throw new Error("this key cannot open the sealed log (wrong key, or the file was changed)");
}

/** A public key to seal for: an identity's DID, the key's id and its Ed25519 public key. An identity with more than one live key (its own and a recovery key) is given one entry per key, so either opens the log. */
export interface PublicKeyOf { did: string; kid: string; edPublic: Uint8Array }

/** Seals a run-log file for its owner (and anyone else named). Everything but the ciphertext and the wrapped keys is public by design. */
export function sealRunLog(plaintext: Uint8Array, o: { id: string; contract: string; owner: PublicKeyOf[]; also?: PublicKeyOf[]; head?: { events: number; hash: string }; createdAt: string }): SealedRunLog {
  const dataKey = randomBytes(32), iv = randomBytes(12);
  const header = { v: 1 as const, kind: "asp.runlog.sealed" as const, id: o.id, contract: o.contract, owner: o.owner[0].did, run_log_sha256: sha256hex(plaintext), bytes: plaintext.length, createdAt: o.createdAt };
  const c = createCipheriv("aes-256-gcm", dataKey, iv);
  c.setAAD(headerAad(header));
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  const people = [...o.owner, ...(o.also ?? []).filter((p) => p.did !== o.owner[0].did)];
  return { ...header, ...(o.head ? { head: o.head } : {}), iv: b64urlEncode(iv), tag: b64urlEncode(c.getAuthTag()), ct: b64urlEncode(ct), recipients: people.map((p) => wrapKey(dataKey, o.id, p.did, p.kid, p.edPublic)), disclosures: [] };
}

/** Decrypts a sealed log for a recipient who holds the identity's seed; throws unless the plaintext is exactly what was sealed. */
export function openRunLog(env: SealedRunLog, did: string, seed: Uint8Array): Buffer {
  if (env?.v !== 1 || env.kind !== "asp.runlog.sealed") throw new Error("this is not a sealed run log");
  const dataKey = unwrapKey(env, did, seed);
  try {
    const d = createDecipheriv("aes-256-gcm", dataKey, Buffer.from(b64urlDecode(env.iv)));
    d.setAAD(headerAad(env));
    d.setAuthTag(Buffer.from(b64urlDecode(env.tag)));
    const plain = Buffer.concat([d.update(Buffer.from(b64urlDecode(env.ct))), d.final()]);
    if (sha256hex(plain) !== env.run_log_sha256) throw new Error("hash");
    return plain;
  } catch { throw new Error("the sealed log does not decrypt: it was changed"); }
}

const disclosureBytes = (d: Omit<Disclosure, "signature">) => canonicalBytes(d);

/**
 * The owner discloses the log to others (a panel's jurors, the operator's court): the data key is wrapped to each, and the owner signs a statement of who it is for and why. Returns
 * a new envelope; the original is unchanged. Anyone already a recipient is left as they were.
 */
export function discloseRunLog(env: SealedRunLog, owner: { did: string; seed: Uint8Array }, to: PublicKeyOf[], reason: string, at: string): SealedRunLog {
  if (owner.did !== env.owner) throw new Error(`only the owner (${env.owner}) can disclose this log`);
  if (!to.length) throw new Error("name at least one recipient");
  if (!reason.trim()) throw new Error("say why the log is being disclosed (--reason)");
  const dataKey = unwrapKey(env, owner.did, owner.seed);
  const have = new Set(env.recipients.map((r) => r.kid));
  const added = to.filter((t) => !have.has(t.kid));
  const stmt: Omit<Disclosure, "signature"> = { v: 1, type: "asp.runlog.disclosure", contract: env.contract, owner: env.owner, run_log_sha256: env.run_log_sha256, to: [...new Set(to.map((t) => t.did))], reason: reason.trim(), at };
  const signature = b64urlEncode(signBytes(disclosureBytes(stmt), owner.seed));
  return { ...env, recipients: [...env.recipients, ...added.map((t) => wrapKey(dataKey, env.id, t.did, t.kid, t.edPublic))], disclosures: [...env.disclosures, { ...stmt, signature }] };
}

/** Checks every disclosure in an envelope against the owner's public key: signed by the owner, for this log. Returns the problems (empty when all is well). */
export function checkDisclosures(env: SealedRunLog, ownerEdPublic: Uint8Array[]): string[] {
  const bad: string[] = [];
  for (const d of env.disclosures) {
    const { signature, ...stmt } = d;
    if (d.owner !== env.owner || d.contract !== env.contract || d.run_log_sha256 !== env.run_log_sha256) bad.push(`a disclosure at ${d.at} is for a different log`);
    else if (!ownerEdPublic.some((k) => verifyBytes(b64urlDecode(signature), disclosureBytes(stmt), k))) bad.push(`a disclosure at ${d.at} is not signed by the owner`);
    for (const t of d.to) if (!env.recipients.some((r) => r.did === t)) bad.push(`disclosed to ${t} but no key was wrapped for them`);
  }
  return bad;
}

// ---- the service ----------------------------------------------------------------------------------------------------------------------------------------------------

export interface RunLogServiceOptions {
  root: string;
  /** Largest single sealed log, in bytes. Default 16 MiB. */
  maxBytes?: number;
  /** Storage per tenant. Default 64 MiB. */
  defaultQuotaBytes?: number;
}
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const TENANT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const SUFFIX = ".sealed.json";
const fileFor = (id: string) => encodeURIComponent(id).replace(/%/g, "_") + SUFFIX;

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | number> = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text), ...headers });
  res.end(text);
}
const fail = (res: ServerResponse, status: number, code: string, message: string, extra: object = {}) => send(res, status, { ok: false, error: { code, message, ...extra } });

async function readRaw(req: IncomingMessage, max: number): Promise<Buffer | undefined> {
  const chunks: Buffer[] = []; let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > max) return undefined; chunks.push(c as Buffer); }
  return Buffer.concat(chunks);
}
const usage = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(SUFFIX)).reduce((n, f) => n + statSync(join(dir, f)).size, 0) : 0);

/** The shape the service checks before it stores anything: it cannot read the log, but it will not keep a file that is not a sealed envelope for this contract. */
export function sealedShapeProblem(e: any, id: string): string | undefined {
  if (!e || e.v !== 1 || e.kind !== "asp.runlog.sealed") return "the body is not a sealed run log";
  if (e.id !== id) return "the envelope is for a different run";
  if (typeof e.contract !== "string" || !e.contract) return "the envelope has no contract";
  for (const f of ["owner", "run_log_sha256", "createdAt", "iv", "tag", "ct"]) if (typeof e[f] !== "string" || !e[f]) return `the envelope has no ${f}`;
  if (!Array.isArray(e.recipients) || !e.recipients.length || !Array.isArray(e.disclosures)) return "the envelope has no recipients";
  if (e.recipients.length > 20) return "at most 20 recipients";
  for (const r of e.recipients) if (!r || typeof r.did !== "string" || typeof r.kid !== "string" || typeof r.epk !== "string" || typeof r.wrapped !== "string") return "a recipient is malformed";
  return undefined;
}

/**
 *   PUT    /runlogs/<id>     body = a sealed envelope (JSON); If-Match: <etag> to replace, If-None-Match: * to create
 *   GET    /runlogs/<id>     the envelope
 *   GET    /runlogs              the tenant's sealed logs (contract, size, owner, hash, recipients, disclosures) and storage use
 *   DELETE /runlogs/<id>  
 * Each tenant has its own folder and a byte quota. Only the tenant itself reads or writes its sealed logs; an admin may read another tenant's with ?tenant=<name> (to hand a court
 * the sealed file the owner asked for) but cannot open it.
 */
export function runLogRoutes(opts: RunLogServiceOptions) {
  const max = opts.maxBytes ?? 16 * 1024 * 1024;
  const defaultQuota = opts.defaultQuotaBytes ?? 64 * 1024 * 1024;
  return async (req: IncomingMessage, res: ServerResponse, ctx: { tenant: Tenant }): Promise<boolean> => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname !== "/runlogs" && !url.pathname.startsWith("/runlogs/")) return false;
    const me = ctx.tenant;
    const asked = url.searchParams.get("tenant");
    if (asked && asked !== me.name && me.role !== "admin") { fail(res, 403, "FORBIDDEN", "only an admin may use another tenant's sealed logs"); return true; }
    const owner = asked ?? me.name;
    if (!TENANT.test(owner)) { fail(res, 400, "BAD_TENANT", "tenant name is not usable as a folder"); return true; }
    const dir = join(opts.root, owner);
    const quota = (owner === me.name ? me.quotaBytes : undefined) ?? defaultQuota;
    const method = req.method ?? "GET";

    if (url.pathname === "/runlogs") {
      if (method !== "GET") { fail(res, 405, "METHOD", "GET /runlogs"); return true; }
      const logs = [];
      for (const f of existsSync(dir) ? readdirSync(dir).filter((x) => x.endsWith(SUFFIX)) : []) {
        try {
          const e = JSON.parse(readFileSync(join(dir, f), "utf8")) as SealedRunLog;
          logs.push({ id: e.id, contract: e.contract, owner: e.owner, bytes: statSync(join(dir, f)).size, run_log_sha256: e.run_log_sha256, head: e.head, createdAt: e.createdAt, recipients: e.recipients.map((r) => r.did), disclosures: e.disclosures.length });
        } catch { /* a file that is not readable is not listed */ }
      }
      send(res, 200, { ok: true, tenant: owner, usedBytes: usage(dir), quotaBytes: quota, runLogs: logs });
      return true;
    }

    const id = decodeURIComponent(url.pathname.slice("/runlogs/".length));
    if (!ID.test(id)) { fail(res, 400, "BAD_ID", "a run id is letters, digits and . _ : - (up to 160)"); return true; }
    const file = join(dir, fileFor(id));
    const current = existsSync(file) ? sha256hex(readFileSync(file)) : undefined;
    const ifMatch = req.headers["if-match"]?.toString().replace(/"/g, "");
    const ifNone = req.headers["if-none-match"]?.toString();

    if (method === "GET") {
      if (!current) { fail(res, 404, "NOT_FOUND", `no sealed run log ${id}`); return true; }
      const bytes = readFileSync(file);
      res.writeHead(200, { "content-type": "application/json", "content-length": bytes.length, etag: `"${current}"` });
      res.end(bytes);
      return true;
    }
    if (owner !== me.name) { fail(res, 403, "FORBIDDEN", "an admin reads another tenant's sealed logs but does not change them"); return true; }

    if (method === "DELETE") {
      if (!current) { fail(res, 404, "NOT_FOUND", `no sealed run log ${id}`); return true; }
      if (ifMatch && ifMatch !== current) { fail(res, 412, "STALE", "the stored copy has changed", { etag: current }); return true; }
      rmSync(file);
      send(res, 200, { ok: true });
      return true;
    }
    if (method !== "PUT") { fail(res, 405, "METHOD", "PUT, GET or DELETE"); return true; }
    if (!ifMatch && ifNone !== "*") { fail(res, 428, "PRECONDITION_REQUIRED", "send If-Match: <etag> to replace a sealed log, or If-None-Match: * to create one"); return true; }
    const bytes = await readRaw(req, max);
    if (!bytes) { fail(res, 413, "TOO_LARGE", `a sealed run log may be at most ${max} bytes`); return true; }
    if (current && ifNone === "*") { fail(res, 412, "EXISTS", `a sealed log ${id} already exists`, { etag: current }); return true; }
    if (!current && ifMatch) { fail(res, 412, "STALE", `no sealed log ${id} to replace`); return true; }
    if (current && ifMatch !== current) { fail(res, 412, "STALE", "the service holds a different copy than the one you started from", { etag: current }); return true; }
    let env: unknown;
    try { env = JSON.parse(bytes.toString("utf8")); } catch { fail(res, 422, "NOT_SEALED", "the body is not JSON"); return true; }
    const problem = sealedShapeProblem(env, id);
    if (problem) { fail(res, 422, "NOT_SEALED", problem); return true; }
    if (usage(dir) - (current ? statSync(file).size : 0) + bytes.length > quota) { fail(res, 413, "QUOTA", `this would exceed ${owner}'s sealed-log storage of ${quota} bytes`); return true; }
    mkdirSync(dir, { recursive: true });
    writeFileSync(file + ".part", bytes);
    renameSync(file + ".part", file);
    send(res, 200, { ok: true, id, etag: sha256hex(bytes), bytes: bytes.length }, { etag: `"${sha256hex(bytes)}"` });
    return true;
  };
}

/** What an account export or close needs to know about a tenant's sealed logs. */
export function sealedLogsOf(root: string | undefined, tenant: string): { id: string; contract: string; bytes: number }[] {
  if (!root || !TENANT.test(tenant)) return [];
  const dir = join(root, tenant);
  if (!existsSync(dir)) return [];
  const out: { id: string; contract: string; bytes: number }[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(SUFFIX))) {
    try { const e = JSON.parse(readFileSync(join(dir, f), "utf8")) as SealedRunLog; out.push({ id: e.id, contract: e.contract, bytes: statSync(join(dir, f)).size }); } catch { /* skip */ }
  }
  return out;
}
