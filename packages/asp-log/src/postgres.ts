import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import pg from "pg";
import type {
  AccountRow, ChainRow, EscrowRow, FleetRow, JurorRow, KeyRow, LogHead, LogTx, MandateRow, MintRow, PassportRow, ReportRow, VerificationRow,
  ProbationRow, ReputationRow, Store, StoredRecord,
} from "./store.ts";

const SQL_DIR = fileURLToPath(new URL("../sql/", import.meta.url));

type Queryable = pg.Pool | pg.PoolClient;

/** Applies sql/*.sql files that have not run yet, in name order, each in its own transaction. */
export async function migrate(pool: pg.Pool): Promise<string[]> {
  await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const done = new Set((await pool.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  const applied: string[] = [];
  for (const file of readdirSync(SQL_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(readFileSync(join(SQL_DIR, file), "utf8"));
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      applied.push(file);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  return applied;
}

interface RecordRow {
  seq: string;
  id: string;
  chain: string;
  log_hash: string;
  appended_at: Date;
  envelope: StoredRecord["record"];
}

const toStored = (r: RecordRow): StoredRecord => ({
  seq: Number(r.seq), id: r.id, chain: r.chain, logHash: r.log_hash,
  appendedAt: r.appended_at.toISOString(), record: r.envelope,
});

const RECORD_COLS = "seq, id, chain, log_hash, appended_at, envelope";

const toKey = (k: any): KeyRow => ({
  kid: k.kid, did: k.did, publicKey: k.public_key, kind: k.kind, grantedBy: k.granted_by,
  revokedAt: k.revoked_at, expiresAt: k.expires_at, mandate: k.mandate,
});
const toPassport = (p: any): PassportRow => ({ did: p.did, head: p.head, sponsor: p.sponsor, fleet: p.fleet });
const toFleet = (f: any): FleetRow => ({ did: f.did, head: f.head, org: f.org, name: f.name, maxMembers: f.max_members });
const toProbation = (p: any): ProbationRow => ({ did: p.did, until: p.until, setBy: p.set_by });
const toAccount = (a: any): AccountRow => ({ did: a.did, balance: Number(a.balance) });
const toEscrow = (e: any): EscrowRow => ({
  contract: e.contract, escrowPayer: e.escrow_payer, escrowLocked: Number(e.escrow_locked),
  backer: e.backer, bondLocked: Number(e.bond_locked),
  agentPermille: e.agent_permille === null ? null : Number(e.agent_permille),
  feeReservePrincipal: Number(e.fee_reserve_principal), feeReserveBacker: Number(e.fee_reserve_backer), forcedFault: !!e.forced_fault, settled: e.settled,
});
const toMint = (m: any): MintRow => ({ did: m.did, totalMinted: Number(m.total_minted) });
const toJuror = (j: any): JurorRow => ({ did: j.did, head: j.head, staked: Number(j.staked) });
const toReputation = (r: any): ReputationRow => ({ did: r.did, tier: Number(r.tier), slashCount: Number(r.slash_count), strikeLog: r.strike_log ?? [] });
const toMandate = (m: any): MandateRow => ({ contract: m.contract, scopes: m.scopes });
const toReport = (r: any): ReportRow => ({ id: r.id, contract: r.contract, reporter: r.reporter, accused: r.accused, deposit: Number(r.deposit), status: r.status });
const toVerification = (v: any): VerificationRow => ({ delivery: v.delivery, contract: v.contract, verifier: v.verifier, verdict: v.verdict });

/** Reads shared by the store (pool) and a transaction (client). */
function reads(q: Queryable) {
  return {
    async logHead(): Promise<LogHead> {
      const { rows } = await q.query("SELECT seq, log_hash FROM log_head");
      return { seq: Number(rows[0].seq), logHash: rows[0].log_hash };
    },
    async getRecord(id: string) {
      const { rows } = await q.query<RecordRow>(`SELECT ${RECORD_COLS} FROM records WHERE id = $1`, [id]);
      return rows[0] && toStored(rows[0]);
    },
    async getChain(root: string): Promise<ChainRow | undefined> {
      const { rows } = await q.query("SELECT * FROM chains WHERE root = $1", [root]);
      const c = rows[0];
      return c && {
        root: c.root, kind: c.kind, head: c.head, length: c.length,
        lastIssuedAt: c.last_issued_at, state: c.state, snapshot: c.snapshot,
      };
    },
    async getKey(kid: string) {
      const { rows } = await q.query("SELECT * FROM keys WHERE kid = $1", [kid]);
      return rows[0] && toKey(rows[0]);
    },
    async keysForDid(did: string) {
      const { rows } = await q.query("SELECT * FROM keys WHERE did = $1 ORDER BY kid", [did]);
      return rows.map(toKey);
    },
    async nodeKeysForMandate(mandate: string) {
      const { rows } = await q.query("SELECT * FROM keys WHERE kind = 'node' AND mandate = $1", [mandate]);
      return rows.map(toKey);
    },
    async getPassport(did: string) {
      const { rows } = await q.query("SELECT * FROM passports WHERE did = $1", [did]);
      return rows[0] && toPassport(rows[0]);
    },
    async getFleet(did: string) {
      const { rows } = await q.query("SELECT * FROM fleets WHERE did = $1", [did]);
      return rows[0] && toFleet(rows[0]);
    },
    async fleetMembers(fleet: string) {
      const { rows } = await q.query("SELECT * FROM passports WHERE fleet = $1 ORDER BY did", [fleet]);
      return rows.map(toPassport);
    },
    async getProbation(did: string) {
      const { rows } = await q.query("SELECT * FROM probations WHERE did = $1", [did]);
      return rows[0] && toProbation(rows[0]);
    },
    async getAccount(did: string) {
      const { rows } = await q.query("SELECT * FROM accounts WHERE did = $1", [did]);
      return rows[0] && toAccount(rows[0]);
    },
    async getEscrow(contract: string) {
      const { rows } = await q.query("SELECT * FROM escrows WHERE contract = $1", [contract]);
      return rows[0] && toEscrow(rows[0]);
    },
    async getMint(did: string) {
      const { rows } = await q.query("SELECT * FROM mints WHERE did = $1", [did]);
      return rows[0] && toMint(rows[0]);
    },
    async allMints() {
      const { rows } = await q.query("SELECT * FROM mints ORDER BY did");
      return rows.map(toMint).map((m) => ({ did: m.did, balance: m.totalMinted }));
    },
    async getJuror(did: string) {
      const { rows } = await q.query("SELECT * FROM jurors WHERE did = $1", [did]);
      return rows[0] && toJuror(rows[0]);
    },
    async activeJurors() {
      const { rows } = await q.query("SELECT * FROM jurors WHERE staked > 0 ORDER BY did");
      return rows.map(toJuror);
    },
    async getReputation(did: string) {
      const { rows } = await q.query("SELECT * FROM reputations WHERE did = $1", [did]);
      return rows[0] && toReputation(rows[0]);
    },
    async getMandate(contract: string) {
      const { rows } = await q.query("SELECT * FROM mandates WHERE contract = $1", [contract]);
      return rows[0] && toMandate(rows[0]);
    },
    async getVerification(delivery: string) {
      const { rows } = await q.query("SELECT * FROM verifications WHERE delivery = $1", [delivery]);
      return rows[0] && toVerification(rows[0]);
    },
    async getReport(id: string) {
      const { rows } = await q.query("SELECT * FROM reports WHERE id = $1", [id]);
      return rows[0] && toReport(rows[0]);
    },
    async openReportFor(contract: string) {
      const { rows } = await q.query("SELECT * FROM reports WHERE contract = $1 AND status = 'open' LIMIT 1", [contract]);
      return rows[0] && toReport(rows[0]);
    },
  };
}

export class PostgresStore implements Store {
  readonly pool: pg.Pool;
  private readonly r: ReturnType<typeof reads>;

  constructor(config: string | pg.PoolConfig) {
    this.pool = new pg.Pool(typeof config === "string" ? { connectionString: config } : config);
    this.r = reads(this.pool);
  }

  migrate() { return migrate(this.pool); }

  async transaction<T>(fn: (tx: LogTx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Lock the log head first: appends run one at a time.
      await client.query("SELECT seq FROM log_head FOR UPDATE");
      const result = await fn(new PgTx(client));
      await client.query("COMMIT");
      return result;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  logHead() { return this.r.logHead(); }
  getRecord(id: string) { return this.r.getRecord(id); }
  getChain(root: string) { return this.r.getChain(root); }
  getPassport(did: string) { return this.r.getPassport(did); }
  getFleet(did: string) { return this.r.getFleet(did); }
  fleetMembers(fleet: string) { return this.r.fleetMembers(fleet); }
  getProbation(did: string) { return this.r.getProbation(did); }
  keysForDid(did: string) { return this.r.keysForDid(did); }
  getAccount(did: string) { return this.r.getAccount(did); }
  getEscrow(contract: string) { return this.r.getEscrow(contract); }
  allMints() { return this.r.allMints(); }
  getJuror(did: string) { return this.r.getJuror(did); }
  activeJurors() { return this.r.activeJurors(); }
  getReputation(did: string) { return this.r.getReputation(did); }
  getMandate(contract: string) { return this.r.getMandate(contract); }
  getVerification(delivery: string) { return this.r.getVerification(delivery); }
  getReport(id: string) { return this.r.getReport(id); }
  openReportFor(contract: string) { return this.r.openReportFor(contract); }
  async chainRecords(root: string) {
    const { rows } = await this.pool.query<RecordRow>(`SELECT ${RECORD_COLS} FROM records WHERE chain = $1 ORDER BY seq`, [root]);
    return rows.map(toStored);
  }
  async since(afterSeq: number, limit: number) {
    const { rows } = await this.pool.query<RecordRow>(
      `SELECT ${RECORD_COLS} FROM records WHERE seq > $1 ORDER BY seq LIMIT $2`, [afterSeq, limit]);
    return rows.map(toStored);
  }
  close() { return this.pool.end(); }
}

class PgTx implements LogTx {
  private readonly c: pg.PoolClient;
  private readonly r: ReturnType<typeof reads>;

  constructor(c: pg.PoolClient) {
    this.c = c;
    this.r = reads(c);
  }

  logHead() { return this.r.logHead(); }
  getRecord(id: string) { return this.r.getRecord(id); }
  getChain(root: string) { return this.r.getChain(root); }
  getKey(kid: string) { return this.r.getKey(kid); }
  keysForDid(did: string) { return this.r.keysForDid(did); }
  nodeKeysForMandate(mandate: string) { return this.r.nodeKeysForMandate(mandate); }
  getPassport(did: string) { return this.r.getPassport(did); }
  getFleet(did: string) { return this.r.getFleet(did); }
  fleetMembers(fleet: string) { return this.r.fleetMembers(fleet); }
  getProbation(did: string) { return this.r.getProbation(did); }
  getAccount(did: string) { return this.r.getAccount(did); }
  getEscrow(contract: string) { return this.r.getEscrow(contract); }
  getMint(did: string) { return this.r.getMint(did); }
  getJuror(did: string) { return this.r.getJuror(did); }
  activeJurors() { return this.r.activeJurors(); }
  getReputation(did: string) { return this.r.getReputation(did); }
  getMandate(contract: string) { return this.r.getMandate(contract); }
  getVerification(delivery: string) { return this.r.getVerification(delivery); }
  getReport(id: string) { return this.r.getReport(id); }
  openReportFor(contract: string) { return this.r.openReportFor(contract); }

  async insertRecord(row: StoredRecord) {
    const r = row.record;
    await this.c.query(
      `INSERT INTO records (seq, id, type, issuer, actor, subject, prev, chain, issued_at, envelope, log_hash, appended_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [row.seq, row.id, r.type, r.issuer, r.actor, r.subject, r.prev, row.chain, r.issued_at, JSON.stringify(r), row.logHash, row.appendedAt],
    );
  }
  async putChain(row: ChainRow) {
    await this.c.query(
      `INSERT INTO chains (root, kind, head, length, last_issued_at, state, snapshot)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (root) DO UPDATE SET head = $3, length = $4, last_issued_at = $5, state = $6, snapshot = $7`,
      [row.root, row.kind, row.head, row.length, row.lastIssuedAt, row.state, row.snapshot && JSON.stringify(row.snapshot)],
    );
  }
  async putKey(row: KeyRow) {
    await this.c.query(
      `INSERT INTO keys (kid, did, public_key, kind, granted_by, revoked_at, expires_at, mandate)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (kid) DO UPDATE SET public_key = $3, kind = $4, granted_by = $5, revoked_at = $6, expires_at = $7, mandate = $8`,
      [row.kid, row.did, row.publicKey, row.kind, row.grantedBy, row.revokedAt, row.expiresAt, row.mandate],
    );
  }
  async putPassport(row: PassportRow) {
    await this.c.query(
      `INSERT INTO passports (did, head, sponsor, fleet) VALUES ($1, $2, $3, $4)
       ON CONFLICT (did) DO UPDATE SET head = $2, sponsor = $3, fleet = $4`,
      [row.did, row.head, row.sponsor, row.fleet],
    );
  }
  async putFleet(row: FleetRow) {
    await this.c.query(
      `INSERT INTO fleets (did, head, org, name, max_members) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (did) DO UPDATE SET head = $2, org = $3, name = $4, max_members = $5`,
      [row.did, row.head, row.org, row.name, row.maxMembers],
    );
  }
  async putProbation(row: ProbationRow) {
    await this.c.query(
      `INSERT INTO probations (did, until, set_by) VALUES ($1, $2, $3)
       ON CONFLICT (did) DO UPDATE SET until = $2, set_by = $3`,
      [row.did, row.until, row.setBy],
    );
  }
  async putAccount(row: AccountRow) {
    await this.c.query(
      `INSERT INTO accounts (did, balance) VALUES ($1, $2)
       ON CONFLICT (did) DO UPDATE SET balance = $2`,
      [row.did, row.balance],
    );
  }
  async putEscrow(row: EscrowRow) {
    await this.c.query(
      `INSERT INTO escrows (contract, escrow_payer, escrow_locked, backer, bond_locked, settled, agent_permille, fee_reserve_principal, fee_reserve_backer, forced_fault)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (contract) DO UPDATE SET escrow_payer = $2, escrow_locked = $3, backer = $4, bond_locked = $5, settled = $6, agent_permille = $7,
         fee_reserve_principal = $8, fee_reserve_backer = $9, forced_fault = $10`,
      [row.contract, row.escrowPayer, row.escrowLocked, row.backer, row.bondLocked, row.settled, row.agentPermille, row.feeReservePrincipal, row.feeReserveBacker, row.forcedFault],
    );
  }
  async putMint(row: MintRow) {
    await this.c.query(
      `INSERT INTO mints (did, total_minted) VALUES ($1, $2)
       ON CONFLICT (did) DO UPDATE SET total_minted = $2`,
      [row.did, row.totalMinted],
    );
  }
  async putJuror(row: JurorRow) {
    await this.c.query(
      `INSERT INTO jurors (did, head, staked) VALUES ($1, $2, $3)
       ON CONFLICT (did) DO UPDATE SET head = $2, staked = $3`,
      [row.did, row.head, row.staked],
    );
  }
  async putReputation(row: ReputationRow) {
    await this.c.query(
      `INSERT INTO reputations (did, tier, slash_count, strike_log) VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (did) DO UPDATE SET tier = $2, slash_count = $3, strike_log = $4::jsonb`,
      [row.did, row.tier, row.slashCount, JSON.stringify(row.strikeLog)],
    );
  }
  async putMandate(row: MandateRow) {
    await this.c.query(
      `INSERT INTO mandates (contract, scopes) VALUES ($1, $2)
       ON CONFLICT (contract) DO UPDATE SET scopes = $2`,
      [row.contract, row.scopes],
    );
  }
  async putReport(row: ReportRow) {
    await this.c.query(
      `INSERT INTO reports (id, contract, reporter, accused, deposit, status) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET status = $6`,
      [row.id, row.contract, row.reporter, row.accused, row.deposit, row.status],
    );
  }
  async putVerification(row: VerificationRow) {
    await this.c.query(
      `INSERT INTO verifications (delivery, contract, verifier, verdict) VALUES ($1, $2, $3, $4)
       ON CONFLICT (delivery) DO UPDATE SET contract = $2, verifier = $3, verdict = $4`,
      [row.delivery, row.contract, row.verifier, row.verdict],
    );
  }
  async setLogHead(head: LogHead) {
    await this.c.query("UPDATE log_head SET seq = $1, log_hash = $2", [head.seq, head.logHash]);
  }
}
