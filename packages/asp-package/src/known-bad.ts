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

export function readKnownBad(file: string): KnownBadEntry[] {
  if (!existsSync(file)) return [];
  const list = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(list)) throw new Error(`${file} is not a list`);
  return list as KnownBadEntry[];
}

/** Adds an entry; false (and no change) if that fingerprint is already listed. */
export function addKnownBad(file: string, entry: KnownBadEntry): boolean {
  const list = readKnownBad(file);
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

/** The `extra` hook for createLogServer: GET /known-bad (any tenant), POST /known-bad (admin only). */
export function knownBadRoutes(opts: { root: string }) {
  const file = join(opts.root, "known-bad.json");
  return async (req: IncomingMessage, res: ServerResponse, ctx: { tenant: Tenant }): Promise<boolean> => {
    if (new URL(req.url ?? "/", "http://x").pathname !== "/known-bad") return false;
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

export async function postKnownBad(url: string, token: string | undefined, entry: KnownBadEntry): Promise<boolean> {
  const res = await fetchRetry(new URL("known-bad", url.endsWith("/") ? url : url + "/"), {
    method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(entry), signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => undefined)) as { created?: boolean; error?: { message: string } } | undefined;
  if (!res.ok) throw new Error(body?.error?.message ?? `the log service answered ${res.status}`);
  return !!body?.created;
}
