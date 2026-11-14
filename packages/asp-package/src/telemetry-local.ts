/**
 * Local raw telemetry (instrumentation.md 7; register row DK195; spec-delta S342): the free text of a signal (a reasoning excerpt, a memory change, a plan) never leaves the sponsor's machine. This is the local
 * store for it: every text is masked (secrets, and personal data by pattern: emails, phone numbers, account ids) and cut BEFORE it is stored; it is kept with a per-record SALT, and only a salted hash of it goes
 * into a digest, so deleting the raw record (retention, or `purge --raw`) deletes the salt with it and the hash can no longer be matched to a candidate text. Nothing here reads a signal that is not collected;
 * the Collector (asp-log) decides that. Credits are accounting entries, not money.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { redactSecrets } from "./secrets.ts";

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?<![\w.])\+?\d[\d ()-]{7,}\d(?![\w.])/g;
const ACCOUNT = /\b(?:\d{4}[ -]?){3}\d{1,4}\b|\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g;
export const MAX_TEXT = 2000;

/** Masks secrets, then personal data by pattern, then cuts: what may be written to the local store. Returns what was masked. */
export function redactTelemetryText(text: string): { text: string; masked: { secrets: number; personal: number } } {
  const s = redactSecrets(text);
  let personal = 0;
  const sub = (re: RegExp, label: string) => (t: string) => t.replace(re, () => { personal++; return label; });
  const out = [sub(EMAIL, "[email]"), sub(ACCOUNT, "[account]"), sub(PHONE, "[phone]")].reduce((t, f) => f(t), s.text);
  return { text: out.length > MAX_TEXT ? `${out.slice(0, MAX_TEXT)}...[+${out.length - MAX_TEXT} chars]` : out, masked: { secrets: s.redacted, personal } };
}

export const saltedHash = (text: string, salt: string): string => "sha256:" + createHash("sha256").update(salt + text).digest("hex");

interface RawRow { id: string; signal: string; at: string; text: string; salt: string }

export class LocalRawStore {
  private readonly dir: string;
  constructor(dir: string) { this.dir = join(dir, "raw"); }

  /** Stores the masked text with a fresh salt and returns the salted hash a digest may carry, never the text. */
  add(signal: string, text: string, at: string): { id: string; hash: string; masked: { secrets: number; personal: number } } {
    const r = redactTelemetryText(text);
    const salt = randomBytes(16).toString("hex");
    const id = randomBytes(8).toString("hex");
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, `${id}.json`), JSON.stringify({ id, signal, at, text: r.text, salt } satisfies RawRow));
    return { id, hash: saltedHash(r.text, salt), masked: r.masked };
  }

  rows(): RawRow[] { return existsSync(this.dir) ? readdirSync(this.dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(this.dir, f), "utf8")) as RawRow) : []; }

  /** Whether a candidate text matches the stored hash: possible only while the raw row (and its salt) exists. */
  matches(id: string, candidate: string, hash: string): boolean {
    const row = this.rows().find((r) => r.id === id);
    return !!row && saltedHash(redactTelemetryText(candidate).text, row.salt) === hash;
  }

  /** Retention: removes raw rows older than `days` (the consent's `retention_days`, at most 90). The text and its salt go together. Returns how many. */
  expire(days: number, now: string): number {
    let n = 0;
    for (const r of this.rows()) if (Date.parse(now) - Date.parse(r.at) > days * 86_400_000) { rmSync(join(this.dir, `${r.id}.json`), { force: true }); n++; }
    return n;
  }

  /** `purge --raw`: removes every raw text and its salt. The hashes already in digests stay, and can no longer be matched to any text. */
  purgeRaw(): number {
    const n = this.rows().length;
    rmSync(this.dir, { recursive: true, force: true });
    return n;
  }
}
