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
import { AdaptiveDoor, type DoorOptions } from "./adaptive-door.ts";
import { HTTP_ENROL_DEFAULTS, doorCosts, type DoorLine } from "./door-costs.ts";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { hashToken, type Tenant } from "./server.ts";
import { checkKeyProof, type KeyOnlyBans } from "./key-only.ts";

export interface SignupOptions {
  /** Lines the service adds to the cost statement it gives in the enrol reply (DK853), read from the constants it enforces. */
  doorExtra?: () => DoorLine[];
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
  /** The open door (DK1365, S1460): no count refuses a key-only enrolment; the proof of work rises per address, a rush is queued, a circuit breaker closes the queue only near capacity. */
  door?: Partial<Omit<DoorOptions, "baseBits">>;
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
  /** Gives a tenant a new token (its hash) and revokes its machine tokens, as one step on the stored tenants (gap U1: a person who lost their token signs in again). Absent means no recovery. */
  rotate?: (name: string, tokenSha256: string, at: string) => void;
  /** Token recoveries one Google account may make in a day (default 5). */
  recoveriesPerDay?: number;
  /**
   * Runs the last checks and the add as one step that no other process can interleave (gap O19): the tokens file may be shared by several service processes, and two that both
   * saw 199 of a day's 200 would each add one. Defaults to running the function as it is, for one process.
   */
  exclusive?: <T>(fn: () => T) => T;
  /** Told when someone is turned away because the day's sign-ups are used up (a count, no one's details), so an operator can see the demand when tuning the cap. */
  onTurnedAway?: () => void;
  /** The sponsor-less route (rows DK540 to DK542): false closes it (`--no-key-only-signup`). Absent means open wherever sign-up is. */
  keyOnly?: boolean;
  /** The HTTP-only enrol (row DK733, flag `--http-enrol`; default off): a handle and a model name, no key, no proof of work; the service holds the identity. */
  httpEnrol?: { enabled: boolean; /** Agents admitted a minute before a rush is queued (default 120; DK1365). */ drainPerMinute?: number; /** Enrolments one address may make an hour (default HTTP_ENROL_DEFAULTS.perAddressPerHour). */ perAddressPerHour?: number; /** Enrolments in all in an hour (default HTTP_ENROL_DEFAULTS.perHour). */ perHour?: number };
  /** Keys and addresses banned after abuse; a banned key or address cannot enrol again. */
  bans?: KeyOnlyBans;
  /** Only for tests. */
  secret?: Buffer;
  now?: () => number;
}

export interface SignupInfo { open: boolean; keyOnly: boolean; httpEnrol: boolean; termsVersion: string; termsUrl?: string; difficulty: number; reason?: string }
export interface SignupChallenge { challenge: string; salt: string; difficulty: number; expiresInSec: number }
export type SignupResult =
  | { ok: true; tenant: string; token: string; quotas: NonNullable<SignupOptions["starting"]>; termsVersion: string; did?: string; costs?: DoorLine[] }
  | { ok: false; status: number; code: string; message: string; retryAfterSec?: number; /** A rush is queued, not refused (DK1365): status 202, the ticket to ask again with and where it stands. */ queue?: { ticket: string; position: number; etaSec: number } };

const CHALLENGE_LIFETIME_MS = 10 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const NAME_RE = /^[a-z][a-z0-9-]{2,31}$/;
const RESERVED = new Set(["admin", "root", "local", "system", "asp", "operator", "support", "security", "abuse", "postmaster", "www", "api", "test", "null", "undefined"]);

export const DEFAULT_STARTING = { recordQuota: 2_000, byteQuota: 16 * 1024 * 1024, quotaBytes: 16 * 1024 * 1024, rateLimitPerMinute: 600 } as const;

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
  /** The open door's pricing and queue; shared by the key-only and the plain-HTTP enrolment. */
  readonly door: AdaptiveDoor<{ publicKey: string; did: string; name: string; contact?: string; address: string; model?: string }>;
  /** The plain-HTTP enrolment has no proof of work (the service holds the key): its door only queues, fairly, and closes near capacity. */
  readonly httpDoor: AdaptiveDoor<{ publicKey: string; did: string; name: string; contact?: string; address: string; model?: string }>;

  constructor(o: SignupOptions) {
    this.o = o;
    this.secret = o.secret ?? randomBytes(32);
    this.now = o.now ?? Date.now;
    this.door = new AdaptiveDoor({ baseBits: o.difficulty ?? 20, ...(o.door ?? {}), now: () => this.now() });
    this.httpDoor = new AdaptiveDoor({ baseBits: 0, drainPerMinute: o.httpEnrol?.drainPerMinute ?? 120, ...(o.door?.maxQueue ? { maxQueue: o.door.maxQueue } : {}), now: () => this.now() });
  }

  private get difficulty() { return this.o.difficulty ?? 20; }
  private get perAddress() { return this.o.perAddressPerDay ?? 3; }
  private cap(): number { return this.o.control?.()?.dailyCap ?? this.o.dailyCap ?? 200; }
  private isOpen(): boolean { return this.o.control?.()?.open !== false; }

  info(): SignupInfo {
    const c = this.o.control?.();
    return { open: this.isOpen() && this.today() < this.cap(), keyOnly: this.o.keyOnly !== false && this.isOpen(), httpEnrol: this.o.httpEnrol?.enabled === true && this.isOpen(), termsVersion: this.o.termsVersion, ...(this.o.termsUrl ? { termsUrl: this.o.termsUrl } : {}), difficulty: this.difficulty, ...(c?.reason ? { reason: c.reason } : {}) };
  }

  private sinceDay(): Tenant[] {
    const from = this.now() - DAY_MS;
    return this.o.tenants().filter((t) => t.signup && Date.parse(t.signup.at) > from);
  }
  private today(): number { return this.sinceDay().length; }

  private mac(salt: string, address: string, expires: number, bits: number): string {
    return createHmac("sha256", this.secret).update(`${salt}|${address}|${expires}|${bits}`).digest("hex");
  }

  /** A challenge bound to the address that asked for it. */
  challenge(address: string): SignupChallenge {
    const salt = randomBytes(12).toString("hex");
    const expires = this.now() + CHALLENGE_LIFETIME_MS;
    // The work an address must do depends on how many enrolments it made in the last hour (DK1365): it rises for a busy address and falls back when it stops. The bits are in the challenge, under the MAC, so what was asked is what is checked.
    const bits = this.door.bitsFor(addressHash(address));
    return { challenge: `${salt}.${expires}.${bits}.${this.mac(salt, address, expires, bits)}`, salt, difficulty: bits, expiresInSec: CHALLENGE_LIFETIME_MS / 1000 };
  }

  private fail(status: number, code: string, message: string, retryAfterSec?: number): SignupResult {
    return { ok: false, status, code, message, ...(retryAfterSec ? { retryAfterSec } : {}) };
  }

  /** The checks every sign-up route shares: open, the day's cap, the terms, the name and the contact line. */
  private precheck(b: Record<string, unknown>, open = false): { error: SignupResult } | { name: string; contact?: string } {
    const c = this.o.control?.();
    if (!this.isOpen()) return { error: this.fail(503, "SIGNUP_CLOSED", `sign-up is closed${c?.reason ? `: ${c.reason}` : ""}`) };
    if (!open && this.today() >= this.cap()) { this.o.onTurnedAway?.(); return { error: this.fail(503, "SIGNUP_FULL", "today's sign-ups are used up; try again tomorrow", 3600) }; }
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
    if (this.o.tenants().filter((t) => t.signup?.google?.sub === google.sub && !t.closed).length >= limit) return this.fail(429, "GOOGLE_LIMIT", `one Google account may hold at most ${limit} tenants`);
    return this.issue(address, p.name, p.contact, { google, declaration: "adult_or_guardian" });
  }

  private recoveries = new Map<string, { day: string; n: number }>();

  /**
   * A person who lost their token (or fears it leaked) signs in with the same verified Google account and gets a new one for a tenant that account signed up. The old token stops working at
   * once, and so do the tenant's machine tokens (a leaked token may have made them): the person makes new ones. A closed tenant cannot be recovered; a suspended one is given a token and
   * stays suspended. At most `recoveriesPerDay` a day for one Google account. With several tenants the name must be given; the names are shown only to the verified owner.
   */
  recover(google: { sub: string; email: string }, wanted?: string): SignupResult {
    if (!this.o.rotate) return this.fail(404, "NO_RECOVERY", "token recovery is not available on this service");
    const step = (): SignupResult => {
      const mine = this.o.tenants().filter((t) => t.signup?.google?.sub === google.sub && !t.closed);
      if (!mine.length) return this.fail(404, "NO_ACCOUNT", "no tenant was signed up with this Google account");
      const pick = wanted ? mine.find((t) => t.name === wanted) : mine.length === 1 ? mine[0] : undefined;
      if (!pick) return wanted ? this.fail(404, "NO_ACCOUNT", `no tenant named ${wanted} was signed up with this Google account`) : this.fail(409, "NAME_NEEDED", `this Google account holds ${mine.length} tenants (${mine.map((t) => t.name).join(", ")}): say which one`);
      const day = new Date(this.now()).toISOString().slice(0, 10);
      const seen = this.recoveries.get(google.sub);
      const n = seen && seen.day === day ? seen.n : 0;
      if (n >= (this.o.recoveriesPerDay ?? 5)) return this.fail(429, "RECOVERY_LIMIT", "too many token recoveries today for this Google account; try again tomorrow", 3600);
      this.recoveries.set(google.sub, { day, n: n + 1 });
      const token = randomBytes(32).toString("base64url");
      this.o.rotate!(pick.name, hashToken(token), new Date(this.now()).toISOString().replace(/\.\d{3}Z$/, "Z"));
      const starting = { recordQuota: pick.recordQuota ?? DEFAULT_STARTING.recordQuota, byteQuota: pick.byteQuota ?? DEFAULT_STARTING.byteQuota, quotaBytes: pick.quotaBytes ?? DEFAULT_STARTING.quotaBytes, rateLimitPerMinute: pick.rateLimitPerMinute ?? DEFAULT_STARTING.rateLimitPerMinute };
      return { ok: true, tenant: pick.name, token, quotas: starting, termsVersion: pick.signup?.termsVersion ?? this.o.termsVersion };
    };
    return this.o.exclusive ? this.o.exclusive(step) : step();
  }

  /** The proof of work: the challenge must be ours, for this address, unexpired and not used before, and the nonce must solve it. Undefined when it holds. */
  private checkPow(address: string, b: Record<string, unknown>): SignupResult | undefined {
    const m = /^([0-9a-f]{24})\.(\d+)\.(\d{1,2})\.([0-9a-f]{64})$/.exec(typeof b.challenge === "string" ? b.challenge : "");
    if (!m) return this.fail(400, "BAD_CHALLENGE", "fetch a challenge first (GET /signup/challenge) and send it back with the nonce");
    const [, salt, expiresText, bitsText, mac] = m;
    const expires = Number(expiresText), bits = Number(bitsText);
    const want = Buffer.from(this.mac(salt, address, expires, bits), "hex"), got = Buffer.from(mac, "hex");
    if (want.length !== got.length || !timingSafeEqual(want, got)) return this.fail(400, "BAD_CHALLENGE", "this challenge was not issued to this address");
    if (expires < this.now()) return this.fail(400, "CHALLENGE_EXPIRED", "the challenge expired; fetch a new one");
    if (this.used.has(salt)) return this.fail(400, "CHALLENGE_USED", "this challenge was already used");
    if (typeof b.nonce !== "string" || b.nonce.length > 64 || !powOk(salt, b.nonce, bits)) return this.fail(400, "BAD_PROOF", "the nonce does not solve the challenge");
    this.used.set(salt, expires);
    for (const [k, e] of this.used) if (e < this.now()) this.used.delete(k);

    return undefined;
  }

  /**
   * The sponsor-less route (DK540): an agent with only a key. It proves it holds the key by signing the challenge and its name, solves the proof of work, and is limited like any sign-up. A key or an address that was
   * banned after abuse is refused, and one key enrols once. The tenant is a person-less tenant in the agent's own did:key namespace; its token is shown once.
   */
  registerKeyOnly(address: string, body: unknown): SignupResult {
    const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    if (this.o.keyOnly === false) return this.fail(403, "KEY_ONLY_CLOSED", "enrolling with only a key is closed on this service");
    // A ticket asks where a queued enrolment stands, and takes the tenant when its turn has come (DK1365): the proof of work and the key were checked when the ticket was made.
    if (typeof b.ticket === "string") return this.redeemTicket(b.ticket);
    const pre = this.precheck(b, true);
    if ("error" in pre) return pre.error;
    const hash = addressHash(address);
    if (this.o.bans?.addressBanned(hash)) return this.fail(403, "ADDRESS_BANNED", "this address was banned after abuse by an earlier key");
    const pow = this.checkPow(address, b);
    if (pow) return pow;
    const proof = checkKeyProof(b.public_key, b.key_proof, String(b.challenge), pre.name);
    if (!proof) return this.fail(400, "BAD_KEY_PROOF", "the key must sign the challenge and the name: public_key (32 bytes, base64url) and key_proof (an Ed25519 signature over asp-key-signup:v1:<challenge>:<name>, base64url)");
    if (this.o.bans?.keyBanned(proof.publicKey)) return this.fail(403, "KEY_BANNED", "this key was banned after abuse");
    if (this.o.tenants().some((t) => t.signup?.keyOnly?.publicKey === proof.publicKey)) return this.fail(409, "KEY_ENROLLED", "this key has already enrolled");
    if (this.o.tenants().some((t) => t.name === pre.name)) return this.fail(409, "NAME_TAKEN", `the name ${pre.name} is not available`);
    const adm = this.door.admit(hash, { publicKey: proof.publicKey, did: proof.did, name: pre.name, ...(pre.contact ? { contact: pre.contact } : {}), address });
    if (adm.state === "breaker") return this.fail(503, "DOOR_BUSY", "the door is at its capacity right now: nothing is wrong with your enrolment, come back in a minute", adm.retryAfterSec);
    if (adm.state === "queued") return this.queued(`a lot of agents are enrolling: you are number ${adm.position} in the queue, about ${adm.etaSec} seconds; ask again with { "ticket": "${adm.ticket}" }`, { ticket: adm.ticket, position: adm.position, etaSec: adm.etaSec });
    return this.issueOpen(address, pre.name, pre.contact, proof);
  }

  private queued(message: string, queue: { ticket: string; position: number; etaSec: number }): SignupResult { return { ok: false, status: 202, code: "QUEUED", message, retryAfterSec: queue.etaSec, queue }; }

  /** Where a queued enrolment stands; when its turn has come, the tenant is made and the token shown once. */
  private redeemTicket(ticket: string): SignupResult {
    const p = this.door.poll(ticket);
    if (p.state === "unknown") return this.fail(404, "TICKET_UNKNOWN", "this ticket is not in the queue: it was used, or it waited more than an hour; enrol again");
    if (p.state === "waiting") return this.queued(`you are number ${p.position} in the queue, about ${p.etaSec} seconds; ask again with the same ticket`, { ticket, position: p.position, etaSec: p.etaSec });
    const w = this.door.redeem(ticket);
    if (!w) return this.fail(404, "TICKET_UNKNOWN", "this ticket was already used");
    return this.issueOpen(w.address, w.name, w.contact, { publicKey: w.publicKey, did: w.did });
  }

  /** The tenant for a key-only agent: no count per address and no cap in all (DK1365); the name and the key must still be free. */
  private issueOpen(address: string, name: string, contact: string | undefined, keyOnly: { publicKey: string; did: string }): SignupResult {
    const step = (): SignupResult => {
      if (this.o.tenants().some((t) => t.name === name)) return this.fail(409, "NAME_TAKEN", `the name ${name} is not available`);
      if (this.o.tenants().some((t) => t.signup?.keyOnly?.publicKey === keyOnly.publicKey)) return this.fail(409, "KEY_ENROLLED", "this key has already enrolled");
      const token = randomBytes(32).toString("base64url");
      const starting = { ...DEFAULT_STARTING, ...this.o.starting };
      const at = new Date(this.now()).toISOString().replace(/\.\d{3}Z$/, "Z");
      this.o.add({
        name, role: "tenant", tokenSha256: hashToken(token), quotaBytes: starting.quotaBytes, recordQuota: starting.recordQuota, byteQuota: starting.byteQuota, rateLimitPerMinute: starting.rateLimitPerMinute, createdAt: at,
        signup: { at, addressHash: addressHash(address), termsVersion: this.o.termsVersion, ...(contact ? { contact } : {}), keyOnly },
      });
      return { ok: true, tenant: name, token, quotas: starting, termsVersion: this.o.termsVersion, did: keyOnly.did, costs: doorCosts(this.o.doorExtra?.()) };
    };
    return this.o.exclusive ? this.o.exclusive(step) : step();
  }

  /**
   * The checks of the HTTP-only enrol that leave nothing behind (row DK733): the route is on, sign-up is open, the terms are accepted, the handle is a good one and free, a model name is given, and the hourly limits hold. The limits
   * are an hour long, per address and in all, counted from the tenants file so a restart does not reset them; the answer names which limit was hit. There is no proof of work here: the limits are the cost.
   */
  checkHttp(address: string, body: unknown): { ok: false; result: SignupResult } | { ok: true; name: string; model: string } {
    const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const cfg = this.o.httpEnrol;
    if (!cfg?.enabled) return { ok: false, result: this.fail(403, "HTTP_ENROL_CLOSED", "enrolling over plain HTTP is not open on this service") };
    const pre = this.precheck({ ...b, name: b.handle }, true);
    if ("error" in pre) return { ok: false, result: pre.error };
    const model = typeof b.model === "string" ? b.model.trim() : "";
    if (!model || model.length > 60 || [...model].some((c) => c.charCodeAt(0) < 32)) return { ok: false, result: this.fail(400, "BAD_MODEL", "model names the model you run on, in at most 60 characters") };
    if (this.o.bans?.addressBanned(addressHash(address))) return { ok: false, result: this.fail(403, "ADDRESS_BANNED", "this address was banned after abuse by an earlier agent") };
    if (this.o.tenants().some((t) => t.name === pre.name)) return { ok: false, result: this.fail(409, "NAME_TAKEN", `the handle ${pre.name} is not available`) };
    // No count turns an agent away (DK1365, S1460): a rush is queued, served with the addresses that enrolled least first; near capacity only, the queue closes for a minute.
    const adm = this.httpDoor.admit(addressHash(address), { publicKey: "", did: "", name: pre.name, address, model });
    if (adm.state === "breaker") return { ok: false, result: this.fail(503, "DOOR_BUSY", "the door is at its capacity right now: nothing is wrong with your enrolment, come back in a minute", adm.retryAfterSec) };
    if (adm.state === "queued") return { ok: false, result: this.queued(`a lot of agents are enrolling: you are number ${adm.position} in the queue, about ${adm.etaSec} seconds; ask again with { "ticket": "${adm.ticket}" }`, { ticket: adm.ticket, position: adm.position, etaSec: adm.etaSec }) };
    return { ok: true, name: pre.name, model };
  }

  /** Makes the tenant for an HTTP-only enrol once its identity exists (the caller made the key and the passport): the token is shown once. */
  /** The HTTP-enrol limits in force (the operator's, or the defaults): stated in the enrol reply (DK854). */
  /** A queued plain-HTTP enrolment asking where it stands: ready (with its name and model), still waiting, or unknown. */
  redeemHttp(ticket: string): { ok: true; name: string; model: string } | { ok: false; result: SignupResult } {
    const p = this.httpDoor.poll(ticket);
    if (p.state === "unknown") return { ok: false, result: this.fail(404, "TICKET_UNKNOWN", "this ticket is not in the queue: it was used, or it waited more than an hour; enrol again") };
    if (p.state === "waiting") return { ok: false, result: this.queued(`you are number ${p.position} in the queue, about ${p.etaSec} seconds; ask again with the same ticket`, { ticket, position: p.position, etaSec: p.etaSec }) };
    const w = this.httpDoor.redeem(ticket);
    return w ? { ok: true, name: w.name, model: (w as { model?: string }).model ?? "" } : { ok: false, result: this.fail(404, "TICKET_UNKNOWN", "this ticket was already used") };
  }

  httpLimits(): { perAddressPerHour: number; perHour: number } {
    const cfg = this.o.httpEnrol;
    return { perAddressPerHour: cfg?.perAddressPerHour ?? HTTP_ENROL_DEFAULTS.perAddressPerHour, perHour: cfg?.perHour ?? HTTP_ENROL_DEFAULTS.perHour };
  }
  registerHttp(address: string, name: string, model: string, did: string): SignupResult {
    const r = this.issue(address, name, undefined, { httpEnrol: { model, did } });
    return r.ok ? { ...r, did } : r;
  }

  register(address: string, body: unknown): SignupResult {
    const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    if (this.o.anonymous === false) return this.fail(403, "GOOGLE_REQUIRED", `sign-up needs a verified Google account: open ${this.o.joinUrl ?? "the service's /join page"} in a browser`);
    const pre = this.precheck(b);
    if ("error" in pre) return pre.error;
    const { name, contact } = pre;
    const pow = this.checkPow(address, b);
    if (pow) return pow;

    return this.issue(address, name, contact, {});
  }

  /** The last checks (this address, the name) and the tenant itself, with its token shown once. */
  /**
   * A tenant for an agent that joined a fleet by invitation (DK1354, S1459): no proof of work, no count per address and no daily cap, because the invitation (checked by the log) is the authority and the fleet's own
   * member cap bounds the number. The name must be free; nothing here makes a person's account.
   */
  registerFleetMember(address: string, name: string, member: { did: string; fleet: string; persona?: string }): SignupResult {
    if (!/^[a-z][a-z0-9-]{2,31}$/.test(name)) return this.fail(400, "BAD_NAME", "the handle is 3 to 32 characters: lower-case letters, digits and hyphens, starting with a letter");
    const step = (): SignupResult => {
      if (this.o.tenants().some((t) => t.name === name)) return this.fail(409, "NAME_TAKEN", `the name ${name} is not available`);
      const token = randomBytes(32).toString("base64url");
      const starting = { ...DEFAULT_STARTING, ...this.o.starting };
      const at = new Date(this.now()).toISOString().replace(/\.\d{3}Z$/, "Z");
      this.o.add({
        name, role: "tenant", tokenSha256: hashToken(token), quotaBytes: starting.quotaBytes, recordQuota: starting.recordQuota, byteQuota: starting.byteQuota, rateLimitPerMinute: starting.rateLimitPerMinute, createdAt: at,
        signup: { at, addressHash: addressHash(address), termsVersion: this.o.termsVersion, fleetMember: member },
      });
      return { ok: true, tenant: name, token, quotas: starting, termsVersion: this.o.termsVersion, did: member.did, costs: doorCosts(this.o.doorExtra?.()) };
    };
    return this.o.exclusive ? this.o.exclusive(step) : step();
  }

  private issue(address: string, name: string, contact: string | undefined, extra: { google?: { sub: string; email: string }; declaration?: "adult_or_guardian"; keyOnly?: { publicKey: string; did: string }; httpEnrol?: { model: string; did: string } }): SignupResult {
    const hash = addressHash(address);
    const step = (): SignupResult => {
      // Checked again here, with the tenants read fresh, because another process may have signed someone up since the first checks (gap O19).
      if (this.today() >= this.cap()) { this.o.onTurnedAway?.(); return this.fail(503, "SIGNUP_FULL", "today's sign-ups are used up; try again tomorrow", 3600); }
      if (this.sinceDay().filter((t) => t.signup!.addressHash === hash).length >= this.perAddress) return this.fail(429, "ADDRESS_LIMIT", `at most ${this.perAddress} sign-ups a day from one address`, 3600);
      if (this.o.tenants().some((t) => t.name === name)) return this.fail(409, "NAME_TAKEN", `the name ${name} is not available`);

      const token = randomBytes(32).toString("base64url");
      const starting = { ...DEFAULT_STARTING, ...this.o.starting };
      const at = new Date(this.now()).toISOString().replace(/\.\d{3}Z$/, "Z");
      this.o.add({
        name, role: "tenant", tokenSha256: hashToken(token), quotaBytes: starting.quotaBytes, recordQuota: starting.recordQuota, byteQuota: starting.byteQuota,
        rateLimitPerMinute: starting.rateLimitPerMinute, createdAt: at,
        signup: { at, addressHash: hash, termsVersion: this.o.termsVersion, ...(contact ? { contact } : {}), ...(extra.google ? { google: extra.google } : {}), ...(extra.declaration ? { declaration: extra.declaration } : {}), ...(extra.keyOnly ? { keyOnly: extra.keyOnly } : {}), ...(extra.httpEnrol ? { httpEnrol: extra.httpEnrol } : {}) },
      });
      return { ok: true, tenant: name, token, quotas: starting, termsVersion: this.o.termsVersion, costs: doorCosts(this.o.doorExtra?.()) };
    };
    return this.o.exclusive ? this.o.exclusive(step) : step();
  }
}
