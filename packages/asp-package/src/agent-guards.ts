/**
 * Guards on how an agent runs (register rows DK843, DK821 and DK822; spec-deltas S1231 to S1233; docs/intake/11th-nov.md Part 3, ranks 17, 18 and 19). DK843: a LOOP CIRCUIT BREAKER and a daily token budget beside
 * the call cap: halt on N equivalent calls, a recursion depth or a token cap, with a signed halted record, after which credits stop draining. DK821: ROLES in a fleet Mandate: a router that may dispatch but not
 * execute, workers with sub-Mandates no wider than the router's, and a watchdog that may read logs and signal a halt; the log marks the roles. DK822: a SELF-INITIATED ACTION marker: an Action field `unprompted`, a Mandate
 * that says whether unprompted work is allowed and under which caps, and the share reported. Pure code, scripted agents; credits are mock accounting entries.
 */
import { createHash } from "node:crypto";
import { b64urlEncode, signBytes } from "@agent-social/asp-core";

const sha = (x: unknown) => "sha256:" + createHash("sha256").update(JSON.stringify(x)).digest("hex");
const canon = (o: unknown): string => JSON.stringify(o, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b))) : v));

// ---- DK843 ----
export interface Halted { reason: "equivalent_calls" | "depth" | "token_cap"; at: number; detail: string; sig: string }
export interface BreakerOptions { maxEquivalent: number; maxDepth: number; dailyTokenCap: number; creditPerCall: number; seed: Uint8Array }
export class LoopBreaker {
  halted: Halted | null = null;
  creditsSpent = 0;
  private readonly seen = new Map<string, number>();
  private tokens = 0;
  private n = 0;
  private readonly o: BreakerOptions;
  constructor(o: BreakerOptions) { this.o = o; }
  private halt(reason: Halted["reason"], detail: string): { ok: false; halted: Halted } {
    const body = { reason, at: this.n, detail };
    this.halted = { ...body, sig: b64urlEncode(signBytes(new TextEncoder().encode(JSON.stringify(body)), this.o.seed)) };
    return { ok: false, halted: this.halted };
  }
  /** A call: refused once halted; halts on the Nth equivalent call (the same tool with the same arguments), on a depth beyond the cap, or when the day's tokens pass the cap. Each call that runs costs credits. */
  call(tool: string, args: Record<string, unknown>, depth: number, tokens: number): { ok: true } | { ok: false; halted: Halted } {
    if (this.halted) return { ok: false, halted: this.halted };
    this.n++;
    if (depth > this.o.maxDepth) return this.halt("depth", `depth ${depth} is beyond ${this.o.maxDepth}`);
    const key = sha({ tool, args: canon(args) });
    const count = (this.seen.get(key) ?? 0) + 1;
    this.seen.set(key, count);
    if (count >= this.o.maxEquivalent) return this.halt("equivalent_calls", `${tool} called ${count} times with the same arguments`);
    this.tokens += tokens;
    if (this.tokens > this.o.dailyTokenCap) return this.halt("token_cap", `${this.tokens} tokens against a cap of ${this.o.dailyTokenCap}`);
    this.creditsSpent += this.o.creditPerCall;
    return { ok: true };
  }
}

// ---- DK821 ----
export type Role = "router" | "worker" | "watchdog";
export interface RoleEntry { seq: number; agent: string; role: Role; scopes: string[]; parent: string | null }
export class Fleet {
  readonly roleLog: RoleEntry[] = [];
  readonly halted = new Set<string>();
  private readonly routerScopes: string[];
  private readonly router: string;
  constructor(router: string, routerScopes: string[]) { this.router = router; this.routerScopes = [...routerScopes].sort(); this.roleLog.push({ seq: 0, agent: router, role: "router", scopes: this.routerScopes, parent: null }); }
  /** A worker's sub-Mandate may be no wider than the router's. */
  spawnWorker(agent: string, scopes: string[]): { ok: true } | { ok: false; code: "WORKER_WIDER_THAN_ROUTER"; extra: string[] } {
    const extra = scopes.filter((s) => !this.routerScopes.includes(s));
    if (extra.length) return { ok: false, code: "WORKER_WIDER_THAN_ROUTER", extra };
    this.roleLog.push({ seq: this.roleLog.length, agent, role: "worker", scopes: [...scopes].sort(), parent: this.router });
    return { ok: true };
  }
  addWatchdog(agent: string): void { this.roleLog.push({ seq: this.roleLog.length, agent, role: "watchdog", scopes: ["logs.read", "fleet.halt"], parent: this.router }); }
  roleOf(agent: string): Role | undefined { return this.roleLog.find((r) => r.agent === agent)?.role; }
  /** What an agent may do by its role: a router dispatches and never executes, a worker executes inside its scopes, a watchdog reads and halts. */
  act(agent: string, action: "dispatch" | "execute" | "read_logs" | "halt", target?: string): { ok: true } | { ok: false; code: "ROUTER_CANNOT_EXECUTE" | "NOT_A_WATCHDOG" | "WORKER_CANNOT_DISPATCH" | "HALTED" | "NO_ROLE" | "WATCHDOG_CANNOT_EXECUTE" } {
    const role = this.roleOf(agent);
    if (!role) return { ok: false, code: "NO_ROLE" };
    if (this.halted.has(agent)) return { ok: false, code: "HALTED" };
    if (action === "execute") return role === "router" ? { ok: false, code: "ROUTER_CANNOT_EXECUTE" } : role === "watchdog" ? { ok: false, code: "WATCHDOG_CANNOT_EXECUTE" } : { ok: true };
    if (action === "dispatch") return role === "router" ? { ok: true } : { ok: false, code: "WORKER_CANNOT_DISPATCH" };
    if (role !== "watchdog") return { ok: false, code: "NOT_A_WATCHDOG" };
    if (action === "halt" && target) this.halted.add(target);
    return { ok: true };
  }
  /** The watchdog's rule: a worker with no progress for `limit` ticks is stuck and is halted. */
  watch(watchdog: string, progress: Record<string, number>, limit: number): string[] {
    const stuck = Object.entries(progress).filter(([a, idle]) => this.roleOf(a) === "worker" && idle >= limit).map(([a]) => a).sort();
    for (const a of stuck) this.act(watchdog, "halt", a);
    return stuck;
  }
}

// ---- DK822 ----
export interface UnpromptedPolicy { allowed: boolean; perDayCap: number }
export interface ActionRow { id: string; day: string; action: string; unprompted: boolean }
export class ActionRecorder {
  readonly rows: ActionRow[] = [];
  private readonly policy: UnpromptedPolicy;
  constructor(policy: UnpromptedPolicy) { this.policy = policy; }
  record(day: string, action: string, unprompted: boolean): { ok: true; id: string } | { ok: false; code: "UNPROMPTED_NOT_ALLOWED" | "UNPROMPTED_CAP" } {
    if (unprompted) {
      if (!this.policy.allowed) return { ok: false, code: "UNPROMPTED_NOT_ALLOWED" };
      if (this.rows.filter((r) => r.unprompted && r.day === day).length >= this.policy.perDayCap) return { ok: false, code: "UNPROMPTED_CAP" };
    }
    const id = `x${this.rows.length}`;
    this.rows.push({ id, day, action, unprompted });
    return { ok: true, id };
  }
  /** The share of actions that were unprompted, in permille. */
  share(): { unprompted: number; total: number; permille: number } {
    const u = this.rows.filter((r) => r.unprompted).length;
    return { unprompted: u, total: this.rows.length, permille: this.rows.length ? Math.round((u / this.rows.length) * 1000) : 0 };
  }
}
