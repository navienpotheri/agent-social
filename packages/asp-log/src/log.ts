import {
  AspError, Job, b64urlDecode, defaultSchemas, sha256Id, shortType, verifyRecord,
  type AspRecord, type JobSnapshot, type KeyResolver, type SchemaSet,
} from "@agent-social/asp-core";
import { MemoryStore } from "./memory.ts";
import type { ChainRow, LogHead, LogTx, Store, StoredRecord } from "./store.ts";

/** Record types that exist only inside a job chain. */
const JOB_ONLY_TYPES = new Set(["contract", "bond", "mandate", "checkpoint", "delivery", "settlement"]);

export interface EventLogOptions {
  schemas?: SchemaSet;
  /**
   * Consulted when a kid is not in the registry. For tests and for keys vouched for outside the log.
   * Mocked registry (MOCKS.md #6): did:web documents are not fetched yet.
   */
  fallbackResolver?: KeyResolver;
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

/**
 * The append-only signed event log. Every record is verified before it is stored; chains are
 * linear (one successor per record); job chains must follow the ASP lifecycle; passport records
 * maintain the registry of keys. A running hash over record ids makes the log order tamper-evident.
 */
export class EventLog {
  readonly store: Store;
  private readonly schemas: SchemaSet;
  private readonly fallback?: KeyResolver;

  constructor(store: Store, opts: EventLogOptions = {}) {
    this.store = store;
    this.schemas = opts.schemas ?? defaultSchemas();
    this.fallback = opts.fallbackResolver;
  }

  append(raw: unknown): Promise<AppendResult> {
    this.schemas.assert("envelope", raw);
    const r = raw as AspRecord;
    return this.store.transaction((tx) => this.appendIn(tx, r));
  }

  private async appendIn(tx: LogTx, r: AspRecord): Promise<AppendResult> {
    const existing = await tx.getRecord(r.id);
    if (existing) {
      const chain = await tx.getChain(existing.chain);
      return { seq: existing.seq, id: existing.id, chain: existing.chain, logHash: existing.logHash, state: chain?.state ?? null, duplicate: true };
    }

    const type = shortType(r.type);
    const verified = verifyRecord(r, await this.resolverFor(tx, r, type), this.schemas);

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
      seq: head.seq + 1, id: verified.id, chain: root, logHash: nextLogHash(head.logHash, verified.id), record: verified,
    };
    // Insert first: projections reference the record. A projection that throws rolls the insert back.
    await tx.insertRecord(stored);
    if (type === "passport") await this.projectPassport(tx, verified);
    await tx.putChain({
      root, kind, head: verified.id, length: (chain?.length ?? 0) + 1, lastIssuedAt: verified.issued_at,
      state: snapshot?.state ?? null, snapshot,
    });
    await tx.setLogHead({ seq: stored.seq, logHash: stored.logHash });
    return { seq: stored.seq, id: stored.id, chain: root, logHash: stored.logHash, state: snapshot?.state ?? null, duplicate: false };
  }

  /** Keys for every kid on the record: registry first, then a self-issued first passport's own keys, then the fallback. */
  private async resolverFor(tx: LogTx, r: AspRecord, type: string | undefined): Promise<KeyResolver> {
    const found = new Map<string, Uint8Array>();
    for (const { kid } of [r.sig, ...(r.cosigs ?? [])]) {
      const k = await tx.getKey(kid);
      if (k && !k.revokedAt) found.set(kid, b64urlDecode(k.publicKey));
    }
    const body = r.body as { did?: string; keys?: { id: string; public_key: string }[] };
    // Bootstrap: a person's first passport may be self-issued, signed by a key it declares.
    if (type === "passport" && body.did === r.issuer && !(await tx.getPassport(r.issuer))) {
      for (const k of body.keys ?? []) if (!found.has(k.id)) found.set(k.id, b64urlDecode(k.public_key));
    }
    return (kid) => found.get(kid) ?? this.fallback?.(kid);
  }

  /** Registry rules: one passport chain per DID, issued by the DID itself or its sponsor. */
  private async projectPassport(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as { did: string; sponsor?: string; keys: { id: string; public_key: string }[] };
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
    }

    const declared = new Set(body.keys.map((k) => k.id));
    for (const old of await tx.keysForDid(body.did)) {
      if (!declared.has(old.kid) && !old.revokedAt) await tx.putKey({ ...old, revokedAt: r.issued_at });
    }
    for (const k of body.keys) {
      await tx.putKey({ kid: k.id, did: body.did, publicKey: k.public_key, passport: r.id, revokedAt: null });
    }
    await tx.putPassport({ did: body.did, head: r.id, sponsor: body.sponsor ?? sponsor });
  }

  get(id: string) { return this.store.getRecord(id); }
  head() { return this.store.logHead(); }
  chain(root: string) { return this.store.chainRecords(root); }
  chainInfo(root: string) { return this.store.getChain(root); }
  since(afterSeq: number, limit = 500) { return this.store.since(afterSeq, limit); }

  /**
   * Re-verifies the whole log by replaying it into a fresh in-memory log: every id, signature,
   * chain link, lifecycle step, registry change and log hash must come out the same.
   */
  async verify(pageSize = 500): Promise<VerifyReport> {
    const replay = new EventLog(new MemoryStore(), { schemas: this.schemas, fallbackResolver: this.fallback });
    let after = 0;
    let count = 0;
    for (;;) {
      const page = await this.store.since(after, pageSize);
      if (page.length === 0) break;
      for (const s of page) {
        try {
          if (s.seq !== after + 1) throw new AspError("BAD_PREV", `log gap: expected seq ${after + 1}, found ${s.seq}`);
          const res = await replay.append(s.record);
          if (res.duplicate || res.id !== s.id) throw new AspError("BAD_ID", `stored id ${s.id} does not match its record`);
          if (res.logHash !== s.logHash) throw new AspError("BAD_ID", `log hash mismatch at seq ${s.seq}`);
          if (res.chain !== s.chain) throw new AspError("BAD_PREV", `record ${s.id} is filed under the wrong chain`);
        } catch (e) {
          if (!(e instanceof AspError)) throw e;
          return { ok: false, records: count, head: await replay.head(), error: { seq: s.seq, id: s.id, code: e.code, message: e.message } };
        }
        after = s.seq;
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
