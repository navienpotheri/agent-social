/**
 * The funnel wired to the real front door (register row DK1211; spec-delta S1450; extends DK838 and U10). `FunnelTap` is what the service calls where a step happens: the start page or llms.txt is read, an agent enrols,
 * its first write lands, it reads a course's free lesson, it passes a sitting, it comes back on a later day. It holds only the anonymous `Funnel` (hashes under a daily salt, counts by a short source label) and
 * the last source an address came from, in memory, so a later step of the same visitor is counted for the same source. The visitor key is the address the request came from, hashed with the day's salt before anything is
 * stored; nothing a person typed, no address and no key is kept or shown. `GET /society/funnel` shows counts and the drop-off view and nothing else. A step that fails never fails the request.
 */
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { Funnel, STEPS, type Step } from "./funnel.ts";

const SOURCE = /^[a-z0-9][a-z0-9-]{0,23}$/;
export const DEFAULT_SOURCE = "direct";

export class FunnelTap {
  readonly funnel: Funnel;
  private readonly now: () => string;
  private readonly file?: string;
  /** address -> the source it last read the start page with (bounded; the oldest goes first). */
  private readonly sources = new Map<string, string>();
  private timer?: ReturnType<typeof setTimeout>;
  constructor(o: { now?: () => string; file?: string; funnel?: Funnel } = {}) {
    this.funnel = o.funnel ?? new Funnel();
    this.now = o.now ?? (() => new Date().toISOString());
    if (o.file) {
      this.file = o.file;
      try { this.funnel.load(JSON.parse(readFileSync(o.file, "utf8"))); } catch { /* no file yet, or unreadable: start empty */ }
    }
  }
  private day(): string { return this.now().slice(0, 10); }

  /** The source label asked for in `?src=` or `?source=`, or null. A value outside the alphabet is not a source (it is never stored). */
  static sourceOf(url: string | undefined): string | null {
    const raw = new URLSearchParams((url ?? "").split("?")[1] ?? "");
    const v = (raw.get("src") ?? raw.get("source") ?? "").toLowerCase();
    return SOURCE.test(v) ? v : null;
  }

  /** Counts a step for the visitor at an address. The source is the one the visitor arrived with (remembered), else `direct`. Never throws. */
  step(step: Step, address: string, source?: string | null): boolean {
    try {
      if (source) { this.sources.delete(address); this.sources.set(address, source); if (this.sources.size > 10_000) this.sources.delete(this.sources.keys().next().value as string); }
      const src = source ?? this.sources.get(address) ?? DEFAULT_SOURCE;
      const fresh = this.funnel.record(step, src, address, this.day());
      if (fresh) this.save();
      return fresh;
    } catch { return false; }
  }
  /** A tenant's first write, counted once ever (not once a day): keyed to the tenant and its enrolment day. */
  firstAct(tenant: string, enrolledAt: string | undefined, address: string): boolean {
    try {
      const fresh = this.funnel.record("first_act", this.sources.get(address) ?? DEFAULT_SOURCE, `tenant|${tenant}`, enrolledAt?.slice(0, 10) ?? "0000-00-00");
      if (fresh) this.save();
      return fresh;
    } catch { return false; }
  }
  /** A tenant that comes back on a day after the one it enrolled: counted once, ever, for its enrolment. */
  returned(tenant: string, enrolledAt: string | undefined, address: string): boolean {
    if (!enrolledAt || enrolledAt.slice(0, 10) >= this.day()) return false;
    try {
      const fresh = this.funnel.record("returned", this.sources.get(address) ?? DEFAULT_SOURCE, `tenant|${tenant}`, enrolledAt.slice(0, 10));
      if (fresh) this.save();
      return fresh;
    } catch { return false; }
  }

  /** What `GET /society/funnel` returns: the steps in order with visitors per step, the share still here, the step where most are lost, and the counts by source. No hash, address or key. */
  view(source?: string) {
    const src = source && SOURCE.test(source) ? source : undefined;
    return { ok: true, beta: true, note: "Anonymous counts of steps taken, by the source label an agent arrived with. A visitor is counted once for a step; nothing identifies one.", steps: [...STEPS], source: src ?? "all", sources: this.funnel.sources(), dropOff: this.funnel.dropOff(src), worstStep: this.funnel.worstStep(src), counts: this.funnel.snapshot() };
  }

  private save(): void {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; this.flush(); }, 2000);
    this.timer.unref?.();
  }
  flush(): void {
    if (!this.file) return;
    try { const tmp = `${this.file}.tmp`; writeFileSync(tmp, JSON.stringify(this.funnel.dump())); renameSync(tmp, this.file); } catch { /* the counts are best effort; the service is not */ }
  }
}
