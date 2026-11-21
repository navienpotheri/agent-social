/**
 * The Mandate workflow clause (register row DK841; spec-delta S1209; docs/intake/11th-nov.md, IMG_6464 to 6476): a Mandate bounds actions, not their order or completion. This clause names the states of a job (draft,
 * awaiting approval, executing, validating, done), the transitions an agent may make between them, the actions allowed in each state, and the deterministic checker whose pass is required before "done". An approval
 * state may wait days and resume from serialised state without repeating a side effect: every side effect is kept by its key and runs once. Every transition and action is an entry in a hash-chained trail signed by
 * the agent's key (and the approver's, for an approval), so the trail can be checked by anyone. The workflow is a function of its inputs and a clock passed in; it holds no key but the one it signs with, and it
 * never moves itself: only a call moves it, and a refused call changes nothing. Scripted agents in the tests; no real model. The clause is data a Mandate would carry: adding the field to the Mandate record is a
 * schema change that is row DK1209.
 */
import { createHash } from "node:crypto";
import { b64urlDecode, b64urlEncode, signBytes, verifyBytes, publicKeyFromSeed } from "@agent-social/asp-core";

export type State = "draft" | "awaiting_approval" | "executing" | "validating" | "done";
export const STATES: readonly State[] = ["draft", "awaiting_approval", "executing", "validating", "done"];

export interface Clause {
  /** The states each state may move to. */
  transitions: Record<State, State[]>;
  /** The actions an agent may take in each state (an action outside its state is refused). */
  actions: Record<State, string[]>;
  /** The deterministic checker whose pass `validating` needs before `done`. */
  checker: (artifact: string) => boolean;
  /** Who approves (the key whose signature leaves `awaiting_approval`). */
  approver: { did: string; publicKey: Uint8Array };
}
export type Refusal = { ok: false; code: "TRANSITION_NOT_ALLOWED" | "ACTION_NOT_ALLOWED_IN_STATE" | "CHECKER_NOT_PASSED" | "APPROVAL_NEEDED" | "BAD_APPROVAL" | "BAD_STATE" | "ALREADY_DONE"; message: string };
export type Ok = { ok: true; note?: string };
export interface Entry { seq: number; at: string; kind: "transition" | "action" | "approval"; from: State; to: State; detail: string; prev: string; sig: string }
export interface Serialised { state: State; trail: Entry[]; effects: string[]; waitingSince: string | null; hash: string }

const GENESIS = "sha256:" + "0".repeat(64);
const sha = (s: string) => "sha256:" + createHash("sha256").update(s).digest("hex");
const body = (e: Omit<Entry, "sig">) => JSON.stringify(e);
const hashOf = (e: Entry) => sha(JSON.stringify(e));

/** The default clause: a job is drafted, approved, executed, validated and done, in that order, and nothing else. */
export function defaultClause(approver: Clause["approver"], checker: Clause["checker"]): Clause {
  return {
    transitions: { draft: ["awaiting_approval"], awaiting_approval: ["executing", "draft"], executing: ["validating"], validating: ["done", "executing"], done: [] },
    actions: { draft: ["plan"], awaiting_approval: [], executing: ["reserve", "send", "charge"], validating: ["submit"], done: [] },
    checker, approver,
  };
}

export class Workflow {
  state: State = "draft";
  trail: Entry[] = [];
  /** Side effects already done, by key: asking again does nothing. */
  effects = new Set<string>();
  waitingSince: string | null = null;
  readonly clause: Clause;
  private readonly seed: Uint8Array;
  private readonly now: () => string;
  constructor(clause: Clause, seed: Uint8Array, now: () => string) { this.clause = clause; this.seed = seed; this.now = now; }

  private append(kind: Entry["kind"], from: State, to: State, detail: string, signer: Uint8Array = this.seed): void {
    const prev = this.trail.length ? hashOf(this.trail.at(-1)!) : GENESIS;
    const e: Omit<Entry, "sig"> = { seq: this.trail.length, at: this.now(), kind, from, to, detail, prev };
    this.trail.push({ ...e, sig: b64urlEncode(signBytes(new TextEncoder().encode(body(e)), signer)) });
  }
  private refuse(code: Refusal["code"], message: string): Refusal { return { ok: false, code, message }; }

  /** An action in the current state, with the key of its side effect: refused outside its state, and done once however often it is asked. */
  act(action: string, key: string): Ok | Refusal {
    if (this.state === "done") return this.refuse("ALREADY_DONE", "the job is done: nothing more may be done");
    if (!this.clause.actions[this.state].includes(action)) return this.refuse("ACTION_NOT_ALLOWED_IN_STATE", `${action} is not allowed in ${this.state} (allowed: ${this.clause.actions[this.state].join(", ") || "none"})`);
    if (this.effects.has(key)) return { ok: true, note: "already done: the side effect is not repeated" };
    this.effects.add(key);
    this.append("action", this.state, this.state, `${action}:${key}`);
    return { ok: true };
  }

  /** A move to another state. `done` needs the checker to pass on the artifact; leaving `awaiting_approval` needs `approve`. */
  move(to: State, artifact?: string): Ok | Refusal {
    if (this.state === "done") return this.refuse("ALREADY_DONE", "the job is done");
    if (!this.clause.transitions[this.state].includes(to)) return this.refuse("TRANSITION_NOT_ALLOWED", `${this.state} cannot move to ${to} (allowed: ${this.clause.transitions[this.state].join(", ") || "none"})`);
    if (this.state === "awaiting_approval" && to === "executing") return this.refuse("APPROVAL_NEEDED", "leaving awaiting_approval for executing needs the approver's signature: call approve");
    if (to === "done" && !(artifact !== undefined && this.clause.checker(artifact))) return this.refuse("CHECKER_NOT_PASSED", "done needs the deterministic checker to pass on the artifact: claiming done does not make it done");
    if (to === "awaiting_approval") this.waitingSince = this.now();
    this.append("transition", this.state, to, to === "done" ? `checker passed on ${sha(artifact!)}` : "");
    this.state = to;
    return { ok: true };
  }

  /** The approver's signature over (the trail's head, the state): only then does an awaiting job resume. */
  approve(signature: Uint8Array): Ok | Refusal {
    if (this.state !== "awaiting_approval") return this.refuse("BAD_STATE", `${this.state} is not waiting for an approval`);
    const head = this.trail.length ? hashOf(this.trail.at(-1)!) : GENESIS;
    if (!verifyBytes(signature, new TextEncoder().encode(Workflow.approvalMessage(head)), this.clause.approver.publicKey)) return this.refuse("BAD_APPROVAL", "the signature is not the approver's over this job's trail");
    this.append("approval", "awaiting_approval", "executing", `approved by ${this.clause.approver.did}`, this.seed);
    this.state = "executing";
    this.waitingSince = null;
    return { ok: true };
  }
  static approvalMessage(head: string): string { return `asp workflow approval|${head}`; }
  head(): string { return this.trail.length ? hashOf(this.trail.at(-1)!) : GENESIS; }

  serialise(): Serialised {
    const s = { state: this.state, trail: this.trail, effects: [...this.effects].sort(), waitingSince: this.waitingSince };
    return { ...s, hash: sha(JSON.stringify(s)) };
  }
  /** Resumes from serialised state: the hash, the chain and the signatures are checked first, and the side effects done stay done. */
  static resume(clause: Clause, seed: Uint8Array, now: () => string, s: Serialised): Workflow | Refusal {
    const plain = { state: s.state, trail: s.trail, effects: s.effects, waitingSince: s.waitingSince };
    if (sha(JSON.stringify(plain)) !== s.hash) return { ok: false, code: "BAD_STATE", message: "the serialised state does not match its hash" };
    if (!verifyTrail(s.trail, publicKeyFromSeed(seed))) return { ok: false, code: "BAD_STATE", message: "the trail does not verify: a broken chain or a signature that is not this agent's" };
    const w = new Workflow(clause, seed, now);
    w.state = s.state; w.trail = s.trail.map((e) => ({ ...e })); w.effects = new Set(s.effects); w.waitingSince = s.waitingSince;
    return w;
  }
}

/** Whether a trail is a chain from the genesis, every entry signed by `agent` (an approval entry is signed by the agent that records it, after checking the approver's signature). */
export function verifyTrail(trail: Entry[], agent: Uint8Array): boolean {
  let prev = GENESIS;
  for (const [i, e] of trail.entries()) {
    const { sig, ...rest } = e;
    if (e.seq !== i || e.prev !== prev) return false;
    if (!verifyBytes(b64urlDecode(sig), new TextEncoder().encode(body(rest)), agent)) return false;
    prev = hashOf(e);
  }
  return true;
}
