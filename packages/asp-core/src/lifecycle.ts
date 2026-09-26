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
export class Job {
  state: JobState | null = null;
  readonly records: AspRecord[] = [];
  contractId?: string;
  principal?: string;
  performer?: string;
  bank?: string;
  openCheckpoint?: string;
  latestDelivery?: string;
  acceptance?: string;
  ruling?: string;
  redeliveries = 0;

  private readonly resolve: KeyResolver;
  private readonly schemas: SchemaSet;

  constructor(opts: JobOptions) {
    this.resolve = opts.resolve;
    this.schemas = opts.schemas ?? defaultSchemas();
  }

  static replay(records: unknown[], opts: JobOptions): Job {
    const job = new Job(opts);
    for (const r of records) job.apply(r);
    return job;
  }

  get head(): string | null {
    return this.records.at(-1)?.id ?? null;
  }

  apply(raw: unknown): JobState {
    const r = verifyRecord(raw, this.resolve, this.schemas);

    const last = this.records.at(-1);
    if (r.prev !== (last?.id ?? null)) throw new AspError("BAD_PREV", `prev should be ${last?.id ?? null}`);
    if (last && Date.parse(r.issued_at) < Date.parse(last.issued_at)) {
      throw new AspError("TIME_REVERSED", `${r.issued_at} is before ${last.issued_at}`);
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
      if (type === "contract") this.contractId = this.principal = this.performer = this.bank = undefined;
      throw e;
    }

    this.record(t, type, r);
    this.state = t.to;
    this.records.push(r);
    return t.to;
  }

  private bindContract(r: AspRecord): void {
    const b = r.body as { principal: string; performer: string; bank: string };
    this.contractId = r.id;
    this.principal = b.principal;
    this.performer = b.performer;
    this.bank = b.bank;
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
      case "cosigned_by_performer": return this.cosignedBy(r, this.performer);
      case "cosigned_by_principal": return this.cosignedBy(r, this.principal);
      case "refs_contract": return b.contract === this.contractId;
      case "escrow_payer_is_principal": return b.escrow?.payer === this.principal;
      case "subject_is_performer": return r.subject === this.performer;
      case "about_open_checkpoint": return b.about === this.openCheckpoint;
      case "about_latest_delivery": return b.about === this.latestDelivery;
      case "about_contract": return b.about === this.contractId;
      case "not_yet_accepted": return this.acceptance === undefined;
      case "redelivery_available": return this.redeliveries < LIFECYCLE.max_redeliveries;
      case "no_ruling_yet": return this.ruling === undefined;
      case "cites_acceptance": return b.cites !== undefined && b.cites === this.acceptance;
      case "cites_ruling": return b.cites !== undefined && b.cites === this.ruling;
      default: throw new Error(`unknown guard ${name}`);
    }
  }

  private record(t: Transition, type: string, r: AspRecord): void {
    if (type === "checkpoint") this.openCheckpoint = r.id;
    if (type === "attestation" && t.from.includes("Checkpoint")) this.openCheckpoint = undefined;
    if (type === "delivery") this.latestDelivery = r.id;
    for (const e of t.effects ?? []) {
      if (e === "mark_accepted") this.acceptance = r.id;
      else if (e === "count_redelivery") this.redeliveries++;
      else if (e === "record_ruling") this.ruling = r.id;
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
