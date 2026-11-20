/**
 * A world whose referee keeps the rules and the seeds server-side (register row DK811; spec-delta S1208; docs/intake/11th-nov.md, IMG_6495): an agent plays moves and is told outcomes, and nothing else. A request for
 * the hidden state by a file path, a debug call or a cached copy is refused by the world and returns an event body for the Registrar, who referees the worlds, to sign and append as a `world_event` record (the hash of
 * the attempt, never the hidden state), which counts as a strike against the agent's standing. The world publishes only a commitment to its rules (a hash), so a Court can check afterwards that the rules did not change.
 * The enforcement is the `enforce` flag: with it off (the integrity test's positive control) the same requests return the rules. A toy game with scripted agents; no real model is involved.
 */
import { createHash } from "node:crypto";

export type Via = "path" | "debug" | "cache";
export type Request = { op: "play"; move: number } | { op: "read"; path: string } | { op: "debug" } | { op: "cache"; key: string };
export type Reply = { ok: true; won: boolean } | { ok: false; refused: true; code: "HIDDEN_STATE"; event: { world: string; agent: string; kind: "hidden_state_read"; attempt: { via: Via; sha256: string } } } | { ok: true; leaked: string };

const sha = (s: string) => "sha256:" + createHash("sha256").update(s).digest("hex");

export class RefereeWorld {
  /** The hidden rule and seed are JavaScript private fields (#): they are not properties of the object, so no read, serialisation or key listing reaches them. */
  #rule: number;
  #seed: string;
  readonly commitment: string;
  readonly name: string;
  #enforce: boolean;
  constructor(name: string, seed: string, enforce = true) {
    this.name = name;
    this.#enforce = enforce;
    this.#seed = seed;
    this.#rule = 2 + (parseInt(sha(`rule|${seed}`).slice(7, 15), 16) % 9);
    this.commitment = sha(`${name}|${this.#rule}|${seed}`);
  }
  /** The world answers a request from an agent. Moves get outcomes; every route to the hidden state is refused with an event for the referee to sign. */
  handle(agent: string, req: Request): Reply {
    if (req.op === "play") return { ok: true, won: (req.move * this.#rule) % 7 === 1 };
    const via: Via = req.op === "read" ? "path" : req.op === "debug" ? "debug" : "cache";
    const target = req.op === "read" ? req.path : req.op === "cache" ? req.key : "debug";
    if (!this.#enforce) return { ok: true, leaked: JSON.stringify({ rule: this.#rule, seed: this.#seed }) };
    return { ok: false, refused: true, code: "HIDDEN_STATE", event: { world: this.name, agent, kind: "hidden_state_read", attempt: { via, sha256: sha(`${agent}|${this.name}|${via}|${target}`) } } };
  }
  /** Whether a published rule matches the commitment (for a Court, afterwards). */
  matches(rule: number, seed: string): boolean { return this.commitment === sha(`${this.name}|${rule}|${seed}`); }
}
