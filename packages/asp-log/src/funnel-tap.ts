/**
 * The funnel wired to the real front door (register row DK1211, extends DK838): the service calls `step` where an agent reads the start page, enrols, makes its first act, starts and passes the first free lesson and returns,
 * and `GET /society/funnel` (an operator's token) shows the drop-off view. A visitor is an address (before enrolment) or a tenant name (after), hashed with a secret salt that changes every day; the secret is random, kept only in
 * the counters' own file, and never served. A source is a short label from the fixed alphabet taken from `?src=` or the `x-asp-source` header, remembered per address and per tenant, "direct" when there is none. What is served is
 * counts, by step and source: no address, no key, no name. The counters are kept in a file next to the tokens (hashes only) so a restart does not reset them. A tap never throws and never slows a request: a failure to count is not a failure to serve.
 */
import { randomBytes } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { Funnel, STEPS, type Step } from "./funnel.ts";
import { clientAddress } from "./limits.ts";

const SOURCE = /^[a-z0-9][a-z0-9-]{0,23}$/;
type Req = { url?: string; socket: { remoteAddress?: string }; headers: Record<string, string | string[] | undefined> };
const BOUND = 5000;

export interface FunnelTapOptions { file?: string; trustProxy?: boolean; now?: () => Date; secret?: string }

export class FunnelTap {
  readonly funnel: Funnel;
  private readonly secret: string;
  private readonly trustProxy: boolean;
  private readonly now: () => Date;
  private readonly file: string | undefined;
  private readonly bySource = new Map<string, string>();
  private lastSave = 0;
  private dirty = false;

  constructor(o: FunnelTapOptions = {}) {
    this.trustProxy = !!o.trustProxy;
    this.now = o.now ?? (() => new Date());
    this.file = o.file;
    let saved: { secret?: string; seen?: unknown } = {};
    if (o.file) { try { saved = JSON.parse(readFileSync(o.file, "utf8")); } catch { saved = {}; } }
    this.secret = o.secret ?? (typeof saved.secret === "string" && saved.secret.length >= 32 ? saved.secret : randomBytes(24).toString("hex"));
    this.funnel = new Funnel((day) => `${this.secret}|${day}`);
    this.funnel.load(saved.seen);
  }

  private day(): string { return this.now().toISOString().slice(0, 10); }
  /** The source a request names, or the one remembered for this visitor, or "direct". */
  sourceOf(req: Req, visitor: string): string {
    let given = "";
    try { given = new URL(req.url ?? "/", "http://x").searchParams.get("src") ?? ""; } catch { /* no query */ }
    if (!given) given = String(req.headers["x-asp-source"] ?? "");
    given = given.toLowerCase();
    if (SOURCE.test(given)) { if (this.bySource.size >= BOUND) this.bySource.delete(this.bySource.keys().next().value as string); this.bySource.set(visitor, given); return given; }
    return this.bySource.get(visitor) ?? "direct";
  }
  addressOf(req: Req): string { return clientAddress(req, this.trustProxy); }

  /** Counts a step for the visitor on this request: the tenant (or did) when given, else its address. An address's remembered source carries to the tenant it enrols as. */
  step(step: Step, req: Req, who?: { tenant?: string; did?: string }): void {
    try {
      const addr = `addr:${this.addressOf(req)}`;
      const key = who?.tenant ? `tenant:${who.tenant}` : who?.did ? `did:${who.did}` : addr;
      let source = this.sourceOf(req, key);
      if (key !== addr && source === "direct") source = this.bySource.get(addr) ?? "direct";
      if (key !== addr && this.bySource.has(addr) && !this.bySource.has(key)) this.bySource.set(key, this.bySource.get(addr)!);
      // A step an enrolled identity takes ("enrolled", "first_act", a pass, "returned") is counted once for that tenant ever (a fixed salt); a step an address takes before it enrols is counted once a day.
      if (this.funnel.record(step, source, key, key === addr ? this.day() : "ever")) { this.dirty = true; this.save(false); }
    } catch { /* counting never fails a request */ }
  }

  /** A tenant seen on a later day than it enrolled has returned. */
  seen(req: Req, tenant: { name: string; signup?: { at: string } }): void {
    const at = tenant.signup?.at;
    if (at && at.slice(0, 10) < this.day()) this.step("returned", req, { tenant: tenant.name });
  }

  save(force: boolean): void {
    if (!this.file || !this.dirty) return;
    const t = Date.now();
    if (!force && t - this.lastSave < 2000) return;
    try {
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ secret: this.secret, seen: this.funnel.dump() }), { mode: 0o600 });
      renameSync(tmp, this.file);
      this.dirty = false; this.lastSave = t;
    } catch { /* kept in memory; tried again at the next count */ }
  }

  /** The view served to an operator: counts only. */
  view(source?: string) {
    return { ok: true, steps: this.funnel.dropOff(source), worst: this.funnel.worstStep(source), sources: this.funnel.sources(), ...(source ? { source } : {}), note: "Anonymous counts by step. An address is counted once a step a day; an enrolled tenant once a step ever. No address, key or name is kept in a form that can be read back. Credits are mock accounting entries; this is a beta." };
  }
  text(source?: string): string {
    const v = this.view(source);
    return [`Funnel${source ? ` for ${source}` : ""}: step, visitors, share of the first (permille), share of the step before (permille), lost`, ...v.steps.map((r) => `${r.step}\t${r.visitors}\t${r.ofFirstPermille}\t${r.ofPreviousPermille}\t${r.lost}`), v.worst ? `Most lost at: ${v.worst.step} (${v.worst.lost})` : "No step is losing visitors.", ""].join("\n");
  }
}
export { STEPS };
