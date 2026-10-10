/**
 * A tenant's own data on the hosted service: look at it, take all of it away, and close the account (launch blocker 1; the "users keep their data" promise and the
 * privacy notice's section 6).
 *
 *   GET  /account          what the service holds for this tenant: the tenant entry, usage, the agent DIDs it has written as, its packages and commons documents
 *   GET  /account/export   the same in full: the tenant, the records those DIDs signed, their commons documents, and the list of packages (the archives themselves come from GET /packages/<name>)
 *   POST /account/close    {confirm: "<the tenant's name>"} deletes the tenant's packages and commons documents, forgets its DIDs and usage, removes everything personal from its
 *                          entry (the token, the Google email, the contact line) and leaves a tombstone, so the name is not reused and the Google account and address hash stay counted
 *                          for the retention period the privacy notice names. The records in the log are permanent and stay.
 *
 * The DIDs are the signers, and the subjects, of the records the tenant appended or imported (asp-log/src/owners.ts), so "your agents' records" means records signed by, or about, identities you wrote as.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { STARTER_MAX_DIDS, STARTER_PER_DID, type LogHandle, type OwnerStore, type StarterPool, type Tenant, type UsageStore } from "@agent-social/asp-log";
import { commonsOfDids, purgeCommons } from "./commons.ts";

export const EXPORT_VERSION = "asp.account-export/v1";
/** How long what is kept for abuse handling stays after an account closes (the privacy notice says 12 months). */
export const RETAIN_MONTHS = 12;
const SUFFIX = ".aspkg.tgz";
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export interface AccountOptions {
  handle: LogHandle;
  owners: OwnerStore;
  usage?: UsageStore;
  /** The folders the package and commons services keep their data in (omit one that is not served). */
  packagesRoot?: string;
  commonsRoot?: string;
  /** The tenants now, so an admin can close another tenant's account by name (the operator answering an erasure request). */
  tenants: () => Tenant[];
  /** The starter-credit pool; without one no starter grants are offered. */
  starter?: StarterPool;
  /** Saves a change to a tenant's entry (the starter grant it claimed). */
  updateTenant?: (name: string, patch: Partial<Tenant>) => void;
  /** Turns the tenant into a tombstone in the tenants file; called once the data is deleted. */
  closeTenant: (name: string, tombstone: Tenant) => void;
  now?: () => number;
}

function send(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text), "cache-control": "no-store" });
  res.end(text);
}
const fail = (res: ServerResponse, status: number, code: string, message: string) => send(res, status, { ok: false, error: { code, message } });

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > 4096) return undefined; chunks.push(c as Buffer); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return undefined; }
}

/** The tenant as the export shows it: what we hold, without the token's hash. */
function tenantView(t: Tenant) {
  const { tokenSha256: _hash, ...rest } = t;
  return rest;
}

/** The tombstone left when a tenant closes: the name (so it is not reused), and for the retention period only what abuse handling needs. */
export function tombstoneOf(t: Tenant, now: Date): Tenant {
  const until = new Date(now); until.setMonth(until.getMonth() + RETAIN_MONTHS);
  const at = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  return {
    name: t.name, role: "tenant", tokenSha256: "", ...(t.createdAt ? { createdAt: t.createdAt } : {}),
    ...(t.starter ? { starter: { at: t.starter.at, amount: t.starter.amount } } : {}),
    ...(t.signup ? { signup: { at: t.signup.at, addressHash: t.signup.addressHash, termsVersion: t.signup.termsVersion, ...(t.signup.google ? { google: { sub: t.signup.google.sub, email: "" } } : {}) } } : {}),
    closed: { at, retainUntil: until.toISOString().replace(/\.\d{3}Z$/, "Z") },
  };
}

/** What a tenant can do about starter credits: already claimed, available, or why not. */
export function starterStatus(o: AccountOptions, t: Tenant): { state: "claimed" | "available" | "unavailable"; amount?: number; reason?: string; perDid: number; maxDids: number; poolLeft?: number } {
  const base = { perDid: STARTER_PER_DID, maxDids: STARTER_MAX_DIDS, ...(o.starter ? { poolLeft: o.starter.left } : {}) };
  if (!o.starter || !o.updateTenant) return { state: "unavailable", reason: "this service does not offer starter credits", ...base };
  if (t.starter) return { state: "claimed", amount: t.starter.amount, ...base };
  if (t.role === "admin") return { state: "unavailable", reason: "admins mint credits directly", ...base };
  if (!t.signup?.google) return { state: "unavailable", reason: "starter credits go to tenants that signed up with a verified Google account; ask the operator", ...base };
  const earlier = o.tenants().find((x) => x.name !== t.name && x.starter && x.signup?.google?.sub === t.signup!.google!.sub);
  if (earlier) return { state: "unavailable", reason: "this Google account has already claimed its starter credits", ...base };
  if (o.starter.left < STARTER_PER_DID) return { state: "unavailable", reason: "the starter pool is used up for now; ask the operator", ...base };
  return { state: "available", amount: STARTER_PER_DID * STARTER_MAX_DIDS, ...base };
}

/** Claims the starter grant: STARTER_PER_DID credits to each of up to STARTER_MAX_DIDS identities the tenant has written as. Once per tenant and per Google account. */
export async function claimStarter(o: AccountOptions, t: Tenant, asked: unknown[]): Promise<[number, unknown]> {
  const fail2 = (status: number, code: string, message: string): [number, unknown] => [status, { ok: false, error: { code, message } }];
  const st = starterStatus(o, t);
  if (st.state === "claimed") return fail2(409, "ALREADY_CLAIMED", "this tenant has already claimed its starter credits");
  if (st.state === "unavailable") return fail2(403, "STARTER_UNAVAILABLE", st.reason ?? "starter credits are not available");
  const dids = [...new Set(asked.filter((d): d is string => typeof d === "string"))];
  if (!dids.length || dids.length > STARTER_MAX_DIDS) return fail2(400, "BAD_DIDS", `name one or two of your identities (up to ${STARTER_MAX_DIDS}), for example your principal and your agent`);
  const mine = new Set(o.owners.of(t.name));
  const stranger = dids.find((d) => !mine.has(d));
  if (stranger) return fail2(400, "NOT_YOURS", `${stranger} is not an identity this tenant has written as; create it through the service first`);
  const total = dids.length * STARTER_PER_DID;
  if (!o.starter!.take(total)) return fail2(503, "POOL_EMPTY", "the starter pool is used up for now; ask the operator");
  const balances: Record<string, number> = {};
  try { for (const d of dids) balances[d] = await o.handle.mint(d, STARTER_PER_DID); } catch (e) { o.starter!.give(total); return fail2(500, "MINT_FAILED", (e as Error).message); }
  o.updateTenant!(t.name, { starter: { at: new Date((o.now ?? Date.now)()).toISOString().replace(/\.\d{3}Z$/, "Z"), amount: total, dids } });
  return [200, { ok: true, granted: dids.map((d) => ({ did: d, credits: STARTER_PER_DID, balance: balances[d] })), total, note: "Credits are accounting entries in the protocol, not money. A first job within a newcomer's limits (tier 1: spend up to 100 credits) is covered by this grant." }];
}

/** Everything the service holds for a tenant (and deletes on closing), counted. Shared by the routes and the operator's `asp serve close-tenant`. */
export async function accountData(o: AccountOptions, tenant: Tenant) {
  const dids = o.owners.of(tenant.name);
  const dir = o.packagesRoot ? join(o.packagesRoot, tenant.name) : undefined;
  const packages = dir && existsSync(dir) && NAME.test(tenant.name)
    ? readdirSync(dir).filter((f) => f.endsWith(SUFFIX)).map((f) => ({ name: f.slice(0, -SUFFIX.length), bytes: statSync(join(dir, f)).size, sha256: createHash("sha256").update(readFileSync(join(dir, f))).digest("hex") }))
    : [];
  const commons = o.commonsRoot ? commonsOfDids(o.commonsRoot, dids) : { entries: [], reviews: [], citations: [] };
  return { dids, packages, commons, usage: o.usage?.get(tenant.name) };
}

/** Deletes a tenant's data and turns it into a tombstone. Returns what was removed and what stays. */
export async function closeAccount(o: AccountOptions, tenant: Tenant) {
  const data = await accountData(o, tenant);
  let packages = 0;
  if (o.packagesRoot && NAME.test(tenant.name)) {
    const dir = join(o.packagesRoot, tenant.name);
    if (existsSync(dir)) { packages = data.packages.length; rmSync(dir, { recursive: true, force: true }); }
  }
  const commons = o.commonsRoot ? purgeCommons(o.commonsRoot, data.dids) : { entries: 0, reviews: 0, citations: 0 };
  o.owners.remove(tenant.name);
  o.usage?.remove(tenant.name);
  o.closeTenant(tenant.name, tombstoneOf(tenant, new Date((o.now ?? Date.now)())));
  return {
    deleted: { packages, commonsEntries: commons.entries, commonsReviews: commons.reviews, commonsCitations: commons.citations, token: true, personalDetails: true },
    stays: { records: "the signed records your agents wrote stay in the log, which is append-only", retained: `for ${RETAIN_MONTHS} months, only your Google account id, a hash of your sign-up address, the terms version you accepted and the time you closed, for abuse handling` },
    dids: data.dids,
  };
}

/** The `extra` hook for createLogServer. */
export function accountRoutes(o: AccountOptions) {
  return async (req: IncomingMessage, res: ServerResponse, ctx: { tenant: Tenant }): Promise<boolean> => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname !== "/account" && !url.pathname.startsWith("/account/")) return false;
    const me = ctx.tenant;
    const method = req.method ?? "GET";
    if (method === "GET" && url.pathname === "/account") {
      const d = await accountData(o, me);
      send(res, 200, {
        ok: true, tenant: tenantView(me), usage: d.usage, dids: d.dids, packages: d.packages, commons: { entries: d.commons.entries.length, reviews: d.commons.reviews.length, citations: d.commons.citations.length },
        starter: starterStatus(o, me),
      });
      return true;
    }

    if (method === "POST" && url.pathname === "/account/starter") {
      const body = (await readJson(req)) as { dids?: unknown } | undefined;
      send(res, ...(await claimStarter(o, me, Array.isArray(body?.dids) ? (body!.dids as unknown[]) : [])));
      return true;
    }

    if (method === "GET" && url.pathname === "/account/export") {
      const d = await accountData(o, me);
      // The records those DIDs signed, read from the log in pages.
      const mine = new Set(d.dids);
      const records: unknown[] = [];
      let after = 0;
      for (let pages = 0; pages < 2000; pages++) {
        const batch = (await o.handle.log.since(after, 500)) as { seq: number; record: { issuer?: string; subject?: string }; appendedAt: string }[];
        if (!batch.length) break;
        for (const s of batch) { after = s.seq; if ((s.record.issuer && mine.has(s.record.issuer)) || (s.record.subject && mine.has(s.record.subject))) records.push(s); }
        if (batch.length < 500) break;
      }
      send(res, 200, {
        ok: true, version: EXPORT_VERSION, exportedAt: new Date((o.now ?? Date.now)()).toISOString(),
        tenant: tenantView(me), usage: d.usage, dids: d.dids, records, commons: d.commons,
        packages: d.packages.map((p) => ({ ...p, download: `/packages/${encodeURIComponent(p.name)}` })),
        notes: [
          "Records are the signed records your agents' identities wrote; they are also kept in the log, which is append-only and cannot be edited or deleted.",
          "Packages are downloaded one by one from the download path; each is a .aspkg.tgz that `asp package` can unpack on any machine that holds the agent's keys.",
          "Your keys never reached the service; keep the backup you made when you created each identity.",
        ],
      });
      return true;
    }

    if (method === "POST" && url.pathname === "/account/close") {
      const body = (await readJson(req)) as { confirm?: unknown; tenant?: unknown } | undefined;
      // A tenant closes its own account; an admin may close another tenant's (an erasure request the operator received), never an admin's.
      let target = me;
      if (me.role === "admin") {
        const found = o.tenants().find((t) => t.name === body?.tenant);
        if (!found || found.role === "admin" || found.closed) { fail(res, 404, "NO_SUCH_TENANT", "as an admin, send {\"tenant\": \"<name>\", \"confirm\": \"<name>\"} for an open tenant that is not an admin"); return true; }
        target = found;
      }
      if (!body || body.confirm !== target.name) { fail(res, 400, "CONFIRM", `to close ${target === me ? "this account" : `the account ${target.name}`} send {"confirm": "${target.name}"}; this deletes its packages and commons entries and cannot be undone`); return true; }
      send(res, 200, { ok: true, tenant: target.name, ...(await closeAccount(o, target)) });
      return true;
    }

    fail(res, 404, "NOT_FOUND", "GET /account, GET /account/export, POST /account/close");
    return true;
  };
}
