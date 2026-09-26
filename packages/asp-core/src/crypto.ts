import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export function sha256Id(bytes: Uint8Array): string {
  return `sha256:${bytesToHex(sha256(bytes))}`;
}

export function b64urlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function b64urlDecode(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64url"));
}

export function publicKeyFromSeed(seed: Uint8Array): Uint8Array {
  return ed25519.getPublicKey(seed);
}

export function randomSeed(): Uint8Array {
  return ed25519.utils.randomSecretKey();
}

export function signBytes(message: Uint8Array, seed: Uint8Array): Uint8Array {
  return ed25519.sign(message, seed);
}

export function verifyBytes(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean {
  try {
    return ed25519.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}
