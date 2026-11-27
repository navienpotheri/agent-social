/**
 * Agents write evals, and agents call agents to test an agent (register rows DK800 and DK801; spec-deltas S1218 and S1219; the 19th Nov owner screenshots, the harness diagram: simulate, judge and grade, cluster, propose,
 * agent review, human gate). DK800: a versioned, signed eval scenario (a caller persona, a goal, the tools that should run and the end state expected) derived from a FAILING run's log: it may name only tools and state
 * the run saw, it versions on change, a held-out part is kept apart from the practice part, and two agents' scenarios for the same failure are deduplicated the same way whatever the order. DK801: a sandbox with fake
 * tools and a state store in which a scripted caller agent drives the agent under test: the caller can reach only the sandbox, a run is repeatable from its seed, and the sandbox state is compared with the scenario's expected
 * end state. No free text enters a scenario or a result: personas and goals are short labels. Scripted callers and agents; a real deployed agent is a live run.
 */
import { createHash } from "node:crypto";
import { b64urlDecode, b64urlEncode, publicKeyFromSeed, signBytes, verifyBytes } from "@agent-social/asp-core";

export type Scalar = string | number | boolean;
export interface RunLog { hash: string; failed: boolean; tools: string[]; states: Record<string, Scalar>[]; runtime: string }
export interface Scenario {
  v: "asp.eval_scenario/v0"; id: string; version: number; supersedes: string | null;
  /** The hash of the failing run's log: the scenario is derived from it and says nothing else about it. */
  failure: string;
  persona: string; goal: string; tools: string[]; endState: Record<string, Scalar>;
  split: "practice" | "heldout"; author: string; sig?: string;
}
export type Draft = Pick<Scenario, "persona" | "goal" | "tools" | "endState" | "author">;
export type Refusal = { ok: false; code: "NOT_A_FAILURE" | "TOOL_NOT_SEEN" | "STATE_NOT_SEEN" | "NOT_A_LABEL" | "BAD_REVISION" | "EMPTY"; message: string };
const LABEL = /^[a-z0-9][a-z0-9_.-]{0,59}$/;
const sha = (x: unknown) => "sha256:" + createHash("sha256").update(JSON.stringify(x)).digest("hex");
const sortedState = (s: Record<string, Scalar>) => Object.fromEntries(Object.entries(s).sort(([a], [b]) => a.localeCompare(b)));

/** The deterministic split: a failure is held out or not by a hash of the seed and the failure, so every scenario of one failure is on the same side. */
export const splitFor = (failure: string, seed: string): Scenario["split"] => (parseInt(sha(`${seed}|${failure}`).slice(7, 15), 16) % 10 < 3 ? "heldout" : "practice");
const idOf = (s: Pick<Scenario, "version" | "supersedes" | "failure" | "persona" | "goal" | "tools" | "endState">) => sha({ v: s.version, sup: s.supersedes, f: s.failure, p: s.persona, g: s.goal, t: [...s.tools].sort(), e: sortedState(s.endState) });

function check(run: RunLog, d: Draft): Refusal | null {
  const bad = (code: Refusal["code"], message: string): Refusal => ({ ok: false, code, message });
  if (!run.failed) return bad("NOT_A_FAILURE", "a scenario is written from a failing run: this run did not fail");
  if (!LABEL.test(d.persona) || !LABEL.test(d.goal)) return bad("NOT_A_LABEL", "a persona and a goal are short labels (lowercase letters, digits, - . _), not free text");
  if (!d.tools.length || !Object.keys(d.endState).length) return bad("EMPTY", "a scenario names at least one tool and one expected end state");
  for (const t of d.tools) if (!run.tools.includes(t)) return bad("TOOL_NOT_SEEN", `the run never used the tool ${t}: a scenario names only what the run saw`);
  for (const [k, v] of Object.entries(d.endState)) if (!run.states.some((s) => s[k] === v)) return bad("STATE_NOT_SEEN", `the run never saw ${k} = ${String(v)}: a scenario names only states the run saw`);
  return null;
}

/** A new scenario from a failing run: refused if the run did not fail, or the draft names a tool or a state the run did not see. */
export function fromFailingRun(run: RunLog, d: Draft, seed = "eval-split-v1"): Scenario | Refusal {
  const r = check(run, d);
  if (r) return r;
  const base = { version: 1, supersedes: null as string | null, failure: run.hash, persona: d.persona, goal: d.goal, tools: [...d.tools].sort(), endState: sortedState(d.endState) };
  return { v: "asp.eval_scenario/v0", id: idOf(base), ...base, split: splitFor(run.hash, seed), author: d.author };
}
/** A change to a scenario is a new version that supersedes the old one: the same run, checked again, the version one higher. */
export function revise(prev: Scenario, run: RunLog, change: Partial<Pick<Draft, "persona" | "goal" | "tools" | "endState">>, seed = "eval-split-v1"): Scenario | Refusal {
  if (run.hash !== prev.failure) return { ok: false, code: "BAD_REVISION", message: "a scenario is revised against the run it came from" };
  const d: Draft = { persona: change.persona ?? prev.persona, goal: change.goal ?? prev.goal, tools: change.tools ?? prev.tools, endState: change.endState ?? prev.endState, author: prev.author };
  const r = check(run, d);
  if (r) return r;
  const base = { version: prev.version + 1, supersedes: prev.id, failure: prev.failure, persona: d.persona, goal: d.goal, tools: [...d.tools].sort(), endState: sortedState(d.endState) };
  return { v: "asp.eval_scenario/v0", id: idOf(base), ...base, split: splitFor(prev.failure, seed), author: prev.author };
}

/** Two agents' scenarios for the same failure that ask for the same tools and end state are one: the one with the lowest id is kept, whatever the order, and the others are listed with who they were. */
export function dedupe(list: Scenario[]): { kept: Scenario[]; dropped: { id: string; author: string; sameAs: string }[] } {
  const key = (s: Scenario) => sha({ f: s.failure, t: [...s.tools].sort(), e: sortedState(s.endState) });
  const groups = new Map<string, Scenario[]>();
  for (const s of list) (groups.get(key(s)) ?? groups.set(key(s), []).get(key(s))!).push(s);
  const kept: Scenario[] = [], dropped: { id: string; author: string; sameAs: string }[] = [];
  for (const g of groups.values()) {
    const sorted = [...g].sort((a, b) => a.id.localeCompare(b.id));
    kept.push(sorted[0]);
    for (const d of sorted.slice(1)) if (d.id !== sorted[0].id) dropped.push({ id: d.id, author: d.author, sameAs: sorted[0].id });
  }
  return { kept: kept.sort((a, b) => a.id.localeCompare(b.id)), dropped: dropped.sort((a, b) => a.id.localeCompare(b.id)) };
}
export const practiceOnly = (list: Scenario[]): Scenario[] => list.filter((s) => s.split === "practice");
export const heldoutOnly = (list: Scenario[]): Scenario[] => list.filter((s) => s.split === "heldout");

const canon = (s: Scenario) => JSON.stringify({ ...s, sig: undefined });
export function signScenario(s: Scenario, seed: Uint8Array): Scenario { return { ...s, sig: b64urlEncode(signBytes(new TextEncoder().encode(canon(s)), seed)) }; }
export function verifyScenario(s: Scenario, publicKey: Uint8Array): boolean { return !!s.sig && s.id === idOf(s) && verifyBytes(b64urlDecode(s.sig), new TextEncoder().encode(canon(s)), publicKey); }
export { publicKeyFromSeed };

// ---- DK801: the sandbox and the simulated caller ----

export type ToolFn = (state: Record<string, Scalar>, args: Record<string, Scalar>) => { result: Scalar; state: Record<string, Scalar> };
export interface Call { tool: string; args: Record<string, Scalar> }
export type Reply = { ok: true; result: Scalar } | { ok: false; refused: "SANDBOX_ONLY"; tool: string };

/** A room with fake tools and a state store of its own. Nothing outside it can be named: a tool that is not in the room is refused and logged, never looked up anywhere else. */
export class Sandbox {
  private state: Record<string, Scalar>;
  private readonly tools: Map<string, ToolFn>;
  readonly calls: Call[] = [];
  readonly refused: string[] = [];
  constructor(tools: Record<string, ToolFn>, initial: Record<string, Scalar> = {}) { this.tools = new Map(Object.entries(tools)); this.state = { ...initial }; }
  call(tool: string, args: Record<string, Scalar> = {}): Reply {
    const fn = this.tools.get(tool);
    if (!fn) { this.refused.push(tool); return { ok: false, refused: "SANDBOX_ONLY", tool }; }
    this.calls.push({ tool, args });
    const out = fn(this.state, args);
    this.state = out.state;
    return { ok: true, result: out.result };
  }
  snapshot(): Record<string, Scalar> { return sortedState(this.state); }
}

/** The agent under test: it hears an utterance from the caller and may use the sandbox's tools; it returns a short reply label. */
export type Agent = (utterance: string, room: Pick<Sandbox, "call">) => string;
/** A scripted caller: its utterances come from the scenario's persona and goal and a seed, so the same seed is the same call. */
export function callerFor(s: Scenario, seed: string): string[] {
  const order = [`i am a ${s.persona}`, `i want to ${s.goal}`, "please do it now", "thank you"];
  const k = parseInt(sha(`${seed}|${s.id}`).slice(7, 11), 16) % 3;       // the seed changes how many times the caller asks
  return [...order.slice(0, 3), ...Array(k).fill("please do it now"), order[3]];
}
export interface Result { scenario: string; seed: string; transcript: string; passed: boolean; mismatches: string[]; toolCalls: number; refusedTools: string[] }

/** Runs the agent against the scripted caller in a fresh sandbox and compares the sandbox state with the scenario's expected end state. */
export function runCall(agent: Agent, s: Scenario, seed: string, makeRoom: () => Sandbox): Result {
  const room = makeRoom();
  const lines: string[] = [];
  for (const u of callerFor(s, seed)) lines.push(`caller: ${u}`, `agent: ${agent(u, room)}`);
  const state = room.snapshot();
  const mismatches = Object.entries(s.endState).filter(([k, v]) => state[k] !== v).map(([k]) => k);
  return { scenario: s.id, seed, transcript: sha(lines), passed: mismatches.length === 0, mismatches, toolCalls: room.calls.length, refusedTools: [...room.refused] };
}
export function signResult(r: Result, seed: Uint8Array): Result & { sig: string } { return { ...r, sig: b64urlEncode(signBytes(new TextEncoder().encode(JSON.stringify(r)), seed)) }; }
