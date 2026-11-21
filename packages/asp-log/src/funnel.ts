/**
 * The measured front door (register row DK838; spec-delta S1211; docs/intake/11th-nov.md, both agent-social chats; extends U10, the measurement of the beta funnel): anonymous counters for each step an agent takes from
 * the front door, by source, and a drop-off view. The steps are fixed, in order: the start page read, enrolment, the first act, the first free lesson started, the first free lesson passed, the first return. A counter
 * counts a visitor once for a step however often it repeats it. A visitor is a hash of an opaque key under a salt that changes every day, so the same key is the same visitor within a day and nothing identifies it
 * afterwards; a source is a short label from a fixed alphabet, never free text. The store keeps counts and hashes, nothing a person typed. A scripted agent walks the steps in the tests; no real traffic is measured here.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

export const STEPS = ["start_page_read", "enrolled", "first_act", "free_lesson_started", "free_lesson_passed", "returned"] as const;
export type Step = (typeof STEPS)[number];
const SOURCE = /^[a-z0-9][a-z0-9-]{0,23}$/;

export interface DropOffRow { step: Step; visitors: number; /** Share of the first step still here, in permille. */ ofFirstPermille: number; /** Share of the step before still here, in permille (1000 for the first step). */ ofPreviousPermille: number; /** Visitors lost since the step before. */ lost: number }

export class Funnel {
  /** step -> source -> visitor hashes (a Set so a repeat is one visitor). */
  private readonly seen = new Map<string, Set<string>>();
  private readonly salt: (day: string) => string;
  constructor(salt: (day: string) => string = (day) => `asp-funnel|${day}`) { this.salt = salt; }

  /** A visitor's hash for a day: of an opaque key (a cookie-less nonce, a session id), never stored raw. */
  visitor(key: string, day: string): string { return createHash("sha256").update(`${this.salt(day)}|${key}`).digest("hex").slice(0, 16); }

  /** Counts a visitor at a step for a source. A source outside the alphabet is refused; the step must be one of the fixed steps. Returns whether this was a new count. */
  record(step: Step, source: string, key: string, day: string): boolean {
    if (!STEPS.includes(step)) throw new Error(`${step} is not a funnel step`);
    if (!SOURCE.test(source)) throw new Error("a source is a short label of lowercase letters, digits and hyphens, not text");
    const id = `${step}|${source}`;
    const set = this.seen.get(id) ?? this.seen.set(id, new Set()).get(id)!;
    const v = this.visitor(key, day);
    if (set.has(v)) return false;
    set.add(v);
    return true;
  }

  count(step: Step, source?: string): number {
    let n = 0;
    for (const [id, set] of this.seen) { const [s, src] = id.split("|"); if (s === step && (source === undefined || src === source)) n += set.size; }
    return n;
  }
  sources(): string[] { return [...new Set([...this.seen.keys()].map((id) => id.split("|")[1]))].sort(); }

  /** The drop-off view: the steps in order with the visitors at each, the share of the first and of the step before, and how many were lost. Optionally for one source. */
  dropOff(source?: string): DropOffRow[] {
    const rows: DropOffRow[] = [];
    let first = 0, prev = 0;
    for (const [i, step] of STEPS.entries()) {
      const n = this.count(step, source);
      if (i === 0) first = n;
      rows.push({ step, visitors: n, ofFirstPermille: first ? Math.round((n / first) * 1000) : 0, ofPreviousPermille: i === 0 ? 1000 : prev ? Math.round((n / prev) * 1000) : 0, lost: i === 0 ? 0 : Math.max(0, prev - n) });
      prev = n;
    }
    return rows;
  }
  /** The step where the most visitors are lost, with how many (the first thing to fix). */
  worstStep(source?: string): { step: Step; lost: number } | null {
    const rows = this.dropOff(source).slice(1);
    const w = rows.reduce<DropOffRow | null>((a, b) => (!a || b.lost > a.lost ? b : a), null);
    return w && w.lost > 0 ? { step: w.step, lost: w.lost } : null;
  }
  /** What is stored: counts only, as the public view would show them. No visitor hash leaves this object. */
  snapshot(): { step: Step; source: string; visitors: number }[] {
    return [...this.seen].map(([id, set]) => { const [step, source] = id.split("|"); return { step: step as Step, source, visitors: set.size }; }).sort((a, b) => STEPS.indexOf(a.step) - STEPS.indexOf(b.step) || a.source.localeCompare(b.source));
  }
}

/** What the service writes to disk for the funnel: a random secret (so the daily hashes cannot be reversed by trying every address) and the visitor hashes per step and source. Hashes and counts only. */
interface Saved { v: 1; secret: string; seen: Record<string, string[]> }

const START_PATHS = new Set(["/society/start", "/society/llms.txt", "/start.txt", "/start.html", "/start"]);
const ENROL_PATHS = new Set(["/signup", "/signup/key", "/signup/http"]);
const LESSON = /^\/society\/courses\/[A-Za-z0-9-]+\/(practice|complete)\/?$/;
const SOURCE_LABEL = /^[a-z0-9][a-z0-9-]{0,23}$/;

/**
 * The funnel wired to the real front door (register row DK1211, extends DK838): the service counts an anonymous visitor at each step it actually serves. The visitor is the client address hashed with a
 * secret and the day, never stored; a source is the `?src=` label on the start page link (or `direct`), carried to the later steps of the same visitor that day. Steps: a start page read (GET /society/start,
 * /society/llms.txt, /start.txt); enrolment (a 2xx answer from /signup, /signup/key, /signup/http, or the Google callback); the first act (the first write an authenticated request makes); a free lesson
 * started (a 2xx practice answer) and passed (a 2xx completion); and a return (a tenant's request on a later day than its first). Nothing a person typed, no address and no key is kept: counts and salted hashes.
 * `GET /society/funnel` shows the drop-off view. A visitor on another day is a new visitor by design (the salt changes daily), so `returned` is keyed by tenant name, in memory only.
 */
export class FunnelTap {
  readonly funnel: Funnel;
  private readonly now: () => string;
  private readonly file?: string;
  private secret: string;
  private readonly sourceOfVisitor = new Map<string, string>();
  private readonly firstDay = new Map<string, string>();
  private sourceDay = "";

  constructor(o: { now?: () => string; file?: string; secret?: string } = {}) {
    this.now = o.now ?? (() => new Date().toISOString());
    this.file = o.file;
    this.secret = o.secret ?? randomBytes(16).toString("hex");
    this.funnel = new Funnel((day) => `${this.secret}|${day}`);
    if (this.file && existsSync(this.file)) {
      try {
        const s = JSON.parse(readFileSync(this.file, "utf8")) as Saved;
        this.secret = s.secret;
        for (const [id, hashes] of Object.entries(s.seen)) this.seenMap().set(id, new Set(hashes));
      } catch { /* an unreadable file starts a fresh funnel; nothing else depends on it */ }
    }
  }

  private seenMap(): Map<string, Set<string>> { return (this.funnel as unknown as { seen: Map<string, Set<string>> }).seen; }
  private day(): string { return this.now().slice(0, 10); }
  /** A source label from the start page link: lowercase letters, digits and hyphens, at most 24, else `direct`. */
  sourceOf(url: string): string {
    const q = new URLSearchParams(url.split("?")[1] ?? "");
    const raw = (q.get("src") ?? q.get("source") ?? "").toLowerCase();
    return SOURCE_LABEL.test(raw) ? raw : "direct";
  }
  private count(step: Step, source: string, key: string): void {
    if (this.funnel.record(step, source, key, this.day())) this.save();
  }
  private save(): void {
    if (!this.file) return;
    const seen: Record<string, string[]> = {};
    for (const [id, set] of this.seenMap()) seen[id] = [...set];
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ v: 1, secret: this.secret, seen } satisfies Saved), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
  private rollDay(): void {
    const day = this.day();
    if (day !== this.sourceDay) { this.sourceOfVisitor.clear(); this.sourceDay = day; }
  }
  private sourceFor(address: string): string {
    this.rollDay();
    return this.sourceOfVisitor.get(this.funnel.visitor(address, this.day())) ?? "direct";
  }

  /** Called at the top of a request: counts the step the answer completes, once the answer is sent with a 2xx (or, for the start page, 304) status. */
  observe(req: { method?: string; url?: string }, res: { statusCode: number; once(ev: "finish", fn: () => void): unknown }, address: string): void {
    const method = req.method ?? "GET", url = req.url ?? "/", path = url.split("?")[0]!;
    let step: Step | undefined;
    if ((method === "GET" || method === "HEAD") && START_PATHS.has(path)) step = "start_page_read";
    else if ((method === "POST" && ENROL_PATHS.has(path)) || (method === "GET" && path === "/auth/callback")) step = "enrolled";
    else { const m = method === "POST" ? LESSON.exec(path) : null; if (m) step = m[1] === "practice" ? "free_lesson_started" : "free_lesson_passed"; }
    if (!step) return;
    const src = step === "start_page_read" ? this.sourceOf(url) : undefined;
    const counted: Step = step;
    res.once("finish", () => {
      const ok = (res.statusCode >= 200 && res.statusCode < 300) || (counted === "start_page_read" && res.statusCode === 304);
      if (!ok) return;
      this.rollDay();
      if (src) this.sourceOfVisitor.set(this.funnel.visitor(address, this.day()), src);
      this.count(counted, src ?? this.sourceFor(address), address);
    });
  }
  /** Called when an authenticated request has passed the checks: the first write of a visitor is the first act; a tenant seen again on a later day is a return. */
  authenticated(tenant: string, address: string, write: boolean): void {
    const day = this.day();
    const first = this.firstDay.get(tenant);
    if (first === undefined) this.firstDay.set(tenant, day);
    else if (first < day) this.count("returned", this.sourceFor(address), `tenant:${tenant}`);
    if (write) this.count("first_act", this.sourceFor(address), address);
  }

  /** The public view: the drop-off steps, where most are lost, and the counts by source. */
  view(source?: string) {
    return { ok: true, steps: this.funnel.dropOff(source), worst: this.funnel.worstStep(source), sources: this.funnel.sources(), counts: this.funnel.snapshot(), note: "Anonymous counts: a visitor is a hash of the address under a secret and the day, so a visitor who returns on another day counts again. No address, key or text is kept. Credits are not money; this is a beta." };
  }
  /** `GET /society/funnel[?source=<label>]`, public, read-only. */
  route() {
    return async (req: { method?: string; url?: string }, res: { writeHead(s: number, h: Record<string, string>): unknown; end(b?: string): unknown }): Promise<boolean> => {
      if ((req.url ?? "").split("?")[0] !== "/society/funnel") return false;
      if (req.method !== "GET") { res.writeHead(405, { allow: "GET" }); res.end(); return true; }
      const src = new URLSearchParams((req.url ?? "").split("?")[1] ?? "").get("source") ?? undefined;
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" });
      res.end(JSON.stringify(this.view(src && SOURCE_LABEL.test(src) ? src : undefined)));
      return true;
    };
  }
}
