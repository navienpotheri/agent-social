import {
  GENESIS_LOG_HASH, type ChainRow, type KeyRow, type LogHead, type LogTx, type PassportRow, type Store, type StoredRecord,
} from "./store.ts";

const copy = <T>(v: T): T => structuredClone(v);

/** An in-memory Store for tests and local tools. Appends are serialized; failed appends leave no trace. */
export class MemoryStore implements Store {
  private records = new Map<string, StoredRecord>();
  private bySeq: StoredRecord[] = [];
  private chains = new Map<string, ChainRow>();
  private keys = new Map<string, KeyRow>();
  private passports = new Map<string, PassportRow>();
  private head: LogHead = { seq: 0, logHash: GENESIS_LOG_HASH };
  private queue: Promise<unknown> = Promise.resolve();

  transaction<T>(fn: (tx: LogTx) => Promise<T>): Promise<T> {
    const run = async () => {
      const tx = new MemoryTx(this);
      const result = await fn(tx);
      this.commit(tx);
      return result;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private commit(tx: MemoryTx): void {
    for (const r of tx.newRecords) {
      this.records.set(r.id, r);
      this.bySeq.push(r);
    }
    for (const [k, v] of tx.chains) this.chains.set(k, v);
    for (const [k, v] of tx.keys) this.keys.set(k, v);
    for (const [k, v] of tx.passports) this.passports.set(k, v);
    if (tx.head) this.head = tx.head;
  }

  async logHead() { return { ...this.head }; }
  async getRecord(id: string) { const r = this.records.get(id); return r && copy(r); }
  async getChain(root: string) { const c = this.chains.get(root); return c && copy(c); }
  async chainRecords(root: string) { return this.bySeq.filter((r) => r.chain === root).map(copy); }
  async since(afterSeq: number, limit: number) { return this.bySeq.slice(afterSeq, afterSeq + limit).map(copy); }
  async close() {}

  /** @internal read access for MemoryTx */
  base() {
    return { records: this.records, chains: this.chains, keys: this.keys, passports: this.passports, head: this.head };
  }
}

class MemoryTx implements LogTx {
  readonly newRecords: StoredRecord[] = [];
  readonly chains = new Map<string, ChainRow>();
  readonly keys = new Map<string, KeyRow>();
  readonly passports = new Map<string, PassportRow>();
  head?: LogHead;

  private readonly store: MemoryStore;

  constructor(store: MemoryStore) {
    this.store = store;
  }

  private get b() { return this.store.base(); }

  async logHead() { return { ...(this.head ?? this.b.head) }; }
  async getRecord(id: string) {
    const r = this.newRecords.find((r) => r.id === id) ?? this.b.records.get(id);
    return r && copy(r);
  }
  async getChain(root: string) { const c = this.chains.get(root) ?? this.b.chains.get(root); return c && copy(c); }
  async getKey(kid: string) { const k = this.keys.get(kid) ?? this.b.keys.get(kid); return k && copy(k); }
  async keysForDid(did: string) {
    const all = new Map(this.b.keys);
    for (const [k, v] of this.keys) all.set(k, v);
    return [...all.values()].filter((k) => k.did === did).map(copy);
  }
  async getPassport(did: string) { const p = this.passports.get(did) ?? this.b.passports.get(did); return p && copy(p); }

  async insertRecord(row: StoredRecord) { this.newRecords.push(copy(row)); }
  async putChain(row: ChainRow) { this.chains.set(row.root, copy(row)); }
  async putKey(row: KeyRow) { this.keys.set(row.kid, copy(row)); }
  async putPassport(row: PassportRow) { this.passports.set(row.did, copy(row)); }
  async setLogHead(head: LogHead) { this.head = { ...head }; }
}
