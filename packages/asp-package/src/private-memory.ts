/**
 * A private memory scope for one principal-agent pair (register row DK272; docs/privacy-line.md, D12). Memory in a package is a folder on the sponsor's machine, readable by whoever runs there; a private scope
 * is sealed to the pair instead: each side has its own X25519 memory key (kept with its other keys, never the node's), the scope key is HKDF over the Diffie-Hellman secret of the two keys and the pair's names,
 * and the scope is AES-256-GCM with the pair, the scope name and a version bound in as authenticated data. So:
 *   - the principal (their private key and the agent's public key) and the agent (its private key and the principal's public key) derive the same key and can read and write;
 *   - another agent of the same sponsor has a different key and derives another one; a host that holds only a node key, or only public keys, derives nothing;
 *   - a scope opened under another pair, another scope name or after any change to it is refused, not read as garbage.
 * This is the sealing. Running an agent so that its private scope is opened only inside that agent's run for that principal (key custody in `asp run`, a hosted resident's package) is not built here; the register row says so.
 */
import { createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from "node:crypto";

export interface MemoryKey { privateKey: string; publicKey: string }
export interface PrivateScope { v: 1; alg: "x25519-hkdf-sha256+aes-256-gcm"; scope: string; nonce: string; tag: string; ct: string }
/** Who the scope belongs to: the principal's and the agent's DIDs. Both are part of the key and of the authenticated data. */
export interface ScopePair { principal: string; agent: string }

/** A new memory key: the private half as base64 PKCS8 (keep it with the other keys), the public half as base64 SPKI (it may be published). */
export function newMemoryKey(): MemoryKey {
  const { privateKey, publicKey } = generateKeyPairSync("x25519");
  return { privateKey: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"), publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64") };
}

const priv = (b64: string) => createPrivateKey({ key: Buffer.from(b64, "base64"), format: "der", type: "pkcs8" });
const pub = (b64: string) => createPublicKey({ key: Buffer.from(b64, "base64"), format: "der", type: "spki" });

function scopeKey(mine: string, theirPublic: string, pair: ScopePair, scope: string): Buffer {
  const shared = diffieHellman({ privateKey: priv(mine), publicKey: pub(theirPublic) });
  return Buffer.from(hkdfSync("sha256", shared, Buffer.from("asp-private-memory-v1"), Buffer.from(`${pair.principal}\n${pair.agent}\n${scope}`), 32));
}
const aad = (pair: ScopePair, scope: string) => Buffer.from(JSON.stringify(["asp-private-memory-v1", pair.principal, pair.agent, scope]));

/** Seals `plain` as the scope `scope` of the pair. `mine` is the caller's private memory key and `theirPublic` the other side's public key. */
export function sealPrivateScope(plain: string | Buffer, mine: string, theirPublic: string, pair: ScopePair, scope: string): PrivateScope {
  const nonce = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", scopeKey(mine, theirPublic, pair, scope), nonce);
  c.setAAD(aad(pair, scope));
  const ct = Buffer.concat([c.update(typeof plain === "string" ? Buffer.from(plain, "utf8") : plain), c.final()]);
  return { v: 1, alg: "x25519-hkdf-sha256+aes-256-gcm", scope, nonce: nonce.toString("base64"), tag: c.getAuthTag().toString("base64"), ct: ct.toString("base64") };
}

/** Opens a scope. Throws when the key is not the pair's, the pair or the scope name differs, or the scope was changed. */
export function openPrivateScope(sealed: PrivateScope, mine: string, theirPublic: string, pair: ScopePair, scope: string): Buffer {
  if (sealed.v !== 1 || sealed.alg !== "x25519-hkdf-sha256+aes-256-gcm" || sealed.scope !== scope) throw new Error("this is not that private scope");
  try {
    const d = createDecipheriv("aes-256-gcm", scopeKey(mine, theirPublic, pair, scope), Buffer.from(sealed.nonce, "base64"));
    d.setAAD(aad(pair, scope));
    d.setAuthTag(Buffer.from(sealed.tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(sealed.ct, "base64")), d.final()]);
  } catch { throw new Error("the private scope cannot be opened with these keys (wrong pair, wrong scope, or it was changed)"); }
}
