/**
 * The known-bad list (docs/spec-deltas.md S54): command fingerprints that an upheld report has marked harmful.
 *
 * A platform list, not a protocol record: each entry names the upheld report that justifies it and the fingerprint
 * (`asp://shell-command#sha256:...`) it blocks. `asp known-bad add` checks both against the log before it accepts an
 * entry. `asp run --contract` hands the list to the pre-call hook, which blocks a matching shell command before it
 * runs, whatever the Mandate grants. Held in a file (`<home>/known-bad.json`) or, for a shared network, by the log
 * service (`GET /known-bad` for any tenant, `POST /known-bad` for an admin).
 */
import { fetchRetry } from "./http-retry.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { addSigned, effectiveEntries, readSigned, readTrust, type SignedItem } from "./known-bad-signed.ts";
import type { Tenant } from "@agent-social/asp-log";

export interface KnownBadEntry {
  /** `<uri>#<sha256>` as the contagion watcher keys it. */
  fingerprint: string;
  /** The upheld report that justifies it. */
  report: string;
  /** The reported contract. */
  contract: string;
  addedAt: string;
  addedBy: string;
  note?: string;
}

const FINGERPRINT = /^asp:\/\/shell-command#sha256:[0-9a-f]{64}$/;
export const isKnownBadFingerprint = (s: unknown): s is string => typeof s === "string" && FINGERPRINT.test(s);

/** The plain (unsigned, S54) entries in `file`. */
function readPlain(file: string): KnownBadEntry[] {
  if (!existsSync(file)) return [];
  const list = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(list)) throw new Error(`${file} is not a list`);
  return list as KnownBadEntry[];
}

/** The signed registry and trust file that sit beside a list file (S178). */
export const signedFileFor = (file: string): string => join(dirname(file), "known-bad-signed.json");
export const trustFileFor = (file: string): string => join(dirname(file), "known-bad-trust.json");

/** What is enforced: the plain entries, and the signed entries that verify against this side's trust and have not been withdrawn by a signed review. */
export function readKnownBad(file: string): KnownBadEntry[] {
  const plain = readPlain(file);
  const signed = effectiveEntries(readSigned(signedFileFor(file)), readTrust(trustFileFor(file)))
    .filter((e) => !plain.some((p) => p.fingerprint === e.fingerprint))
    .map((e): KnownBadEntry => ({ fingerprint: e.fingerprint, report: e.report, contract: e.contract, addedAt: e.addedAt, addedBy: e.addedBy, ...(e.note ? { note: e.note } : {}) }));
  return [...plain, ...signed];
}

/** Adds an entry; false (and no change) if that fingerprint is already listed. */
export function addKnownBad(file: string, entry: KnownBadEntry): boolean {
  const list = readPlain(file);
  if (list.some((e) => e.fingerprint === entry.fingerprint)) return false;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file + ".part", JSON.stringify([...list, entry], null, 2) + "\n");
  renameSync(file + ".part", file);
  return true;
}

function reply(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

/** Public, read-only (S178): GET /known-bad (what is enforced) and GET /known-bad/signed (the signed entries and reviews, with the keys this service trusts), so anyone can read and copy the list. No token needed. */
export function knownBadPublicRoutes(opts: { root: string }) {
  const file = join(opts.root, "known-bad.json");
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (req.method !== "GET" || (path !== "/known-bad" && path !== "/known-bad/signed")) return false;
    if (path === "/known-bad") reply(res, 200, { ok: true, entries: readKnownBad(file) });
    else reply(res, 200, { ok: true, items: readSigned(signedFileFor(file)), trusted: Object.keys(readTrust(trustFileFor(file)).keys) });
    return true;
  };
}

/** The `extra` hook for createLogServer: GET /known-bad (any tenant), POST /known-bad (admin only), POST /known-bad/signed (any tenant; the signature and this service's trust decide, S178). */
export function knownBadRoutes(opts: { root: string }) {
  const file = join(opts.root, "known-bad.json");
  return async (req: IncomingMessage, res: ServerResponse, ctx: { tenant: Tenant }): Promise<boolean> => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (path === "/known-bad/signed") {
      if (req.method !== "POST") { reply(res, 405, { ok: false, error: { code: "METHOD", message: "POST a signed entry or review (GET is public)" } }); return true; }
      const chunks: Buffer[] = [];
      let n = 0;
      for await (const c of req) { n += (c as Buffer).length; if (n > 16 * 1024) { reply(res, 413, { ok: false, error: { code: "TOO_LARGE", message: "item too large" } }); return true; } chunks.push(c as Buffer); }
      let item: SignedItem;
      try { item = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { reply(res, 422, { ok: false, error: { code: "INVALID", message: "not json" } }); return true; }
      try { reply(res, 201, { ok: true, ...addSigned(signedFileFor(file), item, readTrust(trustFileFor(file))) }); } catch (e) { reply(res, 422, { ok: false, error: { code: "REFUSED", message: (e as Error).message } }); }
      return true;
    }
    if (path !== "/known-bad") return false;
    if (req.method === "GET") { reply(res, 200, { ok: true, entries: readKnownBad(file) }); return true; }
    if (req.method !== "POST") { reply(res, 405, { ok: false, error: { code: "METHOD", message: "GET or POST" } }); return true; }
    if (ctx.tenant.role !== "admin") { reply(res, 403, { ok: false, error: { code: "FORBIDDEN", message: "only an admin may add to the known-bad list" } }); return true; }
    const chunks: Buffer[] = [];
    let n = 0;
    for await (const c of req) { n += (c as Buffer).length; if (n > 16 * 1024) { reply(res, 413, { ok: false, error: { code: "TOO_LARGE", message: "entry too large" } }); return true; } chunks.push(c as Buffer); }
    let e: KnownBadEntry;
    try { e = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { reply(res, 422, { ok: false, error: { code: "INVALID", message: "not json" } }); return true; }
    if (!isKnownBadFingerprint(e?.fingerprint) || typeof e.report !== "string" || typeof e.contract !== "string") { reply(res, 422, { ok: false, error: { code: "INVALID", message: "an entry needs a shell-command fingerprint, a report and a contract" } }); return true; }
    const created = addKnownBad(file, { fingerprint: e.fingerprint, report: e.report, contract: e.contract, addedAt: String(e.addedAt ?? ""), addedBy: String(e.addedBy ?? ctx.tenant.name), ...(e.note ? { note: String(e.note).slice(0, 500) } : {}) });
    reply(res, created ? 201 : 200, { ok: true, created });
    return true;
  };
}

/** The list a shared log service holds. */
export async function fetchKnownBad(url: string, token?: string): Promise<KnownBadEntry[]> {
  const res = await fetchRetry(new URL("known-bad", url.endsWith("/") ? url : url + "/"), { headers: token ? { authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`the log service answered ${res.status} for the known-bad list`);
  return ((await res.json()) as { entries: KnownBadEntry[] }).entries;
}

/** Posts a signed entry or review; the service verifies it against the keys it trusts. */
export async function postSignedKnownBad(url: string, token: string | undefined, item: SignedItem): Promise<boolean> {
  const res = await fetchRetry(new URL("known-bad/signed", url.endsWith("/") ? url : url + "/"), {
    method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(item), signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => undefined)) as { created?: boolean; error?: { message: string } } | undefined;
  if (!res.ok) throw new Error(body?.error?.message ?? `the log service answered ${res.status}`);
  return !!body?.created;
}

export async function postKnownBad(url: string, token: string | undefined, entry: KnownBadEntry): Promise<boolean> {
  const res = await fetchRetry(new URL("known-bad", url.endsWith("/") ? url : url + "/"), {
    method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(entry), signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => undefined)) as { created?: boolean; error?: { message: string } } | undefined;
  if (!res.ok) throw new Error(body?.error?.message ?? `the log service answered ${res.status}`);
  return !!body?.created;
}
