/**
 * Self-serve sign-up for the log service (gap O2: the sign-up path). A stranger asks for a tenant and a token without an operator running a command, and the
 * service has to survive that being public (and advertised), so every step is bounded:
 *
 *  - a proof of work before the request (the client finds a nonce whose SHA-256 with a server-signed challenge has so many leading zero bits): no third-party
 *    CAPTCHA, a second or two of CPU for a person and a real cost for a script that wants thousands of tenants;
 *  - the terms (a version the operator names) must be accepted, and the version is recorded with the tenant;
 *  - a few sign-ups per address per day and a cap on sign-ups per day in all, counted from the tenants file itself so a restart does not reset them;
 *  - a name that is short, plain and not reserved, unique;
 *  - starting quotas smaller than an operator-made tenant's (an operator raises them), and a tier of limits the log service already enforces;
 *  - a switch the operator can turn without a restart (open, closed, the day's cap).
 *
 * No email is asked for: an unverified address proves nothing, and OAuth sign-in (gap U1) is the identity step that comes later. The token is shown once; only its hash is stored.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { hashToken, type Tenant } from "./server.ts";

export interface SignupOptions {
  /** All tenants now (the sign-up count and the names in use come from here). */
  tenants: () => Tenant[];
  /** Stores a new tenant; it must be visible in `tenants()` when this returns. Runs synchronously with the checks, so two sign-ups cannot take one name. */
  add: (tenant: Tenant) => void;
  /** The version of the terms a person accepts, and where they can read them. */
  termsVersion: string;
  termsUrl?: string;
  /** Leading zero bits of the proof of work (default 20, about a second in Node; 0 for tests). */
  difficulty?: number;
  /** Sign-ups one address may make in a day (default 3), and all sign-ups in a day (default 200). */
  perAddressPerDay?: number;
  dailyCap?: number;
  /** What a new tenant starts with. */
  starting?: { recordQuota: number; byteQuota: number; quotaBytes: number; rateLimitPerMinute: number };
  /** Read on each request: lets an operator close sign-up or change the day's cap without a restart. */
  control?: () => { open?: boolean; dailyCap?: number; reason?: string } | undefined;
  /** False closes the anonymous route (the CLI's proof of work): sign-up is then only through a verified Google account (the /join page). */
  anonymous?: boolean;
  /** Where the browser sign-up is, for the message the anonymous route gives when it is closed. */
  joinUrl?: string;
  /** Tenants one Google account may hold (default 3). */
  perGoogleAccount?: number;
  /** Only for tests. */
  secret?: Buffer;
  now?: () => number;
}

export interface SignupInfo { open: boolean; termsVersion: string; termsUrl?: string; difficulty: number; reason?: string }
export interface SignupChallenge { challenge: string; salt: string; difficulty: number; expiresInSec: number }
export type SignupResult =
  | { ok: true; tenant: string; token: string; quotas: NonNullable<SignupOptions["starting"]>; termsVersion: string }
  | { ok: false; status: number; code: string; message: string; retryAfterSec?: number };

const CHALLENGE_LIFETIME_MS = 10 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const NAME_RE = /^[a-z][a-z0-9-]{2,31}$/;
const RESERVED = new Set(["admin", "root", "local", "system", "asp", "operator", "support", "security", "abuse", "postmaster", "www", "api", "test", "null", "undefined"]);

export const DEFAULT_STARTING = { recordQuota: 2_000, byteQuota: 16 * 1024 * 1024, quotaBytes: 16 * 1024 * 1024, rateLimitPerMinute: 120 } as const;

/** Leading zero bits of a digest. */
export function leadingZeroBits(digest: Buffer): number {
  let n = 0;
  for (const byte of digest) {
    if (byte === 0) { n += 8; continue; }
    n += Math.clz32(byte) - 24;
    break;
  }
  return n;
}
/** The proof of work: SHA-256 of `<salt>:<nonce>` has at least `difficulty` leading zero bits. */
export const powOk = (salt: string, nonce: string, difficulty: number) => difficulty <= 0 || leadingZeroBits(createHash("sha256").update(`${salt}:${nonce}`).digest()) >= difficulty;
/** What a client does: finds a nonce for the challenge it was given. */
export function solveChallenge(salt: string, difficulty: number): string {
  for (let i = 0; ; i++) { const nonce = i.toString(36); if (powOk(salt, nonce, difficulty)) return nonce; }
}

export const addressHash = (address: string) => createHash("sha256").update(`asp-signup:${address}`).digest("hex").slice(0, 24);

export class Signup {
  private o: SignupOptions;
  private secret: Buffer;
  private now: () => number;
  private used = new Map<string, number>();

  constructor(o: SignupOptions) {
    this.o = o;
    this.secret = o.secret ?? randomBytes(32);
    this.now = o.now ?? Date.now;
  }

  private get difficulty() { return this.o.difficulty ?? 20; }
  private get perAddress() { return this.o.perAddressPerDay ?? 3; }
  private cap(): number { return this.o.control?.()?.dailyCap ?? this.o.dailyCap ?? 200; }
  private isOpen(): boolean { return this.o.control?.()?.open !== false; }

  info(): SignupInfo {
    const c = this.o.control?.();
    return { open: this.isOpen() && this.today() < this.cap(), termsVersion: this.o.termsVersion, ...(this.o.termsUrl ? { termsUrl: this.o.termsUrl } : {}), difficulty: this.difficulty, ...(c?.reason ? { reason: c.reason } : {}) };
  }

  private sinceDay(): Tenant[] {
    const from = this.now() - DAY_MS;
    return this.o.tenants().filter((t) => t.signup && Date.parse(t.signup.at) > from);
  }
  private today(): number { return this.sinceDay().length; }

  private mac(salt: string, address: string, expires: number): string {
    return createHmac("sha256", this.secret).update(`${salt}|${address}|${expires}`).digest("hex");
  }

  /** A challenge bound to the address that asked for it. */
  challenge(address: string): SignupChallenge {
    const salt = randomBytes(12).toString("hex");
    const expires = this.now() + CHALLENGE_LIFETIME_MS;
    return { challenge: `${salt}.${expires}.${this.mac(salt, address, expires)}`, salt, difficulty: this.difficulty, expiresInSec: CHALLENGE_LIFETIME_MS / 1000 };
  }

  private fail(status: number, code: string, message: string, retryAfterSec?: number): SignupResult {
    return { ok: false, status, code, message, ...(retryAfterSec ? { retryAfterSec } : {}) };
  }

  /** The checks every sign-up route shares: open, the day's cap, the terms, the name and the contact line. */
  private precheck(b: Record<string, unknown>): { error: SignupResult } | { name: string; contact?: string } {
    const c = this.o.control?.();
    if (!this.isOpen()) return { error: this.fail(503, "SIGNUP_CLOSED", `sign-up is closed${c?.reason ? `: ${c.reason}` : ""}`) };
    if (this.today() >= this.cap()) return { error: this.fail(503, "SIGNUP_FULL", "today's sign-ups are used up; try again tomorrow", 3600) };
    if (b.accept_terms !== true || b.terms_version !== this.o.termsVersion) return { error: this.fail(400, "TERMS_NOT_ACCEPTED", `accept the terms (version ${this.o.termsVersion}${this.o.termsUrl ? `, at ${this.o.termsUrl}` : ""}) with accept_terms: true and terms_version`) };
    const name = typeof b.name === "string" ? b.name : "";
    if (!NAME_RE.test(name)) return { error: this.fail(400, "BAD_NAME", "the name is 3 to 32 characters: a lower-case letter first, then lower-case letters, digits and hyphens") };
    if (RESERVED.has(name)) return { error: this.fail(400, "NAME_TAKEN", `the name ${name} is not available`) };
    const contact = b.contact === undefined ? undefined : typeof b.contact === "string" && b.contact.length <= 120 && !/[\u0000-\u001f]/.test(b.contact) ? b.contact : null;
    if (contact === null) return { error: this.fail(400, "BAD_CONTACT", "contact is a line of at most 120 characters") };
    return { name, ...(contact ? { contact } : {}) };
  }

  /**
   * Sign-up with a verified Google account (the browser flow, src/google.ts): no proof of work, because a Google account is the cost, but the same terms, name,
   * address and day limits, and at most `perGoogleAccount` tenants for one Google account (a parent may hold one for each child). The person has declared that
   * they are an adult, or a parent or guardian signing up for a young person.
   */
  registerVerified(address: string, body: unknown, google: { sub: string; email: string }): SignupResult {
    const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const p = this.precheck(b);
    if ("error" in p) return p.error;
    if (b.declaration !== "adult_or_guardian") return this.fail(400, "DECLARATION_MISSING", "confirm that you are an adult, or a parent or guardian signing up for a young person");
    const limit = this.o.perGoogleAccount ?? 3;
    if (this.o.tenants().filter((t) => t.signup?.google?.sub === google.sub).length >= limit) return this.fail(429, "GOOGLE_LIMIT", `one Google account may hold at most ${limit} tenants`);
    return this.issue(address, p.name, p.contact, { google, declaration: "adult_or_guardian" });
  }

  register(address: string, body: unknown): SignupResult {
    const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    if (this.o.anonymous === false) return this.fail(403, "GOOGLE_REQUIRED", `sign-up needs a verified Google account: open ${this.o.joinUrl ?? "the service's /join page"} in a browser`);
    const pre = this.precheck(b);
    if ("error" in pre) return pre.error;
    const { name, contact } = pre;
    // The proof of work: the challenge must be ours, for this address, unexpired and not used before, and the nonce must solve it.
    const m = /^([0-9a-f]{24})\.(\d+)\.([0-9a-f]{64})$/.exec(typeof b.challenge === "string" ? b.challenge : "");
    if (!m) return this.fail(400, "BAD_CHALLENGE", "fetch a challenge first (GET /signup/challenge) and send it back with the nonce");
    const [, salt, expiresText, mac] = m;
    const expires = Number(expiresText);
    const want = Buffer.from(this.mac(salt, address, expires), "hex"), got = Buffer.from(mac, "hex");
    if (want.length !== got.length || !timingSafeEqual(want, got)) return this.fail(400, "BAD_CHALLENGE", "this challenge was not issued to this address");
    if (expires < this.now()) return this.fail(400, "CHALLENGE_EXPIRED", "the challenge expired; fetch a new one");
    if (this.used.has(salt)) return this.fail(400, "CHALLENGE_USED", "this challenge was already used");
    if (typeof b.nonce !== "string" || b.nonce.length > 64 || !powOk(salt, b.nonce, this.difficulty)) return this.fail(400, "BAD_PROOF", "the nonce does not solve the challenge");
    this.used.set(salt, expires);
    for (const [k, e] of this.used) if (e < this.now()) this.used.delete(k);

    return this.issue(address, name, contact, {});
  }

  /** The last checks (this address, the name) and the tenant itself, with its token shown once. */
  private issue(address: string, name: string, contact: string | undefined, extra: { google?: { sub: string; email: string }; declaration?: "adult_or_guardian" }): SignupResult {
    const hash = addressHash(address);
    if (this.sinceDay().filter((t) => t.signup!.addressHash === hash).length >= this.perAddress) return this.fail(429, "ADDRESS_LIMIT", `at most ${this.perAddress} sign-ups a day from one address`, 3600);
    if (this.o.tenants().some((t) => t.name === name)) return this.fail(409, "NAME_TAKEN", `the name ${name} is not available`);

    const token = randomBytes(32).toString("base64url");
    const starting = { ...DEFAULT_STARTING, ...this.o.starting };
    const at = new Date(this.now()).toISOString().replace(/\.\d{3}Z$/, "Z");
    this.o.add({
      name, role: "tenant", tokenSha256: hashToken(token), quotaBytes: starting.quotaBytes, recordQuota: starting.recordQuota, byteQuota: starting.byteQuota,
      rateLimitPerMinute: starting.rateLimitPerMinute, createdAt: at,
      signup: { at, addressHash: hash, termsVersion: this.o.termsVersion, ...(contact ? { contact } : {}), ...(extra.google ? { google: extra.google } : {}), ...(extra.declaration ? { declaration: extra.declaration } : {}) },
    });
    return { ok: true, tenant: name, token, quotas: starting, termsVersion: this.o.termsVersion };
  }
}
