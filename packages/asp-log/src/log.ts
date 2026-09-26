import {
  AspError, Job, b64urlDecode, defaultSchemas, sha256Id, shortType, verifyRecord,
  type AspRecord, type JobSnapshot, type KeyResolver, type SchemaSet,
} from "@agent-social/asp-core";
import { MemoryStore } from "./memory.ts";
import type { ChainRow, KeyRow, LogHead, LogTx, Store, StoredRecord } from "./store.ts";

/** Record types that exist only inside a job chain. */
const JOB_ONLY_TYPES = new Set(["contract", "bond", "mandate", "checkpoint", "delivery", "settlement"]);
/** Records that change identity. Only a person's own (passport) keys may sign them. */
const IDENTITY_TYPES = new Set(["passport", "fleet", "node"]);

const DEFAULT_MAX_NODE_TTL_MS = 24 * 60 * 60 * 1000;

export interface EventLogOptions {
  schemas?: SchemaSet;
  /**
   * Consulted when a kid is not in the registry. For tests and for keys vouched for outside the log.
   * Mocked registry (MOCKS.md #9): did:web documents are not fetched yet.
   */
  fallbackResolver?: KeyResolver;
  /** Clock for appendedAt and node-key expiry. Defaults to the system clock. */
  now?: () => Date;
  /** Longest lifetime a Node record may grant. Default 24 hours. */
  maxNodeTtlMs?: number;
}

export interface AppendResult {
  seq: number;
  id: string;
  chain: string;
  logHash: string;
  /** Job state after this record, for job chains. */
  state: string | null;
  /** True if the record was already in the log; nothing was written. */
  duplicate: boolean;
}

export interface VerifyReport {
  ok: boolean;
  records: number;
  head: LogHead;
  /** First problem found, if any. */
  error?: { seq: number; id: string; code: string; message: string };
}

/** sha256 over the previous log hash and the new record id. */
export function nextLogHash(prev: string, id: string): string {
  return sha256Id(new TextEncoder().encode(`${prev}\n${id}`));
}

const rule = (name: string, message: string) => new AspError("GUARD_FAILED", message, name);
const after = (a: string, b: string) => Date.parse(a) > Date.parse(b);

/**
 * The append-only signed event log. Every record is verified before it is stored; chains are
 * linear (one successor per record); job chains must follow the ASP lifecycle; passport, fleet
 * and node records maintain the registry. A running hash over record ids makes the order tamper-evident.
 */
export class EventLog {
  readonly store: Store;
  private readonly schemas: SchemaSet;
  private readonly fallback?: KeyResolver;
  private readonly now: () => Date;
  private readonly maxNodeTtlMs: number;

  constructor(store: Store, opts: EventLogOptions = {}) {
    this.store = store;
    this.schemas = opts.schemas ?? defaultSchemas();
    this.fallback = opts.fallbackResolver;
    this.now = opts.now ?? (() => new Date());
    this.maxNodeTtlMs = opts.maxNodeTtlMs ?? DEFAULT_MAX_NODE_TTL_MS;
  }

  append(raw: unknown): Promise<AppendResult> {
    return this.appendAt(raw, this.now().toISOString());
  }

  /** @internal Appends as if the log's clock read `appendedAt`. verify() uses it to replay. */
  appendAt(raw: unknown, appendedAt: string): Promise<AppendResult> {
    this.schemas.assert("envelope", raw);
    const r = raw as AspRecord;
    return this.store.transaction((tx) => this.appendIn(tx, r, appendedAt));
  }

  private async appendIn(tx: LogTx, r: AspRecord, appendedAt: string): Promise<AppendResult> {
    const existing = await tx.getRecord(r.id);
    if (existing) {
      const chain = await tx.getChain(existing.chain);
      return { seq: existing.seq, id: existing.id, chain: existing.chain, logHash: existing.logHash, state: chain?.state ?? null, duplicate: true };
    }

    const type = shortType(r.type);
    const { resolve, rows } = await this.resolverFor(tx, r, type);
    const verified = verifyRecord(r, resolve, this.schemas);
    this.checkKeyUse(verified, type!, rows, appendedAt);

    // Chain placement: a new chain, or the successor of its chain's head.
    let chain: ChainRow | undefined;
    if (verified.prev !== null) {
      const prev = await tx.getRecord(verified.prev);
      if (!prev) throw new AspError("BAD_PREV", `prev ${verified.prev} is not in the log`);
      chain = (await tx.getChain(prev.chain))!;
      if (chain.head !== verified.prev) {
        throw new AspError("BAD_PREV", `prev ${verified.prev} already has a successor; the chain head is ${chain.head}`);
      }
    }
    const root = chain?.root ?? verified.id;
    const kind = chain?.kind ?? type!;

    let snapshot: JobSnapshot | null = null;
    if (kind === "contract") {
      const job = chain?.snapshot ? Job.fromSnapshot(chain.snapshot, { schemas: this.schemas }) : new Job({ schemas: this.schemas });
      job.step(verified);
      snapshot = job.snapshot();
    } else {
      if (JOB_ONLY_TYPES.has(type!)) {
        throw new AspError("ILLEGAL_TRANSITION", `${verified.type} belongs in a job chain, not a ${kind} chain`);
      }
      // Outside jobs, a chain is the history of one kind of record (a passport's versions, a lineage).
      if (type !== kind) throw new AspError("ILLEGAL_TRANSITION", `a ${kind} chain cannot continue with ${verified.type}`);
      if (chain && Date.parse(verified.issued_at) < Date.parse(chain.lastIssuedAt)) {
        throw new AspError("TIME_REVERSED", `${verified.issued_at} is before ${chain.lastIssuedAt}`);
      }
    }

    const head = await tx.logHead();
    const stored: StoredRecord = {
      seq: head.seq + 1, id: verified.id, chain: root, logHash: nextLogHash(head.logHash, verified.id),
      appendedAt, record: verified,
    };
    // Insert first: projections reference the record. A projection that throws rolls the insert back.
    await tx.insertRecord(stored);
    if (type === "passport") await this.projectPassport(tx, verified);
    if (type === "fleet") await this.projectFleet(tx, verified);
    if (type === "node") await this.projectNode(tx, verified);
    await tx.putChain({
      root, kind, head: verified.id, length: (chain?.length ?? 0) + 1, lastIssuedAt: verified.issued_at,
      state: snapshot?.state ?? null, snapshot,
    });
    await tx.setLogHead({ seq: stored.seq, logHash: stored.logHash });
    return { seq: stored.seq, id: stored.id, chain: root, logHash: stored.logHash, state: snapshot?.state ?? null, duplicate: false };
  }

  /** Keys for every kid on the record: registry first, then a self-issued first passport's own keys, then the fallback. */
  private async resolverFor(tx: LogTx, r: AspRecord, type: string | undefined) {
    const found = new Map<string, Uint8Array>();
    const rows = new Map<string, KeyRow>();
    for (const { kid } of [r.sig, ...(r.cosigs ?? [])]) {
      const k = await tx.getKey(kid);
      if (k && !k.revokedAt) {
        found.set(kid, b64urlDecode(k.publicKey));
        rows.set(kid, k);
      }
    }
    const body = r.body as { did?: string; keys?: { id: string; public_key: string }[] };
    // Bootstrap: a person's first passport may be self-issued, signed by a key it declares (MOCKS.md #8).
    if (type === "passport" && body.did === r.issuer && !(await tx.getPassport(r.issuer))) {
      for (const k of body.keys ?? []) if (!found.has(k.id)) found.set(k.id, b64urlDecode(k.public_key));
    }
    const resolve: KeyResolver = (kid) => found.get(kid) ?? this.fallback?.(kid);
    return { resolve, rows };
  }

  /** A node key signs only as its own node, only while it is live, never identity records, never as a co-signer. */
  private checkKeyUse(r: AspRecord, type: string, rows: Map<string, KeyRow>, appendedAt: string): void {
    for (const c of r.cosigs ?? []) {
      if (rows.get(c.kid)?.kind === "node") throw rule("node_key_cosign", `node key ${c.kid} cannot co-sign`);
    }
    const signer = rows.get(r.sig.kid);
    if (signer?.kind !== "node") return;
    if (r.actor !== r.sig.kid) throw rule("node_key_actor", `node key ${r.sig.kid} can only sign as that node, not as ${r.actor}`);
    if (IDENTITY_TYPES.has(type)) throw rule("node_key_identity", `node key ${r.sig.kid} cannot sign a ${type} record`);
    if (after(r.issued_at, signer.expiresAt!) || after(appendedAt, signer.expiresAt!)) {
      throw rule("node_key_expired", `node key ${r.sig.kid} expired at ${signer.expiresAt}`);
    }
  }

  /** Registry rules: one passport chain per DID, issued by the DID itself or its sponsor. */
  private async projectPassport(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as { did: string; kind: string; sponsor?: string; fleet?: string; keys: { id: string; public_key: string }[] };
    const current = await tx.getPassport(body.did);
    if ((current?.head ?? null) !== r.prev) {
      throw new AspError("BAD_PREV", current
        ? `a passport update for ${body.did} must follow ${current.head}`
        : `the first passport for ${body.did} must start a chain`);
    }
    const sponsor = current ? current.sponsor : body.sponsor ?? null;
    if (r.issuer !== body.did && r.issuer !== sponsor) {
      throw new AspError("WRONG_ISSUER", `${r.issuer} is neither ${body.did} nor its sponsor`);
    }
    for (const k of body.keys) {
      if (!k.id.startsWith(`${body.did}#`)) throw new AspError("KID_NOT_ISSUER", `key ${k.id} does not belong to ${body.did}`);
      const existing = await tx.getKey(k.id);
      if (existing?.kind === "node") throw rule("key_id_taken", `${k.id} is a node key`);
    }

    const newSponsor = body.sponsor ?? sponsor;
    if (body.fleet) await this.checkFleetMembership(tx, body.did, body.kind, newSponsor, body.fleet);

    const declared = new Set(body.keys.map((k) => k.id));
    for (const old of await tx.keysForDid(body.did)) {
      if (old.kind === "passport" && !declared.has(old.kid) && !old.revokedAt) await tx.putKey({ ...old, revokedAt: r.issued_at });
    }
    for (const k of body.keys) {
      await tx.putKey({
        kid: k.id, did: body.did, publicKey: k.public_key, kind: "passport", grantedBy: r.id,
        revokedAt: null, expiresAt: null, mandate: null,
      });
    }
    await tx.putPassport({ did: body.did, head: r.id, sponsor: newSponsor, fleet: body.fleet ?? null });
  }

  /** An agent joins a fleet by naming it; the fleet must be declared, share the agent's sponsor and have room. */
  private async checkFleetMembership(tx: LogTx, did: string, kind: string, sponsor: string | null, fleetDid: string): Promise<void> {
    if (kind !== "agent") throw rule("fleet_member_kind", `only agents join fleets, not a ${kind}`);
    const fleet = await tx.getFleet(fleetDid);
    if (!fleet) throw rule("fleet_unknown", `fleet ${fleetDid} is not declared`);
    if (sponsor !== fleet.org) throw rule("fleet_sponsor_mismatch", `fleet ${fleetDid} belongs to ${fleet.org}; ${did} is sponsored by ${sponsor}`);
    if (fleet.maxMembers !== null) {
      const others = (await tx.fleetMembers(fleetDid)).filter((m) => m.did !== did);
      if (others.length >= fleet.maxMembers) throw rule("fleet_full", `fleet ${fleetDid} has ${fleet.maxMembers} members`);
    }
  }

  /** One declaration chain per fleet, issued by its org, which never changes. */
  private async projectFleet(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as { did: string; org: string; name: string; max_members?: number };
    const current = await tx.getFleet(body.did);
    if ((current?.head ?? null) !== r.prev) {
      throw new AspError("BAD_PREV", current
        ? `a fleet update for ${body.did} must follow ${current.head}`
        : `the first declaration of ${body.did} must start a chain`);
    }
    if (r.issuer !== body.org) throw new AspError("WRONG_ISSUER", `fleet ${body.did} must be declared by its org ${body.org}`);
    if (current && current.org !== body.org) throw rule("fleet_org_change", `fleet ${body.did} belongs to ${current.org}`);
    await tx.putFleet({ did: body.did, head: r.id, org: body.org, name: body.name, maxMembers: body.max_members ?? null });
  }

  /** A person delegates a short-lived key to one node, optionally under a Mandate whose max_parallel it counts against. */
  private async projectNode(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as { node: string; public_key: string; expires: string; mandate?: string };
    if (!body.node.startsWith(`${r.issuer}#`)) throw new AspError("KID_NOT_ISSUER", `node ${body.node} is not under ${r.issuer}`);
    if (await tx.getKey(body.node)) throw rule("key_id_taken", `${body.node} is already a key id`);
    if (!after(body.expires, r.issued_at)) throw rule("node_ttl", "a node must expire after it is granted");
    if (Date.parse(body.expires) - Date.parse(r.issued_at) > this.maxNodeTtlMs) {
      throw rule("node_ttl", `a node may live at most ${this.maxNodeTtlMs / 3_600_000} hours`);
    }

    if (body.mandate) {
      const m = await tx.getRecord(body.mandate);
      if (!m || m.record.type !== "asp.mandate/v0.2") throw rule("node_mandate_unknown", `${body.mandate} is not a Mandate in this log`);
      const mandate = m.record.body as { expires: string; nodes: { max_parallel: number } };
      if (m.record.subject !== r.issuer) throw rule("node_mandate_subject", `the Mandate was issued to ${m.record.subject}, not ${r.issuer}`);
      if (after(body.expires, mandate.expires)) throw rule("node_outlives_mandate", `the Mandate expires at ${mandate.expires}`);
      const live = (await tx.nodeKeysForMandate(body.mandate)).filter((k) => after(k.expiresAt!, r.issued_at));
      if (live.length >= mandate.nodes.max_parallel) {
        throw rule("node_max_parallel", `the Mandate allows ${mandate.nodes.max_parallel} parallel nodes`);
      }
    }

    await tx.putKey({
      kid: body.node, did: r.issuer, publicKey: body.public_key, kind: "node", grantedBy: r.id,
      revokedAt: null, expiresAt: body.expires, mandate: body.mandate ?? null,
    });
  }

  get(id: string) { return this.store.getRecord(id); }
  head() { return this.store.logHead(); }
  chain(root: string) { return this.store.chainRecords(root); }
  chainInfo(root: string) { return this.store.getChain(root); }
  since(afterSeq: number, limit = 500) { return this.store.since(afterSeq, limit); }
  passport(did: string) { return this.store.getPassport(did); }
  keys(did: string) { return this.store.keysForDid(did); }

  /** A fleet's declaration and its current members. */
  async fleet(did: string) {
    const fleet = await this.store.getFleet(did);
    return fleet && { ...fleet, members: await this.store.fleetMembers(did) };
  }

  /**
   * Re-verifies the whole log by replaying it into a fresh in-memory log, with each record's original
   * append time as the clock: every id, signature, chain link, lifecycle step, registry change and
   * log hash must come out the same.
   */
  async verify(pageSize = 500): Promise<VerifyReport> {
    const replay = new EventLog(new MemoryStore(), {
      schemas: this.schemas, fallbackResolver: this.fallback, maxNodeTtlMs: this.maxNodeTtlMs,
    });
    let afterSeq = 0;
    let count = 0;
    for (;;) {
      const page = await this.store.since(afterSeq, pageSize);
      if (page.length === 0) break;
      for (const s of page) {
        try {
          if (s.seq !== afterSeq + 1) throw new AspError("BAD_PREV", `log gap: expected seq ${afterSeq + 1}, found ${s.seq}`);
          const res = await replay.appendAt(s.record, s.appendedAt);
          if (res.duplicate || res.id !== s.id) throw new AspError("BAD_ID", `stored id ${s.id} does not match its record`);
          if (res.logHash !== s.logHash) throw new AspError("BAD_ID", `log hash mismatch at seq ${s.seq}`);
          if (res.chain !== s.chain) throw new AspError("BAD_PREV", `record ${s.id} is filed under the wrong chain`);
        } catch (e) {
          if (!(e instanceof AspError)) throw e;
          return { ok: false, records: count, head: await replay.head(), error: { seq: s.seq, id: s.id, code: e.code, message: e.message } };
        }
        afterSeq = s.seq;
        count++;
      }
    }
    const head = await this.store.logHead();
    const replayed = await replay.head();
    if (head.seq !== replayed.seq || head.logHash !== replayed.logHash) {
      return { ok: false, records: count, head: replayed, error: { seq: head.seq, id: "", code: "BAD_ID", message: "log head does not match the replayed records" } };
    }
    return { ok: true, records: count, head };
  }
}
