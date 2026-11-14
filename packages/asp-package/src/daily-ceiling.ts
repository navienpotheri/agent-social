/**
 * The denial-of-wallet guard (register rows DK8 and CY14; spec-delta S464): other agents, a hidden instruction or a loop can wake an agent again and again and spend its sponsor's tokens. Each time a run
 * starts for an agent (a wake), the guard checks three ceilings for the UTC day and refuses the run, naming the ceiling, when one is reached: tokens spent in the day (and a run that starts is capped to
 * what is left), wakes in the day, and wakes by one sender. Every wake is recorded with who woke it, so the sponsor can see who woke whom. State is a small file; nothing here is a credit.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

export interface Limits { tokens?: number; wakes?: number; senderWakes?: number }
export type Ceiling = "daily_tokens" | "daily_wakes" | "sender_wakes";
export type Verdict = { ok: true; tokensLeft?: number } | { ok: false; ceiling: Ceiling; reason: string };
interface Day { tokens: number; wakes: { at: string; sender: string; refused?: Ceiling }[] }
type State = { days: Record<string, Record<string, Day>> };

const KEEP_DAYS = 14;

export class DailyCeiling {
  private state: State = { days: {} };
  private readonly file: string;
  constructor(file: string) {
    this.file = file;
    try { if (existsSync(file)) this.state = JSON.parse(readFileSync(file, "utf8")) as State; } catch { /* a damaged file starts empty: the guard is a help, the Mandate and the token cap still stand */ }
  }

  private day(agent: string, day: string): Day { return ((this.state.days[day] ??= {})[agent] ??= { tokens: 0, wakes: [] }); }
  tokensUsed(agent: string, day: string): number { return this.state.days[day]?.[agent]?.tokens ?? 0; }
  wakesToday(agent: string, day: string): number { return (this.state.days[day]?.[agent]?.wakes ?? []).filter((w) => !w.refused).length; }
  bySender(agent: string, day: string, sender: string): number { return (this.state.days[day]?.[agent]?.wakes ?? []).filter((w) => !w.refused && w.sender === sender).length; }

  /** A run is about to start for `agent`, woken by `sender`: records the wake (or the refusal) and says whether it may go on. */
  wake(agent: string, sender: string, day: string, at: string, limits: Limits): Verdict {
    const d = this.day(agent, day);
    const refuse = (ceiling: Ceiling, reason: string): Verdict => { d.wakes.push({ at, sender, refused: ceiling }); this.save(); return { ok: false, ceiling, reason }; };
    if (limits.tokens !== undefined && d.tokens >= limits.tokens) return refuse("daily_tokens", `the daily token ceiling for ${agent} is ${limits.tokens} and ${d.tokens} are spent today (UTC ${day}): it was woken by ${sender} and does not run again until the day turns over; raise it with --daily-tokens`);
    if (limits.wakes !== undefined && this.wakesToday(agent, day) >= limits.wakes) return refuse("daily_wakes", `the daily wake ceiling for ${agent} is ${limits.wakes} and it has been woken ${this.wakesToday(agent, day)} times today (UTC ${day}); this wake by ${sender} is refused until the day turns over; raise it with --daily-wakes`);
    if (limits.senderWakes !== undefined && this.bySender(agent, day, sender) >= limits.senderWakes) return refuse("sender_wakes", `${sender} has woken ${agent} ${this.bySender(agent, day, sender)} times today (UTC ${day}), which is the ceiling for one sender (${limits.senderWakes}); other senders are not affected; raise it with --sender-wakes`);
    d.wakes.push({ at, sender });
    this.save();
    return { ok: true, ...(limits.tokens !== undefined ? { tokensLeft: limits.tokens - d.tokens } : {}) };
  }

  /** What a finished run spent. */
  addTokens(agent: string, day: string, tokens: number): void { this.day(agent, day).tokens += Math.max(0, Math.trunc(tokens)); this.save(); }

  /** Who woke the agent, by day: for the sponsor's report. */
  report(agent?: string): { day: string; agent: string; tokens: number; wakes: number; refused: number; bySender: Record<string, number>; ceilingsHit: Ceiling[] }[] {
    const out: ReturnType<DailyCeiling["report"]> = [];
    for (const day of Object.keys(this.state.days).sort()) for (const [a, d] of Object.entries(this.state.days[day])) {
      if (agent && a !== agent) continue;
      const bySender: Record<string, number> = {};
      for (const w of d.wakes) if (!w.refused) bySender[w.sender] = (bySender[w.sender] ?? 0) + 1;
      out.push({ day, agent: a, tokens: d.tokens, wakes: d.wakes.filter((w) => !w.refused).length, refused: d.wakes.filter((w) => w.refused).length, bySender, ceilingsHit: [...new Set(d.wakes.flatMap((w) => (w.refused ? [w.refused] : [])))] });
    }
    return out;
  }

  private save(): void {
    const days = Object.keys(this.state.days).sort().slice(-KEEP_DAYS);
    this.state.days = Object.fromEntries(days.map((k) => [k, this.state.days[k]]));
    const tmp = `${this.file}.${process.pid}.part`;
    writeFileSync(tmp, JSON.stringify(this.state));
    renameSync(tmp, this.file);
  }
}
