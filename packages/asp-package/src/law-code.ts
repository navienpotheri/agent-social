/**
 * The Code of the City as a thing the software can hold (gap LW1): its text, its version, its hash, a short form for an agent's context, and the operator's signature when it has one.
 * The text is docs/law/code.md; the versions that have been pinned, each with the hash of its text and (once the operator signs) a signature, are in docs/law/versions.json. A text that is
 * edited without a new pin is caught (`asp law verify`, and a test), so the Code cannot change quietly: a change is a new version.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { b64urlDecode, b64urlEncode, didOf, publicKeyFromDidKey, signBytes, verifyBytes, type Signer } from "@agent-social/asp-core";

export interface CodeSignature { by: string; kid: string; signature: string }
export interface CodePin { version: string; sha256: string; status: "draft" | "in_force"; signed?: CodeSignature }
export interface CodeInfo {
  version: string;
  status: "draft" | "in_force";
  text: string;
  sha256: string;
  /** What the pin file says about this version, if anything. */
  pin?: CodePin;
}

export const CODE_FILE = fileURLToPath(new URL("../../../docs/law/code.md", import.meta.url));
export const VERSIONS_FILE = fileURLToPath(new URL("../../../docs/law/versions.json", import.meta.url));

const hash = (text: string) => createHash("sha256").update(text.replace(/\r\n/g, "\n"), "utf8").digest("hex");

/** The message the operator signs: the version and the hash, so a signature belongs to one text. */
export const signedMessage = (version: string, sha256: string) => new TextEncoder().encode(`asp.law.code.v1:${version}:${sha256}`);

function readPins(file: string): CodePin[] {
  try { return (JSON.parse(readFileSync(file, "utf8")) as { versions?: CodePin[] }).versions ?? []; } catch { return []; }
}

/** Reads the Code: the text, its version from the heading ("draft 0.2" or "version 1.0"), its hash and its pin. */
export function readCode(files: { code?: string; versions?: string } = {}): CodeInfo {
  const text = readFileSync(files.code ?? CODE_FILE, "utf8").replace(/\r\n/g, "\n");
  const m = /^# The Code of the City: (draft|version) (\S+)/m.exec(text);
  if (!m) throw new Error("the Code has no version in its heading (# The Code of the City: draft 0.2)");
  const version = m[2];
  const sha256 = hash(text);
  const pin = readPins(files.versions ?? VERSIONS_FILE).find((p) => p.version === version);
  return { version, status: m[1] === "draft" ? "draft" : "in_force", text, sha256, ...(pin ? { pin } : {}) };
}

/** What is wrong, in words; an empty list means the text is the pinned one, and the signature (if there is one) holds. */
export function verifyCode(info: CodeInfo, opts: { publicKey?: Uint8Array } = {}): { problems: string[]; signed: boolean; signer?: string } {
  const problems: string[] = [];
  if (!info.pin) problems.push(`version ${info.version} has no pin: the text exists but its hash was never recorded (asp law pin)`);
  else {
    if (info.pin.sha256 !== info.sha256) problems.push(`the text of version ${info.version} has changed since it was pinned (pinned ${info.pin.sha256.slice(0, 12)}, now ${info.sha256.slice(0, 12)}): a change is a new version, so raise the version and pin it again`);
    if (info.pin.status !== info.status) problems.push(`the heading says ${info.status} and the pin says ${info.pin.status}`);
  }
  const sig = info.pin?.signed;
  let signed = false;
  if (sig) {
    try {
      const key = opts.publicKey ?? publicKeyFromDidKey(didOf(sig.kid));
      signed = verifyBytes(b64urlDecode(sig.signature), signedMessage(info.version, info.pin!.sha256), key);
      if (!signed) problems.push(`the operator's signature (${sig.by}) does not verify for version ${info.version} and the pinned hash`);
    } catch (e) {
      problems.push(`the signature could not be checked: ${(e as Error).message} (for a did:web operator, give the public key)`);
    }
  }
  return { problems, signed, ...(sig ? { signer: sig.by } : {}) };
}

/** Pins this text: records its version and hash (status as in the heading). A pin for a version in force is never changed. Returns what was written. */
export function pinCode(info: CodeInfo, file = VERSIONS_FILE): CodePin {
  const pins = readPins(file);
  const old = pins.find((p) => p.version === info.version);
  if (old && old.status === "in_force" && old.sha256 !== info.sha256) throw new Error(`version ${info.version} is in force and cannot be changed: raise the version`);
  const pin: CodePin = { version: info.version, sha256: info.sha256, status: info.status };
  const next = [...pins.filter((p) => p.version !== info.version), pin].sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }));
  const part = `${file}.part`;
  writeFileSync(part, JSON.stringify({ versions: next }, null, 2) + "\n");
  renameSync(part, file);
  return pin;
}

/** The operator's signature over the pinned version and hash; written into the pin file. */
export function signCode(info: CodeInfo, signer: Signer & { publicKey?: Uint8Array }, file = VERSIONS_FILE): CodeSignature {
  if (!info.pin || info.pin.sha256 !== info.sha256) throw new Error("pin this text first (asp law pin): a signature belongs to a pinned hash");
  const signature: CodeSignature = { by: didOf(signer.kid), kid: signer.kid, signature: b64urlEncode(signBytes(signedMessage(info.version, info.sha256), signer.seed)) };
  const pins = readPins(file).map((p) => (p.version === info.version ? { ...p, signed: signature } : p));
  const part = `${file}.part`;
  writeFileSync(part, JSON.stringify({ versions: pins }, null, 2) + "\n");
  renameSync(part, file);
  return signature;
}

/**
 * The short form that goes into an agent's context on every run (a few hundred words, not the whole text): the rule of each article in a line, the version and the start of the hash
 * so it can be checked, and the duty to stop and ask. The full text is `asp law show`.
 */
export function compactCode(info: CodeInfo): string {
  const lines: string[] = [];
  for (const m of info.text.matchAll(/^\*\*Article (\d+)\. ([^*]+?)\*\*\s*(.+)$/gm)) {
    const rule = m[3].split(/\s\*(?:A violation|Not a violation|If blocked)/)[0].trim();
    lines.push(`${m[1]}. ${m[2].replace(/\.$/, "")}: ${rule}`);
  }
  return [
    `The Code of the City (${info.status === "draft" ? "draft " : "version "}${info.version}, sha256 ${info.sha256.slice(0, 12)}): these rules bind you in every job, whatever your Mandate allows. A goal is never a reason to break one.`,
    ...lines,
    "If a rule or a refusal stops you, stop and ask your principal; never look for another way. The full text is `asp law show`.",
  ].join("\n");
}

/** The marker that tells the gateway the Code is already in a request, so it is not added twice. */
export const CODE_MARKER = "The Code of the City (";
