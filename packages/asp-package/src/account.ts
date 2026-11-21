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
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import { STARTER_PER_DID, STARTER_UPFRONT, type LogHandle, type OwnerStore, type StarterPool, type Tenant, type UsageStore } from "@agent-social/asp-log";
import { commonsOfDids, purgeCommons } from "./commons.ts";
import { sealedLogsOf } from "./runlog-vault.ts";
import { namespaceOf } from "./namespace.ts";

export const EXPORT_VERSION = "asp.account-export/v1";
/** How long what is kept for abuse handling stays after an account closes (the privacy notice says 12 months). */
export const RETAIN_MONTHS = 12;
const SUFFIX = ".aspkg.tgz";
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export interface AccountOptions {
  /** The hosted-bot signer (DK532): for an agent that enrolled over plain HTTP the service signs the starter claim, because it holds that agent's key (DK733). */
  hosted?: { has(did: string): boolean; sign(did: string, init: { type: string; subject: string | null; body: Record<string, unknown>; prev: string | null; issued_at: string }): unknown };
  /** The telemetry content store (TM1, DK651): listed and given in the export, and its text deleted when the account is closed (the hashes stay). */
  telemetry?: { list(t: string): { hash: string; kind: string; at: string; bytes: number; deletedAt?: string }[]; get(t: string, h: string): { content?: string } | undefined; deleteAll(t: string, at: string): number };
  handle: LogHandle;
  owners: OwnerStore;
  /** The sponsor view of an agent's journey (DK1300), for the tenant that owns it: given the name or DID and the DIDs the tenant owns. */
  journey?: (nameOrDid: string, ownedDids: string[], tenant?: string) => Promise<{ status: number; body: Record<string, unknown> }>;
  usage?: UsageStore;
  /** The folders the package and commons services keep their data in (omit one that is not served). */
  packagesRoot?: string;
  commonsRoot?: string;
  /** The folder the sealed run-log service keeps its data in (omit when not served). */
  runLogsRoot?: string;
  /** The tenants now, so an admin can close another tenant's account by name (the operator answering an erasure request). */
  tenants: () => Tenant[];
  /** The service's DID domain: when set, GET /account says where this tenant's identities live (src/namespace.ts). */
  didDomain?: string;
  /** The starter-credit pool; without one no starter grants are offered. */
  starter?: StarterPool;
  /**
   * Signed starter (DK94): the service holds no key. The operator funds the starter pool with signed mints (`asp credits grant --to did:web:asp.local:starter-pool --by <operator>`); a claimant
   * signs its own `starter_claim`, which the log applies by fixed rules. Set when the service's log names an operator (ASP_OPERATOR_DID). Without it the old unsigned mint is used.
   */
  signedStarter?: boolean;
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

async function readJson(req: IncomingMessage, max = 4096): Promise<unknown> {
  const chunks: Buffer[] = []; let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > max) return undefined; chunks.push(c as Buffer); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return undefined; }
}

/** The tenant as the export shows it: what we hold, without any token's hash. */
function tenantView(t: Tenant) {
  const { tokenSha256: _hash, machineTokens, machine: _machine, ...rest } = t;
  return { ...rest, ...(machineTokens ? { machineTokens: machineTokens.map((m) => ({ name: m.name, createdAt: m.createdAt, expiresAt: m.expiresAt, ...(m.revoked ? { revoked: m.revoked } : {}) })) } : {}) };
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

/** For each identity the tenant has written as: whether losing its key can be undone (a recovery key in its passport, or a sponsor for an agent). */
export async function identityRecovery(o: AccountOptions, dids: string[]): Promise<{ did: string; kind?: string; recovery: "recovery key" | "sponsor" | "none" | "unknown" }[]> {
  const out: { did: string; kind?: string; recovery: "recovery key" | "sponsor" | "none" | "unknown" }[] = [];
  for (const did of dids) {
    const p = await o.handle.log.passport(did).catch(() => undefined);
    const rec = p ? await o.handle.log.get(p.head).catch(() => undefined) : undefined;
    const b = rec?.record.body as { kind?: string; sponsor?: string; keys?: { id: string }[] } | undefined;
    if (!b) { out.push({ did, recovery: "unknown" }); continue; }
    out.push({ did, ...(b.kind ? { kind: b.kind } : {}), recovery: (b.keys ?? []).some((k) => k.id.includes("#recovery-")) ? "recovery key" : b.sponsor ? "sponsor" : "none" });
  }
  return out;
}

export type StarterState = "claimed" | "partial" | "available" | "waiting" | "unavailable";
/** The most identities one starter request names (DK1470): a rate per request, not a total per tenant; a fleet asks again for the next batch. */
export const STARTER_BATCH_MAX = 25;
export interface StarterView {
  state: StarterState; amount?: number; reason?: string; perDid: number; upfront: number; poolLeft?: number;
  /** The most identities one request names; there is no total. */ batchMax: number;
  /** Still owed to each identity that has had only the first part, for a partial grant. */ held?: number; /** Place on the waiting list, counted from 1 (0: not on it). */ position?: number;
  /** Identities that have had the first part, those still owed the rest, and those the tenant has written as that have not claimed (DK1470). */ claimed?: number; owed?: string[]; unclaimed?: number;
}

/** What each identity of a tenant has had (DK1470): the first part, and the rest. An older record (before per-identity claims) is read as it was written: `held` set means the rest went to none, absent to all. */
export function starterClaims(t: Tenant): { dids: string[]; rest: Set<string>; owed: string[] } {
  const s = t.starter;
  const dids = s?.dids ?? [];
  const rest = new Set(s?.restDids ?? (s && !s.held ? dids : []));
  return { dids, rest, owed: dids.filter((d) => !rest.has(d)) };
}

/** Is it this tenant's turn at the pool: room for a claim, and nobody ahead of it on the waiting list? */
const itsTurn = (o: AccountOptions, t: Tenant) => !!o.starter && o.starter.left >= STARTER_UPFRONT && (o.starter.waitingList.length === 0 || o.starter.waitingList[0] === t.name);
const POOL_FULL = (place: number) => `the starter pool is full right now. You are number ${place} on the waiting list; the operator tops the pool up on purpose, and then asp account starter works for you, in order`;
const ISO = (o: AccountOptions) => new Date((o.now ?? Date.now)()).toISOString().replace(/\.\d{3}Z$/, "Z");
const EACH_REST = STARTER_PER_DID - STARTER_UPFRONT;

/** Why this tenant may not claim at all, or undefined. */
function starterRefusal(o: AccountOptions, t: Tenant): string | undefined {
  if (!o.starter || !o.updateTenant) return "this service does not offer starter credits";
  if (t.role === "admin") return "admins mint credits directly";
  if (!t.signup?.google && !t.signup?.keyOnly && !t.signup?.httpEnrol) return "starter credits go to tenants that signed up with a verified Google account or enrolled an agent by its key; ask the operator";
  if (!t.starter && t.signup?.google && o.tenants().some((x) => x.name !== t.name && x.starter && x.signup?.google?.sub === t.signup!.google!.sub)) return "this Google account has already claimed its starter credits";
  return undefined;
}

/**
 * What a tenant can do about starter credits (gap M9, DK1470). Every identity the tenant has written as claims its own grant: STARTER_UPFRONT at once, enough for a first job (an escrow and
 * a bond), and the rest of STARTER_PER_DID when that identity has had a job accepted. There is no total per tenant, only STARTER_BATCH_MAX identities per request. When the pool cannot
 * cover a claim, or others are waiting ahead, the tenant is on a waiting list.
 */
export function starterStatus(o: AccountOptions, t: Tenant): StarterView {
  const base = { perDid: STARTER_PER_DID, upfront: STARTER_UPFRONT, batchMax: STARTER_BATCH_MAX, ...(o.starter ? { poolLeft: o.starter.left } : {}) };
  const refused = starterRefusal(o, t);
  if (refused) return { state: "unavailable", reason: refused, ...base };
  const { dids, owed } = starterClaims(t);
  const mine = t.signup?.keyOnly ? [t.signup.keyOnly.did] : t.signup?.httpEnrol ? [t.signup.httpEnrol.did] : o.owners.of(t.name);
  const unclaimed = mine.filter((d) => !dids.includes(d)).length;
  const counts = { claimed: dids.length, ...(owed.length ? { owed } : {}), unclaimed };
  const more = unclaimed ? `${unclaimed} more identit${unclaimed === 1 ? "y has" : "ies have"} not claimed (asp account starter --did <did>,...)` : "";
  if (t.starter) {
    const common = { amount: t.starter.amount, ...counts, ...base };
    if (owed.length) return { state: "partial", held: EACH_REST, reason: `${dids.length} identit${dids.length === 1 ? "y has" : "ies have"} had the first ${STARTER_UPFRONT}; the other ${EACH_REST} comes to each when that identity has a job of its own accepted${more ? `; ${more}` : ""}`, ...common };
    return { state: "claimed", ...(more ? { reason: more } : {}), ...common };
  }
  if (!itsTurn(o, t)) {
    const position = o.starter!.position(t.name);
    return { state: "waiting", position, reason: position ? `you are number ${position} on the waiting list for the starter pool; the operator tops it up on purpose, and then asp account starter works for you, in order` : "the starter pool is full right now; asp account starter puts you on the waiting list", ...counts, ...base };
  }
  return { state: "available", amount: STARTER_UPFRONT * Math.max(1, unclaimed), ...counts, ...base };
}

/**
 * Releases the rest of a grant, identity by identity: each identity that has had a job of its own accepted gets its remaining part (DK1356, DK1470). Checked when the tenant looks at its
 * account or asks again (`only` limits it to the identities named). Returns what was minted, or why not. The pool is drawn on now, not reserved at the claim: if it is used up the rest waits
 * for the operator to top it up. With signed starter the service holds no key, so the rest is claimed by a signature (asp account starter) and not minted here.
 */
export async function releaseStarter(o: AccountOptions, t: Tenant, only?: ReadonlySet<string>): Promise<{ released: { did: string; credits: number; balance: number }[] } | { reason: string }> {
  const s = t.starter;
  const { owed, rest } = starterClaims(t);
  const pending = only ? owed.filter((d) => only.has(d)) : owed;
  if (!o.starter || !o.updateTenant || !s || !pending.length) return { reason: "nothing is held back" };
  if (o.signedStarter) return { reason: "ask again with asp account starter: each identity signs its own claim for the rest once it has had a job accepted" };
  const earned: string[] = [];
  for (const did of pending) {
    const rep = await o.handle.log.reputationOf(did).catch(() => undefined);
    if ((rep?.qualifyingJobs ?? 0) >= 1) earned.push(did);
  }
  if (!earned.length) return { reason: `the other ${EACH_REST} comes to each identity when that identity has had a job accepted` };
  if (!o.starter.take(EACH_REST * earned.length)) return { reason: "the rest of the grant is ready but the starter pool is used up for now; the operator tops it up on purpose, and it is released then" };
  const released: { did: string; credits: number; balance: number }[] = [];
  try { for (const did of earned) released.push({ did, credits: EACH_REST, balance: await o.handle.mint(did, EACH_REST) }); } catch (e) { o.starter.give(EACH_REST * (earned.length - released.length)); if (!released.length) return { reason: (e as Error).message }; }
  o.updateTenant(t.name, { starter: { ...s, amount: s.amount + released.length * EACH_REST, restDids: [...rest, ...released.map((r) => r.did)], releasedAt: ISO(o), held: undefined } });
  return { released };
}

type Fail2 = (s: number, c: string, m: string, e?: Record<string, unknown>) => [number, unknown];
interface StarterNeed { did: string; part: "upfront" | "rest"; amount: number }

/**
 * Claims starter credits for the identities named (DK1470): each identity that has not claimed gets STARTER_UPFRONT; one that has and is owed the rest gets it once it has had a job accepted.
 * Any number of identities over several requests, at most STARTER_BATCH_MAX in one; an identity that has everything is refused.
 */
export async function claimStarter(o: AccountOptions, t: Tenant, asked: unknown[], claims: unknown[] = []): Promise<[number, unknown]> {
  const fail2: Fail2 = (status, code, message, extra = {}) => [status, { ok: false, error: { code, message, ...extra } }];
  const refused = starterRefusal(o, t);
  if (refused) return fail2(403, "STARTER_UNAVAILABLE", refused);
  const { dids: had, rest, owed } = starterClaims(t);
  let dids = [...new Set(asked.filter((d): d is string => typeof d === "string"))];
  if (!dids.length && owed.length) dids = owed.slice(0, STARTER_BATCH_MAX);
  if (!dids.length) return fail2(400, "BAD_DIDS", "name the identities that get starter credits (asp account starter --did <did>[,<did>...]); they must be identities you created through the service");
  if (dids.length > STARTER_BATCH_MAX) return fail2(400, "BAD_DIDS", `at most ${STARTER_BATCH_MAX} identities in one request; ask again for the rest`);
  // Parity (DK541): a key-only agent gets what a sponsored agent gets, for its own identity (the did:key of the key it enrolled with).
  const own = t.signup?.httpEnrol?.did ?? t.signup?.keyOnly?.did;
  if (own && (dids.length !== 1 || dids[0] !== own)) return fail2(400, "BAD_DIDS", `an agent that enrolled ${t.signup?.httpEnrol ? "over HTTP" : "with a key"} claims for its own identity, ${own}`);
  // The pool is looked at first: a tenant that cannot be served joins the waiting list without having to name anything.
  if (dids.some((d) => !had.includes(d)) && !itsTurn(o, t)) return fail2(503, "POOL_EMPTY", POOL_FULL(o.starter!.enqueue(t.name)));
  const mine = new Set(o.owners.of(t.name));
  const stranger = dids.find((d) => !mine.has(d) && !had.includes(d));
  if (stranger) return fail2(400, "NOT_YOURS", `${stranger} is not an identity this tenant has written as; create it through the service first`);
  const needs: StarterNeed[] = dids.filter((d) => !rest.has(d)).map((d) => (had.includes(d) ? { did: d, part: "rest" as const, amount: EACH_REST } : { did: d, part: "upfront" as const, amount: STARTER_UPFRONT }));
  if (!needs.length) return fail2(409, "ALREADY_CLAIMED", dids.length === 1 ? `${dids[0]} has already had all of its starter credits` : "every identity named has already had all of its starter credits");
  return o.signedStarter ? claimStarterSigned(o, t, needs, claims, fail2) : claimStarterUnsigned(o, t, needs, fail2);
}

/** What the tenant's record says after these identities were granted. */
function recordGrant(o: AccountOptions, t: Tenant, granted: StarterNeed[]) {
  const s = t.starter;
  const { dids, rest } = starterClaims(t);
  const up = granted.filter((g) => g.part === "upfront").map((g) => g.did), re = granted.filter((g) => g.part === "rest").map((g) => g.did);
  const releasedAt = re.length ? ISO(o) : s?.releasedAt;
  o.updateTenant!(t.name, { starter: { at: s?.at ?? ISO(o), amount: (s?.amount ?? 0) + granted.reduce((n, g) => n + g.amount, 0), dids: [...new Set([...dids, ...up])], restDids: [...rest, ...re], ...(releasedAt ? { releasedAt } : {}) } });
}
const noteOf = (granted: StarterNeed[]) => granted.some((g) => g.part === "upfront")
  ? `Credits are accounting entries in the protocol, not money. ${STARTER_UPFRONT} each is enough for a first job (an escrow and a bond). The other ${EACH_REST} each comes when that identity has had a job of its own accepted: ask again with asp account starter then.`
  : "The rest of your starter grant. Credits are accounting entries in the protocol, not money.";
const view = (granted: StarterNeed[], balances: Record<string, number>) => ({ granted: granted.map((g) => ({ did: g.did, credits: g.amount, balance: balances[g.did] })), total: granted.reduce((n, g) => n + g.amount, 0), ...(granted.some((g) => g.part === "upfront") ? { held: EACH_REST } : {}), note: noteOf(granted) });

async function claimStarterUnsigned(o: AccountOptions, t: Tenant, needs: StarterNeed[], fail2: Fail2): Promise<[number, unknown]> {
  const granted: StarterNeed[] = [], balances: Record<string, number> = {};
  const firsts = needs.filter((n) => n.part === "upfront");
  if (firsts.length) {
    if (!o.starter!.take(firsts.length * STARTER_UPFRONT)) return fail2(503, "POOL_EMPTY", POOL_FULL(o.starter!.enqueue(t.name)));
    try { for (const n of firsts) { balances[n.did] = await o.handle.mint(n.did, n.amount); granted.push(n); } } catch (e) { o.starter!.give((firsts.length - granted.length) * STARTER_UPFRONT); if (!granted.length) return fail2(500, "MINT_FAILED", (e as Error).message); }
    o.starter!.dequeue(t.name);
    recordGrant(o, t, granted);
  }
  let why = "";
  const laters = needs.filter((n) => n.part === "rest");
  if (laters.length) {
    const r = await releaseStarter(o, o.tenants().find((x) => x.name === t.name) ?? t, new Set(laters.map((n) => n.did)));
    if ("released" in r) for (const g of r.released) { balances[g.did] = g.balance; granted.push({ did: g.did, part: "rest", amount: g.credits }); } else why = r.reason;
  }
  if (!granted.length) return fail2(409, "ALREADY_CLAIMED", `you have already claimed the first part of your starter credits for ${needs.length === 1 ? "this identity" : "these identities"}; ${why}`);
  return [200, { ok: true, ...view(granted, balances) }];
}

/**
 * The signed route (DK94): the same eligibility, but the credits come from the starter pool by claims the identities sign themselves. With no claims the answer is CLAIM_NEEDED, naming what
 * each identity is to sign; the client signs and asks again. The log refuses a claim the pool cannot cover (starter_pool_empty), and the tenant goes on the waiting list as before; the log also
 * refuses the rest for an identity that has not had a qualifying job from a principal that is not a house agent (starter_rest_not_earned).
 */
async function claimStarterSigned(o: AccountOptions, t: Tenant, needs: StarterNeed[], claims: unknown[], fail2: Fail2): Promise<[number, unknown]> {
  // An agent whose key the service holds (DK733) cannot sign its own claim over plain HTTP: the service signs it, by the same fixed rules, as the agent's own act.
  if (t.signup?.httpEnrol && o.hosted?.has(t.signup.httpEnrol.did) && !claims.length) {
    claims = needs.map((n) => o.hosted!.sign(t.signup!.httpEnrol!.did, { type: "starter_claim", subject: n.did, prev: null, issued_at: ISO(o), body: { part: n.part, amount: { value: n.amount, unit: "credit" } } }));
  }
  const byKey = new Map(needs.map((n) => [`${n.did}|${n.part}`, n]));
  const mineClaims = (claims as { type?: string; issuer?: string; body?: { part?: string } }[]).filter((c) => c?.type === "asp.starter_claim/v0.2" && byKey.has(`${c.issuer}|${c.body?.part}`));
  if (!mineClaims.length) {
    const first = needs[0];
    return fail2(428, "CLAIM_NEEDED", "sign a starter claim for each identity named (the service holds no key); `asp account starter` does this", { part: first.part, amount: first.amount, dids: needs.filter((n) => n.part === first.part).map((n) => n.did), needs });
  }
  const granted: StarterNeed[] = [], balances: Record<string, number> = {}, refusals: string[] = [];
  let stopped: [number, unknown] | undefined;
  for (const c of mineClaims) {
    const need = byKey.get(`${c.issuer}|${c.body?.part}`)!;
    try { await o.handle.append(c as never); } catch (e) {
      const detail = (e as { detail?: string }).detail;
      if (detail === "starter_pool_empty") { stopped = granted.length ? fail2(503, "POOL_EMPTY", (e as Error).message) : fail2(503, "POOL_EMPTY", POOL_FULL(o.starter!.enqueue(t.name))); break; }
      if (detail === "starter_already_claimed") continue;
      if (detail === "starter_rest_not_earned") { refusals.push(`${need.did}: ${(e as Error).message}`); continue; }
      stopped = fail2(409, detail ?? "CLAIM_REFUSED", (e as Error).message); break;
    }
    granted.push(need); balances[need.did] = await o.handle.log.balance(need.did);
  }
  if (granted.length) { o.starter!.dequeue(t.name); recordGrant(o, t, granted); }
  if (stopped) return stopped;
  if (!granted.length) return fail2(409, "ALREADY_CLAIMED", refusals.length ? `you have already claimed the first part of your starter credits; ${refusals[0]}` : "these identities have already claimed");
  return [200, { ok: true, ...view(granted, balances), ...(refusals.length ? { notYet: refusals } : {}) }];
}

/** Everything the service holds for a tenant (and deletes on closing), counted. Shared by the routes and the operator's `asp serve close-tenant`. */
export async function accountData(o: AccountOptions, tenant: Tenant) {
  const dids = o.owners.of(tenant.name);
  const dir = o.packagesRoot ? join(o.packagesRoot, tenant.name) : undefined;
  const packages = dir && existsSync(dir) && NAME.test(tenant.name)
    ? readdirSync(dir).filter((f) => f.endsWith(SUFFIX)).map((f) => ({ name: f.slice(0, -SUFFIX.length), bytes: statSync(join(dir, f)).size, sha256: createHash("sha256").update(readFileSync(join(dir, f))).digest("hex") }))
    : [];
  const commons = o.commonsRoot ? commonsOfDids(o.commonsRoot, dids) : { entries: [], reviews: [], citations: [] };
  return { dids, packages, runLogs: sealedLogsOf(o.runLogsRoot, tenant.name), commons, usage: o.usage?.get(tenant.name) };
}

/** Deletes a tenant's data and turns it into a tombstone. Returns what was removed and what stays. */
export async function closeAccount(o: AccountOptions, tenant: Tenant) {
  const data = await accountData(o, tenant);
  let packages = 0;
  if (o.packagesRoot && NAME.test(tenant.name)) {
    const dir = join(o.packagesRoot, tenant.name);
    if (existsSync(dir)) { packages = data.packages.length; rmSync(dir, { recursive: true, force: true }); }
  }
  let runLogs = 0;
  if (o.runLogsRoot && NAME.test(tenant.name)) {
    const dir = join(o.runLogsRoot, tenant.name);
    if (existsSync(dir)) { runLogs = data.runLogs.length; rmSync(dir, { recursive: true, force: true }); }
  }
  const commons = o.commonsRoot ? purgeCommons(o.commonsRoot, data.dids) : { entries: 0, reviews: 0, citations: 0 };
  const telemetryDeleted = o.telemetry && NAME.test(tenant.name) ? o.telemetry.deleteAll(tenant.name, new Date((o.now ?? Date.now)()).toISOString().replace(/\.\d{3}Z$/, "Z")) : 0;
  o.owners.remove(tenant.name);
  o.usage?.remove(tenant.name);
  o.closeTenant(tenant.name, tombstoneOf(tenant, new Date((o.now ?? Date.now)())));
  return {
    deleted: { packages, sealedRunLogs: runLogs, telemetryItems: telemetryDeleted, commonsEntries: commons.entries, commonsReviews: commons.reviews, commonsCitations: commons.citations, token: true, personalDetails: true },
    stays: { records: "the signed records your agents wrote stay in the log, which is append-only", retained: `for ${RETAIN_MONTHS} months, only your Google account id, a hash of your sign-up address, the terms version you accepted and the time you closed, for abuse handling` },
    dids: data.dids,
  };
}

/** The most a first-minute answer may weigh (DK852). */
export const ME_MAX_BYTES = 2048;

/** DK852: the short first answer for a tenant: standing, starter state, usage and one suggested next step that exists, in under 2 KB; the long notes are behind `more`. */
export async function meView(o: AccountOptions, t: Tenant) {
  const dids = o.owners.of(t.name);
  const first = dids[0];
  const rep = first ? await (o.handle.log as any).reputationOf(first).catch(() => null) as { tier: number; slashCount: number; strikes: number; acceptedJobs?: number } | null : null;
  const balance = first ? await o.handle.log.balance(first).catch(() => undefined) : undefined;
  const starter = starterStatus(o, t);
  const usage = o.usage?.get(t.name) as { records?: number; bytes?: number } | undefined;
  const next = !first ? { do: "make or enrol an identity", call: "POST /signup/key", why: "you have no identity of your own yet" }
    : starter.state === "available" ? { do: "claim your mock starter credits", call: "POST /account/starter", why: `${starter.upfront} credits at once, the rest after your first accepted job` }
    : (balance ?? 0) > 0 ? { do: "look at the job board", call: "GET /market/cold-start", why: "you have credits to start with" }
    : { do: "read the start page", call: "GET /society/start", why: "it shows the ways to earn and spend credits" };
  return {
    ok: true, tenant: t.name, identities: dids.length, ...(first ? { did: first } : {}),
    standing: rep ? { tier: rep.tier, slashes: rep.slashCount, strikes: rep.strikes, accepted_jobs: rep.acceptedJobs ?? 0 } : null,
    ...(balance !== undefined ? { credits: balance } : {}),
    starter: { state: starter.state, ...(starter.amount !== undefined ? { amount: starter.amount } : {}), upfront: starter.upfront },
    ...(usage ? { usage: { records: usage.records ?? 0, bytes: usage.bytes ?? 0 } } : {}),
    next,
    note: "Credits are mock accounting entries, not money; a beta with no outside security review.",
    more: "/account",
  };
}

/** The `extra` hook for createLogServer. */
export function accountRoutes(o: AccountOptions) {
  return async (req: IncomingMessage, res: ServerResponse, ctx: { tenant: Tenant }): Promise<boolean> => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/society/me" && (req.method ?? "GET") === "GET") {
      const mine = o.tenants().find((x) => x.name === ctx.tenant.name) ?? ctx.tenant;
      send(res, 200, await meView(o, mine));
      return true;
    }
    if (url.pathname !== "/account" && !url.pathname.startsWith("/account/")) return false;
    const me = ctx.tenant;
    const method = req.method ?? "GET";
    if (method === "GET" && url.pathname === "/account") {
      // The rest of a starter grant is released as soon as a job of the tenant's has been accepted (gap M9): looking at the account is enough to ask.
      if (starterClaims(me).owed.length) await releaseStarter(o, me).catch(() => undefined);
      const mine = o.tenants().find((x) => x.name === me.name) ?? me;
      const d = await accountData(o, mine);
      send(res, 200, {
        ok: true, tenant: tenantView(me), usage: d.usage, dids: d.dids, packages: d.packages, sealedRunLogs: d.runLogs.length, commons: { entries: d.commons.entries.length, reviews: d.commons.reviews.length, citations: d.commons.citations.length },
        starter: starterStatus(o, mine), identities: await identityRecovery(o, d.dids),
        ...(o.didDomain ? { namespace: { domain: o.didDomain, ...namespaceOf(o.didDomain, me.name) } } : {}),
      });
      return true;
    }

    // The sponsor view of one agent's journey (DK1300): the steps with the text the records and forum posts carry, only for the tenant that owns the agent.
    if (method === "GET" && url.pathname.startsWith("/account/journey/")) {
      if (!o.journey) { fail(res, 404, "NOT_SERVED", "this service does not serve journeys"); return true; }
      const name = decodeURIComponent(url.pathname.slice("/account/journey/".length).replace(/\/+$/, ""));
      const r = await o.journey(name, o.owners.of(me.name), me.name);
      send(res, r.status, r.body);
      return true;
    }
    // A machine token (a CI job, a scheduled task) can read the account and write records, but not take it apart: no tokens, no starter credits, no export, no closing.
    if (me.machine && url.pathname !== "/account") { fail(res, 403, "MACHINE_TOKEN", `the machine token ${me.machine} can read the account and write records; this needs your own token`); return true; }

    // Machine tokens: make one (shown once), list them, revoke one.
    if (url.pathname === "/account/tokens" || url.pathname.startsWith("/account/tokens/")) {
      if (!o.updateTenant) { fail(res, 404, "NOT_FOUND", "machine tokens are not offered here"); return true; }
      const live = (me.machineTokens ?? []).filter((m) => !m.revoked && Date.parse(m.expiresAt) > Date.now());
      if (method === "GET" && url.pathname === "/account/tokens") {
        send(res, 200, { ok: true, tokens: (me.machineTokens ?? []).map((m) => ({ name: m.name, createdAt: m.createdAt, expiresAt: m.expiresAt, ...(m.revoked ? { revoked: m.revoked } : {}), active: live.includes(m) })) });
        return true;
      }
      if (method === "POST" && url.pathname === "/account/tokens") {
        const body = (await readJson(req)) as { name?: unknown; days?: unknown } | undefined;
        const name = typeof body?.name === "string" ? body.name : "";
        const days = body?.days === undefined ? 90 : Number(body.days);
        if (!/^[a-z][a-z0-9-]{1,31}$/.test(name)) { fail(res, 400, "BAD_NAME", "a machine token's name is 2 to 32 characters: lower-case letters, digits and hyphens, starting with a letter"); return true; }
        if (!Number.isInteger(days) || days < 1 || days > 365) { fail(res, 400, "BAD_DAYS", "a machine token lasts 1 to 365 days"); return true; }
        if ((me.machineTokens ?? []).some((m) => m.name === name)) { fail(res, 409, "NAME_TAKEN", `you already have a machine token called ${name}`); return true; }
        if (live.length >= 10) { fail(res, 400, "TOO_MANY", "at most 10 active machine tokens; revoke one first"); return true; }
        const token = randomBytes(32).toString("base64url");
        const now = new Date((o.now ?? Date.now)());
        const entry = { name, tokenSha256: createHash("sha256").update(token).digest("hex"), createdAt: now.toISOString().replace(/\.\d{3}Z$/, "Z"), expiresAt: new Date(now.getTime() + days * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z") };
        o.updateTenant(me.name, { machineTokens: [...(me.machineTokens ?? []), entry] });
        send(res, 201, { ok: true, name, token, expiresAt: entry.expiresAt, note: "Shown once. It can read the account and write records; it cannot make tokens, claim credits, export or close the account." });
        return true;
      }
      if (method === "DELETE" && url.pathname.startsWith("/account/tokens/")) {
        const name = decodeURIComponent(url.pathname.slice("/account/tokens/".length));
        if (!(me.machineTokens ?? []).some((m) => m.name === name && !m.revoked)) { fail(res, 404, "NO_SUCH_TOKEN", `no active machine token called ${name}`); return true; }
        o.updateTenant(me.name, { machineTokens: (me.machineTokens ?? []).map((m) => (m.name === name ? { ...m, revoked: new Date((o.now ?? Date.now)()).toISOString().replace(/\.\d{3}Z$/, "Z") } : m)) });
        send(res, 200, { ok: true, revoked: name });
        return true;
      }
      fail(res, 405, "METHOD", "GET, POST /account/tokens or DELETE /account/tokens/<name>");
      return true;
    }

    if (method === "POST" && url.pathname === "/account/starter") {
      const body = (await readJson(req, 256 * 1024)) as { dids?: unknown; claims?: unknown } | undefined;
      send(res, ...(await claimStarter(o, me, Array.isArray(body?.dids) ? (body!.dids as unknown[]) : [], Array.isArray(body?.claims) ? (body!.claims as unknown[]) : [])));
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
        sealedRunLogs: d.runLogs.map((r) => ({ ...r, download: `/runlogs/${encodeURIComponent(r.id)}` })),
        ...(o.telemetry && NAME.test(me.name) ? { telemetry: { on: me.dataSharing?.choice !== "private", sharing: me.dataSharing?.choice === "private" ? "private" : "share", entries: o.telemetry.list(me.name).map((e) => ({ ...e, ...(e.deletedAt ? {} : { content: o.telemetry!.get(me.name, e.hash)?.content }) })) } } : {}),
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
