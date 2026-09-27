import {
  GENESIS_LOG_HASH,
  type AccountRow, type ChainRow, type EscrowRow, type FleetRow, type JurorRow, type KeyRow, type LogHead, type LogTx,
  type MintRow, type PassportRow, type ProbationRow, type ReputationRow, type Store, type StoredRecord,
} from "./store.ts";

const copy = <T>(v: T): T => structuredClone(v);

interface Tables {
  chains: Map<string, ChainRow>;
  keys: Map<string, KeyRow>;
  passports: Map<string, PassportRow>;
  fleets: Map<string, FleetRow>;
  probations: Map<string, ProbationRow>;
  accounts: Map<string, AccountRow>;
  escrows: Map<string, EscrowRow>;
  mints: Map<string, MintRow>;
  jurors: Map<string, JurorRow>;
  reputations: Map<string, ReputationRow>;
}

const emptyTables = (): Tables => ({
  chains: new Map(), keys: new Map(), passports: new Map(), fleets: new Map(), probations: new Map(),
  accounts: new Map(), escrows: new Map(), mints: new Map(), jurors: new Map(), reputations: new Map(),
});

/** An in-memory Store for tests and local tools. Appends are serialized; failed appends leave no trace. */
export class MemoryStore implements Store {
  private records = new Map<string, StoredRecord>();
  private bySeq: StoredRecord[] = [];
  private tables = emptyTables();
  private head: LogHead = { seq: 0, logHash: GENESIS_LOG_HASH };
  private queue: Promise<unknown> = Promise.resolve();

  /** @param initialMints Seeds starting balances from cumulative mint totals (used to seed verify()'s replay; see MintRow). */
  constructor(initialMints: AccountRow[] = []) {
    for (const a of initialMints) {
      this.tables.accounts.set(a.did, copy(a));
      this.tables.mints.set(a.did, { did: a.did, totalMinted: a.balance });
    }
  }

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
  async getProbation(did: string) { const p = this.tables.probations.get(did); return p && copy(p); }
  async keysForDid(did: string) { return [...this.tables.keys.values()].filter((k) => k.did === did).map(copy); }
  async getAccount(did: string) { const a = this.tables.accounts.get(did); return a && copy(a); }
  async getEscrow(contract: string) { const e = this.tables.escrows.get(contract); return e && copy(e); }
  async allMints() { return [...this.tables.mints.values()].map((m) => ({ did: m.did, balance: m.totalMinted })); }
  async getJuror(did: string) { const j = this.tables.jurors.get(did); return j && copy(j); }
  async activeJurors() { return [...this.tables.jurors.values()].filter((j) => j.staked > 0).map(copy); }
  async getReputation(did: string) { const r = this.tables.reputations.get(did); return r && copy(r); }
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
  async getProbation(did: string) { return this.read("probations", did) as ProbationRow | undefined; }
  async getAccount(did: string) { return this.read("accounts", did) as AccountRow | undefined; }
  async getEscrow(contract: string) { return this.read("escrows", contract) as EscrowRow | undefined; }
  async getMint(did: string) { return this.read("mints", did) as MintRow | undefined; }
  async getJuror(did: string) { return this.read("jurors", did) as JurorRow | undefined; }
  async activeJurors() { return this.all("jurors").filter((j) => j.staked > 0); }
  async getReputation(did: string) { return this.read("reputations", did) as ReputationRow | undefined; }

  async insertRecord(row: StoredRecord) { this.newRecords.push(copy(row)); }
  async putChain(row: ChainRow) { this.staged.chains.set(row.root, copy(row)); }
  async putKey(row: KeyRow) { this.staged.keys.set(row.kid, copy(row)); }
  async putPassport(row: PassportRow) { this.staged.passports.set(row.did, copy(row)); }
  async putFleet(row: FleetRow) { this.staged.fleets.set(row.did, copy(row)); }
  async putProbation(row: ProbationRow) { this.staged.probations.set(row.did, copy(row)); }
  async putAccount(row: AccountRow) { this.staged.accounts.set(row.did, copy(row)); }
  async putEscrow(row: EscrowRow) { this.staged.escrows.set(row.contract, copy(row)); }
  async putMint(row: MintRow) { this.staged.mints.set(row.did, copy(row)); }
  async putJuror(row: JurorRow) { this.staged.jurors.set(row.did, copy(row)); }
  async putReputation(row: ReputationRow) { this.staged.reputations.set(row.did, copy(row)); }
  async setLogHead(head: LogHead) { this.head = { ...head }; }
}
