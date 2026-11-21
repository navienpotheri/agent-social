import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AspError } from "./errors.ts";
import { didOf, verifyRecord, type AspRecord, type KeyResolver } from "./record.ts";
import { defaultSchemas, shortType, SPEC_DIR, type SchemaSet } from "./schema.ts";

export type JobState = "Contracted" | "Bonded" | "Running" | "Checkpoint" | "Delivered" | "Disputed" | "Settled";
type Role = "principal" | "performer" | "bank" | "backer" | "neutral";

interface Transition {
  from: (JobState | null)[];
  type: string;
  when?: Record<string, string>;
  to: JobState;
  issuer: Role;
  guards?: string[];
  effects?: string[];
}

interface LifecycleSpec {
  version: string;
  terminal: JobState[];
  max_redeliveries: number;
  transitions: Transition[];
}

export const LIFECYCLE: LifecycleSpec = JSON.parse(readFileSync(join(SPEC_DIR, "lifecycle.json"), "utf8"));

export interface JobOptions {
  resolve: KeyResolver;
  schemas?: SchemaSet;
}

/**
 * A job chain: verifies each record, checks the hash link, and applies the lifecycle.
 * Records must arrive in chain order, starting with the Contract.
 */
/** Everything a Job needs to resume without replaying its chain. Plain JSON. */
export interface JobSnapshot {
  state: JobState | null;
  head: string | null;
  lastIssuedAt: string | null;
  length: number;
  contractId?: string;
  principal?: string;
  performer?: string;
  bank?: string;
  reviewDeadline?: string;
  rulingWindowSeconds?: number;
  appealHoldSeconds?: number;
  disputedAt?: string;
  rulingAt?: string;
  openCheckpoint?: string;
  openCheckpointExpires?: string;
  openCheckpointAt?: string;
  deadline?: string;
  deadlineBinds?: boolean;
  approvalWaitMs?: number;
  latestDelivery?: string;
  acceptance?: string;
  ruling?: string;
  redeliveries: number;
}

export class Job {
  state: JobState | null = null;
  head: string | null = null;
  lastIssuedAt: string | null = null;
  length = 0;
  contractId?: string;
  principal?: string;
  performer?: string;
  bank?: string;
  reviewDeadline?: string;
  /** From the Contract: how long a dispute may wait for a ruling before the bank may settle it by the stated split (gap M10). */
  rulingWindowSeconds?: number;
  /** From the Contract: how long a ruling's settlement is held so an appeal can change the money (S1400); absent, no hold. */
  appealHoldSeconds?: number;
  /** When the dispute opened: the time of the rejection that put the job in Disputed. */
  disputedAt?: string;
  /** When the ruling was made: the hold on its settlement counts from here. */
  rulingAt?: string;
  openCheckpoint?: string;
  openCheckpointExpires?: string;
  /** When the open Checkpoint was raised: the approval wait counts from here to its resolution (S1441). */
  openCheckpointAt?: string;
  /** From the Contract: its deadline, and whether it binds delivery. */
  deadline?: string;
  deadlineBinds?: boolean;
  /** Milliseconds the performer has waited for the principal to answer Checkpoints so far: extends a binding deadline. */
  approvalWaitMs?: number;
  latestDelivery?: string;
  acceptance?: string;
  ruling?: string;
  redeliveries = 0;

  private readonly resolve?: KeyResolver;
  private readonly schemas: SchemaSet;

  /** `resolve` is needed only for apply(); step() takes records that were already verified. */
  constructor(opts: Partial<JobOptions> = {}) {
    this.resolve = opts.resolve;
    this.schemas = opts.schemas ?? defaultSchemas();
  }

  static replay(records: unknown[], opts: JobOptions): Job {
    const job = new Job(opts);
    for (const r of records) job.apply(r);
    return job;
  }

  static fromSnapshot(s: JobSnapshot, opts: Partial<JobOptions> = {}): Job {
    return Object.assign(new Job(opts), s);
  }

  snapshot(): JobSnapshot {
    const { state, head, lastIssuedAt, length, contractId, principal, performer, bank, reviewDeadline, rulingWindowSeconds, appealHoldSeconds, disputedAt, rulingAt,
      openCheckpoint, openCheckpointExpires, openCheckpointAt, deadline, deadlineBinds, approvalWaitMs, latestDelivery, acceptance, ruling, redeliveries } = this;
    return JSON.parse(JSON.stringify({ state, head, lastIssuedAt, length, contractId, principal, performer, bank, reviewDeadline, rulingWindowSeconds, appealHoldSeconds, disputedAt, rulingAt,
      openCheckpoint, openCheckpointExpires, openCheckpointAt, deadline, deadlineBinds, approvalWaitMs, latestDelivery, acceptance, ruling, redeliveries }));
  }

  /** Verifies the record (schema, id, signatures), then steps the lifecycle. */
  apply(raw: unknown): JobState {
    if (!this.resolve) throw new Error("Job.apply needs a key resolver; use step() for verified records");
    return this.step(verifyRecord(raw, this.resolve, this.schemas));
  }

  /** Steps the lifecycle with a record whose schema and signatures were already verified. */
  step(r: AspRecord): JobState {
    if (r.prev !== this.head) throw new AspError("BAD_PREV", `prev should be ${this.head}`);
    if (this.lastIssuedAt && Date.parse(r.issued_at) < Date.parse(this.lastIssuedAt)) {
      throw new AspError("TIME_REVERSED", `${r.issued_at} is before ${this.lastIssuedAt}`);
    }

    if (this.state && LIFECYCLE.terminal.includes(this.state)) {
      throw new AspError("TERMINAL_STATE", `job is ${this.state}`);
    }

    const type = shortType(r.type)!;
    const t = LIFECYCLE.transitions.find(
      (t) => t.from.includes(this.state) && t.type === type && matches(t.when, r.body),
    );
    if (!t) throw new AspError("ILLEGAL_TRANSITION", `no transition from ${this.state} on ${describe(r)}`);

    if (type === "contract") this.bindContract(r);
    try {
      this.checkIssuer(t.issuer, r);
      for (const g of t.guards ?? []) {
        if (!this.guard(g, r)) throw new AspError("GUARD_FAILED", `guard ${g} rejected ${describe(r)}`, g);
      }
    } catch (e) {
      // A rejected record leaves the job unchanged.
      if (type === "contract") this.contractId = this.principal = this.performer = this.bank = this.reviewDeadline = this.rulingWindowSeconds = this.appealHoldSeconds = undefined;
      throw e;
    }

    this.record(t, type, r);
    this.state = t.to;
    this.head = r.id;
    this.lastIssuedAt = r.issued_at;
    this.length++;
    return t.to;
  }

  private bindContract(r: AspRecord): void {
    const b = r.body as { principal: string; performer: string; bank: string; review_deadline?: string; ruling_window_seconds?: number; appeal_hold_seconds?: number; deadline?: string; deadline_binds?: boolean };
    this.contractId = r.id;
    this.principal = b.principal;
    this.performer = b.performer;
    this.bank = b.bank;
    this.reviewDeadline = b.review_deadline;
    this.deadline = b.deadline;
    this.deadlineBinds = b.deadline_binds === true;
    this.approvalWaitMs = 0;
    this.rulingWindowSeconds = b.ruling_window_seconds;
    this.appealHoldSeconds = b.appeal_hold_seconds;
  }

  private checkIssuer(role: Role, r: AspRecord): void {
    const body = r.body as { backer?: string };
    const ok =
      role === "principal" ? r.issuer === this.principal :
      role === "performer" ? r.issuer === this.performer :
      role === "bank" ? r.issuer === this.bank :
      role === "backer" ? r.issuer === body.backer :
      r.issuer !== this.principal && r.issuer !== this.performer;
    if (!ok) throw new AspError("WRONG_ISSUER", `${r.issuer} is not the ${role}`);
  }

  private cosignedBy(r: AspRecord, did: string | undefined): boolean {
    return (r.cosigs ?? []).some((c) => didOf(c.kid) === did);
  }

  private guard(name: string, r: AspRecord): boolean {
    const b = r.body as Record<string, any>;
    switch (name) {
      case "not_self_hire": return b.principal !== b.performer;
      case "cosigned_by_performer": return this.cosignedBy(r, this.performer);
      case "cosigned_by_principal": return this.cosignedBy(r, this.principal);
      case "refs_contract": return b.contract === this.contractId;
      case "escrow_payer_is_principal": return b.escrow?.payer === this.principal;
      case "subject_is_performer": return r.subject === this.performer;
      case "about_open_checkpoint": return b.about === this.openCheckpoint;
      case "checkpoint_expired":
        return this.openCheckpointExpires !== undefined && Date.parse(r.issued_at) >= Date.parse(this.openCheckpointExpires);
      case "about_latest_delivery": return b.about === this.latestDelivery;
      case "about_contract": return b.about === this.contractId;
      case "not_yet_accepted": return this.acceptance === undefined;
      case "redelivery_available": return this.redeliveries < LIFECYCLE.max_redeliveries;
      case "no_ruling_yet": return this.ruling === undefined;
      case "cites_acceptance": return b.cites !== undefined && b.cites === this.acceptance;
      case "cites_ruling": return b.cites !== undefined && b.cites === this.ruling;
      case "delivered_in_time":
        // S1441 (T21): a binding deadline is extended by the time the performer waited for its principal to answer Checkpoints.
        return !this.deadlineBinds || this.deadline === undefined || Date.parse(r.issued_at) <= Date.parse(this.deadline) + (this.approvalWaitMs ?? 0);
      case "past_review_deadline":
        return this.reviewDeadline !== undefined && Date.parse(r.issued_at) > Date.parse(this.reviewDeadline);
      case "past_ruling_window":
        return this.rulingWindowSeconds !== undefined && this.disputedAt !== undefined && Date.parse(r.issued_at) > Date.parse(this.disputedAt) + this.rulingWindowSeconds * 1000;
      case "past_appeal_window":
        // No hold on the contract: the settlement is not held (older contracts). With one: it waits until the hold after the ruling has passed, or both parties waive it by cosigning.
        return this.appealHoldSeconds === undefined
          || (this.rulingAt !== undefined && Date.parse(r.issued_at) >= Date.parse(this.rulingAt) + this.appealHoldSeconds * 1000)
          || (this.cosignedBy(r, this.principal) && this.cosignedBy(r, this.performer));
      default: throw new Error(`unknown guard ${name}`);
    }
  }

  private record(t: Transition, type: string, r: AspRecord): void {
    if (type === "checkpoint") { this.openCheckpoint = r.id; this.openCheckpointExpires = (r.body as { expires?: string }).expires; this.openCheckpointAt = r.issued_at; }
    if (type === "attestation" && t.from.includes("Checkpoint")) {
      if (this.openCheckpointAt !== undefined) this.approvalWaitMs = (this.approvalWaitMs ?? 0) + Math.max(0, Date.parse(r.issued_at) - Date.parse(this.openCheckpointAt));
      this.openCheckpoint = undefined; this.openCheckpointExpires = undefined; this.openCheckpointAt = undefined;
    }
    if (type === "delivery") this.latestDelivery = r.id;
    for (const e of t.effects ?? []) {
      if (e === "mark_accepted") this.acceptance = r.id;
      else if (e === "count_redelivery") this.redeliveries++;
      else if (e === "record_ruling") { this.ruling = r.id; this.rulingAt = r.issued_at; }
      else if (e === "mark_disputed") this.disputedAt = r.issued_at;
      else throw new Error(`unknown effect ${e}`);
    }
  }
}

function matches(when: Record<string, string> | undefined, body: Record<string, unknown>): boolean {
  return !when || Object.entries(when).every(([k, v]) => body[k] === v);
}

function describe(r: AspRecord): string {
  const b = r.body as Record<string, unknown>;
  const extra = ["kind", "verdict", "basis"].filter((k) => typeof b[k] === "string").map((k) => `${k}=${b[k]}`);
  return [r.type, ...extra].join(" ");
}
