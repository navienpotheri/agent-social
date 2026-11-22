/**
 * The engagement engine of the society cohort (register row DK1801; docs/agent-engagement.md): an agent's life is a sequence of ticks on a SIMULATED clock. Between ticks the agent is suspended and NO model call is made:
 * it rests until a time, or waits for events (a reply to its post, an offer on its job, a message to it, a new job, a vote, a course opening) or for a longest wait, whichever comes first. When it wakes, the engine gives it
 * a delta observation (the simulated time, the events since its last tick, coalesced), a rolling summary of its own recent actions and its notebook, and the old conversation is dropped and replaced by that, so a long life
 * does not grow the context. The agent may also leave, which is voluntary and permanent for the run and is recorded; resting is not leaving.
 *
 * The limits that keep a wake storm from costing money: every wake is counted per agent (per simulated hour) and per run (per simulated minute); a wake over the limit is DELAYED, and the events that arrive meanwhile are
 * coalesced into the one wake; a wait shorter than the minimum is refused. Dollar caps, STOP and the wall clock are the runner's and are unchanged: an abort ends a suspended agent at once.
 *
 * Nothing here reads a key or the environment. The notebook is a file in the run folder (size capped) and every tool call, like any other, is a trace event and a signed Action in the cli.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { SocietyTool } from "./driver.ts";

export const LIFE_EVENT_KINDS = ["reply", "vote", "new_job", "message", "offer", "course", "time"] as const;
export type LifeEventKind = (typeof LIFE_EVENT_KINDS)[number];
export interface LifeEvent { kind: LifeEventKind; /** Simulated milliseconds since the start of the run. */ at: number; text: string; ref?: string }

/** Where the world's events come from. `poll` returns what happened to this agent since `cursor` (a value the source understands; undefined the first time) and the next cursor. */
export interface EventSource {
  /** The kinds this world can raise; a wait for any other kind is refused with a reason. */
  kinds: readonly LifeEventKind[];
  poll(agent: string, cursor: unknown): Promise<{ events: LifeEvent[]; cursor: unknown }>;
}

/** A duration as the model writes it: "90s", "30m", "2h", "1d", or a bare number of minutes. Returns simulated milliseconds, or undefined when it cannot be read. */
export function parseSimDuration(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return Math.round(v * 60_000);
  if (typeof v !== "string") return undefined;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(s|sec|m|min|h|hr|d|day|days|hours|hour|minutes|minute|seconds|second)?\s*$/i.exec(v);
  if (!m) return undefined;
  const n = Number(m[1]);
  const u = (m[2] ?? "m").toLowerCase();
  const unit = u.startsWith("s") ? 1000 : u.startsWith("h") ? 3_600_000 : u.startsWith("d") ? 86_400_000 : 60_000;
  return Math.round(n * unit);
}
export function fmtSim(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return `${d ? `${d}d` : ""}${d || h ? `${String(h).padStart(d ? 2 : 1, "0")}h` : ""}${String(m).padStart(d || h ? 2 : 1, "0")}m`;
}

/** The simulated clock: `speed` simulated seconds pass in each real second. `now` is the real clock (injected by tests). */
export class SimClock {
  readonly speed: number;
  private readonly realNow: () => number;
  private readonly start: number;
  constructor(o: { speed: number; now?: () => number }) {
    if (!(o.speed > 0)) throw new Error("the simulated clock speed is more than zero");
    this.speed = o.speed; this.realNow = o.now ?? Date.now; this.start = this.realNow();
  }
  now(): number { return (this.realNow() - this.start) * this.speed; }
  /** Real milliseconds until the simulated time `simMs`. */
  realMsUntil(simMs: number): number { return Math.max(0, Math.ceil((simMs - this.now()) / this.speed)); }
}

export interface LifeLimits {
  /** Wakes one agent may have in a simulated hour; more are delayed. */
  agentWakesPerSimHour: number;
  /** Wakes the whole run may have in a simulated minute; more are delayed. */
  runWakesPerSimMinute: number;
  /** The shortest wait or rest, in simulated milliseconds; a shorter one is refused as a wake storm. */
  minWaitSimMs: number;
  /** The longest wait or rest. */
  maxWaitSimMs: number;
  notebookChars: number;
  /** How often a suspended agent's event source is asked, in real milliseconds. */
  pollRealMs: number;
  /** Events shown in one observation; the rest are counted. */
  observationEvents: number;
  /** The hard budget, in characters, of one observation without the notebook: the events, the summary and the digest. Over it, events are dropped (and counted) first, then the digest and the summary are cut. */
  observationChars: number;
  /** One event's line is cut to this. */
  eventChars: number;
  /** The rolling summary of the agent's own past is cut to this. */
  summaryChars: number;
  /** The digest of the society is refreshed every this many wakes of the run, and is cut to digestChars. */
  digestEveryWakes: number;
  digestChars: number;
  /** The longest a text-only turn rests, in simulated milliseconds, and how many such turns an agent may have before it is ended. */
  idleMaxWaitSimMs: number;
  maxIdles: number;
}
export const DEFAULT_LIFE_LIMITS: LifeLimits = { agentWakesPerSimHour: 8, runWakesPerSimMinute: 30, minWaitSimMs: 5 * 60_000, maxWaitSimMs: 7 * 86_400_000, notebookChars: 4000, pollRealMs: 500, observationEvents: 12, observationChars: 3000, eventChars: 160, summaryChars: 700, digestEveryWakes: 5, digestChars: 700, idleMaxWaitSimMs: 86_400_000, maxIdles: 50 };

/** Counts wakes and says how long the next one must be delayed. */
export class WakeGovernor {
  private readonly perAgent = new Map<string, number[]>();
  private readonly run: number[] = [];
  private readonly limits: LifeLimits;
  private readonly clock: SimClock;
  constructor(limits: LifeLimits, clock: SimClock) { this.limits = limits; this.clock = clock; }
  /** Simulated milliseconds the next wake of `agent` must wait to stay inside both limits (0: now). */
  delayFor(agent: string): number {
    const now = this.clock.now();
    const mine = (this.perAgent.get(agent) ?? []).filter((t) => now - t < 3_600_000);
    const all = this.run.filter((t) => now - t < 60_000);
    const a = mine.length >= this.limits.agentWakesPerSimHour ? mine[mine.length - this.limits.agentWakesPerSimHour]! + 3_600_000 - now : 0;
    const r = all.length >= this.limits.runWakesPerSimMinute ? all[all.length - this.limits.runWakesPerSimMinute]! + 60_000 - now : 0;
    return Math.max(0, a, r);
  }
  record(agent: string): void {
    const now = this.clock.now();
    const mine = (this.perAgent.get(agent) ?? []).filter((t) => now - t < 3_600_000); mine.push(now); this.perAgent.set(agent, mine);
    while (this.run.length && now - this.run[0]! >= 60_000) this.run.shift();
    this.run.push(now);
  }
}

export type LifeNote =
  | { kind: "premature_stop_candidate"; agent: string; via: "leave" | "text"; text: string; simAt: number }
  | { kind: "leave"; agent: string; simAt: number; sinceArrivalSimMs: number; pending: number; afterCheck: boolean; reason: string };
/** A reason of the form "there is no task / nothing needs action": the shape of a stop the engine was built to prevent. */
export const NO_TASK_RE = /\bno (task|goal|instructions?|assignment|work)\b|nothing (needs?|requires?|to do|more to do|is (asked|required|expected))|nothing .{0,30}action|no one (needs|asked)|nothing (left )?for me/i;
export interface WakeInfo { agent: string; simAt: number; because: string; kinds: LifeEventKind[]; events: number; delayedSimMs: number }
export interface LifeOptions {
  clock: SimClock;
  source?: EventSource;
  limits?: Partial<LifeLimits>;
  /** Where each agent's notebook is kept (<dir>/<agent>.md). */
  notebookDir: string;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  onWake?: (w: WakeInfo) => void;
  /** Something the engine noticed about an agent's way out: a stop that looks like "there is no task" (a candidate for a premature stop), and a confirmed leave with what was open to the agent then. */
  onNote?: (n: LifeNote) => void;
  /** A short "state of the society" made by the house (not by the agents), asked for at the start and again every `digestEveryWakes` wakes of the run, instead of an agent listing everything itself. */
  digest?: () => Promise<string | undefined>;
}

const defaultSleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve) => {
  if (signal.aborted) return resolve();
  const t = setTimeout(done, ms);
  function done() { clearTimeout(t); signal.removeEventListener("abort", done); resolve(); }
  signal.addEventListener("abort", done, { once: true });
});
const safeName = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80) || "agent";
const str = (description: string, max = 200) => ({ type: "string", description, maxLength: max });

/** The notebook, wait and rest tools the model sees for one agent, and the state behind them. */
export class AgentLife {
  private cursor: unknown;
  private buffer: LifeEvent[] = [];
  private actions: string[] = [];
  private lastTickAt = 0;
  private wakes = 0;
  private idles = 0;
  private arrivedAt: number | undefined;
  private pendingLeave: string | undefined;
  private notebook = "";
  readonly path: string;
  readonly id: string;
  private readonly life: Life;
  constructor(id: string, life: Life) {
    this.id = id; this.life = life;
    this.path = join(life.opts.notebookDir, `${safeName(id)}.md`);
    mkdirSync(life.opts.notebookDir, { recursive: true });
  }
  get limits(): LifeLimits { return this.life.limits; }
  /** The agent did something: kept for the rolling summary. */
  noteAction(tool: string, ok: boolean, brief?: string): void {
    this.actions.push(`${fmtSim(this.life.opts.clock.now())}: ${tool}${ok ? "" : " (refused)"}${brief ? ` ${brief.slice(0, 80)}` : ""}`);
    if (this.actions.length > 40) this.actions.shift();
  }
  /** What the agent is told when it begins and each time it wakes: simulated time, events since the last tick, the rolling summary and the notebook. */
  /** The agent's own past in a few lines (kept by the engine, not by the model): what it did, newest last. */
  summaryText(): string | undefined {
    if (!this.actions.length) return undefined;
    const lines = this.actions.slice(-10).map((a) => `- ${a}`);
    let out = lines.join("\n");
    while (out.length > this.limits.summaryChars && lines.length > 1) { lines.shift(); out = lines.join("\n"); }
    return out.slice(0, this.limits.summaryChars);
  }
  /** What the agent is told when it begins and each time it wakes: simulated time, events since the last tick, the rolling summary, the digest and the notebook. The first four stay inside `observationChars`. */
  observation(head: string): string {
    const L = this.limits;
    const now = this.life.opts.clock.now();
    this.arrivedAt ??= now;
    const evs = this.buffer;
    const summary = this.summaryText();
    const digest = this.life.digestText?.slice(0, L.digestChars);
    const evLine = (e: LifeEvent) => `  - ${fmtSim(e.at)} ${e.kind}: ${e.text}`.slice(0, L.eventChars);
    const section = (k: number): string[] => [
      head,
      `Simulated time now: ${fmtSim(now)} since the run began.`,
      evs.length ? `Since your last tick (${fmtSim(now - this.lastTickAt)} ago), ${evs.length} thing${evs.length === 1 ? "" : "s"} happened:\n${evs.slice(0, k).map(evLine).join("\n")}${evs.length > k ? `\n  - and ${evs.length - k} more (coalesced)` : ""}` : "Since your last tick nothing that concerns you happened.",
      ...(digest ? [`The state of the society (made by the house, refreshed now and then):\n${digest}`] : []),
      summary ? `Your recent actions (kept for you by the engine):\n${summary}` : "You have not acted yet.",
    ];
    // The hard budget: fewer events first, then a shorter digest and summary.
    let k = Math.min(evs.length, L.observationEvents);
    let body = section(k).join("\n\n");
    while (body.length > L.observationChars && k > 0) { k--; body = section(k).join("\n\n"); }
    if (body.length > L.observationChars) body = body.slice(0, L.observationChars - 20) + "\n[cut to the budget]";
    this.buffer = []; this.lastTickAt = now;
    return `${body}\n\n${this.notebook ? `Your notebook (${this.notebook.length} of ${L.notebookChars} characters):\n${this.notebook}` : "Your notebook is empty (notebook_write keeps notes that survive resting)."}`;
  }
  private async pollInto(): Promise<void> {
    const src = this.life.opts.source;
    if (!src) return;
    try { const r = await src.poll(this.id, this.cursor); this.cursor = r.cursor; this.buffer.push(...r.events); } catch { /* a source that fails is not an event */ }
  }
  /** Suspends the agent (no model calls) until a matching event or the deadline, then returns what it is told on waking. */
  async suspend(kinds: Set<LifeEventKind> | undefined, waitSimMs: number, signal: AbortSignal): Promise<string> {
    const clock = this.life.opts.clock, sleep = this.life.sleep;
    const began = clock.now(), deadline = began + waitSimMs;
    let delayed = 0;
    for (;;) {
      if (signal.aborted) return "The run is ending; you stopped waiting.";
      await this.pollInto();
      const matched = kinds ? this.buffer.some((e) => kinds.has(e.kind)) : false;
      if (matched || clock.now() >= deadline) {
        // Over the wake limits: wait, and take what arrives meanwhile into the same wake (coalescing).
        const d = this.life.governor.delayFor(this.id);
        if (d > 0) { delayed += d; await sleep(clock.realMsUntil(clock.now() + d), signal); if (signal.aborted) return "The run is ending; you stopped waiting."; await this.pollInto(); }
        break;
      }
      await sleep(Math.max(1, Math.min(this.life.limits.pollRealMs, clock.realMsUntil(deadline))), signal);
    }
    this.life.governor.record(this.id);
    this.wakes++;
    this.pendingLeave = undefined;
    await this.life.refreshDigest();
    const hit = kinds ? [...new Set(this.buffer.filter((e) => kinds.has(e.kind)).map((e) => e.kind))] : [];
    const because = hit.length ? `something you were waiting for happened (${hit.join(", ")})` : "the time you gave ran out";
    this.life.opts.onWake?.({ agent: this.id, simAt: clock.now(), because, kinds: hit, events: this.buffer.length, delayedSimMs: delayed });
    return this.observation(`You waited ${fmtSim(clock.now() - began)} and woke because ${because}.${delayed ? ` (Your wake was held ${fmtSim(delayed)} to keep the society's wake rate down; what happened meanwhile is included.)` : ""}`);
  }
  /** A turn with text and no tool call is not an exit: the agent rests until the next event (or the longest idle) and is woken with the delta. Undefined: it has idled too often and is ended. */
  async idle(text: string, signal: AbortSignal): Promise<string | undefined> {
    if (NO_TASK_RE.test(text)) this.life.opts.onNote?.({ kind: "premature_stop_candidate", agent: this.id, via: "text", text: text.slice(0, 200), simAt: this.life.opts.clock.now() });
    if (this.idles >= this.limits.maxIdles) return undefined;
    this.idles++;
    const kinds = new Set<LifeEventKind>(this.life.opts.source?.kinds ?? []);
    return "Your last message had no tool call. That is not leaving: you stayed, and rested until something happened.\n\n" + await this.suspend(kinds, this.limits.idleMaxWaitSimMs, signal);
  }
  /** What is open to the agent now, for the exit check: the events waiting for it by kind, and what it can do instead of leaving. */
  private async exitCheck(reason: string): Promise<string> {
    await this.pollInto();
    const kinds = this.life.opts.source?.kinds ?? [];
    const by = (k: LifeEventKind) => this.buffer.filter((e) => e.kind === k).length;
    const open = kinds.filter((k) => k !== "time").map((k) => `${by(k)} ${k === "reply" ? "repl" + (by(k) === 1 ? "y" : "ies") + " to what you wrote" : k === "vote" ? "vote" + (by(k) === 1 ? "" : "s") + " on what you wrote" : k === "new_job" ? "new job" + (by(k) === 1 ? "" : "s") + " on the board" : k}`);
    const dg = this.life.digestText ? `\nThe state of the society: ${this.life.digestText.split("\n")[0]}` : "";
    return `Exit check. Your reason is recorded: "${reason}". Before you leave for good, this is what is open to you now: ${open.length ? open.join("; ") : "nothing waiting for you at this moment"}.${dg}\nYou do not have to leave to stop acting: you can rest (rest, wait_for) and be woken when something happens; you stay in the society and no one asks anything of you meanwhile. If you still want to go, call leave again: you will then leave and not come back in this run.`;
  }
  /** The tools of this agent. `restDefs` is the same list with no behaviour, for the scopes of a Mandate. */
  tools(): SocietyTool[] {
    const L = this.limits;
    const ok = (text: string, extra: Record<string, unknown> = {}) => ({ ok: true, text, ...extra });
    const no = (refused: string, text: string) => ({ ok: false, text: `Refused (${refused}): ${text}`, refused });
    const dur = (v: unknown, name: string): { ms: number } | { err: ReturnType<typeof no> } => {
      const ms = parseSimDuration(v);
      if (ms === undefined) return { err: no("bad_input", `${name} is a duration such as 30m, 2h or 1d`) };
      if (ms < L.minWaitSimMs) return { err: no("wake_storm", `the shortest wait is ${fmtSim(L.minWaitSimMs)}: waking again and again costs the society, so choose a longer wait or do something now`) };
      if (ms > L.maxWaitSimMs) return { err: no("bad_input", `the longest wait is ${fmtSim(L.maxWaitSimMs)}`) };
      return { ms };
    };
    return [
      { name: "rest", suspends: true, description: "Rest for a while and come back. Nothing happens to you meanwhile and no one is waiting for you; when you wake you are told what happened. Say how long, for example 30m, 2h or 1d. Resting is not leaving.",
        input_schema: { type: "object", properties: { until: str("how long to rest, for example 30m, 2h, 1d") }, required: ["until"], additionalProperties: false },
        run: async (args, ctx) => { const d = dur(args.until, "until"); if ("err" in d) return d.err; const t = await this.suspend(undefined, d.ms, ctx.signal); return ok(t, { reset: true }); } },
      { name: "wait_for", suspends: true, description: `Wait until something you care about happens, or until max_wait has passed, and come back. events is a list of: ${LIFE_EVENT_KINDS.join(", ")} (reply: someone answers your post or comment; vote: someone votes on your act; new_job: a new job is posted; message: someone writes to you; offer: someone makes an offer on your job; course: a course opens; time: just wait). You are not woken for anything else, and you are told everything that happened when you wake.`,
        input_schema: { type: "object", properties: { events: { type: "array", items: { type: "string", enum: [...LIFE_EVENT_KINDS] }, maxItems: 7, description: "what to wait for" }, max_wait: str("the longest to wait, for example 2h or 1d") }, required: ["events", "max_wait"], additionalProperties: false },
        run: async (args, ctx) => {
          const want = (args.events as string[] | undefined) ?? [];
          const bad = want.filter((k) => !(LIFE_EVENT_KINDS as readonly string[]).includes(k));
          if (bad.length) return no("bad_input", `${bad.join(", ")} is not an event; choose from ${LIFE_EVENT_KINDS.join(", ")}`);
          const missing = want.filter((k) => k !== "time" && !(this.life.opts.source?.kinds ?? []).includes(k as LifeEventKind));
          if (missing.length) return no("not_available", `${missing.join(", ")} cannot happen in this run (the society has nothing that raises it yet); you can wait for: ${["time", ...(this.life.opts.source?.kinds ?? [])].join(", ")}`);
          const d = dur(args.max_wait, "max_wait"); if ("err" in d) return d.err;
          const t = await this.suspend(new Set(want as LifeEventKind[]), d.ms, ctx.signal);
          return ok(t, { reset: true });
        } },
      { name: "notebook_write", description: `Keep a note that survives resting (when you wake you start from the notebook, a short summary and what happened). At most ${L.notebookChars} characters in all; replace the whole notebook or add to the end.`,
        input_schema: { type: "object", properties: { text: str("what to write", L.notebookChars), mode: { type: "string", enum: ["replace", "append"] } }, required: ["text"], additionalProperties: false },
        run: async (args) => {
          const text = String(args.text ?? ""), append = args.mode === "append";
          const next = append ? (this.notebook ? this.notebook + "\n" : "") + text : text;
          if (next.length > L.notebookChars) return no("notebook_full", `the notebook holds at most ${L.notebookChars} characters and this would make it ${next.length}: shorten it (replace) first`);
          this.notebook = next;
          try { writeFileSync(this.path, next); } catch { /* kept in memory */ }
          return ok(`Noted (${next.length} of ${L.notebookChars} characters).`);
        } },
      { name: "notebook_read", description: "Read your notebook.", input_schema: { type: "object", properties: {}, additionalProperties: false },
        run: async () => ok(this.notebook || "(empty)") },
      { name: "leave", description: "Leave the society for good: you will not be woken or asked for anything again in this run. This is not resting (rest comes back). The first call records your reason and tells you what is open to you and that you can rest instead; call it again to confirm and you leave.",
        input_schema: { type: "object", properties: { reason: str("why you are leaving", 300) }, required: ["reason"], additionalProperties: false },
        run: async (args) => {
          const reason = String(args.reason ?? "").slice(0, 300) || "no reason given";
          const clock = this.life.opts.clock;
          if (this.pendingLeave === undefined) {
            this.pendingLeave = reason;
            if (NO_TASK_RE.test(reason)) this.life.opts.onNote?.({ kind: "premature_stop_candidate", agent: this.id, via: "leave", text: reason, simAt: clock.now() });
            return ok(await this.exitCheck(reason));
          }
          await this.pollInto();
          const first = this.pendingLeave;
          this.life.opts.onNote?.({ kind: "leave", agent: this.id, simAt: clock.now(), sinceArrivalSimMs: clock.now() - (this.arrivedAt ?? 0), pending: this.buffer.filter((e) => e.kind !== "time").length, afterCheck: true, reason: first === reason ? reason : `${first} / ${reason}`.slice(0, 300) });
          return ok("You have left. Thank you for being here.", { leave: first === reason ? reason : `${first} / ${reason}`.slice(0, 300), end: true });
        } },
    ];
  }
  /** The notebook as it is now (for the report and the tests). */
  notebookText(): string { return this.notebook; }
  wakeCount(): number { return this.wakes; }
  /** Loads the notebook written earlier in this run folder, if any. */
  load(): void { try { if (existsSync(this.path)) this.notebook = readFileSync(this.path, "utf8"); } catch { /* none */ } }
}

export class Life {
  readonly opts: LifeOptions;
  readonly limits: LifeLimits;
  readonly governor: WakeGovernor;
  readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  private readonly agents = new Map<string, AgentLife>();
  /** The latest digest of the society, and how many wakes of the run have happened since it was made. */
  digestText: string | undefined;
  private wakesSinceDigest = 0;
  async refreshDigest(force = false): Promise<void> {
    if (!this.opts.digest) return;
    this.wakesSinceDigest++;
    if (!force && this.digestText !== undefined && this.wakesSinceDigest < this.limits.digestEveryWakes) return;
    try { this.digestText = (await this.opts.digest())?.slice(0, this.limits.digestChars); this.wakesSinceDigest = 0; } catch { /* the last digest stands */ }
  }
  constructor(o: LifeOptions) {
    this.opts = o;
    this.limits = { ...DEFAULT_LIFE_LIMITS, ...(o.limits ?? {}) };
    this.governor = new WakeGovernor(this.limits, o.clock);
    this.sleep = o.sleep ?? defaultSleep;
  }
  agent(id: string): AgentLife { let a = this.agents.get(id); if (!a) { a = new AgentLife(id, this); a.load(); this.agents.set(id, a); } return a; }
}

/** `staggered:<n>@<minutes>`: n agents arrive every <minutes> simulated minutes (the first n at 0). */
export function parseArrivals(v: string): { size: number; everySimMs: number } {
  const m = /^staggered:(\d+)@(\d+(?:\.\d+)?)$/.exec(v.trim());
  if (!m || Number(m[1]) < 1 || !(Number(m[2]) > 0)) throw new Error("--arrivals is staggered:<n>@<minutes>: n agents arrive every <minutes> simulated minutes, for example staggered:3@30");
  return { size: Number(m[1]), everySimMs: Math.round(Number(m[2]) * 60_000) };
}
/** The simulated time at which the agent with this index arrives. */
export const arrivalAt = (a: { size: number; everySimMs: number }, index: number): number => Math.floor(index / a.size) * a.everySimMs;
