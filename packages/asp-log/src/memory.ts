import {
  GENESIS_LOG_HASH,
  type ChainRow, type FleetRow, type KeyRow, type LogHead, type LogTx, type PassportRow, type Store, type StoredRecord,
} from "./store.ts";

const copy = <T>(v: T): T => structuredClone(v);

interface Tables {
  chains: Map<string, ChainRow>;
  keys: Map<string, KeyRow>;
  passports: Map<string, PassportRow>;
  fleets: Map<string, FleetRow>;
}

const emptyTables = (): Tables => ({ chains: new Map(), keys: new Map(), passports: new Map(), fleets: new Map() });

/** An in-memory Store for tests and local tools. Appends are serialized; failed appends leave no trace. */
export class MemoryStore implements Store {
  private records = new Map<string, StoredRecord>();
  private bySeq: StoredRecord[] = [];
  private tables = emptyTables();
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
    for (const name of Object.keys(tx.staged) as (keyof Tables)[]) {
      for (const [k, v] of tx.staged[name]) (this.tables[name] as Map<string, unknown>).set(k, v);
    }
    if (tx.head) this.head = tx.head;
  }

  async logHead() { return { ...this.head }; }
  async getRecord(id: string) { const r = this.records.get(id); return r && copy(r); }
  async getChain(root: string) { const c = this.tables.chains.get(root); return c && copy(c); }
  async chainRecords(root: string) { return this.bySeq.filter((r) => r.chain === root).map(copy); }
  async since(afterSeq: number, limit: number) { return this.bySeq.slice(afterSeq, afterSeq + limit).map(copy); }
  async getPassport(did: string) { const p = this.tables.passports.get(did); return p && copy(p); }
  async getFleet(did: string) { const f = this.tables.fleets.get(did); return f && copy(f); }
  async fleetMembers(fleet: string) { return [...this.tables.passports.values()].filter((p) => p.fleet === fleet).map(copy); }
  async keysForDid(did: string) { return [...this.tables.keys.values()].filter((k) => k.did === did).map(copy); }
  async close() {}

  /** @internal read access for MemoryTx */
  base() {
    return { records: this.records, tables: this.tables, head: this.head };
  }
}

class MemoryTx implements LogTx {
  readonly newRecords: StoredRecord[] = [];
  readonly staged = emptyTables();
  head?: LogHead;

  private readonly store: MemoryStore;

  constructor(store: MemoryStore) {
    this.store = store;
  }

  private get b() { return this.store.base(); }

  private read<K extends keyof Tables>(name: K, key: string) {
    const v = (this.staged[name] as Map<string, unknown>).get(key) ?? (this.b.tables[name] as Map<string, unknown>).get(key);
    return v === undefined ? undefined : copy(v);
  }

  private all<K extends keyof Tables>(name: K): Tables[K] extends Map<string, infer V> ? V[] : never {
    const merged = new Map(this.b.tables[name] as Map<string, unknown>);
    for (const [k, v] of this.staged[name] as Map<string, unknown>) merged.set(k, v);
    return [...merged.values()].map(copy) as any;
  }

  async logHead() { return { ...(this.head ?? this.b.head) }; }
  async getRecord(id: string) {
    const r = this.newRecords.find((r) => r.id === id) ?? this.b.records.get(id);
    return r && copy(r);
  }
  async getChain(root: string) { return this.read("chains", root) as ChainRow | undefined; }
  async getKey(kid: string) { return this.read("keys", kid) as KeyRow | undefined; }
  async keysForDid(did: string) { return this.all("keys").filter((k) => k.did === did); }
  async nodeKeysForMandate(mandate: string) { return this.all("keys").filter((k) => k.kind === "node" && k.mandate === mandate); }
  async getPassport(did: string) { return this.read("passports", did) as PassportRow | undefined; }
  async getFleet(did: string) { return this.read("fleets", did) as FleetRow | undefined; }
  async fleetMembers(fleet: string) { return this.all("passports").filter((p) => p.fleet === fleet); }

  async insertRecord(row: StoredRecord) { this.newRecords.push(copy(row)); }
  async putChain(row: ChainRow) { this.staged.chains.set(row.root, copy(row)); }
  async putKey(row: KeyRow) { this.staged.keys.set(row.kid, copy(row)); }
  async putPassport(row: PassportRow) { this.staged.passports.set(row.did, copy(row)); }
  async putFleet(row: FleetRow) { this.staged.fleets.set(row.did, copy(row)); }
  async setLogHead(head: LogHead) { this.head = { ...head }; }
}
